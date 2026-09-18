// src/servicos/texto.js
// Extrai texto de PDF com o pdf.js (Mozilla). O extrator do n8n perde letras em PDFs com certas
// fontes embutidas; o pdf.js atual lê certo. Devolve { texto, avisos } — avisos são os warnings
// do pdf.js durante a extração (ajudam a diagnosticar diferenças entre ambientes).
const path = require('path');

async function extrairTextoPdf(buffer) {
  const avisos = [];
  const logOriginal = console.log, warnOriginal = console.warn;
  const captura = (...a) => { const m = a.map(String).join(' '); if (/warn|error|fail/i.test(m)) avisos.push(m.slice(0, 200)); };
  console.log = captura; console.warn = captura;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const raiz = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
      standardFontDataUrl: path.join(raiz, 'standard_fonts') + path.sep,
      cMapUrl: path.join(raiz, 'cmaps') + path.sep,
      cMapPacked: true,
    }).promise;
    const paginas = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const conteudo = await (await doc.getPage(i)).getTextContent();
      // Junta os trechos pela posição: sem espaço quando o próximo começa colado ao anterior
      // (ligaduras como "fi" vêm em trechos separados), espaço quando há folga, quebra no fim da linha.
      let texto = '', fimX = null, y = null;
      for (const item of conteudo.items) {
        if (!('str' in item)) continue;
        const x = item.transform[4], yAtual = item.transform[5];
        if (fimX !== null) {
          const mesmaLinha = Math.abs(yAtual - y) < 2;
          if (!mesmaLinha) texto += '\n';
          else if (x - fimX > 1.2) texto += ' ';
        }
        texto += item.str;
        fimX = x + item.width; y = yAtual;
        if (item.hasEOL) { texto += '\n'; fimX = null; }
      }
      paginas.push(texto);
    }
    await doc.cleanup?.();
    const texto = paginas.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return { texto, avisos, versao: pdfjs.version };
  } catch (e) {
    avisos.push('falha: ' + e.message);
    return { texto: '', avisos };
  } finally {
    console.log = logOriginal; console.warn = warnOriginal;
  }
}

module.exports = { extrairTextoPdf };
