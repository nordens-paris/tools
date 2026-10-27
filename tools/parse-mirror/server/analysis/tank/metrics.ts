// Tank metrics for one tank in one fight: survivability and gear, the swings they took, active
// mitigation, cooldowns, threat (WoWSims' threat values, see specs/tanks.ts) and how well they held
// the enemy they tanked. HP, deaths and tanks come from the healer FightModel.
import type { TankFightSummary, TankGear, TankMetrics, TankRole } from '../../../shared/types.ts';
import { gearStats } from '../../data/db.ts';
import { CAT_FORM_MULT, type TankSpec, tankSpecFor } from '../../specs/tanks.ts';
import type { WclAura } from '../../wcl/types.ts';
import { FightModel, type LogEvent } from '../healer/model.ts';
import type { TankFightData } from './data.ts';

/** Warcraft Logs hit types. */
const HIT = { miss: 0, hit: 1, crit: 2, block: 4, glancing: 6, dodge: 7, parry: 8, immune: 10, resist: 14, crush: 15 } as const;
const LANDED = new Set<number>([HIT.hit, HIT.crit, HIT.block, HIT.glancing, HIT.crush]);

/** Armor's damage reduction against a level 73 boss: armor / (armor + 467.5 × 73 − 22167.5). */
export const armorReduction = (armor: number) => armor / (armor + 467.5 * 73 - 22167.5);
/** Defense rating per point of defense skill at level 70. */
const DEFENSE_RATING = 2.3654;
/** Resilience rating per 1% less chance to be crit. */
const RESILIENCE_RATING = 39.4;
/** A level 73 boss crits a level 70 tank 5.6% of the time before defense. */
const BOSS_CRIT = 5.6;

const CONSUMABLE_COOLDOWNS = ['Healthstone', 'Master Healthstone', 'Super Healing Potion', 'Major Healing Potion', 'Ironshield Potion', 'Heroic Potion', 'Nightmare Seed'];

const inBands = (bands: { startTime: number; endTime: number }[] | undefined, t: number) => !!bands?.some((b) => t >= b.startTime && t <= b.endTime);
const uptimeOf = (aura: WclAura | undefined, total: number) => (aura && total ? aura.totalUptime / total : 0);

/** The tank spec of a player in this fight, if they tanked. */
export function tankSpecIn(data: TankFightData): TankSpec | undefined {
  const total = data.buffs.totalTime;
  const icon = data.raid.meleeTaken.find((e) => e.id === data.tank.id)?.icon ?? data.tank.icon;
  return tankSpecFor(icon, (name) => uptimeOf(data.buffs.auras.find((a) => a.name === name), total));
}

/** Defense, crit reduction and stat lean from the gear in combatant info. */
function gearOf(data: TankFightData, spec: TankSpec): TankGear | undefined {
  const info = data.raid.combatants.find((c) => c.sourceID === data.tank.id);
  if (!info?.gear?.length) return undefined;
  const st = gearStats(info.gear);
  // Talents: Anticipation (+20 defense) for warriors and paladins, Survival of the Fittest (3% less
  // to be crit) for druids. Logs only have points per tree, so a tank is assumed to have them.
  const talentDefense = spec.className === 'Druid' ? 0 : 20;
  const defense = 350 + (st.def ?? 0) / DEFENSE_RATING + talentDefense;
  // Resilience rating (combatant info's resilienceCritTaken) counts too: bears often use it.
  const resilience = Number((info as unknown as { resilienceCritTaken?: number }).resilienceCritTaken) || 0;
  const critReduction = (defense - 350) * 0.04 + (spec.className === 'Druid' ? 3 : 0) + resilience / RESILIENCE_RATING;
  // Agility is armor and dodge for a bear as much as threat: half each.
  const agiMitigation = spec.className === 'Druid' ? (st.agi ?? 0) / 2 : 0;
  const mitigation = (st.sta ?? 0) + (st.def ?? 0) + (st.dodge ?? 0) + (st.parry ?? 0) + (st.block ?? 0) + (st.blockValue ?? 0) / 2 + (st.bonusArmor ?? 0) / 10 + agiMitigation;
  const threat = (st.str ?? 0) + (st.agi ?? 0) - agiMitigation + (st.hit ?? 0) + (st.exp ?? 0) + (st.crit ?? 0) + (st.ap ?? 0) / 2 + (st.feralAp ?? 0) / 2 + (st.spell ?? 0) + (st.holy ?? 0);
  return {
    defense: Math.round(defense),
    critReduction,
    critImmune: critReduction >= BOSS_CRIT - 0.01,
    mitigationLean: mitigation + threat ? mitigation / (mitigation + threat) : 0,
    stats: st,
  };
}

