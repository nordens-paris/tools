// Healers on every boss kill of a report, for the raid pages. Own fights only (no peers): about
// 10 requests per kill, shared by every healer and by the single-kill healer page. Wipes of a
// minute or more are included for the held-back check.
import { healingKept, heldBack, scoreInputs, usualIdle, usualShare, type HealerScoreRef } from '../../../shared/healerScore.ts';
import ref from '../../../shared/healerScoreRef.json' with { type: 'json' };
import type { HealerMetrics, HealerRaidRow, HealerRaidSummary } from '../../../shared/types.ts';
import type { WclReader } from '../../wcl/reader.ts';
import type { WclFightsResponse } from '../../wcl/types.ts';
import { fetchHealerFight } from './data.ts';
import { healerDeaths, healerMetrics, ownOverheal } from './metrics.ts';
import { FightModel } from './model.ts';

const POTIONS = ['Mana potion', 'Dark Rune', 'Demonic Rune'];

export function raidRow(h: HealerMetrics, minor = false): HealerRaidRow {
  const own = h.cooldowns.filter((c) => !c.from);
  return {
    source: h.source,
    name: h.name,
    icon: h.icon,
    specLabel: h.specLabel,
    role: h.role,
    tankShare: h.tankShare,
    hps: h.hps,
    ...(h.carrionSwarmSec ? { hpsUncut: h.hps / healingKept(h) } : {}),
    healPerMana: h.mana?.healPerMana,
    overhealPct: h.overhealPct,
    ownOverheal: ownOverheal(h),
    manaEnd: h.mana?.end,
    potions: own.filter((c) => POTIONS.includes(c.name)).length,
    cooldowns: own.filter((c) => !POTIONS.includes(c.name)).length,
    idleSec: h.idleWhileNeeded.sec,
    saves: h.saves,
    ...(minor ? { minor } : {}),
  };
}

/** The model of every boss kill in a report, built one kill at a time (the client limits requests). */
export async function bossKillModels(client: WclReader, report: string, fights?: WclFightsResponse, wipes = false) {
  const fl = fights ?? (await client.fights(report));
  const kills = fl.fights.filter((f) => f.boss && (f.kill || (wipes && f.end_time - f.start_time >= 60_000)));
  return Promise.all(kills.map(async (f) => new FightModel(await fetchHealerFight(client, report, f.id, fl))));
}

const scoreRef = ref as HealerScoreRef;

export async function healerRaidSummary(client: WclReader, report: string): Promise<HealerRaidSummary> {
  const models = await bossKillModels(client, report, undefined, true);
  const fights = models.map((m) => {
    const metrics = [...m.healers.keys(), ...m.minorHealers.keys()].map((id) => ({ id, minor: !m.healers.has(id), h: healerMetrics(m, id) }));
    return { m, metrics, scores: metrics.map(({ h, minor }) => ({ name: h.name, minor, inputs: scoreInputs(h) })) };
  });
  // A healer's usual share: their other kills of the night (held back or not).
  const killScores = fights.filter((f) => f.m.data.fight.kill);
  return {
    report,
    bosses: fights.map(({ m, metrics, scores }) => {
      const deaths = { burst: 0, fast: 0, window: 0 };
      for (const d of healerDeaths(m)) deaths[d.kind]++;
      const others = killScores.filter((f) => f.m !== m).map((f) => f.scores);
      return {
        fight: m.data.fight.id,
        encounterId: m.data.fight.boss,
        name: m.data.fight.name,
        kill: !!m.data.fight.kill,
        durationSec: m.durationSec,
        healers: m.healers.size,
        dtpsPerHealer: m.raidDtps / Math.max(1, m.healers.size),
        deaths,
        rows: metrics.map(({ h, minor }) => raidRow(h, minor)),
        heldBack: heldBack({ encounterId: m.data.fight.boss, healers: scores }, (name) => usualShare(others, name, scoreRef), scoreRef, (name) => usualIdle(others, name)),
      };
    }),
  };
}
