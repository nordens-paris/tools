// Dev helper: the healer metrics for one or more kills, one compact line per healer, plus deaths.
// Usage: npx tsx --env-file=.env scripts/healer-check.ts <report>:<fight> [...] [--json out.json]
import fs from 'node:fs';

import { fetchHealerFight } from '../server/analysis/healer/data.ts';
import { healerFightSummary } from '../server/analysis/healer/metrics.ts';
import { FightModel } from '../server/analysis/healer/model.ts';
import { WclClient } from '../server/wcl/client.ts';

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonFile = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : undefined;
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const pct = (v: number | undefined) => (v === undefined ? '  -' : `${Math.round(v * 100)}%`.padStart(4));
const out: Record<string, unknown> = {};

for (const arg of args) {
  const [report, fight] = arg.split(':');
  const before = client.quota().requestsLastHour;
  const t0 = Date.now();
  const data = await fetchHealerFight(client, report, Number(fight));
  const fetched = client.quota().requestsLastHour - before;
  const t1 = Date.now();
  const s = healerFightSummary(new FightModel(data));
  out[arg] = s;
  console.log(
    `\n## ${s.encounter.name} ${s.durationSec.toFixed(0)}s  tanks ${s.tanks.map((t) => t.name).join(', ')}  raid HPS ${s.raid.hps.toFixed(0)}  ` +
      `healers ${s.raid.healers}  (${fetched} requests sent, fetch ${t1 - t0} ms, metrics ${Date.now() - t1} ms)`,
  );
  for (const h of s.healers) {
    const o = h.overheal;
    console.log(
      `  ${h.name.slice(0, 11).padEnd(11)} ${h.specLabel.padEnd(18)} ${h.role.padEnd(5)} tk${pct(h.tankShare)} hps${h.hps.toFixed(0).padStart(5)} ` +
        `ov${pct(h.overhealPct)} hpm${(h.mana?.healPerMana ?? 0).toFixed(1).padStart(5)} end${pct(h.mana?.end)} ` +
        `own${pct(o.ownChoice)} snip${pct(o.othersFilled)} bnc${pct(o.chainHealBounces)} hot${pct(o.hotTicks)} ` +
        `canc${String(h.cancels.count).padStart(3)} rx${(h.reaction.medianSec ?? 0).toFixed(1).padStart(4)}s first${pct(h.reaction.firstResponder)} ` +
        `sav${String(h.saves).padStart(2)} act${pct(h.activity)} idle${h.idleWhileNeeded.sec.toFixed(1).padStart(5)} cds${h.cooldowns.length} ` +
        h.upkeep.map((u) => `${u.name} ${pct(u.uptime)}${u.stack3 !== undefined ? `/${pct(u.stack3)}` : ''}`).join(' '),
    );
  }
  for (const d of s.deaths) {
    console.log(`  † ${d.player.slice(0, 11).padEnd(11)} ${String(d.atSec).padStart(3)}s ${d.killedBy.slice(0, 22).padEnd(22)} ${d.kind.padEnd(6)} periodic=${d.periodicSec ?? '-'} below50=${d.secBelow50?.toFixed(1) ?? '-'}`);
  }
}
if (jsonFile) fs.writeFileSync(jsonFile, JSON.stringify(out));
