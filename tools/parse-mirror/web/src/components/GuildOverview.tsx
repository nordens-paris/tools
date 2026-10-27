import { useState } from 'react';

import type { GuildFight, GuildSummary } from '../../../shared/types.ts';
import { downloadCsv } from '../csv.ts';
import { fmt, itemIcon, wclReportUrl, wclUrl } from '../format.ts';
import { Hint } from './Hint.tsx';
import { DebuffsPanel, GearPanel, PartiesPanel, PlayerName, shortBoss } from './RaidChecks.tsx';
import { pctClass } from './RaidOverview.tsx';
import { HealerRaidPanel } from './healer/HealerRaid.tsx';

const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

type Player = GuildSummary['players'][number];
type Used = NonNullable<GuildFight['consumes']>['used'][number];

/** Missing pre-pull consumes on one kill, as short labels. */
function missing(c: GuildFight | undefined): string[] {
  if (!c?.consumes) return [];
  return [c.consumes.flask === 'none' && 'flask or elixir', !c.consumes.food && 'food', c.consumes.weapon === false && 'weapon oil'].filter(Boolean) as string[];
}

// What the grid shows per kill.
const VIEWS = {
  parse: 'Parse',
  all: 'All consumes',
  flask: 'Flask & elixirs',
  food: 'Food',
  weapon: 'Weapon oils & stones',
  scroll: 'Scrolls',
  potions: 'Potions & runes',
} as const;
type View = keyof typeof VIEWS;

/** The icons a view shows for one kill. */
function iconsFor(view: View, c: GuildFight): { name: string; icon?: string }[] {
  const used = c.consumes?.used ?? [];
  const of = (...cats: Used['category'][]) => used.filter((u) => cats.includes(u.category));
  if (view === 'flask') return of('Flask', 'Elixir');
  if (view === 'food') return of('Food');
  if (view === 'weapon') return of('Weapon');
  if (view === 'scroll') return of('Scroll');
  if (view === 'potions') return c.potions;
  return [...of('Flask', 'Elixir', 'Food', 'Weapon', 'Scroll'), ...c.potions];
}

/** Whether an empty or partial cell is a problem worth colouring for this player. */
function cellState(view: View, c: GuildFight, p: Player): 'bad' | 'half' | '' {
  if (!c.consumes && view !== 'potions') return '';
  if (view === 'flask') return c.consumes!.flask === 'none' ? 'bad' : c.consumes!.flask === 'half' ? 'half' : '';
  if (view === 'food') return c.consumes!.food ? '' : 'bad';
  if (view === 'weapon') return c.consumes!.weapon === false ? 'bad' : '';
  if (view === 'potions') return p.dps && !c.potions.length ? 'bad' : '';
  if (view === 'all') return missing(c).length ? 'bad' : c.consumes!.flask === 'half' ? 'half' : '';
  return '';
}

