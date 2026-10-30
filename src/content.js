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
  const EMBEDS = ['youtube.com', 'youtube-nocookie.com', 'player.vimeo.com', 'dailymotion.com', 'player.twitch.tv', 'open.spotify.com']
    .map((s) => `iframe[src*="${s}"]`);
  // Elementos grandes com foto em background-image (marcados pela varredura).
  const BG_MARK = 'data-dw-bg';
  const BG = [...BG_INLINE, `[${BG_MARK}]`];
  // SVGs via <img> costumam ser ícones/logos: deixamos inverter junto com o texto.
  const MEDIA = ['img:not([src*=".svg"])', 'picture', 'video', 'embed', 'object', 'svg image', ...BG, ...EMBEDS].join(',');
  // Mídia dentro de mídia já revertida seria invertida duas vezes.
  const NESTED = ['picture img', ...BG.map((s) => `${s} :is(img,picture,video,embed,object,iframe,${BG.join(',')})`)].join(',');

  // O filtro corta valores fora de [0,1] entre uma etapa e outra, o que
  // desbota cores vivas nas mídias. A página recebe saturate(SAT) e as mídias
  // dessaturam antes de reverter, ficando dentro da faixa; elas também
  // desfazem o contraste reduzido (pensado para o texto, não para fotos).
  const SAT = 1.6;
  const mediaFilter = (s) => `contrast(${100 / s.contrast}) saturate(${1 / SAT}) ${REVERT}`;
  const mediaRules = (s) => `${MEDIA}{filter:${mediaFilter(s)}!important}
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

  function backgroundAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (SKIP_TAGS.has(el.tagName)) return null;
      const cs = getComputedStyle(el);
      const bg = parseColor(cs.backgroundColor);
      if (bg[3] >= 0.5) return bg;
      const img = cs.backgroundImage;
      if (img !== 'none') {
        if (img.includes('url(')) return null;
        const stops = img.match(/rgba?\([^)]+\)/g);
        if (stops) {
          const cs2 = stops.map(parseColor);
          return [0, 1, 2].map((i) => cs2.reduce((sum, c) => sum + c[i], 0) / cs2.length).concat(1);
        }
      }
    }
    return [255, 255, 255, 1]; // canvas padrão do navegador
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

  // ---------- fotos em background-image e Shadow DOM ----------
  // Fundos definidos no CSS do site não são selecionáveis por CSS: marcamos os
  // elementos grandes com foto de fundo. Ícones/sprites (pequenos) e texturas
  // repetidas ficam de fora e invertem junto com a página, como o texto.
  // Roda em requestIdleCallback, em fatias, e só com o filtro ativo.

  const BG_MIN = 48;
  const seenShadows = new WeakSet();
  const jobs = [];
  let idleId = 0;
  let scanning = false;

  function inspect(el) {
    if (!el.isConnected) return;
    const sr = el.shadowRoot;
    if (sr && !seenShadows.has(sr)) adoptShadow(sr);
    if (el.hasAttribute(BG_MARK) || el === document.body) return;
    const cs = getComputedStyle(el);
    if (!cs.backgroundImage.includes('url(')) return;
    if (cs.backgroundSize === 'auto' && cs.backgroundRepeat !== 'no-repeat') return; // textura
    const r = el.getBoundingClientRect();
    if (r.width < BG_MIN || r.height < BG_MIN) return;
    if (r.width >= innerWidth * 0.9 && r.height > innerHeight * 1.5) return; // fundo da página inteira
    el.setAttribute(BG_MARK, '');
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

  function enqueue(node) {
    jobs.push({ list: node.querySelectorAll('*'), i: 0 });
    if (node.nodeType === 1) jobs.push({ list: [node], i: 0 });
    if (!idleId) idleId = requestIdleCallback(work, { timeout: 1500 });
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
    if (jobs.length) idleId = requestIdleCallback(work, { timeout: 1500 });
  }

  // Também religa nosso <style> se um framework que hidrata o <html> removê-lo.
  const observer = new MutationObserver((mutations) => {
    if (!alive() || window.__darkWick !== alive) return observer.disconnect();
    if (!style.isConnected) render();
    if (!scanning) return;
    for (const m of mutations) for (const n of m.addedNodes) if (n.nodeType === 1) enqueue(n);
  });

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
      scheduleDetect();
      rescan();
      setTimeout(() => (scheduleDetect(), rescan()), 2000);
    }, { once: true });
  } else {
    setTimeout(() => (scheduleDetect(), rescan()), 2000);
  }
  window.navigation?.addEventListener('navigatesuccess', () => scheduleDetect(800));

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
