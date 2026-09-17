// src/rotas/gerar.js
const express = require('express');
const router = express.Router();
const { pool } = require('../servicos/db');
const { gerarViaN8n, tiposConfigurados } = require('../servicos/n8n');
const { markdownParaPdf } = require('../servicos/pdf');
const { salvarPdf } = require('../servicos/storage');

router.get('/tipos', (req, res) => res.json(tiposConfigurados()));

router.post('/clientes/:id/gerar/:tipo', async (req, res) => {
  const { id, tipo } = req.params;
  const configurados = tiposConfigurados();
  if (!(tipo in configurados)) return res.status(400).json({ erro: 'tipo inválido' });
  if (!configurados[tipo]) return res.status(503).json({ erro: 'esse documento ainda não foi ligado no n8n' });

  try {
    const { rows } = await pool.query(
      'SELECT id, nome, conta_id, instagram, site, google_ads_id FROM clientes WHERE id = $1', [id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'cliente não encontrado' });
    const cliente = rows[0];
    if (tipo === 'analise' && !cliente.instagram && !cliente.site)
      return res.status(400).json({ erro: 'preencha o Instagram ou o site do cliente antes de gerar a análise' });

    // 1. n8n faz o trabalho pesado e devolve markdown
    const markdown = await gerarViaN8n(tipo, {
      conta_id: cliente.conta_id, cliente_nome: cliente.nome, cliente_id: cliente.id,
      instagram: cliente.instagram, site: cliente.site, google_ads_id: cliente.google_ads_id,
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
