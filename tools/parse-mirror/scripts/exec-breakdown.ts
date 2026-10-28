// Dev helper: where does each player's real DPS differ from their own sim? Splits the gap per
// ability into casts, damage per landed hit, crit rate and avoids, and compares aura uptimes.
// Usage: npx tsx --env-file=.env scripts/exec-breakdown.ts <report> <fight> <source> [iterations]
import { analyze } from '../server/analysis/analyze.ts';
import type { PlayerFightRaw } from '../server/analysis/collect.ts';
import { spellName } from '../server/data/db.ts';
import { buildRequest, encounterOf, environmentOf, setupFromRaw } from '../server/sim/request.ts';
import { computeLuck } from '../server/sim/luck.ts';
import { runSim, type SimPlayerMetrics } from '../server/sim/runner.ts';
import { WclClient } from '../server/wcl/client.ts';

const [report, fight, source, iters] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const stored = await analyze(client, report, Number(fight), Number(source));
const { spec } = stored;

interface Row { casts: number; landed: number; hits: number; crits: number; avoided: number; damage: number; critDamage: number; normalDamage: number }
function simRows(p: SimPlayerMetrics, iterations: number): Map<string, Row> {
  const out = new Map<string, Row>();
  // Pets' abilities are "Pet: <name>", as in the log (see collect.ts); the ranged auto attack is Auto Shot.
  const actions = [...p.actions.map((a) => ({ a, prefix: '' })), ...(p.pets ?? []).flatMap((pet) => pet.actions.map((a) => ({ a, prefix: 'Pet: ' })))];
  for (const { a, prefix } of actions) {
    const white = a.id.otherId === 'OtherActionAttack';
    // Windfury Totem's extra swings are plain "Melee" in the log.
    const base = white ? 'Melee' : a.id.otherId === 'OtherActionShoot' ? 'Auto Shot' : spellName(a.id.spellId ?? a.id.itemId ?? -1, `#${a.id.spellId ?? a.id.itemId ?? a.id.otherId}`);
    if (prefix && !white && base.startsWith('#')) continue;
    const name = prefix + base;
    const r = out.get(name) ?? { casts: 0, landed: 0, hits: 0, crits: 0, avoided: 0, damage: 0, critDamage: 0, normalDamage: 0 };
    for (const t of a.targets) {
      // Metrics are summed over all iterations.
      r.casts += (t.casts ?? 0) / iterations;
      r.landed += ((t.hits ?? 0) + (t.crits ?? 0) + (t.glances ?? 0)) / iterations;
      r.crits += (t.crits ?? 0) / iterations;
      r.avoided += ((t.misses ?? 0) + (t.dodges ?? 0) + (t.parries ?? 0)) / iterations;
      r.damage += (t.damage ?? 0) / iterations;
      const m = t as typeof t & { critDamage?: number; glanceDamage?: number };
      r.hits += (t.hits ?? 0) / iterations;
      r.critDamage += (m.critDamage ?? 0) / iterations;
      r.normalDamage += ((t.damage ?? 0) - (t.tickDamage ?? 0) - (m.critDamage ?? 0) - (m.glanceDamage ?? 0)) / iterations;
    }
    out.set(name, r);
  }
  return out;
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const players: PlayerFightRaw[] = [stored.you, ...stored.top];
const summary: string[] = [];
for (const raw of players) {
  if (!raw.combatant) continue;
  const f = raw.fight;
  const env = environmentOf(raw, spec);
  const iterations = Number(iters ?? 2000);
  const res = await runSim(
    process.env.WOWSIMS_CLI!,
    buildRequest({ spec, player: setupFromRaw(raw, spec), env, durationSec: f.durationSec, encounter: encounterOf(raw), iterations }),
  );
  const luck = computeLuck(raw, res.player).summary;
  const sim = simRows(res.player, iterations);
  const dur = f.durationSec;
  console.log(`\n=== ${f.rank ? '#' + f.rank : 'you'} ${f.name}  ${dur.toFixed(0)}s  real ${f.simComparableDps.toFixed(0)}  sim ${res.avg.toFixed(0)}  exec ${((f.simComparableDps / res.avg) * 100).toFixed(1)}%  luck ${luck.luckDps.toFixed(0)}`);
  console.log(`   race ${f.race} talents ${f.talents} buffs: ${env.detected.join(', ')}`);
  console.log('   ability            dps real/sim     casts/min r/s   normal   crit    crit% r/s       avoid r/s');
  const names = new Set([...raw.outcomes.map((o) => o.name), ...sim.keys()]);
  const rows: [string, number, string][] = [];
  for (const name of names) {
    const outs = raw.outcomes.filter((o) => o.name === name);
    const real = outs.reduce((s, o) => ({ total: s.total + o.total, landed: s.landed + o.landed, crits: s.crits + o.crits, avoided: s.avoided + o.avoided }), { total: 0, landed: 0, crits: 0, avoided: 0 });
    const s = sim.get(name);
    const realCasts = f.casts.find((c) => c.name === name)?.casts ?? 0;
    const rd = real.total / dur;
    const sd = (s?.damage ?? 0) / dur;
    if (rd < 20 && sd < 20) continue;
    const perHit = (d: number, l: number) => (l ? d / l : 0);
    const realNormal = outs.length ? outs.reduce((x, o) => x + o.normalAvg * Math.max(0, o.landed - o.crits), 0) / Math.max(1, outs.reduce((x, o) => x + Math.max(0, o.landed - o.crits), 0)) : 0;
    const realCritAvg = outs.length ? outs.reduce((x, o) => x + o.critAvg * o.crits, 0) / Math.max(1, real.crits) : 0;
    const hitRatio = s && s.hits ? realNormal / (s.normalDamage / s.hits) - 1 : 0;
    const critRatio = s && s.crits ? realCritAvg / (s.critDamage / s.crits) - 1 : 0;
    const realCrit = real.landed ? (real.crits / real.landed) * 100 : 0;
    const simCrit = s && s.landed ? (s.crits / s.landed) * 100 : 0;
    const realAvoid = real.landed + real.avoided ? (real.avoided / (real.landed + real.avoided)) * 100 : 0;
    const simAvoid = s && s.landed + s.avoided ? (s.avoided / (s.landed + s.avoided)) * 100 : 0;
    const simCasts = s ? s.casts : 0;
    const head = `   ${name.slice(0, 18).padEnd(18)} ${rd.toFixed(0).padStart(5)}/${sd.toFixed(0).padEnd(5)} (${rd - sd >= 0 ? '+' : ''}${(rd - sd).toFixed(0)})`;
    rows.push([name, rd - sd,
      head.padEnd(46) +
      `${((realCasts / dur) * 60).toFixed(1).padStart(5)}/${((simCasts / dur) * 60).toFixed(1).padEnd(5)}  ` +
      `${pct(hitRatio).padStart(7)} ${pct(critRatio).padStart(7)}  ${realCrit.toFixed(1).padStart(4)}/${simCrit.toFixed(1).padEnd(6)} ${realAvoid.toFixed(1).padStart(4)}/${simAvoid.toFixed(1)}`]);
  }
  rows.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  for (const r of rows.slice(0, 10)) console.log(r[2]);
  // Aura uptimes the sim tracks vs the log.
  const auras: string[] = [];
  for (const a of res.player.auras) {
    const id = a.id.spellId ?? a.id.itemId;
    if (!id || !a.uptimeSecondsAvg) continue;
    const name = spellName(id, '');
    const logged = f.buffs.find((b) => b.id === id || (name && b.name === name));
    if (!logged) continue;
    const simUp = (a.uptimeSecondsAvg / dur) * 100;
    if (Math.abs(simUp - logged.uptimePct) >= 3) auras.push(`${name || id} ${logged.uptimePct.toFixed(0)}/${simUp.toFixed(0)}`);
  }
  console.log(`   auras real/sim (≥3 pt diff): ${auras.join(', ') || '-'}`);
  summary.push(`${(f.rank ? '#' + f.rank : 'you').padEnd(4)} ${f.name.padEnd(14)} exec ${((f.simComparableDps / res.avg) * 100).toFixed(1)}  minus luck ${(((f.simComparableDps - luck.luckDps) / res.avg) * 100).toFixed(1)}`);
}
console.log('\n' + summary.join('\n'));
void pct;
