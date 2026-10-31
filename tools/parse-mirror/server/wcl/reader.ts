// What the healer and tank analyses need from a Warcraft Logs client. The server's (client.ts)
// has it, and so does the browser's (web/src/wclBrowser.ts): with the visitor's own key, healer
// and tank pages run in their browser instead of on the hosted site's small server.
import type { WclClient } from './client.ts';

/**
 * For a lookup that may fail on one private or deleted report: gives `fallback` then, but lets
 * being rate limited or offline through, as every other lookup would fail the same way.
 */
export const unlessOutage =
  <T,>(fallback: T) =>
  (err: unknown): T => {
    if (/rate limit|\(429\)|couldn.t reach/i.test((err as Error).message)) throw err;
    return fallback;
  };

export type WclReader = Pick<WclClient, 'fights' | 'events' | 'combatantInfos' | 'table' | 'buffs' | 'bossDebuffs' | 'raidRankings' | 'rankings' | 'parses'>;
