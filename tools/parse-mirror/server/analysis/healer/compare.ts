// A healer's kill next to their peers (see peers.ts), split into what's fair to judge whatever
// the raid around them, and context that depends on that raid (HPS, total overheal...).
import crypto from 'node:crypto';

import type {
  HealerAnalysis,
  HealerFinding,
  HealerMetrics,
  HealerPeer,
  HealerRow,
  HealerSpellCompare,
} from '../../../shared/types.ts';
import { supportedSpecs } from '../../specs/index.ts';
import type { WclClient } from '../../wcl/client.ts';
import { median } from '../stats.ts';
import { fetchHealerFight } from './data.ts';
import { healerDeaths, healerMetrics, ownOverheal } from './metrics.ts';
import { FightModel } from './model.ts';
import { findHealerPeers } from './peers.ts';

type PeerMetrics = HealerAnalysis['peers'][number];

/** Fewer peers than this, and nothing is judged against them. */
const MIN_PEERS = 3;

const POTION = 'Mana potion';
const RUNES = ['Dark Rune', 'Demonic Rune'];

/** Runs the healer analysis for one healer in one kill, peers included. */
export async function analyzeHealer(
  client: WclClient,
  report: string,
  fightId: number,
  source: number,
  log: (msg: string) => void = () => {},
): Promise<HealerAnalysis> {
  const fights = await client.fights(report);
  const model = new FightModel(await fetchHealerFight(client, report, fightId, fights));
  const spec = model.healers.get(source);
  if (!spec) {
    const icon = model.icon(source).replace('-', ' ');
    throw new Error(`${model.name(source)} (${icon}) isn't healing on this kill. Supported: ${supportedSpecs.join(', ')}, and healers.`);
  }
  const you = healerMetrics(model, source);
  const warnings: string[] = [];
  if (!model.data.fight.kill) warnings.push('This fight was a wipe; peers are compared on kills, so expect differences.');

  log(`Finding ${spec.label}s in well-run raids like yours`);
  const group = await findHealerPeers(
    client,
    { encounterId: model.data.fight.boss, spec, tankShareIcon: you.tankShareIcon, healers: model.healers.size, dtpsPerHealer: model.raidDtps / model.healers.size, report },
    log,
  );
  log(`Collecting ${group.peers.length} peers`);
  const settled = await Promise.allSettled(group.peers.map((p) => peerMetrics(client, p)));
  const peers: PeerMetrics[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) peers.push(r.value);
    else warnings.push(`Skipped ${group.peers[i].name}: ${r.status === 'rejected' ? (r.reason as Error).message : 'not found as a healer in their log'}`);
  });

  const judged = judgedRows(you, peers);
  const context = contextRows(you, peers);
  const spells = compareSpells(you, peers);
  const deaths = healerDeaths(model);
  return {
    kind: 'healer',
    id: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    report,
    fight: fightId,
    encounter: { id: model.data.fight.boss, name: model.data.fight.name },
    durationSec: model.durationSec,
    kill: !!model.data.fight.kill,
    you,
    peers,
    group,
    judged,
    context,
    spells,
    findings: peers.length >= MIN_PEERS ? healerFindings(you, peers, spells, deaths, model.tanks.map((t) => model.name(t))) : [],
    deaths,
    tanks: model.tanks.map((t) => ({ name: model.name(t), icon: model.icon(t) })),
    raid: { hps: model.durationSec ? model.raidEffective / model.durationSec : 0, dtps: model.raidDtps, healers: model.healers.size },
    warnings,
  };
}

async function peerMetrics(client: WclClient, p: HealerPeer): Promise<PeerMetrics | undefined> {
  const m = new FightModel(await fetchHealerFight(client, p.report, p.fight));
  const id = [...m.players.values()].find((a) => a.name === p.name)?.id;
  if (id === undefined || !m.healers.has(id)) return undefined;
  return { ...healerMetrics(m, id), peer: p, durationSec: m.durationSec };
}

const nums = (vals: (number | null | undefined)[]) => vals.filter((v): v is number => typeof v === 'number');
const med = (vals: (number | null | undefined)[]) => (nums(vals).length ? median(nums(vals)) : null);

function row(
  key: string,
  label: string,
  you: HealerMetrics,
  peers: HealerMetrics[],
  get: (h: HealerMetrics) => number | null | undefined,
  format: HealerRow['format'],
  higherIsBetter?: boolean,
  hint?: string,
): HealerRow {
  const vals = peers.map((p) => get(p) ?? null);
  return { key, label, you: get(you) ?? null, median: med(vals), peers: vals, format, higherIsBetter, hint };
}

