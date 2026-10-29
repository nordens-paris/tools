// Healer and tank data: in this browser with the visitor's own key (roleBrowser.ts, loaded only
// when needed), else from the server (a local server on its own key).
import type { HealerAnalysis, HealerRaidSummary, RaidSummary, TankAnalysis, TankRaidSummary } from '../../shared/types.ts';
import { getGuildHealers, getGuildTanks, getRaid, getRole } from './api.ts';
import { getApiKey } from './apiKey.ts';

const browser = () => import('./roleBrowser.ts');

/** The healer or tank analysis made here, or undefined when the server should do it (DPS, or no own key). */
export async function roleAnalysisHere(report: string, fight: number, source: number): Promise<HealerAnalysis | TankAnalysis | undefined> {
  const key = getApiKey();
  if (!key) return undefined;
  const { kind } = await getRole(report, fight, source);
  if (kind === 'dps') return undefined;
  return (await browser()).roleAnalysis(kind, key, report, fight, source);
}

export async function raidSummary(report: string, source: number): Promise<RaidSummary> {
  const key = getApiKey();
  const raid = await getRaid(report, source, !!key);
  return key && raid.player.rolesPending ? (await browser()).raidRoles(key, raid) : raid;
}

export async function raidHealers(report: string): Promise<HealerRaidSummary> {
  const key = getApiKey();
  return key ? (await browser()).raidHealers(key, report) : getGuildHealers(report);
}

export async function raidTanks(report: string): Promise<TankRaidSummary> {
  const key = getApiKey();
  return key ? (await browser()).raidTanks(key, report) : getGuildTanks(report);
}
