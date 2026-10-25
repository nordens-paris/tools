// Dev helper: unresisted non-crit Shadow Bolt hit sizes for a player, to compare with the sim.
import { WclClient } from '../server/wcl/client.ts';
const [report, fightId, source] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const fights = await client.fights(report);
const f = fights.fights.find((x) => x.id === Number(fightId))!;
const ev = await client.events('damage-done', report, f.start_time, f.end_time, { sourceid: Number(source), abilityid: 27209 });
const hits = ev.filter((e: any) => e.type === 'damage' && e.hitType === 1 && !e.resisted && !e.tick);
const amts = hits.map((e: any) => e.amount).sort((a: number, b: number) => a - b);
console.log('n', amts.length, 'min', amts[0], 'max', amts.at(-1), 'avg', (amts.reduce((s: number, v: number) => s + v, 0) / amts.length).toFixed(0));
console.log('sample', JSON.stringify(hits[0]));
const ci = (await client.combatantInfos(report, f.start_time, f.end_time)).find((c: any) => c.sourceID === Number(source));
console.log('stats', JSON.stringify((ci as any)?.stats ?? Object.keys(ci ?? {})));
console.log('auras', JSON.stringify((ci as any)?.auras?.map((a: any) => `${a.name}#${a.ability}`)));
// Target-side multiplier per hit (CoE, Shadow Weaving, Misery, ISB) and caster-side damage.
const all = ev.filter((e: any) => e.type === 'damage' && !e.tick && e.unmitigatedAmount > 0 && !e.resisted);
const ratios = all.map((e: any) => e.amount / e.unmitigatedAmount / (e.hitType === 2 ? 2 : 1));
const isb = ratios.filter((r: number) => r > 1.45).length;
console.log('hits', all.length, 'with ISB', isb, `(${((isb / all.length) * 100).toFixed(0)}%)`, 'ratios', [...new Set(ratios.map((r: number) => r.toFixed(3)))].slice(0, 12).join(' '));
const normals = all.filter((e: any) => e.hitType === 1);
console.log('caster-side normal avg', (normals.reduce((s: number, e: any) => s + e.unmitigatedAmount, 0) / normals.length).toFixed(0), 'min', Math.min(...normals.map((e: any) => e.unmitigatedAmount)), 'max', Math.max(...normals.map((e: any) => e.unmitigatedAmount)));
// Implied spell power per hit: caster-side damage = (base roll + 1.057 * SP) * 1.15 (Touch of Shadow).
for (const e of ev.filter((x: any) => x.type === 'damage' && !x.tick && x.unmitigatedAmount > 0) as any[]) {
  const sp = (e.unmitigatedAmount / 1.15 - 575.5) / 1.057;
  console.log(((e.timestamp - f.start_time) / 1000).toFixed(1).padStart(6), String(e.hitType).padStart(2), String(e.unmitigatedAmount).padStart(5), sp.toFixed(0).padStart(5), e.resisted ? 'R' : ' ', (e.buffs ?? '').replace(/\.$/, '').split('.').filter((b: string) => !['31035', '32999', '33263', '46838'].includes(b)).join(','));
}
