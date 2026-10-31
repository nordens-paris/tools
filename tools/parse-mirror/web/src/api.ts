import type { AnalysisResult, GuildSummary, HealerAnalysis, HealerHistory, HealerKillScores, HealerRaidSummary, ProgressSummary, RaidSummary, SimResult, TankAnalysis, TankRaidSummary } from '../../shared/types.ts';
import { getApiKey } from './apiKey.ts';

// What was sent for tank sims, for this page load.
const tankUploads = new Map<string, unknown>();

export interface Quota {
  own: boolean;
  windowLimit?: number;
  windowRemaining?: number;
  requestsLastHour: number;
}

export interface ReportInfo {
  title: string;
  fights: { id: number; name: string; kill: boolean; durationSec: number }[];
  players: { id: number; name: string; icon: string; supported: boolean; fights: number[] }[];
}

/** needsKey: the server wants the visitor's own Warcraft Logs key for this (healer views). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly needsKey = false,
  ) {
    super(message);
  }
}

async function request<T>(url: string, body?: unknown): Promise<T> {
  const key = getApiKey();
  const headers: Record<string, string> = key ? { 'X-WCL-Key': key } : {};
  const res = await fetch(
    url,
    body === undefined
      ? { headers }
      : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, !!data.needsKey);
  return data as T;
}

export const getReport = (code: string) => request<ReportInfo>(`/api/report/${code}`);
export const getQuota = () => request<Quota>('/api/quota');
/** browserRoles: leave the healer and tank rows to this browser (roles.ts). */
export const getRaid = (code: string, source: number, browserRoles = false) => request<RaidSummary>(`/api/raid/${code}/${source}${browserRoles ? '?roles=browser' : ''}`);
/** Whether a player gets the healer, tank or DPS analysis on a kill. */
export const getRole = (code: string, fight: number, source: number) => request<{ kind: 'healer' | 'tank' | 'dps' }>(`/api/role/${code}/${fight}/${source}`);
/** A tank analysis made in this browser: the server keeps what its sims need. */
export const postTankSims = (id: string, stored: unknown) => {
  tankUploads.set(id, stored);
  if (tankUploads.size > 20) tankUploads.delete(tankUploads.keys().next().value!);
  return request<{ ok: true }>('/api/tank/sims', stored);
};
/** Sends a tank analysis again after the server forgot it (it restarted); false if it isn't kept here. */
export async function resendTankSims(id: string) {
  const stored = tankUploads.get(id);
  if (stored) await postTankSims(id, stored);
  return !!stored;
}
export const getGuild = (code: string) => request<GuildSummary>(`/api/guild/${code}`);
export const getGuildHealers = (code: string) => request<HealerRaidSummary>(`/api/guild/${code}/healers`);
export const getGuildTanks = (code: string) => request<TankRaidSummary>(`/api/guild/${code}/tanks`);
export const getHealerHistory = (code: string, source: number) => request<HealerHistory>(`/api/healer/history/${code}/${source}`);
export const getHealerKill = (code: string, fight: number) => request<HealerKillScores>(`/api/healer/kill/${code}/${fight}`);
export const getProgress = (code: string, source: number) => request<ProgressSummary>(`/api/progress/${code}/${source}`);
/** A DPS analysis, or a healer or tank analysis when the player healed or tanked (kind: 'healer' / 'tank'). */
export const analyze = (report: string, fight: number, source: number, mode: 'top' | 'peers' = 'top') =>
  request<AnalysisResult | HealerAnalysis | TankAnalysis>('/api/analyze', { report, fight, source, mode });
export const runSim = <T = SimResult>(analysisId: string) => request<T>('/api/sim', { analysisId });

/** Pulls report code, fight and source out of a Warcraft Logs URL. */
export function parseLogUrl(url: string): { report?: string; fight?: number; lastFight?: boolean; source?: number } {
  const report = url.match(/reports\/([A-Za-z0-9]{16})/)?.[1];
  const fight = url.match(/[?#&]fight=(\d+)/)?.[1];
  const source = url.match(/[?#&]source=(\d+)/)?.[1];
  return { report, fight: fight ? Number(fight) : undefined, lastFight: /[?#&]fight=last\b/.test(url) || undefined, source: source ? Number(source) : undefined };
}
