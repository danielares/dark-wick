import { DEFAULTS, hostOf, pickTuning, readState, writeSite } from '../shared.js';

const $ = (s) => document.querySelector(s);
const enabledEl = $('#enabled');
const hostEl = $('#host');
const faviconEl = $('#favicon');
const statusEl = $('#status');
const modeEl = $('#mode');
const customEl = $('#custom');
const sliders = [...document.querySelectorAll('input[type="range"]')];

const MODES = ['auto', 'on', 'off'];
const PROTECTED = /^(chromewebstore\.google\.com|chrome\.google\.com|microsoftedge\.microsoft\.com)$/;

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const host = hostOf(tab?.url);
let { global, site } = await readState(host);

const tuning = () => ({ ...pickTuning(global), ...site.custom });

function render() {
  enabledEl.checked = global.enabled;
  document.body.classList.toggle('is-off', !global.enabled);
  document.body.classList.toggle('no-site', !host);

  const i = MODES.indexOf(site.mode);
  modeEl.style.setProperty('--i', i);
  modeEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === site.mode));
  owlEl.setAttribute('aria-checked', global.enabled);
  $('#tuning-scope').textContent = site.custom ? 'Este site' : 'Todos os sites';
  logo.go(global.enabled);

  customEl.checked = !!site.custom;
  const t = tuning();
  sliders.forEach((s) => {
    s.value = t[s.dataset.key];
    paintSlider(s);
  });
}

function paintSlider(s) {
  const p = ((s.value - s.min) / (s.max - s.min)) * 100;
  s.style.setProperty('--p', `${p}%`);
  s.closest('.slider').querySelector('output').textContent = `${s.value}%`;
}

function setStatus(text, tone = '') {
  statusEl.dataset.tone = tone;
  statusEl.querySelector('em').textContent = text;
}

async function refreshStatus() {
  if (!host) return setStatus('Página interna do navegador');
  if (!global.enabled) return setStatus('Pausado');
  if (site.mode === 'off') return setStatus('Cores originais');
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'status' });
    if (r?.state === 'on') setStatus('Escuro ativo', 'on');
    else if (r?.state === 'native') setStatus('Site já é escuro', 'ok');
    else setStatus('Cores originais');
  } catch {
    setStatus(PROTECTED.test(host) ? 'Página protegida' : 'Recarregue a página', 'warn');
  }
}

const refreshSoon = () => setTimeout(refreshStatus, 250);

function preview(t) {
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'preview', tuning: t }).catch(() => {});
}

async function saveTuning(t) {
  if (site.custom) {
    site.custom = { ...site.custom, ...t };
    await writeSite(host, site);
  } else {
    global = { ...global, ...t };
    await chrome.storage.sync.set({ global });
  }
}

// ---------- eventos ----------

// ---------- coruja animada ----------
// Desenhada num canvas a partir de tiras de quadros (img/*.webp). A transição avança ou recua
// quadro a quadro até o estado-alvo; clicar no meio inverte de onde está, sem saltos.
// Parada no estado, toca o loop sutil daquele estado (chamas/estrelas à noite, sol de dia).
const owlEl = $('#owl');
const logo = (() => {
  const cv = $('#logo');
  const ctx = cv.getContext('2d');
  const load = (n) => new Promise((ok) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.src = `img/${n}.webp`;
  });
  const STEP = 42; // ms por quadro na transição
  const LOOP = 80; // ms por quadro no loop
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let sheets = null;
  let pos = null; // 0 = noite … último = dia (pode ser fracionário durante a transição)
  let target = 0;
  let loopStart = 0;
  let last = 0;

  function draw(im, i) {
    const s = im.height;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(im, i * s, 0, s, s, 0, 0, cv.width, cv.height);
  }

  function tick(now) {
    const dt = last ? now - last : 0;
    last = now;
    const { vira } = sheets;
    if (pos !== target) {
      const step = dt / STEP;
      pos = pos < target ? Math.min(target, pos + step) : Math.max(target, pos - step);
      draw(vira, Math.round(pos));
      if (pos === target) loopStart = now;
    } else {
      const im = target === 0 ? sheets.noite : sheets.dia;
      const n = im.width / im.height;
      draw(im, still ? 0 : Math.floor((now - loopStart) / LOOP) % n);
    }
    requestAnimationFrame(tick);
  }

  const ready = Promise.all(['noite', 'dia', 'vira'].map(load)).then(([noite, dia, vira]) => {
    sheets = { noite, dia, vira };
    sheets.end = vira.width / vira.height - 1;
  });

  return {
    async go(on) {
      await ready;
      target = on ? 0 : sheets.end;
      if (pos === null) {
        pos = target; // primeira abertura: sem transição
        requestAnimationFrame(tick);
      }
    },
  };
})();

owlEl.addEventListener('click', () => enabledEl.click());

// ---------- submenu ----------
const home = $('#home');
const tuningView = $('#tuning');
function openSub(open) {
  document.body.classList.toggle('sub', open);
  home.inert = open;
  tuningView.inert = !open;
  (open ? $('#back') : $('#open-tuning')).focus({ preventScroll: true });
}
$('#open-tuning').addEventListener('click', () => openSub(true));
$('#back').addEventListener('click', () => openSub(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('sub')) {
    e.preventDefault();
    openSub(false);
  }
});

enabledEl.addEventListener('change', async () => {
  global = { ...global, enabled: enabledEl.checked };
  render();
  await chrome.storage.sync.set({ global });
  refreshSoon();
});

modeEl.addEventListener('click', async (e) => {
  const mode = e.target.closest('button')?.dataset.mode;
  if (!mode || mode === site.mode) return;
  site = { ...site, mode };
  render();
  await writeSite(host, site);
  refreshSoon();
});

modeEl.addEventListener('keydown', (e) => {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const next = MODES[(MODES.indexOf(site.mode) + step + MODES.length) % MODES.length];
  const btn = modeEl.querySelector(`[data-mode="${next}"]`);
  btn.focus();
  btn.click();
});

customEl.addEventListener('change', async () => {
  site = { ...site };
  if (customEl.checked) site.custom = pickTuning(global);
  else delete site.custom;
  render();
  preview(tuning());
  await writeSite(host, site);
});

sliders.forEach((s) => {
  // input: prévia instantânea via mensagem (sem gastar a cota do storage.sync)
  s.addEventListener('input', () => {
    paintSlider(s);
    preview({ [s.dataset.key]: +s.value });
  });
  // change: persiste quando o usuário solta o controle
  s.addEventListener('change', () => saveTuning({ [s.dataset.key]: +s.value }));
});

$('#reset').addEventListener('click', async () => {
  const t = pickTuning(DEFAULTS);
  if (site.custom) site = { ...site, custom: t };
  else global = { ...global, ...t };
  render();
  preview(t);
  await saveTuning(t);
});

// ---------- inicialização ----------

hostEl.textContent = host || 'Página do navegador';
if (host) {
  faviconEl.onerror = () => faviconEl.remove();
  faviconEl.src = chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(tab.url)}&size=32`);
} else {
  faviconEl.remove();
}

const cmd = (await chrome.commands.getAll()).find((c) => c.name === 'toggle-site');
$('#shortcut').innerHTML = cmd?.shortcut
  ? `${cmd.shortcut.split('+').map((k) => `<kbd>${k}</kbd>`).join(' ')} alterna o site`
  : 'Sem atalho definido';
$('#version').textContent = `Versão ${chrome.runtime.getManifest().version}`;

render();
refreshStatus();
