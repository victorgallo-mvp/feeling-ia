// src/rotas/gerar.js
// Geração assíncrona: cria o documento como "gerando", dispara o n8n e responde na hora.
// O n8n chama POST /api/documentos/:id/concluir quando termina (com o token do documento).
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { pool } = require('../servicos/db');
const { gerarViaN8n, tiposConfigurados } = require('../servicos/n8n');
const { markdownParaPdf } = require('../servicos/pdf');
const { salvarPdf } = require('../servicos/storage');

const TEMPO_MAXIMO_MIN = 12; // sem callback depois disso, o documento vira "erro"

router.get('/tipos', (req, res) => res.json(tiposConfigurados()));

// URL pública do cockpit, vista de fora (Railway manda x-forwarded-*). PUBLIC_URL sobrepõe, se definida.
function urlPublica(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}`;
}

// Fecha um documento com o markdown: PDF + storage + estado ok.
async function concluir(docId, markdown) {
  const { rows } = await pool.query('SELECT id, cliente_id, tipo, estado FROM documentos_gerados WHERE id = $1', [docId]);
  if (!rows.length) return null;
  const doc = rows[0];
  if (doc.estado === 'ok') return doc; // callback repetido
  const pdf = Buffer.from(await markdownParaPdf(markdown));
  const caminho = await salvarPdf(pdf, doc.cliente_id, doc.tipo);
  await pool.query(
    `UPDATE documentos_gerados SET caminho = $2, markdown = $3, estado = 'ok', erro = NULL WHERE id = $1`,
    [docId, caminho, markdown]
  );
  return doc;
}

// O n8n perde o detalhe do erro da API quando "continua em caso de erro"; traduz o genérico em algo acionável.
function explicarErro(mensagem) {
  const m = String(mensagem || '');
  if (/bad request/i.test(m)) return 'A chamada ao Claude falhou (Bad request). Causas comuns: limite mensal de gasto da API atingido ou chave inválida — confira em console.anthropic.com → Limits e a execução no n8n.';
  if (/rate limit|429/i.test(m)) return 'A API do Claude recusou por excesso de chamadas (rate limit). Tente de novo em um minuto.';
  if (/timeout|timed out/i.test(m)) return 'O n8n não terminou a tempo (timeout). Tente de novo.';
  return m;
}

async function falhar(docId, mensagem) {
  mensagem = explicarErro(mensagem);
  await pool.query(`UPDATE documentos_gerados SET estado = 'erro', erro = $2 WHERE id = $1 AND estado <> 'ok'`, [docId, String(mensagem).slice(0, 500)]);
}

router.post('/clientes/:id/gerar/:tipo', async (req, res) => {
  const { id, tipo } = req.params;
  const configurados = tiposConfigurados();
  if (!(tipo in configurados) || tipo === 'reuniao') return res.status(400).json({ erro: 'tipo inválido' });
  if (!configurados[tipo]) return res.status(503).json({ erro: 'esse documento ainda não foi ligado no n8n' });

  try {
    const { rows } = await pool.query(
      'SELECT id, nome, conta_id, instagram, site, google_ads_id, COALESCE(whatsapp_ativo, false) AS whatsapp_ativo FROM clientes WHERE id = $1', [id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'cliente não encontrado' });
    const cliente = rows[0];

    // um por tipo por vez: se já tem um gerando desse tipo, devolve ele
    const emAndamento = await pool.query(
      `SELECT id, tipo, criado_em, estado FROM documentos_gerados
       WHERE cliente_id = $1 AND tipo = $2 AND estado = 'gerando' AND criado_em > now() - interval '${TEMPO_MAXIMO_MIN} minutes'`,
      [cliente.id, tipo]
    );
    if (emAndamento.rows.length) {
      const d = emAndamento.rows[0];
      return res.status(202).json({ ...d, url_download: `/api/documentos/${d.id}/download` });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const ins = await pool.query(
      `INSERT INTO documentos_gerados (cliente_id, cliente_nome, tipo, estado, extras)
       VALUES ($1,$2,$3,'gerando',$4) RETURNING id, tipo, criado_em, estado`,
      [cliente.id, cliente.nome, tipo, JSON.stringify({ callback_token: token })]
    );
    const doc = ins.rows[0];
    const resposta = { ...doc, url_download: `/api/documentos/${doc.id}/download` };

    // dispara sem prender a resposta HTTP; o n8n devolve { aceito: true } e chama o callback depois
    const dados = {
      conta_id: cliente.conta_id, cliente_nome: cliente.nome, cliente_id: cliente.id,
      instagram: cliente.instagram, site: cliente.site, google_ads_id: cliente.google_ads_id,
      whatsapp_ativo: cliente.whatsapp_ativo, // a análise interna inclui o resumo comercial quando houver
      documento_id: doc.id,
      callback_url: `${urlPublica(req)}/api/documentos/${doc.id}/concluir`,
      callback_token: token,
    };
    gerarViaN8n(tipo, dados)
      .then(async (r) => { if (r.modo === 'sincrono') await concluir(doc.id, r.markdown); })
      .catch(async (e) => { console.error(`[gerar] ${tipo} doc ${doc.id}:`, e.message); await falhar(doc.id, e.message); });

    res.status(202).json(resposta);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

// Callback do n8n: { markdown } ou { erro }. Autentica pelo token do próprio documento.
router.post('/documentos/:id/concluir', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, estado, extras->>'callback_token' AS token FROM documentos_gerados WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: 'documento não encontrado' });
    const doc = rows[0];
    const token = req.get('x-cockpit-token') || req.body?.callback_token;
    if (!doc.token || token !== doc.token) return res.status(403).json({ erro: 'token inválido' });

    const markdown = req.body?.markdown ?? req.body?.output;
    if (typeof markdown === 'string' && markdown.trim()) {
      await concluir(doc.id, markdown.trim());
      return res.json({ ok: true, estado: 'ok' });
    }
    await falhar(doc.id, req.body?.erro || 'n8n terminou sem markdown');
    res.json({ ok: true, estado: 'erro' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

// Marca como erro o que passou do tempo sem callback (chamado pela listagem).
async function expirarPendentes(clienteId) {
  await pool.query(
    `UPDATE documentos_gerados SET estado = 'erro', erro = 'o n8n não respondeu em ${TEMPO_MAXIMO_MIN} minutos'
     WHERE cliente_id = $1 AND estado = 'gerando' AND criado_em < now() - interval '${TEMPO_MAXIMO_MIN} minutes'`,
    [clienteId]
  );
}

module.exports = router;
module.exports.expirarPendentes = expirarPendentes;
