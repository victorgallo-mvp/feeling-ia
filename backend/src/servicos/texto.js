// src/servicos/texto.js
// Extrai texto de arquivos de transcrição (TXT/MD, DOCX, PDF) pra mandar ao n8n como texto puro.
const path = require('path');

async function textoDePdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const raiz = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false,
    standardFontDataUrl: path.join(raiz, 'standard_fonts') + path.sep,
    cMapUrl: path.join(raiz, 'cmaps') + path.sep, cMapPacked: true,
  }).promise;
  const paginas = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const conteudo = await (await doc.getPage(i)).getTextContent();
    let texto = '', fimX = null, y = null;
    for (const item of conteudo.items) {
      if (!('str' in item)) continue;
      const x = item.transform[4], yAtual = item.transform[5];
      if (fimX !== null) {
        if (Math.abs(yAtual - y) >= 2) texto += '\n';
        else if (x - fimX > 1.2) texto += ' ';
      }
      texto += item.str; fimX = x + item.width; y = yAtual;
      if (item.hasEOL) { texto += '\n'; fimX = null; }
    }
    paginas.push(texto);
  }
  await doc.cleanup?.();
  return paginas.join('\n\n');
}

async function textoDeDocx(buffer) {
  const mammoth = require('mammoth');
  return (await mammoth.extractRawText({ buffer })).value;
}

// Devolve '' quando não consegue extrair.
async function extrairTexto(buffer, nomeArquivo) {
  const ext = path.extname(nomeArquivo || '').toLowerCase();
  try {
    let texto;
    if (ext === '.pdf') texto = await textoDePdf(buffer);
    else if (ext === '.docx') texto = await textoDeDocx(buffer);
    else texto = buffer.toString('utf8');
    return texto.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  } catch (e) {
    console.warn(`[texto] falha ao extrair ${nomeArquivo}:`, e.message);
    return '';
  }
}

module.exports = { extrairTexto };
