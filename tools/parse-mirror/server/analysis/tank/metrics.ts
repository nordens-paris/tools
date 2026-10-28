// Tank metrics for one tank in one fight: survivability and gear, the swings they took, active
// mitigation, cooldowns, threat (WoWSims' threat values, see specs/tanks.ts) and how well they held
// the enemy they tanked. HP, deaths and tanks come from the healer FightModel.
import type { TankBossMelee, TankFightSummary, TankGear, TankMetrics, TankOpener, TankOpenerAction, TankRole } from '../../../shared/types.ts';
import { gearStats } from '../../data/db.ts';
import { CAT_FORM_MULT, type TankSpec, tankSpecFor } from '../../specs/tanks.ts';
import type { WclAura } from '../../wcl/types.ts';
import { FightModel, type LogEvent } from '../healer/model.ts';
import type { TankFightData } from './data.ts';

/** Warcraft Logs hit types. */
const HIT = { miss: 0, hit: 1, crit: 2, block: 4, glancing: 6, dodge: 7, parry: 8, immune: 10, resist: 14, crush: 15 } as const;
const LANDED = new Set<number>([HIT.hit, HIT.crit, HIT.block, HIT.glancing, HIT.crush]);
/** The tank's own attacks that didn't land. */
const AVOIDED = new Set<number>([HIT.miss, HIT.dodge, HIT.parry, HIT.resist]);
const OUTCOME: Record<number, TankOpenerAction['outcome']> = { 0: 'miss', 1: 'hit', 2: 'crit', 4: 'block', 6: 'glance', 7: 'dodge', 8: 'parry', 14: 'resist', 15: 'hit' };
/** The opener window, in seconds. */
const OPENER_SEC = 10;
const GCD_SEC = 1.5;

/** Armor's damage reduction against a level 73 boss: armor / (armor + 467.5 × 73 − 22167.5), capped at 75%. */
export const armorReduction = (armor: number) => Math.min(0.75, armor / (armor + 467.5 * 73 - 22167.5));
/** Defense rating per point of defense skill at level 70. */
const DEFENSE_RATING = 2.3654;
/** Resilience rating per 1% less chance to be crit. */
const RESILIENCE_RATING = 39.4;
/** A level 73 boss crits a level 70 tank 5.6% of the time before defense. */
const BOSS_CRIT = 5.6;

