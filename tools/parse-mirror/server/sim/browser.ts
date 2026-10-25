// Sims run in the visitor's browser (WoWSims compiled to WebAssembly), so the server needs no CPU
// for them. The server still decides which sims to run (scenarios.ts); each one becomes a job that
// the browser picks up, runs and sends back. Jobs a browser took but never answered (tab closed,
// reload) are handed out again after a while.
import crypto from 'node:crypto';

import type { SimDps, SimPlayerMetrics } from './runner.ts';

const RESEND_AFTER_MS = 90_000;

interface Job {
  request: unknown;
  sentAt: number;
  resolve: (dps: SimDps) => void;
  reject: (err: Error) => void;
}

/** What the browser sends back for one job: the player's metrics, or an error. */
export interface JobOutcome {
  id: string;
  player?: SimPlayerMetrics & { dps: { avg: number; stdev: number } };
  error?: string;
}

export class BrowserSims {
  private jobs = new Map<string, Job>();
  private wake: (() => void)[] = [];

  /** Queues a sim for the browser; resolves when its result comes back. */
  run = (request: unknown): Promise<SimDps> =>
    new Promise((resolve, reject) => {
      this.jobs.set(crypto.randomUUID(), { request, sentAt: 0, resolve, reject });
      for (const w of this.wake.splice(0)) w();
    });

  /** Jobs not handed out yet (or handed out long ago), waiting up to `waitMs` for new ones. */
  async take(waitMs: number, isDone: () => boolean): Promise<{ id: string; request: unknown }[]> {
    const due = () => [...this.jobs].filter(([, j]) => !j.sentAt || Date.now() - j.sentAt > RESEND_AFTER_MS);
    if (!due().length && !isDone()) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, waitMs);
        this.wake.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    const now = Date.now();
    return due().map(([id, j]) => {
      j.sentAt = now;
      return { id, request: j.request };
    });
  }

  complete(outcome: JobOutcome) {
    const job = this.jobs.get(outcome.id);
    if (!job) return;
    this.jobs.delete(outcome.id);
    if (outcome.player?.dps) job.resolve({ avg: outcome.player.dps.avg, stdev: outcome.player.dps.stdev, player: outcome.player });
    else job.reject(new Error(`WoWSims failed: ${outcome.error ?? 'no result'}`));
  }

  /** Wakes a waiting browser request (e.g. when the whole run is done). */
  notify() {
    for (const w of this.wake.splice(0)) w();
  }
}
