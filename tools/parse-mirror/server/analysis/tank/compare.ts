// A tank's kill next to their peers (see peers.ts), split into what's fair to judge (gear choices,
// mitigation, threat, cooldowns) and context that depends on the raid and the boss (damage taken,
// the size of the hits).
import type { HealerRow, TankAnalysis, TankBossMelee, TankFinding, TankMetrics, TankOpenerVerdict } from '../../../shared/types.ts';
import { type TankSpec, tankSpecFor } from '../../specs/tanks.ts';
import type { WclReader } from '../../wcl/reader.ts';
import { FightModel } from '../healer/model.ts';
import { median } from '../stats.ts';
import { fetchTankFight } from './data.ts';
import { bossMeleeOf, tankMetrics, tankSpecIn } from './metrics.ts';
import { findTankPeers } from './peers.ts';

const MIN_PEERS = 3;

const nums = (vals: (number | null | undefined)[]) => vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
const med = (vals: (number | null | undefined)[]) => (nums(vals).length ? median(nums(vals)) : null);
const fmtClock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, '0')}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

function row(key: string, label: string, you: TankMetrics, peers: TankMetrics[], get: (t: TankMetrics) => number | null | undefined, format: HealerRow['format'], higherIsBetter?: boolean, hint?: string): HealerRow {
  const vals = peers.map((p) => get(p) ?? null);
  return { key, label, you: get(you) ?? null, median: med(vals), peers: vals, format, higherIsBetter, hint };
}

const crushRate = (t: TankMetrics) => (t.swings.total ? t.swings.crush / t.swings.total : null);
const coverage = (t: TankMetrics) => t.mitigation[0]?.swingsCovered ?? null;
const debuff = (name: string) => (t: TankMetrics) => t.bossDebuffs.find((d) => d.name === name)?.uptime ?? (t.className === classFor(name) ? 0 : null);
const classFor = (debuffName: string) =>
  ['Sunder Armor', 'Thunder Clap', 'Demoralizing Shout'].includes(debuffName) ? 'Warrior' : ['Demoralizing Roar', 'Lacerate'].includes(debuffName) ? 'Druid' : 'Paladin';
const defensiveCds = (t: TankMetrics) => t.cooldowns.length;

function judgedRows(you: TankMetrics, peers: TankMetrics[]): HealerRow[] {
  const rows = [
    row('ehp', 'Effective health', you, peers, (t) => t.survivability.effectiveHealth, 'num', true, 'Health / (1 − armor reduction) against a level 73 boss: how much physical damage you can take.'),
    row('armor', 'Armor reduction', you, peers, (t) => t.survivability.armorReduction, 'pct', true),
    row('hp', 'Health', you, peers, (t) => t.survivability.maxHp, 'num', true, 'Measured from big hits and the share of your health they took (raid buffs included).'),
    row('avoid', 'Swings avoided', you, peers, (t) => t.swings.avoided, 'pct', true, 'Misses, dodges and parries, as a share of the swings you took.'),
    row('crush', 'Crushing blows per 100 swings', you, peers, (t) => (crushRate(t) ?? 0) * 100, 'dec', false, 'Crushing blows hit for 150%. Bears always take some; a warrior or paladin with Shield Block or Holy Shield up takes none.'),
    row('coverage', 'Swings taken with Holy Shield / Shield Block up', you, peers, coverage, 'pct', true),
    row('aura', 'Time in your tanking stance or form', you, peers, (t) => t.tankAuraUptime, 'pct', true),
    row('cat', 'Time in Cat Form', you, peers, (t) => t.catFormUptime, 'pct', false),
    row('tps', 'Threat per second', you, peers, (t) => t.threat.tps, 'num', true, 'From your damage and abilities with WoWSims’ threat values.'),
    row('opener', 'Threat per second, first 10 s', you, peers, (t) => t.threat.opener[1], 'num', true, 'Snap threat: what DPS can safely open on.'),
    row('demo', 'Demoralizing Shout/Roar on the boss', you, peers, (t) => (t.className === 'Paladin' ? null : (t.bossDebuffs.find((d) => d.name.startsWith('Demoralizing'))?.uptime ?? 0)), 'pct', true),
    row('tc', 'Thunder Clap on the boss', you, peers, debuff('Thunder Clap'), 'pct', true),
    row('lacerate', 'Lacerate on the boss', you, peers, debuff('Lacerate'), 'pct', true),
    row('cds', 'Defensive cooldowns and potions used', you, peers, defensiveCds, 'int', true),
    row('drops', 'Threat dropped on yourself', you, peers, (t) => t.threatDrops.length, 'int', false, 'Divine Shield or Blessing of Protection on yourself wipes your threat.'),
  ];
  // Only rows someone has a value for, and class rows only for that class.
  return rows.filter((r) => r.you !== null || nums(r.peers).length);
}

