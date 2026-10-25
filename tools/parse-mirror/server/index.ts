import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import type { SimResult } from '../shared/types.ts';
import { analyze, type StoredAnalysis } from './analysis/analyze.ts';
import { guildSummary } from './analysis/guild.ts';
import { progressSummary } from './analysis/progress.ts';
import { raidSummary } from './analysis/raid.ts';
import { game, publicGameConfig } from './game.ts';
import { BrowserSims, type JobOutcome } from './sim/browser.ts';
import { runSim } from './sim/runner.ts';
import { runScenarios } from './sim/scenarios.ts';
import { specForIcon } from './specs/index.ts';
import { WclClient } from './wcl/client.ts';

// Locally the Vite dev server proxies to API_PORT (from .env); hosts like Render give the port in
// PORT. API_PORT wins, since dev tools may set PORT for Vite.
const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 5174);
const WCL_HOST = game.wclHost;
// The server's own key is optional: visitors can bring their own (see clientFor).
const serverClient = process.env.WCL_API_KEY ? new WclClient(process.env.WCL_API_KEY, WCL_HOST) : undefined;
const cliPath = process.env.WOWSIMS_CLI ?? '';
// Where sims run: in the visitor's browser (WebAssembly, the default; the server needs no CPU), or
// with the WoWSims command line tool on this machine (SIM_MODE=cli).
const SIM_MODE = process.env.SIM_MODE === 'cli' ? 'cli' : 'browser';
const iterations = Number(process.env.SIM_ITERATIONS ?? 2500);
// Sims handed to the browser at once. More than it has workers, so the next job is already there
// while a result is on its way back; the browser runs them one per worker.
const BROWSER_PARALLEL = 24;

interface Stored extends StoredAnalysis {
  sim?: Promise<SimResult>;
  /** Browser mode: the jobs waiting for the browser, and how the run ended. */
  browser?: BrowserSims;
  simResult?: SimResult;
  simError?: string;
}

// Analyses are kept in memory so the sim step can reuse the collected data. Oldest go first.
// Each takes a few MB; free hosts often have 512 MB.
const MAX_ANALYSES = Number(process.env.MAX_ANALYSES ?? 50);
const analyses = new Map<string, Stored>();
const remember = (stored: StoredAnalysis) => {
  analyses.set(stored.result.id, stored);
  while (analyses.size > MAX_ANALYSES) analyses.delete(analyses.keys().next().value!);
};

// Sims use every CPU core, so they run one at a time.
let simQueue: Promise<unknown> = Promise.resolve();
const queued = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = simQueue.then(fn, fn);
  simQueue = next.catch(() => {});
  return next;
};

const app = express();
// Behind a host's proxy, the visitor's address is in X-Forwarded-For.
app.set('trust proxy', 1);
// Browser sims send their results back, a few hundred kB at most.
app.use(express.json({ limit: '5mb' }));

// Each visitor can fetch this many logs an hour on the server's Warcraft Logs key, so one person
// can't use up the key's hourly budget for everyone. With their own key there's no limit here.
const VISITOR_LOOKUPS_PER_HOUR = Number(process.env.VISITOR_LOOKUPS_PER_HOUR ?? 60);
const lookups = new Map<string, number[]>();
function limitVisitor(req: express.Request) {
  if (req.get('x-wcl-key') || !VISITOR_LOOKUPS_PER_HOUR) return;
  const ip = req.ip ?? 'unknown';
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const recent = (lookups.get(ip) ?? []).filter((t) => t > hourAgo);
  if (recent.length >= VISITOR_LOOKUPS_PER_HOUR) {
    throw new BadRequest(`You've looked up a lot of logs this hour. Wait a bit, or add your own Warcraft Logs key under “API key”.`);
  }
  recent.push(Date.now());
  lookups.set(ip, recent);
}

const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

const REPORT_CODE = /^[A-Za-z0-9]{16}$/;
const API_KEY = /^[A-Za-z0-9]{32}$/;

class BadRequest extends Error {}

/**
 * A visitor's own Warcraft Logs key (X-WCL-Key header) is used for that request only: it isn't
 * stored or logged. Without one, the server's key is used.
 */
function clientFor(req: express.Request): WclClient {
  const key = req.get('x-wcl-key')?.trim();
  if (key) {
    if (!API_KEY.test(key)) throw new BadRequest('That doesn’t look like a Warcraft Logs v1 client key (32 letters and digits).');
    return new WclClient(key, WCL_HOST);
  }
  if (!serverClient) throw new BadRequest('This server has no Warcraft Logs key. Add your own under “API key”.');
  return serverClient;
}

function reportCode(value: unknown): string {
  if (typeof value !== 'string' || !REPORT_CODE.test(value)) throw new BadRequest('That isn’t a valid Warcraft Logs report code.');
  return value;
}

function fail(res: express.Response, what: string, err: unknown) {
  const message = (err as Error).message;
  if (!(err instanceof BadRequest)) log(`${what} failed: ${message}`);
  res.status(err instanceof BadRequest ? 400 : 502).json({ error: message });
}

app.get('/api/config', (_req, res) => {
  res.json({ ...publicGameConfig(), simMode: SIM_MODE });
});

app.get('/api/quota', (req, res) => {
  try {
    const own = !!req.get('x-wcl-key');
    res.json({ own, ...clientFor(req).quota() });
  } catch (err) {
    fail(res, 'Quota', err);
  }
});

