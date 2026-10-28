// Runs the WoWSims command line tool on a request and returns the player's DPS.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const TMP_DIR = path.resolve('.cache/sim');

export interface SimDps {
  avg: number;
  stdev: number;
  /** Raw WoWSims player metrics (actions, auras...), for diagnostics. */
  player: SimPlayerMetrics;
}

export interface SimPlayerMetrics {
  /** The player's pets and guardians (hunter pet, Fire Elemental...); their damage is in the player's DPS. */
  pets?: { name?: string; actions: SimPlayerMetrics['actions'] }[];
  actions: {
    id: { spellId?: number; itemId?: number; otherId?: string; tag?: number };
    targets: {
      casts?: number;
      hits?: number;
      crits?: number;
      glances?: number;
      misses?: number;
      dodges?: number;
      parries?: number;
      damage?: number;
      tickDamage?: number;
      resistedHits?: number;
      resistedCrits?: number;
      resistedDamage?: number;
      resistedTickDamage?: number;
    }[];
  }[];
  auras: { id: { spellId?: number; itemId?: number; tag?: number }; uptimeSecondsAvg?: number; procsAvg?: number }[];
  /** Threat and damage taken per second (tank sims). */
  threat?: { avg?: number; stdev?: number };
  dtps?: { avg?: number; stdev?: number };
}

export async function runSim(cliPath: string, request: unknown): Promise<SimDps> {
  await fs.mkdir(TMP_DIR, { recursive: true });
  const id = crypto.randomUUID();
  const infile = path.join(TMP_DIR, `${id}.in.json`);
  const outfile = path.join(TMP_DIR, `${id}.out.json`);
  await fs.writeFile(infile, JSON.stringify(request));
  try {
    try {
      await run(cliPath, ['sim', '--infile', infile, '--outfile', outfile], { timeout: 120_000, windowsHide: true });
    } catch (err) {
      // The CLI exits non-zero on sim errors but still writes the error to the outfile.
      const out = await fs.readFile(outfile, 'utf8').catch(() => '');
      let message = (err as Error).message;
      try {
        message = JSON.parse(out).error?.message ?? message;
      } catch {
        // No (or no readable) outfile: keep the process error.
      }
      throw new Error(`WoWSims failed: ${String(message).split('\n')[0]}`);
    }
    const result = JSON.parse(await fs.readFile(outfile, 'utf8'));
    if (result.error) throw new Error(`WoWSims failed: ${String(result.error.message).split('\n')[0]}`);
    const player = result.raidMetrics.parties[0].players[0];
    return { avg: player.dps.avg, stdev: player.dps.stdev, player };
  } finally {
    await Promise.all([fs.rm(infile, { force: true }), fs.rm(outfile, { force: true })]);
  }
}
