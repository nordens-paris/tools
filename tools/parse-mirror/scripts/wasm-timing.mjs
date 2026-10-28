// Times the browser's sim (WoWSims WebAssembly, one core, as in a Web Worker) on saved requests.
// Usage: node scripts/wasm-timing.mjs <request.json>... (e.g. the .in.json files sim-timing.ts writes)
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sim = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/public/sim');
// wasm_exec.js defines globalThis.Go; it's a browser script, so evaluate it as one.
new Function(fs.readFileSync(path.join(sim, 'wasm_exec.js'), 'utf8'))();
const bytes = zlib.gunzipSync(fs.readFileSync(path.join(sim, 'wowsim.wasm.gz')));
let markReady;
const ready = new Promise((resolve) => (markReady = resolve));
globalThis.wasmready = () => markReady();
const go = new globalThis.Go();
const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
go.run(instance);
await ready;

for (const file of process.argv.slice(2)) {
  const req = fs.readFileSync(file, 'utf8');
  const t0 = performance.now();
  const out = JSON.parse(globalThis.raidSimJson(req));
  const ms = performance.now() - t0;
  const iters = JSON.parse(req).simOptions.iterations;
  const p = out.raidMetrics?.parties[0].players[0];
  console.log(`${path.basename(file)}: ${(ms / 1000).toFixed(2)} s for ${iters} iterations (${(ms / iters).toFixed(2)} ms each), DPS ${p?.dps.avg.toFixed(0) ?? out.error?.message}`);
}
process.exit(0);
