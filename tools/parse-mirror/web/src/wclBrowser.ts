// Warcraft Logs v1 straight from the browser, on the visitor's own key. The log site allows it
// (CORS), so the healer score's kills skip the server: on the hosted site it has a tenth of a CPU
// core, and unpacking and analysing one kill took it 2-3 s, against well under 0.1 s here.
// Only what fetching a healer kill needs (server/analysis/healer/data.ts); responses are kept in
// memory for this page load, and the analysed kills in IndexedDB (healerHistory.ts).
import type { WclCombatantInfo, WclEvent, WclFightsResponse } from '../../server/wcl/types.ts';
import { game } from './game.ts';

/** Requests at once. The key's per-minute window (about 800) still applies. */
const MAX_CONCURRENT = 6;
/** Longest Retry-After worth waiting out; longer, and the fetch fails with a message. */
const MAX_RETRY_WAIT_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class BrowserWcl {
  private fightLists = new Map<string, Promise<WclFightsResponse>>();
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
        if (res.status === 401 || res.status === 403) throw new Error('Warcraft Logs rejected your API key.');
        if (!res.ok) throw new Error(`Warcraft Logs ${endpoint.split('/').slice(0, 2).join('/')} failed (${res.status}).`);
        return (await res.json()) as T;
      }
    });
  }

  fights(report: string) {
    if (!this.fightLists.has(report)) {
      const list = this.get<WclFightsResponse>(`report/fights/${report}`);
      list.catch(() => this.fightLists.delete(report));
      this.fightLists.set(report, list);
    }
    return this.fightLists.get(report)!;
  }

  table<T>(view: string, report: string, params: Record<string, string | number>) {
    return this.get<T>(`report/tables/${view}/${report}`, params);
  }

  /** All events of a view, following pagination; with `fields`, only those are kept. */
  async events(view: string, report: string, start: number, end: number, params: Record<string, string | number>, fields?: readonly string[]) {
    const events: WclEvent[] = [];
    let from = start;
    for (let page = 0; page < 50; page++) {
      const res = await this.get<{ events: WclEvent[]; nextPageTimestamp?: number }>(`report/events/${view}/${report}`, { start: from, end, ...params });
      for (const e of res.events) events.push(fields ? (Object.fromEntries(fields.filter((f) => f in e).map((f) => [f, e[f]])) as WclEvent) : e);
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
