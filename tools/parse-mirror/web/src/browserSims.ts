// Runs the server's sims in this browser: WoWSims compiled to WebAssembly, in a pool of Web
// Workers. The server decides what to sim (one job per sim) and puts the results together.
import type { SimResult } from '../../shared/types.ts';
import { getApiKey } from './apiKey.ts';

interface Job {
  id: string;
  request: unknown;
}
interface JobResult {
  id: string;
  player?: unknown;
  error?: string;
}

// Built by scripts/build-wowsims.mjs: gzipped, so it's 7 MB to download instead of 42. Browsers
// cache it for a day, so bump the version after a rebuild.
const WASM_URL = '/sim/wowsim.wasm.gz?v=2';

let modulePromise: Promise<WebAssembly.Module> | undefined;
/** Downloads and compiles WoWSims once; every worker shares the compiled module. */
function wasmModule() {
  modulePromise ??= (async () => {
    const res = await fetch(WASM_URL);
    if (!res.ok) throw new Error(`Couldn't load the sim (${res.status})`);
    // Servers that send it with Content-Encoding: gzip get it unpacked by the browser already;
    // otherwise unpack it here. WebAssembly starts with "\0asm".
    let bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] !== 0 || bytes[1] !== 0x61) {
      bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    }
    return WebAssembly.compile(bytes);
  })();
  modulePromise.catch(() => (modulePromise = undefined));
  return modulePromise;
}

class SimWorker {
  private worker = new Worker('/sim/worker.js?v=3');
  private pending = new Map<string, (r: JobResult) => void>();
  readonly ready: Promise<void>;

  constructor(module: WebAssembly.Module) {
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'ready') resolve();
        else if (msg.type === 'failed') reject(new Error(msg.error));
        else if (msg.type === 'result') {
          this.pending.get(msg.id)?.(msg);
          this.pending.delete(msg.id);
        }
      };
      this.worker.onerror = (e) => reject(new Error(e.message || 'Sim worker crashed'));
    });
    this.worker.postMessage({ type: 'init', module });
  }

  terminate() {
    this.worker.terminate();
  }

  run(job: Job): Promise<JobResult> {
    return new Promise((resolve) => {
      this.pending.set(job.id, resolve);
      this.worker.postMessage({ type: 'sim', id: job.id, request: JSON.stringify(job.request) });
    });
  }
}

/**
 * One worker per core, leaving one for the page. Each sim runs on a single core in WebAssembly, so
 * workers are what makes it fast, but each holds 130–200 MB: at most 6, or up to 10 when the
 * browser reports at least 8 GB of memory (Chrome and Edge do; others keep 6).
 */
function workerCount() {
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cap = memoryGb && memoryGb >= 8 ? 10 : 6;
  return Math.max(1, Math.min(cap, (navigator.hardwareConcurrency || 4) - 1));
}

// Workers are closed a while after the last sim, to give their memory back.
const IDLE_CLOSE_MS = 60_000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let workersPromise: Promise<SimWorker[]> | undefined;
function workers() {
  clearTimeout(idleTimer);
  workersPromise ??= (async () => {
    const module = await wasmModule();
    const pool = Array.from({ length: workerCount() }, () => new SimWorker(module));
    await Promise.all(pool.map((w) => w.ready));
    return pool;
  })();
  workersPromise.catch(() => (workersPromise = undefined));
  return workersPromise;
}
function closeWhenIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const closing = workersPromise;
    workersPromise = undefined;
    void closing?.then((pool) => pool.forEach((w) => w.terminate()));
  }, IDLE_CLOSE_MS);
}

async function call<T>(url: string, body?: unknown): Promise<T> {
  const key = getApiKey();
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(key ? { 'X-WCL-Key': key } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/**
 * Starts the sims for an analysis and runs them here until the server has the result. Jobs keep
 * coming while earlier ones finish (luck sims depend on each player's first sim), so fetching new
 * jobs and running them happen side by side.
 */
export async function runBrowserSims<T = SimResult>(analysisId: string, onProgress: (done: number, total: number) => void): Promise<T> {
  active++;
  try {
    return await simulate<T>(analysisId, onProgress);
  } finally {
    if (--active === 0) closeWhenIdle();
  }
}
// Runs in progress (a second tab of the app has its own count).
let active = 0;

async function simulate<T>(analysisId: string, onProgress: (done: number, total: number) => void): Promise<T> {
  const pool = await workers();
  await call('/api/sim', { analysisId });
  let done = 0;
  let total = 0;
  const queue: Job[] = [];
  const seen = new Set<string>();
  const idle = [...pool];
  let failure: Error | undefined;

  const pump = () => {
    // Each job goes to a free worker; a worker is free again as soon as its sim is done, while the
    // result is still on its way to the server.
    while (queue.length && idle.length) {
      const job = queue.shift()!;
      const worker = idle.pop()!;
      worker
        .run(job)
        .then((result) => {
          idle.push(worker);
          pump();
          return call('/api/sim/' + analysisId + '/results', { results: [result] });
        })
        .then(() => onProgress(++done, total))
        .catch((err) => {
          failure ??= err as Error;
        });
    }
  };

  for (;;) {
    if (failure) throw failure;
    const r = await call<{ jobs: Job[]; result?: T; error?: string }>(`/api/sim/${analysisId}/jobs`);
    if (r.error) throw new Error(r.error);
    if (r.result) return r.result;
    // The server hands a job out again if no answer came for a while; it may still be running here.
    const fresh = r.jobs.filter((job) => !seen.has(job.id));
    for (const job of fresh) seen.add(job.id);
    queue.push(...fresh);
    total += fresh.length;
    onProgress(done, total);
    pump();
  }
}
