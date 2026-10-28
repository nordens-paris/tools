// White hits in a log vs the sim, for one player: swings per second, how they landed, attack
// power, and the damage of a swing before armor (log: unmitigatedAmount; sim: "AfterAttackerMods"
// in WoWSims' debug log), so a gap can be split into the swing itself, armor and outcomes. The sim
// side comes from a number of one-iteration debug runs with different seeds.
// Usage: npx tsx --env-file=.env scripts/white-hits.ts <report> <fight> <source> [runs=40]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { collectPlayerFight } from '../server/analysis/collect.ts';
import { dpsSpecFor } from '../server/analysis/analyze.ts';
import { buildRequest, encounterOf, environmentOf, setupFromRaw } from '../server/sim/request.ts';
import { specForIcon } from '../server/specs/index.ts';
import { WclClient } from '../server/wcl/client.ts';

const [report, fightArg, sourceArg, runsArg] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const fights = await client.fights(report);
const fight = fights.fights.find((f) => f.id === Number(fightArg))!;
const actor = fights.friendlies.find((a) => a.id === Number(sourceArg))!;
const spec = specForIcon(actor.icon) ?? (await dpsSpecFor(client, report, fight, actor))!;
const durationSec = (fight.end_time - fight.start_time) / 1000;
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const pct = (n: number, of: number) => `${((n / of) * 100).toFixed(1)}%`;

// WCL hit types: 1 hit, 2 crit, 6 glancing, 7 dodge, 8 parry, 0 miss. Windfury Totem's extra
// attacks are "Melee" too.
type Ev = { type: string; hitType?: number; amount?: number; unmitigatedAmount?: number; attackPower?: number; resourceActor?: number; ability: { name: string } };
const list = (r: unknown) => ((r as { events?: Ev[] }).events ?? (r as Ev[]));
const melee = list(await client.events('damage-done', report, fight.start_time, fight.end_time, { sourceid: actor.id })).filter((e) => e.type === 'damage' && e.ability.name === 'Melee');
const casts = list(await client.events('casts', report, fight.start_time, fight.end_time, { sourceid: actor.id })).filter((e) => e.resourceActor === 1 && e.attackPower);
const logOutcomes = (t: number) => melee.filter((e) => e.hitType === t).length;
const logPre = avg(melee.filter((e) => (e.hitType === 1 || e.hitType === 2) && e.unmitigatedAmount).map((e) => e.unmitigatedAmount!));

const raw = await collectPlayerFight(client, spec, report, fight.id, actor.id);
const req = buildRequest({ spec, player: setupFromRaw(raw, spec), env: environmentOf(raw, spec), durationSec: raw.fight.durationSec, encounter: encounterOf(raw), iterations: 1 }) as Record<string, any>;
const runs = Number(runsArg ?? 40);
const outcomes: Record<string, number> = {};
const pre: number[] = [];
const ap: number[] = [];
let swings = 0;
fs.mkdirSync('.cache/sim', { recursive: true });
for (let seed = 1; seed <= runs; seed++) {
  req.simOptions = { iterations: 1, randomSeed: seed, debug: true, debugFirstIteration: true };
  fs.writeFileSync('.cache/sim/white.in.json', JSON.stringify(req));
  execFileSync('bin/wowsimcli.exe', ['sim', '--infile', '.cache/sim/white.in.json', '--outfile', '.cache/sim/white.out.json'], { stdio: 'ignore' });
  const logs: string = JSON.parse(fs.readFileSync('.cache/sim/white.out.json', 'utf8')).logs;
  // Main-hand white swings are OtherID 3 with tag 1, Windfury Totem's extra attacks tag 25584.
  for (const line of logs.split('\n')) {
    if (!line.startsWith('[') || !line.includes(`[${actor.name} (#1)] [Target 1] {OtherID: 3, Tag: `)) continue;
    const dbg = line.match(/\[DEBUG\] MAP: ([\d.]+).*AfterAttackerMods:([\d.]+)/);
    if (dbg) {
      ap.push(Number(dbg[1]));
      pre.push(Number(dbg[2]));
      continue;
    }
    const m = line.match(/\} (Hit|Crit|Glance|Miss|Dodge|Parry|Block)/);
    if (m) {
      swings++;
      outcomes[m[1]] = (outcomes[m[1]] ?? 0) + 1;
    }
  }
}
const simSec = runs * raw.fight.durationSec;
console.log(`${actor.name} (${spec.key}), ${durationSec.toFixed(0)} s kill; sim ${runs} runs`);
console.log(`  white swings/s           log ${(melee.length / durationSec).toFixed(2)}   sim ${(swings / simSec).toFixed(2)}`);
console.log(`  log  hit ${pct(logOutcomes(1), melee.length)} crit ${pct(logOutcomes(2), melee.length)} glance ${pct(logOutcomes(6), melee.length)} miss ${pct(logOutcomes(0), melee.length)} dodge ${pct(logOutcomes(7), melee.length)} parry ${pct(logOutcomes(8), melee.length)}`);
const o = (k: string) => pct(outcomes[k] ?? 0, swings);
console.log(`  sim  hit ${o('Hit')} crit ${o('Crit')} glance ${o('Glance')} miss ${o('Miss')} dodge ${o('Dodge')} parry ${o('Parry')}`);
console.log(`  attack power             log ${avg(casts.map((e) => e.attackPower!)).toFixed(0)} (${casts.length} casts)   sim ${avg(ap).toFixed(0)}`);
console.log(`  swing before armor       log ${logPre.toFixed(0)}   sim ${avg(pre).toFixed(0)}   log/sim ${(logPre / avg(pre)).toFixed(3)}`);
