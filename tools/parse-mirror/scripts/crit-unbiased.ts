// Diagnostic: is the real-vs-sim crit gap selection bias? Rankings only list each player's best
// kill, so instead this takes characters from deep in the rankings and looks at EVERY one of
// their kills, good or bad, comparing real crits with what the sim expects.
//
//   SPEC=warlock-destruction npx tsx --env-file=.env scripts/crit-unbiased.ts <outfile.json>
import fs from 'node:fs';

import { collectPlayerFight } from '../server/analysis/collect.ts';
import { buildRequest, encounterOf, environmentOf, setupFromRaw } from '../server/sim/request.ts';
import { computeLuck } from '../server/sim/luck.ts';
import { runSim } from '../server/sim/runner.ts';
import { specs } from '../server/specs/index.ts';
import { WclClient } from '../server/wcl/client.ts';

const spec = specs.find((s) => s.key === (process.env.SPEC ?? 'warrior-fury'))!;
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const cli = process.env.WOWSIMS_CLI!;
const out = process.argv[2] ?? 'crit-unbiased.json';

// Mostly single-target bosses: Hyjal minus Archimonde, plus Naj'entus and Gurtogg.
const BOSSES = [50618, 50619, 50620, 50621, 50601, 50605];
const SAMPLE_FROM = { encounters: [50620, 50601], pages: [3, 10, 20], perPage: 4 };
const MAX_KILLS_PER_CHAR = Number(process.env.MAX_KILLS ?? 12);

const specName = spec.specName.toLowerCase();
const chars = new Map<string, { name: string; server: string; region: string }>();
for (const enc of SAMPLE_FROM.encounters) {
  for (const page of SAMPLE_FROM.pages) {
    const r = await client.rankings(enc, spec.wcl.classId, spec.wcl.specId, page);
    // Spread picks across the page instead of taking the first few.
    const step = Math.floor(r.rankings.length / SAMPLE_FROM.perPage) || 1;
    for (let i = 0; i < r.rankings.length && i / step < SAMPLE_FROM.perPage; i += step) {
      const x = r.rankings[i];
      if (!x.hidden) chars.set(`${x.name}-${x.serverName}`, { name: x.name, server: x.serverName, region: x.regionName });
    }
  }
}
console.log(`${chars.size} characters sampled`);

interface Row {
  char: string;
  boss: string;
  percentile: number;
  best: boolean;
  landed: number;
  crits: number;
  expectedCrits: number;
  critVar: number;
  realPct: number;
  simPct: number;
  /** Raid buffs the sim picked up for this kill. */
  detected: string[];
  /** Spells: partial resists on direct hits (damage resisted, expected, and unresisted total). */
  resists: { resisted: number; expected: number; potential: number };
  abilities: { name: string; landed: number; crits: number; expectedCrits: number; critVar: number; attempts: number; avoided: number; expectedAvoided: number }[];
}
const rows: Row[] = [];

