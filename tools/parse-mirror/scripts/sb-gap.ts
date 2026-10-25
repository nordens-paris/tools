// Dev helper: Shadow Bolt caster-side damage (before target debuffs) in the log vs one debug sim
// iteration, per warlock. Separates "the sim has less spell power" from "the sim has fewer debuffs".
// Usage: npx tsx --env-file=.env scripts/sb-gap.ts <report> <fight> <source>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { analyze } from '../server/analysis/analyze.ts';
import { buildRequest, encounterOf, environmentOf, setupFromRaw } from '../server/sim/request.ts';
import { WclClient } from '../server/wcl/client.ts';

const [report, fight, source] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const s = await analyze(client, report, Number(fight), Number(source));
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
for (const raw of [s.you, ...s.top]) {
  if (!raw.combatant) continue;
  const f = raw.fight;
  const fights = await client.fights(f.report);
  const fi = fights.fights.find((x) => x.id === f.fight)!;
  const ev = await client.events('damage-done', f.report, fi.start_time, fi.end_time, { sourceid: f.source, abilityid: 27209 });
  const hits = ev.filter((e) => e.type === 'damage' && !e.tick && typeof e.unmitigatedAmount === 'number' && e.unmitigatedAmount > 0);
  const realCaster = avg(hits.map((e) => e.unmitigatedAmount as number));
  const realTarget = avg(hits.filter((e) => !e.resisted).map((e) => (e.amount as number) / (e.unmitigatedAmount as number) / (e.hitType === 2 ? 2 : 1)));
  const env = environmentOf(raw, s.spec);
  const req = buildRequest({ spec: s.spec, player: setupFromRaw(raw, s.spec), env, durationSec: f.durationSec, encounter: encounterOf(raw), iterations: 1 }) as any;
  req.simOptions = { ...req.simOptions, iterations: 1, debug: true, debugFirstIteration: true };
  fs.writeFileSync('.cache/sbgap.json', JSON.stringify(req));
  try { execFileSync(process.env.WOWSIMS_CLI!, ['sim', '--infile', '.cache/sbgap.json', '--outfile', '.cache/sbgap-out.json']); } catch {}
  const logs: string = JSON.parse(fs.readFileSync('.cache/sbgap-out.json', 'utf8')).logs ?? '';
  const sb = [...logs.matchAll(/\{SpellID: 27209\} \[DEBUG\].*SP: ([\d.]+), BaseDamage:([\d.]+), AfterAttackerMods:([\d.]+), AfterResistances:([\d.]+), AfterTargetMods:([\d.]+)/g)];
  const simCaster = avg(sb.map((m) => Number(m[3])));
  const simTarget = avg(sb.map((m) => Number(m[5]) / Number(m[4])));
  const simSp = Math.min(...sb.map((m) => Number(m[1])));
  const mult = avg(sb.map((m) => Number(m[3]) / Number(m[2])));
  console.log(
    `${(f.rank ? '#' + f.rank : 'you').padEnd(4)} ${f.name.padEnd(12)} caster-side real ${realCaster.toFixed(0)} sim ${simCaster.toFixed(0)} (${((realCaster / simCaster - 1) * 100).toFixed(1)}%)` +
      ` | target mult real ${realTarget.toFixed(3)} sim ${simTarget.toFixed(3)} | sim base SP ${simSp.toFixed(0)}, attacker mult ${mult.toFixed(3)} | totems: ${env.detected.filter((d) => /Totem|Wrath/.test(d)).join(', ') || 'none'}`,
  );
}
