// Diagnostic: how well does the sim reproduce real fights?
//
//   npx tsx --env-file=.env scripts/sim-vs-log.ts boss <encounterId> [count]   -> top players: real vs sim DPS
//   npx tsx --env-file=.env scripts/sim-vs-log.ts player <report> <fight> <source> -> per-ability breakdown
import { collectTopPlayers, topCandidates } from '../server/analysis/analyze.ts';
import { collectPlayerFight, type PlayerFightRaw } from '../server/analysis/collect.ts';
import { spellName } from '../server/data/db.ts';
import { median } from '../server/analysis/stats.ts';
import { buildRequest, encounterOf, environmentOf, setupFromRaw } from '../server/sim/request.ts';
import { runSim } from '../server/sim/runner.ts';
import { specs } from '../server/specs/index.ts';

// SPEC=<spec key> picks the spec (default warrior-fury), e.g. SPEC=warlock-destruction.
const spec = specs.find((s) => s.key === (process.env.SPEC ?? 'warrior-fury'))!;
import { WclClient } from '../server/wcl/client.ts';

const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const cli = process.env.WOWSIMS_CLI!;
const [mode, ...args] = process.argv.slice(2);

// EXTRA_CRIT_RATING=<n> adds melee crit rating to every sim, for experiments.
const extraCrit = Number(process.env.EXTRA_CRIT_RATING ?? 0);
const STAT_MELEE_CRIT_RATING = 21;

const simOf = (raw: PlayerFightRaw, iterations = 1000) => {
  const req = buildRequest({
    spec,
    player: setupFromRaw(raw, spec),
    env: environmentOf(raw, spec),
    durationSec: raw.fight.durationSec,
    encounter: encounterOf(raw),
    iterations,
  });
  if (extraCrit) req.raid.parties[0].players[0].bonusStats.stats[STAT_MELEE_CRIT_RATING] += extraCrit;
  // EXTRA_STATS="<statIndex>:<value>,..." adds any stats (13 = spell crit rating, 17 = attack power).
  for (const pair of (process.env.EXTRA_STATS ?? '').split(',').filter(Boolean)) {
    const [idx, val] = pair.split(':').map(Number);
    req.raid.parties[0].players[0].bonusStats.stats[idx] += val;
  }
  return runSim(cli, req);
};