/** Everyone in a raid on every boss kill: parse or consumes per kill, plus the officer checks. */
export function GuildOverview({ guild, onRaid, onFight }: { guild: GuildSummary; onRaid: (source: number) => void; onFight: (fight: number, source: number) => void }) {
  const [showAll, setShowAll] = useState(false);
  const [view, setView] = useState<View>('parse');
  const shown = guild.players.filter((p) => showAll || p.dps);
  const medianOf = (p: Player) => median(Object.values(p.fights).flatMap((f) => (f.percentile !== undefined ? [f.percentile] : [])));
  const rows = shown.map((p) => ({ p, med: medianOf(p), missed: Object.values(p.fights).reduce((n, f) => n + (missing(f).length ? 1 : 0), 0) }));
  if (!showAll) rows.sort((a, b) => (b.med ?? -1) - (a.med ?? -1));

  const dps = guild.players.filter((p) => p.dps);
  const raidMedian = median(dps.flatMap((p) => Object.values(p.fights).flatMap((f) => (f.percentile !== undefined ? [f.percentile] : []))));
  const cells = guild.players.flatMap((p) => Object.values(p.fights)).filter((f) => f.consumes);
  const fullyConsumed = cells.filter((f) => !missing(f).length).length;
  const missCounts = new Map<string, number>();
  for (const f of cells) for (const m of missing(f)) missCounts.set(m, (missCounts.get(m) ?? 0) + 1);
  const mostMissed = [...missCounts].sort((a, b) => b[1] - a[1])[0];
  const gearToFix = guild.players.filter((p) => p.gearIssues.length).length;
  const lowDebuffs = guild.debuffs.reduce((n, d) => n + guild.bosses.filter((b) => (d.uptime[b.fight] ?? 0) < d.target - 25).length, 0);
  const dpsKills = dps.flatMap((p) => Object.values(p.fights));
  const potionShare = dpsKills.length ? (dpsKills.filter((f) => f.potions.length).length / dpsKills.length) * 100 : undefined;

  const names = (xs: { name: string }[]) => xs.map((x) => x.name).join('; ');
  const exportCsv = () =>
    downloadCsv(`${guild.title}-everyone.csv`, [
      ['Player', 'Spec', ...guild.bosses.flatMap((b) => [`${b.name} parse`, `${b.name} DPS`, `${b.name} consumes`, `${b.name} potions`]), 'Median parse', 'Kills missing consumes'],
      ...rows.map(({ p, med, missed }) => [
        p.name,
        p.icon.replace('-', ' '),
        ...guild.bosses.flatMap((b) => {
          const c = p.fights[b.fight];
          return [c?.percentile, c?.dps, c ? names(c.consumes?.used ?? []) : undefined, c ? names(c.potions) : undefined];
        }),
        med,
        missed,
      ]),
    ]);

  const tooltip = (p: Player, bossName: string, c: GuildFight) => {
    const miss = missing(c);
    return [
      `${p.name} on ${bossName}: ${fmt(c.dps)} DPS${c.percentile !== undefined ? `, parse ${fmt(c.percentile)}` : ''}`,
      c.consumes ? `Buffs: ${names(c.consumes.used) || 'none'}` : 'Out of range at the pull',
      `Potions: ${names(c.potions) || 'none'}`,
      miss.length ? `Missing: ${miss.join(', ')}` : '',
      c.consumes?.flask === 'half' ? 'Only one elixir' : '',
    ]
      .filter(Boolean)
      .join('\n')
      .replaceAll('; ', ', ');
  };

  return (
    <>
      <section className="report-head">
        <div className="report-title">
          <div className="eyebrow">Whole raid</div>
          <h1>{guild.title}</h1>
          <div className="report-meta">
            <span className="pill acc">{guild.bosses.length} boss kills</span>
            <span className="pill">
              {dps.length} DPS · {guild.players.length - dps.length} healers/tanks
            </span>
          </div>
        </div>
        <div className="head-actions">
          <button onClick={exportCsv}>Export CSV</button>
          <a className="btn" href={wclReportUrl(guild.report)} target="_blank" rel="noreferrer">
            Warcraft Logs ↗
          </a>
        </div>
      </section>

      <section className="kpis four">
        <div className="kpi">
          <span className="eyebrow">Median DPS parse</span>
          <span className={`kpi-value ${raidMedian !== undefined ? pctClass(raidMedian) : ''}`}>{raidMedian !== undefined ? fmt(raidMedian) : '–'}</span>
          <span className="kpi-sub">Over every DPS player and boss</span>
        </div>
        <div className="kpi">
          <span className="eyebrow">
            Fully prepared
            <Hint text="Kills where the player had a flask (or a battle and a guardian elixir) and a food buff at the pull, plus a weapon oil for casters and healers. Melee stones aren't checked: a Windfury Totem enchant comes and goes, so the log can't tell them apart." />
          </span>
          <span className="kpi-value">
            {cells.length ? fmt((fullyConsumed / cells.length) * 100) : '–'}
            {cells.length > 0 && <span className="unit">%</span>}
          </span>
          <span className="kpi-sub">
            {mostMissed ? `Most missed: ${mostMissed[0]} (${mostMissed[1]}×)` : 'Everyone came prepared'}
            {potionShare !== undefined && ` · DPS potion on ${fmt(potionShare)}% of kills`}
          </span>
        </div>
        <div className="kpi">
          <span className="eyebrow">Gear to fix</span>
          <span className="kpi-value">
            {gearToFix}
            <span className="unit">players</span>
          </span>
          <span className="kpi-sub">{gearToFix ? 'Missing enchants, empty sockets or low hit' : 'Everyone enchanted and gemmed'}</span>
        </div>
        <div className="kpi">
          <span className="eyebrow">Debuff gaps</span>
          <span className="kpi-value">
            {lowDebuffs}
            <span className="unit">low</span>
          </span>
          <span className="kpi-sub">Raid debuffs well under target, counted per kill</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Everyone, every boss</h2>
            <p className="sub">
              {view === 'parse' ? (
                <>
                  Parse per kill. <span className="miss-dot inline" /> missing flask/elixirs, food or oil; <span className="miss-dot inline half" /> only one elixir.
                </>
              ) : (
                <>
                  What each player had at the pull (potions: drunk during the kill). <span className="cell-bad-swatch" /> missing; <span className="cell-half-swatch" /> only one elixir.
                </>
              )}{' '}
              Hover a cell for details; click a name for their raid{view === 'parse' ? ', a cell for the full comparison' : ''}.
            </p>
          </div>
          <div className="head-actions">
            <select value={view} onChange={(e) => setView(e.target.value as View)} aria-label="Show">
              {Object.entries(VIEWS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <label className="toggle small">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Healers and tanks
            </label>
          </div>
        </div>
        <div className="table-scroll">
          <table className={`t guild ${view === 'parse' ? '' : 'consumes-view'}`}>
            <thead>
              <tr>
                <th>Player</th>
                {guild.bosses.map((b) => (
                  <th key={b.fight} className="num boss-col" title={b.name}>
                    {shortBoss(b.name)}
                  </th>
                ))}
                <th className="num">{view === 'parse' ? 'Median' : 'Kills'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, med }) => {
                const kills = guild.bosses.filter((b) => p.fights[b.fight]);
                const okKills = kills.filter((b) => {
                  const c = p.fights[b.fight];
                  return iconsFor(view, c).length > 0 && cellState(view, c, p) !== 'bad';
                }).length;
                return (
                  <tr key={p.source}>
                    <td className="strong">
                      <button className="link" onClick={() => onRaid(p.source)}>
                        <PlayerName p={p} />
                      </button>
                    </td>
                    {guild.bosses.map((b) => {
                      const c = p.fights[b.fight];
                      if (!c) return <td key={b.fight} className="num muted">·</td>;
                      const title = tooltip(p, b.name, c);
                      if (view !== 'parse') {
                        const icons = iconsFor(view, c);
                        const state = cellState(view, c, p);
                        return (
                          <td key={b.fight} className={`num cons-cell ${state ? `cell-${state}` : ''}`} title={title}>
                            {icons.length ? (
                              <span className="icon-row">
                                {icons.map((x, i) => (
                                  <img key={i} className="ic" src={itemIcon(x.icon ?? 'inv_misc_questionmark')} alt={x.name} />
                                ))}
                              </span>
                            ) : (
                              <span className={state === 'bad' ? '' : 'muted'}>–</span>
                            )}
                          </td>
                        );
                      }
                      const miss = missing(c);
                      const label = c.percentile !== undefined && p.dps ? fmt(c.percentile) : '–';
                      return (
                        <td key={b.fight} className={`num mono ${p.dps && c.percentile !== undefined ? pctClass(c.percentile) : 'muted'}`} title={title}>
                          {p.supported ? (
                            <button className="link cell" onClick={() => onFight(b.fight, p.source)}>
                              {label}
                            </button>
                          ) : (
                            <a href={wclUrl(guild.report, b.fight, p.source)} target="_blank" rel="noreferrer">
                              {label}
                            </a>
                          )}
                          {miss.length > 0 ? (
                            <span className="miss-dot" aria-label={`no ${miss.join(', ')}`} />
                          ) : (
                            c.consumes?.flask === 'half' && <span className="miss-dot half" aria-label="only one elixir" />
                          )}
                        </td>
                      );
                    })}
                    {view === 'parse' ? (
                      <td className={`num mono strong ${med !== undefined && p.dps ? pctClass(med) : 'muted'}`}>{med !== undefined && p.dps ? fmt(med) : '–'}</td>
                    ) : (
                      <td className={`num mono ${okKills < kills.length ? 'muted' : 'up-ok'}`}>
                        {okKills}/{kills.length}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid-2 raid-checks">
        <DebuffsPanel guild={guild} />
        <GearPanel guild={guild} />
      </div>
      <PartiesPanel guild={guild} />
      <HealerRaidPanel report={guild.report} onFight={onFight} />
    </>
  );
}
