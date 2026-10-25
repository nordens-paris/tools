import { useState } from 'react';
import type { SimPlayerResult } from '../../../shared/types.ts';
import { downloadCsv } from '../csv.ts';
import { fmt, fmtSigned, fmtTime } from '../format.ts';
import { Hint } from './Hint.tsx';
import { useGroup } from '../group.ts';

type View = 'gap' | 'execution';

const byRank = (a: SimPlayerResult, b: SimPlayerResult) => (a.rank ?? 0) - (b.rank ?? 0);

/**
 * Two views of the same sims. "DPS gap" splits each player's real DPS difference to you into gear
 * and buffs, kill time, play and luck, which add up exactly. "Execution" is how well each player
 * played their own setup, as a dot plot around the group median.
 */
export function ExecutionChart({ execution }: { execution: SimPlayerResult[] }) {
  const [view, setView] = useState<View>('gap');
  const rows = [...execution].sort(byRank);
  const you = rows.find((e) => !e.rank);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>
            Where the DPS difference comes from
            <Hint text="Every player is simmed with their own gear, talents, consumes and raid buffs. What the sim can't explain is how they played, or luck." />
          </h2>
        </div>
        <div className="head-actions">
          <div className="segmented">
            <button aria-pressed={view === 'gap'} onClick={() => setView('gap')}>
              DPS gap
            </button>
            <button aria-pressed={view === 'execution'} onClick={() => setView('execution')}>
              Execution
            </button>
          </div>
          <button
            className="ghost"
            onClick={() =>
              downloadCsv('execution.csv', [
                ['Rank', 'Player', 'Kill time s', 'Real DPS', 'Sim DPS', 'Sim DPS on your kill time', 'Luck DPS', 'Execution %', 'Luck removed %'],
                ...rows.map((e) => [e.rank ?? 'you', e.name, e.durationSec ?? '', e.actualDps, e.simDps, e.simDpsOnYourTime ?? '', e.luck.luckDps, e.relativePct, e.luckAdjustedPct]),
              ])
            }
          >
            Export CSV
          </button>
        </div>
      </div>
      {view === 'gap' && you ? <GapView rows={rows} you={you} /> : <ExecutionView rows={rows} />}
    </section>
  );
}

// What an average above (more for them) or below zero (more for you) means, per part.
const MEANING: Record<string, [string, string]> = {
  gear: ['their gear and buffs sim higher', 'your gear and buffs sim higher'],
  kill: ['their kills were shorter', 'their kills were longer'],
  play: ['they got more out of their setup', 'you got more out of your setup'],
  luck: ['they were luckier', 'you were luckier'],
};

const PARTS = [
  { key: 'gear', label: 'Gear & buffs', cls: 'gear', hint: 'What the sim says their gear, talents, consumes and raid buffs (Power Infusion included) are worth over yours, on your kill time.' },
  { key: 'kill', label: 'Kill time', cls: 'kill', hint: 'How much their kill length changes the sim’s number. On a short kill, cooldowns, trinkets and Bloodlust cover more of the fight, so DPS is higher.' },
  { key: 'play', label: 'Play', cls: 'play', hint: 'How much more of their setup’s simmed DPS they turned into real DPS than you did, with luck taken out.' },
  { key: 'luck', label: 'Luck', cls: 'luck', hint: 'Their crits, hits, resists and procs compared with average, minus yours.' },
] as const;
type PartKey = (typeof PARTS)[number]['key'];

function parts(e: SimPlayerResult, you: SimPlayerResult): Record<PartKey, number> {
  const play = (p: SimPlayerResult) => p.actualDps - p.luck.luckDps - p.simDps;
  // Older saved results have no sim on your kill time; then kill time stays inside "gear & buffs".
  const onYourTime = e.simDpsOnYourTime ?? e.simDps;
  return {
    gear: onYourTime - you.simDps,
    kill: e.simDps - onYourTime,
    play: play(e) - play(you),
    luck: e.luck.luckDps - you.luck.luckDps,
  };
}

