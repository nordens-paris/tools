// Turns the raw comparison into a short, ranked list of things to look at.
import { CONSUME_CATEGORIES, type AnalysisResult, type ComparisonGroup, type Finding, type PlayerFight } from '../../shared/types.ts';
import { talentPoints } from '../data/talents.ts';
import { castLabel, type SpecConfig } from '../specs/types.ts';
import { median, mostCommon as mostCommonBy } from './stats.ts';

const ENCHANTABLE = ['Head', 'Shoulder', 'Back', 'Chest', 'Wrist', 'Hands', 'Legs', 'Feet', 'Main Hand', 'Off Hand'];
const PERSONAL_RAID_BUFFS = [
  'Bloodlust',
  'Ferocious Inspiration',
  'Unleashed Rage',
  'Leader of the Pack',
  'Trueshot Aura',
  'Greater Blessing of Kings',
  'Greater Blessing of Might',
  'Windfury Totem',
  'Grace of Air',
  'Strength of Earth',
  'Moonkin Aura',
  'Totem of Wrath',
  'Wrath of Air Totem',
];

// Uptimes that come from other players, so a lower one is context rather than a mistake.
const RAID_PROVIDED = ['Bloodlust', 'Drums of Battle', 'Power Infusion', 'Ferocious Inspiration', 'Battle Shout', 'Innervate'];

// Cooldowns whose absence costs the most.
const MAJOR_COOLDOWNS = ['Death Wish', 'Recklessness', 'Arcane Power'];
/**
 * Trinket on-use cooldowns (as shown) and the trinket. Without the trinket equipped, a top player's
 * use isn't a cooldown you skipped but a gear difference.
 */
const TRINKET_COOLDOWNS: Record<string, { item: string; ids: number[] }> = {
  'Blessing of the Silver Crescent': { item: 'Icon of the Silver Crescent', ids: [29370] },
  'Dark Iron Smoking Pipe': { item: 'Dark Iron Smoking Pipe', ids: [281735] },
};

// Rage generators whose timing is about rage, not burst windows.
const RAGE_TOOLS = ['Bloodrage', 'Berserker Rage'];

