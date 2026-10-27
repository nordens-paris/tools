// Runs WoWSims (compiled to WebAssembly) in a Web Worker. The page compiles the module once and
// sends it here; each message is then one RaidSimRequest (protojson) to sim.
// wasm_exec.js is Go's WebAssembly loader (BSD licence, from the Go distribution).
importScripts('wasm_exec.js');

let markReady;
const ready = new Promise((resolve) => (markReady = resolve));
// WoWSims calls this once it has registered its functions.
self.wasmready = () => markReady();

/** Only what the server's luck and diagnostics use, to keep the upload small. */
function slim(player) {
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  const TARGET = ['casts', 'hits', 'crits', 'glances', 'misses', 'dodges', 'parries', 'damage', 'tickDamage', 'resistedHits', 'resistedCrits', 'resistedDamage', 'resistedTickDamage'];
  return {
    dps: { avg: player.dps.avg, stdev: player.dps.stdev },
    // Tank sims: threat and damage taken per second.
    ...(player.threat ? { threat: { avg: player.threat.avg ?? 0, stdev: player.threat.stdev ?? 0 } } : {}),
    ...(player.dtps ? { dtps: { avg: player.dtps.avg ?? 0, stdev: player.dtps.stdev ?? 0 } } : {}),
    actions: (player.actions ?? []).map((a) => ({ id: a.id, targets: (a.targets ?? []).map((t) => pick(t, TARGET)) })),
    auras: (player.auras ?? []).map((a) => pick(a, ['id', 'uptimeSecondsAvg', 'procsAvg'])),
  };
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    try {
      const go = new Go();
      const instance = await WebAssembly.instantiate(msg.module, go.importObject);
      go.run(instance);
      await ready;
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'failed', error: String(err?.message ?? err) });
    }
    return;
  }
  if (msg.type === 'sim') {
    try {
      const raw = self.raidSimJson(msg.request);
      const out = raw ? JSON.parse(raw) : undefined;
      if (!out) throw new Error('WoWSims could not read the request');
      if (out.error?.message) throw new Error(out.error.message.split('\n')[0]);
      self.postMessage({ type: 'result', id: msg.id, player: slim(out.raidMetrics.parties[0].players[0]) });
    } catch (err) {
      self.postMessage({ type: 'result', id: msg.id, error: String(err?.message ?? err) });
    }
  }
};
