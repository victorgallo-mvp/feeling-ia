// src/rotas/clientes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../servicos/db');

const CAMPOS = 'id, nome, setor, cidade, conta_id, perfil';
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
  };
  if (!dados.nome) return { erro: 'nome é obrigatório' };
  if (dados.conta_id && /\s/.test(dados.conta_id)) return { erro: 'conta_id não pode ter espaços' };
  if (dados.perfil && dados.perfil.length > LIMITE_PERFIL)
    return { erro: `perfil passa de ${LIMITE_PERFIL} caracteres — documentos longos vão pelo upload` };
  return { dados };
}

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
      `INSERT INTO clientes (nome, setor, cidade, conta_id, perfil)
       VALUES ($1,$2,$3,$4,$5) RETURNING ${CAMPOS}`,
      [dados.nome, dados.setor, dados.cidade, dados.conta_id, dados.perfil]
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
      `UPDATE clientes SET nome=$1, setor=$2, cidade=$3, conta_id=$4, perfil=$5
       WHERE id = $6 RETURNING ${CAMPOS}`,
      [dados.nome, dados.setor, dados.cidade, dados.conta_id, dados.perfil, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'cliente não encontrado' });
    res.json(rows[0]);
  } catch (e) {
    responderErro(res, e);
  }
});

module.exports = router;
