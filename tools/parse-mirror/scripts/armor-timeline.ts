// The first physical hits of a fight with the boss's armor each one shows, next to when armor
// debuffs (Sunder, Expose Armor, Faerie Fire, Curse of Recklessness...) went up and down on the
// boss: tells the boss's own armor and what each debuff takes off.
// Usage: npx tsx --env-file=.env scripts/armor-timeline.ts <report> <fight> [seconds=30]
import { WclClient } from '../server/wcl/client.ts';

const [report, fightArg, secondsArg] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const fights = await client.fights(report);
const fight = fights.fights.find((f) => f.id === Number(fightArg))!;
const end = fight.start_time + Number(secondsArg ?? 30) * 1000;
const boss = fights.enemies?.find((x) => x.type === 'Boss' && x.fights.some((f) => f.id === fight.id))!;
const K = 467.5 * 70 - 22167.5;
type Ev = { timestamp: number; type: string; sourceID: number; targetID: number; hitType?: number; amount?: number; mitigated?: number; unmitigatedAmount?: number; stack?: number; ability: { name: string; type: number; guid: number } };
const list = (r: unknown) => r as Ev[];
const hits = list(await client.events('damage-done', report, fight.start_time, end, { hostility: 0 })).filter(
  (e) => e.type === 'damage' && e.targetID === boss.id && e.hitType === 1 && e.ability.type === 1 && e.unmitigatedAmount && e.amount,
);
const debuffs = list(await client.events('debuffs', report, fight.start_time, end, { hostility: 1 })).filter(
  (e) => e.targetID === boss.id && /sunder|expose|faerie|recklessness|annihilat|armor|crush/i.test(e.ability.name),
);
const name = (id: number) => fights.friendlies.find((a) => a.id === id)?.name ?? `#${id}`;
const rows = [
  ...hits.map((e) => ({ t: e.timestamp, text: `hit   ${name(e.sourceID).padEnd(14)} ${e.ability.name.padEnd(18)} armor ${(((e.mitigated ?? 0) / e.unmitigatedAmount!) * K / (1 - (e.mitigated ?? 0) / e.unmitigatedAmount!)).toFixed(0)}` })),
  ...debuffs.map((e) => ({ t: e.timestamp, text: `${e.type.padEnd(22)} ${e.ability.name} (${e.ability.guid})${e.stack ? ` x${e.stack}` : ''} by ${name(e.sourceID)}` })),
].sort((a, b) => a.t - b.t);
for (const r of rows) console.log(`${((r.t - fight.start_time) / 1000).toFixed(2).padStart(6)}  ${r.text}`);
