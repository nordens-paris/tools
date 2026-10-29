// Minimal Warcraft Logs v1 API client with an on-disk cache (gzipped JSON).
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
import { promisify } from 'node:util';
import zlib from 'node:zlib';

import { game } from '../game.ts';
import type {
  WclCombatantInfo,
  WclEvent,
  WclFightsResponse,
  WclParse,
  WclRaidRankingsResponse,
  WclRankingsResponse,
  WclTableAuras,
  WclTableEntries,
} from './types.ts';

const CACHE_DIR = path.resolve('.cache/wcl');
const RANKINGS_TTL_MS = 6 * 60 * 60 * 1000;
/** Fight list of a report that ended less than this long ago: it may still be logging. */
const LIVE_REPORT_MS = 12 * 60 * 60 * 1000;
const LIVE_FIGHTS_TTL_MS = 5 * 60 * 1000;
/** Requests at once. Each takes ~0.4 s, so this sets the speed; the per-minute window still applies. */
const MAX_CONCURRENT = Number(process.env.WCL_CONCURRENCY ?? 8);
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

/**
 * Longest Retry-After worth waiting out inside a request. Warcraft Logs also rate limits single
 * endpoints (character parses, after many lookups) for a quarter of an hour or more; waiting that
 * out left pages stuck on "Fetching logs", so those fail fast until the time is up instead.
 */
const MAX_RETRY_WAIT_MS = 20_000;
/** Per API key (hash) and endpoint kind ("parses/character"): rate limited until this time. */
const blockedUntil = new Map<string, number>();

export interface QuotaStatus {
  /** Short-window limit and what's left, as last reported by Warcraft Logs. */
  windowLimit?: number;
  windowRemaining?: number;
  requestsLastHour: number;
}

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const cachePath = (key: string) => path.join(CACHE_DIR, crypto.createHash('sha1').update(key).digest('hex'));

/** A cached response: gzipped (event data shrinks about 10x), or plain JSON from older caches. */
async function readCache<T>(base: string): Promise<{ data: T; mtimeMs: number } | undefined> {
  for (const [ext, zipped] of [['.json.gz', true], ['.json', false]] as const) {
    try {
      const [stat, buf] = await Promise.all([fs.stat(base + ext), fs.readFile(base + ext)]);
      return { data: JSON.parse((zipped ? await gunzip(buf) : buf).toString('utf8')) as T, mtimeMs: stat.mtimeMs };
    } catch {
      // Not there (or broken): try the next format.
    }
  }
  return undefined;
}

