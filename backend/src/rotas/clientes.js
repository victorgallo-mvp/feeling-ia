// src/rotas/clientes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../servicos/db');
const { apagarPdf } = require('../servicos/storage');

const CAMPOS = 'id, nome, setor, cidade, conta_id, perfil, instagram, site, google_ads_id, orientacoes, abrangencia';
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
  if (dados.google_ads_id) {
    const digitos = dados.google_ads_id.replace(/\D/g, '');
    if (digitos.length !== 10) return { erro: 'ID do Google Ads tem 10 dígitos (ex.: 123-456-7890)' };
    dados.google_ads_id = `${digitos.slice(0, 3)}-${digitos.slice(3, 6)}-${digitos.slice(6)}`;
  }
  return { dados };
}

const VALORES = (d) => [d.nome, d.setor, d.cidade, d.conta_id, d.perfil, d.instagram, d.site, d.google_ads_id, d.orientacoes, d.abrangencia];

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
      `INSERT INTO clientes (nome, setor, cidade, conta_id, perfil, instagram, site, google_ads_id, orientacoes, abrangencia)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${CAMPOS}`,
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
         instagram=$6, site=$7, google_ads_id=$8, orientacoes=$9, abrangencia=$10
       WHERE id = $11 RETURNING ${CAMPOS}`,
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

module.exports = router;
