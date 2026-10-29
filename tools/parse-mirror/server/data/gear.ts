// Item ID aliases and tank stats on gear, without reading files at runtime: the tank analysis also
// runs in the browser (web/src/roleBrowser.ts), so the data comes in as an import.
import tankStats from '../../data/wowsims/tank-stats.json' with { type: 'json' };

/**
 * Items whose ID in the logs differs from WoWSims' for the same item. The Battlemaster's trinkets
 * show up in Anniversary logs as 34576-34580; WoWSims has them as 34163, 34162, 33832, 34049 and
 * 34050 (same names, icons and effects).
 */
const ITEM_ALIASES: Record<number, number> = {
  34576: 34163, // Battlemaster's Cruelty
  34577: 34162, // Battlemaster's Depravity
  34578: 33832, // Battlemaster's Determination
  34579: 34049, // Battlemaster's Audacity
  34580: 34050, // Battlemaster's Perseverance
};
/** The WoWSims item ID for an item ID from a log. */
export const simItemId = (id: number) => ITEM_ALIASES[id] ?? id;

// Tank-relevant stats on items, gems and enchants (str, agi, sta, def, dodge, parry, block...).
type Stats = Record<string, number>;
const stats = tankStats as { items: Record<string, Stats>; gems: Record<string, Stats>; enchants: Record<string, Stats> };

/** Sum of the tank-relevant stats on a player's gear, gems and enchants (no set bonuses or procs). */
export function gearStats(gear: { id: number; permanentEnchant?: number; gems?: { id: number }[] }[]): Stats {
  const total: Stats = {};
  const add = (st?: Stats) => {
    for (const [k, v] of Object.entries(st ?? {})) total[k] = (total[k] ?? 0) + v;
  };
  for (const g of gear) {
    if (!g.id) continue;
    add(stats.items[simItemId(g.id)]);
    if (g.permanentEnchant) add(stats.enchants[g.permanentEnchant]);
    for (const gem of g.gems ?? []) add(stats.gems[gem.id]);
  }
  return total;
}