function contextRows(you: TankMetrics, peers: TankMetrics[]): HealerRow[] {
  return [
    row('share', 'Share of the boss’s melee', you, peers, (t) => t.swingShare, 'pct'),
    row('dtps', 'Damage taken per second', you, peers, (t) => t.dtps, 'num'),
    row('hit', 'Damage per boss hit that landed', you, peers, (t) => t.swings.damagePerHit, 'num'),
    row('unmit', 'Before armor and block', you, peers, (t) => t.swings.unmitigatedPerHit, 'num'),
    row('lean', 'Gear stat budget on mitigation', you, peers, (t) => t.gear?.mitigationLean, 'pct'),
    row('swings', 'Boss swings taken', you, peers, (t) => t.swings.total, 'int'),
    row('near', 'Times under 20% health (survived)', you, peers, (t) => t.nearDeaths, 'int'),
  ];
}

/** How each tank class can start the fight at once, for the late-start note. */
const FAST_PULL: Record<string, string> = {
  Warrior: 'Charge in, or pull with the raid stacked on the boss so you start in melee',
  Paladin: "Avenger's Shield or a Judgement from range, or pull with the raid stacked on the boss",
  Druid: 'Faerie Fire (Feral) from range, or pull with the raid stacked on the boss so you start in melee',
};

/**
 * The opener next to the peers' (see TankOpenerVerdict). The gap in threat from the pull splits into:
 * the start (the seconds you started after the peers, at your threat per second once fighting),
 * luck (what bad luck cost you, next to what it cost the peers) and the rest, the rotation and gear.
 * Off-tanks are left out: their opener depends on when the boss came to them.
 */