for (const c of chars.values()) {
  let parses;
  try {
    parses = await client.parses(c.name, c.server, c.region);
  } catch (e) {
    console.log(`skip ${c.name}: ${(e as Error).message}`);
    continue;
  }
  // The API sorts by percentile; use date order so the cap doesn't keep only the better kills.
  // The same kill logged by two raiders shows up twice, so drop repeats.
  const seen = new Set<string>();
  const kills = parses
    .filter((p) => BOSSES.includes(p.encounterID) && p.spec.toLowerCase() === specName)
    .sort((a, b) => a.startTime - b.startTime)
    .filter((p) => {
      const key = `${p.encounterID}-${p.duration}-${Math.round(p.total)}`;
      return !seen.has(key) && seen.add(key);
    });
  // Best kill per boss, to compare against the character's other kills.
  const bestPct = new Map<number, number>();
  for (const k of kills) bestPct.set(k.encounterID, Math.max(bestPct.get(k.encounterID) ?? 0, k.percentile));
  for (const k of kills.slice(0, MAX_KILLS_PER_CHAR)) {
    try {
      const fights = await client.fights(k.reportID);
      const actor = fights.friendlies.find((a) => a.name === c.name && a.fights.some((f) => f.id === k.fightID));
      if (!actor) continue;
      const raw = await collectPlayerFight(client, spec, k.reportID, k.fightID, actor.id, { server: c.server, region: c.region });
      if (!raw.combatant) continue;
      const sim = await runSim(
        cli,
        buildRequest({ spec, player: setupFromRaw(raw, spec), env: environmentOf(raw, spec), durationSec: raw.fight.durationSec, encounter: encounterOf(raw), iterations: 400 }),
      );
      // Same abilities the luck analysis uses (the main ones the sim also casts).
      // Main- and off-hand hits (e.g. Whirlwind) share a name, so sum the log's outcomes by name.
      const real = new Map<string, { landed: number; crits: number; avoided: number }>();
      for (const o of raw.outcomes) {
        const r = real.get(o.name) ?? { landed: 0, crits: 0, avoided: 0 };
        real.set(o.name, { landed: r.landed + o.landed, crits: r.crits + o.crits, avoided: r.avoided + o.avoided });
      }
      const luck = computeLuck(raw, sim.player).summary;
      const luckAbilities = luck.abilities;
      const abilities = [...new Set(luckAbilities.map((a) => a.name))].map((name) => ({ ...luckAbilities.find((a) => a.name === name)!, ...real.get(name)! }));
      const landed = abilities.reduce((s, a) => s + a.landed, 0);
      const crits = abilities.reduce((s, a) => s + a.crits, 0);
      const expectedCrits = abilities.reduce((s, a) => s + (a.landed * a.expectedCritPct) / 100, 0);
      const critVar = abilities.reduce((s, a) => s + a.landed * (a.expectedCritPct / 100) * (1 - a.expectedCritPct / 100), 0);
      const row: Row = {
        char: c.name,
        boss: k.encounterName,
        percentile: k.percentile,
        best: k.percentile === bestPct.get(k.encounterID),
        landed,
        crits,
        expectedCrits,
        critVar,
        realPct: (crits / landed) * 100,
        simPct: (expectedCrits / landed) * 100,
        detected: [
          ...environmentOf(raw, spec).detected,
          // Totem buffs aren't logged on Anniversary; a shaman casting the totem is.
          ...((await client.table<{ entries: unknown[] }>('casts', k.reportID, { start: fights.fights.find((x) => x.id === k.fightID)!.start_time, end: fights.fights.find((x) => x.id === k.fightID)!.end_time, abilityid: 30706 })).entries.length ? ['ToW cast in raid'] : []),
        ],
        resists: luckAbilities.reduce(
          (acc, a) => {
            const r = raw.outcomes.filter((o) => o.name === a.name).reduce((p, o) => p + (o.resists?.potential ?? 0), 0);
            const res = raw.outcomes.filter((o) => o.name === a.name).reduce((p, o) => p + (o.resists?.resisted ?? 0), 0);
            return { resisted: acc.resisted + res, expected: acc.expected + (r * (a.expectedResistPct ?? 0)) / 100, potential: acc.potential + r };
          },
          { resisted: 0, expected: 0, potential: 0 },
        ),
        abilities: abilities.map((a) => ({
          name: a.name,
          landed: a.landed,
          crits: a.crits,
          expectedCrits: (a.landed * a.expectedCritPct) / 100,
          critVar: a.landed * (a.expectedCritPct / 100) * (1 - a.expectedCritPct / 100),
          attempts: a.landed + a.avoided,
          avoided: a.avoided,
          expectedAvoided: ((a.landed + a.avoided) * a.expectedAvoidPct) / 100,
        })),
      };
      rows.push(row);
      console.log(
        `${c.name.padEnd(14)} ${k.encounterName.slice(0, 16).padEnd(16)} p${k.percentile.toFixed(0).padStart(3)}${row.best ? '*' : ' '} crit ${row.realPct.toFixed(1)} vs sim ${row.simPct.toFixed(1)} (${landed})`,
      );
      fs.writeFileSync(out, JSON.stringify(rows, null, 1));
    } catch (e) {
      console.log(`skip ${c.name} ${k.encounterName}: ${(e as Error).message}`);
    }
  }
}

