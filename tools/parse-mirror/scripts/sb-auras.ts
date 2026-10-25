// Dev helper: auras the sim gives a player at the start of a debug iteration.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { analyze } from '../server/analysis/analyze.ts';
import { buildRequest, encounterOf, environmentOf, setupFromRaw } from '../server/sim/request.ts';
import { WclClient } from '../server/wcl/client.ts';
const [report, fight, source, ...names] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const s = await analyze(client, report, Number(fight), Number(source));
for (const raw of [s.you, ...s.top].filter((r) => names.includes(r.fight.name))) {
  const req = buildRequest({ spec: s.spec, player: setupFromRaw(raw, s.spec), env: environmentOf(raw, s.spec), durationSec: raw.fight.durationSec, encounter: encounterOf(raw), iterations: 1 }) as any;
  req.simOptions = { iterations: 1, debug: true, debugFirstIteration: true, randomSeed: 1 };
  fs.writeFileSync('.cache/sba.json', JSON.stringify(req));
  try { execFileSync(process.env.WOWSIMS_CLI!, ['sim', '--infile', '.cache/sba.json', '--outfile', '.cache/sba-out.json'], { stdio: 'ignore' }); } catch {}
  const logs: string = JSON.parse(fs.readFileSync('.cache/sba-out.json', 'utf8')).logs ?? '';
  console.log('==', raw.fight.name, JSON.stringify(req.raid.parties[0].players[0].warlock ?? req.raid.parties[0].players[0].destructionWarlock));
  console.log(logs.split('\n').filter((l) => l.startsWith('[0.00]') || l.startsWith('[-')).filter((l) => /Aura gained|Multiplier|multiplier/.test(l)).slice(0, 60).join('\n'));
}
