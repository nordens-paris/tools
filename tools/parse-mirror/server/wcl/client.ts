// Minimal Warcraft Logs v1 API client with an on-disk cache.
//
// Reports don't change once a fight is logged, so report data is cached forever (except the fight
// list of a report that may still be logging). Rankings change over time and are cached for a few
// hours. The cache holds public report data only and is shared by every API key.
//
// Rate limits: each response carries x-ratelimit-limit/-remaining for a short (about a minute)
// window; the client slows down before running out. Warcraft Logs also has an hourly points
// budget per key (3,600 on the current plan) that v1 doesn't report, so requests per hour are
// counted here as an estimate.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { game } from '../game.ts';
import type {
  WclCombatantInfo,
  WclEvent,
  WclFightsResponse,
  WclParse,
  WclRankingsResponse,
  WclTableAuras,
  WclTableEntries,
} from './types.ts';

const CACHE_DIR = path.resolve('.cache/wcl');
const RANKINGS_TTL_MS = 6 * 60 * 60 * 1000;
/** Fight list of a report that ended less than this long ago: it may still be logging. */
const LIVE_REPORT_MS = 12 * 60 * 60 * 1000;
const LIVE_FIGHTS_TTL_MS = 5 * 60 * 1000;
const MAX_CONCURRENT = 3;
/** Pause when the short window has fewer requests left than this. */
const WINDOW_RESERVE = 25;
const WINDOW_MS = 60 * 1000;

/** Rate-limit state per API key (by hash, so keys aren't kept in memory as-is). */
interface Quota {
  limit?: number;
  remaining?: number;
  updatedAt: number;
  /** Timestamps of requests sent in the last hour. */
  sent: number[];
}
const quotas = new Map<string, Quota>();

export interface QuotaStatus {
  /** Short-window limit and what's left, as last reported by Warcraft Logs. */
  windowLimit?: number;
  windowRemaining?: number;
  requestsLastHour: number;
}

/** Report data requests in flight, so identical concurrent requests share one fetch. */
const inflight = new Map<string, Promise<unknown>>();

