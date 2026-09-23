// src/rotas/criativos.js
// Criativos: contexto -> imagens (n8n, assíncrono) -> aprovação humana -> copy (n8n) -> escolha -> arte (cockpit).
// O cockpit guarda arquivos no Postgres (tabela arquivos) e monta a arte final em template HTML; a IA fica no n8n.
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const router = express.Router();
const { pool } = require('../servicos/db');
const { montarArtes, FORMATOS } = require('../servicos/arte');

const OBJETIVOS = ['vendas', 'mensagens', 'leads', 'reconhecimento'];
const FORMATOS_PEDIDO = ['feed', 'stories', 'ambos'];
const MAX_FOTOS = 3;
const TEMPO_MAXIMO_MIN = 10;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: MAX_FOTOS } }).array('fotos', MAX_FOTOS);

function urlPublica(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}`;
}
const texto = (v, n = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : '');

async function salvarArquivo(criativoId, tipo, nome, mime, dados) {
  const token = crypto.randomBytes(12).toString('hex');
  const { rows } = await pool.query(
    'INSERT INTO arquivos (criativo_id, tipo, nome, mime, token, dados) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, token',
    [criativoId, tipo, nome, mime, token, dados]
  );
  return rows[0];
}
const urlArquivo = (base, a) => `${base}/api/arquivos/${a.id}/${a.token}`;

async function buscarCriativo(id) {
  const { rows } = await pool.query('SELECT * FROM criativos WHERE id = $1', [id]);
  return rows[0] || null;
}
async function atualizar(id, patch) {
  const chaves = Object.keys(patch);
  const sets = chaves.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const valores = chaves.map((k) => (patch[k] !== null && typeof patch[k] === 'object' ? JSON.stringify(patch[k]) : patch[k]));
  await pool.query(`UPDATE criativos SET ${sets}, atualizado_em = now() WHERE id = $1`, [id, ...valores]);
}

// Resposta pública do criativo: troca ids de arquivo por URLs.
function apresentar(c, base) {
  const comUrl = (a) => (a && a.arquivo_id ? { ...a, url: `${base}/api/arquivos/${a.arquivo_id}/${a.token}` } : a);
  return {
    ...c,
    callback_token: undefined,
    fotos: (c.contexto?.fotos || []).map(comUrl),
    imagens: (c.imagens || []).map(comUrl),
    artes: (c.artes || []).map(comUrl),
  };
}

async function clienteDe(id) {
  const { rows } = await pool.query('SELECT id, nome, perfil, orientacoes FROM clientes WHERE id = $1', [id]);
  return rows[0] || null;
}

// Dispara a geração de imagens no n8n (rodada nova ou refazer com feedback).
async function pedirImagens(req, criativo, cliente, { feedback = '', prompt_anterior = '' } = {}) {
  const url = process.env.N8N_WEBHOOK_CRIATIVO_IMAGEM;
  if (!url) throw new Error('N8N_WEBHOOK_CRIATIVO_IMAGEM não configurado');
  const token = crypto.randomBytes(16).toString('hex');
  await atualizar(criativo.id, { estado: 'imagem_gerando', erro: null, callback_token: token });
  const base = urlPublica(req);
  const fotos = (criativo.contexto?.fotos || []).map((f) => `${base}/api/arquivos/${f.arquivo_id}/${f.token}`);
  const { fotos: _f, ...contexto } = criativo.contexto || {};
  const resp = await axios.post(url, {
    criativo_id: criativo.id, cliente_id: cliente.id, cliente_nome: cliente.nome,
    perfil: cliente.perfil || '', orientacoes: cliente.orientacoes || '',
    contexto, fotos, feedback, prompt_anterior, quantidade: 2,
    callback_url: `${base}/api/criativos/${criativo.id}/imagens/concluir`, callback_token: token,
  }, { timeout: 30000, headers: { 'Content-Type': 'application/json' } });
  if (!resp.data?.aceito) throw new Error('o n8n não aceitou o pedido de imagem');
}

// POST /clientes/:id/criativos — multipart: campos do contexto + fotos[] (opcional)
router.post('/clientes/:id/criativos', (req, res) => {
  upload(req, res, async (erroUpload) => {
    if (erroUpload) return res.status(400).json({ erro: erroUpload.code === 'LIMIT_FILE_SIZE' ? 'foto maior que 12 MB' : 'upload inválido' });
    try {
      const cliente = await clienteDe(req.params.id);
      if (!cliente) return res.status(404).json({ erro: 'cliente não encontrado' });
      const b = req.body || {};
      const contexto = {
        objetivo: OBJETIVOS.includes(b.objetivo) ? b.objetivo : 'vendas',
        produto: texto(b.produto, 200), oferta: texto(b.oferta, 200), publico: texto(b.publico, 200),
        formato: FORMATOS_PEDIDO.includes(b.formato) ? b.formato : 'ambos', estilo: texto(b.estilo, 400), referencias: texto(b.referencias, 600),
        fotos: [],
      };
      if (!contexto.produto) return res.status(400).json({ erro: 'informe o produto ou serviço do criativo' });
      const titulo = texto(b.titulo, 120) || contexto.produto;

      const ins = await pool.query(
        `INSERT INTO criativos (cliente_id, titulo, estado, contexto) VALUES ($1,$2,'imagem_gerando',$3) RETURNING id`,
        [cliente.id, titulo, JSON.stringify(contexto)]
      );
      const id = ins.rows[0].id;
      for (const f of req.files || []) {
        if (!/^image\/(png|jpe?g|webp)$/i.test(f.mimetype)) continue;
        const a = await salvarArquivo(id, 'foto', Buffer.from(f.originalname, 'latin1').toString('utf8'), f.mimetype, f.buffer);
        contexto.fotos.push({ arquivo_id: a.id, token: a.token, nome: f.originalname });
      }
      await atualizar(id, { contexto });
      const criativo = await buscarCriativo(id);
      try { await pedirImagens(req, criativo, cliente); }
      catch (e) { await atualizar(id, { estado: 'erro', erro: e.message }); }
      res.status(202).json(apresentar(await buscarCriativo(id), urlPublica(req)));
    } catch (e) {
      console.error(e);
      res.status(500).json({ erro: e.message });
    }
  });
});

router.get('/clientes/:id/criativos', async (req, res) => {
  try {
    await pool.query(
      `UPDATE criativos SET estado = 'erro', erro = 'o n8n não respondeu em ${TEMPO_MAXIMO_MIN} minutos'
       WHERE cliente_id = $1 AND estado = 'imagem_gerando' AND atualizado_em < now() - interval '${TEMPO_MAXIMO_MIN} minutes'`, [req.params.id]);
    const { rows } = await pool.query('SELECT * FROM criativos WHERE cliente_id = $1 ORDER BY id DESC LIMIT 50', [req.params.id]);
    res.json(rows.map((c) => apresentar(c, urlPublica(req))));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/criativos/:id', async (req, res) => {
  try {
    const c = await buscarCriativo(req.params.id);
    if (!c) return res.status(404).json({ erro: 'criativo não encontrado' });
    res.json(apresentar(c, urlPublica(req)));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Arquivo público por token (fotos para o n8n baixar; imagens e artes para a tela e download).
router.get('/arquivos/:id/:token', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT nome, mime, dados FROM arquivos WHERE id = $1 AND token = $2', [req.params.id, req.params.token]);
    if (!rows.length) return res.status(404).json({ erro: 'arquivo não encontrado' });
    const a = rows[0];
    res.setHeader('Content-Type', a.mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${(a.nome || 'arquivo').replace(/"/g, '')}"`);
    res.send(a.dados);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Callback do n8n com as imagens em base64.