const cdCount = (h: HealerMetrics, names: string[]) => h.cooldowns.filter((c) => names.includes(c.name) && !c.from).length;
const upkeep = (name: string, field: 'uptime' | 'stack3' = 'uptime') => (h: HealerMetrics) => h.upkeep.find((u) => u.name === name)?.[field] ?? null;

function judgedRows(you: HealerMetrics, peers: HealerMetrics[]): HealerRow[] {
  const rows = [
    row('hpm', 'Healing per mana', you, peers, (h) => h.mana?.healPerMana, 'dec', true, 'Effective healing per point of mana spent.'),
    row('ownOverheal', 'Overheal by your own choice', you, peers, ownOverheal, 'pct', false, 'Heal bigger than the gap when you committed, as a share of all your healing.'),
    row('potions', 'Mana potions and runes', you, peers, (h) => cdCount(h, [POTION, ...RUNES]), 'int', true),
    row('cooldowns', 'Other cooldowns used', you, peers, (h) => h.cooldowns.filter((c) => ![POTION, ...RUNES].includes(c.name) && !c.from).length, 'int', true),
    row('below10', 'Seconds under 10% mana', you, peers, (h) => h.mana?.secBelow10, 'sec', false),
    row('cancelLost', 'Time lost to cancelled casts', you, peers, (h) => h.cancels.secLost, 'sec', false),
    row('idle', 'Idle while someone you heal was low', you, peers, (h) => h.idleWhileNeeded.sec, 'sec', false, 'Seconds not casting while a player you heal was under 70%.'),
    row('reaction', 'Reaction to a drop below 50%', you, peers, (h) => h.reaction.medianSec, 'sec', false, 'Median time from a player you heal dropping below 50% to your next heal landing on them.'),
    row('first', 'First to heal after a drop', you, peers, (h) => h.reaction.firstResponder, 'pct', true),
    row('saves', 'Saves', you, peers, (h) => h.saves, 'int', true, 'Someone under 25% your heal brought back, who lived 5 more seconds.'),
    row('preheal', 'Tank preheals that landed usefully', you, peers, (h) => h.tankPreheal?.prehealEffective, 'pct', true),
    row('es', 'Earth Shield uptime', you, peers, upkeep('Earth Shield'), 'pct', true),
    row('lb', 'Lifebloom uptime (main target)', you, peers, upkeep('Lifebloom'), 'pct', true),
    row('lb3', 'Lifebloom at 3 stacks', you, peers, upkeep('Lifebloom', 'stack3'), 'pct', true),
  ];
  return rows.filter((r) => r.you !== null || nums(r.peers).length);
}

function contextRows(you: HealerMetrics, peers: HealerMetrics[]): HealerRow[] {
  return [
    row('hps', 'HPS', you, peers, (h) => h.hps, 'num'),
    row('share', 'Share of the raid’s healing', you, peers, (h) => h.shareOfRaid, 'pct'),
    row('ofDamage', 'Your healing vs the raid’s damage taken', you, peers, (h) => h.context.healPerRaidDamage, 'pct'),
    row('healers', 'Healers in the raid', you, peers, (h) => h.context.raidHealers, 'int'),
    row('perHealer', 'Raid damage taken per healer per second', you, peers, (h) => h.context.raidDtps / Math.max(1, h.context.raidHealers), 'num'),
    row('tanks', 'Healing on tanks', you, peers, (h) => h.tankShare, 'pct'),
    row('overheal', 'Overheal (all causes)', you, peers, (h) => h.overhealPct, 'pct'),
    row('othersFilled', 'Overheal: others filled the gap first', you, peers, (h) => h.overheal.othersFilled, 'pct'),
    row('manaEnd', 'Mana at the end', you, peers, (h) => h.mana?.end, 'pct'),
    row('activity', 'Time spent casting', you, peers, (h) => h.activity, 'pct'),
  ];
}