if (mode === 'boss') {
  const [encounterId, count = '5'] = args;
  const warnings: string[] = [];
  const top = await collectTopPlayers(client, spec, (await topCandidates(client, spec, Number(encounterId))).candidates, Number(count), undefined, warnings);
  const ratios: number[] = [];
  console.log(`\n${top[0]?.encounterName ?? encounterId}`);
  for (const raw of top.filter((t) => t.combatant)) {
    const sim = await simOf(raw);
    const ratio = (raw.fight.simComparableDps / sim.avg) * 100;
    ratios.push(ratio);
    // Crit rate of the player's biggest damage ability, real vs sim.
    const f = (await client.fights(raw.fight.report)).fights.find((x) => x.id === raw.fight.fight)!;
    const dmg = await client.table<{ entries: any[] }>('damage-done', raw.fight.report, { start: f.start_time, end: f.end_time, sourceid: raw.fight.source });
    const main = [...dmg.entries].sort((a, b) => b.total - a.total)[0];
    const simMain = sim.player.actions.find((a) => spellName(a.id.spellId ?? -1, '') === spellName(main?.guid ?? -2, main?.name ?? ''));
    const st = (k: string) => simMain?.targets.reduce((acc, t) => acc + ((t as any)[k] ?? 0), 0) ?? 0;
    const simCrit = st('hits') + st('crits') ? (st('crits') / (st('hits') + st('crits'))) * 100 : NaN;
    const realCrit = main?.hitCount ? (main.critHitCount / main.hitCount) * 100 : NaN;
    console.log(
      `  #${raw.fight.rank} ${raw.fight.name.padEnd(14)} real ${raw.fight.dps.toFixed(0).padStart(5)}  sim ${sim.avg.toFixed(0).padStart(5)}  ${ratio.toFixed(0)}%  (${raw.fight.durationSec.toFixed(0)}s)` +
        `  ${spellName(main?.guid ?? 0, main?.name ?? '?')} crit ${realCrit.toFixed(0)}/${simCrit.toFixed(0)}% (${main?.hitCount})  talents:${raw.fight.talentSource}  player ${raw.fight.report} ${raw.fight.fight} ${raw.fight.source}`,
    );
  }
  console.log(`  median real/sim: ${median(ratios).toFixed(0)}%`);
  if (warnings.length) console.log('  ' + warnings.join('\n  '));
} else if (mode === 'player') {
  const [report, fight, source] = args;
  const raw = await collectPlayerFight(client, spec, report, Number(fight), Number(source));
  const sim = await simOf(raw, 2000);
  const n = 2000;

  // Real: per-ability damage table with hit details.
  const fights = await client.fights(report);
  const f = fights.fights.find((x) => x.id === Number(fight))!;
  const table = await client.table<{ entries: any[] }>('damage-done', report, { start: f.start_time, end: f.end_time, sourceid: Number(source) });

  type Row = { casts: number; landed: number; crits: number; glances: number; misses: number; dmg: number };
  const real = new Map<string, Row>();
  for (const e of table.entries) {
    const name = e.guid === 1 ? 'Melee' : spellName(e.guid, e.name);
    const r = real.get(name) ?? { casts: 0, landed: 0, crits: 0, glances: 0, misses: 0, dmg: 0 };
    r.casts += e.uses ?? 0;
    r.landed += e.hitCount ?? 0;
    r.crits += e.critHitCount ?? 0;
    r.misses += e.missCount ?? 0;
    r.glances += (e.hitdetails ?? []).filter((h: any) => h.type === 'Glancing Blow').reduce((s: number, h: any) => s + h.count, 0);
    r.dmg += e.total;
    real.set(name, r);
  }
  const simRows = new Map<string, Row>();
  for (const a of sim.player.actions) {
    const s = (k: string) => a.targets.reduce((acc, t) => acc + ((t as any)[k] ?? 0), 0) / n;
    if (!s('damage')) continue;
    const name = a.id.otherId === 'OtherActionAttack' ? 'Melee' : spellName(a.id.spellId ?? a.id.itemId ?? 0, `${a.id.spellId ?? a.id.itemId}`);
    const r = simRows.get(name) ?? { casts: 0, landed: 0, crits: 0, glances: 0, misses: 0, dmg: 0 };
    // WoWSims "hits" excludes crits and glances.
    r.casts += s('casts');
    r.landed += s('hits') + s('crits') + s('glances');
    r.crits += s('crits');
    r.glances += s('glances');
    r.misses += s('misses') + s('dodges') + s('parries');
    r.dmg += s('damage');
    simRows.set(name, r);
  }
  console.log(`\n${raw.fight.name} on ${raw.encounterName}: real ${raw.fight.dps.toFixed(0)} DPS, sim ${sim.avg.toFixed(0)} DPS (${((raw.fight.dps / sim.avg) * 100).toFixed(0)}%)\n`);
  console.log('ability'.padEnd(22) + 'landed r/s'.padStart(14) + 'crit% r/s'.padStart(12) + 'avg dmg r/s'.padStart(16) + 'total r/s'.padStart(18));
  for (const name of new Set([...real.keys(), ...simRows.keys()])) {
    const r = real.get(name);
    const s = simRows.get(name);
    const pct = (x?: Row) => (x && x.landed ? ((x.crits / x.landed) * 100).toFixed(0) : '-');
    const avg = (x?: Row) => (x && x.landed ? (x.dmg / x.landed).toFixed(0) : '-');
    console.log(
      name.slice(0, 21).padEnd(22) +
        `${r?.landed.toFixed(0) ?? '-'}/${s?.landed.toFixed(1) ?? '-'}`.padStart(14) +
        `${pct(r)}/${pct(s)}`.padStart(12) +
        `${avg(r)}/${avg(s)}`.padStart(16) +
        `${r ? (r.dmg / 1000).toFixed(1) + 'k' : '-'}/${s ? (s.dmg / 1000).toFixed(1) + 'k' : '-'}`.padStart(18),
    );
  }
  for (const tag of [1, 2]) {
    const a = sim.player.actions.find((x) => x.id.otherId === 'OtherActionAttack' && x.id.tag === tag);
    if (!a) continue;
    const s = (k: string) => a.targets.reduce((acc, t) => acc + ((t as any)[k] ?? 0), 0);
    const swings = s('hits') + s('crits') + s('glances') + s('misses') + s('dodges') + s('parries');
    console.log(
      `Sim ${tag === 1 ? 'MH' : 'OH'} white: crit ${((s('crits') / swings) * 100).toFixed(1)}% glance ${((s('glances') / swings) * 100).toFixed(1)}% ` +
        `miss ${((s('misses') / swings) * 100).toFixed(1)}% dodge ${((s('dodges') / swings) * 100).toFixed(1)}% of swings`,
    );
  }
  console.log('\nSim casts per fight vs real casts:');
  const realCasts = new Map(raw.fight.casts.map((c) => [c.name, c.casts]));
  for (const a of sim.player.actions) {
    const casts = a.targets.reduce((acc, t) => acc + (t.casts ?? 0), 0) / n;
    const id = a.id.spellId ?? a.id.itemId;
    if (!id || !casts) continue;
    const name = spellName(id, `${a.id.spellId ? 'spell' : 'item'} ${id}`);
    console.log(`  ${name.padEnd(28)} sim ${casts.toFixed(2).padStart(6)}   real ${realCasts.get(name) ?? '-'}`);
  }
} else if (mode === 'depth') {
  // Selection bias check: is the real-vs-sim crit gap smaller for players ranked further down?
  // If top parses crit high because they got lucky, the gap shrinks with rank.
  const CRIT_ABILITIES: Record<string, string[]> = {
    'warrior-fury': ['Melee', 'Heroic Strike', 'Bloodthirst', 'Whirlwind'],
    'warlock-destruction': ['Shadow Bolt', 'Incinerate'],
  };
  const abilities = CRIT_ABILITIES[spec.key];
  const bands: [number, number][] = [
    [1, 10],
    [41, 50],
    [91, 100],
    [191, 200],
  ];
  const summary = new Map<string, { real: number[]; sim: number[]; dps: number[] }>();
  for (const encounterId of args.map(Number)) {
    for (const [from, to] of bands) {
      const page = Math.ceil(from / 100);
      const rankings = await client.rankings(encounterId, spec.wcl.classId, spec.wcl.specId, page);
      const slice = rankings.rankings.slice(from - 1 - (page - 1) * 100, to - (page - 1) * 100);
      for (const [i, r] of slice.entries()) {
        try {
          const rFights = await client.fights(r.reportID);
          const actor = rFights.friendlies.find((a) => a.name === r.name && a.type === spec.wcl.actorType && a.fights.some((f) => f.id === r.fightID));
          if (!actor) continue;
          const raw = await collectPlayerFight(client, spec, r.reportID, r.fightID, actor.id, { rank: from + i, server: r.serverName, region: r.regionName });
          if (!raw.combatant) continue;
          const f = rFights.fights.find((x) => x.id === r.fightID)!;
          const dmg = await client.table<{ entries: any[] }>('damage-done', r.reportID, { start: f.start_time, end: f.end_time, sourceid: actor.id });
          let rc = 0, rh = 0;
          for (const e of dmg.entries) {
            const name = e.guid === 1 ? 'Melee' : spellName(e.guid, e.name);
            if (!abilities.includes(name)) continue;
            rc += e.critHitCount ?? 0;
            rh += e.hitCount ?? 0;
          }
          const sim = await simOf(raw, 300);
          let sc = 0, sh = 0;
          for (const a of sim.player.actions) {
            const name = a.id.otherId === 'OtherActionAttack' ? (a.id.tag === 1 || a.id.tag === 2 ? 'Melee' : '') : spellName(a.id.spellId ?? 0, '');
            if (!abilities.includes(name)) continue;
            for (const t of a.targets) {
              sc += t.crits ?? 0;
              sh += (t.hits ?? 0) + (t.crits ?? 0) + (t.glances ?? 0);
            }
          }
          if (!rh || !sh) continue;
          const key = `${from}-${to}`;
          const s = summary.get(key) ?? { real: [], sim: [], dps: [] };
          s.real.push(rc / rh);
          s.sim.push(sc / sh);
          s.dps.push(raw.fight.simComparableDps / sim.avg);
          summary.set(key, s);
        } catch {
          // Private or broken report; skip.
        }
      }
      console.log(`  ${encounterId} ranks ${from}-${to}: ${summary.get(`${from}-${to}`)?.real.length ?? 0} players so far`);
    }
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`\n${spec.key}: crit on ${abilities.join(', ')}`);
  for (const [key, s] of summary) {
    const gaps = s.real.map((r, i) => r - s.sim[i]);
    const sd = Math.sqrt(mean(gaps.map((g) => (g - mean(gaps)) ** 2)));
    console.log(
      `  ranks ${key.padEnd(8)} n=${String(s.real.length).padStart(3)}  real ${(mean(s.real) * 100).toFixed(1)}%  sim ${(mean(s.sim) * 100).toFixed(1)}%  ` +
        `gap ${(mean(gaps) * 100).toFixed(1)} ± ${((sd / Math.sqrt(gaps.length)) * 100).toFixed(1)} pts   real/sim DPS ${(mean(s.dps) * 100).toFixed(0)}%`,
    );
  }
} else if (mode === 'crit') {
  // White-hit crit rate: real (outside Recklessness, which the sim doesn't apply to white hits)
  // vs sim, summed over the top players of each encounter.
  let realCrit = 0, realSwings = 0, simCrit = 0, simSwings = 0;
  const rows: { real: number; sim: number; n: number; agi: number; split: string; race: string; mh: string }[] = [];
  const YELLOW = ['Bloodthirst', 'Heroic Strike', 'Whirlwind'];
  // Real counts keyed by WCL hitType; sim counts keyed by outcome name.
  const tally = {
    real: { white: {} as Record<number, number>, yellow: {} as Record<number, number> },
    sim: { white: {} as Record<string, number>, yellow: {} as Record<string, number> },
  };
  for (const encounterId of args.map(Number)) {
    const top = await collectTopPlayers(client, spec, (await topCandidates(client, spec, encounterId)).candidates, 5, undefined, []);
    for (const raw of top.filter((t) => t.combatant)) {
      const fights = await client.fights(raw.fight.report);
      const f = fights.fights.find((x) => x.id === raw.fight.fight)!;
      const buffs = await client.events('buffs', raw.fight.report, f.start_time, f.end_time, { sourceid: raw.fight.source });
      const windows: [number, number][] = [];
      let start: number | undefined;
      for (const e of buffs) {
        if (e.ability?.guid !== 1719) continue;
        if (e.type === 'applybuff') start = e.timestamp;
        if (e.type === 'removebuff' && start !== undefined) windows.push([start, e.timestamp]), (start = undefined);
      }
      if (start !== undefined) windows.push([start, start + 15000]);
      const dmg = await client.events('damage-done', raw.fight.report, f.start_time, f.end_time, { sourceid: raw.fight.source });
      let c = 0, sw = 0;
      for (const e of dmg) {
        if (e.type !== 'damage' || e.sourceID !== raw.fight.source) continue;
        if (windows.some(([a, z]) => e.timestamp >= a && e.timestamp <= z)) continue;
        const name = e.ability ? spellName(e.ability.guid, e.ability.name) : '';
        if (e.ability?.guid === 1) {
          sw++;
          if (e.hitType === 2) c++;
          tally.real.white[e.hitType as number] = (tally.real.white[e.hitType as number] ?? 0) + 1;
        } else if (YELLOW.includes(name)) {
          tally.real.yellow[e.hitType as number] = (tally.real.yellow[e.hitType as number] ?? 0) + 1;
        }
      }
      // Sim without Recklessness, for a like-for-like yellow comparison.
      const noReck = await runSim(cli, buildRequest({
        spec: { ...spec, sim: { ...spec.sim, aplGroups: { disable: ['Recklessness ON/OFF', 'Overpower Weaving'] } } },
        player: setupFromRaw(raw, spec),
        env: environmentOf(raw, spec),
        durationSec: raw.fight.durationSec,
        encounter: encounterOf(raw),
        iterations: 300,
      }));
      for (const a of noReck.player.actions) {
        const name = a.id.otherId === 'OtherActionAttack' ? (a.id.tag === 1 || a.id.tag === 2 ? 'white' : '') : spellName(a.id.spellId ?? 0, '');
        const bucket = name === 'white' ? tally.sim.white : YELLOW.includes(name) ? tally.sim.yellow : undefined;
        if (!bucket) continue;
        for (const t of a.targets) {
          bucket.hit = (bucket.hit ?? 0) + (t.hits ?? 0);
          bucket.crit = (bucket.crit ?? 0) + (t.crits ?? 0);
          bucket.glance = (bucket.glance ?? 0) + (t.glances ?? 0);
          bucket.miss = (bucket.miss ?? 0) + (t.misses ?? 0);
          bucket.dodge = (bucket.dodge ?? 0) + (t.dodges ?? 0);
          bucket.parry = (bucket.parry ?? 0) + (t.parries ?? 0);
        }
      }
      const sim = await simOf(raw, 500);
      let sc = 0, ss = 0;
      for (const a of sim.player.actions.filter((x) => x.id.otherId === 'OtherActionAttack' && (x.id.tag === 1 || x.id.tag === 2))) {
        for (const t of a.targets) {
          sc += t.crits ?? 0;
          ss += (t.hits ?? 0) + (t.crits ?? 0) + (t.glances ?? 0) + (t.misses ?? 0) + (t.dodges ?? 0) + (t.parries ?? 0);
        }
      }
      realCrit += c; realSwings += sw; simCrit += sc / 500; simSwings += ss / 500;
      const ci = raw.combatant as unknown as { agility: number; critMelee: number };
      const mh = raw.fight.gear.find((g) => g.slot === 'Main Hand');
      console.log(
        `  ${raw.encounterName.slice(0, 22).padEnd(24)} #${raw.fight.rank} ${raw.fight.name.padEnd(14)} real ${((c / sw) * 100).toFixed(0)}% (${sw} swings)  sim ${((sc / ss) * 100).toFixed(1)}%` +
          `  agi ${ci.agility} critRating ${ci.critMelee} split ${raw.fight.talentSplit.join('/')} ${raw.fight.race} MH ${mh?.name}`,
      );
      rows.push({ real: c / sw, sim: sc / ss, n: sw, agi: ci.agility, split: raw.fight.talentSplit.join('/'), race: raw.fight.race, mh: mh?.name ?? '' });
    }
  }
  console.log(`\nTotal: real ${((realCrit / realSwings) * 100).toFixed(1)}% of ${realSwings} swings, sim ${((simCrit / simSwings) * 100).toFixed(1)}%`);
  // Swing-weighted gap (real - sim) by group, and its correlation with agility.
  const gapBy = (key: (r: (typeof rows)[0]) => string) => {
    const groups = new Map<string, { gap: number; n: number; players: number }>();
    for (const r of rows) {
      const g = groups.get(key(r)) ?? { gap: 0, n: 0, players: 0 };
      g.gap += (r.real - r.sim) * r.n;
      g.n += r.n;
      g.players++;
      groups.set(key(r), g);
    }
    for (const [k, g] of groups) console.log(`  ${k.padEnd(32)} gap ${((g.gap / g.n) * 100).toFixed(1)} pts  (${g.players} players, ${g.n} swings)`);
  };
  console.log('\nBy talent split:'); gapBy((r) => r.split);
  console.log('By race:'); gapBy((r) => r.race);
  console.log('By agility:'); gapBy((r) => (r.agi < 450 ? 'agi < 450' : r.agi < 520 ? 'agi 450-519' : 'agi >= 520'));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const gaps = rows.map((r) => r.real - r.sim), agis = rows.map((r) => r.agi);
  const mg = mean(gaps), ma = mean(agis);
  const cov = mean(rows.map((_, i) => (gaps[i] - mg) * (agis[i] - ma)));
  const corr = cov / Math.sqrt(mean(gaps.map((g) => (g - mg) ** 2)) * mean(agis.map((a) => (a - ma) ** 2)));
  console.log(`Correlation of crit gap with agility: ${corr.toFixed(2)}`);

  // Attack table outside Recklessness. WCL hitTypes: 0 miss, 1 hit, 2 crit, 6 glance, 7 dodge, 8 parry.
  const WCL: Record<string, number> = { miss: 0, hit: 1, crit: 2, glance: 6, dodge: 7, parry: 8 };
  for (const kind of ['white', 'yellow'] as const) {
    const r = tally.real[kind], s = tally.sim[kind];
    const rt = Object.values(r).reduce((a, b) => a + b, 0), st = Object.values(s).reduce((a, b) => a + b, 0);
    console.log(`\n${kind} attack table (real n=${rt}): ` +
      Object.keys(WCL).map((k) => `${k} ${(((r[WCL[k]] ?? 0) / rt) * 100).toFixed(1)}/${(((s[k] ?? 0) / st) * 100).toFixed(1)}`).join('  ') + '   (real/sim %)');
  }
} else {
  console.log('Usage: sim-vs-log.ts boss <encounterId> [count] | player <report> <fight> <source>');
}