let active = 0;
const queue: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class WclClient {
  private keyId: string;

  constructor(
    private apiKey: string,
    // Dev scripts pass process.env.WCL_HOST, which may be unset; the game profile has the default.
    private host: string = game.wclHost,
  ) {
    this.host ||= game.wclHost;
    if (!apiKey) throw new Error('WCL_API_KEY is not set (see .env.example)');
    this.keyId = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
  }

  /** How much of this key's rate limit is used. */
  quota(): QuotaStatus {
    const q = quotas.get(this.keyId);
    const hourAgo = Date.now() - 60 * 60 * 1000;
    return { windowLimit: q?.limit, windowRemaining: q?.remaining, requestsLastHour: q?.sent.filter((t) => t > hourAgo).length ?? 0 };
  }

  private async fetchWithQuota(url: string, endpoint: string): Promise<unknown> {
    const q = quotas.get(this.keyId) ?? { updatedAt: 0, sent: [] };
    quotas.set(this.keyId, q);
    for (let attempt = 0; ; attempt++) {
      // Nearly out of the short window: wait for it to refill instead of getting a 429.
      const sinceUpdate = Date.now() - q.updatedAt;
      if (q.remaining !== undefined && q.remaining < WINDOW_RESERVE && sinceUpdate < WINDOW_MS) await sleep(WINDOW_MS - sinceUpdate);
      const now = Date.now();
      q.sent = q.sent.filter((t) => t > now - 60 * 60 * 1000);
      q.sent.push(now);
      let res: Response;
      try {
        res = await fetch(url);
      } catch (err) {
        // Network hiccup: try a couple more times before giving up.
        if (attempt < 2) {
          await sleep(2_000 * 2 ** attempt);
          continue;
        }
        throw new Error(`Couldn't reach Warcraft Logs (${(err as Error).message}).`);
      }
      const limit = Number(res.headers.get('x-ratelimit-limit'));
      const remaining = Number(res.headers.get('x-ratelimit-remaining'));
      if (limit) Object.assign(q, { limit, remaining, updatedAt: Date.now() });
      // Rate limited: wait as long as the server asks, else back off 15s, 30s, 60s, 120s.
      if (res.status === 429 && attempt < 4) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 15_000 * 2 ** attempt);
        continue;
      }
      // Warcraft Logs is briefly down or overloaded: retry twice.
      if (res.status >= 500 && attempt < 2) {
        await sleep(2_000 * 2 ** attempt);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error('Warcraft Logs rejected the API key. Check that it is a v1 client key from your Warcraft Logs profile.');
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Warcraft Logs ${endpoint} failed (${res.status}): ${body.slice(0, 200)}`);
      }
      return res.json();
    }
  }

  private async get<T>(
    endpoint: string,
    params: Record<string, string | number>,
    ttlMs?: number | ((cached: T) => number | undefined),
  ): Promise<T> {
    // translate=true makes non-English logs return English ability names. Only use it when
    // needed: it maps to modern names, which we then fix up by spell ID (see spellName()).
    const report = endpoint.match(/^report\/(?!fights\/)[^/]+\/(?:[^/]+\/)?([A-Za-z0-9]+)$/)?.[1];
    const all = report && (await this.fights(report)).lang !== 'en' ? { ...params, translate: 'true' } : params;
    const query = new URLSearchParams(Object.entries(all).map(([k, v]) => [k, String(v)]));
    const cacheKey = `${this.host}/v1/${endpoint}?${query}`;
    const file = path.join(CACHE_DIR, crypto.createHash('sha1').update(cacheKey).digest('hex') + '.json');

    try {
      const stat = await fs.stat(file);
      const cached = JSON.parse(await fs.readFile(file, 'utf8')) as T;
      const ttl = typeof ttlMs === 'function' ? ttlMs(cached) : ttlMs;
      if (ttl === undefined || Date.now() - stat.mtimeMs < ttl) return cached;
    } catch {
      // Not cached yet (or a broken file, which gets refetched).
    }

    const pending = inflight.get(cacheKey);
    if (pending) return pending as Promise<T>;
    const fetching = (async () => {
      query.set('api_key', this.apiKey);
      const url = `https://${this.host}/v1/${endpoint}?${query}`;
      const data = (await withSlot(() => this.fetchWithQuota(url, endpoint))) as T;
      // Write to a temp file and rename, so a concurrent read never sees half a file.
      await fs.mkdir(CACHE_DIR, { recursive: true });
      const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data));
      await fs.rename(tmp, file);
      return data;
    })();
    inflight.set(cacheKey, fetching);
    try {
      return await fetching;
    } finally {
      inflight.delete(cacheKey);
    }
  }

  fights(report: string) {
    // A report that ended recently may still be logging, so its fight list is refreshed.
    return this.get<WclFightsResponse>(`report/fights/${report}`, {}, (cached) =>
      cached.end && Date.now() - cached.end < LIVE_REPORT_MS ? LIVE_FIGHTS_TTL_MS : undefined,
    );
  }

  table<T = WclTableEntries>(
    view: 'damage-done' | 'damage-taken' | 'casts' | 'buffs' | 'debuffs',
    report: string,
    params: Record<string, string | number>,
  ) {
    return this.get<T>(`report/tables/${view}/${report}`, params);
  }

  buffs(report: string, start: number, end: number, sourceId: number) {
    return this.table<WclTableAuras>('buffs', report, { start, end, sourceid: sourceId });
  }

  /** Debuffs on enemies; with sourceId, only those the player applied. */
  bossDebuffs(report: string, start: number, end: number, sourceId?: number) {
    return this.table<WclTableAuras>('debuffs', report, { start, end, hostility: 1, ...(sourceId ? { sourceid: sourceId } : {}) });
  }

  /** All events of a view for one player, following pagination. */
  async events(view: 'casts' | 'summary' | 'damage-done' | 'buffs', report: string, start: number, end: number, params: Record<string, string | number>) {
    const events: WclEvent[] = [];
    let from = start;
    for (let page = 0; page < 50; page++) {
      const res = await this.get<{ events: WclEvent[]; nextPageTimestamp?: number }>(
        `report/events/${view}/${report}`,
        { start: from, end, ...params },
      );
      events.push(...res.events);
      if (!res.nextPageTimestamp || res.nextPageTimestamp >= end) break;
      from = res.nextPageTimestamp;
    }
    return events;
  }

  /** Everyone's gear, stats and auras at the pull: one call for the whole raid. */
  async combatantInfos(report: string, start: number, end: number): Promise<(WclCombatantInfo & { sourceID: number })[]> {
    const events = await this.events('summary', report, start, Math.min(end, start + 1000), { filter: 'type="combatantinfo"' });
    return events.filter((e) => e.type === 'combatantinfo') as (WclCombatantInfo & { sourceID: number })[];
  }

  /** A character's ranked kills; without a zone, Warcraft Logs uses the current raid tier. */
  parses(name: string, server: string, region: string, zone?: number) {
    return this.get<WclParse[]>(
      `parses/character/${encodeURIComponent(name)}/${encodeURIComponent(server)}/${region}`,
      { metric: 'dps', ...(zone ? { zone } : {}) },
      RANKINGS_TTL_MS,
    );
  }

  /** Rankings, 100 per page (page 1 = ranks 1-100). */
  rankings(encounterId: number, classId: number, specId: number, page = 1) {
    return this.get<WclRankingsResponse>(
      `rankings/encounter/${encounterId}`,
      { metric: 'dps', class: classId, spec: specId, ...(page > 1 ? { page } : {}) },
      RANKINGS_TTL_MS,
    );
  }
}
