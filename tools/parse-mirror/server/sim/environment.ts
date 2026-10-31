// Translates the buffs a player had and the debuffs on the boss (from the log)
// into WoWSims raid/party/individual buffs and debuffs.
import type { AuraUptime } from '../../shared/types.ts';

export interface SimEnvironment {
  raidBuffs: Record<string, unknown>;
  partyBuffs: Record<string, unknown>;
  individualBuffs: Record<string, unknown>;
  debuffs: Record<string, unknown>;
  /** Stats from buffs WoWSims doesn't model, averaged by uptime; keyed by WoWSims stat index. */
  bonusStats: Record<number, number>;
  /** Human readable list of what was detected, for the UI. */
  detected: string[];
}

// WoWSims stat indexes (proto Stat enum).
export const STAT = { spellDamage: 5, spellCritRating: 13, spirit: 16, attackPower: 17 } as const;

// Buffs WoWSims has no option for (mostly Anniversary additions and zone buffs), by spell ID.
// Their stats are added scaled by uptime: a +209 spell damage buff up 25% of the fight adds ~52.
// That ignores burst alignment (these are usually popped with Bloodlust), so it's slightly low.
const STAT_BUFFS: Record<number, { name: string; stats: Partial<Record<keyof typeof STAT, number>>; consumable?: boolean }> = {
  31732: { name: 'Rallying Cry', stats: { attackPower: 165 } }, // Hyjal NPC buff
  // Not trinket buffs like Dark Iron Pipeweed (Dark Iron Smoking Pipe), Dire Drunkard (Empty Mug of
  // Direbrew) or Hopped Up (Direbrew
  // Hops): WoWSims has those trinkets and sims them from the gear, so adding them would count twice.
  29308: { name: 'Power Surge', stats: { spellDamage: 25 }, consumable: true }, // Power Core
  43722: { name: 'Enlightened', stats: { spellCritRating: 20, spirit: 20 }, consumable: true },
};

/**
 * Applies another player's consumable-driven environment (drums, stat-buff consumables like
 * Power Core) on top of an environment, for the "top 10 consumes" scenario.
 */
export function withConsumablesFrom(
  env: SimEnvironment,
  others: { buffs: AuraUptime[]; drums?: string; durationSec: number }[],
  durationSec: number,
): SimEnvironment {
  const out = structuredClone(env);
  if (!others.length) return out;
  const half = others.length / 2;
  const drums = others.map((o) => o.drums).filter(Boolean) as string[];
  if (!out.partyBuffs.drums && drums.length >= half) {
    out.partyBuffs.drums = drums.sort((a, b) => drums.filter((d) => d === b).length - drums.filter((d) => d === a).length)[0];
    out.detected.push('Drums (top 10)');
  }
  for (const [idStr, sb] of Object.entries(STAT_BUFFS)) {
    if (!sb.consumable) continue;
    const id = Number(idStr);
    // Seconds of buff per fight, rescaled to this fight's length (a 20 s buff covers less of a long kill).
    const seconds = others
      .map((o) => ({ b: o.buffs.find((b) => b.id === id), d: o.durationSec }))
      .filter((x) => x.b && x.b.uptimePct > 0)
      .map((x) => (x.b!.uptimePct / 100) * x.d);
    if (seconds.length < half || out.detected.some((d) => d.startsWith(sb.name))) continue;
    const uptime = Math.min(100, ((seconds.reduce((s, v) => s + v, 0) / seconds.length) / durationSec) * 100);
    for (const [stat, value] of Object.entries(sb.stats)) {
      const idx = STAT[stat as keyof typeof STAT];
      out.bonusStats[idx] = (out.bonusStats[idx] ?? 0) + (value * uptime) / 100;
    }
    out.detected.push(`${sb.name} (top 10, ${Math.round(uptime)}%)`);
  }
  return out;
}
export const STAT_BUFF_IDS = new Set(Object.keys(STAT_BUFFS).map(Number));

const IMPROVED = 'TristateEffectImproved';
const REGULAR = 'TristateEffectRegular';

type Rule = { names: string[]; minUptime: number; field: string; value: unknown; label: string };

