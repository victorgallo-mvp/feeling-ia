// src/rotas/criativos.js
// Criativos: contexto -> a IA lê o material do cliente e MONTA 3 peças (copy + composição de blocos) -> a pessoa
// edita e aprova as que quiser -> foto só quando a composição pede -> render da peça (cockpit, motor de blocos).
// Não existe modelo por caso: existe catálogo de blocos, e a IA escolhe os do caso. Marca e contato vêm da ficha.
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const router = express.Router();
const { pool } = require('../servicos/db');
const { montarPecas, FORMATOS } = require('../servicos/peca');

const OBJETIVOS = ['vendas', 'mensagens', 'leads', 'reconhecimento'];
const FORMATOS_PEDIDO = ['feed', 'stories', 'ambos'];
const MAX_FOTOS = 3;
const TEMPO_MAXIMO_MIN = 10;
const COPIES_POR_RODADA = 3;
const IMAGENS_POR_COPY = 2;
// Material que alimenta a copy, na ordem em que entra no prompt, com o corte de cada um.
const MATERIAL = [
  { tipo: 'briefing', rotulo: 'Briefing do cliente', limite: 6000 },
  { tipo: 'analise', rotulo: 'Análise de presença digital', limite: 6000 },
  { tipo: 'reuniao', rotulo: 'Resumo de reunião', limite: 6000 },
  { tipo: 'pesquisa', rotulo: 'Pesquisa de mercado', limite: 9000 },
];

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

// Resposta pública do criativo: troca ids de arquivo por URLs e esconde o token do callback.
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
  const { rows } = await pool.query(
    `SELECT id, nome, perfil, orientacoes, cidade, telefone, cor_primaria, cor_destaque, abrangencia,
            (SELECT id FROM arquivos a WHERE a.cliente_id = clientes.id AND a.tipo = 'logo' ORDER BY a.id DESC LIMIT 1) AS logo_id
       FROM clientes WHERE id = $1`, [id]);
  return rows[0] || null;
}

// Identidade da marca para a peça: logo em data URL + paleta + contato do rodapé.
async function marcaDe(cliente) {
  let logo = '';
  if (cliente.logo_id) {
    const { rows } = await pool.query('SELECT mime, dados FROM arquivos WHERE id = $1', [cliente.logo_id]);
    if (rows.length) logo = `data:${rows[0].mime};base64,${rows[0].dados.toString('base64')}`;
  }
  return {
    logo, cor_primaria: cliente.cor_primaria || null, cor_destaque: cliente.cor_destaque || null,
    rodape: {
      whatsapp: cliente.telefone || '',
      cidade: cliente.cidade || '',
      abrangencia: cliente.abrangencia === 'local' ? '' : (cliente.cidade ? 'Atendemos toda a região' : ''),
    },
  };
}

