// src/servicos/arte.js
// Monta a arte final (imagem aprovada + copy aprovada) num template HTML e tira o PNG com o Chromium.
// Feed 1080x1080 e Stories 1080x1920. Texto entra aqui, nunca dentro da imagem gerada pela IA.
const puppeteer = require('puppeteer');

const FORMATOS = {
  feed: { largura: 1080, altura: 1080 },
  stories: { largura: 1080, altura: 1920 },
};

const escapar = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Template único; o formato muda o tamanho e a posição do bloco de texto.
function html({ formato, imagemDataUrl, headline, texto, cta, marca, cores }) {
  const { largura, altura } = FORMATOS[formato];
  const stories = formato === 'stories';
  const primaria = cores?.primaria || '#12203a';
  const destaque = cores?.destaque || '#2f6f6a';
  const tamHeadline = stories ? 74 : 62;
  const tamTexto = stories ? 34 : 30;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: ${largura}px; height: ${altura}px; overflow: hidden; font-family: Helvetica, Arial, sans-serif; background: ${primaria}; }
    .fundo { position: absolute; inset: 0; }
    .fundo img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .veu { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) ${stories ? '45%' : '35%'}, rgba(10,16,30,0.72) 78%, rgba(10,16,30,0.92) 100%); }
    .marca { position: absolute; top: ${stories ? 120 : 48}px; left: 64px; color: #fff; font-size: ${stories ? 30 : 26}px; letter-spacing: 3px; text-transform: uppercase; opacity: 0.9; text-shadow: 0 2px 8px rgba(0,0,0,.6); }
    .texto { position: absolute; left: 64px; right: 64px; bottom: ${stories ? 260 : 72}px; color: #fff; }
    h1 { font-size: ${tamHeadline}px; line-height: 1.08; font-weight: 800; text-shadow: 0 3px 14px rgba(0,0,0,.55); max-width: ${stories ? 900 : 860}px; }
    p { margin-top: 22px; font-size: ${tamTexto}px; line-height: 1.3; max-width: ${stories ? 860 : 780}px; text-shadow: 0 2px 8px rgba(0,0,0,.6); }
    .cta { display: inline-block; margin-top: 34px; padding: ${stories ? '24px 48px' : '20px 40px'}; background: ${destaque}; color: #fff; font-size: ${stories ? 34 : 30}px; font-weight: 700; border-radius: 999px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
  </style></head><body>
    <div class="fundo"><img src="${imagemDataUrl}" alt=""></div><div class="veu"></div>
    <div class="marca">${escapar(marca)}</div>
    <div class="texto">
      <h1>${escapar(headline)}</h1>
      ${texto ? `<p>${escapar(texto)}</p>` : ''}
      ${cta ? `<div class="cta">${escapar(cta)}</div>` : ''}
    </div>
  </body></html>`;
}

// Devolve [{ formato, png }] para os formatos pedidos.
async function montarArtes({ formatos, imagem, mime, headline, texto, cta, marca, cores }) {
  const imagemDataUrl = `data:${mime || 'image/png'};base64,${imagem.toString('base64')}`;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'], protocolTimeout: 120000 });
  try {
    const saida = [];
    for (const formato of formatos) {
      if (!FORMATOS[formato]) continue;
      const { largura, altura } = FORMATOS[formato];
      const page = await browser.newPage();
      await page.setViewport({ width: largura, height: altura, deviceScaleFactor: 1 });
      await page.setContent(html({ formato, imagemDataUrl, headline, texto, cta, marca, cores }), { waitUntil: 'load' });
      await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((ok) => { i.onload = ok; i.onerror = ok; })))));
      const png = await page.screenshot({ type: 'png', captureBeyondViewport: false });
      await page.close();
      saida.push({ formato, png: Buffer.from(png) });
    }
    return saida;
  } finally {
    await browser.close();
  }
}

module.exports = { montarArtes, FORMATOS };