function GapView({ rows, you }: { rows: SimPlayerResult[]; you: SimPlayerResult }) {
  const G = useGroup();
  // Clicking a tile highlights that part in the bars.
  const [focus, setFocus] = useState<PartKey | undefined>();
  const others = rows.filter((e) => e.rank);
  const split = others.map((e) => ({ e, p: parts(e, you) }));
  const extent = Math.max(
    50,
    ...split.flatMap(({ p }) => {
      const v = Object.values(p);
      return [v.filter((x) => x > 0).reduce((s, x) => s + x, 0), -v.filter((x) => x < 0).reduce((s, x) => s + x, 0)];
    }),
  );
  const step = [25, 50, 100, 200, 250, 500, 1000].find((s) => extent / s <= 4) ?? 1000;
  const lim = Math.ceil(extent / step) * step;
  const x = (v: number) => `${((v + lim) / (2 * lim)) * 100}%`;
  const ticks = Array.from({ length: (2 * lim) / step + 1 }, (_, i) => -lim + i * step);
  const avg = (k: PartKey) => (split.length ? split.reduce((s, r) => s + r.p[k], 0) / split.length : 0);

  return (
    <>
      <p className="sub">
        How much more DPS each of {G.noun} did than you ({fmt(you.actualDps)} DPS on the boss), split into four parts that add up to the real difference.
        Kill time is taken out on its own: each player is simmed on their kill time and on yours.
      </p>
      <div className="gap-tiles">
        {PARTS.map((part) => {
          const v = avg(part.key);
          return (
            <button
              key={part.key}
              className={`luck-stat gap-tile ${focus === part.key ? 'on' : ''}`}
              aria-pressed={focus === part.key}
              onClick={() => setFocus(focus === part.key ? undefined : part.key)}
            >
              <span className="eyebrow">
                <i className={`sw gap-${part.cls}`} />
                {part.label}
                <Hint text={part.hint} />
              </span>
              <span className="v">{fmtSigned(v, 0)}</span>
              <span className="muted small">avg DPS vs you · {Math.abs(v) < 10 ? 'about even' : MEANING[part.key][v > 0 ? 0 : 1]}</span>
            </button>
          );
        })}
      </div>
      <div className={`gap-chart ${focus ? `focus-${focus}` : ''}`}>
        <div className="gap-row gap-head">
          <div />
          <div className="exec-axis">
            {ticks.map((t) => (
              <span key={t} style={{ left: x(t) }} className={t === 0 ? 'strong' : ''}>
                {t === 0 ? 'You' : fmtSigned(t, 0)}
              </span>
            ))}
          </div>
          <div className="eyebrow num">Kill</div>
          <div className="eyebrow num">Gap</div>
        </div>
        {split.map(({ e, p }) => {
          let pos = 0;
          let neg = 0;
          const total = e.actualDps - you.actualDps;
          return (
            <div key={`${e.name}-${e.rank}`} className="gap-row">
              <div className="cd-name">
                <span className="rank">#{e.rank}</span>
                {e.name}
              </div>
              <div className="exec-plot">
                {ticks.map((t) => (
                  <i key={t} className={`exec-grid ${t === 0 ? 'hundred' : ''}`} style={{ left: x(t) }} />
                ))}
                {PARTS.map((part) => {
                  const v = p[part.key];
                  if (Math.abs(v) < 0.5) return null;
                  const from = v > 0 ? pos : neg + v;
                  if (v > 0) pos += v;
                  else neg += v;
                  return (
                    <span
                      key={part.key}
                      className={`gap-seg gap-${part.cls}`}
                      style={{ left: x(from), width: `${(Math.abs(v) / (2 * lim)) * 100}%` }}
                      title={`${part.label}: ${fmtSigned(v, 0)} DPS`}
                    />
                  );
                })}
                <span className="gap-total" style={{ left: x(total) }} title={`Real difference: ${fmtSigned(total, 0)} DPS`} />
              </div>
              <div className="num mono muted">{e.durationSec ? fmtTime(e.durationSec) : '–'}</div>
              <div className="num mono strong">{fmtSigned(total, 0)}</div>
            </div>
          );
        })}
      </div>
      <p className="muted small">
        Bars right of “You” are reasons they did more, bars left are reasons they did less (a green bar on the left means you played your setup better than they did theirs); the thin vertical line is the real difference.
        Click a tile to pick out one part. Your kill: {you.durationSec ? fmtTime(you.durationSec) : '–'}.
      </p>
    </>
  );
}

function ExecutionView({ rows }: { rows: SimPlayerResult[] }) {
  const G = useGroup();
  const values = rows.flatMap((e) => [e.relativePct, e.luckAdjustedPct, 100]);
  // Round the axis out to whole 5% steps around everyone.
  const lo = Math.floor((Math.min(...values) - 2) / 5) * 5;
  const hi = Math.ceil((Math.max(...values) + 2) / 5) * 5;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const ticks = Array.from({ length: (hi - lo) / 5 + 1 }, (_, i) => lo + i * 5);
  return (
    <>
      <p className="sub">
        How much of their own setup’s simmed DPS each player turned into real DPS (kill time included, since each is simmed on their own kill). 100% = the median of {G.noun};
        105% means 5% more out of the same setup. <span className="exec-key ring" /> real result, <span className="exec-key dot" /> with crit, hit, resist and proc luck taken out.
      </p>
      <div className="exec-chart">
        <div className="exec-row exec-head">
          <div />
          <div className="exec-axis">
            {ticks.map((t) => (
              <span key={t} style={{ left: x(t) }} className={t === 100 ? 'strong' : ''}>
                {t}%
              </span>
            ))}
          </div>
          <div className="eyebrow num">Real</div>
          <div className="eyebrow num">No luck</div>
        </div>
        {rows.map((e) => {
          const a = Math.min(e.relativePct, e.luckAdjustedPct);
          const b = Math.max(e.relativePct, e.luckAdjustedPct);
          return (
            <div
              key={`${e.name}-${e.rank ?? 'you'}`}
              className={`exec-row ${!e.rank ? 'you' : ''}`}
              title={`${e.name}: ${fmt(e.actualDps)} real vs ${fmt(e.simDps)} simmed DPS. Luck ${fmtSigned(e.luck.luckPct, 1)}%.`}
            >
              <div className="cd-name">
                {e.rank ? <span className="rank">#{e.rank}</span> : <span className="you-tag">You</span>}
                {e.name}
              </div>
              <div className="exec-plot">
                {ticks.map((t) => (
                  <i key={t} className={`exec-grid ${t === 100 ? 'hundred' : ''}`} style={{ left: x(t) }} />
                ))}
                <span className={`exec-luck ${e.luck.luckPct >= 0 ? 'lucky' : 'unlucky'}`} style={{ left: x(a), width: `calc(${x(b)} - ${x(a)})` }} />
                <span className="exec-ring" style={{ left: x(e.relativePct) }} />
                <span className="exec-dot" style={{ left: x(e.luckAdjustedPct) }} />
              </div>
              <div className="num mono">{fmt(e.relativePct)}%</div>
              <div className="num mono strong">{fmt(e.luckAdjustedPct)}%</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
