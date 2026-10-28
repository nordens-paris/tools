// Times one sim of a player's own setup with the command line tool, and counts the sim's events
// (casts and hits per second, the player's and their pets'), to find out why a spec sims slowly.
// Usage: npx tsx --env-file=.env scripts/sim-timing.ts <report> <fight> <source> [iterations]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { collectPlayerFight } from '../server/analysis/collect.ts';
import { dpsSpecFor } from '../server/analysis/analyze.ts';
import { buildRequest, encounterOf, environmentOf, setupFromRaw } from '../server/sim/request.ts';
import { specForIcon } from '../server/specs/index.ts';
import { WclClient } from '../server/wcl/client.ts';

const [report, fightArg, sourceArg, itersArg] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const fights = await client.fights(report);
const fight = fights.fights.find((f) => f.id === Number(fightArg))!;
const actor = fights.friendlies.find((a) => a.id === Number(sourceArg))!;
const spec = specForIcon(actor.icon) ?? (await dpsSpecFor(client, report, fight, actor))!;
const raw = await collectPlayerFight(client, spec, report, fight.id, actor.id);
const iterations = Number(itersArg ?? 500);
const req = buildRequest({ spec, player: setupFromRaw(raw, spec), env: environmentOf(raw, spec), durationSec: raw.fight.durationSec, encounter: encounterOf(raw), iterations });
fs.mkdirSync('.cache/sim', { recursive: true });
const infile = `.cache/sim/timing-${report}-${fight.id}-${actor.id}.in.json`;
const outfile = infile.replace('.in.', '.out.');
fs.writeFileSync(infile, JSON.stringify(req));
const t0 = performance.now();
execFileSync('bin/wowsimcli.exe', ['sim', '--infile', infile, '--outfile', outfile]);
const ms = performance.now() - t0;
const out = JSON.parse(fs.readFileSync(outfile, 'utf8'));
const player = out.raidMetrics.parties.flatMap((p: { players: unknown[] }) => p.players).find((p: { dps?: { avg: number } }) => p.dps?.avg);
type Action = { id: { spellId?: number; otherId?: string }; targets: { casts?: number; hits?: number; crits?: number; misses?: number; dodges?: number; glances?: number }[] };
const events = (actions: Action[]) =>
  actions.reduce((s, a) => s + a.targets.reduce((t, x) => t + (x.casts ?? 0) + (x.hits ?? 0) + (x.crits ?? 0) + (x.misses ?? 0) + (x.dodges ?? 0) + (x.glances ?? 0), 0), 0);
const own = events(player.actions);
const pets = (player.pets ?? []).reduce((s: number, p: { actions: Action[] }) => s + events(p.actions), 0);
const perSec = (n: number) => (n / raw.fight.durationSec).toFixed(1);
const targets = req.encounter?.targets?.length ?? 1;
console.log(
  `${actor.name} ${spec.key}: ${(ms / 1000).toFixed(1)} s for ${iterations} iterations (${(ms / iterations).toFixed(2)} ms each), ` +
    `${raw.fight.durationSec.toFixed(0)} s fight, ${targets} target(s), events/s own ${perSec(own)} pets ${perSec(pets)}, auras ${player.auras.length}, DPS ${player.dps.avg.toFixed(0)}`,
);
