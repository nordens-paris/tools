// One character over time: every ranked kill of each boss in the report's raid tier, oldest
// first, from a single (cached) Warcraft Logs request.
import type { ProgressSummary } from '../../shared/types.ts';
import type { WclClient } from '../wcl/client.ts';
import { mayHeal } from '../specs/healers.ts';
import { HEALER_PARSE_SPECS, parsesFor } from './characters.ts';

export async function progressSummary(client: WclClient, report: string, source: number): Promise<ProgressSummary> {
  const fights = await client.fights(report);
  const actor = fights.friendlies.find((a) => a.id === source);
  if (!actor) throw new Error(`Player ${source} not found in report ${report}`);
  const dps = await parsesFor(client, actor.name, actor.server, fights.zone);
  // Healers rank on healing: whichever the character has more kills of.
  const heals = mayHeal(actor.icon) ? await parsesFor(client, actor.name, actor.server, fights.zone, 'hps') : undefined;
  const healKills = heals?.parses.filter((p) => HEALER_PARSE_SPECS.includes(p.spec)) ?? [];
  const healer = healKills.length > dps.parses.filter((p) => !HEALER_PARSE_SPECS.includes(p.spec)).length;
  const parses = healer ? healKills : dps.parses;
  const region = healer ? heals?.region : dps.region;

  const byBoss = new Map<number, ProgressSummary['bosses'][number]>();
  // The same kill can be in two reports (two people logging), pulled moments apart; keep one.
  const lastPull = new Map<number, number>();
  for (const p of [...parses].sort((a, b) => a.startTime - b.startTime)) {
    if (p.startTime - (lastPull.get(p.encounterID) ?? -Infinity) < 120_000) continue;
    lastPull.set(p.encounterID, p.startTime);
    const boss = byBoss.get(p.encounterID) ?? { encounterId: p.encounterID, name: p.encounterName, kills: [] };
    boss.kills.push({
      report: p.reportID,
      fight: p.fightID,
      startTime: p.startTime,
      percentile: p.percentile,
      dps: p.total,
      durationSec: p.duration / 1000,
      itemLevel: p.ilvlKeyOrPatch,
      spec: p.spec,
    });
    byBoss.set(p.encounterID, boss);
  }
  return {
    report,
    metric: healer ? 'hps' : 'dps',
    player: { name: actor.name, server: actor.server, region, icon: actor.icon, source },
    bosses: [...byBoss.values()],
  };
}
