// src/servicos/pdf.js
// Converte markdown -> PDF no Padrão Feeling usando Puppeteer.
// Mantém o MESMO visual dos documentos já entregues (não alterar o CSS).
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const puppeteer = require('puppeteer');

const CSS = `
@page { size: A4; margin: 20mm 18mm 16mm 18mm; }
* { box-sizing: border-box; }
body { font-family: Helvetica, 'Liberation Sans', Arial, sans-serif; color:#1f2733; font-size:10.5pt; line-height:1.55; margin:0; }
h1 { font-size:19pt; color:#12203a; margin:0 0 4px; line-height:1.15; letter-spacing:-0.3px; }
h1 + p { color:#55617a; font-size:9.5pt; border-bottom:2px solid #12203a; padding-bottom:12px; margin-top:4px; }
h2 { font-size:13pt; color:#12203a; margin:22px 0 8px; padding-left:12px; border-left:4px solid #2f6f6a; line-height:1.2; page-break-after:avoid; }
p { margin:7px 0; } strong { color:#12203a; font-weight:700; }
ul { margin:4px 0 12px; padding-left:20px; } li { margin:4px 0; page-break-inside:avoid; }
li::marker { color:#2f6f6a; }
table { border-collapse:collapse; width:70%; margin:10px 0 14px; font-size:9.5pt; page-break-inside:avoid; }
th { background:#12203a; color:#fff; text-align:left; padding:6px 10px; font-weight:700; }
td { border-bottom:1px solid #dde2ea; padding:6px 10px; } tr:nth-child(even) td { background:#f5f7fa; }
`;

// Garante linha em branco antes de listas (o parser exige) — mesma correção usada nos PDFs entregues.
function normalizarMarkdown(md) {
  const linhas = md.split('\n');
  const out = [];
  for (const ln of linhas) {
    const ehItem = ln.trimStart().startsWith('- ');
    const prev = out.length ? out[out.length - 1] : '';
    if (ehItem && prev.trim() !== '' && !prev.trimStart().startsWith('- ')) out.push('');
    out.push(ln);
  }
  return out.join('\n');
}

async function markdownParaPdf(markdown) {
  const corpo = marked.parse(normalizarMarkdown(markdown));
  const html = `<!DOCTYPE html><html lang="pt-br"><head><meta charset="utf-8">
    <style>${CSS}</style></head><body>${corpo}</body></html>`;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'], // necessário no Railway
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;text-align:right;padding-right:14mm;font-size:8pt;color:#9aa4b5;font-family:Helvetica,Arial,sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: '20mm', bottom: '16mm', left: '18mm', right: '18mm' },
    });
    return pdf; // Buffer
  } finally {
    await browser.close();
  }
}

module.exports = { markdownParaPdf };
