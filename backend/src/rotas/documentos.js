// src/rotas/documentos.js
const express = require('express');
const router = express.Router();
const { pool } = require('../servicos/db');
const { lerPdf, existePdf, apagarPdf, salvarPdf } = require('../servicos/storage');
const { markdownParaPdf } = require('../servicos/pdf');

// Estado do documento pra tela:
//   ok          -> PDF no storage
//   regeneravel -> PDF sumiu (deploy sem volume) mas o markdown está no banco; o download regenera
//   perdido     -> nem PDF nem markdown
async function estadoDe(doc) {
  if (await existePdf(doc.caminho)) return 'ok';
  return doc.tem_markdown ? 'regeneravel' : 'perdido';
}

const comLinks = (d) => ({ ...d, url_download: `/api/documentos/${d.id}/download` });

router.get('/clientes/:id/documentos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, tipo, criado_em, caminho, (markdown IS NOT NULL) AS tem_markdown,
              extras->>'titulo' AS titulo, extras->>'data_reuniao' AS data_reuniao,
              extras->'sugestoes' AS sugestoes, COALESCE(extras->'aplicadas', '[]'::jsonb) AS aplicadas
       FROM documentos_gerados WHERE cliente_id = $1 ORDER BY criado_em DESC, id DESC`,
      [req.params.id]
    );
    const docs = await Promise.all(rows.map(async ({ caminho, tem_markdown, ...d }) => ({
      ...comLinks(d), estado: await estadoDe({ caminho, tem_markdown }),
    })));
    res.json(docs);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

router.get('/documentos/:id/download', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, cliente_id, cliente_nome, tipo, caminho, criado_em, markdown FROM documentos_gerados WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'documento não encontrado' });
    const doc = rows[0];

    let pdf;
    if (await existePdf(doc.caminho)) {
      pdf = await lerPdf(doc.caminho);
    } else if (doc.markdown) {
      // PDF perdido num deploy: refaz a partir do texto e grava de novo
      pdf = Buffer.from(await markdownParaPdf(doc.markdown)); // Puppeteer devolve Uint8Array; res.send precisa de Buffer
      const caminho = await salvarPdf(pdf, doc.cliente_id, doc.tipo);
      await pool.query('UPDATE documentos_gerados SET caminho = $1 WHERE id = $2', [caminho, doc.id]);
    } else {
      return res.status(404).json({ erro: 'PDF perdido e sem texto salvo — gere o documento de novo' });
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

router.delete('/documentos/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM documentos_gerados WHERE id = $1 RETURNING caminho', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'documento não encontrado' });
    await apagarPdf(rows[0].caminho);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

// Remove de uma vez os documentos do cliente que não têm PDF nem markdown (não há como recuperar).
router.delete('/clientes/:id/documentos/perdidos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, caminho FROM documentos_gerados WHERE cliente_id = $1 AND markdown IS NULL', [req.params.id]
    );
    const perdidos = [];
    for (const d of rows) if (!(await existePdf(d.caminho))) perdidos.push(d.id);
    if (perdidos.length) {
      await pool.query('DELETE FROM documentos_gerados WHERE id = ANY($1::int[])', [perdidos]);
    }
    res.json({ removidos: perdidos.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
