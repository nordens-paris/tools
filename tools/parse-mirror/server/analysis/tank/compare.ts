// A tank's kill next to their peers (see peers.ts), split into what's fair to judge (gear choices,
// mitigation, threat, cooldowns) and context that depends on the raid and the boss (damage taken,
// the size of the hits).
import crypto from 'node:crypto';

import type { HealerRow, TankAnalysis, TankFinding, TankMetrics } from '../../../shared/types.ts';
import { tankSpecFor } from '../../specs/tanks.ts';
import { supportedSpecs } from '../../specs/index.ts';
import type { WclClient } from '../../wcl/client.ts';
import { FightModel } from '../healer/model.ts';
import { median } from '../stats.ts';
import { fetchTankFight } from './data.ts';
import { tankMetrics, tankSpecIn } from './metrics.ts';
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

function tankFindings(you: TankMetrics, peers: TankMetrics[]): TankFinding[] {
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
  const op = m((t) => t.threat.opener[1]);
  if (op !== null && you.role !== 'off' && you.threat.opener[1] < op * 0.75) {
    out.push({ severity: 'medium', tab: 'Threat', title: `Opening threat ${Math.round(you.threat.opener[1])} TPS over 10 s, peers ${Math.round(op)}`, detail: 'The first seconds decide how hard the DPS can open. Pull with your biggest threat abilities, and use them before auto-attacks have built rage.' });
  }
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

export async function analyzeTank(client: WclClient, report: string, fightId: number, source: number, log: (msg: string) => void = () => {}): Promise<TankAnalysis> {
  const fights = await client.fights(report);
  const data = await fetchTankFight(client, report, fightId, source, fights);
  const spec = tankSpecIn(data);
  if (!spec) {
    throw new Error(`${data.tank.name} (${data.tank.icon.replace('-', ' ')}) isn't tanking on this kill. Supported: ${supportedSpecs.join(', ')}, healers and tanks.`);
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

  return {
    kind: 'tank',
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
    judged: judgedRows(you, peers),
    context: contextRows(you, peers),
    // With too few peers, only the findings that don't compare with them.
    findings: tankFindings(you, peers.length >= MIN_PEERS ? peers : []),
    raidTanks,
    warnings,
  };
}