export function openerVerdict(you: TankMetrics, peers: TankMetrics[], spec: TankSpec): TankOpenerVerdict | undefined {
  if (!peers.length) return undefined;
  const o = you.opener;
  const per = (v: number) => v / o.windowSec;
  const pull = (m: TankMetrics) => per(m.opener.pullThreat);
  const luck = (m: TankMetrics) => per(m.opener.luckThreat);
  const engaged = (m: TankMetrics) => per(m.opener.threat) + luck(m);
  const peerTps = med(peers.map(pull))!;
  const tps = pull(you);
  const start = { you: o.startSec, peers: med(peers.map((p) => p.opener.startSec)) ?? undefined, bossYou: o.bossSwingSec, bossPeers: med(peers.map((p) => p.opener.bossSwingSec)) ?? undefined };
  const late = start.you !== undefined && start.peers !== undefined ? Math.min(o.windowSec, start.you - start.peers) : 0;
  const peerLuck = med(peers.map(luck))!;
  const parts = { start: (late * per(o.threat)) / o.windowSec, luck: luck(you) - peerLuck, rotation: 0 };
  parts.rotation = peerTps - tps - parts.start - parts.luck;

  const reasons: string[] = [];
  if (start.you !== undefined && start.peers !== undefined && start.you > start.peers + 1) {
    const boss = start.bossYou !== undefined && start.bossPeers !== undefined ? `, and ${you.tanked} first swung at you at ${start.bossYou.toFixed(1)} s (peers ${start.bossPeers.toFixed(1)} s)` : '';
    reasons.push(
      `Your first attack landed at ${start.you.toFixed(1)} s, the peers' at ${start.peers.toFixed(1)} s${boss}. They started fighting earlier: compare how they pull (${FAST_PULL[spec.className] ?? 'a stacked pull'}).`,
    );
  }
  if (parts.luck >= 30) {
    const cost = (v: number) => (v >= 0 ? `cost about ${Math.round(v)} TPS` : `gained about ${Math.round(-v)} TPS`);
    reasons.push(
      `Luck went the peers' way: in your first ${o.windowSec} s of fighting ${o.avoided} of your ${o.attacks} attacks ${o.avoided === 1 ? 'was' : 'were'} missed, dodged or parried (about ${o.expectedAvoided.toFixed(1)} is usual for you) and ${o.crits} of ${o.landed} crit (about ${o.expectedCrits.toFixed(1)} usual), which ${cost(luck(you))}; for the median peer it ${cost(peerLuck)}.`,
    );
  }
  // The rotation once in melee: global cooldowns used, and abilities most peers opened with.
  const gcdShare = o.gcds / o.possibleGcds;
  const peerGcd = med(peers.map((p) => p.opener.gcds / p.opener.possibleGcds));
  if (peerGcd !== null && gcdShare < peerGcd - 0.2) {
    reasons.push(`From your first attack you used ${o.gcds} of ${o.possibleGcds} global cooldowns, the peers ${pct(peerGcd)} of theirs.`);
  }
  const counts = new Map<string, number>();
  for (const p of peers) for (const name of Object.keys(p.opener.abilities)) counts.set(name, (counts.get(name) ?? 0) + 1);
  const missing = [...counts].filter(([name, n]) => n >= Math.ceil(peers.length / 2) && !o.abilities[name]).map(([name]) => name);
  if (missing.length) reasons.push(`Most peers used ${missing.join(', ')} in their first ${o.windowSec} s of fighting, which you didn't.`);
  // Abilities you used clearly less often (Maul and Heroic Strike need spare rage, so this is often rage).
  const fewer = [...counts.keys()]
    .filter((name) => !missing.includes(name) && o.abilities[name])
    .map((name) => ({ name, peers: median(peers.map((p) => p.opener.abilities[name] ?? 0)), you: o.abilities[name] }))
    .filter((x) => x.peers - x.you >= 2);
  for (const x of fewer) reasons.push(`The peers used ${x.name} about ${Math.round(x.peers)} times in their first ${o.windowSec} s of fighting, you ${x.you}.`);

  const [biggest, size] = (Object.entries(parts) as [keyof typeof parts, number][]).sort((x, y) => y[1] - x[1])[0];
  return {
    verdict: tps >= peerTps * 0.75 ? 'fine' : size >= 0.45 * (peerTps - tps) ? biggest : 'mixed',
    tps,
    peerTps,
    engagedTps: engaged(you),
    peerEngagedTps: med(peers.map(engaged))!,
    parts,
    start,
    reasons,
  };
}

const VERDICT_TITLE = { start: 'mostly a later start', luck: 'mostly bad luck', rotation: 'mostly the rotation and gear', mixed: 'a later start, luck and the rotation together' } as const;

