// What a Retribution paladin's seal procs came from in a log: each Seal of Blood / Seal of the
// Martyr / Seal of Command hit matched to the player's attack in the same moment (white swing,
// Crusader Strike, Windfury Totem attack, the other seal's proc...). Shows what the seals proc
// from in the game, to check against WoWSims.
// Usage: npx tsx --env-file=.env scripts/seal-procs.ts <report> <fight> <source>...
import { WclClient } from '../server/wcl/client.ts';

const [report, fightArg, ...sources] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const fight = (await client.fights(report)).fights.find((f) => f.id === Number(fightArg))!;
const SEALS = ['Seal of Blood', 'Seal of the Martyr', 'Seal of Command'];
type Ev = { timestamp: number; type: string; hitType?: number; amount?: number; ability: { name: string } };
const total = new Map<string, number>();
for (const source of sources) {
  const res = await client.events('damage-done', report, fight.start_time, fight.end_time, { sourceid: Number(source) });
  const events = ((res as { events?: Ev[] }).events ?? (res as unknown as Ev[])).filter((e) => e.type === 'damage');
  const attacks = events.filter((e) => !SEALS.includes(e.ability.name) && e.hitType !== undefined && [1, 2, 6].includes(e.hitType));
  for (const seal of events.filter((e) => SEALS.includes(e.ability.name))) {
    // The attack it came from lands in the same moment or up to 100 ms before (seal procs come a batch later).
    const from = attacks.filter((a) => a.timestamp <= seal.timestamp && seal.timestamp - a.timestamp <= 100).map((a) => a.ability.name);
    const key = `${seal.ability.name} <- ${[...new Set(from)].sort().join(' + ') || 'nothing'}`;
    total.set(key, (total.get(key) ?? 0) + 1);
  }
  // Landed attacks without a Seal of Blood/Martyr proc.
  for (const a of attacks) {
    const procs = events.filter((s) => SEALS.slice(0, 2).includes(s.ability.name) && s.timestamp >= a.timestamp && s.timestamp - a.timestamp <= 100);
    if (!procs.length) total.set(`(no Blood proc) ${a.ability.name}`, (total.get(`(no Blood proc) ${a.ability.name}`) ?? 0) + 1);
  }
}
for (const [k, v] of [...total].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(5), k);
