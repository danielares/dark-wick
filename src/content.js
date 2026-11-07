// Dark Wick — content script.
//
// Em vez de ler e reescrever o CSS do site (o que torna o Dark Reader pesado),
// escurecemos a página com UM filtro no <html>, composto pela GPU. Mídias
// recebem o filtro inverso para manter as cores reais. Não lemos folhas de
// estilo; a única varredura do DOM (fotos em background-image e Shadow DOM)
// roda em tempo ocioso, só nos elementos novos e só com o filtro ativo.
(() => {
  // Após atualizar/recarregar a extensão, a cópia antiga fica órfã (sem acesso
  // a chrome.*) mas o window do mundo isolado é o mesmo: só desistimos se a
  // cópia existente ainda estiver viva; senão ela se desliga e assumimos.
  const alive = () => !!chrome.runtime?.id;
  if (window.__darkWick?.()) return;
  window.__darkWick = alive;
  document.getElementById('dark-wick')?.remove();

  // document.open()/write() troca o <html> inteiro (e leva nosso <style> junto):
  // root é atualizado pelo observer (ver ensureRoot).
  let root = document.documentElement;
  if (!root || !/^(text\/(html|plain)|application\/xhtml\+xml)$/.test(document.contentType)) return;

  // Iframes: o filtro do <html> da página de cima já escurece o conteúdo do
  // iframe junto (o filtro vale para tudo que é desenhado dentro do elemento).
  // Por isso um frame filho nunca aplica o filtro da página: só reverte as
  // próprias mídias, e só quando o pai avisa que o iframe está sendo exibido
  // invertido (se o pai reverteu o iframe, como um player, nada muda).
  const isTop = window === window.top;
  const MSG = '__darkWick';

  // Cópia de src/shared.js (content scripts não importam módulos).
  const DEFAULTS = { enabled: true, brightness: 100, contrast: 86, sepia: 8, grayscale: 0, photos: 90 };

  const host = location.hostname.replace(/^www\./, '');
  const SITE_KEY = `site:${host}`;
  const DARK_KEY = `dark:${host}`;

  const REVERT = 'invert(1) hue-rotate(180deg)';
  // Ícone pequeno em background-image inline (seta, lupa em <span>/<i>) é
  // marcado pela varredura e inverte com o texto, como um ícone em <img>.
  const GLYPH_MARK = 'data-dw-glyph';
  const BG_INLINE_RAW = ['background-image: url', 'background-image:url', 'background: url', 'background:url']
    .map((s) => `[style*="${s}"]`);
  const BG_INLINE = BG_INLINE_RAW.map((s) => `${s}:not([${GLYPH_MARK}])`);
  // Players e anúncios em iframe são imagem/vídeo: mantêm as cores originais.
  const EMBEDS = [
    'youtube.com', 'youtube-nocookie.com', 'player.vimeo.com', 'dailymotion.com', 'player.twitch.tv', 'open.spotify.com',
    'googlesyndication.com', 'doubleclick.net', 'amazon-adsystem.com', 'adnxs.com', 'criteo', '2mdn.net',
  ].map((s) => `iframe[src*="${s}"]`).concat('iframe[id^="google_ads_iframe"]');
  // Marcados pela varredura: elementos grandes com foto em background-image e
  // elementos com fundo de cor viva ou escuro (identidade visual do site).
  const BG_MARK = 'data-dw-bg';
  const KEEP_MARK = 'data-dw-keep';
  const BG = [...BG_INLINE, `[${BG_MARK}]`, `[${KEEP_MARK}]`];
  // SVGs via <img> costumam ser ícones/logos: deixamos inverter junto com o
  // texto. Só conta o arquivo .svg em si (a Wikipédia serve fotos e bandeiras
  // como ".../Arquivo.svg/250px-Arquivo.svg.png"). A varredura também marca
  // como "inverte com a página" (ICON_MARK) ícones pequenos de uma cor, logos
  // escuros sobre transparência e diagramas/gráficos claros.
  const ICON_MARK = 'data-dw-icon';
  const CURTAIN_MARK = 'data-dw-curtain';
  // PDF embutido é documento (texto em fundo branco), não foto: escurece junto.
  const NOT_PDF = ':not([type="application/pdf"],[src*=".pdf"],[data*=".pdf"])';
  const MEDIA = [`img:not([src$=".svg"],[src*=".svg?"],[src*=".svg#"],[src^="data:image/svg"],[${ICON_MARK}])`, 'picture', 'video', `embed${NOT_PDF}`, `object${NOT_PDF}`, 'svg image', ...BG, ...EMBEDS].join(',');
  // Mídia dentro de mídia já revertida seria invertida duas vezes.
  const NESTED = ['picture img', ...BG.map((s) => `${s} :is(img,picture,video,embed,object,iframe,${BG.join(',')})`)].join(',');

  // O filtro corta valores fora de [0,1] entre uma etapa e outra, o que
  // desbota cores vivas nas mídias. A página recebe saturate(SAT) e as mídias
  // dessaturam antes de reverter, ficando dentro da faixa; elas também
  // desfazem o contraste reduzido (pensado para o texto, não para fotos).
  const SAT = 1.6;
  // brightness() vem antes do reverso: a página inverte de novo depois, então
  // é aqui que a foto escurece de fato ("Fotos" no popup; não ofuscam no escuro).
  const mediaFilter = (s) =>
    `${s.photos < 100 ? `brightness(${s.photos / 100}) ` : ''}contrast(${100 / s.contrast}) saturate(${1 / SAT}) ${REVERT}`;
  // Fundos marcados (cor viva/escuro) usam um reverso próprio: o inverso exato
  // pede valores fora de [0,1] (luminância invertida + croma), que o corte do
  // filtro desbota (amarelo vira creme). Sem desfazer o contraste e com menos
  // dessaturação, tom e saturação sobrevivem melhor.
  const KEEP_FILTER = `brightness(0.9) saturate(0.8) ${REVERT}`;
  // :where() zera a especificidade de MEDIA para que NESTED sempre vença
  // (sem isso, "img:not([src*=.svg])" ganhava de "picture img" e a imagem
  // dentro de <picture> era invertida duas vezes).
  const mediaRules = (s) => `:where(${MEDIA}){filter:${mediaFilter(s)}!important}
[${KEEP_MARK}]:not([${BG_MARK}]){filter:${KEEP_FILTER}!important}
${NESTED}{filter:none!important}
:fullscreen,:fullscreen *{filter:none!important}`;

  // Elementos na top layer (modais, popovers, tela cheia) não herdam o filtro
  // do <html>: modais/popovers recebem o mesmo filtro e a tela cheia fica original.
  // Cortinas escuras de modal/menu ficam com a cor original (invertidas virariam
  // um véu branco), e os filhos diretos recebem o filtro da página de novo, para
  // o cartão do modal escurecer normalmente.
  const css = (s) => {
    const filter = `${REVERT} saturate(${SAT}) brightness(${s.brightness / 100}) contrast(${s.contrast / 100}) sepia(${s.sepia / 100}) grayscale(${s.grayscale / 100})`;
    return `@media screen{
html{filter:${filter}!important;scrollbar-color:#3b3b42 #141417!important}
:where(html){background-color:#fff}
:where(body){scrollbar-color:auto}
${mediaRules(s)}
dialog:modal:not(:fullscreen),[popover]:popover-open:not(:fullscreen){filter:${filter}!important}
[${CURTAIN_MARK}]{filter:${mediaFilter(s)}!important}
[${CURTAIN_MARK}]>:not(img,picture,video,embed,object,iframe){filter:${filter}!important}
[${CURTAIN_MARK}]>:is(img,picture,video,embed,object,iframe){filter:none!important}
::backdrop{filter:none!important}
}`;
  };

  const style = document.createElement('style');
  style.id = 'dark-wick';
  // Folhas de estilo da página não alcançam Shadow DOM: cada shadow root
  // aberto recebe um <style> só com as regras de mídia.
  const shadowStyles = new Set();

  let settings = { ...DEFAULTS };
  let mode = 'auto';
  let nativeDark = false;
  let cachedDark = false; // valor guardado em DARK_KEY
  let inherited = false; // frame filho: o pai exibe este iframe invertido

  const isActive = () =>
    isTop ? settings.enabled && mode !== 'off' && !(mode === 'auto' && nativeDark) : inherited;

  function render() {
    ensureRoot();
    const active = isActive();
    const text = !active ? '' : isTop ? css(settings) : `@media screen{${mediaRules(settings)}}`;
    if (style.textContent !== text) style.textContent = text;
    if (!style.isConnected && document.documentElement) document.documentElement.appendChild(style);

    const shadowText = active ? `@media screen{${mediaRules(settings)}}` : '';
    for (const ref of shadowStyles) {
      const s = ref.deref();
      if (!s) shadowStyles.delete(ref);
      else if (s.textContent !== shadowText) s.textContent = shadowText;
    }

    if (active !== scanning) setScanning(active);
    scheduleNotify();
  }

  async function load() {
    try {
      const [sync, local] = await Promise.all([
        chrome.storage.sync.get(['global', SITE_KEY]),
        chrome.storage.local.get(DARK_KEY),
      ]);
      const site = sync[SITE_KEY] || {};
      settings = { ...DEFAULTS, ...sync.global, ...site.custom };
      mode = site.mode || 'auto';
      nativeDark = cachedDark = !!local[DARK_KEY];
    } catch {
      return; // extensão recarregada: este script ficou órfão
    }
    render();
    if (mode === 'auto' && document.readyState !== 'loading') scheduleDetect();
  }

  // ---------- detecção de site já escuro ----------
  // Amostra poucos pontos da tela, só em momentos-chave (DOMContentLoaded,
  // load, +2s e navegações de SPA). Custo: alguns getComputedStyle.

  const POINTS = [[0.5, 0.5], [0.25, 0.3], [0.75, 0.3], [0.25, 0.75], [0.75, 0.75], [0.5, 0.08]];
  const SKIP_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'PICTURE', 'IFRAME', 'EMBED', 'OBJECT']);
  let probeCtx;

  function parseColor(str) {
    const m = /^rgba?\(([^)]+)\)/.exec(str);
    if (m) {
      const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
      return [r, g, b, a];
    }
    // oklch(), color(), lab()...: deixa o canvas converter para RGB.
    probeCtx ??= new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
    probeCtx.clearRect(0, 0, 1, 1);
    probeCtx.fillStyle = str;
    probeCtx.fillRect(0, 0, 1, 1);
    const d = probeCtx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }

  const luma = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  // Camada fixa que cobre quase a tela toda (cortina de menu lateral/modal):
  // escurece a página só enquanto aberta, então não diz nada sobre o tema.
  function isCurtain(el) {
    const r = el.getBoundingClientRect();
    return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
  }

  function backgroundAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (SKIP_TAGS.has(el.tagName)) return null;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' && isCurtain(el)) continue;
      const bg = parseColor(cs.backgroundColor);
      if (bg[3] >= 0.5) return bg;
      const img = cs.backgroundImage;
      if (img !== 'none') {
        if (img.includes('url(')) return null;
        const g = gradientColor(img);
        if (g) return g;
      }
    }
    return canvasColor();
  }

  // Cor do fundo da janela: a do <html> ou, se transparente, a do <body>
  // (o navegador propaga o fundo do body para a tela toda); senão branco.
  function canvasColor() {
    for (const el of [root, document.body]) {
      const bg = el && parseColor(getComputedStyle(el).backgroundColor);
      if (bg?.[3] >= 0.5) return bg;
    }
    // Fundo transparente com texto claro: o escuro está em algum wrapper (ou
    // num canvas/imagem) — texto claro sobre branco não existe na prática.
    const text = document.body && parseColor(getComputedStyle(document.body).color);
    if (text && luma(text) > 0.6) return [24, 24, 24, 1];
    return [255, 255, 255, 1];
  }

  // Cor média de um gradiente (null se não houver cores legíveis).
  function gradientColor(img) {
    const stops = img.match(/rgba?\([^)]+\)/g);
    if (!stops) return null;
    const cs = stops.map(parseColor);
    return [0, 1, 2].map((i) => cs.reduce((sum, c) => sum + c[i], 0) / cs.length).concat(1);
  }

  // Fundo da página como um todo: o primeiro fundo opaco de um elemento da
  // altura do documento (ou html/body). Um hero escuro no topo de uma página
  // clara não conta. early: página pela metade, só html/body valem.
  function pageBackground(early) {
    if (!early) {
      const tall = root.scrollHeight * 0.8;
      for (const el of document.elementsFromPoint(innerWidth / 2, innerHeight / 2)) {
        const r = el.getBoundingClientRect();
        if (r.height < tall || el === root || el === document.body) continue;
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' && isCurtain(el)) continue;
        const bg = parseColor(cs.backgroundColor);
        if (bg[3] >= 0.5) return bg;
      }
    }
    for (const el of [document.body, root]) {
      const bg = parseColor(getComputedStyle(el).backgroundColor);
      if (bg[3] >= 0.5) return bg;
    }
    return canvasColor();
  }

  function pageLooksDark(early) {
    const w = innerWidth;
    const h = innerHeight;
    let dark = 0;
    let total = 0;
    // O site já se inverte sozinho com filtro (modo escuro próprio barato).
    if ((invertCount(getComputedStyle(root).filter) + invertCount(getComputedStyle(document.body).filter)) % 2) return true;
    for (const [px, py] of POINTS) {
      const c = backgroundAt(w * px, h * py);
      if (!c) continue;
      total++;
      if (luma(c) < 0.4) dark++;
    }
    if (!total) return false;
    const ratio = dark / total;
    const bgDark = luma(pageBackground(early)) < 0.4;
    if (ratio >= 0.6 && bgDark) return true;
    // O site declara tema escuro: basta a amostra concordar em parte.
    return (ratio >= 0.5 || (bgDark && ratio >= 0.3)) && declaresDark();
  }

  // Sinais declarados de tema escuro: <meta name="color-scheme" content="dark">,
  // color-scheme: dark no CSS, e classes/atributos de tema no <html>/<body>.
  // "light dark" (site que suporta os dois) não conta.
  const DARK_CLASS = /(^|\s)(dark|dark-mode|dark-theme|theme-dark|is-dark|dark_mode|night-mode|theme--dark)(\s|$)/i;
  const THEME_ATTRS = ['data-theme', 'data-bs-theme', 'data-color-scheme', 'data-color-mode', 'data-mode'];
  function declaresDark() {
    const only = /^(only\s+)?dark$/i;
    if (only.test(document.querySelector('meta[name="color-scheme"]')?.content?.trim() || '')) return true;
    if (only.test(getComputedStyle(root).colorScheme)) return true;
    return [root, document.body].some(
      (el) => DARK_CLASS.test(classOf(el)) || THEME_ATTRS.some((a) => /^dark/i.test(el.getAttribute(a) || '')),
    );
  }

  // early: chamado durante o carregamento. Só pode concluir "escuro" (página
  // pela metade parece clara); a volta para "claro" espera o DOMContentLoaded.
  function detect(early) {
    if (!isTop || mode !== 'auto' || !document.body) return;
    // Desliga nossa folha durante a leitura para ver as cores originais.
    // É síncrono, então nada é pintado nesse intervalo.
    const sheet = style.sheet;
    if (sheet) sheet.disabled = true;
    let dark;
    try {
      dark = pageLooksDark(early);
    } finally {
      if (sheet) sheet.disabled = false;
    }
    // Cache por site: na próxima visita evitamos o "flash" claro em sites
    // escuros. Só a leitura completa grava: tela de carregamento escura, lida
    // no meio do carregamento, deixava o site "escuro" no cache e a extensão
    // parava de funcionar a cada recarga.
    if (!early && dark !== cachedDark) {
      cachedDark = dark;
      try {
        dark ? chrome.storage.local.set({ [DARK_KEY]: true }) : chrome.storage.local.remove(DARK_KEY);
      } catch {}
    }
    if (dark === nativeDark || (early && !dark)) return;
    nativeDark = dark;
    render();
  }

  let detectTimer = 0;
  function scheduleDetect(delay = 0) {
    clearTimeout(detectTimer);
    detectTimer = setTimeout(detect, delay);
  }

  // Rechecagens até a página assentar: SPAs pesadas montam a tela (ou tiram a
  // tela de carregamento) segundos depois do load. Cada uma custa alguns
  // getComputedStyle.
  const settleTimers = [];
  function detectUntilSettled() {
    if (!isTop) return;
    settleTimers.forEach(clearTimeout);
    settleTimers.length = 0;
    for (const ms of [2000, 5000, 10000]) settleTimers.push(setTimeout(() => detect(), ms));
  }

  // ---------- varredura: fotos de fundo, cores da marca e Shadow DOM ----------
  // Fundos definidos no CSS do site não são selecionáveis por CSS, então
  // marcamos elementos para ficarem com as cores originais (o elemento inteiro
  // é revertido, incluindo texto e logo por cima):
  // - fotos grandes em background-image, inclusive em ::before/::after (cards
  //   com texto sobre a foto, como no g1);
  // - fundos de cor viva (cabeçalhos e botões da marca) ou já escuros
  //   (rodapés, barras de navegação). Só o que é claro é invertido.
  // Ícones/sprites (pequenos) e texturas repetidas invertem junto com a página.
  // Roda em requestIdleCallback, em fatias, e só com o filtro ativo.

  const BG_MIN = 48;
  const COVER_MIN_W = 240; // foto/vídeo de fundo: tamanho mínimo
  const COVER_MIN_H = 160;
  const ICON_MAX = 32; // <img> até este tamanho é ícone: inverte com o texto
  const KEEP_CHROMA = 0.4; // saturação mínima para contar como cor da marca
  const KEEP_DARK = 0.3; // luminância abaixo da qual o fundo já é escuro
  const EAGER_MAX = 1500; // elementos inspecionados por quadro no modo imediato
  const seenShadows = new WeakSet();
  const unsized = new WeakSet(); // vistos sem tamanho no modo imediato
  let eagerUntil = 0;
  let fresh = [];
  let writes = []; // marcas aplicadas em lote: ler tudo antes de escrever evita recalcular estilo a cada elemento
  let rafId = 0;
  let earlyDetectAt = 0;
  const jobs = [];
  let idleId = 0;
  let scanning = false;

  // Retorna false se, no modo imediato, o elemento estava fora da tela.
  function inspect(el, eager) {
    if (!el.isConnected) return;
    const sr = el.shadowRoot;
    if (sr && !seenShadows.has(sr)) adoptShadow(sr);
    if (el === document.body) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return void (eager && unsized.add(el));
    if (eager && (r.top >= innerHeight || r.bottom <= 0)) return false;
    if (r.width >= innerWidth * 0.9 && r.height > innerHeight * 1.5) return; // fundo da página inteira
    if (el.tagName === 'IMG' || el.tagName === 'VIDEO') {
      if (el.tagName === 'IMG') {
        const small = r.width <= ICON_MAX && r.height <= ICON_MAX;
        mark(el, ICON_MARK, small ? isIcon(el, r) : isGraphic(el));
      }
      if (r.width >= COVER_MIN_W && r.height >= COVER_MIN_H) markCover(el, r);
      return;
    }
    const cs = getComputedStyle(el);
    // Reavaliado a cada varredura: a cor de fundo pode mudar (aba ativa etc.).
    // Cortinas de modal/menu não: levariam junto o cartão claro de dentro.
    const curtain = cs.position === 'fixed' && isCurtain(el);
    mark(el, KEEP_MARK, !curtain && keepsColor(cs));
    mark(el, CURTAIN_MARK, curtain && isScrim(cs));
    if (el.hasAttribute(BG_MARK)) return;
    if (r.width < BG_MIN || r.height < BG_MIN) {
      // Avatar pequeno em background-image (foto de usuário em <span>) mantém
      // as cores; qualquer outro ícone inline pequeno inverte com o texto.
      const photo = r.width >= SMALL_MIN && r.height >= SMALL_MIN && isSmallPhoto(el, cs, r);
      if (photo) mark(el, BG_MARK, true);
      mark(el, GLYPH_MARK, !photo && el.matches(BG_INLINE_RAW.join(',')));
      return;
    }
    mark(el, GLYPH_MARK, false); // cresceu: deixou de ser ícone
    const before = getComputedStyle(el, '::before');
    const after = getComputedStyle(el, '::after');
    // Atributo legado background="foto.jpg" (tabelas e e-mails antigos).
    const legacy = el.hasAttribute('background') && cs.backgroundImage.includes('url(');
    if (legacy || isPhoto(cs, r) || isPhoto(before, r) || isPhoto(after, r) || isContentPhoto(before) || isContentPhoto(after)) {
      mark(el, BG_MARK, true);
    }
  }

  // ::before/::after { content: url(foto.jpg) } grande: imagem como conteúdo.
  // Pequena (ícone) ou SVG inverte com o texto.
  function isContentPhoto(cs) {
    if (!cs.content.startsWith('url(') || SVG_SRC.test(cs.content.slice(4).replace(/["')]/g, ''))) return false;
    return parseFloat(cs.width) >= BG_MIN && parseFloat(cs.height) >= BG_MIN;
  }

  // Foto/vídeo usado como fundo (hero com object-fit: cover ou absoluto atrás
  // do texto): o maior ancestral do mesmo tamanho é revertido inteiro, para o
  // texto por cima manter as cores originais (senão o branco vira preto).
  function markCover(el, r) {
    const cs = getComputedStyle(el);
    if (cs.objectFit !== 'cover' && cs.position !== 'absolute' && cs.position !== 'fixed') return;
    let host = null;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const q = p.getBoundingClientRect();
      // Só ancestrais do mesmo tamanho da mídia (nem maiores, nem achatados:
      // filtro num wrapper de altura 0 some com o carrossel inteiro).
      if (Math.abs(q.width - r.width) > r.width * 0.05 + 2 || Math.abs(q.height - r.height) > r.height * 0.05 + 2) break;
      host = p;
    }
    if (!host || host.hasAttribute(BG_MARK) || !host.textContent.trim()) return;
    if (r.width >= innerWidth * 0.9 && r.height > innerHeight * 1.5) return;
    if (hasCard(host, r)) return;
    mark(host, BG_MARK, true);
  }

  // Texto num cartão opaco grande sobre a foto (tela de login, modal): o cartão
  // escurece normalmente e a foto se reverte sozinha, sem reverter o conjunto.
  function hasCard(host, r) {
    const area = r.width * r.height;
    for (const el of host.querySelectorAll('*')) {
      if (SKIP_TAGS.has(el.tagName)) continue;
      const q = el.getBoundingClientRect();
      const a = q.width * q.height;
      if (a < area * 0.15 || a > area * 0.9) continue;
      if (parseColor(getComputedStyle(el).backgroundColor)[3] >= 0.9) return true;
    }
    return false;
  }

  function mark(el, attr, on) {
    if (el.hasAttribute(attr) !== on) writes.push(el, attr, on);
  }

  function flush() {
    if (!writes.length) return;
    for (let i = 0; i < writes.length; i += 3) writes[i].toggleAttribute(writes[i + 1], writes[i + 2]);
    writes = [];
    scheduleNotify(); // um iframe pode ter entrado/saído de uma área revertida
  }

  function keepsColor(cs) {
    let c = parseColor(cs.backgroundColor);
    if (c[3] < 0.5) {
      const img = cs.backgroundImage;
      c = img !== 'none' && !img.includes('url(') && gradientColor(img);
      if (!c) return false;
    }
    const chroma = (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) / 255;
    return chroma >= KEEP_CHROMA || luma(c) < KEEP_DARK;
  }

  function isScrim(cs) {
    const c = parseColor(cs.backgroundColor);
    return c[3] >= 0.1 && luma(c) < KEEP_DARK;
  }

  function isPhoto(cs, hostRect) {
    if (!cs.backgroundImage.includes('url(')) return false;
    if (cs.backgroundSize === 'auto' && cs.backgroundRepeat !== 'no-repeat') return false; // textura
    // Pseudo-elementos: o tamanho é o deles (ícone num botão grande não conta).
    const w = parseFloat(cs.width) || hostRect.width;
    const h = parseFloat(cs.height) || hostRect.height;
    return w >= BG_MIN && h >= BG_MIN;
  }

  // ---------- ícone ou foto? (imagens pequenas) ----------
  // Ícone (glifo de uma cor só) inverte junto com o texto; foto pequena
  // (avatar, emoji, miniatura) e ícone colorido mantêm as cores originais,
  // senão ficam em negativo. Quando o navegador deixa ler os pixels (mesma
  // origem, data:, blob:, CORS), eles decidem; senão valem as pistas: JPEG,
  // forma redonda (avatar) e nomes como "avatar"/"profile" no endereço/classe.
  const SMALL_MIN = 12;
  const PHOTO_HINT = /avatar|profile|gravatar|photo|foto|portrait|emoji|flag|thumb/i;
  const PHOTO_EXT = /^data:image\/jpe?g|\.jpe?g([?#]|$)|[?&](fm|format)=jpe?g/i;
  const SVG_SRC = /^data:image\/svg|\.svg([?#]|$)/i;
  const pixelCache = new Map(); // src -> true (ícone) | false (foto) | null (ilegível)
  let pixelCtx;

  const classOf = (e) => e?.getAttribute?.('class') || '';

  function isIcon(img, r) {
    const src = img.currentSrc || img.src || '';
    if (!src || SVG_SRC.test(src)) return true;
    const px = pixelVerdict(img, src);
    if (px != null) return px;
    if (PHOTO_EXT.test(src) || isRound(img, r)) return false;
    return !PHOTO_HINT.test(`${src} ${img.alt} ${classOf(img)}`) && !/avatar/i.test(classOf(img.parentElement));
  }

  // Avatar em background-image: foto pequena que não é sprite nem textura.
  function isSmallPhoto(el, cs, r) {
    const m = /url\(["']?([^"')]+)/.exec(cs.backgroundImage);
    if (!m || SVG_SRC.test(m[1])) return false;
    if (cs.backgroundSize === 'auto' && cs.backgroundRepeat !== 'no-repeat') return false; // textura
    // Sprite (vários ícones numa imagem, deslocada com background-position).
    if (cs.backgroundPosition.split(/[\s,]+/).some((v) => v.endsWith('px') && parseFloat(v) !== 0)) return false;
    return PHOTO_EXT.test(m[1]) || PHOTO_HINT.test(`${m[1]} ${classOf(el)}`) || isRound(el, r);
  }

  // Ele ou um ancestral do mesmo tamanho (moldura que recorta) é redondo.
  function isRound(el, r) {
    for (let e = el, i = 0; e && e !== document.body && i < 3; e = e.parentElement, i++) {
      const q = i ? e.getBoundingClientRect() : r;
      if (q.width > r.width + 8 || q.height > r.height + 8) break;
      const rad = getComputedStyle(e).borderTopLeftRadius;
      const v = parseFloat(rad);
      if (rad.endsWith('%') ? v >= 30 : v >= Math.min(q.width, q.height) * 0.3) return true;
    }
    return false;
  }

  // Imagem grande que deve escurecer com a página em vez de manter as cores:
  // logo escuro sobre transparência (sumiria no fundo escuro) e diagrama,
  // gráfico ou print quase todo branco (viraria um bloco branco). Só com
  // pixels legíveis e critérios conservadores: na dúvida, é foto.
  function isGraphic(img) {
    const src = img.currentSrc || img.src || '';
    if (!src || SVG_SRC.test(src) || PHOTO_EXT.test(src)) return false;
    return pixelVerdict(img, src, 'graphic', classifyGraphic) === true;
  }

  function pixelVerdict(img, src, kind = 'small', classify = classifyPixels) {
    const key = `${kind}\n${src}`;
    if (pixelCache.has(key)) return pixelCache.get(key);
    let readable = /^(data|blob):/.test(src) || img.crossOrigin != null;
    try {
      readable ||= new URL(src, location.href).origin === location.origin;
    } catch {}
    if (!readable) return null;
    if (!img.complete || !img.naturalWidth) {
      img.addEventListener('load', () => queue([img]), { once: true });
      return null;
    }
    let v = null;
    try {
      // Amostra reduzida (no máximo 48 px no lado maior).
      const k = Math.min(1, 48 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k));
      const h = Math.max(1, Math.round(img.naturalHeight * k));
      pixelCtx ??= new OffscreenCanvas(48, 48).getContext('2d', { willReadFrequently: true });
      pixelCtx.clearRect(0, 0, 48, 48);
      pixelCtx.drawImage(img, 0, 0, w, h);
      v = classify(pixelCtx.getImageData(0, 0, w, h).data, w, h);
    } catch {} // canvas contaminado (redirecionamento para outra origem etc.)
    pixelCache.set(key, v);
    return v;
  }

  function classifyGraphic(d, w, h) {
    const n = w * h;
    let trans = 0;
    let white = 0;
    let dark = 0;
    let sum = 0;
    let sq = 0;
    const buckets = new Map(); // cores (3 bits por canal) fora do branco
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) {
        trans++;
        continue;
      }
      const l = luma([d[i], d[i + 1], d[i + 2]]);
      sum += l;
      sq += l * l;
      if (l < 0.3) dark++;
      if (l > 0.9) white++;
      else {
        const c = ((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5);
        buckets.set(c, (buckets.get(c) || 0) + 1);
      }
    }
    const opaque = n - trans;
    if (opaque < n * 0.02) return false;
    const rest = opaque - white;
    const major = [...buckets.values()].filter((c) => c >= rest * 0.03).length;
    // Logo/diagrama escuro e chapado sobre transparência (foto recortada tem
    // sombreado: mais tons e desvio maior).
    const sd = Math.sqrt(Math.max(0, sq / opaque - (sum / opaque) ** 2));
    if (trans >= n * 0.1 && dark >= opaque * 0.85 && sd < 0.12 && major <= 4) return true;
    // Diagrama/print: opaco, majoritariamente branco, poucas cores e feito de
    // traços finos (quase todo pixel não branco encosta no branco); foto de
    // produto em fundo branco tem áreas sólidas e sombreadas.
    if (trans >= n * 0.1 || white < n * 0.7 || major > 12 || !rest) return false;
    const isWhite = (x, y) => x < 0 || y < 0 || x >= w || y >= h || luma([d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]]) > 0.9;
    let edge = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (isWhite(x, y)) continue;
        if (isWhite(x - 1, y) || isWhite(x + 1, y) || isWhite(x, y - 1) || isWhite(x, y + 1)) edge++;
      }
    }
    return edge >= rest * 0.6;
  }

  function classifyPixels(d, w, h) {
    const px = [];
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 128) px.push(i);
    const total = w * h;
    if (px.length < total * 0.02) return true;
    const mean = [0, 1, 2].map((c) => px.reduce((s, i) => s + d[i + c], 0) / px.length);
    let spread = 0;
    let chroma = 0;
    const bins = new Array(8).fill(0);
    for (const i of px) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      spread += Math.abs(r - mean[0]) + Math.abs(g - mean[1]) + Math.abs(b - mean[2]);
      chroma += Math.max(r, g, b) - Math.min(r, g, b);
      bins[Math.min(7, (luma([r, g, b]) * 8) | 0)]++;
    }
    if (spread / px.length / 765 < 0.06) return true; // uma cor só: glifo
    if (chroma / px.length / 255 > 0.18) return false; // colorido: emoji, avatar, logo
    // Cinza: glifo tem poucos tons; foto P&B opaca tem muitos.
    const levels = bins.filter((n) => n >= px.length * 0.04).length;
    return !(px.length > total * 0.95 && levels >= 5);
  }

  function adoptShadow(sr) {
    seenShadows.add(sr);
    const s = document.createElement('style');
    s.textContent = isActive() ? `@media screen{${mediaRules(settings)}}` : '';
    sr.appendChild(s);
    shadowStyles.add(new WeakRef(s));
    observer.observe(sr, { childList: true, subtree: true });
    enqueue(sr);
  }

  function queue(list) {
    jobs.push({ list, i: 0 });
    if (!idleId) idleId = requestIdleCallback(work, { timeout: 1500 });
  }

  function enqueue(node) {
    queue(node.querySelectorAll('*'));
    if (node.nodeType === 1) queue([node]);
  }

  // Modo imediato (carregamento e logo após navegações): marca o que está na
  // tela num requestAnimationFrame, logo antes do paint (reaproveitando o
  // layout que o navegador faria de qualquer jeito). Evita o flash do
  // logo/cabeçalho invertido. O resto fica para a varredura ociosa.
  function frame() {
    rafId = 0;
    const nodes = fresh;
    fresh = [];
    const done = new WeakSet();
    let budget = EAGER_MAX;
    for (const n of nodes) {
      if (done.has(n)) continue;
      if (budget > 0 && scanning) budget -= inspectNow(n, budget, done);
      else enqueue(n);
    }
    flush();
    // Sites com JS pesado (YouTube) demoram segundos para o DOMContentLoaded, e
    // o CSS pode chegar depois dele; o load espera todos os anúncios. Detecta o
    // tema escuro durante todo o carregamento, aproveitando o layout.
    if (document.readyState !== 'complete' && performance.now() - earlyDetectAt > 200) {
      earlyDetectAt = performance.now();
      detect(true);
    }
  }

  function inspectNow(node, budget, done) {
    if (!node.isConnected) return 0;
    for (let p = node.parentElement; p; p = p.parentElement) {
      if (done.has(p)) return 0; // subárvore já coberta neste quadro
      // Pais que estavam vazios (sem tamanho) podem ter crescido com este filho.
      if (unsized.has(p)) { unsized.delete(p); inspect(p, true); }
    }
    done.add(node);
    const list = node.querySelectorAll('*');
    if (list.length >= budget || inspect(node, true) === false) return enqueue(node), 1; // abaixo da tela
    const later = [];
    for (const el of list) {
      done.add(el);
      if (inspect(el, true) === false) later.push(el);
    }
    if (later.length) queue(later);
    return list.length + 1;
  }

  function work(deadline) {
    idleId = 0;
    if (!scanning) return void (jobs.length = 0);
    let budget = deadline.didTimeout ? 300 : Infinity; // aba em segundo plano: fatia fixa
    while (jobs.length && budget-- > 0 && (deadline.didTimeout || deadline.timeRemaining() > 1)) {
      const job = jobs[jobs.length - 1];
      if (job.i >= job.list.length) jobs.pop();
      else inspect(job.list[job.i++]);
    }
    flush();
    if (jobs.length) idleId = requestIdleCallback(work, { timeout: 1500 });
  }

  // Também religa nosso <style> se um framework que hidrata o <html> removê-lo.
  const observer = new MutationObserver((mutations) => {
    if (!alive() || window.__darkWick !== alive) return observer.disconnect();
    if (!style.isConnected || document.documentElement !== root) render();
    if (!scanning) return;
    const eager = !document.hidden && (document.readyState !== 'complete' || performance.now() < eagerUntil);
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (eager) fresh.push(n);
        else enqueue(n);
      }
    }
    if (fresh.length && !rafId) rafId = requestAnimationFrame(frame);
  });
  const eagerFor = (ms) => (eagerUntil = performance.now() + ms);

  function setScanning(on) {
    scanning = on;
    observer.observe(root, { childList: true, subtree: on });
    if (on) enqueue(root);
  }

  const rescan = () => scanning && enqueue(root); // pega elementos que só ganharam tamanho/shadow depois

  // O <html> foi trocado (document.open/write): passa a observar o novo.
  function ensureRoot() {
    const el = document.documentElement;
    if (!el || el === root) return;
    root = el;
    observer.observe(root, { childList: true, subtree: scanning });
    if (scanning) enqueue(root);
  }

  // ---------- iframes ----------
  // Cada frame avisa os iframes filhos (postMessage, funciona entre origens)
  // se eles aparecem invertidos: conta quantos filtros invert() há entre o
  // iframe e a raiz (página, mídias e fundos revertidos, filtros do próprio
  // site). Ímpar = invertido, e o filho reverte suas fotos e vídeos.
  const sentState = new WeakMap(); // contentWindow -> último estado enviado
  const TOP_LAYER = ':modal,:popover-open,:fullscreen';
  let notifyTimer = 0;

  function scheduleNotify() {
    if (!notifyTimer) notifyTimer = setTimeout(notifyFrames, 100);
  }

  function frameElements() {
    const list = [...document.querySelectorAll('iframe,frame')];
    for (const ref of shadowStyles) {
      const sr = ref.deref()?.parentNode;
      if (sr) list.push(...sr.querySelectorAll('iframe'));
    }
    return list;
  }

  function notifyFrames() {
    notifyTimer = 0;
    for (const f of frameElements()) sendState(f, false);
  }

  function sendState(frame, force) {
    const win = frame.contentWindow;
    if (!win) return;
    const on = displaysInverted(frame);
    const key = on ? `on:${settings.contrast}:${settings.photos}` : 'off';
    if (!force && sentState.get(win) === key) return;
    sentState.set(win, key);
    try {
      win.postMessage({ [MSG]: 'state', on, contrast: settings.contrast, photos: settings.photos }, '*');
    } catch {}
  }

  const invertCount = (filter) => {
    let n = 0;
    for (const m of filter.matchAll(/invert\(([\d.]+)(%?)\)/g)) if (parseFloat(m[1]) / (m[2] ? 100 : 1) >= 0.5) n++;
    return n;
  };

  function displaysInverted(el) {
    let odd = !isTop && inherited;
    for (let e = el; e; e = e.parentElement || e.getRootNode().host) {
      if (invertCount(getComputedStyle(e).filter) % 2) odd = !odd;
      // A top layer (modal, tela cheia) não fica sob o filtro dos ancestrais.
      try {
        if (e.matches(TOP_LAYER)) break;
      } catch {}
    }
    return odd;
  }

  addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || !(MSG in d)) return;
    e.stopImmediatePropagation(); // mensagem nossa: não é da página
    if (!alive() || window.__darkWick !== alive) return;
    if (d[MSG] === 'hello') {
      const f = frameElements().find((x) => x.contentWindow === e.source);
      if (f) sendState(f, true);
    } else if (d[MSG] === 'state' && !isTop && e.source === window.parent) {
      inherited = !!d.on;
      for (const k of ['contrast', 'photos']) if (typeof d[k] === 'number') settings = { ...settings, [k]: d[k] };
      render();
    }
  }, true);

  // ---------- inicialização ----------

  observer.observe(root, { childList: true });
  observer.observe(document, { childList: true });
  render(); // otimista: aplica já no document_start, antes do primeiro paint
  if (isTop) load();
  else {
    try {
      window.parent.postMessage({ [MSG]: 'hello' }, '*');
    } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      scheduleDetect();
      setTimeout(() => document.readyState !== 'complete' && detect(true), 1000); // CSS atrasado
    }, { once: true });
  }
  if (document.readyState !== 'complete') {
    addEventListener('load', () => {
      eagerFor(3000); // conteúdo inserido por scripts logo após o load
      scheduleDetect();
      rescan();
      setTimeout(rescan, 2000);
      detectUntilSettled();
    }, { once: true });
  } else {
    setTimeout(rescan, 2000);
    detectUntilSettled();
  }
  window.navigation?.addEventListener('navigatesuccess', () => (eagerFor(3000), scheduleDetect(800), detectUntilSettled()));
  // Volta para a aba: confere se o <style> continua lá e se o tema mudou.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !alive()) return;
    render();
    scheduleDetect(300);
  });

  if (!isTop) return;

  // Voltando do bfcache: as preferências podem ter mudado enquanto a página
  // estava congelada.
  addEventListener('pageshow', (e) => e.persisted && load());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && ('global' in changes || SITE_KEY in changes)) load();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === 'preview') {
      settings = { ...settings, ...msg.tuning };
      render();
    } else if (msg?.type === 'status') {
      reply({ state: isActive() ? 'on' : settings.enabled && mode !== 'off' ? 'native' : 'off' });
    }
  });
})();
