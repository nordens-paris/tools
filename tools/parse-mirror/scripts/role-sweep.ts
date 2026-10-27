// Dev helper: healer and tank metrics for every healer and tank on every boss kill of the reports,
// checked for NaN/Infinity, crashes and values out of range. Usage:
//   npx tsx --env-file=.env scripts/role-sweep.ts <report> [...]
import { FightModel } from '../server/analysis/healer/model.ts';
import { healerFightSummary } from '../server/analysis/healer/metrics.ts';
import { fetchTankFight } from '../server/analysis/tank/data.ts';
import { tankMetrics, tankSpecIn } from '../server/analysis/tank/metrics.ts';
import { TANK_ICONS } from '../server/specs/tanks.ts';
import { WclClient } from '../server/wcl/client.ts';

const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const bad: string[] = [];
function walk(v: unknown, path: string, where: string) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) bad.push(`${where} ${path} = ${v}`);
  } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, where));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, where);
}
// Values that must stay in range; anything else is a bug.
const check = (cond: boolean, msg: string) => cond || bad.push(msg);
for (const report of process.argv.slice(2)) {
  const fl = await client.fights(report);
  for (const f of fl.fights.filter((x) => x.boss && x.kill)) {
    const where = `${report}:${f.id} ${f.name}`;
    try {
      const first = fl.friendlies.find((a) => a.type !== 'Pet' && a.fights.some((x) => x.id === f.id))!;
      const d0 = await fetchTankFight(client, report, f.id, first.id, fl);
      const m = new FightModel(d0.raid);
      const hs = healerFightSummary(m);
      walk(hs, '', where);
      for (const h of hs.healers) {
        check(h.activity <= 1 && h.activity >= 0, `${where} ${h.name} activity ${h.activity}`);
        check(h.overhealPct >= 0 && h.overhealPct < 1, `${where} ${h.name} overheal ${h.overhealPct}`);
        check(!h.mana || (h.mana.end >= 0 && h.mana.end <= 1.01), `${where} ${h.name} mana end ${h.mana?.end}`);
        check(h.idleWhileNeeded.sec <= h.idleWhileNeeded.ofSec + 0.01, `${where} ${h.name} idle ${h.idleWhileNeeded.sec}/${h.idleWhileNeeded.ofSec}`);
      }
      const ids = [...new Set([...m.tanks, ...[...m.players.values()].filter((p) => TANK_ICONS.has(m.icon(p.id))).map((p) => p.id)])];
      const tanks: string[] = [];
      for (const id of ids) {
        const d = await fetchTankFight(client, report, f.id, id, fl);
        const spec = tankSpecIn(d);
        if (!spec) continue;
        const t = tankMetrics(d, m, spec);
        walk(t, '', `${where} ${t.name}`);
        const o = t.opener;
        check(o.avoided <= o.attacks && o.crits <= o.landed, `${where} ${t.name} opener counts ${o.avoided}/${o.attacks} ${o.crits}/${o.landed}`);
        check(o.gcds <= o.possibleGcds + 1, `${where} ${t.name} gcds ${o.gcds}/${o.possibleGcds}`);
        check(t.swings.avoided >= 0 && t.swings.avoided <= 1, `${where} ${t.name} avoided ${t.swings.avoided}`);
        check(t.survivability.armorReduction > 0 && t.survivability.armorReduction <= 0.75, `${where} ${t.name} armor dr ${t.survivability.armorReduction}`);
        check(t.tankAuraUptime <= 1, `${where} ${t.name} aura ${t.tankAuraUptime}`);
        tanks.push(`${t.name}(${t.role} ${Math.round(t.swingShare * 100)}% start ${o.startSec?.toFixed(1)} luck ${Math.round(o.luckThreat / 10)} boss ${t.bossMelee ? t.bossMelee.swingGapSec.toFixed(2) + (t.bossMelee.dualWield ? 'dw' : '') : '-'})`);
      }
      console.log(`${where.padEnd(48)} ${f.end_time - f.start_time > 0 ? Math.round((f.end_time - f.start_time) / 1000) + 's' : ''} healers ${hs.healers.length} | ${tanks.join(' ')}`);
    } catch (err) {
      bad.push(`${where} CRASH ${(err as Error).stack?.split('\n').slice(0, 3).join(' ')}`);
    }
  }
}
console.log(`\n${bad.length} problems`);
for (const b of bad.slice(0, 60)) console.log('  ' + b);
console.log(`requests last hour: ${client.quota().requestsLastHour}`);