export function tankMetrics(data: TankFightData, model = new FightModel(data.raid), spec = tankSpecIn(data)): TankMetrics {
  if (!spec) throw new Error(`${data.tank.name} isn't tanking on this kill.`);
  const id = data.tank.id;
  const { T0, T1, durationSec: dur } = model;
  const totalMs = data.buffs.totalTime || T1 - T0;
  const aura = (name: string) => data.buffs.auras.find((a) => a.name === name);

  // The enemy they tanked: whoever swung at them most.
  const swingsByEnemy = new Map<number, number>();
  const enemyIds = new Set(data.enemies.map((e) => e.id));
  for (const e of model.damage) {
    if (e.targetID === id && e.ability?.name === 'Melee' && e.sourceID !== undefined && enemyIds.has(e.sourceID)) {
      swingsByEnemy.set(e.sourceID, (swingsByEnemy.get(e.sourceID) ?? 0) + 1);
    }
  }
  const tankedId = [...swingsByEnemy].sort((a, b) => b[1] - a[1])[0]?.[0];
  const tankedEnemy = data.enemies.find((e) => e.id === tankedId);
  const enemySwings = model.damage.filter((e) => e.sourceID === tankedId && e.ability?.name === 'Melee' && e.targetID !== undefined && model.players.has(e.targetID));
  const mine = enemySwings.filter((e) => e.targetID === id);
  // A peer's fight has only their own swings: their share of the boss comes from the melee table.
  const swingShare = data.lite ? data.lite.swingShare : enemySwings.length ? mine.length / enemySwings.length : 0;
  const role: TankRole = !tankedEnemy?.boss ? 'adds' : swingShare >= 0.4 ? 'main' : 'off';

  // Swing outcomes.
  const count = (t: number) => mine.filter((e) => e.hitType === t).length;
  const landed = mine.filter((e) => LANDED.has(e.hitType ?? -1));
  const n = mine.length || 1;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const swings = {
    total: mine.length,
    hit: count(HIT.hit),
    crit: count(HIT.crit),
    crush: count(HIT.crush),
    block: count(HIT.block),
    dodge: count(HIT.dodge),
    parry: count(HIT.parry),
    miss: count(HIT.miss),
    avoided: (count(HIT.miss) + count(HIT.dodge) + count(HIT.parry)) / n,
    damagePerHit: avg(landed.map((e) => (e.amount ?? 0) + (e.absorbed ?? 0))),
    unmitigatedPerHit: avg(landed.filter((e) => (e.unmitigatedAmount ?? 0) > 0).map((e) => e.unmitigatedAmount!)),
  };

  // Survivability.
  const info = data.raid.combatants.find((c) => c.sourceID === id) as unknown as { armor?: number; stamina?: number } | undefined;
  // Armor as it was when hits landed (median): combatant info has it only at the pull.
  const armors = model.damage
    .filter((e) => e.targetID === id && e.resourceActor === 2 && (e.armor ?? 0) > 0)
    .map((e) => e.armor!)
    .sort((a, b) => a - b);
  const armor = armors.length ? armors[armors.length >> 1] : (info?.armor ?? 0);
  const hp = model.maxHp(id);
  const dr = armorReduction(armor);

  // Active mitigation: uptime, and how many of the swings (and crushes) landed while it was up.
  const mitigation = spec.mitigation
    .map((name) => {
      const a = aura(name);
      if (!a) return undefined;
      const covered = mine.filter((e) => inBands(a.bands, e.timestamp));
      const crushes = mine.filter((e) => e.hitType === HIT.crush);
      return {
        name,
        icon: a.abilityIcon,
        uptime: uptimeOf(a, totalMs),
        swingsCovered: mine.length ? covered.length / mine.length : 0,
        crushesCovered: crushes.filter((e) => inBands(a.bands, e.timestamp)).length,
        crushesUncovered: crushes.filter((e) => !inBands(a.bands, e.timestamp)).length,
      };
    })
    .filter((m): m is NonNullable<typeof m> => !!m);

  // Debuffs they kept on the enemy, by the spec's list.
  const debTotal = data.bossDebuffs.totalTime || totalMs;
  const bossDebuffs = spec.bossDebuffs
    .map((name) => data.bossDebuffs.auras.find((a) => a.name === name))
    .filter((a): a is WclAura => !!a)
    .map((a) => ({ name: a.name, icon: a.abilityIcon, uptime: uptimeOf(a, debTotal) }));

  // Casts: cooldowns, threat drops, taunts.
  const casts = model.casts.filter((e) => e.sourceID === id && e.type === 'cast' && e.ability);
  const at = (e: LogEvent) => Math.round((e.timestamp - T0) / 1000);
  const cooldowns = casts
    .filter((e) => spec.cooldowns.includes(e.ability!.name) || CONSUMABLE_COOLDOWNS.includes(e.ability!.name))
    .map((e) => ({ name: e.ability!.name, icon: e.ability!.abilityIcon, atSec: at(e), hpPct: model.hpAt(id, e.timestamp - 1) / 100 }));
  const threatDrops = casts
    .filter((e) => spec.threatDrops.includes(e.ability!.name) && (e.targetID === undefined || e.targetID === id || e.targetID === -1))
    .map((e) => ({ name: e.ability!.name, atSec: at(e) }));
  const taunts = casts.filter((e) => spec.taunts.includes(e.ability!.name)).map((e) => ({ name: e.ability!.name, atSec: at(e), target: data.enemies.find((x) => x.id === e.targetID)?.name }));

  // Threat: WoWSims' formula, with the tanking aura's bands for when the multiplier applied.
  const tankBands = spec.tankAura.name.flatMap((nm) => aura(nm)?.bands ?? []);
  const catBands = aura('Cat Form')?.bands;
  const unitMult = (t: number) => (inBands(tankBands, t) ? spec.tankAura.mult * (spec.talent?.mult ?? 1) : catBands && inBands(catBands, t) ? CAT_FORM_MULT : 1);
  const byAbility = new Map<string, { threat: number; icon?: string }>();
  const windows = [5, 10, 20];
  const early = [0, 0, 0];
  const addThreat = (name: string, icon: string | undefined, t: number, threat: number) => {
    const row = byAbility.get(name) ?? { threat: 0, icon };
    row.threat += threat;
    byAbility.set(name, row);
    windows.forEach((w, i) => {
      if (t - T0 <= w * 1000) early[i] += threat;
    });
  };
  const damaging = new Set<string>();
  for (const e of data.done as LogEvent[]) {
    if (e.type !== 'damage' || !e.ability || (e.targetID !== undefined && model.players.has(e.targetID))) continue;
    damaging.add(e.ability.name);
    if (!LANDED.has(e.hitType ?? -1) && e.hitType !== undefined) continue;
    const rule = spec.spells[e.ability.name];
    // Righteous Fury only while it's up (the paladin's tank aura).
    const holyMult = spec.holyMult && e.ability.type === 2 && inBands(tankBands, e.timestamp) ? spec.holyMult.mult : 1;
    const threat = (((e.amount ?? 0) + (e.absorbed ?? 0)) * (rule?.mult ?? 1) * holyMult + (e.tick ? 0 : (rule?.flat ?? 0))) * unitMult(e.timestamp);
    addThreat(e.ability.name, e.ability.abilityIcon, e.timestamp, threat);
  }
  // Spells with flat threat and no damage (Sunder Armor, shouts, Faerie Fire): from their casts.
  for (const e of casts) {
    const rule = spec.spells[e.ability!.name];
    if (!rule?.flat || damaging.has(e.ability!.name)) continue;
    addThreat(e.ability!.name, e.ability!.abilityIcon, e.timestamp, rule.flat * unitMult(e.timestamp));
  }
  const totalThreat = [...byAbility.values()].reduce((s, r) => s + r.threat, 0);

  // Holding the enemy: first swing, and swings at players who aren't tanks.
  const firstSwing = enemySwings[0];
  const tankIds = new Set(model.tanks);
  const onNonTanks = enemySwings.filter((e) => !tankIds.has(e.targetID!) && e.targetID !== id).length;

  // Damage taken, near-deaths and death.
  const taken = model.damage.filter((e) => e.targetID === id).reduce((s, e) => s + (e.amount ?? 0), 0);
  const died = model.deaths().some((d) => d.id === id);
  const nearDeaths = model.drops(20).filter((d) => d.id === id && model.alive(id, d.t + 5000)).length;

  return {
    source: id,
    name: data.tank.name,
    icon: spec.icons[0],
    specLabel: spec.label,
    className: spec.className,
    role,
    tanked: tankedEnemy?.name ?? '–',
    swingShare,
    survivability: {
      armor,
      armorReduction: dr,
      maxHp: hp.value,
      maxHpFrom: hp.from,
      effectiveHealth: hp.value / (1 - dr),
      stamina: info?.stamina ?? 0,
    },
    gear: gearOf(data, spec),
    swings,
    mitigation,
    bossDebuffs,
    tankAuraUptime: Math.min(1, spec.tankAura.name.reduce((s, nm) => s + uptimeOf(aura(nm), totalMs), 0)),
    catFormUptime: spec.className === 'Druid' ? uptimeOf(aura('Cat Form'), totalMs) : undefined,
    cooldowns,
    threatDrops,
    taunts,
    threat: {
      tps: dur ? totalThreat / dur : 0,
      opener: windows.map((w, i) => early[i] / Math.min(w, dur)) as [number, number, number],
      byAbility: [...byAbility]
        .map(([name, r]) => ({ name, icon: r.icon, share: totalThreat ? r.threat / totalThreat : 0 }))
        .sort((a, b) => b.share - a.share)
        .slice(0, 10),
    },
    holding: data.lite
      ? undefined
      : {
          firstSwingSec: firstSwing ? (firstSwing.timestamp - T0) / 1000 : undefined,
          firstSwingOnYou: firstSwing?.targetID === id,
          swingsOnNonTanks: onNonTanks,
          nonTankShare: enemySwings.length ? onNonTanks / enemySwings.length : 0,
        },
    dtps: dur ? taken / dur : 0,
    nearDeaths,
    died,
  };
}

export function tankFightSummary(model: FightModel, tanks: TankMetrics[]): TankFightSummary {
  return { fight: model.data.fight.id, encounter: { id: model.data.fight.boss, name: model.data.fight.name }, durationSec: model.durationSec, tanks };
}
