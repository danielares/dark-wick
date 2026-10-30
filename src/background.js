import { hostOf, readState, writeSite } from './shared.js';

const SCRIPT_ID = 'dark-wick';
const PAGES = ['http://*/*', 'https://*/*'];
const iconSet = (name) => Object.fromEntries([16, 32, 48].map((s) => [s, `/icons/${name}${s}.png`]));
const ICONS = { on: iconSet('icon'), off: iconSet('off') };

const isEnabled = (global) => global?.enabled ?? true;
const isOff = (site) => site?.mode === 'off';

// O content script é registrado dinamicamente para que sites desligados (e o
// navegador inteiro, com a extensão pausada) não rodem nenhum código nosso.
let queue = Promise.resolve();
function serial(fn) {
  queue = queue.then(fn).catch((e) => console.warn('[Dark Wick]', e));
  return queue;
}

async function syncRegistration() {
  const all = await chrome.storage.sync.get(null);
  const offHosts = Object.entries(all)
    .filter(([k, v]) => k.startsWith('site:') && isOff(v))
    .map(([k]) => k.slice(5))
    .filter((h) => /^[a-z0-9.-]+$/i.test(h)); // padrão inválido derrubaria o registro

  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  if (!isEnabled(all.global)) return;

  const script = { id: SCRIPT_ID, js: ['src/content.js'], matches: PAGES, runAt: 'document_start' };
  if (offHosts.length) script.excludeMatches = offHosts.flatMap((h) => [`*://${h}/*`, `*://www.${h}/*`]);
  await chrome.scripting.registerContentScripts([script]);
}

// Abas abertas antes do registro não têm o script; injetamos sob demanda.
async function injectInto(host) {
  const tabs = await chrome.tabs.query({ url: PAGES });
  await Promise.all(
    tabs
      .filter((t) => !host || hostOf(t.url) === host)
      .map((t) => chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['src/content.js'] }).catch(() => {})),
  );
}

async function updateIcon(tab) {
  if (!tab?.id) return;
  const host = hostOf(tab.url);
  const { global, site } = await readState(host);
  const on = global.enabled && !(host && isOff(site));
  chrome.action.setIcon({ tabId: tab.id, path: on ? ICONS.on : ICONS.off }).catch(() => {});
}

async function updateActiveIcons() {
  const tabs = await chrome.tabs.query({ active: true });
  tabs.forEach(updateIcon);
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await serial(syncRegistration);
  if (reason === 'install') injectInto();
  updateActiveIcons();
});

chrome.runtime.onStartup.addListener(() => serial(syncRegistration));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;

  const g = changes.global;
  const turnedOn = g && !isEnabled(g.oldValue) && isEnabled(g.newValue);
  const enabledChanged = g && isEnabled(g.oldValue) !== isEnabled(g.newValue);
  const siteChanges = Object.entries(changes).filter(([k, c]) => k.startsWith('site:') && isOff(c.oldValue) !== isOff(c.newValue));

  if (enabledChanged || siteChanges.length) {
    serial(syncRegistration).then(() => {
      if (turnedOn) return injectInto();
      for (const [k, c] of siteChanges) if (!isOff(c.newValue)) injectInto(k.slice(5));
    });
  }
  updateActiveIcons();
});

chrome.tabs.onActivated.addListener(({ tabId }) => chrome.tabs.get(tabId).then(updateIcon, () => {}));
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.url || info.status === 'loading') updateIcon(tab);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-site') return;
  tab ??= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const host = hostOf(tab?.url);
  if (!host) return;

  const { global, site } = await readState(host);
  if (!global.enabled) {
    await chrome.storage.sync.set({ global: { ...global, enabled: true } });
    if (isOff(site)) await writeSite(host, { ...site, mode: 'auto' });
    return;
  }
  await writeSite(host, { ...site, mode: isOff(site) ? 'auto' : 'off' });
});
