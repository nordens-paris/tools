// Tanks on every boss kill of a report, for the raid pages (no peers). The raid-wide data is the
// same the healer pages use; each tank adds 3 requests per kill.
import type { TankMetrics, TankRaidRow, TankRaidSummary } from '../../../shared/types.ts';
import { TANK_ICONS } from '../../specs/tanks.ts';
import type { WclClient } from '../../wcl/client.ts';
import type { WclFightsResponse } from '../../wcl/types.ts';
import { FightModel } from '../healer/model.ts';
import { fetchTankFight } from './data.ts';
import { tankMetrics, tankSpecIn } from './metrics.ts';

export function tankRow(t: TankMetrics): TankRaidRow {
  return {
    source: t.source,
    name: t.name,
    icon: t.icon,
    specLabel: t.specLabel,
    role: t.role,
    tanked: t.tanked,
    swingShare: t.swingShare,
    effectiveHealth: t.survivability.effectiveHealth,
    avoided: t.swings.avoided,
    crushes: t.swings.crush,
    swings: t.swings.total,
    coverage: t.mitigation[0]?.swingsCovered,
    tps: t.threat.tps,
    opener: t.threat.opener[1],
    cooldowns: t.cooldowns.length,
    threatDrops: t.threatDrops.length,
    died: t.died,
  };
}

/** A tank's row on one kill, or undefined if they didn't tank it. */
export async function tankRowOn(client: WclClient, report: string, fightId: number, source: number, fights: WclFightsResponse) {
  const data = await fetchTankFight(client, report, fightId, source, fights);
  const spec = tankSpecIn(data);
  if (!spec) return undefined;
  const t = tankMetrics(data, new FightModel(data.raid), spec);
  return t.swings.total ? tankRow(t) : undefined;
}

export async function tankRaidSummary(client: WclClient, report: string): Promise<TankRaidSummary> {
  const fights = await client.fights(report);
  const kills = fights.fights.filter((f) => f.boss && f.kill);
  return {
    report,
    bosses: await Promise.all(
      kills.map(async (f) => {
        // Tanks: tank-spec icons in the melee-taken table (shared with the raid-wide fetch).
        const melee = await client.table<{ entries: { id: number; icon: string }[] }>('damage-taken', report, { start: f.start_time, end: f.end_time, abilityid: 1 });
        const ids = melee.entries.filter((e) => TANK_ICONS.has(e.icon)).map((e) => e.id);
        const rows = (await Promise.all(ids.map((id) => tankRowOn(client, report, f.id, id, fights).catch(() => undefined)))).filter((r): r is TankRaidRow => !!r);
        return { fight: f.id, name: f.name, durationSec: (f.end_time - f.start_time) / 1000, rows: rows.sort((a, b) => b.swingShare - a.swingShare) };
      }),
    ),
  };
}
