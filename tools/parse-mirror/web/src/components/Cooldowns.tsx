import { useLayoutEffect, useRef, useState } from 'react';
import type { AnalysisResult, PlayerFight } from '../../../shared/types.ts';
import { abilityIcon, fmt, fmtTime } from '../format.ts';
import { Hint } from './Hint.tsx';

const BLOODLUST = ['Bloodlust', 'Heroism'];
// How long each cooldown lasts when the log has no buff for it.
const DEFAULT_SEC: Record<string, number> = { 'Death Wish': 30, Recklessness: 15, 'Blood Fury': 15, Berserking: 10, Bloodlust: 40, Heroism: 40 };
const LANE_PX = 26;
const ICON_PX = 20;

/** How long a cooldown's buff lasted on average, from the player's buff uptime. */
function durationOf(p: PlayerFight, name: string) {
  const b = p.buffs.find((x) => x.name === name);
  if (b && b.uses > 0 && b.uptimePct > 0) return Math.max(2, ((b.uptimePct / 100) * p.durationSec) / b.uses);
  return DEFAULT_SEC[name] ?? 10;
}

const bloodlustAt = (p: PlayerFight) => p.buffs.find((b) => BLOODLUST.includes(b.name))?.starts?.[0];

type Use = { name: string; icon?: string; color: number; t: number; dur: number };
type Bar = { uses: Use[]; t: number; dur: number; lane: number; width: number };

// Cooldowns started within this many seconds of each other share one bar.
const TOGETHER_SEC = 3;

/**
 * Lays a player's cooldowns out as bars. Cooldowns popped together (within 3 s) become one bar with
 * all their icons, which is how they were used and saves a lane each. Bars then take the first lane
 * they fit in.
 */
function layout(p: PlayerFight, names: string[], icons: Record<string, string | undefined>, pxPerSec: number): { bars: Bar[]; lanes: number } {
  const uses = p.cooldowns
    .filter((c) => names.includes(c.name))
    .flatMap((c) => c.times.map((t) => ({ name: c.name, icon: icons[c.name], color: names.indexOf(c.name), t, dur: Math.min(durationOf(p, c.name), Math.max(1, p.durationSec - t)) })))
    .sort((a, b) => a.t - b.t);
  const groups: Use[][] = [];
  for (const u of uses) {
    const last = groups[groups.length - 1];
    if (last && u.t - last[0].t <= TOGETHER_SEC) last.push(u);
    else groups.push([u]);
  }
  const laneEnds: number[] = [];
  const bars: Bar[] = [];
  for (const g of groups) {
    const t = g[0].t;
    const dur = Math.max(...g.map((u) => u.t + u.dur)) - t;
    const left = t * pxPerSec;
    const width = Math.max(g.length * (ICON_PX + 6) + 4, dur * pxPerSec);
    let lane = laneEnds.findIndex((end) => end + 2 <= left);
    if (lane < 0) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = left + width;
    bars.push({ uses: g, t, dur, lane, width });
  }
  return { bars, lanes: Math.max(1, laneEnds.length) };
}

/**
 * Cooldowns as labelled bars on each player's kill timeline, packed into as few lanes as fit, with
 * Bloodlust as a shaded band behind them.
 */
