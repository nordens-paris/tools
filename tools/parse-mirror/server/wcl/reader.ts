// What the healer and tank analyses need from a Warcraft Logs client. The server's (client.ts)
// has it, and so does the browser's (web/src/wclBrowser.ts): with the visitor's own key, healer
// and tank pages run in their browser instead of on the hosted site's small server.
import type { WclClient } from './client.ts';

export type WclReader = Pick<WclClient, 'fights' | 'events' | 'combatantInfos' | 'table' | 'buffs' | 'bossDebuffs' | 'raidRankings' | 'rankings' | 'parses'>;