// Buffs that are up most of the fight count from 50% uptime; short raid cooldowns count if present at all.
const RAID: Rule[] = [
  { names: ['Arcane Brilliance', 'Arcane Intellect'], minUptime: 50, field: 'arcaneBrilliance', value: true, label: 'Arcane Intellect' },
  { names: ['Prayer of Fortitude', 'Power Word: Fortitude'], minUptime: 50, field: 'powerWordFortitude', value: IMPROVED, label: 'Fortitude' },
  { names: ['Gift of the Wild', 'Mark of the Wild'], minUptime: 50, field: 'giftOfTheWild', value: IMPROVED, label: 'Mark of the Wild' },
  { names: ['Prayer of Spirit', 'Divine Spirit'], minUptime: 50, field: 'divineSpirit', value: IMPROVED, label: 'Divine Spirit' },
  { names: ['Prayer of Shadow Protection', 'Shadow Protection'], minUptime: 50, field: 'shadowProtection', value: true, label: 'Shadow Protection' },
  { names: ['Bloodlust', 'Heroism'], minUptime: 0, field: 'bloodlust', value: true, label: 'Bloodlust' },
];
const PARTY: Rule[] = [
  { names: ['Leader of the Pack'], minUptime: 50, field: 'leaderOfThePack', value: REGULAR, label: 'Leader of the Pack' },
  { names: ['Sanctity Aura'], minUptime: 50, field: 'sanctityAura', value: IMPROVED, label: 'Sanctity Aura' },
  { names: ['Trueshot Aura'], minUptime: 50, field: 'trueshotAura', value: true, label: 'Trueshot Aura' },
  { names: ['Ferocious Inspiration'], minUptime: 30, field: 'ferociousInspiration', value: 1, label: 'Ferocious Inspiration' },
  { names: ['Battle Shout'], minUptime: 50, field: 'battleShout', value: IMPROVED, label: 'Battle Shout' },
  { names: ['Commanding Shout'], minUptime: 50, field: 'commandingShout', value: IMPROVED, label: 'Commanding Shout' },
  { names: ['Grace of Air'], minUptime: 30, field: 'graceOfAirTotem', value: IMPROVED, label: 'Grace of Air Totem' },
  { names: ['Strength of Earth'], minUptime: 30, field: 'strengthOfEarthTotem', value: IMPROVED, label: 'Strength of Earth Totem' },
  { names: ['Windfury Totem'], minUptime: 0, field: 'windfuryTotem', value: IMPROVED, label: 'Windfury Totem' },
  { names: ['Braided Eternium Chain'], minUptime: 50, field: 'braidedEterniumChain', value: true, label: 'Braided Eternium Chain' },
  { names: ['Moonkin Aura'], minUptime: 50, field: 'moonkinAura', value: REGULAR, label: 'Moonkin Aura' },
  { names: ['Totem of Wrath'], minUptime: 30, field: 'totemOfWrath', value: 1, label: 'Totem of Wrath' },
  { names: ['Wrath of Air Totem'], minUptime: 30, field: 'wrathOfAirTotem', value: REGULAR, label: 'Wrath of Air Totem' },
  { names: ['Mana Spring'], minUptime: 30, field: 'manaSpringTotem', value: REGULAR, label: 'Mana Spring Totem' },
  { names: ['Chain of the Twilight Owl'], minUptime: 50, field: 'chainOfTheTwilightOwl', value: true, label: 'Chain of the Twilight Owl' },
  { names: ['Eye of the Night'], minUptime: 50, field: 'eyeOfTheNight', value: true, label: 'Eye of the Night' },
  { names: ['Jade Pendant of Blasting'], minUptime: 50, field: 'jadePendantOfBlasting', value: true, label: 'Jade Pendant of Blasting' },
  { names: ['Heroic Presence'], minUptime: 50, field: 'draeneiRacialMelee', value: true, label: 'Heroic Presence' },
];
const INDIVIDUAL: Rule[] = [
  { names: ['Greater Blessing of Kings', 'Blessing of Kings'], minUptime: 50, field: 'blessingOfKings', value: true, label: 'Blessing of Kings' },
  { names: ['Greater Blessing of Might', 'Blessing of Might'], minUptime: 50, field: 'blessingOfMight', value: IMPROVED, label: 'Blessing of Might' },
  { names: ['Greater Blessing of Salvation', 'Blessing of Salvation'], minUptime: 50, field: 'blessingOfSalvation', value: true, label: 'Blessing of Salvation' },
  { names: ['Greater Blessing of Wisdom', 'Blessing of Wisdom'], minUptime: 50, field: 'blessingOfWisdom', value: IMPROVED, label: 'Blessing of Wisdom' },
  { names: ['Unleashed Rage'], minUptime: 50, field: 'unleashedRage', value: true, label: 'Unleashed Rage' },
];
const DEBUFFS: Rule[] = [
  { names: ['Sunder Armor'], minUptime: 40, field: 'sunderArmor', value: true, label: 'Sunder Armor' },
  { names: ['Expose Armor'], minUptime: 40, field: 'exposeArmor', value: IMPROVED, label: 'Expose Armor' },
  { names: ['Faerie Fire', 'Faerie Fire (Feral)'], minUptime: 40, field: 'faerieFire', value: IMPROVED, label: 'Faerie Fire' },
  { names: ['Curse of Recklessness'], minUptime: 40, field: 'curseOfRecklessness', value: true, label: 'Curse of Recklessness' },
  { names: ['Blood Frenzy'], minUptime: 40, field: 'bloodFrenzy', value: true, label: 'Blood Frenzy' },
  // Blood Frenzy doesn't always show up as its own debuff; an Arms warrior keeping up
  // Mortal Strike almost always has it talented.
  { names: ['Mortal Strike'], minUptime: 40, field: 'bloodFrenzy', value: true, label: 'Blood Frenzy (from Mortal Strike)' },
  { names: ["Hunter's Mark"], minUptime: 40, field: 'huntersMark', value: IMPROVED, label: "Hunter's Mark" },
  { names: ['Judgement of the Crusader'], minUptime: 40, field: 'improvedSealOfTheCrusader', value: IMPROVED, label: 'Judgement of the Crusader' },
  { names: ['Judgement of Wisdom'], minUptime: 40, field: 'judgementOfWisdom', value: true, label: 'Judgement of Wisdom' },
  { names: ['Judgement of Light'], minUptime: 40, field: 'judgementOfLight', value: true, label: 'Judgement of Light' },
  { names: ['Misery'], minUptime: 40, field: 'misery', value: true, label: 'Misery' },
  { names: ['Curse of the Elements'], minUptime: 40, field: 'curseOfElements', value: IMPROVED, label: 'Curse of the Elements' },
  { names: ['Mangle (Cat)', 'Mangle (Bear)'], minUptime: 40, field: 'mangle', value: true, label: 'Mangle' },
  // "Critical Mass" is what WoWSims' spell list calls Improved Scorch's debuff (22959).
  { names: ['Improved Scorch', 'Fire Vulnerability', 'Critical Mass'], minUptime: 40, field: 'improvedScorch', value: true, label: 'Improved Scorch' },
  { names: ["Winter's Chill"], minUptime: 40, field: 'wintersChill', value: true, label: "Winter's Chill" },
  { names: ['Gift of Arthas'], minUptime: 40, field: 'giftOfArthas', value: true, label: 'Gift of Arthas' },
];

