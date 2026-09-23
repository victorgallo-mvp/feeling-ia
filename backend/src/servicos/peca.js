// src/servicos/peca.js
// Motor de composição de peça estática. NÃO existe um modelo por caso: existe um catálogo de blocos
// que se encaixam em qualquer ordem, e a IA monta a "spec" escolhendo os blocos do caso.
// O texto é desenhado aqui (renderiza perfeito); o gerador de imagem só entrega foto, nunca letra.
const puppeteer = require('puppeteer');

const FORMATOS = {
  feed: { largura: 1080, altura: 1080, base: 1 },
  stories: { largura: 1080, altura: 1920, base: 1.12 },
};

// Catálogo: o que a IA pode usar. `limites` é o que o validador cobra.
const BLOCOS = {
  marca: { o_que: 'logo do cliente (ou o nome em letra de marca) no topo', limites: { lado: ['esquerda', 'direita'] } },
  titulo: { o_que: 'título da peça, em até 2 linhas, a 2ª em cor de destaque', limites: { linha1: 42, linha2: 42 } },
  subtitulo: { o_que: 'uma linha de apoio abaixo do título', limites: { texto: 120 } },
  texto: { o_que: 'parágrafo curto; marque palavras em **negrito** para destacar', limites: { texto: 320 } },
  imagem: { o_que: 'foto: hero (grande no meio), faixa (larga e baixa), inset (pequena ao lado), fundo (atrás de tudo)', limites: { modo: ['hero', 'faixa', 'inset', 'fundo'] } },
  grade: { o_que: 'grade de itens com ícone ou foto + rótulo: serviços, variações, benefícios', limites: { itens: [2, 8], rotulo: 28, sub: 40 } },
  comparativo: { o_que: 'duas colunas lado a lado para comparar A e B', limites: { itens: 2, titulo: 18, subtitulo: 34, texto: 190 } },
  selo: { o_que: 'selo de condição ou preço em destaque (a partir de, % de desconto)', limites: { acima: 24, valor: 12, unidade: 8, abaixo: 24 } },
  lista_check: { o_que: 'lista de 2 a 5 itens com check, para fechar argumento', limites: { itens: [2, 5], texto: 110 } },
  cta: { o_que: 'botão com a chamada para ação', limites: { texto: 30 } },
  rodape: { o_que: 'faixa de rodapé com WhatsApp/telefone, cidade e abrangência, ou preço', limites: { chamada: 34, cidade: 40, abrangencia: 60, preco: 24 } },
};