/** Potions and healthstones, by their cast name in the log, with the name to show. */
const CONSUMABLE_COOLDOWNS: Record<string, string> = {
  Healthstone: 'Healthstone',
  'Master Healthstone': 'Master Healthstone',
  'Healing Potion': 'Super Healing Potion',
  'Super Healing Potion': 'Super Healing Potion',
  'Major Healing Potion': 'Major Healing Potion',
  Ironshield: 'Ironshield Potion',
  'Ironshield Potion': 'Ironshield Potion',
  'Heroic Potion': 'Heroic Potion',
  'Nightmare Seed': 'Nightmare Seed',
};

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
  // Armor as it was when hits landed (median): combatant info has it only at the pull. Hits with
  // far more armor than at the pull are under a big temporary buff, like Gurtogg's Fel Rage (+20k
  // armor and a lot of health, not shown as a buff in the log); a tank who only took hits then
  // would read as 140k effective health, so those hits count for neither armor nor health.
  // Potions, Stoneform and forms stay well under 1.5x.
  const boosted = (e: LogEvent) => !!info?.armor && (e.armor ?? 0) > info.armor * 1.5;
  const armors = model.damage
    .filter((e) => e.targetID === id && e.resourceActor === 2 && (e.armor ?? 0) > 0 && !boosted(e))
    .map((e) => e.armor!)
    .sort((a, b) => a - b);
  const armor = armors.length ? armors[armors.length >> 1] : (info?.armor ?? 0);
  const hp = model.maxHp(id, boosted);
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
    .filter((e) => spec.cooldowns.includes(e.ability!.name) || CONSUMABLE_COOLDOWNS[e.ability!.name])
    .map((e) => ({ name: CONSUMABLE_COOLDOWNS[e.ability!.name] ?? e.ability!.name, icon: e.ability!.abilityIcon, atSec: at(e), hpPct: model.hpAt(id, e.timestamp - 1) / 100 }));
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
  // Every threat event, for the opener and the threat on the enemy they tanked.
  const threatEvents: { e: LogEvent; threat: number; cast?: boolean }[] = [];
  for (const e of data.done as LogEvent[]) {
    if (e.type !== 'damage' || !e.ability || (e.targetID !== undefined && model.players.has(e.targetID))) continue;
    damaging.add(e.ability.name);
    if (!LANDED.has(e.hitType ?? -1) && e.hitType !== undefined) {
      threatEvents.push({ e, threat: 0 });
      continue;
    }
    const rule = spec.spells[e.ability.name];
    // Righteous Fury only while it's up (the paladin's tank aura).
    const holyMult = spec.holyMult && e.ability.type === 2 && inBands(tankBands, e.timestamp) ? spec.holyMult.mult : 1;
    const threat = (((e.amount ?? 0) + (e.absorbed ?? 0)) * (rule?.mult ?? 1) * holyMult + (e.tick ? 0 : (rule?.flat ?? 0))) * unitMult(e.timestamp);
    addThreat(e.ability.name, e.ability.abilityIcon, e.timestamp, threat);
    threatEvents.push({ e, threat });
  }
  // Spells with flat threat and no damage (Sunder Armor, shouts, Faerie Fire): from their casts.
  for (const e of casts) {
    const rule = spec.spells[e.ability!.name];
    if (!rule?.flat || damaging.has(e.ability!.name)) continue;
    const threat = rule.flat * unitMult(e.timestamp);
    addThreat(e.ability!.name, e.ability!.abilityIcon, e.timestamp, threat);
    threatEvents.push({ e, threat, cast: true });
  }
  const totalThreat = [...byAbility.values()].reduce((s, r) => s + r.threat, 0);
  const onTanked = threatEvents.filter((x) => x.cast || x.e.targetID === tankedId).reduce((s, x) => s + x.threat, 0);
  const opener = openerOf(threatEvents, casts, spec, T0, mine);

  // Holding the enemy: first swing, and swings at players who aren't tanks.
  const firstSwing = enemySwings[0];
  const tankIds = new Set(model.tanks);
  const onNonTanks = enemySwings.filter((e) => !tankIds.has(e.targetID!) && e.targetID !== id).length;

  // Damage taken, near-deaths and death.
  const taken = model.damage.filter((e) => e.targetID === id).reduce((s, e) => s + (e.amount ?? 0), 0);
  const meleeTaken = mine.reduce((s, e) => s + (e.amount ?? 0) + (e.absorbed ?? 0), 0);
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
      onTanked: dur ? onTanked / dur : 0,
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
    meleeDtps: dur ? meleeTaken / dur : 0,
    opener,
    bossMelee: bossMeleeOf(mine),
    nearDeaths,
    died,
  };
}

/**
 * The tank's opener (see TankOpener). Their usual rates come from the rest of the kill: avoids among
 * all their attacks, crits per ability among attacks that landed (the overall rate for abilities
 * with few hits), and what each ability usually does when it lands, normally and as a crit.
 */
