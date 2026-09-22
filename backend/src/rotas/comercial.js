// src/rotas/comercial.js
// Acompanhamento comercial (WhatsApp): o cockpit só lê a tabela leads_comercial e desenha.
// Quem enche a tabela é o workflow "Classificar Conversas" do n8n (SQL no banco do WhatsApp + Claude),
// disparado daqui por webhook e concluído por callback com token.
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const router = express.Router();
const { pool } = require('../servicos/db');

const ETAPAS = ['novo', 'em_conversa', 'qualificado', 'simulacao_enviada', 'agendou', 'comprou', 'perdido', 'esfriou'];
const ETAPAS_AVANCO = ['qualificado', 'simulacao_enviada', 'agendou', 'comprou']; // "avançou" no funil
// Só clientes listados aqui têm WhatsApp ligado ao cockpit (o workflow lê um banco por cliente).
// Ex.: COMERCIAL_CLIENTE_IDS=33,41
const clientesAtivos = () => String(process.env.COMERCIAL_CLIENTE_IDS || '').split(',').map((x) => Number(x.trim())).filter(Boolean);
const comercialAtivo = (id) => clientesAtivos().includes(Number(id));

function urlPublica(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}`;
}

async function buscarCliente(id) {
  const { rows } = await pool.query(
    "SELECT id, nome, conta_id, COALESCE(extras->'comercial', '{}'::jsonb) AS comercial FROM clientes WHERE id = $1", [id]
  );
  return rows[0] || null;
}

// Guarda o estado da classificação em clientes.extras.comercial (sem criar tabela só pra isso).
async function salvarEstado(clienteId, patch) {
  await pool.query(
    `UPDATE clientes SET extras = jsonb_set(COALESCE(extras, '{}'::jsonb), '{comercial}',
       COALESCE(extras->'comercial', '{}'::jsonb) || $2::jsonb) WHERE id = $1`,
    [clienteId, JSON.stringify(patch)]
  );
}

const mascarar = (tel) => (tel && tel.length > 6 ? `${tel.slice(0, tel.length - 4).replace(/\d/g, (d, i) => (i < 4 ? d : '•'))}${tel.slice(-4)}` : tel);

// GET /clientes/:id/comercial?dias=7|30|90 — KPIs, funil, alertas e lista de leads do período.
router.get('/clientes/:id/comercial', async (req, res) => {
  const dias = [7, 30, 90].includes(Number(req.query.dias)) ? Number(req.query.dias) : 7;
  try {
    const cliente = await buscarCliente(req.params.id);
    if (!cliente) return res.status(404).json({ erro: 'cliente não encontrado' });
    if (!comercialAtivo(cliente.id)) return res.json({ ativo: false });

    const { rows: leads } = await pool.query(
      `SELECT * FROM leads_comercial
        WHERE cliente_id = $1 AND primeiro_contato >= now() - ($2 || ' days')::interval
        ORDER BY primeiro_contato DESC`,
      [cliente.id, String(dias)]
    );
    const { rows: [{ total_geral }] } = await pool.query('SELECT count(*)::int AS total_geral FROM leads_comercial WHERE cliente_id = $1', [cliente.id]);

    const n = leads.length;
    const de = (f) => leads.filter(f).length;
    const media = (vals) => (vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null);
    const respondidos = de((l) => l.msgs_lead > 1); // voltou a falar depois da 1ª mensagem
    const funil = Object.fromEntries(ETAPAS.map((e) => [e, de((l) => l.etapa === e)]));
    const kpis = {
      leads: n,
      de_anuncio: de((l) => l.origem === 'anuncio'),
      responderam: respondidos,
      pct_responderam: n ? Math.round((100 * respondidos) / n) : null,
      avancaram: de((l) => ETAPAS_AVANCO.includes(l.etapa)),
      compraram: funil.comprou,
      com_atendimento_humano: de((l) => l.msgs_humano > 0),
      tempo_medio_resposta_humana_min: media(leads.filter((l) => l.primeira_resposta_humana_seg != null).map((l) => l.primeira_resposta_humana_seg / 60)),
      nota_media_atendimento: (() => { const v = leads.filter((l) => l.nota_atendimento != null).map((l) => l.nota_atendimento); return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null; })(),
      sem_classificar: de((l) => !l.etapa),
    };
    const contar = (chave) => {
      const m = new Map();
      for (const l of leads) { const k = (l[chave] || '').trim(); if (k) m.set(k, (m.get(k) || 0) + 1); }
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([valor, qtd]) => ({ valor, qtd }));
    };
    const alertas = [];
    for (const l of leads) {
      if (l.aguardando_resposta_h >= 2 && l.etapa !== 'perdido') alertas.push({ tipo: 'sem_resposta', contato: mascarar(l.contato), nome: l.nome, horas: l.aguardando_resposta_h, etapa: l.etapa });
      else if (l.etapa === 'qualificado' && l.msgs_humano === 0) alertas.push({ tipo: 'qualificado_sem_humano', contato: mascarar(l.contato), nome: l.nome, interesse: l.interesse });
    }

    res.json({
      ativo: true,
      periodo_dias: dias,
      classificacao: { ...cliente.comercial, total_leads_tabela: total_geral },
      kpis,
      funil,
      interesses: contar('interesse'),
      objecoes: contar('objecao'),
      anuncios: contar('anuncio'),
      alertas: alertas.sort((a, b) => (b.horas || 0) - (a.horas || 0)).slice(0, 20),
      leads: leads.map((l) => ({ ...l, contato: mascarar(l.contato), perfil: undefined })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

// POST /clientes/:id/comercial/classificar — dispara o workflow do n8n (assíncrono, callback com token).
router.post('/clientes/:id/comercial/classificar', async (req, res) => {
  const url = process.env.N8N_WEBHOOK_COMERCIAL;
  if (!url) return res.status(503).json({ erro: 'N8N_WEBHOOK_COMERCIAL não configurado' });
  try {
    const cliente = await buscarCliente(req.params.id);
    if (!cliente) return res.status(404).json({ erro: 'cliente não encontrado' });
    if (!comercialAtivo(cliente.id)) return res.status(403).json({ erro: 'este cliente não tem WhatsApp ligado ao cockpit (COMERCIAL_CLIENTE_IDS)' });
    const emAndamento = cliente.comercial.iniciado_em && !cliente.comercial.concluido_em
      && Date.now() - new Date(cliente.comercial.iniciado_em).getTime() < 15 * 60 * 1000;
    if (emAndamento) return res.status(202).json({ ok: true, ja_em_andamento: true });

    const token = crypto.randomBytes(16).toString('hex');
    await salvarEstado(cliente.id, { iniciado_em: new Date().toISOString(), concluido_em: null, erro: null, callback_token: token });
    const resp = await axios.post(url, {
      cliente_id: cliente.id, cliente_nome: cliente.nome, conta_id: cliente.conta_id,
      callback_url: `${urlPublica(req)}/api/clientes/${cliente.id}/comercial/concluir`, callback_token: token,
    }, { timeout: 30000, headers: { 'Content-Type': 'application/json' } });
    if (!resp.data?.aceito) {
      await salvarEstado(cliente.id, { concluido_em: new Date().toISOString(), erro: 'o n8n não aceitou o pedido' });
      return res.status(502).json({ erro: 'o n8n não aceitou o pedido' });
    }
    res.status(202).json({ ok: true });
  } catch (e) {
    console.error(e);
    await salvarEstado(req.params.id, { concluido_em: new Date().toISOString(), erro: e.message }).catch(() => {});
    res.status(502).json({ erro: `não deu para chamar o n8n: ${e.message}` });
  }
});

// POST /clientes/:id/comercial/concluir — callback do n8n. Body: { total, classificados, meta:{...}, erro }.
router.post('/clientes/:id/comercial/concluir', async (req, res) => {
  try {
    const cliente = await buscarCliente(req.params.id);
    if (!cliente) return res.status(404).json({ erro: 'cliente não encontrado' });
    const token = req.get('x-cockpit-token') || req.body?.callback_token;
    if (!cliente.comercial.callback_token || token !== cliente.comercial.callback_token) return res.status(403).json({ erro: 'token inválido' });
    const b = req.body || {};
    await salvarEstado(cliente.id, {
      concluido_em: new Date().toISOString(),
      erro: b.erro ? String(b.erro).slice(0, 500) : null,
      total: b.total ?? null, classificados: b.classificados ?? null,
      meta: b.meta && typeof b.meta === 'object' ? b.meta : null, // conciliação: conversas/leads segundo o Sentinel
      callback_token: null,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