function compareSpells(you: HealerMetrics, peers: HealerMetrics[]): HealerSpellCompare[] {
  const shareOf = (h: HealerMetrics, name: string) => {
    const tot = h.spells.reduce((s, x) => s + x.effective, 0);
    return tot ? (h.spells.find((x) => x.name === name)?.effective ?? 0) / tot : 0;
  };
  const hpm = (h: HealerMetrics, name: string) => {
    const s = h.spells.find((x) => x.name === name);
    return s && s.mana > 500 ? s.effective / s.mana : null;
  };
  const over = (h: HealerMetrics, name: string) => {
    const s = h.spells.find((x) => x.name === name);
    return s && s.effective + s.overheal ? s.overheal / (s.effective + s.overheal) : 0;
  };
  const names = new Set([...you.spells, ...peers.flatMap((p) => p.spells)].filter((s) => s.effective > 0).map((s) => s.name));
  return [...names]
    .map((name) => {
      const icon = [you, ...peers].flatMap((h) => h.spells).find((s) => s.name === name)?.icon;
      const users = peers.filter((p) => p.spells.some((s) => s.name === name && s.effective > 0));
      return {
        name,
        icon,
        you: { share: shareOf(you, name), healPerMana: hpm(you, name), casts: you.spells.find((s) => s.name === name)?.casts ?? 0, overheal: over(you, name) },
        peers: {
          share: median(peers.map((p) => shareOf(p, name))),
          healPerMana: med(users.map((p) => hpm(p, name))),
          overheal: med(users.map((p) => over(p, name))) ?? 0,
          users: users.length,
        },
      };
    })
    .filter((s) => s.you.share >= 0.01 || s.peers.share >= 0.01)
    .sort((a, b) => Math.max(b.you.share, b.peers.share) - Math.max(a.you.share, a.peers.share));
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

function healerFindings(you: HealerMetrics, peers: HealerMetrics[], spells: HealerSpellCompare[], deaths: HealerAnalysis['deaths'], tanks: string[]): HealerFinding[] {
  const out: HealerFinding[] = [];
  const n = peers.length;
  const share = (pred: (h: HealerMetrics) => boolean) => peers.filter(pred).length;

  // Spell efficiency: main spells that give much less healing per mana than the peers get.
  for (const s of spells) {
    if (s.you.share < 0.15 || s.you.healPerMana === null || s.peers.healPerMana === null || s.peers.users < MIN_PEERS) continue;
    const ratio = s.you.healPerMana / s.peers.healPerMana;
    if (ratio > 0.8) continue;
    out.push({
      severity: ratio < 0.65 && s.you.share >= 0.3 ? 'high' : 'medium',
      tab: 'Spells',
      title: `${s.name} gives ${s.you.healPerMana.toFixed(1)} healing per mana, peers get ${s.peers.healPerMana.toFixed(1)}`,
      detail:
        `${pct(s.you.overheal)} of your ${s.name} was overheal (peers ${pct(s.peers.overheal)}). ` +
        'Cast it on bigger gaps, use a lower rank for small ones, or let a cheaper spell cover them.',
    });
  }
  // Spell mix: what peers lean on that you barely use, and the reverse.
  for (const s of spells) {
    if (s.peers.share >= 0.15 && s.you.share < 0.05 && s.peers.users >= Math.ceil(n * 0.6)) {
      out.push({ severity: 'medium', tab: 'Spells', title: `Peers lean on ${s.name}; you barely use it`, detail: `${s.name} is ${pct(s.peers.share)} of their healing and ${pct(s.you.share)} of yours.` });
    } else if (s.you.share >= 0.25 && s.peers.share < 0.08 && s.you.healPerMana !== null && you.mana && s.you.healPerMana < you.mana.healPerMana) {
      out.push({
        severity: 'low',
        tab: 'Spells',
        title: `${s.name} is ${pct(s.you.share)} of your healing, ${pct(s.peers.share)} of theirs`,
        detail: `It gives you ${s.you.healPerMana.toFixed(1)} healing per mana, below your average of ${you.mana.healPerMana.toFixed(1)}.`,
      });
    }
  }
  // Own-choice overheal.
  const mine = ownOverheal(you);
  const theirs = median(peers.map(ownOverheal));
  if (mine > theirs + 0.08) {
    out.push({
      severity: mine > theirs + 0.15 ? 'high' : 'medium',
      tab: 'Overheal',
      title: `${pct(mine)} of your healing overhealed by your own choice, peers ${pct(theirs)}`,
      detail: 'These heals were already bigger than the gap when you started casting. Overheal caused by other healers landing first isn’t counted here.',
    });
  }
  // Mana: potions, runes, cooldowns, and mana left over or run out.
  const potionPeers = share((h) => cdCount(h, [POTION]) > 0);
  if (cdCount(you, [POTION]) === 0 && potionPeers >= Math.ceil(n * 0.6)) {
    out.push({ severity: 'high', tab: 'Mana', title: 'No mana potion used', detail: `${potionPeers} of ${n} peers used one on this kill.` });
  }
  const runePeers = share((h) => cdCount(h, RUNES) > 0);
  if (cdCount(you, RUNES) === 0 && runePeers >= Math.ceil(n * 0.6)) {
    out.push({ severity: 'medium', tab: 'Mana', title: 'No Dark or Demonic Rune used', detail: `${runePeers} of ${n} peers used one. It shares no cooldown with potions.` });
  }
  const yourCds = new Set(you.cooldowns.filter((c) => !c.from).map((c) => c.name));
  const peerCds = new Map<string, number>();
  for (const p of peers) for (const c of new Set(p.cooldowns.filter((c) => !c.from).map((c) => c.name))) peerCds.set(c, (peerCds.get(c) ?? 0) + 1);
  for (const [cd, users] of peerCds) {
    if (cd === POTION || RUNES.includes(cd) || yourCds.has(cd) || users < Math.ceil(n * 0.6)) continue;
    out.push({ severity: 'medium', tab: 'Mana', title: `${cd} not used`, detail: `${users} of ${n} peers used it on this kill.` });
  }
  if (you.mana && you.mana.secBelow10 >= 10 && you.mana.secBelow10 > 2 * (median(peers.map((p) => p.mana?.secBelow10 ?? 0)) + 2)) {
    out.push({ severity: 'medium', tab: 'Mana', title: `Under 10% mana for ${you.mana.secBelow10} s`, detail: 'Use mana cooldowns earlier, or lower ranks while the raid is stable.' });
  } else if (you.mana && you.mana.end >= 0.35 && you.mana.end > median(peers.map((p) => p.mana?.end ?? 0)) + 0.15) {
    out.push({ severity: 'low', tab: 'Mana', title: `Ended the kill with ${pct(you.mana.end)} mana`, detail: 'Mana left at the end is healing you could have done: bigger ranks or more casts were affordable.' });
  }
  // Upkeep
  for (const [name, field, label] of [['Earth Shield', 'uptime', 'Earth Shield uptime'], ['Lifebloom', 'stack3', 'Lifebloom at 3 stacks']] as const) {
    const y = upkeep(name, field)(you);
    const ps = nums(peers.map(upkeep(name, field)));
    if (y === null || ps.length < MIN_PEERS) continue;
    const m = median(ps);
    if (y < m - 0.15) out.push({ severity: 'medium', tab: 'Overview', title: `${label} ${pct(y)}, peers ${pct(m)}`, detail: `Kept on ${you.upkeep.find((u) => u.name === name)?.target}.` });
  }
  // Response
  const lost = median(peers.map((p) => p.cancels.secLost));
  if (you.cancels.secLost >= 8 && you.cancels.secLost > 2 * lost + 3) {
    out.push({
      severity: 'low',
      tab: 'Response',
      title: `${Math.round(you.cancels.secLost)} s lost to ${you.cancels.count} cancelled casts`,
      detail: `Peers lost ${Math.round(lost)} s. Cancelling a heal the target no longer needs saves mana; cancelling to move or retarget loses the cast time.`,
    });
  }
  const idle = median(peers.map((p) => p.idleWhileNeeded.sec));
  if (you.idleWhileNeeded.sec >= 5 && you.idleWhileNeeded.sec > idle + 5) {
    out.push({
      severity: 'medium',
      tab: 'Response',
      title: `${Math.round(you.idleWhileNeeded.sec)} s not casting while someone you heal was under 70%`,
      detail: `Peers: ${Math.round(idle)} s. Moving and out-of-range time count too.`,
    });
  }
  const rx = med(peers.map((p) => p.reaction.medianSec));
  if (you.reaction.medianSec !== undefined && rx !== null && you.reaction.answered >= 5 && you.reaction.medianSec > rx + 1) {
    out.push({ severity: 'low', tab: 'Response', title: `Slower to react: ${you.reaction.medianSec.toFixed(1)} s, peers ${rx.toFixed(1)} s`, detail: 'Median time from a player you heal dropping below 50% to your next heal landing on them.' });
  }
  // Deaths you had time to prevent: tanks for tank healers.
  if (you.role !== 'raid') {
    for (const d of deaths) {
      if (d.kind !== 'window' || !tanks.includes(d.player)) continue;
      const casts = d.healers.find((h) => h.name === you.name)?.casts ?? [];
      if (casts.some((c) => c.endsWith(`→ ${d.player}`))) continue;
      out.push({
        severity: 'medium',
        tab: 'Deaths',
        title: `${d.player} died with ${d.secBelow50?.toFixed(1)} s under 50%`,
        detail: `Killed by ${d.killedBy} at ${Math.floor(d.atSec / 60)}:${String(d.atSec % 60).padStart(2, '0')}. You cast: ${casts.join(', ') || 'nothing'}.`,
      });
    }
  }
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