type Counts = { landed: number; crits: number; expectedCrits: number; critVar: number };
const pooled = (rs: Counts[], unit = 'kills') => {
  const landed = rs.reduce((s, r) => s + r.landed, 0);
  const gap = (rs.reduce((s, r) => s + r.crits - r.expectedCrits, 0) / landed) * 100;
  const se = (Math.sqrt(rs.reduce((s, r) => s + r.critVar, 0)) / landed) * 100;
  return `${rs.length.toString().padStart(4)} ${unit}  gap ${gap >= 0 ? '+' : ''}${gap.toFixed(1)} pts (±${se.toFixed(1)} from pure chance)`;
};
console.log(`\nAll kills:          ${pooled(rows)}`);
for (const [lo, hi] of [[0, 25], [25, 50], [50, 75], [75, 90], [90, 101]]) {
  console.log(`Percentile ${String(lo).padStart(2)}-${String(Math.min(hi, 100)).padEnd(3)}:   ${pooled(rows.filter((r) => r.percentile >= lo && r.percentile < hi))}`);
}
console.log(`Best kill per boss: ${pooled(rows.filter((r) => r.best))}`);
console.log(`Other kills:        ${pooled(rows.filter((r) => !r.best))}`);

console.log('\nPer ability, all kills:');
for (const name of new Set(rows.flatMap((r) => r.abilities.map((a) => a.name)))) {
  const as = rows.flatMap((r) => r.abilities.filter((a) => a.name === name));
  const attempts = as.reduce((s, a) => s + a.attempts, 0);
  const avoid = (as.reduce((s, a) => s + a.avoided, 0) / attempts) * 100;
  const expAvoid = (as.reduce((s, a) => s + a.expectedAvoided, 0) / attempts) * 100;
  console.log(`  ${name.padEnd(18)} ${pooled(as)}   avoided ${avoid.toFixed(1)}% vs sim ${expAvoid.toFixed(1)}%`);
}

const resistRows = rows.filter((r) => r.resists?.potential);
if (resistRows.length) {
  const share = (rs: Row[]) => {
    const p = rs.reduce((s, r) => s + r.resists.potential, 0);
    const real = (rs.reduce((s, r) => s + r.resists.resisted, 0) / p) * 100;
    const exp = (rs.reduce((s, r) => s + r.resists.expected, 0) / p) * 100;
    return `${String(rs.length).padStart(4)} kills  resisted ${real.toFixed(2)}% vs sim ${exp.toFixed(2)}%`;
  };
  console.log('\nPartial resists (share of direct damage):');
  console.log(`  All kills:        ${share(resistRows)}`);
  for (const [lo, hi] of [[0, 50], [50, 75], [75, 90], [90, 101]]) {
    console.log(`  Percentile ${String(lo).padStart(2)}-${String(Math.min(hi, 100)).padEnd(3)}: ${share(resistRows.filter((r) => r.percentile >= lo && r.percentile < hi))}`);
  }
}

// GROUP_BY="<buff name>" splits the totals by whether the sim detected that buff.
if (process.env.GROUP_BY) {
  const name = process.env.GROUP_BY;
  console.log(`
By ${name}:`);
  for (const has of [true, false]) {
    const rs = rows.filter((r) => r.detected.some((d) => d.startsWith(name)) === has);
    if (!rs.length) continue;
    const abilities = rs.flatMap((r) => r.abilities);
    const attempts = abilities.reduce((s, a) => s + a.attempts, 0);
    const avoid = (abilities.reduce((s, a) => s + a.avoided, 0) / attempts) * 100;
    const expAvoid = (abilities.reduce((s, a) => s + a.expectedAvoided, 0) / attempts) * 100;
    console.log(`  ${has ? 'with   ' : 'without'} ${pooled(rs)}   avoided ${avoid.toFixed(1)}% vs sim ${expAvoid.toFixed(1)}%`);
  }
}
