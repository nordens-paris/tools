// Dev helper: prints a player's buffs, boss debuffs and what the sim environment picks up.
// Usage: npx tsx --env-file=.env scripts/show-env.ts <report> <fight> <source>
import { collectPlayerFight } from '../server/analysis/collect.ts';
import { environmentOf } from '../server/sim/request.ts';
import { specs } from '../server/specs/index.ts';

// SPEC=<spec key> picks the spec (default warrior-fury), e.g. SPEC=warlock-destruction.
const spec = specs.find((s) => s.key === (process.env.SPEC ?? 'warrior-fury'))!;
import { WclClient } from '../server/wcl/client.ts';

const [report, fight, source] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const raw = await collectPlayerFight(client, spec, report, Number(fight), Number(source));
const env = environmentOf(raw, spec);
console.log(`${raw.fight.name} (${raw.fight.race}) on ${raw.encounterName}`);
console.log('BUFFS', raw.fight.buffs.map((b) => `${b.name}#${b.id}(${b.uptimePct.toFixed(0)}%)`).join(', '));
console.log('DEBUFFS', raw.fight.bossDebuffs.map((b) => `${b.name}(${b.uptimePct.toFixed(0)}%)`).join(', '));
console.log('CONSUMES', raw.consumes.list.map((c) => c.name).join(', '), JSON.stringify(raw.consumes.flags));
console.log('SIM ENV', env.detected.join(', '));
console.log('EXECUTE PHASE', raw.executeProportion);
