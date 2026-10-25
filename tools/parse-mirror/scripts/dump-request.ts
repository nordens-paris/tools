// Dumps the sim request for one player fight (for debugging the sim).
// Usage: npx tsx --env-file=.env scripts/dump-request.ts <spec> <report> <fight> <source> <outfile.json>
import fs from 'node:fs';
import { collectPlayerFight } from '../server/analysis/collect.ts';
import { buildRequest, encounterOf, environmentOf, setupFromRaw } from '../server/sim/request.ts';
import { specs } from '../server/specs/index.ts';
import { WclClient } from '../server/wcl/client.ts';
const [specKey, report, fight, source, out] = process.argv.slice(2);
const spec = specs.find((s) => s.key === specKey)!;
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const raw = await collectPlayerFight(client, spec, report, Number(fight), Number(source));
const req = buildRequest({ spec, player: setupFromRaw(raw, spec), env: environmentOf(raw, spec), durationSec: raw.fight.durationSec, encounter: encounterOf(raw), iterations: 1 });
fs.writeFileSync(out, JSON.stringify(req, null, 1));
fs.writeFileSync(out.replace('.json', '.raw.json'), JSON.stringify({ combatant: raw.combatant, outcomes: raw.outcomes, buffs: raw.fight.buffs, talents: raw.fight.talents }, null, 1));
