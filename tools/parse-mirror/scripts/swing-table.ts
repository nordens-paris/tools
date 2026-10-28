// White-swing outcomes over a spec's top players, log vs each player's own sim: crit, glancing,
// miss, dodge and parry rates of melee auto attacks (Windfury Totem's extra attacks included).
// A gap the same for all players points at the attack table or a missing crit source.
// Usage: npx tsx --env-file=.env scripts/swing-table.ts <spec-key> <encounterId...> [--n=8]
import { collectTopPlayers, topCandidates } from '../server/analysis/analyze.ts';
import type { PlayerFightRaw } from '../server/analysis/collect.ts';
import { buildRequest, encounterOf, environmentOf, setupFromRaw } from '../server/sim/request.ts';
import { runSim } from '../server/sim/runner.ts';
import { CLI_PARALLEL, limited } from '../server/sim/scenarios.ts';
import { specs } from '../server/specs/index.ts';
import { WclClient } from '../server/wcl/client.ts';

const args = process.argv.slice(2);
const n = Number(args.find((a) => a.startsWith('--n='))?.split('=')[1] ?? 8);
const [key, ...encounters] = args.filter((a) => !a.startsWith('--'));
const spec = specs.find((s) => s.key === key)!;
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const sim = limited((raw: PlayerFightRaw) => runSim(process.env.WOWSIMS_CLI!, buildRequest({ spec, player: setupFromRaw(raw, spec), env: environmentOf(raw, spec), durationSec: raw.fight.durationSec, encounter: encounterOf(raw), iterations: 300 })), CLI_PARALLEL);

type Counts = { swings: number; crit: number; glance: number; miss: number; dodge: number; parry: number; hit: number };
const zero = (): Counts => ({ swings: 0, crit: 0, glance: 0, miss: 0, dodge: 0, parry: 0, hit: 0 });
const add = (a: Counts, b: Counts) => (Object.keys(a) as (keyof Counts)[]).forEach((k) => (a[k] += b[k]));
const log = zero();
const simmed = zero();
// WCL hit types: 0 miss, 1 hit, 2 crit, 6 glancing, 7 dodge, 8 parry.
const KIND: Record<number, keyof Counts> = { 0: 'miss', 1: 'hit', 2: 'crit', 6: 'glance', 7: 'dodge', 8: 'parry' };
type Ev = { type: string; hitType?: number; ability: { name: string } };

for (const encounterId of encounters.map(Number)) {
  const top = (await collectTopPlayers(client, spec, (await topCandidates(client, spec, encounterId)).candidates, n, undefined, [])).filter((t) => t.combatant);
  await Promise.all(
    top.map(async (raw) => {
      const f = (await client.fights(raw.fight.report)).fights.find((x) => x.id === raw.fight.fight)!;
      const res = await client.events('damage-done', raw.fight.report, f.start_time, f.end_time, { sourceid: raw.fight.source });
      const own = zero();
      for (const e of ((res as { events?: Ev[] }).events ?? (res as unknown as Ev[])).filter((e) => e.type === 'damage' && e.ability.name === 'Melee')) {
        const k = KIND[e.hitType ?? -1];
        if (!k) continue;
        own.swings++;
        own[k]++;
      }
      // Sim: the player's white-swing actions (main hand, off hand, Windfury Totem's extra attacks).
      const s = await sim(raw);
      const mine = zero();
      for (const a of s.player.actions.filter((a) => a.id.otherId === 'OtherActionAttack'))
        for (const t of a.targets) {
          const c = { crit: t.crits ?? 0, glance: t.glances ?? 0, miss: t.misses ?? 0, dodge: t.dodges ?? 0, parry: t.parries ?? 0, hit: t.hits ?? 0 }; // WoWSims' hits leave out crits and glancing blows
          mine.crit += c.crit;
          mine.glance += c.glance;
          mine.miss += c.miss;
          mine.dodge += c.dodge;
          mine.parry += c.parry;
          mine.hit += c.hit;
          mine.swings += c.crit + c.glance + c.miss + c.dodge + c.parry + c.hit;
        }
      add(log, own);
      add(simmed, mine);
      const p = (c: Counts, k: keyof Counts) => ((c[k] / c.swings) * 100).toFixed(1).padStart(5);
      console.log(`  ${raw.fight.name.slice(0, 16).padEnd(16)} log crit ${p(own, 'crit')} glance ${p(own, 'glance')} (${own.swings})   sim crit ${p(mine, 'crit')} glance ${p(mine, 'glance')}`);
    }),
  );
}
const p = (c: Counts, k: keyof Counts) => `${((c[k] / c.swings) * 100).toFixed(1)}%`;
for (const [label, c] of [['log', log], ['sim', simmed]] as const)
  console.log(`${spec.key} ${label}: ${c.swings} swings  hit ${p(c, 'hit')}  crit ${p(c, 'crit')}  glance ${p(c, 'glance')}  miss ${p(c, 'miss')}  dodge ${p(c, 'dodge')}  parry ${p(c, 'parry')}`);
