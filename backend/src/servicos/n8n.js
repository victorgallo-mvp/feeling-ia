// src/servicos/n8n.js
// Única ponte com o motor. Dispara o webhook do workflow e devolve o markdown.
const axios = require('axios');

const WEBHOOKS = {
  relatorio: process.env.N8N_WEBHOOK_RELATORIO,
  pesquisa:  process.env.N8N_WEBHOOK_PESQUISA,
  briefing:  process.env.N8N_WEBHOOK_BRIEFING,
  analise:   process.env.N8N_WEBHOOK_PRESENCA, // Análise de Presença Digital
};

// Quais tipos têm workflow ligado — o painel usa pra mostrar "em breve" nos que faltam.
const tiposConfigurados = () =>
  Object.fromEntries(Object.entries(WEBHOOKS).map(([tipo, url]) => [tipo, Boolean(url)]));

// `dados` vai inteiro no corpo: sempre { conta_id, cliente_nome }, mais o que o tipo precisar.
async function gerarViaN8n(tipo, dados) {
  const url = WEBHOOKS[tipo];
  if (!url) throw new Error(`Webhook não configurado para tipo: ${tipo}`);

  const resp = await axios.post(
    url,
    dados,
    { timeout: 120000, headers: { 'Content-Type': 'application/json' } }
  );

  // O workflow responde { markdown: "..." } (via nó Respond to Webhook).
  const markdown = resp.data?.markdown ?? resp.data?.output ?? resp.data?.relatorio;
  if (!markdown) throw new Error('n8n não devolveu markdown. Resposta: ' + JSON.stringify(resp.data).slice(0, 300));
  return markdown;
}

async function anexarViaN8n(fileBuffer, filename, { conta_id, cliente_nome }) {
  const url = process.env.N8N_WEBHOOK_ANEXAR;
  if (!url) throw new Error('N8N_WEBHOOK_ANEXAR não configurado');
  const FormData = require('form-data');
  const form = new FormData();
  form.append('arquivo', fileBuffer, filename);
  form.append('conta_id', conta_id || '');
  form.append('cliente_nome', cliente_nome || '');
  await axios.post(url, form, { timeout: 120000, headers: form.getHeaders() });
  return { ok: true };
}

module.exports = { gerarViaN8n, anexarViaN8n, tiposConfigurados };
