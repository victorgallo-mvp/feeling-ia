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

export function anexarDocumento(id, arquivo, { extrair = true } = {}) {
  const form = new FormData();
  form.append('arquivo', arquivo);
  form.append('extrair', extrair ? 'true' : 'false');
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
