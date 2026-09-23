// src/rotas/clientes.js
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { pool } = require('../servicos/db');
const { apagarPdf } = require('../servicos/storage');

// logo do cliente: entra no topo do criativo, guardado em `arquivos` (o volume do Railway não persiste)
const LOGO_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const uploadLogo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } }).single('arquivo');

const CAMPOS = "id, nome, setor, cidade, conta_id, perfil, instagram, site, google_ads_id, orientacoes, abrangencia, COALESCE(whatsapp_ativo, false) AS whatsapp_ativo, whatsapp_webhook, telefone, cor_primaria, cor_destaque, COALESCE(extras->'sugestoes', '[]'::jsonb) AS sugestoes, (SELECT id FROM arquivos a WHERE a.cliente_id = clientes.id AND a.tipo = 'logo' ORDER BY a.id DESC LIMIT 1) AS logo_arquivo_id, (SELECT token FROM arquivos a WHERE a.cliente_id = clientes.id AND a.tipo = 'logo' ORDER BY a.id DESC LIMIT 1) AS logo_token";
const ABRANGENCIAS = ['local', 'regional', 'nacional'];
const LIMITE_PERFIL = 20000;
const LIMITE_ORIENTACOES = 1500; // é instrução, não documento: curto pra entrar inteiro em todo prompt

// Normaliza o corpo de criar/editar. Devolve { dados } ou { erro }.
function lerCliente(body) {
  const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const dados = {
    nome: texto(body?.nome),
    setor: texto(body?.setor),
    cidade: texto(body?.cidade),
    conta_id: texto(body?.conta_id),
    perfil: texto(body?.perfil),
    instagram: texto(body?.instagram),
    site: texto(body?.site),
    google_ads_id: texto(body?.google_ads_id),
    orientacoes: texto(body?.orientacoes),
    abrangencia: texto(body?.abrangencia),
    // Aba Comercial: WhatsApp com IA ligado ao cockpit; webhook próprio quando o cliente tem workflow/banco separado
    whatsapp_ativo: body?.whatsapp_ativo === true || body?.whatsapp_ativo === 'true',
    whatsapp_webhook: texto(body?.whatsapp_webhook),
    // identidade da marca, usada no criativo (rodapé e paleta da peça)
    telefone: texto(body?.telefone),
    cor_primaria: texto(body?.cor_primaria),
    cor_destaque: texto(body?.cor_destaque),
  };
  if (!dados.nome) return { erro: 'nome é obrigatório' };
  if (dados.conta_id && /\s/.test(dados.conta_id)) return { erro: 'conta_id não pode ter espaços' };
  if (dados.abrangencia && !ABRANGENCIAS.includes(dados.abrangencia)) return { erro: 'abrangência deve ser local, regional ou nacional' };
  if (dados.perfil && dados.perfil.length > LIMITE_PERFIL)
    return { erro: `perfil passa de ${LIMITE_PERFIL} caracteres — documentos longos vão pelo upload` };
  if (dados.orientacoes && dados.orientacoes.length > LIMITE_ORIENTACOES)
    return { erro: `orientações passam de ${LIMITE_ORIENTACOES} caracteres — seja direto; contexto longo vai no perfil ou no upload` };

  if (dados.instagram) {
    // aceita "@feeling", "feeling" ou a URL do perfil; guarda só o handle
    const handle = dados.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
    if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return { erro: 'Instagram inválido — use o @ do perfil (ex.: @feelingagencia)' };
    dados.instagram = handle;
  }
  if (dados.site) {
    const url = /^https?:\/\//i.test(dados.site) ? dados.site : `https://${dados.site}`;
    try {
      if (!new URL(url).hostname.includes('.')) throw new Error();
    } catch {
      return { erro: 'site inválido (ex.: www.cliente.com.br)' };
    }
    dados.site = url;
  }
  if (dados.whatsapp_webhook && !/^https:\/\/[^\s]+$/i.test(dados.whatsapp_webhook)) return { erro: 'webhook do WhatsApp deve ser uma URL https' };
  for (const campo of ['cor_primaria', 'cor_destaque']) {
    if (!dados[campo]) continue;
    const hex = dados[campo].trim().replace(/^#?/, '#');
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return { erro: `${campo === 'cor_primaria' ? 'cor principal' : 'cor de destaque'} deve ser um hexadecimal de 6 dígitos (ex.: #12203a)` };
    dados[campo] = hex.toLowerCase();
  }
  if (dados.telefone) {
    const d = dados.telefone.replace(/\D/g, '');
    if (d.length < 10 || d.length > 13) return { erro: 'telefone deve ter DDD + número (ex.: 37 99999-0000)' };
    const n = d.replace(/^55/, '');
    dados.telefone = `(${n.slice(0, 2)}) ${n.length > 10 ? `${n.slice(2, 7)}-${n.slice(7)}` : `${n.slice(2, 6)}-${n.slice(6)}`}`;
  }
  if (dados.google_ads_id) {
    const digitos = dados.google_ads_id.replace(/\D/g, '');
    if (digitos.length !== 10) return { erro: 'ID do Google Ads tem 10 dígitos (ex.: 123-456-7890)' };
    dados.google_ads_id = `${digitos.slice(0, 3)}-${digitos.slice(3, 6)}-${digitos.slice(6)}`;
  }
  return { dados };
}

const VALORES = (d) => [d.nome, d.setor, d.cidade, d.conta_id, d.perfil, d.instagram, d.site, d.google_ads_id, d.orientacoes, d.abrangencia, d.whatsapp_ativo, d.whatsapp_webhook, d.telefone, d.cor_primaria, d.cor_destaque];

function responderErro(res, e) {
  if (e.code === '23505') return res.status(409).json({ erro: 'já existe um cliente com esse nome' });
  if (e.code === '22P02') return res.status(404).json({ erro: 'cliente não encontrado' }); // id não numérico
  console.error(e);
  res.status(500).json({ erro: e.message });
}

router.get('/clientes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nome, setor, cidade FROM clientes ORDER BY nome'
    );
    res.json(rows);
  } catch (e) {
    responderErro(res, e);
  }
});

