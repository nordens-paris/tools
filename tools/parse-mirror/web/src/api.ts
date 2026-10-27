import type { AnalysisResult, GuildSummary, HealerAnalysis, HealerRaidSummary, ProgressSummary, RaidSummary, SimResult } from '../../shared/types.ts';
import { getApiKey } from './apiKey.ts';

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
export const getRaid = (code: string, source: number) => request<RaidSummary>(`/api/raid/${code}/${source}`);
export const getGuild = (code: string) => request<GuildSummary>(`/api/guild/${code}`);
export const getGuildHealers = (code: string) => request<HealerRaidSummary>(`/api/guild/${code}/healers`);
export const getProgress = (code: string, source: number) => request<ProgressSummary>(`/api/progress/${code}/${source}`);
/** A DPS analysis, or a healer analysis when the player is healing (kind: 'healer'). */
export const analyze = (report: string, fight: number, source: number, mode: 'top' | 'peers' = 'top') =>
  request<AnalysisResult | HealerAnalysis>('/api/analyze', { report, fight, source, mode });
export const runSim = (analysisId: string) => request<SimResult>('/api/sim', { analysisId });

/** Pulls report code, fight and source out of a Warcraft Logs URL. */
export function parseLogUrl(url: string): { report?: string; fight?: number; source?: number } {
  const report = url.match(/reports\/([A-Za-z0-9]{16})/)?.[1];
  const fight = url.match(/[?#&]fight=(\d+)/)?.[1];
  const source = url.match(/[?#&]source=(\d+)/)?.[1];
  return { report, fight: fight ? Number(fight) : undefined, source: source ? Number(source) : undefined };
}
