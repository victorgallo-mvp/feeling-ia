// src/rotas/clientes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../servicos/db');

router.get('/clientes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nome, setor, cidade FROM clientes ORDER BY nome'
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

router.get('/clientes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nome, setor, cidade, conta_id FROM clientes WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'cliente não encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