router.get('/clientes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT ${CAMPOS} FROM clientes WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: 'cliente não encontrado' });
    res.json(rows[0]);
  } catch (e) {
    responderErro(res, e);
  }
});

router.post('/clientes', async (req, res) => {
  const { dados, erro } = lerCliente(req.body);
  if (erro) return res.status(400).json({ erro });
  try {
    const { rows } = await pool.query(
      `INSERT INTO clientes (nome, setor, cidade, conta_id, perfil, instagram, site, google_ads_id, orientacoes, abrangencia, whatsapp_ativo, whatsapp_webhook, telefone, cor_primaria, cor_destaque)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${CAMPOS}`,
      VALORES(dados)
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    responderErro(res, e);
  }
});

router.put('/clientes/:id', async (req, res) => {
  const { dados, erro } = lerCliente(req.body);
  if (erro) return res.status(400).json({ erro });
  try {
    const { rows } = await pool.query(
      `UPDATE clientes SET nome=$1, setor=$2, cidade=$3, conta_id=$4, perfil=$5,
         instagram=$6, site=$7, google_ads_id=$8, orientacoes=$9, abrangencia=$10, whatsapp_ativo=$11, whatsapp_webhook=$12,
         telefone=$13, cor_primaria=$14, cor_destaque=$15
       WHERE id = $16 RETURNING ${CAMPOS}`,
      [...VALORES(dados), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'cliente não encontrado' });
    res.json(rows[0]);
  } catch (e) {
    responderErro(res, e);
  }
});

// Resumo do que seria apagado junto com o cliente — a tela mostra antes de confirmar.
router.get('/clientes/:id/resumo-exclusao', async (req, res) => {
  try {
    const docs = await pool.query('SELECT count(*)::int AS n FROM documentos_gerados WHERE cliente_id = $1', [req.params.id]);
    const anexos = await pool.query(
      "SELECT count(DISTINCT metadata->>'titulo')::int AS arquivos, count(*)::int AS chunks FROM cerebro WHERE metadata->>'cliente_id' = $1",
      [String(req.params.id)]
    );
    res.json({ documentos: docs.rows[0].n, anexos: anexos.rows[0].arquivos, chunks: anexos.rows[0].chunks });
  } catch (e) {
    responderErro(res, e);
  }
});

// Apaga o cliente e tudo que é dele: documentos gerados (+ PDFs) e o que foi anexado ao cérebro.
router.delete('/clientes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const cliente = await pool.query('SELECT id FROM clientes WHERE id = $1', [id]);
    if (!cliente.rows.length) return res.status(404).json({ erro: 'cliente não encontrado' });

    const docs = await pool.query('DELETE FROM documentos_gerados WHERE cliente_id = $1 RETURNING caminho', [id]);
    for (const d of docs.rows) await apagarPdf(d.caminho);
    const chunks = await pool.query("DELETE FROM cerebro WHERE metadata->>'cliente_id' = $1", [String(id)]);
    await pool.query('DELETE FROM clientes WHERE id = $1', [id]);
    res.json({ ok: true, documentos: docs.rowCount, chunks: chunks.rowCount });
  } catch (e) {
    responderErro(res, e);
  }
});