router.post('/criativos/:id/imagens/concluir', async (req, res) => {
  try {
    const c = await buscarCriativo(req.params.id);
    if (!c) return res.status(404).json({ erro: 'criativo não encontrado' });
    const token = req.get('x-cockpit-token') || req.body?.callback_token;
    if (!c.callback_token || token !== c.callback_token) return res.status(403).json({ erro: 'token inválido' });
    const b = req.body || {};
    const novas = [];
    for (const img of Array.isArray(b.imagens) ? b.imagens.slice(0, 4) : []) {
      if (!img?.base64) continue;
      const dados = Buffer.from(String(img.base64).replace(/^data:[^,]+,/, ''), 'base64');
      if (dados.length < 1000) continue;
      const a = await salvarArquivo(c.id, 'imagem', `imagem-${c.rodada}-${novas.length + 1}.png`, img.mime || 'image/png', dados);
      novas.push({ arquivo_id: a.id, token: a.token, prompt: img.prompt || b.prompt || '', racional: b.racional || '', aprovada: false, rodada: c.rodada, criado_em: new Date().toISOString() });
    }
    if (!novas.length) {
      await atualizar(c.id, { estado: 'erro', erro: String(b.erro || 'o n8n não devolveu imagens').slice(0, 400), callback_token: null });
      return res.json({ ok: true });
    }
    await atualizar(c.id, { imagens: [...(c.imagens || []), ...novas], estado: 'imagem_pendente', erro: null, callback_token: null });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ erro: e.message }); }
});

