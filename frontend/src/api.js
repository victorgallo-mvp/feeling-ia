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

export const listarClientes = () => req('/api/clientes');
export const buscarCliente = (id) => req(`/api/clientes/${id}`);
export const listarDocumentos = (id) => req(`/api/clientes/${id}/documentos`);
export const gerarDocumento = (id, tipo) => req(`/api/clientes/${id}/gerar/${tipo}`, { method: 'POST' });

export function anexarDocumento(id, arquivo) {
  const form = new FormData();
  form.append('arquivo', arquivo);
  return req(`/api/clientes/${id}/anexar`, { method: 'POST', body: form });
}

// url_download vem relativa do backend (/api/documentos/:id/download)
export const urlDownload = (doc) => API_URL + doc.url_download;
