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
// O cliente liga o WhatsApp na própria ficha (whatsapp_ativo). O webhook pode ser próprio (cada cliente tem seu banco
// e, portanto, seu workflow com a credencial certa) ou o padrão N8N_WEBHOOK_COMERCIAL.
const webhookDe = (cliente) => cliente.whatsapp_webhook || process.env.N8N_WEBHOOK_COMERCIAL;

function urlPublica(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}`;
}

async function buscarCliente(id) {
  const { rows } = await pool.query(
    "SELECT id, nome, conta_id, COALESCE(whatsapp_ativo, false) AS whatsapp_ativo, whatsapp_webhook, COALESCE(extras->'comercial', '{}'::jsonb) AS comercial FROM clientes WHERE id = $1", [id]
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

// Períodos em horário de Brasília. "semana" e "mes" são fechados (batem com os relatórios); "7d"/"30d" são rolantes.
function intervalo(periodo) {
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  let ini, fim; // [ini, fim)
  if (periodo === 'semana') { // semana passada, segunda a domingo
    const dow = (hoje.getDay() + 6) % 7; // 0 = segunda
    fim = new Date(hoje); fim.setDate(hoje.getDate() - dow);
    ini = new Date(fim); ini.setDate(fim.getDate() - 7);
  } else if (periodo === 'mes') { // mês passado
    ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    fim = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  } else {
    const dias = periodo === '30d' ? 30 : 7;
    fim = new Date(hoje); fim.setDate(hoje.getDate() + 1); // inclui hoje
    ini = new Date(fim); ini.setDate(fim.getDate() - dias);
  }
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const rotulos = { semana: 'semana passada (seg–dom)', mes: 'mês passado', '30d': 'últimos 30 dias', '7d': 'últimos 7 dias' };
  return { periodo, ini: iso(ini), fim: iso(fim), rotulo: rotulos[periodo] || rotulos['7d'] };
}

// KPIs + funil de um conjunto de leads (anúncio, orgânico ou todos).
function resumir(leads) {
  const n = leads.length;
  const de = (f) => leads.filter(f).length;
  // mediana: uma noite ou um fim de semana sem resposta não pode puxar o número de todo mundo
  const mediana = (vals) => { if (!vals.length) return null; const v = [...vals].sort((a, b) => a - b); const m = Math.floor(v.length / 2); return Math.round(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2); };
  const responderam = de((l) => l.msgs_lead > 1);
  const funil = Object.fromEntries(ETAPAS.map((e) => [e, de((l) => l.etapa === e)]));
  const notas = leads.filter((l) => l.nota_atendimento != null).map((l) => l.nota_atendimento);
  return {
    leads: n,
    responderam,
    pct_responderam: n ? Math.round((100 * responderam) / n) : null,
    com_humano: de((l) => l.msgs_humano > 0),
    tempo_medio_resposta_humana_min: mediana(leads.filter((l) => l.primeira_resposta_humana_seg != null).map((l) => l.primeira_resposta_humana_seg / 60)),
    qualificados: de((l) => ETAPAS_AVANCO.includes(l.etapa)),
    agendaram: funil.agendou + funil.comprou,
    compraram: funil.comprou,
    esfriaram: funil.esfriou,
    esperando: de((l) => l.aguardando_resposta_h >= 2 && !['perdido', 'comprou'].includes(l.etapa)),
    nota_media: notas.length ? Math.round((notas.reduce((s, x) => s + x, 0) / notas.length) * 10) / 10 : null,
    sem_classificar: de((l) => !l.etapa),
    funil,
  };
}

// Auditoria no padrão da casa: % de conversas que cumpriram cada critério (só entre as classificadas).
// A ordem e os nomes seguem o "Modelo de Auditoria de Atendimento via WhatsApp" da Feeling.
const CRITERIOS = [
  { chave: 'cordial', rotulo: 'Atendente cordial e prestativo', grupo: 'Qualidade do atendimento' },
  { chave: 'clara_objetiva', rotulo: 'Comunicação clara e objetiva', grupo: 'Qualidade do atendimento' },
  { chave: 'erros_portugues', rotulo: 'Erros de português/digitação', grupo: 'Qualidade do atendimento', ruim: true },
  { chave: 'roteiro', rotulo: 'Seguiu roteiro de vendas', grupo: 'Script de vendas' },
  { chave: 'informacoes_completas', rotulo: 'Passou as informações necessárias', grupo: 'Script de vendas' },
  { chave: 'perguntas_estrategicas', rotulo: 'Fez perguntas para qualificar', grupo: 'Qualificação do lead' },
  { chave: 'interesse_identificado', rotulo: 'Identificou o interesse real', grupo: 'Qualificação do lead' },
  { chave: 'duvidas_esclarecidas', rotulo: 'Esclareceu as dúvidas', grupo: 'Resolução de dúvidas' },
  { chave: 'material_apoio', rotulo: 'Enviou material de apoio', grupo: 'Resolução de dúvidas' },
  { chave: 'follow_up', rotulo: 'Fez follow-up depois do silêncio', grupo: 'Follow-up' },
  { chave: 'gatilhos', rotulo: 'Usou escassez/urgência', grupo: 'Gatilhos mentais' },
  { chave: 'prova_social', rotulo: 'Usou prova social', grupo: 'Gatilhos mentais' },
  { chave: 'pelo_nome', rotulo: 'Chamou o lead pelo nome', grupo: 'Personalização' },
  { chave: 'conexao', rotulo: 'Criou conexão com o lead', grupo: 'Personalização' },
  { chave: 'informacao_confusa', rotulo: 'Informações confusas', grupo: 'Erros e ruídos', ruim: true },
  { chave: 'preco_errado', rotulo: 'Preço/condição divergente', grupo: 'Erros e ruídos', ruim: true },
];

function auditar(leads) {
  const comCrit = leads.filter((l) => l.criterios && Object.keys(l.criterios).length);
  if (!comCrit.length) return { avaliadas: 0, criterios: [], falhas: [] };
  const criterios = CRITERIOS.map((c) => {
    const avaliados = comCrit.filter((l) => typeof l.criterios[c.chave] === 'boolean');
    const sim = avaliados.filter((l) => l.criterios[c.chave]).length;
    return { ...c, avaliadas: avaliados.length, sim, pct: avaliados.length ? Math.round((100 * sim) / avaliados.length) : null };
  });
  // falhas mais repetidas (texto livre da IA, agrupado por semelhança grosseira)
  const mapa = new Map();
  for (const l of comCrit) for (const f of l.falhas || []) {
    const k = String(f).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]/g, '').split(' ').filter((w) => w.length > 4).slice(0, 4).join(' ');
    if (!k) continue;
    if (!mapa.has(k)) mapa.set(k, { texto: f, qtd: 0 });
    mapa.get(k).qtd += 1;
  }
  const falhas = [...mapa.values()].sort((a, b) => b.qtd - a.qtd).slice(0, 8);
  return { avaliadas: comCrit.length, criterios, falhas };
}

const contar = (leads, chave) => {
  const m = new Map();
  for (const l of leads) { const k = (l[chave] || '').trim(); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([valor, qtd]) => ({ valor, qtd }));
};

// GET /clientes/:id/comercial?periodo=7d|semana|30d|mes — separado por origem, com foco em anúncio.
router.get('/clientes/:id/comercial', async (req, res) => {
  const periodo = ['7d', 'semana', '30d', 'mes'].includes(req.query.periodo) ? req.query.periodo
    : (Number(req.query.dias) === 30 ? '30d' : '7d');
  try {
    const cliente = await buscarCliente(req.params.id);
    if (!cliente) return res.status(404).json({ erro: 'cliente não encontrado' });
    if (!cliente.whatsapp_ativo) return res.json({ ativo: false });

    const janela = intervalo(periodo);
    const { rows: leads } = await pool.query(
      `SELECT * FROM leads_comercial
        WHERE cliente_id = $1
          AND (primeiro_contato AT TIME ZONE 'America/Sao_Paulo') >= $2::date
          AND (primeiro_contato AT TIME ZONE 'America/Sao_Paulo') <  $3::date
        ORDER BY primeiro_contato DESC`,
      [cliente.id, janela.ini, janela.fim]
    );
    const { rows: [{ total_geral }] } = await pool.query('SELECT count(*)::int AS total_geral FROM leads_comercial WHERE cliente_id = $1', [cliente.id]);

    // Transportadora, pós-venda e fornecedor não são venda: ficam fora do funil e da auditoria, mas aparecem contados.
    const ehComercial = (l) => !l.tipo_contato || l.tipo_contato === 'lead_comercial';
    const comerciais = leads.filter(ehComercial);
    const fora = leads.filter((l) => !ehComercial(l));
    const nao_comerciais = { total: fora.length, por_tipo: contar(fora, 'tipo_contato') };

    const anuncio = comerciais.filter((l) => l.origem === 'anuncio');
    const organico = comerciais.filter((l) => l.origem !== 'anuncio');

    // Uma linha por anúncio: o que a Feeling é cobrada.
    const porAnuncio = new Map();
    for (const l of anuncio) {
      const k = (l.anuncio || '').trim();
      if (!porAnuncio.has(k)) porAnuncio.set(k, []);
      porAnuncio.get(k).push(l);
    }
    const por_anuncio = [...porAnuncio.entries()]
      .map(([texto, ls]) => ({ anuncio: texto, ...resumir(ls) }))
      .sort((a, b) => b.leads - a.leads);

    const alerta = (l) => {
      if (l.aguardando_resposta_h >= 2 && !['perdido', 'comprou'].includes(l.etapa))
        return { tipo: 'sem_resposta', origem: l.origem, contato: mascarar(l.contato), nome: l.nome, horas: l.aguardando_resposta_h, etapa: l.etapa, interesse: l.interesse };
      if (l.etapa === 'qualificado' && l.msgs_humano === 0)
        return { tipo: 'qualificado_sem_humano', origem: l.origem, contato: mascarar(l.contato), nome: l.nome, interesse: l.interesse };
      return null;
    };
    const alertas = comerciais.map(alerta).filter(Boolean)
      .sort((a, b) => ((a.origem === 'anuncio' ? 0 : 1) - (b.origem === 'anuncio' ? 0 : 1)) || ((b.horas || 0) - (a.horas || 0)))
      .slice(0, 25);

    res.json({
      ativo: true,
      periodo: janela,
      classificacao: { ...cliente.comercial, total_leads_tabela: total_geral },
      anuncio: { ...resumir(anuncio), interesses: contar(anuncio, 'interesse'), objecoes: contar(anuncio, 'objecao'), auditoria: auditar(anuncio) },
      organico: { ...resumir(organico), interesses: contar(organico, 'interesse'), objecoes: contar(organico, 'objecao') },
      todos: resumir(comerciais),
      auditoria: auditar(comerciais),
      nao_comerciais,
      por_anuncio,
      alertas,
      leads: leads.map((l) => ({ ...l, contato: mascarar(l.contato), perfil: undefined })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

// Dispara o workflow do n8n para um cliente. Lança erro se o n8n não aceitar.
async function dispararClassificacao(cliente, baseUrl) {
  const url = webhookDe(cliente);
  if (!url) throw new Error('nenhum webhook de classificação: defina N8N_WEBHOOK_COMERCIAL ou o webhook na ficha do cliente');
  const token = crypto.randomBytes(16).toString('hex');
  await salvarEstado(cliente.id, { iniciado_em: new Date().toISOString(), concluido_em: null, erro: null, callback_token: token });
  try {
    const resp = await axios.post(url, {
      cliente_id: cliente.id, cliente_nome: cliente.nome, conta_id: cliente.conta_id,
      callback_url: `${baseUrl}/api/clientes/${cliente.id}/comercial/concluir`, callback_token: token,
    }, { timeout: 30000, headers: { 'Content-Type': 'application/json' } });
    if (!resp.data?.aceito) throw new Error('o n8n não aceitou o pedido');
  } catch (e) {
    await salvarEstado(cliente.id, { concluido_em: new Date().toISOString(), erro: e.message }).catch(() => {});
    throw e;
  }
}

// Rodada automática: uma vez por dia (06:30 em Brasília) para todos os clientes com WhatsApp ligado.
// Precisa de PUBLIC_URL (o n8n chama o callback de fora). Só dispara; quem trabalha é o n8n.
function agendarRodadaDiaria() {
  if (!process.env.PUBLIC_URL) { console.warn('[comercial] rodada diária desligada: defina PUBLIC_URL'); return; }
  let ultimaData = null;
  setInterval(async () => {
    const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const hoje = agora.toISOString().slice(0, 10);
    if (agora.getHours() !== 6 || agora.getMinutes() < 30 || ultimaData === hoje) return;
    ultimaData = hoje;
    let ativos = [];
    try { ativos = (await pool.query('SELECT id FROM clientes WHERE whatsapp_ativo = true')).rows.map((r) => r.id); } catch (e) { console.error('[comercial] rodada diária:', e.message); return; }
    for (const id of ativos) {
      try {
        const cliente = await buscarCliente(id);
        if (cliente) { await dispararClassificacao(cliente, process.env.PUBLIC_URL.replace(/\/$/, '')); console.log(`[comercial] rodada diária disparada para ${cliente.nome}`); }
      } catch (e) { console.error(`[comercial] rodada diária falhou para o cliente ${id}:`, e.message); }
    }
  }, 60 * 1000);
}

// POST /clientes/:id/comercial/auditoria?periodo=... — gera a "Auditoria de Atendimento via WhatsApp" (PDF).
// Documento tipo 'auditoria'; o n8n escreve no modelo da casa e conclui pelo callback dos documentos.
router.post('/clientes/:id/comercial/auditoria', async (req, res) => {
  const url = process.env.N8N_WEBHOOK_COMERCIAL_AUDITORIA;
  if (!url) return res.status(503).json({ erro: 'N8N_WEBHOOK_COMERCIAL_AUDITORIA não configurado' });
  const periodo = ['7d', 'semana', '30d', 'mes'].includes(req.body?.periodo) ? req.body.periodo : 'mes';
  try {
    const cliente = await buscarCliente(req.params.id);
    if (!cliente) return res.status(404).json({ erro: 'cliente não encontrado' });
    if (!cliente.whatsapp_ativo) return res.status(403).json({ erro: 'ligue "WhatsApp com IA" na ficha do cliente' });

    const janela = intervalo(periodo);
    const { rows: leads } = await pool.query(
      `SELECT * FROM leads_comercial WHERE cliente_id = $1
         AND (primeiro_contato AT TIME ZONE 'America/Sao_Paulo') >= $2::date
         AND (primeiro_contato AT TIME ZONE 'America/Sao_Paulo') <  $3::date
       ORDER BY primeiro_contato DESC`,
      [cliente.id, janela.ini, janela.fim]
    );
    if (!leads.length) return res.status(409).json({ erro: 'nenhum lead classificado neste período — atualize as conversas antes' });

    // A auditoria é de venda: transportadora, pós-venda e fornecedor saem da conta (mas o documento diz quantos foram).
    const todosClassificados = leads;
    const fora = leads.filter((l) => l.tipo_contato && l.tipo_contato !== 'lead_comercial');
    const comerciais = leads.filter((l) => !l.tipo_contato || l.tipo_contato === 'lead_comercial');
    if (!comerciais.length) return res.status(409).json({ erro: 'nenhum contato comercial neste período — os contatos encontrados são pós-venda, fornecedor ou transportadora' });

    const anuncio = comerciais.filter((l) => l.origem === 'anuncio');
    const dados = {
      total_contatos: todosClassificados.length,
      total_leads: comerciais.length, de_anuncio: anuncio.length,
      nao_comerciais: { total: fora.length, por_tipo: contar(fora, 'tipo_contato'), observacao: 'contatos que não são de venda; ficam fora do funil e da auditoria' },
      geral: resumir(comerciais), anuncio: resumir(anuncio),
      auditoria: auditar(comerciais),
      interesses: contar(comerciais, 'interesse'), objecoes: contar(comerciais, 'objecao'),
      tempo_ia_segundos: 'a IA responde em segundos; os tempos apurados medem a entrada do atendente humano',
    };
    // amostras: melhores e piores notas, sem telefone nem nome
    const ordenadas = comerciais.filter((l) => l.nota_atendimento != null).sort((a, b) => a.nota_atendimento - b.nota_atendimento);
    const amostra = (l) => ({
      origem: l.origem, etapa: l.etapa, interesse: l.interesse, nota: l.nota_atendimento, motivo: l.motivo_nota,
      primeira_resposta_min: l.primeira_resposta_humana_seg == null ? null : Math.round(l.primeira_resposta_humana_seg / 60),
      esperando_h: l.aguardando_resposta_h, resumo: l.resumo, falhas: l.falhas || [],
    });
    const amostras = [...ordenadas.slice(0, 6), ...ordenadas.slice(-3)].map(amostra);

    const token = crypto.randomBytes(24).toString('hex');
    const ins = await pool.query(
      `INSERT INTO documentos_gerados (cliente_id, cliente_nome, tipo, estado, extras)
       VALUES ($1,$2,'auditoria','gerando',$3) RETURNING id, tipo, criado_em, estado`,
      [cliente.id, cliente.nome, JSON.stringify({ callback_token: token, periodo: janela })]
    );
    const doc = ins.rows[0];
    axios.post(url, {
      cliente_id: cliente.id, cliente_nome: cliente.nome, documento_id: doc.id,
      periodo: janela, dados, amostras,
      callback_url: `${urlPublica(req)}/api/documentos/${doc.id}/concluir`, callback_token: token,
    }, { timeout: 30000, headers: { 'Content-Type': 'application/json' } })
      .catch(async (e) => { await pool.query("UPDATE documentos_gerados SET estado = 'erro', erro = $2 WHERE id = $1", [doc.id, e.message]).catch(() => {}); });
    res.status(202).json({ ...doc, url_download: `/api/documentos/${doc.id}/download` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

// POST /clientes/:id/comercial/classificar — dispara o workflow do n8n (assíncrono, callback com token).
router.post('/clientes/:id/comercial/classificar', async (req, res) => {
  try {
    const cliente = await buscarCliente(req.params.id);
    if (!cliente) return res.status(404).json({ erro: 'cliente não encontrado' });
    if (!cliente.whatsapp_ativo) return res.status(403).json({ erro: 'ligue "WhatsApp com IA" na ficha do cliente' });
    if (!webhookDe(cliente)) return res.status(503).json({ erro: 'N8N_WEBHOOK_COMERCIAL não configurado e o cliente não tem webhook próprio' });
    const emAndamento = cliente.comercial.iniciado_em && !cliente.comercial.concluido_em
      && Date.now() - new Date(cliente.comercial.iniciado_em).getTime() < 15 * 60 * 1000;
    if (emAndamento) return res.status(202).json({ ok: true, ja_em_andamento: true });

    await dispararClassificacao(cliente, urlPublica(req));
    res.status(202).json({ ok: true });
  } catch (e) {
    console.error(e);
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
module.exports.agendarRodadaDiaria = agendarRodadaDiaria;
