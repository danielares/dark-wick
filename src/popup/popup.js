import { DEFAULTS, hostOf, pickTuning, readState, writeSite } from '../shared.js';

const $ = (s) => document.querySelector(s);
const enabledEl = $('#enabled');
const hostEl = $('#host');
const faviconEl = $('#favicon');
const statusEl = $('#status');
const modeEl = $('#mode');
const hintEl = $('#hint');
const customEl = $('#custom');
const sliders = [...document.querySelectorAll('input[type="range"]')];

const MODES = ['auto', 'on', 'off'];
const HINTS = {
  auto: 'Escurece, a menos que o site já seja escuro.',
  on: 'Sempre escurece, mesmo sites que já são escuros.',
  off: 'Este site mantém as cores originais.',
};
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
  hintEl.textContent = HINTS[site.mode];

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
  if (!global.enabled) return setStatus('Pausado em todos os sites');
  if (site.mode === 'off') return setStatus('Cores originais');
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'status' });
    if (r?.state === 'on') setStatus('Escuro ativo', 'on');
    else if (r?.state === 'native') setStatus('Site já é escuro — mantido', 'ok');
    else setStatus('Cores originais');
  } catch {
    setStatus(PROTECTED.test(host) ? 'Página protegida pelo navegador' : 'Recarregue a página para aplicar', 'warn');
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
  ? `${cmd.shortcut.split('+').map((k) => `<kbd>${k}</kbd>`).join('+')} alterna este site`
  : 'Defina um atalho em chrome://extensions/shortcuts';
$('#version').textContent = `v${chrome.runtime.getManifest().version}`;

render();
refreshStatus();
