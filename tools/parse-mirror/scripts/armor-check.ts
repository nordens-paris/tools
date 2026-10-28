// Measures the boss's armor from a log: Warcraft Logs gives each physical hit's damage before armor
// (unmitigatedAmount) and how much armor took off (mitigated), so every normal hit tells the
// target's armor at that moment. Prints it per 10 s of the fight, next to the armor the sim assumes
// (the boss table minus the armor debuffs it gets from the log).
// Usage: npx tsx --env-file=.env scripts/armor-check.ts <report> <fight> <source>
import { collectPlayerFight } from '../server/analysis/collect.ts';
import { dpsSpecFor } from '../server/analysis/analyze.ts';
import { bossArmor, buildRequest, encounterOf, environmentOf, setupFromRaw } from '../server/sim/request.ts';
import { specForIcon } from '../server/specs/index.ts';
import { WclClient } from '../server/wcl/client.ts';

const [report, fightArg, sourceArg] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const fights = await client.fights(report);
const fight = fights.fights.find((f) => f.id === Number(fightArg))!;
const actor = fights.friendlies.find((a) => a.id === Number(sourceArg))!;
const spec = specForIcon(actor.icon) ?? (await dpsSpecFor(client, report, fight, actor))!;

// Armor reduction for a level 70 attacker: armor / (armor + 467.5 * 70 - 22167.5).
const K = 467.5 * 70 - 22167.5;
const armorOf = (reduction: number) => (reduction * K) / (1 - reduction);

type Ev = { timestamp: number; type: string; targetID: number; hitType?: number; amount?: number; mitigated?: number; unmitigatedAmount?: number; ability: { name: string; type: number } };
const res = await client.events('damage-done', report, fight.start_time, fight.end_time, { sourceid: actor.id });
const events = ((res as { events?: Ev[] }).events ?? (res as unknown as Ev[])).filter(
  // Normal physical hits on the boss: crits and glancing blows have their own multipliers.
  (e) => e.type === 'damage' && e.hitType === 1 && e.ability.type === 1 && e.unmitigatedAmount && e.amount,
);
const boss = fights.enemies?.find((x) => x.type === 'Boss' && x.fights.some((f) => f.id === fight.id))?.id;
const onBoss = events.filter((e) => boss === undefined || e.targetID === boss);
const buckets = new Map<number, number[]>();
for (const e of onBoss) {
  const reduction = (e.mitigated ?? 0) / e.unmitigatedAmount!;
  const b = Math.floor((e.timestamp - fight.start_time) / 10_000) * 10;
  buckets.set(b, [...(buckets.get(b) ?? []), armorOf(reduction)]);
}
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(`${actor.name} (${spec.key}) on ${fight.name}, ${onBoss.length} normal physical hits on the boss`);
for (const [t, xs] of [...buckets].sort((a, b) => a[0] - b[0])) console.log(`  ${String(t).padStart(3)}-${String(t + 10).padStart(3)} s  armor ${med(xs).toFixed(0).padStart(5)}  (${xs.length} hits, ${Math.min(...xs).toFixed(0)}-${Math.max(...xs).toFixed(0)})`);
const all = onBoss.map((e) => armorOf((e.mitigated ?? 0) / e.unmitigatedAmount!));
const raw = await collectPlayerFight(client, spec, report, fight.id, actor.id);
const env = environmentOf(raw, spec);
const req = buildRequest({ spec, player: setupFromRaw(raw, spec), env, durationSec: raw.fight.durationSec, encounter: encounterOf(raw), iterations: 1 }) as { raid: { debuffs: Record<string, unknown> } };
const armorDebuffs = Object.fromEntries(Object.entries(req.raid.debuffs).filter(([k]) => /sunder|expose|faerie|recklessness|annihilator|armor/i.test(k)));
console.log(`  whole fight: median ${med(all).toFixed(0)}, mean ${(all.reduce((s, x) => s + x, 0) / all.length).toFixed(0)}`);
console.log(`  sim: boss armor ${bossArmor(encounterOf(raw).id)}, armor debuffs ${JSON.stringify(armorDebuffs)}`);
