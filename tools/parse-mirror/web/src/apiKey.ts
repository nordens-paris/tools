// The visitor's own Warcraft Logs key. It stays in this browser: sessionStorage for this tab, or
// localStorage when they choose to remember it. It's sent with each request and the server
// uses it for that request only.
const STORAGE_KEY = 'np-wcl-key';

const read = (store: () => Storage) => {
  try {
    return store().getItem(STORAGE_KEY) ?? undefined;
  } catch {
    // Storage can be unavailable (private mode); then the key lasts until the page reloads.
    return undefined;
  }
};

let memoryKey: string | undefined;

export function getApiKey(): string | undefined {
  return read(() => sessionStorage) ?? read(() => localStorage) ?? memoryKey;
}

export function isApiKeyRemembered(): boolean {
  return !!read(() => localStorage);
}

export function setApiKey(key: string | undefined, remember: boolean) {
  memoryKey = key;
  for (const store of [() => sessionStorage, () => localStorage]) {
    try {
      store().removeItem(STORAGE_KEY);
    } catch {
      // Ignore unavailable storage.
    }
  }
  if (!key) return;
  try {
    (remember ? localStorage : sessionStorage).setItem(STORAGE_KEY, key);
  } catch {
    // Kept in memory for this visit.
  }
}
