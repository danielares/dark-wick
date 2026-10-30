// Estado compartilhado entre background e popup.
// O content script tem uma cópia de DEFAULTS — mantenha as duas em sincronia.

export const DEFAULTS = { enabled: true, brightness: 100, contrast: 86, sepia: 8, grayscale: 0 };
export const TUNING = ['brightness', 'contrast', 'sepia', 'grayscale'];

export const siteKey = (host) => `site:${host}`;

export const pickTuning = (s) => Object.fromEntries(TUNING.map((k) => [k, s[k]]));

export function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export async function readState(host) {
  const keys = host ? ['global', siteKey(host)] : ['global'];
  const data = await chrome.storage.sync.get(keys);
  return {
    global: { ...DEFAULTS, ...data.global },
    site: { mode: 'auto', ...(host && data[siteKey(host)]) },
  };
}

// Sites no padrão (auto, sem ajustes próprios) não ocupam espaço no storage.sync.
export function writeSite(host, site) {
  const key = siteKey(host);
  return site.mode === 'auto' && !site.custom
    ? chrome.storage.sync.remove(key)
    : chrome.storage.sync.set({ [key]: site });
}