// Ícones da casa (traço, herdam a cor): a grade de serviços usa isto em vez de 8 imagens de IA.
const ICONES = {
  eletrica: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
  ar: '<path d="M4 8h16M4 12h16M7 16h10"/><path d="M8 19a2 2 0 1 0 2-2"/><path d="M16 19a2 2 0 1 1-2-2"/>',
  camera: '<path d="M3 8a2 2 0 0 1 2-2h3l2-2h4l2 2h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z"/><circle cx="12" cy="12.5" r="3.5"/>',
  acesso: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.5"/>',
  portao: '<path d="M3 21V8l9-4 9 4v13"/><path d="M3 12h18M3 16.5h18M8 8v13M16 8v13"/>',
  iluminacao: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3 11v2h6v-2a6 6 0 0 0-3-11Z"/>',
  carro_eletrico: '<path d="M4 16v-3l2-5h9l2 5v3"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="15.5" cy="17.5" r="1.5"/><path d="M20 6l-2 3h3l-2 3"/>',
  portaria: '<path d="M4 21V6l8-3 8 3v15"/><path d="M9 21v-6h6v6"/><path d="M4 12h16"/>',
  manutencao: '<path d="M14 6a4 4 0 1 0 4 4l3 3-3 3-3-3a4 4 0 0 1-4-4"/><path d="M11 11 4 18l2 2 7-7"/>',
  seguranca: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-4"/>',
  entrega: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
  produto: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 21v-9"/>',
  telha: '<path d="M2 9l10-5 10 5-10 4L2 9Z"/><path d="M2 14l10 4 10-4"/>',
  obra: '<path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M10 21v-5h4v5"/>',
  loja: '<path d="M4 9h16v12H4z"/><path d="M4 9 6 4h12l2 5"/><path d="M9 21v-6h6v6"/>',
  atendimento: '<path d="M4 18v-6a8 8 0 0 1 16 0v6"/><path d="M4 16h3v5H5a1 1 0 0 1-1-1v-4Zm16 0h-3v5h2a1 1 0 0 0 1-1v-4Z"/>',
  orcamento: '<path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  estrela: '<path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.8l-5.6 2.5 1.1-6.2L3 9.7l6.2-.9L12 3Z"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  local: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
  whatsapp: '<path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3Z"/><path d="M8.5 9.5c0 4 3 6.5 6.5 6.5.6 0 1-.5 1-1l-1.5-1-1.2.8c-1.2-.5-2.4-1.7-2.9-2.9l.8-1.2-1-1.5c-.5 0-1 .4-1 1Z"/>',
  generico: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// **negrito** vira <b> (a IA marca o que quer destacar); o resto é escapado
const rico = (s) => esc(s).replace(/\*\*([^*]{1,80})\*\*/g, '<b>$1</b>');
const icone = (nome) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONES[nome] || ICONES.generico}</svg>`;
const imgTag = (src, classe) => (src ? `<img class="${classe}" src="${src}" alt="">` : `<div class="${classe} vazio"></div>`);

// ---------------------------------------------------------------- blocos
function bloco(b, ctx) {
  const img = (slot) => ctx.imagens[slot] || '';
  switch (b.tipo) {
    case 'marca':
      return `<div class="marca ${b.lado === 'direita' ? 'dir' : 'esq'}">${
        ctx.logo ? `<img src="${ctx.logo}" alt="">` : `<span>${esc(ctx.cliente)}</span>`}</div>`;

    case 'titulo':
      return `<h1>${esc(b.linha1)}${b.linha2 ? `<span class="d">${esc(b.linha2)}</span>` : ''}</h1>`;

    case 'subtitulo':
      return `<p class="sub">${rico(b.texto)}</p>`;

    case 'texto':
      return `<p class="txt">${rico(b.texto)}</p>`;

    case 'imagem': {
      const m = b.modo || 'hero';
      if (m === 'fundo') return '';
      return `<div class="img ${m}">${imgTag(img(b.slot), 'foto')}</div>`;
    }

    case 'grade': {
      const itens = (b.itens || []).slice(0, 8);
      const cols = b.colunas || (itens.length <= 4 ? Math.max(2, Math.min(4, itens.length)) : 4);
      return `<div class="grade" style="--cols:${cols}">${itens.map((i) => `
        <div class="celula">
          <div class="mini">${i.slot && img(i.slot) ? imgTag(img(i.slot), 'minifoto') : icone(i.icone)}</div>
          <span class="rot">${esc(i.rotulo)}</span>
          ${i.sub ? `<span class="rsub">${esc(i.sub)}</span>` : ''}
        </div>`).join('')}</div>`;
    }

    case 'comparativo': {
      const itens = (b.itens || []).slice(0, 2);
      return `<div class="comp">${itens.map((i) => {
        const temFoto = !!(i.slot && img(i.slot));
        return `
        <div class="col">
          <span class="ctit">${esc(i.titulo)}</span>
          ${i.subtitulo ? `<span class="csub">${esc(i.subtitulo)}</span>` : ''}
          <div class="cimg${temFoto ? '' : ' so-icone'}">${temFoto ? imgTag(img(i.slot), 'foto') : icone(i.icone)}</div>
          ${i.texto ? `<p class="ctxt">${rico(i.texto)}</p>` : ''}
        </div>`; }).join('<div class="divisor"></div>')}</div>`;
    }

    case 'selo':
      return `<div class="selo">
        ${b.acima ? `<span class="sa">${esc(b.acima)}</span>` : ''}
        <span class="sv">${esc(b.valor)}${b.unidade ? `<i>${esc(b.unidade)}</i>` : ''}</span>
        ${b.abaixo ? `<span class="sb">${esc(b.abaixo)}</span>` : ''}
      </div>`;

    case 'lista_check':
      return `<div class="checks">${(b.itens || []).slice(0, 5).map((t) => `
        <div class="ck"><span class="ci">${icone('check')}</span><span>${rico(t)}</span></div>`).join('')}</div>`;

    case 'cta':
      return `<div class="cta">${esc(b.texto)}</div>`;

    case 'rodape':
      return `<div class="rodape">
        ${b.chamada || b.whatsapp ? `<div class="rbloco">
          <span class="ri">${icone('whatsapp')}</span>
          <span class="rtexto"><b>${esc(b.chamada || 'Fale com a gente')}</b>${b.whatsapp ? `<i>${esc(b.whatsapp)}</i>` : ''}</span>
        </div>` : ''}
        ${b.cidade ? `<div class="rbloco">
          <span class="ri">${icone('local')}</span>
          <span class="rtexto"><b>${esc(b.cidade)}</b>${b.abrangencia ? `<i>${esc(b.abrangencia)}</i>` : ''}</span>
        </div>` : ''}
        ${b.preco ? `<div class="rbloco preco"><span class="rtexto"><b>${esc(b.preco)}</b></span></div>` : ''}
      </div>`;

    case 'linha':
      return `<div class="linha" style="--a:${b.proporcao || '1fr 1fr'}">${(b.partes || []).map((p) => `<div class="parte">${bloco(p, ctx)}</div>`).join('')}</div>`;

    default:
      return '';
  }
}

// ---------------------------------------------------------------- página
function pagina(spec, ctx) {
  const { largura, altura, base } = FORMATOS[spec.formato] || FORMATOS.feed;
  const t = ctx.tema;
  const fundoBloco = (spec.blocos || []).find((b) => b.tipo === 'imagem' && b.modo === 'fundo');
  const fundoSrc = fundoBloco ? (ctx.imagens[fundoBloco.slot] || '') : '';
  // o rodapé é sempre a última faixa, colada na base; o resto flui
  const blocos = (spec.blocos || []).filter((b) => b !== fundoBloco);
  const rodape = blocos.filter((b) => b.tipo === 'rodape');
  const corpo = blocos.filter((b) => b.tipo !== 'rodape');
  const respiro = spec.formato === 'stories' ? 200 : 0; // interface do Instagram cobre a base do stories

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root { --e: ${base}; --fundo: ${t.fundo}; --dest: ${t.destaque}; --claro: ${t.claro}; --tinta: ${t.tinta}; --lado: 64px; }
    body { width: ${largura}px; height: ${altura}px; overflow: hidden; background: var(--fundo); color: var(--claro);
           font-family: Helvetica, Arial, sans-serif; position: relative; }
    .fundo { position: absolute; inset: 0; }
    .fundo img { width: 100%; height: 100%; object-fit: cover; }
    .fundo::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, ${t.fundo}dd, ${t.fundo}f2); }
    #peca { position: absolute; inset: 0; padding: calc(56px * var(--e)) var(--lado) calc(${respiro}px + 40px * var(--e));
            display: flex; flex-direction: column; gap: calc(26px * var(--e)); }
    #corpo { display: flex; flex-direction: column; gap: calc(26px * var(--e)); flex: 1; justify-content: center; }
    .fim { margin-top: auto; }

    /* marca */
    .marca { display: flex; }
    .marca.dir { justify-content: flex-end; }
    .marca img { height: calc(96px * var(--e)); width: auto; max-width: 62%; object-fit: contain; }
    .marca span { font-size: calc(30px * var(--e)); font-weight: 800; letter-spacing: 3px; text-transform: uppercase;
                  border: 2px solid var(--dest); border-radius: 999px; padding: calc(10px * var(--e)) calc(24px * var(--e)); }

    /* título */
    h1 { font-size: calc(86px * var(--e)); line-height: 1.02; font-weight: 800; letter-spacing: -1.5px; text-transform: uppercase; }
    h1 .d { display: block; color: var(--dest); }
    .sub { font-size: calc(33px * var(--e)); line-height: 1.3; opacity: .92; }
    .txt { font-size: calc(28px * var(--e)); line-height: 1.4; opacity: .9; }
    b { color: var(--dest); font-weight: 800; }

    /* imagens */
    .img { overflow: hidden; border-radius: calc(24px * var(--e)); }
    .img .foto { width: 100%; height: 100%; object-fit: cover; display: block; }
    .img.hero { height: calc(420px * var(--e)); }
    .img.faixa { height: calc(260px * var(--e)); }
    .img.inset { height: calc(300px * var(--e)); }
    .vazio { width: 100%; height: 100%; background: ${t.fundo}; border: 2px dashed ${t.destaque}55; }

    /* grade */
    .grade { display: grid; grid-template-columns: repeat(var(--cols), 1fr); gap: calc(18px * var(--e)); }
    .celula { background: ${t.caixa}; border: 1px solid ${t.borda}; border-radius: calc(20px * var(--e));
              padding: calc(22px * var(--e)) calc(14px * var(--e)); display: flex; flex-direction: column;
              align-items: center; gap: calc(10px * var(--e)); text-align: center; }
    .mini { width: calc(74px * var(--e)); height: calc(74px * var(--e)); color: var(--dest); display: flex; align-items: center; justify-content: center; }
    .mini svg { width: 100%; height: 100%; }
    .minifoto { width: 100%; height: 100%; object-fit: cover; border-radius: calc(12px * var(--e)); }
    .rot { font-size: calc(25px * var(--e)); font-weight: 700; line-height: 1.15; text-transform: uppercase; letter-spacing: .3px; }
    .rsub { font-size: calc(20px * var(--e)); opacity: .75; line-height: 1.2; }

    /* comparativo */
    .comp { display: grid; grid-template-columns: 1fr auto 1fr; gap: calc(20px * var(--e)); align-items: start; }
    .col { display: flex; flex-direction: column; align-items: center; gap: calc(10px * var(--e)); text-align: center; }
    .ctit { font-size: calc(58px * var(--e)); font-weight: 800; color: var(--dest); line-height: 1; }
    .csub { font-size: calc(22px * var(--e)); font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; opacity: .85; }
    .cimg { width: 100%; height: calc(230px * var(--e)); color: var(--dest); border-radius: calc(18px * var(--e)); overflow: hidden; display: flex; align-items: center; justify-content: center; }
    .cimg.so-icone { height: auto; padding: calc(8px * var(--e)) 0; }
    .cimg svg { width: 55%; height: 55%; }
    .cimg.so-icone svg { width: calc(96px * var(--e)); height: calc(96px * var(--e)); }
    .ctxt { font-size: calc(23px * var(--e)); line-height: 1.35; opacity: .9; }
    .divisor { width: 2px; align-self: stretch; background: linear-gradient(180deg, transparent, ${t.destaque}88, transparent); }

    /* selo */
    .selo { border: calc(3px * var(--e)) solid var(--dest); border-radius: calc(24px * var(--e));
            padding: calc(20px * var(--e)) calc(28px * var(--e)); display: flex; flex-direction: column;
            align-items: center; gap: calc(4px * var(--e)); text-align: center; align-self: center; min-width: 56%; }
    .sa, .sb { font-size: calc(24px * var(--e)); font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
    .sv { font-size: calc(84px * var(--e)); font-weight: 800; color: var(--dest); line-height: 1; }
    .sv i { font-size: calc(34px * var(--e)); font-style: normal; }

    /* checks */
    .checks { background: ${t.caixa}; border: 1px solid ${t.borda}; border-radius: calc(20px * var(--e));
              padding: calc(22px * var(--e)) calc(26px * var(--e)); display: flex; flex-direction: column; gap: calc(12px * var(--e)); }
    .ck { display: flex; align-items: flex-start; gap: calc(14px * var(--e)); font-size: calc(25px * var(--e)); line-height: 1.3; }
    .ci { width: calc(32px * var(--e)); height: calc(32px * var(--e)); color: var(--dest); flex: none; }
    .ci svg { width: 100%; height: 100%; }

    /* cta */
    .cta { align-self: flex-start; background: var(--dest); color: ${t.sobreDestaque}; font-size: calc(32px * var(--e));
           font-weight: 800; padding: calc(20px * var(--e)) calc(42px * var(--e)); border-radius: 999px; text-transform: uppercase; letter-spacing: .5px; }

    /* rodapé */
    .rodape { display: flex; gap: calc(16px * var(--e)); }
    .rbloco { flex: 1; background: var(--claro); color: var(--tinta); border-radius: calc(18px * var(--e));
              padding: calc(18px * var(--e)) calc(22px * var(--e)); display: flex; align-items: center; gap: calc(14px * var(--e)); }
    .rbloco.preco { background: var(--dest); color: ${t.sobreDestaque}; justify-content: center; }
    .ri { width: calc(40px * var(--e)); height: calc(40px * var(--e)); flex: none; }
    .ri svg { width: 100%; height: 100%; }
    .rtexto { display: flex; flex-direction: column; line-height: 1.12; }
    .rtexto b { font-size: calc(29px * var(--e)); font-weight: 800; text-transform: uppercase; color: inherit; }
    .rtexto i { font-size: calc(23px * var(--e)); font-style: normal; opacity: .8; }

    /* linha (dois blocos lado a lado) */
    .linha { display: grid; grid-template-columns: var(--a); gap: calc(24px * var(--e)); align-items: center; }
    .parte { display: flex; flex-direction: column; gap: calc(18px * var(--e)); min-width: 0; }
  </style></head><body>
    ${fundoSrc ? `<div class="fundo"><img src="${fundoSrc}" alt=""></div>` : ''}
    <div id="peca">
      <div id="corpo">${corpo.map((b) => bloco(b, ctx)).join('')}</div>
      ${rodape.length ? `<div class="fim">${rodape.map((b) => bloco(b, ctx)).join('')}</div>` : ''}
    </div>
  </body></html>`;
}