const fmt = (n: number, digits = 1) => n.toFixed(digits);
const fmtClock = (sec: number) => {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const share = (top: PlayerFight[], pred: (p: PlayerFight) => boolean) => top.filter(pred).length;

export function buildFindings(
  spec: SpecConfig,
  you: PlayerFight,
  top: PlayerFight[],
  metrics: AnalysisResult['metrics'],
  group: Pick<ComparisonGroup, 'players'> = { players: 'top players' },
): Finding[] {
  const findings: Finding[] = [];
  // "top players" or "players a step ahead", with a capital for the start of a sentence.
  const G = group.players;
  const Gc = G[0].toUpperCase() + G.slice(1);
  if (!top.length) return findings;
  const n = top.length;
  const most = (count: number) => count >= Math.ceil(n * 0.6);

  // Rotation: core abilities and GCD usage.
  for (const m of metrics.efficiency) {
    if (m.you < m.median - 10) {
      findings.push({
        severity: m.you < m.median - 20 ? 'high' : 'medium',
        area: 'Rotation',
        title: `Low ${m.label.toLowerCase()}`,
        detail: `You used ${fmt(m.you, 0)}% of possible casts; the median for the ${G} is ${fmt(m.median, 0)}%. Every missed cast of a core ability is lost damage, so this is usually the biggest lever.`,
      });
    }
  }
  const active = metrics.summary.find((m) => m.key === 'active')!;
  if (spec.caster) {
    // Casters should be casting all the time; every idle second is a lost cast.
    const idle = metrics.summary.find((m) => m.key === 'idle')!;
    const longest = you.gaps.slice(0, 3).map((g) => `${fmt(g.duration)}s at ${fmtClock(g.start)}`).join(', ');
    if (active.you < active.median - 3) {
      findings.push({
        severity: active.you < active.median - 8 ? 'high' : 'medium',
        area: 'Rotation',
        title: 'Time not casting',
        detail: `You were casting ${fmt(active.you, 0)}% of the fight (${fmt(idle.you, 0)}s idle) vs ${fmt(active.median, 0)}% for the ${G}.${longest ? ` Longest gaps: ${longest}.` : ''} Movement and mechanics cause some of this; the rest is lost casts.`,
      });
    } else if (you.gaps.length) {
      findings.push({
        severity: 'info',
        area: 'Rotation',
        title: 'Gaps between casts',
        detail: `Casting ${fmt(active.you, 0)}% of the fight, in line with the ${G} (${fmt(active.median, 0)}%). Longest gaps: ${longest}.`,
      });
    }
  } else if (active.you < active.median - 8) {
    findings.push({
      severity: active.you < active.median - 15 ? 'high' : 'medium',
      area: 'Rotation',
      title: 'Global cooldowns left unused',
      detail: `You spent ${fmt(active.you, 0)}% of the fight on the GCD vs ${fmt(active.median, 0)}% for the ${G}. Idle GCDs mean waiting for resources or reacting late.`,
    });
  }
  for (const name of spec.expectedAbilities) {
    const m = metrics.casts.find((c) => c.key === `cpm:${name}`);
    if (!m) continue;
    const users = m.top.filter((v) => (v ?? 0) > 0).length;
    if (m.you === 0 && most(users)) {
      findings.push({
        severity: 'high',
        area: 'Rotation',
        title: `No ${name} casts`,
        detail: `${users} of ${n} ${G} used ${name} (median ${fmt(m.median)}/min). Make sure to switch to it in the execute phase.`,
      });
    } else if (m.you > 0 && m.you < m.median * 0.6) {
      findings.push({
        severity: 'medium',
        area: 'Rotation',
        title: `Few ${name} casts`,
        detail: `${fmt(m.you)}/min vs a median of ${fmt(m.median)}/min for the ${G}.`,
      });
    }
  }
  const hs = metrics.casts.find((c) => c.key === 'cpm:Heroic Strike');
  if (hs && hs.median > 0 && hs.you < hs.median * 0.7) {
    findings.push({
      severity: 'low',
      area: 'Rotation',
      title: `Fewer Heroic Strikes than ${G}`,
      detail: `${fmt(hs.you)}/min vs ${fmt(hs.median)}/min. Heroic Strike is the rage dump; fewer can mean rage starvation (gear/buffs) or holding rage too long.`,
    });
  }
  for (const m of metrics.uptimes) {
    // No drums at all is reported once, as a missing consumable.
    if (m.label.startsWith('Drums') && m.you === 0) continue;
    if (m.median >= 20 && m.you < m.median - 12) {
      // Buffs that come from other players (and longer kills dilute) are context, not a mistake.
      const external = RAID_PROVIDED.includes(m.label);
      findings.push({
        severity: external ? 'info' : 'medium',
        area: 'Buffs',
        title: `Lower ${m.label} uptime`,
        detail: `${fmt(m.you, 0)}% vs a median of ${fmt(m.median, 0)}% for the ${G}.${external ? ' This comes from your group, and a longer kill lowers the uptime share.' : ''}`,
      });
    }
  }

  // Cooldowns. Early uses are collected into one finding.
  const early: string[] = [];
  for (const name of spec.cooldowns.map((c) => castLabel(spec, c))) {
    const yours = you.cooldowns.find((c) => c.name === name);
    const topUses = top.map((p) => p.cooldowns.find((c) => c.name === name)).filter(Boolean);
    if (!topUses.length) continue;
    const trinket = TRINKET_COOLDOWNS[name];
    if (!yours && trinket && !you.gear.some((g) => trinket.ids.includes(g.id))) {
      const wearers = top.filter((p) => p.gear.some((g) => trinket.ids.includes(g.id))).length;
      if (most(wearers)) {
        findings.push({
          severity: 'low',
          area: 'Gear',
          title: `${trinket.item}: ${wearers} of ${n} ${G} wear it`,
          detail: `You don't have it equipped. Its on-use is in their sims through their gear; the Gear tab and the gear what-if show what trinkets like it are worth to you.`,
        });
      }
    } else if (!yours && most(topUses.length)) {
      findings.push({
        severity: MAJOR_COOLDOWNS.includes(name) ? 'high' : 'medium',
        area: 'Cooldowns',
        title: `${name} not used`,
        detail: `${topUses.length} of ${n} ${G} used ${name} on this fight.`,
      });
    } else if (yours && !spec.finishers?.includes(name)) {
      const topFirst = median(topUses.map((c) => c!.times[0]));
      if (yours.times[0] < topFirst - 10 && topUses.length >= 3 && !RAGE_TOOLS.includes(name)) {
        early.push(`${name} at ${fmt(yours.times[0], 0)}s (theirs: ~${fmt(topFirst, 0)}s)`);
      } else if (yours.times[0] > topFirst + 15) {
        findings.push({
          severity: 'low',
          area: 'Cooldowns',
          title: `${name} used late`,
          detail: `First use at ${fmt(yours.times[0], 0)}s vs ${fmt(topFirst, 0)}s for ${G}. Using it earlier can also allow an extra use on longer fights.`,
        });
      }
    }
  }
  if (early.length) {
    findings.push({
      severity: early.length >= 2 ? 'medium' : 'low',
      area: 'Cooldowns',
      title: `Cooldowns used earlier than ${G}`,
      detail: `${early.join(', ')}. ${Gc} hold their cooldowns and stack them together (often with Bloodlust and a potion) instead of using them early in the pull.`,
    });
  }

  // Consumables.
  // "Other" is a grab bag (alcohol, Flame Cap...), so it's shown in the table but not flagged.
  for (const cat of CONSUME_CATEGORIES.filter((c) => c !== 'Other')) {
    const mine = you.consumes.filter((c) => c.category === cat);
    const topWith = top.filter((p) => p.consumes.some((c) => c.category === cat));
    // A flask and battle/guardian elixirs don't combine, so either one fills the slot.
    const hasFlask = you.consumes.some((c) => c.category === 'Flask');
    const elixirs = you.consumes.filter((c) => c.category === 'Battle Elixir' || c.category === 'Guardian Elixir');
    if ((cat === 'Battle Elixir' || cat === 'Guardian Elixir') && hasFlask) continue;
    if (cat === 'Flask' && !hasFlask && elixirs.length >= 2) {
      if (most(topWith.length)) {
        findings.push({
          severity: 'low',
          area: 'Consumes',
          title: 'Elixirs instead of a flask',
          detail: `You used ${elixirs.map((c) => c.name).join(' + ')}; ${topWith.length} of ${n} ${G} used a flask (most common: ${mostCommon(topWith.flatMap((p) => p.consumes.filter((c) => c.category === 'Flask').map((c) => c.name)))}). The consumes what-if on the Sim tab shows what the swap is worth.`,
        });
      }
      continue;
    }
    if (!mine.length && most(topWith.length)) {
      const popular = mostCommon(topWith.flatMap((p) => p.consumes.filter((c) => c.category === cat).map((c) => c.name)));
      findings.push({
        severity: ['Flask', 'Potion', 'Weapon (MH)', 'Weapon (OH)'].includes(cat) ? 'high' : 'medium',
        area: 'Consumes',
        title: `No ${cat.toLowerCase()}`,
        detail: `${topWith.length} of ${n} ${G} used one (most common: ${popular}).`,
      });
    }
  }

  // Gear.
  for (const slot of ENCHANTABLE) {
    const item = you.gear.find((g) => g.slot === slot);
    if (!item || item.enchantId) continue;
    const topEnchanted = share(top, (p) => !!p.gear.find((g) => g.slot === slot)?.enchantId);
    if (topEnchanted > 0) {
      findings.push({
        severity: 'medium',
        area: 'Gear',
        title: `Missing ${slot.toLowerCase()} enchant`,
        detail: `${item.name} has no enchant; ${topEnchanted} of ${n} ${G} enchant this slot.`,
      });
    }
  }
  const ilvl = metrics.summary.find((m) => m.key === 'ilvl')!;
  if (ilvl.you < ilvl.median - 3) {
    findings.push({
      severity: 'info',
      area: 'Gear',
      title: `Lower item level than ${G}`,
      detail: `Average item level ${fmt(ilvl.you)} vs ${fmt(ilvl.median)}. The sim tab shows how much DPS the gear difference is worth.`,
    });
  }

  // Rage from damage taken: some top warriors stand in boss AoE (Death & Decay...) for rage.
  const rage = metrics.summary.find((m) => m.key === 'rageTaken');
  if (rage && rage.max - rage.you >= 15) {
    const standers = top.filter((p) => (p.rageFromDamageTaken?.perMinute ?? 0) - rage.you >= 15);
    const sources = [...new Set(standers.map((p) => p.rageFromDamageTaken?.mainSource).filter(Boolean))];
    findings.push({
      severity: standers.length >= n / 3 ? 'medium' : 'low',
      area: 'Rotation',
      title: `${Gc} took damage for rage`,
      detail: `${standers.map((p) => p.name).join(', ')} got up to ${Math.round(Math.max(...standers.map((p) => p.rageFromDamageTaken!.perMinute)))} rage/min from damage taken${sources.length ? `, mostly ${sources.join(', ')}` : ''}, vs your ${Math.round(rage.you)}. That rage goes into extra Heroic Strikes and bigger Executes; the sim can't model it, so it shows up as execution above 100%.`,
    });
  }

  // Hit: under the cap costs misses; well over it is rating that could be crit or spell power.
  if (you.hit) {
    const { pct, capPct } = you.hit;
    const withHit = top.filter((p) => p.hit);
    const capped = withHit.filter((p) => p.hit!.pct >= p.hit!.capPct - 0.5).length;
    const how = you.hit.extras.length ? ` (${you.hit.fromRating.toFixed(1)}% from rating, ${you.hit.extras.join(', ')})` : '';
    if (pct < capPct - 1) {
      // Under the cap like most of the group is a gearing choice; under it alone is a real gap.
      const mostCapped = capped >= withHit.length / 2;
      findings.push({
        severity: !mostCapped ? 'low' : capPct - pct >= 3 ? 'high' : 'medium',
        area: 'Gear',
        title: `${(capPct - pct).toFixed(1)}% under the hit cap`,
        detail:
          `You had ${pct.toFixed(1)}% hit${how} against a ${capPct}% cap, so about ${(capPct - pct).toFixed(1)}% of your ${spec.caster ? 'spells' : 'special attacks'} missed that wouldn't have. ` +
          (mostCapped
            ? `${capped} of ${withHit.length} ${G} were at the cap.`
            : `Only ${capped} of ${withHit.length} ${G} were at the cap (median ${median(withHit.map((p) => p.hit!.pct)).toFixed(1)}%), so they mostly chose other stats too.`),
      });
    } else if (pct > capPct + 2) {
      findings.push({
        severity: 'low',
        area: 'Gear',
        title: `${(pct - capPct).toFixed(1)}% over the hit cap`,
        detail: `You had ${pct.toFixed(1)}% hit${how} against a ${capPct}% cap. Hit over the cap does nothing${spec.caster ? '' : ' for special attacks (white hits still use it)'}; that rating could go into other stats.`,
      });
    }
  }

  // Power Infusion is a gift from a priest, not something the player controls.
  const piTop = top.filter((p) => p.powerInfusion);
  if (piTop.length || you.powerInfusion) {
    const list = piTop.map((p) => `${p.name} (+${Math.round(p.powerInfusion!.dps)})`).join(', ');
    findings.push({
      severity: 'low',
      area: 'Buffs',
      title: 'Power Infusion',
      detail:
        (you.powerInfusion ? `You got Power Infusion ${you.powerInfusion.uses}× (about +${Math.round(you.powerInfusion.dps)} DPS). ` : 'You got no Power Infusion. ') +
        (piTop.length ? `${piTop.length} of the ${n} ${G} got it: ${list}. ` : '') +
        'The "DPS without Power Infusion" row takes it out: 1/6 of the direct damage done under it, minus time it overlapped Bloodlust (they don\'t stack). The sims include it, so execution % is already fair.',
    });
  }

  // Talents. With real builds from the armory, compare talent by talent; otherwise only the split.
  const armoryTop = top.filter((p) => p.talentSource === 'armory');
  if (you.talentSource === 'armory' && armoryTop.length >= 3) {
    const mine = talentPoints(spec.className, you.talents);
    const theirs = armoryTop.map((p) => talentPoints(spec.className, p.talents));
    const takenBy = (name: string) => theirs.filter((t) => (t.get(name) ?? 0) > 0).length;
    const missing = [...mine].filter(([name, pts]) => pts === 0 && takenBy(name) >= Math.ceil(armoryTop.length * 0.7)).map(([name]) => name);
    const unusual = [...mine].filter(([name, pts]) => pts > 0 && takenBy(name) <= Math.floor(armoryTop.length * 0.2)).map(([name]) => name);
    if (missing.length || unusual.length) {
      findings.push({
        severity: missing.length ? 'medium' : 'low',
        area: 'Talents',
        title: missing.length ? `Talents most ${G} take` : `Talents ${G} skip`,
        detail: [
          missing.length ? `Most of the ${armoryTop.length} ${G} with armory data take ${missing.join(', ')}, which you don't.` : '',
          unusual.length ? `You take ${unusual.join(', ')}, which few of them do.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
    }
  }
  const splits = top.map((p) => p.talentSplit.join('/'));
  const commonSplit = mostCommon(splits);
  const yourSplit = you.talentSplit.join('/');
  if (you.talentSource !== 'armory' && yourSplit !== '0/0/0' && commonSplit && yourSplit !== commonSplit && !splits.includes(yourSplit)) {
    findings.push({
      severity: 'low',
      area: 'Talents',
      title: 'Different talent split',
      detail: `You run ${yourSplit}; the most common split among the ${G} is ${commonSplit}. Your armory talents weren't found, so only the split can be compared.`,
    });
  }

  // Fight context.
  const dur = metrics.summary.find((m) => m.key === 'duration')!;
  if (you.durationSec > dur.median * 1.15) {
    findings.push({
      severity: 'info',
      area: 'Fight',
      title: `Longer kill than the ${G}`,
      detail: `Your kill took ${fmt(you.durationSec, 0)}s vs a median of ${fmt(dur.median, 0)}s. Short kills inflate DPS because cooldowns, potions and Bloodlust cover a bigger share of the fight, so part of the gap is not about your play. The Sim tab's "Kill time" part shows how much.`,
    });
  }
  const missingBuffs = PERSONAL_RAID_BUFFS.filter(
    (b) => !you.buffs.some((x) => x.name === b) && most(share(top, (p) => p.buffs.some((x) => x.name === b))),
  );
  if (missingBuffs.length) {
    findings.push({
      severity: 'info',
      area: 'Buffs',
      title: `Raid buffs the ${G} had`,
      detail: `Most ${G} had ${missingBuffs.join(', ')}, which you didn't. That's raid/group setup rather than your own play.`,
    });
  }

  const order = { high: 0, medium: 1, low: 2, info: 3 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

const mostCommon = (values: string[]) => mostCommonBy(values) ?? '';
