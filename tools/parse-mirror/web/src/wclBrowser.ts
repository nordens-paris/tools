// Warcraft Logs v1 straight from the browser, on the visitor's own key. The log site allows it
// (CORS), so healer and tank pages skip the server: on the hosted site it has a tenth of a CPU core,
// and unpacking and analysing one kill took it 2-3 s, against well under 0.1 s here.
// What the healer and tank analyses need (server/wcl/reader.ts). Fight lists and rankings are kept
// in memory for this page load; report data is also kept between visits (wclStore.ts), as a report's
// fights don't change, so reopening a kill doesn't spend the visitor's key again.
import type { WclReader } from '../../server/wcl/reader.ts';
import type { WclCombatantInfo, WclEvent, WclFightsResponse, WclParse, WclRaidRankingsResponse, WclRankingsResponse, WclTableAuras } from '../../server/wcl/types.ts';
import { game } from './game.ts';
import { readStored, writeStored } from './wclStore.ts';

/** Requests at once. The key's per-minute window (about 800) still applies. */
const MAX_CONCURRENT = 6;
/** Responses kept in memory (oldest go first): a tank page or raid page asks for some twice. */
const KEPT_MAX = 400;
/** Longest Retry-After worth waiting out; longer, and the fetch fails with a message. */
const MAX_RETRY_WAIT_MS = 20_000;
/** A report this recent may still be logging (as on the server). */
const LIVE_REPORT_MS = 12 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class BrowserWcl implements WclReader {
  private fightLists = new Map<string, Promise<WclFightsResponse>>();
  /** Report data, rankings and parses: report data never changes, rankings rarely in a visit. */
  private keptData = new Map<string, Promise<unknown>>();
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(
    private apiKey: string,
    private host = game.wclHost,
  ) {}

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_CONCURRENT) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  private async get<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<T> {
    // Non-English logs: English ability names, as on the server (server/wcl/client.ts).
    const report = endpoint.match(/^report\/(?!fights\/)[^/]+\/(?:[^/]+\/)?([A-Za-z0-9]+)$/)?.[1];
    const all = report && (await this.fights(report)).lang !== 'en' ? { ...params, translate: 'true' } : params;
    const query = new URLSearchParams(Object.entries(all).map(([k, v]) => [k, String(v)]));
    query.set('api_key', this.apiKey);
    const url = `https://${this.host}/v1/${endpoint}?${query}`;
    return this.slot(async () => {
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await fetch(url);
        } catch {
          if (attempt < 2) {
            await sleep(2_000 * 2 ** attempt);
            continue;
          }
          throw new Error("Couldn't reach Warcraft Logs.");
        }
        if (res.status === 429 && attempt < 4) {
          const retryAfter = Number(res.headers.get('retry-after')) * 1000 || 15_000 * 2 ** attempt;
          if (retryAfter > MAX_RETRY_WAIT_MS) throw new Error(`Warcraft Logs is rate limiting your key for another ${Math.ceil(retryAfter / 60_000)} min.`);
          await sleep(retryAfter);
          continue;
        }
        if (res.status >= 500 && attempt < 2) {
          await sleep(2_000 * 2 ** attempt);
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          const said = ((await res.json().catch(() => undefined)) as { error?: string } | undefined)?.error;
          throw new Error(`Warcraft Logs refused the request${said ? ` (${said})` : ''}. Your key must be a v1 client key, and the report must be public.`);
        }
        if (!res.ok) throw new Error(`Warcraft Logs ${endpoint.split('/').slice(0, 2).join('/')} failed (${res.status}).`);
        return (await res.json()) as T;
      }
    });
  }

  fights(report: string) {
    if (!this.fightLists.has(report)) {
      const list = this.finishedFights(report);
      list.catch(() => this.fightLists.delete(report));
      this.fightLists.set(report, list);
    }
    return this.fightLists.get(report)!;
  }

  /** A fight list is kept between visits once the report is too old to still be logging. */
  private async finishedFights(report: string) {
    const key = `${this.host}/report/fights/${report}`;
    const old = (list: WclFightsResponse) => !!list.end && Date.now() - list.end > LIVE_REPORT_MS;
    const hit = await readStored<WclFightsResponse>(key);
    if (hit && old(hit)) return hit;
    const list = await this.get<WclFightsResponse>(`report/fights/${report}`);
    if (old(list)) void writeStored(key, list);
    return list;
  }

  private remember<T>(key: string, fetch: () => Promise<T>): Promise<T> {
    if (!this.keptData.has(key)) {
      const p = fetch();
      p.catch(() => this.keptData.delete(key));
      this.keptData.set(key, p);
      if (this.keptData.size > KEPT_MAX) this.keptData.delete(this.keptData.keys().next().value!);
    }
    return this.keptData.get(key) as Promise<T>;
  }

  /** Report data: also kept between visits. */
  private stored<T>(key: string, fetch: () => Promise<T>): Promise<T> {
    return this.remember(key, async () => {
      const full = `${this.host}/${key}`;
      const hit = await readStored<T>(full);
      if (hit !== undefined) return hit;
      const value = await fetch();
      void writeStored(full, value);
      return value;
    });
  }

  private kept<T>(endpoint: string, params: Record<string, string | number>): Promise<T> {
    const key = `${endpoint}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;
    return this.remember(key, () => this.get<T>(endpoint, params));
  }

  table<T>(view: string, report: string, params: Record<string, string | number>) {
    const endpoint = `report/tables/${view}/${report}`;
    return this.stored<T>(`${endpoint}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`, () => this.get<T>(endpoint, params));
  }

  buffs(report: string, start: number, end: number, sourceId: number) {
    return this.table<WclTableAuras>('buffs', report, { start, end, sourceid: sourceId });
  }

  /** Debuffs on enemies; with sourceName, only those that player applied (as on the server). */
  bossDebuffs(report: string, start: number, end: number, sourceName?: string) {
    const params: Record<string, string | number> = { start, end, hostility: 1 };
    if (sourceName) params.filter = `source.name="${sourceName.replace(/"/g, '\\"')}"`;
    return this.table<WclTableAuras>('debuffs', report, params);
  }

  parses(name: string, server: string, region: string, zone?: number, metric: 'dps' | 'hps' = 'dps') {
    return this.kept<WclParse[]>(`parses/character/${encodeURIComponent(name)}/${encodeURIComponent(server)}/${region}`, { metric, ...(zone ? { zone } : {}) });
  }

  rankings(encounterId: number, classId: number, specId: number, page = 1, metric: 'dps' | 'hps' = 'dps') {
    return this.kept<WclRankingsResponse>(`rankings/encounter/${encounterId}`, { metric, class: classId, spec: specId, ...(page > 1 ? { page } : {}) });
  }

  raidRankings(encounterId: number, metric: 'speed' | 'execution', page = 1) {
    return this.kept<WclRaidRankingsResponse>(`rankings/encounter/${encounterId}`, { metric, ...(page > 1 ? { page } : {}) });
  }

  /** All events of a view, following pagination; with `fields`, only those are kept. */
  async events(view: string, report: string, start: number, end: number, params: Record<string, string | number>, fields?: readonly string[]) {
    const key = `events/${view}/${report}?${start}-${end}&${JSON.stringify(params)}&${fields?.join(',') ?? ''}`;
    // A copy, so a caller sorting or filtering in place can't change what the next one gets.
    return (await this.stored(key, () => this.allEvents(view, report, start, end, params, fields))).slice();
  }

  private async allEvents(view: string, report: string, start: number, end: number, params: Record<string, string | number>, fields?: readonly string[]) {
    const events: WclEvent[] = [];
    let from = start;
    for (let page = 0; page < 50; page++) {
      const res = await this.get<{ events: WclEvent[]; nextPageTimestamp?: number }>(`report/events/${view}/${report}`, { start: from, end, ...params });
      for (const e of res.events) events.push(fields && e.type !== 'combatantinfo' ? (Object.fromEntries(fields.filter((f) => f in e).map((f) => [f, e[f]])) as WclEvent) : e);
      if (!res.nextPageTimestamp || res.nextPageTimestamp >= end) break;
      from = res.nextPageTimestamp;
    }
    return events;
  }

  async combatantInfos(report: string, start: number, end: number) {
    const events = await this.events('summary', report, start, Math.min(end, start + 1000), { filter: 'type="combatantinfo"' });
    return events.filter((e) => e.type === 'combatantinfo') as (WclCombatantInfo & { sourceID: number })[];
  }
}

// One client per key for the page load, so pages share what's been fetched.
let shared: { key: string; client: BrowserWcl } | undefined;
export function browserClient(key: string): BrowserWcl {
  if (shared?.key !== key) shared = { key, client: new BrowserWcl(key) };
  return shared.client;
}
