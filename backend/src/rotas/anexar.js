// src/rotas/anexar.js
// Recebe um arquivo (multipart, campo "arquivo") e repassa pro webhook de ingestão do n8n.
// Só alimenta o cérebro: não gera PDF nem entra em documentos_gerados.
const path = require('path');
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { pool } = require('../servicos/db');
const crypto = require('crypto');
const { anexarViaN8n, resumirReuniaoViaN8n, tiposConfigurados } = require('../servicos/n8n');
const { extrairTexto } = require('../servicos/texto');

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

      // Opcional (padrão ligado): o mesmo agente das reuniões lê o documento e sugere cadastro.
      let sugestoes = null, aviso = null;
      const extrair = req.body?.extrair !== 'false' && req.body?.extrair !== '0';
      if (extrair && tiposConfigurados().reuniao) {
        try {
          const texto = await extrairTexto(req.file.buffer, nome);
          if (texto.length >= 200) {
            const r = await resumirReuniaoViaN8n({
              cliente_id: cliente.id, cliente_nome: cliente.nome, conta_id: cliente.conta_id, titulo: nome, texto, modo: 'documento',
            });
            sugestoes = r.sugestoes;
            if (sugestoes) {
              const item = { id: crypto.randomBytes(6).toString('hex'), origem: nome, criado_em: new Date().toISOString(), sugestoes, aplicadas: [] };
              await pool.query(
                `UPDATE clientes SET extras = jsonb_set(COALESCE(extras, '{}'::jsonb), '{sugestoes}',
                   COALESCE(extras->'sugestoes', '[]'::jsonb) || $2::jsonb) WHERE id = $1`,
                [cliente.id, JSON.stringify([item])]
              );
              sugestoes = item;
            }
          } else aviso = 'não consegui ler texto suficiente pra sugerir cadastro';
        } catch (e) {
          console.error('[anexar] extração de cadastro falhou:', e.message);
          aviso = 'o arquivo entrou no cérebro, mas a extração de cadastro falhou';
        }
      }
      res.json({ ok: true, sugestoes, aviso });
    } catch (e) {
      console.error(e);
      res.status(500).json({ erro: e.message });
    }
  });
});

// Arquivos deste cliente no cérebro (agrupados pelo título = nome do arquivo).
router.get('/clientes/:id/anexos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT metadata->>'titulo' AS titulo, metadata->>'tipo' AS tipo, count(*)::int AS chunks
       FROM cerebro WHERE metadata->>'cliente_id' = $1
       GROUP BY 1, 2 ORDER BY 1`,
      [String(req.params.id)]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

// Remove do cérebro todos os chunks de um arquivo deste cliente.
router.delete('/clientes/:id/anexos', async (req, res) => {
  const titulo = typeof req.query.titulo === 'string' ? req.query.titulo : '';
  if (!titulo) return res.status(400).json({ erro: 'informe o título do anexo' });
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM cerebro WHERE metadata->>'cliente_id' = $1 AND metadata->>'titulo' = $2",
      [String(req.params.id), titulo]
    );
    if (!rowCount) return res.status(404).json({ erro: 'anexo não encontrado' });
    res.json({ ok: true, chunks: rowCount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
