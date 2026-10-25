// Lists buffs (on the player) and debuffs (on the boss) seen on top players that the sim setup
// does NOT turn into a setting or consumable, most common first. Anything DPS-relevant here is
// a gap in what we tell the sim.
//
// Usage: SPEC=warlock-destruction npx tsx --env-file=.env scripts/audit-auras.ts <encounterId...>
import { collectTopPlayers, topCandidates } from '../server/analysis/analyze.ts';
import { detectConsumes } from '../server/data/consumes.ts';
import { HANDLED_AURA_NAMES } from '../server/sim/environment.ts';
import { specs } from '../server/specs/index.ts';
import { WclClient } from '../server/wcl/client.ts';

const spec = specs.find((s) => s.key === (process.env.SPEC ?? 'warrior-fury'))!;
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);

type Row = { players: number; uptime: number; ids: Set<number> };
const buffs = new Map<string, Row>();
const debuffs = new Map<string, Row>();
let players = 0;

const add = (map: Map<string, Row>, name: string, id: number, uptime: number) => {
  const r = map.get(name) ?? { players: 0, uptime: 0, ids: new Set<number>() };
  r.players++;
  r.uptime += uptime;
  r.ids.add(id);
  map.set(name, r);
};

for (const encounterId of process.argv.slice(2).map(Number)) {
  const top = await collectTopPlayers(client, spec, (await topCandidates(client, spec, encounterId)).candidates, 10, undefined, []);
  for (const raw of top) {
    players++;
    for (const b of raw.fight.buffs) {
      if (HANDLED_AURA_NAMES.has(b.name) || spec.uptimes.includes(b.name)) continue;
      // Consumable buffs (flasks, food, scrolls, potions...) are handled by the consumes mapping.
      if (detectConsumes({ buffs: [{ id: b.id, name: b.name }], casts: [] }).list.length) continue;
      add(buffs, b.name, b.id, b.uptimePct);
    }
    for (const d of raw.fight.bossDebuffs) {
      if (HANDLED_AURA_NAMES.has(d.name) || d.uptimePct < 20) continue;
      add(debuffs, d.name, d.id, d.uptimePct);
    }
  }
}

const print = (title: string, map: Map<string, Row>) => {
  console.log(`\n${title} (not mapped to the sim), seen on N of ${players} players:`);
  for (const [name, r] of [...map].sort((a, b) => b[1].players - a[1].players).slice(0, 60)) {
    console.log(`  ${String(r.players).padStart(3)}  ${name.padEnd(38)} avg uptime ${(r.uptime / r.players).toFixed(0).padStart(3)}%  ids ${[...r.ids].join(',')}`);
  }
};
print('Buffs on the player', buffs);
print('Debuffs on the boss (>=20% uptime)', debuffs);
