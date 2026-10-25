import type { AnalysisResult, PlayerFight } from '../../../shared/types.ts';
import { fmt, fmtTime } from '../format.ts';

/**
 * Active time across the fight: green while casting / on the GCD, red for idle gaps.
 * Compact mode shows only you; the full view adds the top players for comparison.
 */
export function CastingTimeline({ analysis: a, compact = false }: { analysis: AnalysisResult; compact?: boolean }) {
  const players = compact ? [a.you] : [a.you, ...a.top];
  const caster = a.spec.caster;
  // The full view puts everyone on one time scale, so kill lengths compare too.
  const maxDur = compact ? a.you.durationSec : Math.max(...players.map((p) => p.durationSec));
  const ticks = Array.from({ length: Math.floor(maxDur / 30) + 1 }, (_, i) => i * 30);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{caster ? 'Gaps between casts' : 'Idle time'}</h2>
          <p className="sub">
            {caster
              ? 'Green is time spent casting, red is time with nothing cast. Some gaps are movement or mechanics; the rest is lost casts.'
              : 'Green is time on the global cooldown, red is longer stretches with nothing used.'}
          </p>
        </div>
        <span className="pill">
          {fmt(a.you.idleSec, 1)}s idle · {fmt(a.you.activePct)}% active
        </span>
      </div>
      <div className={compact ? '' : 'tl-rows'}>
        {!compact && (
          <div className="cd-row cd-head">
            <div className="eyebrow">Player</div>
            <div className="cd-axis">
              {ticks.map((t) => (
                <span key={t} style={{ left: `${(t / maxDur) * 100}%` }}>
                  {fmtTime(t)}
                </span>
              ))}
            </div>
            <div className="eyebrow num">Active</div>
          </div>
        )}
        {players.map((p) => (
          <TimelineRow key={`${p.report}-${p.source}`} player={p} isYou={p === a.you} showName={!compact} maxDur={maxDur} />
        ))}
      </div>
      {a.you.gaps.length > 0 && (
        <div className="gap-list">
          <span className="muted small">Your longest gaps:</span>
          {a.you.gaps.slice(0, compact ? 4 : 8).map((g) => (
            <span key={g.start} className="pill bad">
              {fmt(g.duration, 1)}s at {fmtTime(g.start)}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function TimelineRow({ player, isYou, showName, maxDur }: { player: PlayerFight; isYou: boolean; showName: boolean; maxDur: number }) {
  const timeline = (
    <div>
      <div className={`timeline ${showName ? 'slim' : ''}`} style={{ width: `${(player.durationSec / maxDur) * 100}%` }} title={`${fmt(player.activePct)}% active`}>
        {player.gaps.map((g) => (
          <div
            key={g.start}
            className="gap"
            style={{ left: `${(g.start / player.durationSec) * 100}%`, width: `${(g.duration / player.durationSec) * 100}%` }}
            title={`${fmt(g.duration, 1)}s idle at ${fmtTime(g.start)}`}
          />
        ))}
      </div>
      {!showName && (
        <div className="timeline-axis">
          <span>0:00</span>
          <span>{fmtTime(player.durationSec / 2)}</span>
          <span>{fmtTime(player.durationSec)}</span>
        </div>
      )}
    </div>
  );
  if (!showName) return timeline;
  return (
    <div className={`cd-row tl-row ${isYou ? 'you' : ''}`}>
      <div className="cd-name">
        {player.rank ? <span className="rank">#{player.rank}</span> : <span className="you-tag">You</span>}
        {player.name}
      </div>
      {timeline}
      <div className="cd-dur">{fmt(player.activePct)}%</div>
    </div>
  );
}
