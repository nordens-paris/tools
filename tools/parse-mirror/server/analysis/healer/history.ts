// The rolling healer score: which kills a healer had in the four weeks up to a report (one parses
// request), and every healer's score inputs on one kill (the kill's ~10 requests, shared by every
// healer in it). The browser keeps the inputs, so each kill is fetched once per visitor.
import type { HealerHistory, HealerKillScores } from '../../../shared/types.ts';
import { scoreInputs } from '../../../shared/healerScore.ts';
import type { WclReader } from '../../wcl/reader.ts';
import { HEALER_PARSE_SPECS, parsesFor } from '../characters.ts';
import { fetchHealerFight } from './data.ts';
import { healerMetrics } from './metrics.ts';
import { FightModel } from './model.ts';

const WEEKS = 4;

export async function healerHistory(client: WclReader, report: string, source: number): Promise<HealerHistory> {
  const fights = await client.fights(report);
  const actor = fights.friendlies.find((a) => a.id === source);
  if (!actor) throw new Error(`Player ${source} not found in report ${report}`);
  const until = fights.end ?? Date.now();
  const from = (fights.start ?? until) - WEEKS * 7 * 24 * 60 * 60 * 1000;
  const { parses, region } = await parsesFor(client, actor.name, actor.server, fights.zone, 'hps');
  // The same kill can be ranked from two reports (two people logging), pulled moments apart; keep one.
  const lastPull = new Map<number, number>();
  const kills: HealerHistory['kills'] = [];
  for (const p of [...parses].sort((a, b) => a.startTime - b.startTime)) {
    if (p.startTime < from || p.startTime > until || !HEALER_PARSE_SPECS.includes(p.spec) || p.startTime - (lastPull.get(p.encounterID) ?? -Infinity) < 120_000) continue;
    lastPull.set(p.encounterID, p.startTime);
    kills.push({ report: p.reportID, fight: p.fightID, encounterId: p.encounterID, name: p.encounterName, startTime: p.startTime });
  }
  return { name: actor.name, server: actor.server, region, from, until, kills };
}

/** Runs on the server, or in the browser on the visitor's key (web/src/wclBrowser.ts). */
export async function healerKillScores(client: WclReader, report: string, fightId: number): Promise<HealerKillScores> {
  const fights = await client.fights(report);
  const model = new FightModel(await fetchHealerFight(client, report, fightId, fights));
  const f = model.data.fight;
  if (!f.kill) throw new Error(`Fight ${fightId} in ${report} isn't a kill`);
  return {
    report,
    fight: fightId,
    encounterId: f.boss,
    name: f.name,
    startTime: (fights.start ?? 0) + f.start_time,
    healers: [...model.healers.keys(), ...model.minorHealers.keys()].map((id) => ({
      name: model.name(id),
      inputs: scoreInputs(healerMetrics(model, id)),
      ...(model.healers.has(id) ? {} : { minor: true }),
    })),
  };
}
