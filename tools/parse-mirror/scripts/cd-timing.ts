// Debug: when top players use a cooldown, as a fraction of the fight (0 = pull, 1 = kill).
// Usage: npx tsx --env-file=.env scripts/cd-timing.ts <cooldown name> <encounterIds...>
import { collectTopPlayers, topCandidates } from '../server/analysis/analyze.ts';
import { specs } from '../server/specs/index.ts';
import { WclClient } from '../server/wcl/client.ts';

const spec = specs.find((s) => s.key === (process.env.SPEC ?? 'warrior-fury'))!;
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const [name, ...encounters] = process.argv.slice(2);
const buckets = [0, 0, 0, 0, 0];
let players = 0;
let unused = 0;
for (const enc of encounters) {
  for (const raw of await collectTopPlayers(client, spec, (await topCandidates(client, spec, Number(enc))).candidates, 10, undefined, [])) {
    players++;
    const times = raw.fight.cooldowns.find((c) => c.name === name)?.times ?? [];
    if (!times.length) unused++;
    for (const t of times) buckets[Math.min(4, Math.floor((t / raw.fight.durationSec) * 5))]++;
  }
}
console.log(`${name}: ${players} players, ${unused} never used it`);
buckets.forEach((n, i) => console.log(`  ${i * 20}-${i * 20 + 20}% of fight: ${n}`));
