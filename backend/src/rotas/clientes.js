// src/rotas/clientes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../servicos/db');

const CAMPOS = 'id, nome, setor, cidade, conta_id, perfil, instagram, site, google_ads_id';
const LIMITE_PERFIL = 20000;

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
  };
  if (!dados.nome) return { erro: 'nome é obrigatório' };
  if (dados.conta_id && /\s/.test(dados.conta_id)) return { erro: 'conta_id não pode ter espaços' };
  if (dados.perfil && dados.perfil.length > LIMITE_PERFIL)
    return { erro: `perfil passa de ${LIMITE_PERFIL} caracteres — documentos longos vão pelo upload` };

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

const VALORES = (d) => [d.nome, d.setor, d.cidade, d.conta_id, d.perfil, d.instagram, d.site, d.google_ads_id];

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
      `INSERT INTO clientes (nome, setor, cidade, conta_id, perfil, instagram, site, google_ads_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${CAMPOS}`,
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
         instagram=$6, site=$7, google_ads_id=$8
       WHERE id = $9 RETURNING ${CAMPOS}`,
      [...VALORES(dados), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'cliente não encontrado' });
    res.json(rows[0]);
  } catch (e) {
    responderErro(res, e);
  }
});

module.exports = router;
