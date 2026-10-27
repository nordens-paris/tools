// Dev helper: finds each healer's peers in well-run raids and prints who was picked and the cost.
// Usage: npx tsx --env-file=.env scripts/healer-peers.ts <report>:<fight> [healer name ...]
import { fetchHealerFight } from '../server/analysis/healer/data.ts';
import { healerMetrics } from '../server/analysis/healer/metrics.ts';
import { FightModel } from '../server/analysis/healer/model.ts';
import { findHealerPeers } from '../server/analysis/healer/peers.ts';
import { WclClient } from '../server/wcl/client.ts';

const [target, ...names] = process.argv.slice(2);
const [report, fight] = target.split(':');
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const sent = () => client.quota().requestsLastHour;
const pct = (v: number) => `${Math.round(v * 100)}%`;

const m = new FightModel(await fetchHealerFight(client, report, Number(fight)));
console.log(`${m.data.fight.name}: ${m.healers.size} healers, raid ${Math.round(m.raidDtps)} damage/s = ${Math.round(m.raidDtps / m.healers.size)} per healer`);
for (const [id, spec] of m.healers) {
  if (names.length && !names.includes(m.name(id))) continue;
  const me = healerMetrics(m, id);
  const before = sent();
  const t0 = Date.now();
  const g = await findHealerPeers(client, {
    encounterId: m.data.fight.boss,
    spec,
    tankShareIcon: me.tankShareIcon,
    healers: m.healers.size,
    dtpsPerHealer: m.raidDtps / m.healers.size,
    report,
  }, (msg) => console.log('   ', msg));
  console.log(`\n${me.name} (${spec.label}, ${g.you.role}, tanks ${pct(me.tankShareIcon)}): match ${g.match}, ${g.raidsChecked} raids checked, ${sent() - before} requests, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  ${g.description}`);
  for (const p of g.peers) {
    console.log(
      `  - ${p.name} (${p.region}) ${p.raidRanking.metric} #${p.raidRanking.rank} ${p.raidRanking.guild ?? ''}: ${p.raid.healers} healers, ` +
        `${Math.round(p.raid.dtpsPerHealer)}/healer, ${p.raid.deaths} deaths, tanks ${pct(p.tankShareIcon)}, parses median ${Math.round(p.consistency?.median ?? 0)} over ${p.consistency?.kills} kills`,
    );
  }
}
