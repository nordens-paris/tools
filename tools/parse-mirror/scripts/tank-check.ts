// Dev helper: the tank metrics for every tank in one or more kills (or one named tank).
// Usage: npx tsx --env-file=.env scripts/tank-check.ts <report>:<fight>[:<name>] [...]
import { FightModel } from '../server/analysis/healer/model.ts';
import { fetchTankFight } from '../server/analysis/tank/data.ts';
import { tankMetrics, tankSpecIn } from '../server/analysis/tank/metrics.ts';
import { TANK_ICONS } from '../server/specs/tanks.ts';
import { WclClient } from '../server/wcl/client.ts';

const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const pct = (v: number | undefined) => (v === undefined ? '  -' : `${Math.round(v * 100)}%`.padStart(4));
const k = (v: number) => `${(v / 1000).toFixed(1)}k`;

for (const arg of process.argv.slice(2)) {
  const [report, fight, name] = arg.split(':');
  const fights = await client.fights(report);
  const before = client.quota().requestsLastHour;
  // Candidates: the named player, or anyone with a tank icon or who took a real share of melee.
  const first = await fetchTankFight(client, report, Number(fight), fights.friendlies.find((a) => a.fights.some((f) => f.id === Number(fight)))!.id, fights);
  const model = new FightModel(first.raid);
  const ids = name
    ? [fights.friendlies.find((a) => a.name === name)!.id]
    : [...new Set([...model.tanks, ...[...model.players.values()].filter((p) => TANK_ICONS.has(model.icon(p.id))).map((p) => p.id)])];
  console.log(`\n## ${model.data.fight.name} ${model.durationSec.toFixed(0)}s (${report}:${fight})`);
  for (const id of ids) {
    const data = await fetchTankFight(client, report, Number(fight), id, fights);
    if (!tankSpecIn(data)) {
      console.log(`  ${model.name(id)}: not tanking (${model.icon(id)})`);
      continue;
    }
    const t = tankMetrics(data, model);
    const s = t.swings;
    console.log(
      `  ${t.name.slice(0, 12).padEnd(12)} ${t.specLabel.padEnd(19)} ${t.role.padEnd(4)} ${t.tanked.slice(0, 18).padEnd(18)} share${pct(t.swingShare)} ` +
        `armor ${t.survivability.armor} (${pct(t.survivability.armorReduction)}) hp ${k(t.survivability.maxHp)}${t.survivability.maxHpFrom === 'stamina' ? '?' : ''} ehp ${k(t.survivability.effectiveHealth)} ` +
        `def ${t.gear?.defense ?? '-'}${t.gear ? (t.gear.critImmune ? ' immune' : ' CRITTABLE') : ''} lean${pct(t.gear?.mitigationLean)}`,
    );
    console.log(
      `     swings ${s.total}: avoid${pct(s.avoided)} block ${s.block} crush ${s.crush} crit ${s.crit} hit ${s.hit} | per hit ${Math.round(s.damagePerHit)} of ${Math.round(s.unmitigatedPerHit)} | ` +
        t.mitigation.map((m) => `${m.name} up${pct(m.uptime)} covers${pct(m.swingsCovered)} crush in/out ${m.crushesCovered}/${m.crushesUncovered}`).join(' ') +
        ` | form${pct(t.tankAuraUptime)}${t.catFormUptime ? ` cat${pct(t.catFormUptime)}` : ''}`,
    );
    console.log(
      `     TPS ${Math.round(t.threat.tps)} opener 5/10/20s ${t.threat.opener.map(Math.round).join('/')} top ${t.threat.byAbility.slice(0, 4).map((a) => `${a.name} ${pct(a.share)}`).join(', ')} | ` +
        (t.holding
          ? `first swing ${t.holding.firstSwingSec?.toFixed(1)}s ${t.holding.firstSwingOnYou ? 'on you' : 'elsewhere'}, on non-tanks ${t.holding.swingsOnNonTanks} (${pct(t.holding.nonTankShare)})`
          : 'holding: -'),
    );
    console.log(
      `     debuffs ${t.bossDebuffs.map((d) => `${d.name} ${pct(d.uptime)}`).join(', ') || '-'} | cds ${t.cooldowns.map((c) => `${c.name}@${c.atSec}s${c.hpPct !== undefined ? `(${pct(c.hpPct)})` : ''}`).join(' ') || '-'}` +
        ` | drops ${t.threatDrops.map((d) => `${d.name}@${d.atSec}s`).join(' ') || '-'} | taunts ${t.taunts.length} | dtps ${Math.round(t.dtps)} near-deaths ${t.nearDeaths}${t.died ? ' DIED' : ''}`,
    );
  }
  console.log(`  (${client.quota().requestsLastHour - before} requests sent)`);
}
