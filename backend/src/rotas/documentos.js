// src/rotas/documentos.js
const express = require('express');
const router = express.Router();
const { pool } = require('../servicos/db');
const { lerPdf } = require('../servicos/storage');

router.get('/clientes/:id/documentos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, tipo, criado_em FROM documentos_gerados
       WHERE cliente_id = $1 ORDER BY criado_em DESC, id DESC`,
      [req.params.id]
    );
    res.json(rows.map((d) => ({ ...d, url_download: `/api/documentos/${d.id}/download` })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

router.get('/documentos/:id/download', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, cliente_nome, tipo, caminho, criado_em FROM documentos_gerados WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'documento não encontrado' });
    const doc = rows[0];

    let pdf;
    try {
      pdf = await lerPdf(doc.caminho);
    } catch (e) {
      if (e.code === 'ENOENT') return res.status(404).json({ erro: 'arquivo do PDF não está mais no storage' });
      throw e;
    }

    const data = new Date(doc.criado_em).toISOString().slice(0, 10);
    const nome = `${doc.tipo}-${doc.cliente_nome || 'cliente'}-${data}.pdf`
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\w.-]+/g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(pdf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