app.get('/api/report/:code', async (req, res) => {
  try {
    limitVisitor(req);
    const fights = await clientFor(req).fights(reportCode(req.params.code));
    const bosses = fights.fights.filter((f) => f.boss);
    res.json({
      title: fights.title,
      fights: bosses.map((f) => ({ id: f.id, name: f.name, kill: !!f.kill, durationSec: (f.end_time - f.start_time) / 1000 })),
      players: fights.friendlies
        .filter((a) => a.type !== 'Pet' && a.type !== 'NPC')
        .map((a) => ({ id: a.id, name: a.name, icon: a.icon, supported: !!specForIcon(a.icon), fights: a.fights.map((f) => f.id) })),
    });
  } catch (err) {
    fail(res, 'Report', err);
  }
});

app.get('/api/raid/:code/:source', async (req, res) => {
  try {
    const source = Number(req.params.source);
    if (!Number.isInteger(source)) throw new BadRequest('Expected a player id.');
    limitVisitor(req);
    res.json(await raidSummary(clientFor(req), reportCode(req.params.code), source));
  } catch (err) {
    fail(res, 'Raid overview', err);
  }
});

app.get('/api/guild/:code', async (req, res) => {
  try {
    limitVisitor(req);
    res.json(await guildSummary(clientFor(req), reportCode(req.params.code)));
  } catch (err) {
    fail(res, 'Guild overview', err);
  }
});

app.get('/api/progress/:code/:source', async (req, res) => {
  try {
    const source = Number(req.params.source);
    if (!Number.isInteger(source)) throw new BadRequest('Expected a player id.');
    limitVisitor(req);
    res.json(await progressSummary(clientFor(req), reportCode(req.params.code), source));
  } catch (err) {
    fail(res, 'Progress', err);
  }
});

app.post('/api/analyze', async (req, res) => {
  try {
    const { report, fight, source, mode = 'top' } = req.body ?? {};
    if (!Number.isInteger(fight) || !Number.isInteger(source)) throw new BadRequest('Expected { report, fight, source }');
    if (mode !== 'top' && mode !== 'peers') throw new BadRequest('mode must be "top" or "peers"');
    limitVisitor(req);
    const stored = await analyze(clientFor(req), reportCode(report), fight, source, log, mode);
    remember(stored);
    res.json(stored.result);
  } catch (err) {
    fail(res, 'Analyze', err);
  }
});

app.post('/api/sim', async (req, res) => {
  const stored = analyses.get(req.body?.analysisId);
  if (!stored) {
    res.status(404).json({ error: 'Analysis not found (the server may have restarted). Run the analysis again.' });
    return;
  }
  if (SIM_MODE === 'browser') {
    // Start the run (once); the browser then picks up jobs from /api/sim/:id/jobs.
    if (!stored.sim) {
      const browser = new BrowserSims();
      stored.browser = browser;
      stored.simResult = undefined;
      stored.simError = undefined;
      stored.sim = runScenarios(stored, browser.run, iterations, log, BROWSER_PARALLEL);
      stored.sim.then(
        (result) => {
          stored.simResult = result;
          browser.notify();
        },
        (err) => {
          stored.simError = (err as Error).message;
          stored.sim = undefined;
          log(`Sim failed: ${stored.simError}`);
          browser.notify();
        },
      );
    }
    res.json({ mode: 'browser' });
    return;
  }
  if (!cliPath || !fs.existsSync(cliPath)) {
    res.status(500).json({ error: `WoWSims CLI not found at "${cliPath}". Set WOWSIMS_CLI in .env, or use SIM_MODE=browser.` });
    return;
  }
  try {
    // Asking again for the same analysis (a retry, a second tab) reuses the run.
    stored.sim ??= queued(() => runScenarios(stored, (request) => runSim(cliPath, request), iterations, log));
    res.json(await stored.sim);
  } catch (err) {
    stored.sim = undefined;
    log(`Sim failed: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Browser mode: sims waiting to run (long poll), or the finished result. */
app.get('/api/sim/:id/jobs', async (req, res) => {
  const stored = analyses.get(req.params.id);
  if (!stored?.browser) {
    res.status(404).json({ error: 'Analysis not found (the server may have restarted). Run the analysis again.' });
    return;
  }
  const done = () => !!stored.simResult || !!stored.simError;
  const jobs = await stored.browser.take(15_000, done);
  res.json({ jobs, result: stored.simResult, error: stored.simError });
});

/** Browser mode: results of sims the browser ran. */
app.post('/api/sim/:id/results', (req, res) => {
  const stored = analyses.get(req.params.id);
  const results = req.body?.results as JobOutcome[] | undefined;
  if (!stored?.browser || !Array.isArray(results)) {
    res.status(404).json({ error: 'Analysis not found.' });
    return;
  }
  for (const r of results) if (r && typeof r.id === 'string') stored.browser.complete(r);
  res.json({ ok: true });
});

// In production, serve the built web UI.
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  // The sim is stored gzipped; let the browser unpack it on the way in, and cache it for a day.
  app.get('/sim/wowsim.wasm.gz', (_req, res) => {
    res.set({ 'Content-Type': 'application/wasm', 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=86400' });
    res.sendFile(path.join(dist, 'sim', 'wowsim.wasm.gz'));
  });
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () =>
  log(`Server listening on http://localhost:${PORT} (sims: ${SIM_MODE}${serverClient ? '' : '; no server API key: visitors must bring their own'})`),
);