/** Writes to a temp file and renames, so a concurrent read never sees half a file. */
async function writeCache(base: string, data: unknown) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${base}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, await gzip(JSON.stringify(data)));
  await fs.rename(tmp, `${base}.json.gz`);
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
    const kind = endpoint.split('/').slice(0, 2).join('/');
    const blockKey = `${this.keyId} ${kind}`;
    const rateLimited = (until: number) =>
      new Error(`Warcraft Logs is rate limiting ${kind} requests for another ${Math.ceil((until - Date.now()) / 60_000)} min.`);
    for (let attempt = 0; ; attempt++) {
      const until = blockedUntil.get(blockKey) ?? 0;
      if (until > Date.now()) throw rateLimited(until);
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
        if (retryAfter * 1000 > MAX_RETRY_WAIT_MS) {
          blockedUntil.set(blockKey, Date.now() + retryAfter * 1000);
          console.warn(`Warcraft Logs rate limited ${kind} for ${Math.round(retryAfter)} s`);
          throw rateLimited(Date.now() + retryAfter * 1000);
        }
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

  /** `slim` trims a response before it's cached (and is part of the cache key). */
  private async get<T>(
    endpoint: string,
    params: Record<string, string | number>,
    ttlMs?: number | ((cached: T) => number | undefined),
    slim?: { key: string; apply: (data: T) => T },
  ): Promise<T> {
    // translate=true makes non-English logs return English ability names. Only use it when
    // needed: it maps to modern names, which we then fix up by spell ID (see spellName()).
    const report = endpoint.match(/^report\/(?!fights\/)[^/]+\/(?:[^/]+\/)?([A-Za-z0-9]+)$/)?.[1];
    const all = report && (await this.fights(report)).lang !== 'en' ? { ...params, translate: 'true' } : params;
    const query = new URLSearchParams(Object.entries(all).map(([k, v]) => [k, String(v)]));
    const cacheKey = `${this.host}/v1/${endpoint}?${query}${slim ? `#${slim.key}` : ''}`;
    const base = cachePath(cacheKey);

    const cached = await readCache<T>(base);
    if (cached) {
      const ttl = typeof ttlMs === 'function' ? ttlMs(cached.data) : ttlMs;
      if (ttl === undefined || Date.now() - cached.mtimeMs < ttl) return cached.data;
    }
    // A slimmed response can be made from the full one if that's cached (report data never changes).
    const full = slim && (await readCache<T>(cachePath(cacheKey.split('#')[0])));
    if (slim && full) {
      const data = slim.apply(full.data);
      await writeCache(base, data);
      return data;
    }

    const pending = inflight.get(cacheKey);
    if (pending) return pending as Promise<T>;
    const fetching = (async () => {
      query.set('api_key', this.apiKey);
      const url = `https://${this.host}/v1/${endpoint}?${query}`;
      const raw = (await withSlot(() => this.fetchWithQuota(url, endpoint))) as T;
      const data = slim ? slim.apply(raw) : raw;
      await writeCache(base, data);
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
    view: 'damage-done' | 'damage-taken' | 'healing' | 'casts' | 'buffs' | 'debuffs',
    report: string,
    params: Record<string, string | number>,
  ) {
    return this.get<T>(`report/tables/${view}/${report}`, params);
  }

  buffs(report: string, start: number, end: number, sourceId: number) {
    return this.table<WclTableAuras>('buffs', report, { start, end, sourceid: sourceId });
  }

  /**
   * Debuffs on enemies; with sourceName, only those that player applied. (With hostility=1 a
   * `sourceid` is read as an enemy's id, and `source.id` filters don't work in tables: by name does.)
   */
  bossDebuffs(report: string, start: number, end: number, sourceName?: string) {
    const params: Record<string, string | number> = { start, end, hostility: 1 };
    if (sourceName) params.filter = `source.name="${sourceName.replace(/"/g, '\\"')}"`;
    return this.table<WclTableAuras>('debuffs', report, params);
  }

  /**
   * All events of a view (one player, or everyone without a sourceid), following pagination.
   * With `fields`, only those fields of each event are kept (and cached): raid-wide events carry
   * position, stats and more on every line, several MB per fight.
   */
  async events(
    view: 'casts' | 'summary' | 'damage-done' | 'damage-taken' | 'healing' | 'buffs' | 'debuffs' | 'deaths',
    report: string,
    start: number,
    end: number,
    params: Record<string, string | number>,
    fields?: readonly string[],
  ) {
    type Page = { events: WclEvent[]; nextPageTimestamp?: number };
    const slim = fields && {
      key: `fields=${fields.join(',')}`,
      apply: (page: Page): Page => ({
        ...page,
        events: page.events.map((e) => Object.fromEntries(fields.filter((f) => f in e).map((f) => [f, e[f]])) as WclEvent),
      }),
    };
    const events: WclEvent[] = [];
    let from = start;
    for (let page = 0; page < 50; page++) {
      const res = await this.get<Page>(`report/events/${view}/${report}`, { start: from, end, ...params }, undefined, slim);
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

  /** A guild's reports (newest first), with their start and end (epoch ms). Cached for an hour. */
  guildReports(guild: string, server: string, region: string) {
    return this.get<{ id: string; title: string; owner: string; start: number; end: number; zone: number }[]>(
      `reports/guild/${encodeURIComponent(guild)}/${encodeURIComponent(server)}/${region}`,
      {},
      60 * 60 * 1000,
    );
  }

  /** A character's ranked kills; without a zone, Warcraft Logs uses the current raid tier. */
  parses(name: string, server: string, region: string, zone?: number, metric: 'dps' | 'hps' = 'dps') {
    return this.get<WclParse[]>(
      `parses/character/${encodeURIComponent(name)}/${encodeURIComponent(server)}/${region}`,
      { metric, ...(zone ? { zone } : {}) },
      RANKINGS_TTL_MS,
    );
  }

  /** Rankings, 100 per page (page 1 = ranks 1-100). */
  rankings(encounterId: number, classId: number, specId: number, page = 1, metric: 'dps' | 'hps' = 'dps') {
    return this.get<WclRankingsResponse>(
      `rankings/encounter/${encounterId}`,
      { metric, class: classId, spec: specId, ...(page > 1 ? { page } : {}) },
      RANKINGS_TTL_MS,
    );
  }

  /** Whole-raid rankings: fastest kills, or cleanest (least damage taken, fewest deaths). */
  raidRankings(encounterId: number, metric: 'speed' | 'execution', page = 1) {
    return this.get<WclRaidRankingsResponse>(
      `rankings/encounter/${encounterId}`,
      { metric, ...(page > 1 ? { page } : {}) },
      RANKINGS_TTL_MS,
    );
  }
}