function apply(rules: Rule[], auras: AuraUptime[], target: Record<string, unknown>, detected: string[]) {
  for (const rule of rules) {
    if (target[rule.field] !== undefined) continue;
    const aura = auras.find((a) => rule.names.includes(a.name) && a.uptimePct >= rule.minUptime && (a.uptimePct > 0 || a.uses > 0));
    if (aura) {
      target[rule.field] = rule.value;
      detected.push(aura.assumed ? `${rule.label} (party shaman, assumed)` : rule.label);
    }
  }
}

/** Every aura name this module turns into a sim setting (for the audit script). */
export const HANDLED_AURA_NAMES = new Set([
  ...[...RAID, ...PARTY, ...INDIVIDUAL, ...DEBUFFS].flatMap((r) => r.names),
  'Windfury Attack',
  'Shadow Vulnerability',
  'Shadow Weaving',
  ...Object.values(STAT_BUFFS).map((b) => b.name),
  'Power Infusion',
  'Expose Weakness',
  'Innervate',
  'Mana Tide',
]);

// "Shadow Vulnerability" is the name of two debuffs: Shadow Weaving (priest) and Improved Shadow
// Bolt (warlock, one ID per rank), so these go by spell ID.
const SHADOW_WEAVING_ID = 15258;
export const IMPROVED_SHADOW_BOLT_IDS = [17794, 17797, 17798, 17799, 17800];

