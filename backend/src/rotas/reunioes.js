// src/rotas/reunioes.js
// Transcrição de reunião -> n8n resume -> vira documento "reuniao" (PDF + markdown), entra no cérebro
// como resumo (a transcrição bruta fica guardada mas NÃO é indexada) e devolve sugestões de cadastro.
const path = require('path');
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { pool } = require('../servicos/db');
const { resumirReuniaoViaN8n, anexarViaN8n } = require('../servicos/n8n');
const { extrairTexto } = require('../servicos/texto');
const { markdownParaPdf } = require('../servicos/pdf');
const { salvarPdf, salvarArquivo, lerPdf } = require('../servicos/storage');

const EXTENSOES = ['.txt', '.md', '.docx', '.pdf'];
const LIMITE_MB = 25;
const MIN_CHARS = 300; // transcrição menor que isso quase sempre é arquivo errado

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITE_MB * 1024 * 1024, files: 1 },
}).single('arquivo');

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);

router.post('/clientes/:id/reunioes', (req, res) => {
  upload(req, res, async (erroUpload) => {
    if (erroUpload) {
      const grande = erroUpload.code === 'LIMIT_FILE_SIZE';
      return res.status(grande ? 413 : 400).json({ erro: grande ? `arquivo maior que ${LIMITE_MB} MB` : 'upload inválido: envie a transcrição no campo "arquivo"' });
    }
    if (!req.file) return res.status(400).json({ erro: 'nenhum arquivo enviado (campo "arquivo")' });
    const nome = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    if (!EXTENSOES.includes(path.extname(nome).toLowerCase()))
      return res.status(400).json({ erro: `formato não aceito — envie ${EXTENSOES.join(', ')}` });

    try {
      const { rows } = await pool.query('SELECT id, nome, conta_id FROM clientes WHERE id = $1', [req.params.id]);
      if (!rows.length) return res.status(404).json({ erro: 'cliente não encontrado' });
      const cliente = rows[0];

      const transcricao = await extrairTexto(req.file.buffer, nome);
      if (transcricao.length < MIN_CHARS)
        return res.status(400).json({ erro: 'não consegui ler uma transcrição nesse arquivo (texto muito curto ou vazio)' });

      const titulo = texto(req.body?.titulo) || nome.replace(/\.[^.]+$/, '');
      const data_reuniao = texto(req.body?.data_reuniao);

      // 1. n8n resume e sugere
      const { markdown, sugestoes } = await resumirReuniaoViaN8n({
        cliente_id: cliente.id, cliente_nome: cliente.nome, conta_id: cliente.conta_id, titulo, data_reuniao, texto: transcricao,
      });

      // 2. documento "reuniao": PDF + markdown + extras; transcrição bruta guardada, não indexada
      const pdf = Buffer.from(await markdownParaPdf(markdown));
      const caminho = await salvarPdf(pdf, cliente.id, 'reuniao');
      const caminhoTranscricao = await salvarArquivo(Buffer.from(transcricao, 'utf8'), `transcricao-${cliente.id}.txt`);
      const extras = { titulo, data_reuniao, transcricao: caminhoTranscricao, arquivo_original: nome, sugestoes, aplicadas: [] };
      const ins = await pool.query(
        `INSERT INTO documentos_gerados (cliente_id, cliente_nome, tipo, caminho, markdown, extras)
         VALUES ($1,$2,'reuniao',$3,$4,$5) RETURNING id, tipo, criado_em`,
        [cliente.id, cliente.nome, caminho, markdown, JSON.stringify(extras)]
      );
      const doc = ins.rows[0];

      // 3. só o resumo vai pro cérebro
      const tituloCerebro = `Reunião${data_reuniao ? ' ' + data_reuniao : ''} — ${titulo}`;
      let indexado = true;
      try {
        await anexarViaN8n(Buffer.from(markdown, 'utf8'), `${tituloCerebro}.txt`, {
          conta_id: cliente.conta_id, cliente_nome: cliente.nome, cliente_id: cliente.id, titulo: tituloCerebro, tipo: 'reuniao',
        });
      } catch (e) {
        console.error('[reunioes] resumo não entrou no cérebro:', e.message);
        indexado = false;
      }

      res.json({
        documento: { ...doc, url_download: `/api/documentos/${doc.id}/download`, estado: 'ok', titulo, data_reuniao },
        sugestoes, indexado,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ erro: e.message });
    }
  });
});

// Registra o que a pessoa aplicou/descartou das sugestões (a alteração do cadastro em si é o PUT /clientes/:id).
router.patch('/documentos/:id/sugestoes', async (req, res) => {
  const aplicadas = Array.isArray(req.body?.aplicadas) ? req.body.aplicadas.filter((x) => typeof x === 'string') : null;
  const descartar = req.body?.descartar === true;
  if (!aplicadas && !descartar) return res.status(400).json({ erro: 'informe aplicadas (lista) ou descartar: true' });
  try {
    const { rows } = await pool.query(
      `UPDATE documentos_gerados
       SET extras = COALESCE(extras, '{}'::jsonb) || $2::jsonb
       WHERE id = $1 AND tipo = 'reuniao' RETURNING extras`,
      [req.params.id, JSON.stringify(descartar ? { sugestoes: null, aplicadas: [] } : { aplicadas })]
    );
    if (!rows.length) return res.status(404).json({ erro: 'reunião não encontrada' });
    res.json({ ok: true, extras: rows[0].extras });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

// Transcrição bruta (texto), pra consulta humana.
router.get('/documentos/:id/transcricao', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT extras FROM documentos_gerados WHERE id = $1 AND tipo = 'reuniao'", [req.params.id]);
    const caminho = rows[0]?.extras?.transcricao;
    if (!caminho) return res.status(404).json({ erro: 'transcrição não encontrada' });
    const txt = await lerPdf(caminho).catch(() => null); // lerPdf lê qualquer arquivo do storage
    if (!txt) return res.status(404).json({ erro: 'arquivo da transcrição não está mais no storage' });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(txt);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
