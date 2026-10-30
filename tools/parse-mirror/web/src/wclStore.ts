// Report data kept in this browser (IndexedDB), so a reload or a later visit doesn't spend the
// visitor's key on it again: a finished fight's data never changes. Anything can fail here (private
// windows, cleared storage): then it's just fetched again.
const DB = 'parse-mirror-wcl';
const VALUES = 'values';
const META = 'meta';
/** Rough size kept: oldest entries go first. Raid-wide events of one kill are a few MB. */
const MAX_BYTES = 300 * 1024 * 1024;
const PRUNE_DELAY_MS = 5_000;

let opening: Promise<IDBDatabase> | undefined;
function open() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(VALUES);
      req.result.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

const done = <T,>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export async function readStored<T>(key: string): Promise<T | undefined> {
  try {
    return (await done((await open()).transaction(VALUES).objectStore(VALUES).get(key))) as T | undefined;
  } catch {
    return undefined;
  }
}

/** Size of a response, near enough: events are the bulk of it, about 200 bytes each. */
const sizeOf = (value: unknown) => (Array.isArray(value) ? value.length * 200 : 20_000);

let pruneTimer: ReturnType<typeof setTimeout> | undefined;
async function prune() {
  const db = await open();
  const metaStore = db.transaction(META).objectStore(META);
  const [keys, metas] = await Promise.all([done(metaStore.getAllKeys()), done(metaStore.getAll() as IDBRequest<{ at: number; size: number }[]>)]);
  let total = metas.reduce((sum, m) => sum + m.size, 0);
  if (total <= MAX_BYTES) return;
  const oldest = keys.map((key, i) => ({ key, ...metas[i] })).sort((a, b) => a.at - b.at);
  const tx = db.transaction([VALUES, META], 'readwrite');
  for (const m of oldest) {
    if (total <= MAX_BYTES) break;
    tx.objectStore(VALUES).delete(m.key);
    tx.objectStore(META).delete(m.key);
    total -= m.size;
  }
}

export async function writeStored(key: string, value: unknown) {
  try {
    const tx = (await open()).transaction([VALUES, META], 'readwrite');
    tx.objectStore(VALUES).put(value, key);
    tx.objectStore(META).put({ at: Date.now(), size: sizeOf(value) }, key);
    clearTimeout(pruneTimer);
    pruneTimer = setTimeout(() => void prune().catch(() => {}), PRUNE_DELAY_MS);
  } catch {
    // Not kept: fetched again next time.
  }
}
