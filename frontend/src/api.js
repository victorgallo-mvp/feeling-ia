// Única porta de saída do frontend: fala SÓ com o backend (nunca direto com n8n/DB).
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');

async function req(caminho, opcoes) {
  let resp;
  try {
    resp = await fetch(API_URL + caminho, opcoes);
  } catch {
    throw new Error('Não foi possível falar com o servidor.');
  }
  const corpo = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(corpo?.erro || `Erro ${resp.status}`);
  return corpo;
}

export const listarTipos = () => req('/api/tipos');
export const listarClientes = () => req('/api/clientes');
export const buscarCliente = (id) => req(`/api/clientes/${id}`);
const comJson = (method, dados) => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados),
});
export const criarCliente = (dados) => req('/api/clientes', comJson('POST', dados));
export const atualizarCliente = (id, dados) => req(`/api/clientes/${id}`, comJson('PUT', dados));
export const listarDocumentos = (id) => req(`/api/clientes/${id}/documentos`);
export const listarAnexos = (id) => req(`/api/clientes/${id}/anexos`);
export const excluirAnexo = (id, titulo) => req(`/api/clientes/${id}/anexos?titulo=${encodeURIComponent(titulo)}`, { method: 'DELETE' });
export const resumoExclusao = (id) => req(`/api/clientes/${id}/resumo-exclusao`);
export const excluirCliente = (id) => req(`/api/clientes/${id}`, { method: 'DELETE' });
export const excluirDocumento = (id) => req(`/api/documentos/${id}`, { method: 'DELETE' });
export const removerPerdidos = (clienteId) => req(`/api/clientes/${clienteId}/documentos/perdidos`, { method: 'DELETE' });
export const gerarDocumento = (id, tipo) => req(`/api/clientes/${id}/gerar/${tipo}`, { method: 'POST' });

// tipo: 'anexo' (padrão) ou 'relatorio_semanal'; titulo opcional substitui o nome do arquivo no cérebro
export function anexarDocumento(id, arquivo, { extrair = true, tipo, titulo } = {}) {
  const form = new FormData();
  form.append('arquivo', arquivo);
  form.append('extrair', extrair ? 'true' : 'false');
  if (tipo) form.append('tipo', tipo);
  if (titulo) form.append('titulo', titulo);
  return req(`/api/clientes/${id}/anexar`, { method: 'POST', body: form });
}

export function enviarReuniao(id, arquivo, { titulo, data_reuniao } = {}) {
  const form = new FormData();
  form.append('arquivo', arquivo);
  if (titulo) form.append('titulo', titulo);
  if (data_reuniao) form.append('data_reuniao', data_reuniao);
  return req(`/api/clientes/${id}/reunioes`, { method: 'POST', body: form });
}
export const registrarSugestaoAnexo = (clienteId, sid, dados) => req(`/api/clientes/${clienteId}/sugestoes/${sid}`, comJson('PATCH', dados));
export const registrarSugestoes = (docId, dados) => req(`/api/documentos/${docId}/sugestoes`, comJson('PATCH', dados));
export const urlTranscricao = (doc) => `${API_URL}/api/documentos/${doc.id}/transcricao`;

// url_download vem relativa do backend (/api/documentos/:id/download)
export const urlDownload = (doc) => API_URL + doc.url_download;

// Aba Comercial (WhatsApp): leitura da tabela leads_comercial e disparo da classificação no n8n
export const lerComercial = (id, periodo = 'semana') => req(`/api/clientes/${id}/comercial?periodo=${periodo}`);
export const classificarComercial = (id) => req(`/api/clientes/${id}/comercial/classificar`, { method: 'POST' });
export const gerarAuditoria = (id, periodo) => req(`/api/clientes/${id}/comercial/auditoria`, comJson('POST', { periodo }));

// Criativos (contexto -> copy em 3 ângulos -> aprovar as que quiser -> imagens por copy -> artes)
export const listarCriativos = (clienteId) => req(`/api/clientes/${clienteId}/criativos`);
export function criarCriativo(clienteId, campos, fotos = []) {
  const form = new FormData();
  for (const [k, v] of Object.entries(campos)) form.append(k, v ?? '');
  for (const f of fotos) form.append('fotos', f);
  return req(`/api/clientes/${clienteId}/criativos`, { method: 'POST', body: form });
}
export const refazerCopy = (id, feedback) => req(`/api/criativos/${id}/copy/refazer`, comJson('POST', { feedback }));
export const editarCopy = (id, versaoId, campos) => req(`/api/criativos/${id}/copy/${versaoId}`, comJson('PUT', campos));
export const aprovarCopies = (id, versoes) => req(`/api/criativos/${id}/copy/aprovar`, comJson('POST', { versoes }));
export const refazerImagens = (id, versaoId, feedback) => req(`/api/criativos/${id}/imagens/refazer`, comJson('POST', { versao_id: versaoId, feedback }));
export const escolherImagem = (id, arquivoId) => req(`/api/criativos/${id}/imagens/${arquivoId}/escolher`, comJson('POST', {}));
export const montarArtes = (id, layout) => req(`/api/criativos/${id}/artes`, comJson('POST', { layout }));
export const excluirCriativo = (id) => req(`/api/criativos/${id}`, { method: 'DELETE' });

// Prospecção (diagnóstico de presença digital)
export const listarProspects = () => req('/api/prospects');
export const criarProspect = (dados) => req('/api/prospects', comJson('POST', dados));
export const buscarProspect = (id) => req(`/api/prospects/${id}`);
export const atualizarProspect = (id, dados) => req(`/api/prospects/${id}`, comJson('PUT', dados));
export const excluirProspect = (id) => req(`/api/prospects/${id}`, { method: 'DELETE' });
export const localizarProspect = (id) => req(`/api/prospects/${id}/localizar`, comJson('POST', {}));
export const confirmarProspect = (id, dados) => req(`/api/prospects/${id}/confirmar`, comJson('POST', dados));
export const coletarProspect = (id) => req(`/api/prospects/${id}/coletar`, comJson('POST', {}));
export const gerarDiagnostico = (id) => req(`/api/prospects/${id}/documento`, comJson('POST', {}));
export const virarCliente = (id) => req(`/api/prospects/${id}/virar-cliente`, comJson('POST', {}));