function openerFinding(you: TankMetrics, peers: TankMetrics[], spec: TankSpec): TankFinding | undefined {
  if (you.role === 'off') return undefined;
  const v = openerVerdict(you, peers, spec);
  if (!v || v.verdict === 'fine') return undefined;
  const gap = v.peerTps - v.tps;
  const part = (n: number, label: string) => (n >= 1 ? `${Math.round(n)} from ${label}` : n <= -1 ? `${Math.round(-n)} in your favour from ${label}` : '');
  const split = [part(v.parts.start, 'starting later'), part(v.parts.luck, 'luck'), part(v.parts.rotation, 'the rotation and gear')].filter(Boolean).join(', ');
  // The full reasons are on the Threat tab; the finding names each part worth a quarter of the gap.
  const leads = [
    v.parts.start >= gap / 4 ? `The peers started fighting about ${Math.max(0, (v.start.you ?? 0) - (v.start.peers ?? 0)).toFixed(1)} s sooner: compare how they pull (${FAST_PULL[spec.className] ?? 'a stacked pull'}).` : '',
    v.parts.luck >= gap / 4 ? 'Luck favoured the peers: fewer of their first attacks were avoided, or more crit.' : '',
    v.parts.rotation >= gap / 4 ? 'Once fighting, the rest is the rotation and gear: compare global cooldowns and abilities with the peers.' : '',
  ].filter(Boolean);
  const lead = leads.join(' ')
  return {
    severity: v.verdict === 'luck' ? 'low' : 'medium',
    tab: 'Threat',
    title: `Opening threat ${Math.round(v.tps)} TPS over ${you.opener.windowSec} s, peers ${Math.round(v.peerTps)}: ${VERDICT_TITLE[v.verdict]}`,
    detail: `Of the ${Math.round(gap)} TPS gap, about ${split}. ${lead} The Threat tab goes through your opener action by action.`,
  };
}

