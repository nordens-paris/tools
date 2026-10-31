import assert from 'node:assert/strict';
import { test } from 'node:test';

// What the browser gives the sim runner, enough for one worker.
const g = globalThis as unknown as Record<string, unknown>;
g.__SIM_VERSION__ = 'test';
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 2 }, configurable: true });
g.sessionStorage = { getItem: () => null };
g.localStorage = { getItem: () => null };

let crashNext = false;
class FakeWorker {
  onmessage?: (e: { data: unknown }) => void;
  onerror?: (e: { message: string }) => void;
  terminated = false;
  postMessage(msg: { type: string; id?: string }) {
    if (msg.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
    else if (crashNext) queueMicrotask(() => this.onerror?.({ message: 'out of memory' }));
    else queueMicrotask(() => this.onmessage?.({ data: { type: 'result', id: msg.id, player: { dps: { avg: 1, stdev: 0 } } } }));
  }
  terminate() {
    this.terminated = true;
  }
}
g.Worker = FakeWorker;

/** A server with one job; it fails the run when told the job failed, as the real one does. */
function server() {
  const posted: { results: { error?: string }[] }[] = [];
  let polls = 0;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    const json = (body: unknown) => new Response(JSON.stringify(body));
    if (url.startsWith('/sim/')) return new Response(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    if (url === '/api/sim') return json({ mode: 'browser' });
    if (url.includes('/results')) {
      posted.push(JSON.parse(init!.body!));
      return json({ ok: true });
    }
    polls++;
    if (polls === 1) return json({ jobs: [{ id: 'job', request: {} }] });
    await new Promise((r) => setTimeout(r, 5));
    const last = posted.at(-1)?.results[0];
    return json({ jobs: [], ...(last?.error ? { error: `WoWSims failed: ${last.error}` } : last ? { result: { ok: true } } : {}) });
  }) as typeof fetch;
  return posted;
}

test('a sim run finishes', async () => {
  const { runBrowserSims } = await import('../web/src/browserSims.ts');
  server();
  assert.deepEqual(await runBrowserSims('a', () => {}), { ok: true });
});

test('a worker that crashes fails the run instead of hanging it', async () => {
  const { runBrowserSims } = await import('../web/src/browserSims.ts');
  const posted = server();
  crashNext = true;
  await assert.rejects(runBrowserSims('b', () => {}), /out of memory/);
  assert.equal(posted[0].results[0].error, 'out of memory');
  // The pool was thrown away, so the next run gets new workers.
  crashNext = false;
  server();
  assert.deepEqual(await runBrowserSims('c', () => {}), { ok: true });
  process.exit(0); // The idle timer that closes workers would hold the test open for a minute.
});
