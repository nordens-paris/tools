import type { AnalysisResult, IdleGap, PlayerFight } from '../../../shared/types.ts';
import { fmt, fmtTime } from '../format.ts';
import { Hint } from './Hint.tsx';

/** Shared = at least half of the players compared with had a gap there (as server/analysis/gaps.ts). */
const sharedGap = (g: IdleGap, compared: number | undefined) => !!compared && (g.sharedBy ?? 0) >= Math.ceil(compared / 2);

function gapTip(g: IdleGap, compared: number | undefined): string {
  const hp = g.bossHpStart !== undefined ? ` (boss ${fmt(g.bossHpStart, 0)}%${g.bossHpEnd !== undefined ? ` → ${fmt(g.bossHpEnd, 0)}%` : ''})` : '';
  const base = `${fmt(g.duration, 1)}s idle at ${fmtTime(g.start)}${hp}`;
  if (!compared || g.sharedBy === undefined) return base;
  if (sharedGap(g, compared)) return `${base}. Shared: ${g.sharedBy} of ${compared} had a gap here (a mechanic or movement)`;
  return `${base}. ${g.sharedBy === 0 ? 'Only you' : `Mostly you: ${g.sharedBy} of ${compared} had a gap here`}`;
}

/**
 * Active time across the fight: green while casting / on the GCD, red for idle gaps only you had,
 * grey for gaps most of the group had too. Compact mode shows only you; the full view adds the top
 * players for comparison.
 */
export function CastingTimeline({ analysis: a, compact = false }: { analysis: AnalysisResult; compact?: boolean }) {
  const players = compact ? [a.you] : [a.you, ...a.top];
  const caster = a.spec.caster;
  // The full view puts everyone on one time scale, so kill lengths compare too.
  const maxDur = compact ? a.you.durationSec : Math.max(...players.map((p) => p.durationSec));
  const ticks = Array.from({ length: Math.floor(maxDur / 30) + 1 }, (_, i) => i * 30);
  const share = a.you.idleShare;
  const by = share?.align === 'hp' ? 'the same boss health' : 'the same time';
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{caster ? 'Gaps between casts' : 'Idle time'}</h2>
          <p className="sub">
            {caster ? 'Green is time spent casting' : 'Green is time on the global cooldown'}
            {share
              ? `. Red gaps are ones most of the group didn't have; grey ones most of them had at ${by} (a mechanic or movement).`
              : caster
                ? ', red is time with nothing cast. Some gaps are movement or mechanics; the rest is lost casts.'
                : ', red is longer stretches with nothing used.'}
          </p>
        </div>
        <span className="pill">
          {fmt(a.you.idleSec, 1)}s idle · {fmt(a.you.activePct)}% active
        </span>
        {share && (
          <span className="pill bad">
            {fmt(share.avoidableSec, 1)}s avoidable{share.avoidableDps !== undefined ? ` · ~${fmt(share.avoidableDps, 0)} DPS` : ''}
            <Hint
              text={`Your idle time in gaps that fewer than half of the ${share.compared} players compared had at ${by}. ${
                share.align === 'hp'
                  ? "Lined up by the boss's health, since phases and most mechanics happen at the same health."
                  : 'Lined up by the clock: on this boss that puts more of the group’s gaps together (timer mechanics).'
              }${share.avoidableDps !== undefined ? ' The DPS is those seconds at your DPS while casting.' : ''}`}
            />
          </span>
        )}
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
            <span key={g.start} className={`pill ${sharedGap(g, share?.compared) ? '' : 'bad'}`} title={gapTip(g, share?.compared)}>
              {fmt(g.duration, 1)}s at {fmtTime(g.start)}
              {share && g.sharedBy !== undefined && (sharedGap(g, share.compared) ? ` · shared ${g.sharedBy}/${share.compared}` : g.sharedBy === 0 ? ' · only you' : '')}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function TimelineRow({ player, isYou, showName, maxDur }: { player: PlayerFight; isYou: boolean; showName: boolean; maxDur: number }) {
  const compared = player.idleShare?.compared;
  const timeline = (
    <div>
      <div className={`timeline ${showName ? 'slim' : ''}`} style={{ width: `${(player.durationSec / maxDur) * 100}%` }} title={`${fmt(player.activePct)}% active`}>
        {player.gaps.map((g) => (
          <div
            key={g.start}
            className={`gap ${sharedGap(g, compared) ? 'shared' : ''}`}
            style={{ left: `${(g.start / player.durationSec) * 100}%`, width: `${(g.duration / player.durationSec) * 100}%` }}
            title={gapTip(g, compared)}
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