function tankFindings(you: TankMetrics, peers: TankMetrics[], spec: TankSpec): TankFinding[] {
  const out: TankFinding[] = [];
  const m = (f: (t: TankMetrics) => number | null | undefined) => med(peers.map(f));
  // Crits: never acceptable on a boss.
  if (you.swings.crit > 0) {
    out.push({ severity: 'high', tab: 'Survivability', title: `The boss crit you ${you.swings.crit} time${you.swings.crit === 1 ? '' : 's'}`, detail: `You need 5.6% less chance to be crit (defense 490 for warriors and paladins; bears get 3% from Survival of the Fittest and use defense and resilience for the rest). Yours: ${you.gear ? `${you.gear.critReduction.toFixed(2)}%` : 'unknown'}.` });
  } else if (you.gear && !you.gear.critImmune) {
    out.push({ severity: 'medium', tab: 'Survivability', title: `Not crit immune by gear (${you.gear.critReduction.toFixed(2)}% of 5.6%)`, detail: 'You weren’t crit on this kill, but your defense and resilience don’t cover the boss’s 5.6% crit chance.' });
  }
  // Crushing blows while Holy Shield / Shield Block was down.
  const mit = you.mitigation[0];
  if (mit && mit.crushesUncovered >= 2) {
    out.push({ severity: 'high', tab: 'Mitigation', title: `${mit.crushesUncovered} crushing blows while ${mit.name} was down`, detail: `With ${mit.name} up you can't be crushed. It was up for ${pct(mit.uptime)} of the kill and covered ${pct(mit.swingsCovered)} of the swings you took.` });
  }
  const cov = m(coverage);
  if (mit && cov !== null && mit.swingsCovered < cov - 0.15) {
    out.push({ severity: 'medium', tab: 'Mitigation', title: `${mit.name} up for ${pct(mit.swingsCovered)} of the swings you took, peers ${pct(cov)}`, detail: `Keep ${mit.name} up while the boss is on you, and refresh it before it runs out.` });
  }
  // Stance / form.
  if (you.tankAuraUptime < 0.9 && you.role !== 'adds') {
    out.push({ severity: you.tankAuraUptime < 0.7 ? 'high' : 'medium', tab: 'Mitigation', title: `In your tanking stance or form for ${pct(you.tankAuraUptime)} of the kill`, detail: 'Out of it you take more damage and make less threat (Defensive Stance and bear form are ×1.3 threat, ×1.495 with the talent).' });
  }
  if ((you.catFormUptime ?? 0) > 0.05 && you.role === 'main') {
    out.push({ severity: 'medium', tab: 'Mitigation', title: `In Cat Form for ${pct(you.catFormUptime!)} of the kill while main tanking`, detail: 'Cat Form makes 0.71× threat and loses the bear form armor and health.' });
  }
  // Threat dropped on yourself.
  for (const d of you.threatDrops) {
    out.push({ severity: 'medium', tab: 'Cooldowns', title: `${d.name} at ${fmtClock(d.atSec)} dropped your threat`, detail: `${d.name} on yourself wipes your threat on the boss; if it was to survive, a defensive cooldown or potion earlier would have kept aggro.` });
  }
  // Survivability vs threat: the gear choice.
  const ehp = m((t) => t.survivability.effectiveHealth);
  const tps = m((t) => t.threat.tps);
  if (ehp !== null && tps !== null && you.survivability.effectiveHealth < ehp * 0.85) {
    const extraThreat = you.threat.tps >= tps;
    out.push({
      severity: 'medium',
      tab: 'Survivability',
      title: `Effective health ${Math.round(you.survivability.effectiveHealth / 1000)}k, peers ${Math.round(ehp / 1000)}k`,
      detail: extraThreat
        ? `Your threat (${Math.round(you.threat.tps)} TPS) is at least the peers' (${Math.round(tps)}), so there's room to swap some threat gear for stamina, armor or defense.`
        : 'Less armor or health than the peers; stamina and armor gems and enchants are the cheapest gain.',
    });
  }
  // Threat.
  const opener = openerFinding(you, peers, spec);
  if (opener) out.push(opener);
  if (tps !== null && you.threat.tps < tps * 0.75) {
    out.push({ severity: 'low', tab: 'Threat', title: `Threat ${Math.round(you.threat.tps)} TPS, peers ${Math.round(tps)}`, detail: 'Threat per second over the kill. The Threat tab shows where it comes from, next to the peers.' });
  }
  // Debuffs on the boss that cut the raid's damage taken.
  const demo = m((t) => t.bossDebuffs.find((d) => d.name.startsWith('Demoralizing'))?.uptime ?? 0);
  const yourDemo = you.bossDebuffs.find((d) => d.name.startsWith('Demoralizing'))?.uptime ?? 0;
  if (demo !== null && you.role === 'main' && demo >= 0.6 && yourDemo < demo - 0.25) {
    out.push({ severity: 'medium', tab: 'Mitigation', title: `Demoralizing ${you.className === 'Druid' ? 'Roar' : 'Shout'} on the boss ${pct(yourDemo)}, peers ${pct(demo)}`, detail: 'It lowers the boss’s attack power, so every hit on you is smaller (unless another warrior or druid keeps it up).' });
  }
  const tc = m(debuff('Thunder Clap'));
  const yourTc = debuff('Thunder Clap')(you);
  if (you.className === 'Warrior' && tc !== null && yourTc !== null && tc >= 0.5 && yourTc < tc - 0.25) {
    out.push({ severity: 'medium', tab: 'Mitigation', title: `Thunder Clap on the boss ${pct(yourTc)}, peers ${pct(tc)}`, detail: 'Thunder Clap slows the boss’s attacks: fewer swings on you.' });
  }
  // Near-deaths without a cooldown.
  if (you.nearDeaths >= 2 && !you.cooldowns.length) {
    out.push({ severity: 'low', tab: 'Cooldowns', title: `Under 20% health ${you.nearDeaths} times without a defensive cooldown`, detail: 'Shield Wall, Last Stand, Barkskin, Frenzied Regeneration, a healthstone or a potion before the big hits gives the healers time.' });
  }
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** What the tank sims need later (sim/tank.ts): who to sim, and the boss's melee. */
export interface TankSimInput {
  className: string;
  players: { report: string; fight: number; name: string; server?: string; region?: string; you?: boolean; metrics: TankMetrics; durationSec: number }[];
  /** From the tank in your raid who took the most of the boss's swings. */
  boss?: TankBossMelee & { from: string };
}

export interface StoredTank {
  analysis: TankAnalysis;
  simInput: TankSimInput;
}

export async function analyzeTank(client: WclReader, report: string, fightId: number, source: number, log: (msg: string) => void = () => {}): Promise<StoredTank> {
  const fights = await client.fights(report);
  const data = await fetchTankFight(client, report, fightId, source, fights);
  const spec = tankSpecIn(data);
  if (!spec) {
    throw new Error(`${data.tank.name} (${data.tank.icon.replace('-', ' ')}) isn't tanking on this kill.`);
  }
  const model = new FightModel(data.raid);
  const you = tankMetrics(data, model, spec);
  const warnings: string[] = [];
  if (!model.data.fight.kill) warnings.push('This fight was a wipe; peers are compared on kills, so expect differences.');

  log(`Finding ${spec.label}s in well-run raids like yours`);
  const tankCount = model.tanks.filter((t) => !!tankSpecFor(model.icon(t))).length || 1;
  const { group, fights: peerFights } = await findTankPeers(
    client,
    { encounterId: model.data.fight.boss, spec, role: you.role === 'adds' ? 'off' : you.role, swingShare: you.swingShare, tanks: tankCount, durationSec: model.durationSec, report },
    log,
  );
  const peers: TankAnalysis['peers'] = [];
  for (const p of group.peers) {
    const d = peerFights.get(`${p.report}:${p.name}`);
    const ps = d && tankSpecIn(d);
    if (!d || !ps) {
      warnings.push(`Skipped ${p.name}: not found as a tank in their log`);
      continue;
    }
    const pm = new FightModel(d.raid);
    peers.push({ ...tankMetrics(d, pm, ps), peer: p, durationSec: pm.durationSec });
  }
  const raidTanks = model.tanks
    .filter((t) => t !== source && tankSpecFor(model.icon(t)))
    .map((t) => {
      const swings = model.damage.filter((e) => e.ability?.name === 'Melee' && e.targetID !== undefined && model.players.has(e.targetID) && data.enemies.some((x) => x.boss && x.id === e.sourceID));
      const share = swings.length ? swings.filter((e) => e.targetID === t).length / swings.length : 0;
      return { name: model.name(t), icon: model.icon(t), role: (share >= 0.4 ? 'main' : 'off') as TankAnalysis['raidTanks'][number]['role'], swingShare: share };
    });

  // The boss's melee for the sims: whichever tank in your raid took the most of its swings.
  const bossIds = new Set(data.enemies.filter((e) => e.boss).map((e) => e.id));
  let boss: TankSimInput['boss'];
  for (const t of new Set([source, ...model.tanks])) {
    const swings = model.damage.filter((e) => e.targetID === t && e.ability?.name === 'Melee' && e.sourceID !== undefined && bossIds.has(e.sourceID));
    const b = bossMeleeOf(swings);
    if (b && (!boss || b.swings > boss.swings)) boss = { ...b, from: model.name(t) };
  }
  const judgedPeers = peers.length >= MIN_PEERS ? peers : [];
  const verdict = you.role === 'off' ? undefined : openerVerdict(you, judgedPeers, spec);

  const analysis: TankAnalysis = {
    kind: 'tank',
    id: globalThis.crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    startTime: (fights.start ?? 0) + model.data.fight.start_time,
    report,
    fight: fightId,
    encounter: { id: model.data.fight.boss, name: model.data.fight.name },
    durationSec: model.durationSec,
    kill: !!model.data.fight.kill,
    you,
    peers,
    group,
    judged: judgedRows(you, peers),
    context: contextRows(you, peers),
    // With too few peers, only the findings that don't compare with them.
    findings: tankFindings(you, judgedPeers, spec),
    ...(verdict ? { openerVerdict: verdict } : {}),
    raidTanks,
    warnings,
  };
  return {
    analysis,
    simInput: {
      className: spec.className,
      players: [
        { report, fight: fightId, name: you.name, you: true, metrics: you, durationSec: model.durationSec },
        ...peers.map((p) => ({ report: p.peer.report, fight: p.peer.fight, name: p.name, server: p.peer.server, region: p.peer.region, metrics: p as TankMetrics, durationSec: p.durationSec })),
      ],
      boss,
    },
  };
}
