// src/servicos/arte.js
// Monta a arte final (imagem aprovada + copy aprovada) num template HTML e tira o PNG com o Chromium.
// Feed 1080x1080 e Stories 1080x1920. Texto entra aqui, nunca dentro da imagem gerada pela IA.
// Três layouts para dar variação visual sem custo de IA: sobreposto, faixa e cartão.
const puppeteer = require('puppeteer');

const FORMATOS = {
  feed: { largura: 1080, altura: 1080 },
  stories: { largura: 1080, altura: 1920 },
};

const LAYOUTS = {
  sobreposto: 'Texto sobre a foto, com véu escuro na base',
  faixa: 'Foto em cima e faixa colorida embaixo com o texto',
  cartao: 'Foto inteira com um cartão claro segurando o texto',
};

const escapar = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function html({ formato, layout, imagemDataUrl, headline, texto, cta, marca, cores }) {
  const { largura, altura } = FORMATOS[formato];
  const stories = formato === 'stories';
  const primaria = cores?.primaria || '#12203a';
  const destaque = cores?.destaque || '#2f6f6a';
  const claro = cores?.claro || '#f7f5f1';
  // Stories tem mais altura útil: tipografia maior e respiro maior na base (a interface do Instagram cobre o rodapé).
  const base = stories ? 260 : 72;
  const lados = 64;

  const comum = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: ${largura}px; height: ${altura}px; overflow: hidden; font-family: Helvetica, Arial, sans-serif; background: ${primaria}; }
    .foto { position: absolute; inset: 0; }
    .foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
    /* a marca fica sobre a foto: pílula escura garante leitura tanto em foto clara quanto escura */
    .marca { position: absolute; top: ${stories ? 120 : 48}px; left: ${lados}px; font-size: ${stories ? 28 : 24}px; letter-spacing: 3px; text-transform: uppercase;
             padding: ${stories ? '10px 22px' : '9px 18px'}; background: rgba(10,16,30,.55); border-radius: 999px; }
    .cta { display: inline-block; border-radius: 999px; font-weight: 700; }
  `;

  if (layout === 'faixa') {
    const alturaFoto = Math.round(altura * (stories ? 0.58 : 0.55));
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${comum}
      .foto { inset: 0 0 auto 0; height: ${alturaFoto}px; }
      .marca { color: #fff; }
      .faixa { position: absolute; left: 0; right: 0; top: ${alturaFoto}px; bottom: 0; background: ${primaria}; padding: ${stories ? 80 : 64}px ${lados}px ${base}px; color: #fff; display: flex; flex-direction: column; justify-content: flex-start; }
      h1 { font-size: ${stories ? 78 : 60}px; line-height: 1.06; font-weight: 800; }
      p { margin-top: 24px; font-size: ${stories ? 36 : 30}px; line-height: 1.35; opacity: .92; }
      .cta { margin-top: ${stories ? 44 : 32}px; align-self: flex-start; padding: ${stories ? '24px 48px' : '20px 40px'}; background: ${destaque}; color: #fff; font-size: ${stories ? 34 : 30}px; }
    </style></head><body>
      <div class="foto"><img src="${imagemDataUrl}" alt=""></div>
      <div class="marca">${escapar(marca)}</div>
      <div class="faixa">
        <h1>${escapar(headline)}</h1>
        ${texto ? `<p>${escapar(texto)}</p>` : ''}
        ${cta ? `<div class="cta">${escapar(cta)}</div>` : ''}
      </div>
    </body></html>`;
  }

  if (layout === 'cartao') {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${comum}
      .veu { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.18) 0%, rgba(0,0,0,0) 40%); }
      .marca { color: #fff; }
      .cartao { position: absolute; left: ${lados}px; right: ${lados}px; bottom: ${base}px; background: ${claro}; color: ${primaria}; border-radius: 40px; padding: ${stories ? '64px 60px' : '52px 52px'}; box-shadow: 0 24px 64px rgba(0,0,0,.35); border-top: 12px solid ${destaque}; }
      h1 { font-size: ${stories ? 72 : 56}px; line-height: 1.06; font-weight: 800; }
      p { margin-top: 20px; font-size: ${stories ? 34 : 28}px; line-height: 1.35; opacity: .85; }
      .cta { margin-top: ${stories ? 40 : 30}px; padding: ${stories ? '22px 44px' : '18px 38px'}; background: ${destaque}; color: #fff; font-size: ${stories ? 32 : 28}px; }
    </style></head><body>
      <div class="foto"><img src="${imagemDataUrl}" alt=""></div><div class="veu"></div>
      <div class="marca">${escapar(marca)}</div>
      <div class="cartao">
        <h1>${escapar(headline)}</h1>
        ${texto ? `<p>${escapar(texto)}</p>` : ''}
        ${cta ? `<div class="cta">${escapar(cta)}</div>` : ''}
      </div>
    </body></html>`;
  }

  // sobreposto (padrão)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${comum}
    .veu { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) ${stories ? '45%' : '35%'}, rgba(10,16,30,0.72) 78%, rgba(10,16,30,0.92) 100%); }
    .marca { color: #fff; }
    .texto { position: absolute; left: ${lados}px; right: ${lados}px; bottom: ${base}px; color: #fff; }
    h1 { font-size: ${stories ? 74 : 62}px; line-height: 1.08; font-weight: 800; text-shadow: 0 3px 14px rgba(0,0,0,.55); max-width: ${stories ? 900 : 860}px; }
    p { margin-top: 22px; font-size: ${stories ? 34 : 30}px; line-height: 1.3; max-width: ${stories ? 860 : 780}px; text-shadow: 0 2px 8px rgba(0,0,0,.6); }
    .cta { margin-top: 34px; padding: ${stories ? '24px 48px' : '20px 40px'}; background: ${destaque}; color: #fff; font-size: ${stories ? 34 : 30}px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
  </style></head><body>
    <div class="foto"><img src="${imagemDataUrl}" alt=""></div><div class="veu"></div>
    <div class="marca">${escapar(marca)}</div>
    <div class="texto">
      <h1>${escapar(headline)}</h1>
      ${texto ? `<p>${escapar(texto)}</p>` : ''}
      ${cta ? `<div class="cta">${escapar(cta)}</div>` : ''}
    </div>
  </body></html>`;
}

// Recebe várias peças de uma vez (uma por copy aprovada x formato) e abre o Chromium uma única vez.
// pecas: [{ chave, formato, layout, imagem (Buffer), mime, headline, texto, cta }]
async function montarLote(pecas, { marca, cores } = {}) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'], protocolTimeout: 120000 });
  try {
    const saida = [];
    for (const p of pecas) {
      if (!FORMATOS[p.formato]) continue;
      const { largura, altura } = FORMATOS[p.formato];
      const imagemDataUrl = `data:${p.mime || 'image/png'};base64,${p.imagem.toString('base64')}`;
      const page = await browser.newPage();
      await page.setViewport({ width: largura, height: altura, deviceScaleFactor: 1 });
      await page.setContent(html({ ...p, imagemDataUrl, marca, cores }), { waitUntil: 'load' });
      await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((ok) => { i.onload = ok; i.onerror = ok; })))));
      const png = await page.screenshot({ type: 'png', captureBeyondViewport: false });
      await page.close();
      saida.push({ chave: p.chave, formato: p.formato, layout: p.layout || 'sobreposto', png: Buffer.from(png) });
    }
    return saida;
  } finally {
    await browser.close();
  }
}

module.exports = { montarLote, FORMATOS, LAYOUTS };
