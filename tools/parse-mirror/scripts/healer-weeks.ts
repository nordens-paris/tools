// Week-to-week data for the healer score prototype: EU and US guilds from Gurtogg's execution
// ranking (top and bottom pages), several raid nights each, so the same healers are seen over
// weeks. Saves .cache/healer-score-samples-btweeks.json in the same format (plus guild and night);
// then run healer-outcomes.ts --set=btweeks and healer-score.ts --set=btweeks --adjust --across-nights.
//
//   npx tsx --env-file=.env scripts/healer-weeks.ts [--guilds=8] [--nights=4]
// About 9 requests per kill: 8 guilds x 4 nights x 4 bosses is ~1,150.
import fs from 'node:fs';
import { fetchHealerFight } from '../server/analysis/healer/data.ts';
import { healerMetrics } from '../server/analysis/healer/metrics.ts';
import { FightModel } from '../server/analysis/healer/model.ts';
import { WclClient } from '../server/wcl/client.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const GUILDS = flag('guilds', 8);
const NIGHTS = flag('nights', 4);
const BOSSES = new Set([50605, 50606, 50607, 50608]);
const OUT = '.cache/healer-score-samples-btweeks.json';
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);

// Guilds from Gurtogg's execution ranking: the top pages (well-run) and the last ones (ordinary).
// EU and US only: the guild report list doesn't take Korean or Chinese server names.
const picked: { group: 'good' | 'ordinary'; guild: string; server: string; region: string }[] = [];
for (const [group, pages] of [['good', [1, 2, 3]], ['ordinary', [18, 19, 20]]] as const) {
  for (const page of pages) {
    for (const r of (await client.raidRankings(50605, 'execution', page)).rankings as unknown as { guildName?: string; serverName?: string; regionName?: string }[]) {
      if (!r.guildName || !['EU', 'US'].includes(r.regionName ?? '') || picked.filter((p) => p.group === group).length >= GUILDS / 2) continue;
      if (picked.some((p) => p.guild === r.guildName && p.server === r.serverName)) continue;
      picked.push({ group, guild: r.guildName, server: r.serverName!, region: r.regionName! });
    }
  }
}
console.log(`Guilds: ${picked.map((p) => `${p.guild} (${p.group})`).join(', ')}`);

const samples: unknown[] = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
const done = new Set((samples as { report: string }[]).map((s) => s.report));
for (const g of picked) {
  try {
    const all = await client.guildReports(g.guild, g.server, g.region);
    // One report per day (several people log the same night), newest first, until NIGHTS nights
    // with at least two of the bosses.
    const days = new Set<string>();
    let night = 0;
    for (const r of all.sort((a, b) => b.start - a.start).slice(0, 15)) {
      const day = new Date(r.start).toISOString().slice(0, 10);
      if (night >= NIGHTS || days.has(day)) continue;
      const fights = await client.fights(r.id);
      const kills = fights.fights.filter((f) => f.kill && BOSSES.has(f.boss));
      if (kills.length < 2) continue;
      days.add(day);
      night++;
      if (done.has(r.id)) continue;
      await Promise.all(
        kills.map(async (f) => {
          const model = new FightModel(await fetchHealerFight(client, r.id, f.id, fights));
          for (const [id, spec] of model.healers) {
            const m = healerMetrics(model, id);
            samples.push({ group: g.group, guild: `${g.guild}-${g.server}`, night: night - 1, report: r.id, fight: f.id, boss: f.name, name: m.name, spec: spec.label, durationSec: model.durationSec, healers: model.healers.size, dtpsPerHealer: model.raidDtps / model.healers.size, m });
          }
        }),
      );
      fs.writeFileSync(OUT, JSON.stringify(samples));
      console.log(`${g.group} ${g.guild}: night ${night} ${day}, ${kills.length} kills, ${samples.length} healer kills so far`);
    }
  } catch (err) {
    console.log(`${g.guild}: skipped (${(err as Error).message})`);
  }
}