function openerOf(events: { e: LogEvent; threat: number; cast?: boolean }[], casts: LogEvent[], spec: TankSpec, T0: number, swingsOnThem: LogEvent[]): TankOpener {
  const sec = (t: number) => (t - T0) / 1000;
  const own = new Set([...spec.gcd, ...spec.offGcd, ...Object.keys(spec.spells)]);
  const castNames = new Set(casts.map((e) => e.ability!.name));
  // Their own attacks: auto attacks, their abilities and seals/judgements, not Thorns or Sanctuary.
  const isAttack = (x: { e: LogEvent; cast?: boolean }) => {
    const name = x.e.ability!.name;
    return !x.cast && !x.e.tick && (name === 'Melee' || own.has(name) || castNames.has(name) || name.startsWith('Judgement of'));
  };
  const attacksAll = events.filter(isAttack).sort((x, y) => x.e.timestamp - y.e.timestamp);
  const first = attacksAll.find((x) => x.e.timestamp >= T0);
  const start = first?.e.timestamp ?? T0;
  const end = start + OPENER_SEC * 1000;
  const engaged = (t: number) => t >= start && t <= end;

  // Usual rates over the rest of the kill.
  const stats = new Map<string, { landed: number; crits: number; landedSum: number; hitSum: number; hits: number; critSum: number }>();
  let restAvoided = 0;
  let restAttacks = 0;
  for (const x of attacksAll) {
    if (engaged(x.e.timestamp)) continue;
    restAttacks++;
    if (AVOIDED.has(x.e.hitType ?? -1)) {
      restAvoided++;
      continue;
    }
    const r = stats.get(x.e.ability!.name) ?? { landed: 0, crits: 0, landedSum: 0, hitSum: 0, hits: 0, critSum: 0 };
    r.landed++;
    r.landedSum += x.threat;
    if (x.e.hitType === HIT.crit) {
      r.crits++;
      r.critSum += x.threat;
    } else if (x.e.hitType === HIT.hit) {
      r.hits++;
      r.hitSum += x.threat;
    }
    stats.set(x.e.ability!.name, r);
  }
  const all = [...stats.values()];
  const overallCrit = all.reduce((s, r) => s + r.crits, 0) / (all.reduce((s, r) => s + r.landed, 0) || 1);
  const critRate = (name: string) => {
    const r = stats.get(name);
    return r && r.landed >= 10 ? r.crits / r.landed : overallCrit;
  };
  const critExtra = (name: string) => {
    const r = stats.get(name);
    return r?.crits && r.hits ? r.critSum / r.crits - r.hitSum / r.hits : 0;
  };
  const usual = (name: string) => {
    const r = stats.get(name);
    return r?.landed ? r.landedSum / r.landed : (spec.spells[name]?.flat ?? 0);
  };
  const avoidRate = restAttacks ? restAvoided / restAttacks : 0;

  // Everything from the pull to the end of the window, in order.
  const shownUntil = Math.max(end, T0 + OPENER_SEC * 1000);
  const gcd = new Set(spec.gcd);
  const actions: TankOpenerAction[] = [];
  for (const x of events) {
    if (x.e.timestamp < T0 || x.e.timestamp > shownUntil || x.e.tick) continue;
    const name = x.e.ability!.name;
    const attack = isAttack(x);
    actions.push({
      t: sec(x.e.timestamp),
      name,
      icon: x.e.ability!.abilityIcon,
      outcome: x.cast ? 'cast' : (OUTCOME[x.e.hitType ?? 1] ?? 'hit'),
      threat: x.threat,
      ...(attack && AVOIDED.has(x.e.hitType ?? -1) ? { lost: usual(name) } : {}),
      ...(attack ? { attack: true } : {}),
      gcd: gcd.has(name),
    });
  }
  // Casts without a threat event of their own (Holy Shield, Shield Block, Bloodrage...).
  for (const e of casts) {
    if (e.timestamp < T0 || e.timestamp > shownUntil) continue;
    const t = sec(e.timestamp);
    const name = e.ability!.name;
    if (actions.some((a) => a.name === name && Math.abs(a.t - t) < 0.6)) continue;
    actions.push({ t, name, icon: e.ability!.abilityIcon, outcome: 'cast', threat: 0, gcd: gcd.has(name) });
  }
  actions.sort((a, b) => a.t - b.t);

  // Luck over the window from their first attack.
  const attacks = attacksAll.filter((x) => engaged(x.e.timestamp));
  const avoided = attacks.filter((x) => AVOIDED.has(x.e.hitType ?? -1));
  const landed = attacks.filter((x) => !AVOIDED.has(x.e.hitType ?? -1));
  const lostThreat = avoided.reduce((s, x) => s + usual(x.e.ability!.name), 0);
  const expectedAvoided = attacks.length * avoidRate;
  // An avoid is worth what the ones that happened were worth, or an average attack if none did.
  const perAvoid = avoided.length ? lostThreat / avoided.length : attacks.reduce((s, x) => s + usual(x.e.ability!.name), 0) / (attacks.length || 1);
  const avoidLuckThreat = (avoided.length - expectedAvoided) * perAvoid;
  const crits = landed.filter((x) => x.e.hitType === HIT.crit).length;
  const expectedCrits = landed.reduce((s, x) => s + critRate(x.e.ability!.name), 0);
  const critLuckThreat = landed.reduce((s, x) => s + (critRate(x.e.ability!.name) - (x.e.hitType === HIT.crit ? 1 : 0)) * critExtra(x.e.ability!.name), 0);

  // Abilities used, from their casts; damage stands in only for abilities with no cast events in
  // the log (on-swing seal and Thorns damage are not uses). Global cooldowns are the GCD ones.
  const uses = [
    ...casts.filter((e) => engaged(e.timestamp)).map((e) => ({ name: e.ability!.name, t: sec(e.timestamp) })),
    ...attacks.filter((x) => x.e.ability!.name !== 'Melee' && !castNames.has(x.e.ability!.name) && spec.spells[x.e.ability!.name]).map((x) => ({ name: x.e.ability!.name, t: sec(x.e.timestamp) })),
  ];
  const offGcd = new Set(spec.offGcd);
  const abilities: Record<string, number> = {};
  for (const u of uses) if (own.has(u.name)) abilities[u.name] = (abilities[u.name] ?? 0) + 1;
  const firstOwn = [...casts.filter((e) => e.timestamp >= T0 && (gcd.has(e.ability!.name) || offGcd.has(e.ability!.name))).map((e) => e.timestamp), ...attacksAll.filter((x) => x.e.ability!.name !== 'Melee').map((x) => x.e.timestamp)].filter((t) => t >= T0);
  const sum = (from: number, to: number) => events.filter((x) => x.e.timestamp >= from && x.e.timestamp <= to).reduce((s, x) => s + x.threat, 0);
  return {
    windowSec: OPENER_SEC,
    pullThreat: sum(T0, T0 + OPENER_SEC * 1000),
    ...(first ? { startSec: sec(start) } : {}),
    ...(swingsOnThem.length ? { bossSwingSec: Math.max(0, sec(swingsOnThem[0].timestamp)) } : {}),
    ...(firstOwn.length ? { firstActionSec: sec(Math.min(...firstOwn)) } : {}),
    threat: sum(start, end),
    attacks: attacks.length,
    avoided: avoided.length,
    expectedAvoided,
    lostThreat,
    crits,
    landed: landed.length,
    expectedCrits,
    avoidLuckThreat,
    critLuckThreat,
    luckThreat: avoidLuckThreat + critLuckThreat,
    gcds: uses.filter((u) => gcd.has(u.name)).length,
    possibleGcds: Math.floor(OPENER_SEC / GCD_SEC) + 1,
    abilities,
    actions,
  };
}

