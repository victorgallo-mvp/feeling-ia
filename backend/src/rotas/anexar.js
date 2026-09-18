// src/rotas/anexar.js
// Recebe um arquivo (multipart, campo "arquivo") e repassa pro webhook de ingestão do n8n.
// Só alimenta o cérebro: não gera PDF nem entra em documentos_gerados.
const path = require('path');
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { pool } = require('../servicos/db');
const { anexarViaN8n } = require('../servicos/n8n');

const EXTENSOES = ['.pdf', '.docx', '.txt']; // o que o workflow de ingestão aceita
const LIMITE_MB = 25;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITE_MB * 1024 * 1024, files: 1 },
}).single('arquivo');

router.post('/clientes/:id/anexar', (req, res) => {
  upload(req, res, async (erroUpload) => {
    if (erroUpload) {
      const grande = erroUpload.code === 'LIMIT_FILE_SIZE';
      return res.status(grande ? 413 : 400).json({
        erro: grande ? `arquivo maior que ${LIMITE_MB} MB` : 'upload inválido: envie um arquivo no campo "arquivo"',
      });
    }
    if (!req.file) return res.status(400).json({ erro: 'nenhum arquivo enviado (campo "arquivo")' });

    // multer lê o nome como latin1; sem isto "relatório.pdf" chega corrompido no n8n
    const nome = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    if (!EXTENSOES.includes(path.extname(nome).toLowerCase()))
      return res.status(400).json({ erro: `formato não aceito — envie ${EXTENSOES.join(', ')}` });

    try {
      const { rows } = await pool.query(
        'SELECT id, nome, conta_id FROM clientes WHERE id = $1', [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ erro: 'cliente não encontrado' });
      const cliente = rows[0];

      await anexarViaN8n(req.file.buffer, nome, {
        conta_id: cliente.conta_id, cliente_nome: cliente.nome, cliente_id: cliente.id, titulo: nome,
      });
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ erro: e.message });
    }
  });
});

module.exports = router;
