// One character over time: every ranked kill of each boss in the report's raid tier, oldest
// first, from a single (cached) Warcraft Logs request.
import type { ProgressSummary } from '../../shared/types.ts';
import type { WclClient } from '../wcl/client.ts';
import { parsesFor } from './characters.ts';

export async function progressSummary(client: WclClient, report: string, source: number): Promise<ProgressSummary> {
  const fights = await client.fights(report);
  const actor = fights.friendlies.find((a) => a.id === source);
  if (!actor) throw new Error(`Player ${source} not found in report ${report}`);
  const { parses, region } = await parsesFor(client, actor.name, actor.server, fights.zone);

  const byBoss = new Map<number, ProgressSummary['bosses'][number]>();
  // The same kill can be in two reports (two people logging); keep one.
  const seen = new Set<string>();
  for (const p of [...parses].sort((a, b) => a.startTime - b.startTime)) {
    const key = `${p.encounterID}:${Math.round(p.startTime / 60_000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
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
    player: { name: actor.name, server: actor.server, region, icon: actor.icon, source },
    bosses: [...byBoss.values()],
  };
}
