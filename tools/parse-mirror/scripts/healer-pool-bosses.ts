// Fills in the healer score pool's missing bosses from the reports it already has: the prototype
// sets (healer-score.ts, healer-weeks.ts) took four bosses per zone, but the same raids killed the
// rest that night. Saves .cache/healer-score-samples-bosses.json in the same format, with the
// boss's encounter id; then run healer-score-ref.ts.
//
//   npx tsx --env-file=.env scripts/healer-pool-bosses.ts
// About 10 requests per kill: ~250 kills is ~2,500 (the reports' fight lists are cached).
import fs from 'node:fs';
import { fetchHealerFight } from '../server/analysis/healer/data.ts';
import { healerMetrics } from '../server/analysis/healer/metrics.ts';
import { FightModel } from '../server/analysis/healer/model.ts';
import { WclClient } from '../server/wcl/client.ts';

// Archimonde, and Black Temple's Naj'entus, Supremus, Akama, Teron and Illidan.
const MISSING = new Set([50622, 50601, 50602, 50603, 50604, 50609]);
const OUT = '.cache/healer-score-samples-bosses.json';
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);

const reports = new Map<string, { group: string; guild?: string; night?: number }>();
for (const set of ['', '-bt', '-btweeks']) {
  const file = `.cache/healer-score-samples${set}.json`;
  if (!fs.existsSync(file)) continue;
  for (const s of JSON.parse(fs.readFileSync(file, 'utf8')) as { report: string; group: string; guild?: string; night?: number }[]) {
    if (!reports.has(s.report)) reports.set(s.report, { group: s.group, guild: s.guild, night: s.night });
  }
}
const samples: { report: string; fight: number }[] = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
const done = new Set(samples.map((s) => `${s.report}:${s.fight}`));
let kills = 0;
for (const [report, info] of reports) {
  try {
    const fights = await client.fights(report);
    const todo = fights.fights.filter((f) => f.kill && MISSING.has(f.boss) && !done.has(`${report}:${f.id}`));
    await Promise.all(
      todo.map(async (f) => {
        const model = new FightModel(await fetchHealerFight(client, report, f.id, fights));
        for (const [id, spec] of model.healers) {
          const m = healerMetrics(model, id);
          samples.push({ ...info, report, fight: f.id, boss: f.name, bossId: f.boss, name: m.name, spec: spec.label, durationSec: model.durationSec, healers: model.healers.size, dtpsPerHealer: model.raidDtps / model.healers.size, m } as never);
        }
      }),
    );
    kills += todo.length;
    fs.writeFileSync(OUT, JSON.stringify(samples));
    console.log(`${report}: ${todo.length} kills (${todo.map((f) => f.name).join(', ')}), ${kills} kills, ${samples.length} healer kills so far`);
  } catch (err) {
    console.log(`${report}: skipped (${(err as Error).message})`);
  }
}
console.log(`Done: ${kills} new kills, ${samples.length} healer kills in ${OUT}`);