// Junta o material do cliente que já está no cockpit: o documento mais recente de cada tipo.
// Os anexos do cliente ficam no cérebro e são consultados pelo n8n (busca semântica pelo produto do criativo).
async function materialDoCliente(clienteId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (tipo) tipo, criado_em, markdown
       FROM documentos_gerados
      WHERE cliente_id = $1 AND estado = 'ok' AND markdown IS NOT NULL AND tipo = ANY($2)
      ORDER BY tipo, criado_em DESC`,
    [clienteId, MATERIAL.map((m) => m.tipo)]
  );
  const material = [];
  for (const m of MATERIAL) {
    const d = rows.find((r) => r.tipo === m.tipo);
    if (!d) continue;
    material.push({
      tipo: m.tipo, rotulo: m.rotulo,
      data: new Date(d.criado_em).toISOString().slice(0, 10),
      texto: String(d.markdown).slice(0, m.limite),
      cortado: String(d.markdown).length > m.limite,
    });
  }
  return material;
}

// Dispara a escrita da copy no n8n (assíncrono: o n8n responde {aceito:true} e chama o callback depois).
async function pedirCopy(req, criativo, cliente, feedback = '') {
  const url = process.env.N8N_WEBHOOK_CRIATIVO_COPY;
  if (!url) throw new Error('N8N_WEBHOOK_CRIATIVO_COPY não configurado');
  const token = crypto.randomBytes(16).toString('hex');
  await atualizar(criativo.id, { estado: 'copy_gerando', erro: null, callback_token: token });
  const base = urlPublica(req);
  const { fotos: _f, ...contexto } = criativo.contexto || {};
  const material = await materialDoCliente(cliente.id);
  const anteriores = (criativo.copy?.versoes || []).map((v) => v.headline).filter(Boolean).slice(0, 6);
  const resp = await axios.post(url, {
    criativo_id: criativo.id, cliente_id: cliente.id, cliente_nome: cliente.nome,
    perfil: cliente.perfil || '', orientacoes: cliente.orientacoes || '',
    cidade: cliente.cidade || '', telefone: cliente.telefone || '',
    fotos: (criativo.contexto?.fotos || []).map((f) => f.nome),
    contexto, material, quantidade: COPIES_POR_RODADA, feedback, headlines_anteriores: anteriores,
    callback_url: `${base}/api/criativos/${criativo.id}/copy/concluir`, callback_token: token,
  }, { timeout: 30000, headers: { 'Content-Type': 'application/json' } });
  if (!resp.data?.aceito) throw new Error('o n8n não aceitou o pedido de copy');
}

// Dispara a geração de imagens de UMA copy aprovada (uma chamada por versão; cada uma chama o callback).
async function pedirImagensDaVersao(base, criativo, cliente, versao, { feedback = '' } = {}) {
  const url = process.env.N8N_WEBHOOK_CRIATIVO_IMAGEM;
  if (!url) throw new Error('N8N_WEBHOOK_CRIATIVO_IMAGEM não configurado');
  const fotos = (criativo.contexto?.fotos || []).map((f) => `${base}/api/arquivos/${f.arquivo_id}/${f.token}`);
  const { fotos: _f, ...contexto } = criativo.contexto || {};
  const resp = await axios.post(url, {
    criativo_id: criativo.id, versao_id: versao.id, cliente_id: cliente.id, cliente_nome: cliente.nome,
    perfil: cliente.perfil || '', orientacoes: cliente.orientacoes || '',
    contexto, fotos, quantidade: IMAGENS_POR_COPY, feedback,
    copy: { angulo: versao.angulo, headline: versao.headline, texto: versao.texto, cta: versao.cta, direcao_imagem: versao.direcao_imagem },
    callback_url: `${base}/api/criativos/${criativo.id}/imagens/concluir`, callback_token: criativo.callback_token,
  }, { timeout: 30000, headers: { 'Content-Type': 'application/json' } });
  if (!resp.data?.aceito) throw new Error(`o n8n não aceitou o pedido de imagem da versão ${versao.id}`);
}

// POST /clientes/:id/criativos — multipart: campos do contexto + fotos[] (opcional). Começa pela copy.
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
        `INSERT INTO criativos (cliente_id, titulo, estado, contexto) VALUES ($1,$2,'copy_gerando',$3) RETURNING id`,
        [cliente.id, titulo, JSON.stringify(contexto)]
      );
      const id = ins.rows[0].id;
      for (const f of req.files || []) {
        if (!/^image\/(png|jpe?g|webp)$/i.test(f.mimetype)) continue;
        const a = await salvarArquivo(id, 'foto', Buffer.from(f.originalname, 'latin1').toString('utf8'), f.mimetype, f.buffer);
        contexto.fotos.push({ arquivo_id: a.id, token: a.token, nome: f.originalname });
      }
      await atualizar(id, { contexto });
      try { await pedirCopy(req, await buscarCriativo(id), cliente); }
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
       WHERE cliente_id = $1 AND estado IN ('copy_gerando','imagem_gerando') AND atualizado_em < now() - interval '${TEMPO_MAXIMO_MIN} minutes'`, [req.params.id]);
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

const conferirToken = (c, req) => {
  const token = req.get('x-cockpit-token') || req.body?.callback_token;
  return !!c.callback_token && token === c.callback_token;
};

// Callback do n8n com as versões de copy.
router.post('/criativos/:id/copy/concluir', async (req, res) => {
  try {
    const c = await buscarCriativo(req.params.id);
    if (!c) return res.status(404).json({ erro: 'criativo não encontrado' });
    if (!conferirToken(c, req)) return res.status(403).json({ erro: 'token inválido' });
    const b = req.body || {};
    const rodada = c.rodada || 1;
    const versoes = (Array.isArray(b.versoes) ? b.versoes : []).slice(0, 5).map((v, i) => ({
      id: `r${rodada}v${i + 1}`,
      angulo: texto(v.angulo, 60) || `versão ${i + 1}`,
      headline: texto(v.headline, 80), texto: texto(v.texto, 200), cta: texto(v.cta, 30),
      legenda: texto(v.legenda, 1200), racional: texto(v.racional, 400), direcao_imagem: texto(v.direcao_imagem, 500),
      // a IA monta a peça escolhendo blocos do catálogo; `slots` são as fotos que essa composição pede (0 ou 1)
      peca: v.peca && Array.isArray(v.peca.blocos) ? { blocos: v.peca.blocos } : null,
      slots: Array.isArray(v.slots) ? v.slots.slice(0, 2) : [],
      aprovada: false, editada: false, rodada,
    })).filter((v) => v.headline);
    if (!versoes.length) {
      await atualizar(c.id, { estado: 'erro', erro: String(b.erro || 'o n8n não devolveu versões de copy').slice(0, 400), callback_token: null });
      return res.json({ ok: true });
    }
    const fontes = Array.isArray(b.fontes) ? b.fontes.slice(0, 12).map((f) => texto(f, 120)).filter(Boolean) : [];
    await atualizar(c.id, {
      copy: { rodada, versoes: [...(c.copy?.versoes || []).filter((v) => v.rodada !== rodada), ...versoes], fontes },
      estado: 'copy_pendente', erro: null,
    });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ erro: e.message }); }
});

