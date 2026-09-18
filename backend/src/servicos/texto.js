// src/servicos/texto.js
// Extrai texto de PDF com o pdftotext (Poppler). Devolve '' se a ferramenta não existir ou falhar.
const { execFile } = require('child_process');

function extrairTextoPdf(buffer) {
  return new Promise((resolve) => {
    // "-" lê da stdin e escreve na stdout; sem -layout a ordem de leitura fica melhor pra fatiar
    const proc = execFile('pdftotext', ['-enc', 'UTF-8', '-', '-'], { maxBuffer: 50 * 1024 * 1024 }, (err, stdout) => {
      if (err) { console.warn('[texto] pdftotext falhou:', err.message); return resolve(''); }
      // remove quebras de página e excesso de linhas em branco
      resolve(stdout.replace(/\f/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
    });
    proc.stdin.on('error', () => {}); // pdftotext ausente: o erro já chega no callback
    proc.stdin.end(buffer);
  });
}

module.exports = { extrairTextoPdf };