// Refazer imagens com feedback (nova rodada).
router.post('/criativos/:id/imagens/refazer', async (req, res) => {
  try {
    const c = await buscarCriativo(req.params.id);
    if (!c) return res.status(404).json({ erro: 'criativo não encontrado' });
    if (c.estado === 'imagem_gerando') return res.status(409).json({ erro: 'ainda gerando' });
    const cliente = await clienteDe(c.cliente_id);
    const feedback = texto(req.body?.feedback, 600);
    const ultima = (c.imagens || []).slice(-1)[0];
    await atualizar(c.id, { rodada: (c.rodada || 1) + 1 });
    await pedirImagens(req, await buscarCriativo(c.id), cliente, { feedback, prompt_anterior: ultima?.prompt || '' });
    res.status(202).json(apresentar(await buscarCriativo(c.id), urlPublica(req)));
  } catch (e) { console.error(e); await atualizar(req.params.id, { estado: 'erro', erro: e.message }).catch(() => {}); res.status(502).json({ erro: e.message }); }
});

// Aprovar uma imagem -> pede a copy no n8n (síncrono, ~15 s).
router.post('/criativos/:id/imagens/:arquivoId/aprovar', async (req, res) => {
  try {
    const c = await buscarCriativo(req.params.id);
    if (!c) return res.status(404).json({ erro: 'criativo não encontrado' });
    const imagens = (c.imagens || []).map((i) => ({ ...i, aprovada: String(i.arquivo_id) === String(req.params.arquivoId) }));
    const aprovada = imagens.find((i) => i.aprovada);
    if (!aprovada) return res.status(404).json({ erro: 'imagem não encontrada neste criativo' });
    await atualizar(c.id, { imagens, estado: 'copy_gerando', erro: null });
    await gerarCopy(c.id, req.body?.feedback);
    res.json(apresentar(await buscarCriativo(c.id), urlPublica(req)));
  } catch (e) { console.error(e); res.status(502).json({ erro: e.message }); }
});

