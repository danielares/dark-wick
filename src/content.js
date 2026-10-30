// Dark Wick — content script.
//
// Em vez de ler e reescrever o CSS do site (o que torna o Dark Reader pesado),
// escurecemos a página com UM filtro no <html>, composto pela GPU. Mídias
// recebem o filtro inverso para manter as cores reais. Não há varredura de
// folhas de estilo nem MutationObserver na árvore inteira.
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
  // SVGs via <img> costumam ser ícones/logos: deixamos inverter junto com o texto.
  const MEDIA = ['img:not([src*=".svg"])', 'picture', 'video', 'embed', 'object', 'svg image', ...BG_INLINE, ...EMBEDS].join(',');
  // Mídia dentro de mídia já revertida seria invertida duas vezes.
  const NESTED = ['picture img', ...BG_INLINE.map((s) => `${s} :is(img,picture,video)`)].join(',');

  // Elementos na top layer (modais, popovers, tela cheia) não herdam o filtro
  // do <html>: modais/popovers recebem o mesmo filtro e a tela cheia fica original.
  const css = (s) => {
    const filter = `${REVERT} brightness(${s.brightness / 100}) contrast(${s.contrast / 100}) sepia(${s.sepia / 100}) grayscale(${s.grayscale / 100})`;
    return `@media screen{
html{filter:${filter}!important;scrollbar-color:#3b3b42 #141417!important}
:where(html){background-color:#fff}
:where(body){scrollbar-color:auto}
${MEDIA}{filter:${REVERT}!important}
${NESTED}{filter:none!important}
dialog:modal:not(:fullscreen),[popover]:popover-open:not(:fullscreen){filter:${filter}!important}
:fullscreen,:fullscreen *,::backdrop{filter:none!important}
}`;
  };

  const style = document.createElement('style');
  style.id = 'dark-wick';

  let settings = { ...DEFAULTS };
  let mode = 'auto';
  let nativeDark = false;

  const isActive = () => settings.enabled && mode !== 'off' && !(mode === 'auto' && nativeDark);

  function render() {
    const text = isActive() ? css(settings) : '';
    if (style.textContent !== text) style.textContent = text;
    if (!style.isConnected && document.documentElement) document.documentElement.appendChild(style);
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

  // ---------- inicialização ----------

  render(); // otimista: aplica já no document_start, antes do primeiro paint
  load();

  // Frameworks que hidratam o <html> podem remover nosso <style>: só observamos
  // os filhos diretos do <html>, não a árvore inteira.
  const keeper = new MutationObserver(() => {
    if (!alive() || window.__darkWick !== alive) return keeper.disconnect();
    if (!style.isConnected) render();
  });
  keeper.observe(root, { childList: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scheduleDetect(), { once: true });
  }
  if (document.readyState !== 'complete') {
    addEventListener('load', () => {
      scheduleDetect();
      setTimeout(() => scheduleDetect(), 2000);
    }, { once: true });
  } else {
    setTimeout(() => scheduleDetect(), 2000);
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
