// src/servicos/storage.js
// Grava e lê os PDFs em disco (STORAGE_DIR; no Railway, um volume).
const fs = require('fs/promises');
const path = require('path');

const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || './pdfs');

// basename impede que um caminho adulterado saia do STORAGE_DIR
const caminhoAbsoluto = (caminho) => path.join(STORAGE_DIR, path.basename(caminho || ''));

// Devolve o "caminho" gravado em documentos_gerados: só o nome do arquivo,
// relativo ao STORAGE_DIR — assim o volume pode mudar de lugar sem quebrar o histórico.
async function salvarPdf(buffer, clienteId, tipo) {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  const nome = `cliente-${clienteId}_${tipo}_${Date.now()}.pdf`;
  await fs.writeFile(path.join(STORAGE_DIR, nome), buffer);
  return nome;
}

async function lerPdf(caminho) {
  return fs.readFile(caminhoAbsoluto(caminho));
}

async function existePdf(caminho) {
  if (!caminho) return false;
  return fs.access(caminhoAbsoluto(caminho)).then(() => true, () => false);
}

// Não reclama se o arquivo já não existe (deploy sem volume, por exemplo).
async function apagarPdf(caminho) {
  if (!caminho) return;
  await fs.unlink(caminhoAbsoluto(caminho)).catch((e) => { if (e.code !== 'ENOENT') throw e; });
}

module.exports = { salvarPdf, lerPdf, existePdf, apagarPdf, STORAGE_DIR };
