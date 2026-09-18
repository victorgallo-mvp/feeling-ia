// src/servicos/texto.js
// Extrai texto de PDF com o pdf.js (Mozilla). O extrator do n8n e o Poppler antigo do Debian
// perdem letras em PDFs com certas fontes embutidas; o pdf.js atual lê certo.
async function extrairTextoPdf(buffer) {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
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
    return paginas.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  } catch (e) {
    console.warn('[texto] falha ao extrair PDF:', e.message);
    return '';
  }
}

module.exports = { extrairTextoPdf };
