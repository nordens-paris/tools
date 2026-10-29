// The healer and tank rows of a player's raid page, and what they make of the player (healer on
// most kills, tank on most kills). The server adds them (raid.ts); with the visitor's own key the
// browser does instead (web/src/roleBrowser.ts), since each kill's raid-wide data is the slow part.
import type { HealerRaidRow, RaidSummary, TankRaidRow } from '../../shared/types.ts';
import type { WclReader } from '../wcl/reader.ts';
import type { WclFightsResponse } from '../wcl/types.ts';
import { fetchHealerFight } from './healer/data.ts';
import { healerMetrics } from './healer/metrics.ts';
import { FightModel } from './healer/model.ts';
import { raidRow } from './healer/raid.ts';
import { isTanking } from './tank/data.ts';
import { tankRowOn } from './tank/raid.ts';

export interface RoleRows {
  healing?: HealerRaidRow;
  tanking?: TankRaidRow;
}

/** The player's tank row on a kill if they tanked it, else their healer row if they healed. */
export async function roleRowsOn(
  client: WclReader,
  report: string,
  fightId: number,
  source: number,
  fights: WclFightsResponse,
  can: { heal: boolean; tank: boolean },
): Promise<RoleRows> {
  const tanking = can.tank && (await isTanking(client, report, fightId, source, fights)) ? await tankRowOn(client, report, fightId, source, fights) : undefined;
  if (tanking || !can.heal) return { tanking };
  const model = new FightModel(await fetchHealerFight(client, report, fightId, fights));
  return { healing: model.healers.has(source) ? raidRow(healerMetrics(model, source)) : undefined };
}

/** Puts the rows on the bosses and decides whether the player was a tank or healer on most kills. */
export function applyRoleRows(summary: RaidSummary, rows: Map<number, RoleRows>): RaidSummary {
  const bosses = summary.bosses.map((b) => ({ ...b, healing: rows.get(b.fight)?.healing ?? b.healing, tanking: rows.get(b.fight)?.tanking ?? b.tanking }));
  const tank = bosses.filter((b) => b.tanking).length * 2 >= Math.max(1, bosses.length);
  const healer = !tank && bosses.filter((b) => b.healing).length * 2 >= Math.max(1, bosses.length);
  const p = summary.player;
  return {
    ...summary,
    bosses,
    player: { ...p, healer, tank, supported: p.supported || healer || tank, dps: p.dps && !healer && !tank, rolesPending: undefined },
  };
}
