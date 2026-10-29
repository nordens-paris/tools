// The rolling healer score: which kills a healer had in the four weeks up to a report (one parses
// request), and every healer's score inputs on one kill (the kill's ~10 requests, shared by every
// healer in it). The browser keeps the inputs, so each kill is fetched once per visitor.
import type { HealerHistory, HealerKillScores } from '../../../shared/types.ts';
import { scoreInputs } from '../../../shared/healerScore.ts';
import type { WclClient } from '../../wcl/client.ts';
import { parsesFor } from '../characters.ts';
import { fetchHealerFight, type HealerDataClient } from './data.ts';
import { healerMetrics } from './metrics.ts';
import { FightModel } from './model.ts';

const WEEKS = 4;
const HEALER_SPECS = ['Holy', 'Discipline', 'Restoration'];

export async function healerHistory(client: WclClient, report: string, source: number): Promise<HealerHistory> {
  const fights = await client.fights(report);
  const actor = fights.friendlies.find((a) => a.id === source);
  if (!actor) throw new Error(`Player ${source} not found in report ${report}`);
  const until = fights.end ?? Date.now();
  const from = (fights.start ?? until) - WEEKS * 7 * 24 * 60 * 60 * 1000;
  const { parses, region } = await parsesFor(client, actor.name, actor.server, fights.zone, 'hps');
  // The same kill can be ranked from two reports (two people logging); keep one.
  const seen = new Set<string>();
  const kills: HealerHistory['kills'] = [];
  for (const p of [...parses].sort((a, b) => a.startTime - b.startTime)) {
    const key = `${p.encounterID}:${Math.round(p.startTime / 60_000)}`;
    if (p.startTime < from || p.startTime > until || !HEALER_SPECS.includes(p.spec) || seen.has(key)) continue;
    seen.add(key);
    kills.push({ report: p.reportID, fight: p.fightID, encounterId: p.encounterID, name: p.encounterName, startTime: p.startTime });
  }
  return { name: actor.name, server: actor.server, region, from, until, kills };
}

/** Runs on the server, or in the browser on the visitor's key (web/src/wclBrowser.ts). */
export async function healerKillScores(client: HealerDataClient, report: string, fightId: number): Promise<HealerKillScores> {
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
    healers: [...model.healers.keys()].map((id) => ({ name: model.name(id), inputs: scoreInputs(healerMetrics(model, id)) })),
  };
}