export function buildEnvironment(
  buffs: AuraUptime[],
  bossDebuffs: AuraUptime[],
  drums?: string,
  // consumableBuffs: whose consumable stat buffs (Power Core...) to use; defaults to `buffs`.
  // isbHitPct: share of the player's shadow hits that had Improved Shadow Bolt, if measured.
  // shadowPriestDps: a shadow priest in the party (Vampiric Touch mana).
  opts: { consumableBuffs?: AuraUptime[]; isbHitPct?: number; shadowPriestDps?: number } = {},
): SimEnvironment {
  const env: SimEnvironment = { raidBuffs: {}, partyBuffs: {}, individualBuffs: {}, debuffs: {}, bonusStats: {}, detected: [] };
  apply(RAID, buffs, env.raidBuffs, env.detected);
  apply(PARTY, buffs, env.partyBuffs, env.detected);
  // Windfury Totem has no buff of its own; its procs show as "Windfury Attack". A single proc can
  // come from a shaman's group briefly, so require a few.
  const wf = buffs.find((b) => b.name === 'Windfury Attack');
  if (!env.partyBuffs.windfuryTotem && wf && wf.uses >= 3) {
    env.partyBuffs.windfuryTotem = IMPROVED;
    env.detected.push('Windfury Totem');
  }
  for (const b of [...buffs, ...(opts.consumableBuffs ?? [])]) {
    const sb = STAT_BUFFS[b.id];
    if (!sb || b.uptimePct <= 0) continue;
    // Consumables follow the player; raid/zone buffs follow the raid.
    const fromConsumableList = opts.consumableBuffs?.includes(b) ?? false;
    if (opts.consumableBuffs && sb.consumable !== fromConsumableList) continue;
    for (const [stat, value] of Object.entries(sb.stats)) {
      const idx = STAT[stat as keyof typeof STAT];
      env.bonusStats[idx] = (env.bonusStats[idx] ?? 0) + (value * b.uptimePct) / 100;
    }
    env.detected.push(`${sb.name} (${Math.round(b.uptimePct)}%)`);
  }
  apply(INDIVIDUAL, buffs, env.individualBuffs, env.detected);
  apply(DEBUFFS, bossDebuffs, env.debuffs, env.detected);
  // WoWSims puts the raid's Expose Armor up at 10 s; raids sunder until it lands (5 Sunders by
  // ~6 s in the logs), and Sunder loses its uptime to it. Both in the sim: Sunder ramps up as in
  // the game and Expose Armor, the stronger, replaces it at 10 s.
  const sunder = bossDebuffs.find((a) => a.name === 'Sunder Armor');
  if (env.debuffs.exposeArmor && !env.debuffs.sunderArmor && sunder && (sunder.uptimePct > 0 || sunder.uses > 0)) {
    env.debuffs.sunderArmor = true;
    env.detected.push('Sunder Armor (until Expose Armor)');
  }
  if (drums) {
    env.partyBuffs.drums = drums;
    env.detected.push('Drums');
  }
  const weaving = bossDebuffs.find((a) => a.id === SHADOW_WEAVING_ID);
  if (weaving && weaving.uptimePct >= 40) {
    env.debuffs.shadowWeaving = true;
    env.detected.push('Shadow Weaving');
  }
  // ISB from all warlocks in the raid. In WoWSims the raid's fixed-uptime ISB and a player's own
  // ISB procs are the same aura, so they merge (up if either is) like the real shared debuff.
  // WoWSims applies the fixed uptime as a chance per hit, so the share of the player's own hits
  // that had it is the better number when we have it.
  const isb = bossDebuffs.find((a) => IMPROVED_SHADOW_BOLT_IDS.includes(a.id));
  const isbPct = opts.isbHitPct ?? isb?.uptimePct;
  if (isb && isbPct !== undefined && isbPct > 10) {
    env.debuffs.isbUptime = Math.round(isbPct) / 100;
    env.detected.push(`Improved Shadow Bolt (${Math.round(isbPct)}%${opts.isbHitPct !== undefined ? ' of your hits' : ''})`);
  }
  // Power Infusion from a priest.
  const pi = buffs.find((b) => b.name === 'Power Infusion');
  if (pi && pi.uses > 0) {
    env.individualBuffs.powerInfusions = pi.uses;
    env.detected.push(`Power Infusion ×${pi.uses}`);
  }
  // Mana from others: Innervate, a shaman's Mana Tide Totem, a party shadow priest's Vampiric Touch.
  const innervate = buffs.find((b) => b.name === 'Innervate');
  if (innervate && innervate.uses > 0) {
    env.individualBuffs.innervates = innervate.uses;
    env.detected.push(`Innervate ×${innervate.uses}`);
  }
  const tide = buffs.find((b) => b.name === 'Mana Tide' || b.name === 'Mana Tide Totem');
  if (tide && tide.uses > 0) {
    env.partyBuffs.manaTideTotems = tide.uses;
    env.detected.push(`Mana Tide Totem ×${tide.uses}`);
  }
  if (opts.shadowPriestDps) {
    env.individualBuffs.shadowPriestDps = Math.round(opts.shadowPriestDps);
    env.detected.push(`Vampiric Touch (party shadow priest, ${Math.round(opts.shadowPriestDps)} DPS)`);
  }
  const ew = bossDebuffs.find((a) => a.name === 'Expose Weakness');
  if (ew && ew.uptimePct > 10) {
    // Agility of the hunter applying it isn't in the log; use WoWSims' phase 3 default.
    env.debuffs.exposeWeaknessUptime = Math.round(ew.uptimePct) / 100;
    env.debuffs.exposeWeaknessHunterAgility = 1210;
    env.detected.push(`Expose Weakness (${Math.round(ew.uptimePct)}%)`);
  }
  return env;
}

