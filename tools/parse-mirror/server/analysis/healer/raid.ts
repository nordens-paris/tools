// Healers on every boss kill of a report, for the raid pages. Own fights only (no peers): about
// 10 requests per kill, shared by every healer and by the single-kill healer page.
import type { HealerMetrics, HealerRaidRow, HealerRaidSummary } from '../../../shared/types.ts';
import type { WclReader } from '../../wcl/reader.ts';
import type { WclFightsResponse } from '../../wcl/types.ts';
import { fetchHealerFight } from './data.ts';
import { healerDeaths, healerMetrics, ownOverheal } from './metrics.ts';
import { FightModel } from './model.ts';

const POTIONS = ['Mana potion', 'Dark Rune', 'Demonic Rune'];

export function raidRow(h: HealerMetrics): HealerRaidRow {
  const own = h.cooldowns.filter((c) => !c.from);
  return {
    source: h.source,
    name: h.name,
    icon: h.icon,
    specLabel: h.specLabel,
    role: h.role,
    tankShare: h.tankShare,
    hps: h.hps,
    healPerMana: h.mana?.healPerMana,
    overhealPct: h.overhealPct,
    ownOverheal: ownOverheal(h),
    manaEnd: h.mana?.end,
    potions: own.filter((c) => POTIONS.includes(c.name)).length,
    cooldowns: own.filter((c) => !POTIONS.includes(c.name)).length,
    idleSec: h.idleWhileNeeded.sec,
    saves: h.saves,
  };
}

/** The model of every boss kill in a report, built one kill at a time (the client limits requests). */
export async function bossKillModels(client: WclReader, report: string, fights?: WclFightsResponse) {
  const fl = fights ?? (await client.fights(report));
  const kills = fl.fights.filter((f) => f.boss && f.kill);
  return Promise.all(kills.map(async (f) => new FightModel(await fetchHealerFight(client, report, f.id, fl))));
}

export async function healerRaidSummary(client: WclReader, report: string): Promise<HealerRaidSummary> {
  const models = await bossKillModels(client, report);
  return {
    report,
    bosses: models.map((m) => {
      const deaths = { burst: 0, fast: 0, window: 0 };
      for (const d of healerDeaths(m)) deaths[d.kind]++;
      return {
        fight: m.data.fight.id,
        encounterId: m.data.fight.boss,
        name: m.data.fight.name,
        durationSec: m.durationSec,
        healers: m.healers.size,
        dtpsPerHealer: m.raidDtps / Math.max(1, m.healers.size),
        deaths,
        rows: [...m.healers.keys()].map((id) => raidRow(healerMetrics(m, id))),
      };
    }),
  };
}
