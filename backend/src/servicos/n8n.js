// src/servicos/n8n.js
// Única ponte com o motor. Dispara o webhook do workflow e devolve o markdown.
const axios = require('axios');

const WEBHOOKS = {
  relatorio: process.env.N8N_WEBHOOK_RELATORIO,
  pesquisa:  process.env.N8N_WEBHOOK_PESQUISA,
  briefing:  process.env.N8N_WEBHOOK_BRIEFING,
  analise:   process.env.N8N_WEBHOOK_PRESENCA, // Análise de Presença Digital
  interno:   process.env.N8N_WEBHOOK_INTERNO,  // Análise interna da conta (uso interno, não vai ao cliente)
};
// Documentos que não nascem de um botão "gerar" (o cockpit chama de outro jeito)
const WEBHOOKS_EXTRA = {
  reuniao: process.env.N8N_WEBHOOK_REUNIAO, // resumo de transcrição de reunião
  comercial: process.env.N8N_WEBHOOK_COMERCIAL, // classificação das conversas do WhatsApp (aba Comercial)
  transcrever: process.env.N8N_WEBHOOK_TRANSCREVER, // gravação de reunião -> texto (Whisper)
  criativo: process.env.N8N_WEBHOOK_CRIATIVO_IMAGEM, // criativos: imagem (gpt-image) — copy usa N8N_WEBHOOK_CRIATIVO_COPY
};

// Quais tipos têm workflow ligado — o painel usa pra mostrar "em breve" nos que faltam.
const tiposConfigurados = () =>
  Object.fromEntries([...Object.entries(WEBHOOKS), ...Object.entries(WEBHOOKS_EXTRA)].map(([tipo, url]) => [tipo, Boolean(url)]));

// Dispara o workflow. `dados` vai inteiro no corpo (conta_id, cliente_nome, cliente_id, ... e, no modo
// assíncrono, callback_url + callback_token). Devolve:
//   { modo: 'assincrono' }            -> o workflow aceitou e vai chamar o callback quando terminar
//   { modo: 'sincrono', markdown }    -> workflow antigo, que ainda responde com o texto na hora
async function gerarViaN8n(tipo, dados) {
  const url = WEBHOOKS[tipo];
  if (!url) throw new Error(`Webhook não configurado para tipo: ${tipo}`);

  const resp = await axios.post(
    url,
    dados,
    { timeout: 175000, headers: { 'Content-Type': 'application/json' } } // compat: workflow síncrono pode demorar
  );

  const markdown = resp.data?.markdown ?? resp.data?.output ?? resp.data?.relatorio;
  if (markdown) return { modo: 'sincrono', markdown };
  if (resp.data?.aceito) return { modo: 'assincrono' };
  throw new Error('n8n não aceitou nem devolveu markdown. Resposta: ' + JSON.stringify(resp.data).slice(0, 300));
}

async function anexarViaN8n(fileBuffer, filename, { conta_id, cliente_nome, cliente_id, titulo, tipo }) {
  const url = process.env.N8N_WEBHOOK_ANEXAR;
  if (!url) throw new Error('N8N_WEBHOOK_ANEXAR não configurado');
  const FormData = require('form-data');
  const form = new FormData();
  form.append('arquivo', fileBuffer, filename);
  form.append('conta_id', conta_id || '');
  form.append('cliente_nome', cliente_nome || '');
  form.append('cliente_id', cliente_id != null ? String(cliente_id) : ''); // metadata pra filtrar o cérebro por cliente
  form.append('titulo', titulo || filename); // nome original do arquivo, vira metadata no cérebro
  if (tipo) form.append('tipo', tipo); // metadata.tipo no cérebro (padrão do workflow: anexo)
  await axios.post(url, form, { timeout: 120000, headers: form.getHeaders() });
  return { ok: true };
}

// Resumo de reunião: manda a transcrição em texto e recebe { markdown, sugestoes }.
async function resumirReuniaoViaN8n({ cliente_id, cliente_nome, conta_id, titulo, data_reuniao, texto, modo }) {
  const url = WEBHOOKS_EXTRA.reuniao;
  if (!url) throw new Error('N8N_WEBHOOK_REUNIAO não configurado');
  const resp = await axios.post(url, { cliente_id, cliente_nome, conta_id, titulo, data_reuniao, texto, modo: modo || 'reuniao' },
    { timeout: 170000, headers: { 'Content-Type': 'application/json' } });
  const markdown = resp.data?.markdown;
  if (!markdown) throw new Error('n8n não devolveu o resumo. Resposta: ' + JSON.stringify(resp.data).slice(0, 300));
  return { markdown, sugestoes: resp.data?.sugestoes ?? null };
}

module.exports = { gerarViaN8n, anexarViaN8n, resumirReuniaoViaN8n, tiposConfigurados };