const LABELS: Record<string, string> = {
  ...Object.fromEntries([...RAID, ...PARTY, ...INDIVIDUAL, ...DEBUFFS].reverse().map((r) => [r.field, r.label])),
  windfuryTotem: 'Windfury Totem',
  shadowWeaving: 'Shadow Weaving',
  powerInfusions: 'Power Infusion',
  innervates: 'Innervate',
  manaTideTotems: 'Mana Tide Totem',
  shadowPriestDps: 'Vampiric Touch (party shadow priest)',
};
const UPTIME_FIELDS: Record<string, string> = { isbUptime: 'Improved Shadow Bolt', exposeWeaknessUptime: 'Expose Weakness' };
const STAT_NAMES: Record<number, string> = { [STAT.spellDamage]: 'spell damage', [STAT.spellCritRating]: 'spell crit rating', [STAT.spirit]: 'spirit', [STAT.attackPower]: 'attack power' };

/**
 * Your raid buffs and boss debuffs, topped up with what most of the top players had. Nothing you
 * had is taken away (logs miss buffs now and then, so a top player's log can look worse than
 * yours), and uptimes only go up. Returns what was added, for the UI.
 */
export function withTopRaidBuffs(base: SimEnvironment, others: SimEnvironment[]): { env: SimEnvironment; added: string[] } {
  const env = structuredClone(base);
  const added: string[] = [];
  if (!others.length) return { env, added };
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  for (const section of ['raidBuffs', 'partyBuffs', 'individualBuffs', 'debuffs'] as const) {
    const keys = new Set(others.flatMap((o) => Object.keys(o[section])));
    for (const key of keys) {
      // Drums are a consumable (see the consumes scenario); the hunter's agility goes with Expose Weakness.
      if (key === 'drums' || key === 'exposeWeaknessHunterAgility') continue;
      const values = others.map((o) => o[section][key]).filter((v) => v !== undefined);
      if (UPTIME_FIELDS[key]) {
        const theirs = median(others.map((o) => Number(o[section][key] ?? 0)));
        const mine = Number(env[section][key] ?? 0);
        if (theirs > mine + 0.02) {
          env[section][key] = theirs;
          if (key === 'exposeWeaknessUptime') env[section].exposeWeaknessHunterAgility ??= others.find((o) => o.debuffs.exposeWeaknessHunterAgility)?.debuffs.exposeWeaknessHunterAgility;
          added.push(`${UPTIME_FIELDS[key]} ${Math.round(mine * 100)}% → ${Math.round(theirs * 100)}%`);
        }
        continue;
      }
      if (env[section][key] !== undefined || values.length < others.length / 2) continue;
      // Counts and amounts (Innervates, a shadow priest's DPS...) take the median of those who had it.
      if (values.every((v) => typeof v === 'number')) {
        env[section][key] = median(values as number[]);
        added.push(LABELS[key] ?? key);
        continue;
      }
      const counts = new Map<string, number>();
      for (const v of values) counts.set(JSON.stringify(v), (counts.get(JSON.stringify(v)) ?? 0) + 1);
      env[section][key] = JSON.parse([...counts].sort((a, b) => b[1] - a[1])[0][0]);
      added.push(LABELS[key] ?? key);
    }
  }
  // Uptime-weighted zone/NPC buffs (Rallying Cry...).
  const idxs = new Set(others.flatMap((o) => Object.keys(o.bonusStats).map(Number)));
  for (const idx of idxs) {
    const theirs = median(others.map((o) => o.bonusStats[idx] ?? 0));
    const mine = env.bonusStats[idx] ?? 0;
    if (theirs > mine + 1) {
      env.bonusStats[idx] = theirs;
      added.push(`+${Math.round(theirs - mine)} ${STAT_NAMES[idx] ?? `stat ${idx}`} from zone buffs`);
    }
  }
  env.detected.push(...added.map((a) => `${a} (top 10)`));
  return { env, added };
}