/**
 * How the enemy swung at them: the median time between swings while they tanked it (gaps over 4 s
 * are breaks), so parry-hasted swings don't count (the sim adds parry haste itself). A boss dual
 * wields when a quarter or more of the gaps are under 0.6 s (the off-hand right after the main
 * hand); then each weapon's time is the median gap to the swing after next, and the overall gap
 * half of that. Plus its average hit before armor and block.
 */
export function bossMeleeOf(mine: LogEvent[]): TankBossMelee | undefined {
  const at = (i: number) => mine[i].timestamp / 1000;
  const gaps: number[] = [];
  const pairs: number[] = [];
  for (let i = 1; i < mine.length; i++) {
    if (at(i) - at(i - 1) < 4) gaps.push(at(i) - at(i - 1));
    if (i >= 2 && at(i) - at(i - 2) < 6) pairs.push(at(i) - at(i - 2));
  }
  const hits = mine.filter((e) => (e.hitType === HIT.hit || e.hitType === HIT.block) && (e.unmitigatedAmount ?? 0) > 0).map((e) => e.unmitigatedAmount!);
  if (gaps.length < 10 || hits.length < 5) return undefined;
  const mid = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  const dualWield = gaps.filter((g) => g < 0.6).length >= gaps.length / 4;
  return {
    swingGapSec: dualWield ? mid(pairs) / 2 : mid(gaps),
    dualWield,
    hitBeforeArmor: hits.reduce((s, x) => s + x, 0) / hits.length,
    swings: mine.length,
  };
}

export function tankFightSummary(model: FightModel, tanks: TankMetrics[]): TankFightSummary {
  return { fight: model.data.fight.id, encounter: { id: model.data.fight.boss, name: model.data.fight.name }, durationSec: model.durationSec, tanks };
}