// Registra o que foi aplicado/descartado de uma sugestão extraída de um anexo (a alteração é o PUT /clientes/:id).
router.patch('/clientes/:id/sugestoes/:sid', async (req, res) => {
  const aplicadas = Array.isArray(req.body?.aplicadas) ? req.body.aplicadas.filter((x) => typeof x === 'string') : null;
  const descartar = req.body?.descartar === true;
  if (!aplicadas && !descartar) return res.status(400).json({ erro: 'informe aplicadas (lista) ou descartar: true' });
  try {
    const { rows } = await pool.query("SELECT COALESCE(extras, '{}'::jsonb) AS extras FROM clientes WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: 'cliente não encontrado' });
    const extras = rows[0].extras;
    const lista = Array.isArray(extras.sugestoes) ? extras.sugestoes : [];
    const i = lista.findIndex((x) => x.id === req.params.sid);
    if (i < 0) return res.status(404).json({ erro: 'sugestão não encontrada' });
    if (descartar) lista.splice(i, 1); else lista[i] = { ...lista[i], aplicadas };
    await pool.query('UPDATE clientes SET extras = $2 WHERE id = $1', [req.params.id, JSON.stringify({ ...extras, sugestoes: lista })]);
    res.json({ ok: true, sugestoes: lista });
  } catch (e) {
    responderErro(res, e);
  }
});

// Logo do cliente (PNG com fundo transparente é o ideal; SVG também serve).
router.post('/clientes/:id/logo', (req, res) => {
  uploadLogo(req, res, async (erroUpload) => {
    if (erroUpload) return res.status(400).json({ erro: erroUpload.code === 'LIMIT_FILE_SIZE' ? 'logo maior que 4 MB' : 'upload inválido' });
    if (!req.file) return res.status(400).json({ erro: 'nenhum arquivo enviado (campo "arquivo")' });
    if (!LOGO_MIMES.includes(req.file.mimetype)) return res.status(400).json({ erro: 'envie o logo em PNG, JPG, WEBP ou SVG' });
    try {
      const { rows } = await pool.query('SELECT id FROM clientes WHERE id = $1', [req.params.id]);
      if (!rows.length) return res.status(404).json({ erro: 'cliente não encontrado' });
      await pool.query("DELETE FROM arquivos WHERE cliente_id = $1 AND tipo = 'logo'", [req.params.id]);
      const token = crypto.randomBytes(12).toString('hex');
      const nome = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      const ins = await pool.query(
        "INSERT INTO arquivos (cliente_id, tipo, nome, mime, token, dados) VALUES ($1,'logo',$2,$3,$4,$5) RETURNING id, token",
        [req.params.id, nome, req.file.mimetype, token, req.file.buffer]
      );
      res.status(201).json({ logo_arquivo_id: ins.rows[0].id, logo_token: ins.rows[0].token });
    } catch (e) { responderErro(res, e); }
  });
});

router.delete('/clientes/:id/logo', async (req, res) => {
  try {
    const r = await pool.query("DELETE FROM arquivos WHERE cliente_id = $1 AND tipo = 'logo'", [req.params.id]);
    res.json({ ok: true, removidos: r.rowCount });
  } catch (e) { responderErro(res, e); }
});

module.exports = router;
