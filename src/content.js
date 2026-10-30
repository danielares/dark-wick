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

  const root = document.documentElement;
  if (!root || !/^(text\/(html|plain)|application\/xhtml\+xml)$/.test(document.contentType)) return;

  // Cópia de src/shared.js (content scripts não importam módulos).
  const DEFAULTS = { enabled: true, brightness: 100, contrast: 86, sepia: 8, grayscale: 0 };

  const host = location.hostname.replace(/^www\./, '');
  const SITE_KEY = `site:${host}`;
  const DARK_KEY = `dark:${host}`;

  const REVERT = 'invert(1) hue-rotate(180deg)';
  const BG_INLINE = ['background-image: url', 'background-image:url', 'background: url', 'background:url']
    .map((s) => `[style*="${s}"]`);
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
  // como ".../Arquivo.svg/250px-Arquivo.svg.png"). Imagens pequenas também
  // são tratadas como ícones pela varredura (ICON_MARK).
  const ICON_MARK = 'data-dw-icon';
  const MEDIA = [`img:not([src$=".svg"],[src*=".svg?"],[src*=".svg#"],[src^="data:image/svg"],[${ICON_MARK}])`, 'picture', 'video', 'embed', 'object', 'svg image', ...BG, ...EMBEDS].join(',');
  // Mídia dentro de mídia já revertida seria invertida duas vezes.
  const NESTED = ['picture img', ...BG.map((s) => `${s} :is(img,picture,video,embed,object,iframe,${BG.join(',')})`)].join(',');

  // O filtro corta valores fora de [0,1] entre uma etapa e outra, o que
  // desbota cores vivas nas mídias. A página recebe saturate(SAT) e as mídias
  // dessaturam antes de reverter, ficando dentro da faixa; elas também
  // desfazem o contraste reduzido (pensado para o texto, não para fotos).
  const SAT = 1.6;
  const mediaFilter = (s) => `contrast(${100 / s.contrast}) saturate(${1 / SAT}) ${REVERT}`;
  // :where() zera a especificidade de MEDIA para que NESTED sempre vença
  // (sem isso, "img:not([src*=.svg])" ganhava de "picture img" e a imagem
  // dentro de <picture> era invertida duas vezes).
  const mediaRules = (s) => `:where(${MEDIA}){filter:${mediaFilter(s)}!important}
${NESTED}{filter:none!important}
:fullscreen,:fullscreen *{filter:none!important}`;

  // Elementos na top layer (modais, popovers, tela cheia) não herdam o filtro
  // do <html>: modais/popovers recebem o mesmo filtro e a tela cheia fica original.
  const css = (s) => {
    const filter = `${REVERT} saturate(${SAT}) brightness(${s.brightness / 100}) contrast(${s.contrast / 100}) sepia(${s.sepia / 100}) grayscale(${s.grayscale / 100})`;
    return `@media screen{
html{filter:${filter}!important;scrollbar-color:#3b3b42 #141417!important}
:where(html){background-color:#fff}
:where(body){scrollbar-color:auto}
${mediaRules(s)}
dialog:modal:not(:fullscreen),[popover]:popover-open:not(:fullscreen){filter:${filter}!important}
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

  const isActive = () => settings.enabled && mode !== 'off' && !(mode === 'auto' && nativeDark);

  function render() {
    const active = isActive();
    const text = active ? css(settings) : '';
    if (style.textContent !== text) style.textContent = text;
    if (!style.isConnected && document.documentElement) document.documentElement.appendChild(style);

    const shadowText = active ? `@media screen{${mediaRules(settings)}}` : '';
    for (const ref of shadowStyles) {
      const s = ref.deref();
      if (!s) shadowStyles.delete(ref);
      else if (s.textContent !== shadowText) s.textContent = shadowText;
    }

    if (active !== scanning) setScanning(active);
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
      nativeDark = !!local[DARK_KEY];
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
    return [255, 255, 255, 1]; // canvas padrão do navegador
  }

  // Cor média de um gradiente (null se não houver cores legíveis).
  function gradientColor(img) {
    const stops = img.match(/rgba?\([^)]+\)/g);
    if (!stops) return null;
    const cs = stops.map(parseColor);
    return [0, 1, 2].map((i) => cs.reduce((sum, c) => sum + c[i], 0) / cs.length).concat(1);
  }

  function pageLooksDark() {
    const w = innerWidth;
    const h = innerHeight;
    let dark = 0;
    let total = 0;
    for (const [px, py] of POINTS) {
      const c = backgroundAt(w * px, h * py);
      if (!c) continue;
      total++;
      if (luma(c) < 0.4) dark++;
    }
    return total > 0 && dark / total >= 0.6;
  }

  function detect() {
    if (mode !== 'auto' || !document.body) return;
    // Desliga nossa folha durante a leitura para ver as cores originais.
    // É síncrono, então nada é pintado nesse intervalo.
    const sheet = style.sheet;
    if (sheet) sheet.disabled = true;
    let dark;
    try {
      dark = pageLooksDark();
    } finally {
      if (sheet) sheet.disabled = false;
    }
    if (dark === nativeDark) return;
    nativeDark = dark;
    render();
    // Cache por site: na próxima visita evitamos o "flash" claro em sites escuros.
    try {
      dark ? chrome.storage.local.set({ [DARK_KEY]: true }) : chrome.storage.local.remove(DARK_KEY);
    } catch {}
  }

  let detectTimer = 0;
  function scheduleDetect(delay = 0) {
    clearTimeout(detectTimer);
    detectTimer = setTimeout(detect, delay);
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
    if (el.tagName === 'IMG') return void mark(el, ICON_MARK, r.width <= ICON_MAX && r.height <= ICON_MAX);
    const cs = getComputedStyle(el);
    // Reavaliado a cada varredura: a cor de fundo pode mudar (aba ativa etc.).
    mark(el, KEEP_MARK, keepsColor(cs));
    if (el.hasAttribute(BG_MARK) || r.width < BG_MIN || r.height < BG_MIN) return;
    if (isPhoto(cs, r) || isPhoto(getComputedStyle(el, '::before'), r) || isPhoto(getComputedStyle(el, '::after'), r)) {
      mark(el, BG_MARK, true);
    }
  }

  function mark(el, attr, on) {
    if (el.hasAttribute(attr) !== on) writes.push(el, attr, on);
  }

  function flush() {
    for (let i = 0; i < writes.length; i += 3) writes[i].toggleAttribute(writes[i + 1], writes[i + 2]);
    writes = [];
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

  function isPhoto(cs, hostRect) {
    if (!cs.backgroundImage.includes('url(')) return false;
    if (cs.backgroundSize === 'auto' && cs.backgroundRepeat !== 'no-repeat') return false; // textura
    // Pseudo-elementos: o tamanho é o deles (ícone num botão grande não conta).
    const w = parseFloat(cs.width) || hostRect.width;
    const h = parseFloat(cs.height) || hostRect.height;
    return w >= BG_MIN && h >= BG_MIN;
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
    if (!style.isConnected) render();
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

  // ---------- inicialização ----------

  observer.observe(root, { childList: true });
  render(); // otimista: aplica já no document_start, antes do primeiro paint
  load();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scheduleDetect(), { once: true });
  }
  if (document.readyState !== 'complete') {
    addEventListener('load', () => {
      eagerFor(3000); // conteúdo inserido por scripts logo após o load
      scheduleDetect();
      rescan();
      setTimeout(() => (scheduleDetect(), rescan()), 2000);
    }, { once: true });
  } else {
    setTimeout(() => (scheduleDetect(), rescan()), 2000);
  }
  window.navigation?.addEventListener('navigatesuccess', () => (eagerFor(3000), scheduleDetect(800)));

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
