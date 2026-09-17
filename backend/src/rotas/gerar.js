// src/rotas/gerar.js  (exemplo do passo 1 — só relatório)
const express = require('express');
const router = express.Router();
const { pool } = require('../servicos/db');
const { gerarViaN8n } = require('../servicos/n8n');
const { markdownParaPdf } = require('../servicos/pdf');
const { salvarPdf } = require('../servicos/storage');

router.post('/clientes/:id/gerar/:tipo', async (req, res) => {
  const { id, tipo } = req.params;
  if (!['relatorio', 'pesquisa', 'briefing'].includes(tipo))
    return res.status(400).json({ erro: 'tipo inválido' });

  try {
    const { rows } = await pool.query(
      'SELECT id, nome, conta_id FROM clientes WHERE id = $1', [id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'cliente não encontrado' });
    const cliente = rows[0];

    // 1. n8n faz o trabalho pesado e devolve markdown
    const markdown = await gerarViaN8n(tipo, {
      conta_id: cliente.conta_id, cliente_nome: cliente.nome,
    });

    // 2. markdown -> PDF (visual padrão)
    const pdfBuffer = await markdownParaPdf(markdown);

    // 3. salva e registra
    const caminho = await salvarPdf(pdfBuffer, cliente.id, tipo);
    const ins = await pool.query(
      `INSERT INTO documentos_gerados (cliente_id, cliente_nome, tipo, caminho)
       VALUES ($1,$2,$3,$4) RETURNING id, tipo, criado_em`,
      [cliente.id, cliente.nome, tipo, caminho]
    );
    const doc = ins.rows[0];
    res.json({ ...doc, url_download: `/api/documentos/${doc.id}/download` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