// Novas versões de copy, com feedback (nova rodada; as anteriores ficam no histórico).
router.post('/criativos/:id/copy/refazer', async (req, res) => {
  try {
    const c = await buscarCriativo(req.params.id);
    if (!c) return res.status(404).json({ erro: 'criativo não encontrado' });
    if (c.estado === 'copy_gerando') return res.status(409).json({ erro: 'ainda escrevendo' });
    const cliente = await clienteDe(c.cliente_id);
    await atualizar(c.id, { rodada: (c.rodada || 1) + 1 });
    await pedirCopy(req, await buscarCriativo(c.id), cliente, texto(req.body?.feedback, 600));
    res.status(202).json(apresentar(await buscarCriativo(c.id), urlPublica(req)));
  } catch (e) { console.error(e); await atualizar(req.params.id, { estado: 'erro', erro: e.message }).catch(() => {}); res.status(502).json({ erro: e.message }); }
});

// Editar uma versão de copy à mão (a pessoa manda o texto final).
router.put('/criativos/:id/copy/:versaoId', async (req, res) => {
  try {
    const c = await buscarCriativo(req.params.id);
    if (!c) return res.status(404).json({ erro: 'criativo não encontrado' });
    const b = req.body || {};
    let achou = false;
    const versoes = (c.copy?.versoes || []).map((v) => {
      if (v.id !== req.params.versaoId) return v;
      achou = true;
      const nova = {
        ...v,
        headline: texto(b.headline, 80) || v.headline,
        texto: b.texto === '' ? '' : (texto(b.texto, 200) || v.texto),
        cta: b.cta === '' ? '' : (texto(b.cta, 30) || v.cta),
        legenda: b.legenda === '' ? '' : (texto(b.legenda, 1200) || v.legenda),
      };
      nova.editada = nova.headline !== v.headline || nova.texto !== v.texto || nova.cta !== v.cta || nova.legenda !== v.legenda || v.editada;
      return nova;
    });
    if (!achou) return res.status(404).json({ erro: 'versão de copy não encontrada' });
    await atualizar(c.id, { copy: { ...(c.copy || {}), versoes } });
    res.json(apresentar(await buscarCriativo(c.id), urlPublica(req)));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Aprovar as copies escolhidas -> pede as imagens de cada uma (uma chamada por versão).
router.post('/criativos/:id/copy/aprovar', async (req, res) => {
  try {
    const c = await buscarCriativo(req.params.id);
    if (!c) return res.status(404).json({ erro: 'criativo não encontrado' });
    const pedidas = Array.isArray(req.body?.versoes) ? req.body.versoes.map(String) : [];
    if (!pedidas.length) return res.status(400).json({ erro: 'marque ao menos uma versão de copy' });
    const versoes = (c.copy?.versoes || []).map((v) => ({ ...v, aprovada: pedidas.includes(String(v.id)) }));
    const aprovadas = versoes.filter((v) => v.aprovada);
    if (!aprovadas.length) return res.status(404).json({ erro: 'nenhuma das versões marcadas existe neste criativo' });

    const cliente = await clienteDe(c.cliente_id);
    const token = crypto.randomBytes(16).toString('hex');
    // Imagens de versões que saíram da seleção são descartadas; as que já têm imagem não geram de novo
    // (assim dá para voltar aqui e acrescentar um ângulo sem refazer o que estava aprovado).
    const imagens = (c.imagens || []).filter((i) => pedidas.includes(String(i.versao_id)));
    // só pede foto para a versão cuja peça pede foto: composição só de texto e ícone vai direto para a arte
    const temFotoDoUsuario = (c.contexto?.fotos || []).length > 0;
    const pendentes = aprovadas.filter((v) => (v.slots || []).length > 0 && !temFotoDoUsuario && !imagens.some((i) => i.versao_id === v.id));
    await atualizar(c.id, {
      copy: { ...(c.copy || {}), versoes }, imagens,
      estado: pendentes.length ? 'imagem_gerando' : 'arte_pendente',
      erro: null, callback_token: pendentes.length ? token : null,
    });
    if (!pendentes.length) return res.json(apresentar(await buscarCriativo(c.id), urlPublica(req)));

    const criativo = await buscarCriativo(c.id);
    const base = urlPublica(req);
    const falhas = [];
    for (const v of pendentes) {
      try { await pedirImagensDaVersao(base, criativo, cliente, v); }
      catch (e) { falhas.push(`${v.angulo}: ${e.message}`); }
    }
    if (falhas.length === pendentes.length) await atualizar(c.id, { estado: 'erro', erro: falhas.join(' | ').slice(0, 400) });
    else if (falhas.length) await atualizar(c.id, { erro: `algumas versões falharam — ${falhas.join(' | ')}`.slice(0, 400) });
    res.status(202).json(apresentar(await buscarCriativo(c.id), urlPublica(req)));
  } catch (e) { console.error(e); res.status(502).json({ erro: e.message }); }
});

// Callback do n8n com as imagens em base64 de UMA versão de copy.
router.post('/criativos/:id/imagens/concluir', async (req, res) => {
  try {
    const c = await buscarCriativo(req.params.id);
    if (!c) return res.status(404).json({ erro: 'criativo não encontrado' });
    if (!conferirToken(c, req)) return res.status(403).json({ erro: 'token inválido' });
    const b = req.body || {};
    const versaoId = texto(b.versao_id, 20);
    const versoes = c.copy?.versoes || [];
    const versao = versoes.find((v) => String(v.id) === versaoId) || versoes.find((v) => v.aprovada);
    if (!versao) return res.status(400).json({ erro: 'versao_id não corresponde a nenhuma copy aprovada' });

    const novas = [];
    for (const img of Array.isArray(b.imagens) ? b.imagens.slice(0, 4) : []) {
      if (!img?.base64) continue;
      const dados = Buffer.from(String(img.base64).replace(/^data:[^,]+,/, ''), 'base64');
      if (dados.length < 1000) continue;
      const a = await salvarArquivo(c.id, 'imagem', `${versao.id}-${novas.length + 1}.png`, img.mime || 'image/png', dados);
      novas.push({ versao_id: versao.id, arquivo_id: a.id, token: a.token, prompt: img.prompt || b.prompt || '', escolhida: false, rodada: c.rodada || 1, criado_em: new Date().toISOString() });
    }
    const imagens = [...(c.imagens || []), ...novas];
    const aprovadas = versoes.filter((v) => v.aprovada);
    const prontas = aprovadas.filter((v) => imagens.some((i) => i.versao_id === v.id)).length;
    const patch = { imagens };
    if (!novas.length && !imagens.some((i) => i.versao_id === versao.id)) {
      patch.erro = `${versao.angulo}: ${String(b.erro || 'o n8n não devolveu imagens').slice(0, 200)}`;
    }
    // Só sai de "gerando" quando todas as copies aprovadas tiverem imagem (ou o tempo máximo estourar).
    if (prontas >= aprovadas.length) {
      const precisaEscolher = aprovadas.some((v) => imagens.filter((i) => i.versao_id === v.id).length > 1);
      patch.estado = precisaEscolher ? 'imagem_pendente' : 'arte_pendente';
      patch.callback_token = null;
    }
    await atualizar(c.id, patch);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ erro: e.message }); }
});

// Refazer as imagens de uma versão (com feedback).
router.post('/criativos/:id/imagens/refazer', async (req, res) => {
  try {
    const c = await buscarCriativo(req.params.id);
    if (!c) return res.status(404).json({ erro: 'criativo não encontrado' });
    if (c.estado === 'imagem_gerando') return res.status(409).json({ erro: 'ainda gerando' });
    const versao = (c.copy?.versoes || []).find((v) => String(v.id) === String(req.body?.versao_id) && v.aprovada);
    if (!versao) return res.status(400).json({ erro: 'informe a versão de copy aprovada que quer refazer' });
    const cliente = await clienteDe(c.cliente_id);
    const token = crypto.randomBytes(16).toString('hex');
    const imagens = (c.imagens || []).filter((i) => i.versao_id !== versao.id);
    await atualizar(c.id, { imagens, estado: 'imagem_gerando', erro: null, callback_token: token });
    await pedirImagensDaVersao(urlPublica(req), await buscarCriativo(c.id), cliente, versao, { feedback: texto(req.body?.feedback, 600) });
    res.status(202).json(apresentar(await buscarCriativo(c.id), urlPublica(req)));
  } catch (e) { console.error(e); await atualizar(req.params.id, { estado: 'erro', erro: e.message }).catch(() => {}); res.status(502).json({ erro: e.message }); }
});

// Escolher a imagem de uma versão (uma por versão de copy).
router.post('/criativos/:id/imagens/:arquivoId/escolher', async (req, res) => {
  try {
    const c = await buscarCriativo(req.params.id);
    if (!c) return res.status(404).json({ erro: 'criativo não encontrado' });
    const alvo = (c.imagens || []).find((i) => String(i.arquivo_id) === String(req.params.arquivoId));
    if (!alvo) return res.status(404).json({ erro: 'imagem não encontrada neste criativo' });
    const imagens = (c.imagens || []).map((i) => (i.versao_id === alvo.versao_id ? { ...i, escolhida: String(i.arquivo_id) === String(req.params.arquivoId) } : i));
    await atualizar(c.id, { imagens });
    res.json(apresentar(await buscarCriativo(c.id), urlPublica(req)));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Montar as artes: renderiza a PEÇA que a IA montou (blocos) para cada copy aprovada, em cada formato pedido.
// O cockpit só compõe: paleta e logo vêm da ficha do cliente, telefone e cidade entram no rodapé.
router.post('/criativos/:id/artes', async (req, res) => {
  try {
    const c = await buscarCriativo(req.params.id);
    if (!c) return res.status(404).json({ erro: 'criativo não encontrado' });
    const aprovadas = (c.copy?.versoes || []).filter((v) => v.aprovada);
    if (!aprovadas.length) return res.status(409).json({ erro: 'aprove ao menos uma copy antes' });
    const semPeca = aprovadas.filter((v) => !v.peca?.blocos?.length);
    if (semPeca.length) return res.status(409).json({ erro: `a versão "${semPeca[0].angulo}" veio sem peça montada — gere as copies de novo` });

    const cliente = await clienteDe(c.cliente_id);
    const marca = await marcaDe(cliente);
    const pedido = c.contexto?.formato || 'ambos';
    const formatos = pedido === 'ambos' ? ['feed', 'stories'] : [pedido];
    await atualizar(c.id, { estado: 'arte_gerando', erro: null });

    // imagens disponíveis: a foto que a pessoa enviou tem prioridade sobre a que a IA gerou
    const fotosEnviadas = c.contexto?.fotos || [];
    const dataUrl = async (arquivoId) => {
      const { rows } = await pool.query('SELECT mime, dados FROM arquivos WHERE id = $1', [arquivoId]);
      return rows.length ? `data:${rows[0].mime};base64,${rows[0].dados.toString('base64')}` : '';
    };

    const pecas = [];
    for (const v of aprovadas) {
      // preenche o rodapé que a IA montou com o contato real do cliente
      const blocos = v.peca.blocos.map((b) => (b.tipo === 'rodape' ? { ...b, ...marca.rodape } : b));
      // cada slot da peça recebe a imagem escolhida da versão, ou a foto que a pessoa enviou
      const imagens = {};
      const slots = (v.slots || []).map((x) => x.slot).filter(Boolean);
      if (slots.length) {
        const daVersao = (c.imagens || []).filter((i) => i.versao_id === v.id);
        const escolhida = daVersao.find((i) => i.escolhida) || daVersao[0] || null;
        const fonte = escolhida ? escolhida.arquivo_id : (fotosEnviadas[0]?.arquivo_id || null);
        if (fonte) { const url = await dataUrl(fonte); for (const slot of slots) imagens[slot] = url; }
      }
      for (const formato of formatos) {
        pecas.push({ chave: v.id, spec: { formato, blocos }, imagens, marca, cliente: cliente.nome });
      }
    }

    const feitas = await montarPecas(pecas);
    const registros = [];
    for (const a of feitas) {
      const versao = aprovadas.find((v) => v.id === a.chave);
      const nome = `${cliente.nome} - ${c.titulo} - ${versao?.angulo || a.chave} - ${a.formato}.png`.replace(/[\\/:*?"<>|]/g, '-');
      const arq = await salvarArquivo(c.id, 'arte', nome, 'image/png', a.png);
      registros.push({
        versao_id: a.chave, angulo: versao?.angulo || '', formato: a.formato, escala: a.escala,
        arquivo_id: arq.id, token: arq.token, largura: FORMATOS[a.formato].largura, altura: FORMATOS[a.formato].altura,
        criado_em: new Date().toISOString(),
      });
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
