// Healer and tank pages run in the visitor's browser on their own Warcraft Logs key, with the same
// analysis code as the server (server/analysis/healer, server/analysis/tank): on the hosted site
// the server has a tenth of a CPU core, and every kill these pages read took it 2-3 s to unpack and
// analyse. Loaded on demand (roles.ts), so DPS pages don't download it. Only the tank sims still go
// through the server, which fetches each tank's gear for them; they run in the browser as before.
import { analyzeHealer } from '../../server/analysis/healer/compare.ts';
import { healerRaidSummary } from '../../server/analysis/healer/raid.ts';
import { applyRoleRows, roleRowsOn, type RoleRows } from '../../server/analysis/raidRoles.ts';
import { analyzeTank } from '../../server/analysis/tank/compare.ts';
import { tankRaidSummary } from '../../server/analysis/tank/raid.ts';
import type { HealerAnalysis, RaidSummary, TankAnalysis } from '../../shared/types.ts';
import { postTankSims } from './api.ts';
import { browserClient } from './wclBrowser.ts';

export async function roleAnalysis(kind: 'healer' | 'tank', key: string, report: string, fight: number, source: number): Promise<HealerAnalysis | TankAnalysis> {
  const wcl = browserClient(key);
  if (kind === 'healer') return analyzeHealer(wcl, report, fight, source);
  const stored = await analyzeTank(wcl, report, fight, source);
  // The sims start from the server, which needs what they're built from.
  await postTankSims(stored);
  return stored.analysis;
}

/** The player's healer and tank rows on their raid page, which the server left out. */
export async function raidRoles(key: string, raid: RaidSummary): Promise<RaidSummary> {
  const can = raid.player.rolesPending;
  if (!can) return raid;
  const wcl = browserClient(key);
  const fights = await wcl.fights(raid.report);
  const rows = new Map<number, RoleRows>();
  await Promise.all(
    raid.bosses.map(async (b) => {
      rows.set(b.fight, await roleRowsOn(wcl, raid.report, b.fight, raid.player.source, fights, can));
    }),
  );
  return applyRoleRows(raid, rows);
}

export const raidHealers = (key: string, report: string) => healerRaidSummary(browserClient(key), report);
export const raidTanks = (key: string, report: string) => tankRaidSummary(browserClient(key), report);