export function Cooldowns({ analysis }: { analysis: AnalysisResult }) {
  const players = [analysis.you, ...analysis.top];
  const names = [...new Set(players.flatMap((p) => p.cooldowns.map((c) => c.name)))].filter((n) => !BLOODLUST.includes(n));
  const icons = Object.fromEntries(players.flatMap((p) => p.cooldowns.map((c) => [c.name, c.icon])));
  const maxDur = Math.max(...players.map((p) => p.durationSec));
  const topLust = players.filter((p) => p.rank).map(bloodlustAt).filter((t): t is number => t !== undefined);
  const medianLust = topLust.length ? [...topLust].sort((a, b) => a - b)[Math.floor(topLust.length / 2)] : undefined;
  const ticks = Array.from({ length: Math.floor(maxDur / 30) + 1 }, (_, i) => i * 30);

  // Lanes depend on how many pixels a second gets, so measure the track.
  const axisRef = useRef<HTMLDivElement>(null);
  const [trackPx, setTrackPx] = useState(800);
  useLayoutEffect(() => {
    const el = axisRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTrackPx(el.clientWidth || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pxPerSec = trackPx / maxDur;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Cooldown timing</h2>
          <p className="sub">
            Each bar is a cooldown while it was active, on that player's kill timeline (grey = kill length). Cooldowns popped together share a bar, one icon each. The red band is Bloodlust. Hover a bar for exact times.
            {medianLust !== undefined && ` Top players got Bloodlust at ${fmtTime(medianLust)} (median).`}
          </p>
        </div>
      </div>
      <div className="legend cd-legend">
        <span>
          <i className="sw lust" />
          Bloodlust
        </span>
        {names.map((n, i) => (
          <span key={n} className={`k${i % 9}`}>
            {icons[n] && <img src={abilityIcon(icons[n])} alt="" />}
            {n}
          </span>
        ))}
      </div>
      <div className="cd-rows">
        <div className="cd-row cd-head">
          <div className="eyebrow">Player</div>
          <div className="cd-axis" ref={axisRef}>
            {ticks.map((t) => (
              <span key={t} style={{ left: `${(t / maxDur) * 100}%` }}>
                {fmtTime(t)}
              </span>
            ))}
          </div>
          <div className="eyebrow num">
            Lust
            <Hint text="When Bloodlust (or Heroism) went up, as minutes:seconds into the fight. Raids differ: some use it at the pull, some save it for the execute phase." />
          </div>
        </div>
        {players.map((p) => (
          <CooldownRow key={`${p.report}-${p.source}`} player={p} isYou={p === analysis.you} maxDur={maxDur} {...layout(p, names, icons, pxPerSec)} />
        ))}
      </div>
    </section>
  );
}

function CooldownRow({ player, isYou, maxDur, bars, lanes }: { player: PlayerFight; isYou: boolean; maxDur: number; bars: Bar[]; lanes: number }) {
  const lust = bloodlustAt(player);
  const lustDur = durationOf(player, player.buffs.find((b) => BLOODLUST.includes(b.name))?.name ?? 'Bloodlust');
  const pct = (t: number) => `${(t / maxDur) * 100}%`;
  return (
    <div className={`cd-row ${isYou ? 'you' : ''}`}>
      <div className="cd-name">
        {player.rank ? <span className="rank">#{player.rank}</span> : <span className="you-tag">You</span>}
        {player.name}
      </div>
      <div className="cd-track" style={{ height: lanes * LANE_PX }}>
        <div className="cd-fight" style={{ width: pct(player.durationSec) }} />
        {lust !== undefined && (
          <div className="cd-lust" style={{ left: pct(lust), width: pct(Math.min(lustDur, player.durationSec - lust)) }} title={`Bloodlust at ${fmtTime(lust)}`} />
        )}
        {bars.map((b, i) => (
          <span
            key={i}
            className={`cd-bar ${b.uses.length > 1 ? 'kmix' : `k${b.uses[0].color % 9}`}`}
            style={{ left: pct(b.t), width: b.width, top: b.lane * LANE_PX + 1 }}
            title={b.uses.map((u) => `${u.name} at ${fmtTime(u.t)} for about ${fmt(u.dur)} s`).join('\n')}
          >
            {b.uses.map((u, j) => (u.icon ? <img key={j} className={`k${u.color % 9}`} src={abilityIcon(u.icon)} alt={u.name} /> : null))}
          </span>
        ))}
      </div>
      <div className="cd-dur">{lust !== undefined ? fmtTime(lust) : '–'}</div>
    </div>
  );
}