async function gerarCopy(id, feedback) {
  const url = process.env.N8N_WEBHOOK_CRIATIVO_COPY;
  const c = await buscarCriativo(id);
  const cliente = await clienteDe(c.cliente_id);
  if (!url) { await atualizar(id, { estado: 'erro', erro: 'N8N_WEBHOOK_CRIATIVO_COPY não configurado' }); return; }
  try {
    const aprovada = (c.imagens || []).find((i) => i.aprovada);
    const { fotos: _f, ...contexto } = c.contexto || {};
    const resp = await axios.post(url, {
      criativo_id: c.id, cliente_nome: cliente.nome, perfil: cliente.perfil || '', orientacoes: cliente.orientacoes || '',
      contexto, racional_imagem: aprovada?.racional || '', feedback: texto(feedback, 600),
    }, { timeout: 120000, headers: { 'Content-Type': 'application/json' } });
    const d = resp.data || {};
    if (d.erro || !Array.isArray(d.variacoes) || !d.variacoes.length) throw new Error(d.erro || 'o n8n não devolveu variações de copy');
    await atualizar(id, { copy: { variacoes: d.variacoes, legenda: d.legenda || '', escolhida: c.copy?.escolhida || null }, estado: 'copy_pendente', erro: null });
  } catch (e) {
    await atualizar(id, { estado: 'erro', erro: `copy: ${e.message}` });
    throw e;
  }
}

// Pedir novas variações de copy (com feedback opcional).
router.post('/criativos/:id/copy/refazer', async (req, res) => {
  try {
    const c = await buscarCriativo(req.params.id);
    if (!c) return res.status(404).json({ erro: 'criativo não encontrado' });
    if (!(c.imagens || []).some((i) => i.aprovada)) return res.status(409).json({ erro: 'aprove uma imagem antes' });
    await atualizar(c.id, { estado: 'copy_gerando' });
    await gerarCopy(c.id, req.body?.feedback);
    res.json(apresentar(await buscarCriativo(c.id), urlPublica(req)));
  } catch (e) { res.status(502).json({ erro: e.message }); }
});

// Escolher/editar a copy e montar as artes.
router.post('/criativos/:id/arte', async (req, res) => {
  try {
    const c = await buscarCriativo(req.params.id);
    if (!c) return res.status(404).json({ erro: 'criativo não encontrado' });
    const aprovada = (c.imagens || []).find((i) => i.aprovada);
    if (!aprovada) return res.status(409).json({ erro: 'aprove uma imagem antes' });
    const b = req.body || {};
    const escolhida = { headline: texto(b.headline, 80), texto: texto(b.texto, 200), cta: texto(b.cta, 30) };
    if (!escolhida.headline) return res.status(400).json({ erro: 'informe a headline' });
    const cliente = await clienteDe(c.cliente_id);
    const pedido = c.contexto?.formato || 'ambos';
    const formatos = pedido === 'ambos' ? ['feed', 'stories'] : [pedido];
    await atualizar(c.id, { estado: 'arte_gerando', copy: { ...(c.copy || {}), escolhida }, erro: null });

    const { rows } = await pool.query('SELECT mime, dados FROM arquivos WHERE id = $1', [aprovada.arquivo_id]);
    if (!rows.length) throw new Error('imagem aprovada não está mais no banco');
    const artes = await montarArtes({ formatos, imagem: rows[0].dados, mime: rows[0].mime, ...escolhida, marca: cliente.nome });
    const registros = [];
    for (const a of artes) {
      const arq = await salvarArquivo(c.id, 'arte', `${cliente.nome} - ${c.titulo} - ${a.formato}.png`.replace(/[\\/:*?"<>|]/g, '-'), 'image/png', a.png);
      registros.push({ formato: a.formato, arquivo_id: arq.id, token: arq.token, largura: FORMATOS[a.formato].largura, altura: FORMATOS[a.formato].altura, criado_em: new Date().toISOString() });
    }
    await atualizar(c.id, { artes: registros, estado: 'pronto' });
    res.json(apresentar(await buscarCriativo(c.id), urlPublica(req)));
  } catch (e) {
    console.error(e);
    await atualizar(req.params.id, { estado: 'erro', erro: `arte: ${e.message}` }).catch(() => {});
    res.status(500).json({ erro: e.message });
  }
});

router.delete('/criativos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM arquivos WHERE criativo_id = $1', [req.params.id]);
    const r = await pool.query('DELETE FROM criativos WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ erro: 'criativo não encontrado' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