const TEMA_PADRAO = {
  fundo: '#0e1b33', destaque: '#d6a53c', claro: '#f7f5f1', tinta: '#0e1b33',
  caixa: 'rgba(255,255,255,.06)', borda: 'rgba(255,255,255,.14)', sobreDestaque: '#10203a',
};

function tema(marca = {}) {
  const fundo = marca.cor_primaria || TEMA_PADRAO.fundo;
  const destaque = marca.cor_destaque || TEMA_PADRAO.destaque;
  return { ...TEMA_PADRAO, fundo, destaque, sobreDestaque: claroOuEscuro(destaque) };
}
// texto sobre a cor de destaque: escuro em cor clara, branco em cor escura
function claroOuEscuro(hex) {
  const m = String(hex).replace('#', '');
  if (m.length < 6) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#10203a' : '#ffffff';
}

// Ajuste automático: procura a escala de tipografia que faz o conteúdo caber sem sobrar buraco.
// É isto que faz qualquer combinação de blocos funcionar sem calibrar peça por peça.
async function ajustar(page) {
  let min = 0.5, max = 1.3, melhor = 0.5;
  for (let i = 0; i < 9; i++) {
    const e = (min + max) / 2;
    // eslint-disable-next-line no-await-in-loop
    const cabe = await page.evaluate((v) => {
      document.documentElement.style.setProperty('--e', String(v));
      const p = document.getElementById('peca');
      if (p.scrollHeight > p.clientHeight + 1) return false;
      // largura tambem conta: texto grande invadindo o bloco vizinho (logo por cima do titulo) passava batido
      const apertados = p.querySelectorAll('h1, .sub, .rot, .ctit, .csub, .sv, .cta, .rtexto b, .rtexto i, .sa, .sb');
      for (const el of apertados) if (el.scrollWidth > el.clientWidth + 2) return false;
      return true;
    }, e);
    if (cabe) { melhor = e; min = e; } else { max = e; }
  }
  await page.evaluate((v) => document.documentElement.style.setProperty('--e', String(v)), melhor);
  return melhor;
}

// pecas: [{ chave, spec:{formato, blocos[]}, imagens:{slot: dataUrl}, marca:{logo, cor_primaria, cor_destaque}, cliente }]
async function montarPecas(pecas) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'], protocolTimeout: 120000 });
  try {
    const saida = [];
    for (const p of pecas) {
      const f = FORMATOS[p.spec?.formato] || FORMATOS.feed;
      const ctx = { imagens: p.imagens || {}, logo: p.marca?.logo || '', cliente: p.cliente || '', tema: tema(p.marca) };
      const page = await browser.newPage();
      await page.setViewport({ width: f.largura, height: f.altura, deviceScaleFactor: 1 });
      await page.setContent(pagina(p.spec, ctx), { waitUntil: 'load' });
      await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((ok) => { i.onload = ok; i.onerror = ok; })))));
      const escala = await ajustar(page);
      const png = await page.screenshot({ type: 'png', captureBeyondViewport: false });
      await page.close();
      saida.push({ chave: p.chave, formato: p.spec.formato, escala, png: Buffer.from(png) });
    }
    return saida;
  } finally {
    await browser.close();
  }
}

module.exports = { montarPecas, FORMATOS, BLOCOS, ICONES };
