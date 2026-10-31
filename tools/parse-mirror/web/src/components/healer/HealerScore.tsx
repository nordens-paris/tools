import { SCORE_METRICS, healerScore, reliability, type HealerScore } from '../../../../shared/healerScore.ts';
import type { HealerAnalysis } from '../../../../shared/types.ts';
import { wclUrl } from '../../format.ts';
import { REQUESTS_PER_KILL, heldBackOn, scoreRef, splitOf, useRollingScore } from '../../healerHistory.ts';
import { Hint } from '../Hint.tsx';

const tone = (v: number) => (v >= 60 ? 'good' : v <= 40 ? 'bad' : 'neutral');
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function steadiness(kills: number) {
  if (kills < 8) return 'Few kills: expect it to move';
  if (kills < 24) return 'Settling';
  return 'Steady';
}

function Big({ label, value, sub, hint }: { label: string; value?: number; sub: string; hint?: string }) {
  return (
    <div className="kpi">
      <div className="eyebrow">
        {label}
        {hint && <Hint text={hint} />}
      </div>
      <div className="kpi-value">
        {value === undefined ? '–' : Math.round(value)}
        {value !== undefined && <span className={`delta ${tone(value)}`}>{value >= 60 ? 'above most' : value <= 40 ? 'below most' : 'middle'}</span>}
      </div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

/**
 * The healer score for this kill and over the four weeks up to it: percentiles among healers of
 * the same spec in other raids, after taking out what the raid decides (see shared/healerScore.ts).
 */
export function HealerScorePanel({ analysis: a }: { analysis: HealerAnalysis }) {
  const rolling = useRollingScore(a);
  const spec = scoreRef.specs[a.you.specLabel];
  const mine = a.scores?.find((s) => s.name === a.you.name)?.inputs;
  const kill: HealerScore | undefined = a.kill && mine ? healerScore(mine, scoreRef, a.encounter.id) : undefined;
  const n = rolling.kills.length;
  const mean = (get: (s: HealerScore) => number | undefined) => {
    const xs = rolling.kills.map((k) => get(k.score)).filter((v): v is number => v !== undefined);
    return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : undefined;
  };
  const weeks = n ? mean((s) => s.score) : undefined;
  const split = a.kill && a.scores?.length ? splitOf(a.scores, a.encounter.id) : undefined;
  // Kills and wipes: against each healer's usual share on the kills this browser has.
  const held = a.scores?.length ? heldBackOn({ report: a.report, encounterId: a.encounter.id, startTime: a.startTime, healers: a.scores }, rolling.stored) : [];
  const youHeld = held.find((h) => h.name === a.you.name);
  const othersHeld = held.filter((h) => h.name !== a.you.name);
  const why = (h: (typeof held)[number]) => {
    const you = h.name === a.you.name;
    const pct = h.usual ? Math.round((h.share / h.usual) * 100) : 0;
    if (h.why === 'share') return `${you ? 'you' : h.name} did ${pct}% of ${you ? 'your' : 'their'} usual share of the healing`;
    if (h.why === 'boost')
      return `${you ? 'you' : h.name} did ${pct}% of ${you ? 'your' : 'their'} usual share and ${you ? 'were' : 'was'} idle ${Math.round(h.idleVs! * 100)} points more than usual, while ${h.boosted!.name === a.you.name ? 'you' : h.boosted!.name} did ${h.boosted!.rel.toFixed(1)}× ${h.boosted!.name === a.you.name ? 'your' : 'their'} usual`;
    return `${you ? 'you were' : `${h.name} was`} idle ${Math.round(h.idleVs! * 100)} points more than the other healers while someone was low`;
  };
  const outReason = (k: (typeof rolling.leftOut)[number]) =>
    k.heldBack.length ? `Held back: ${k.heldBack.map((h) => h.name).join(', ')}` : k.split?.uneven ? `Uneven split ${times(k.split.spread)}` : '';
  const left = rolling.leftOut.length;
  const listed = [...rolling.kills, ...rolling.leftOut].sort((x, y) => y.startTime - x.startTime);
  const times = (v: number) => `${v.toFixed(1)}×`;

  const killSub = !a.kill
    ? 'Only kills are scored'
    : !spec
      ? `No ${a.you.specLabel}s in the reference pool yet`
      : kill && held.length
        ? `${youHeld ? 'You' : 'A healer'} held back: not in the 4-week score`
        : kill && split?.uneven
        ? 'Uneven healing split: not in the 4-week score'
        : kill
          ? 'One kill is a rough read'
        : 'Too little measured on this kill';
  const weeksSub =
    (n ? `${n} kill${n === 1 ? '' : 's'} · ${steadiness(n)}` : rolling.loading ? 'Finding your kills…' : 'No scored kills yet') +
    (left ? ` · ${left} left out` : '');

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Healer score</h2>
          <p className="sub">
            How you heal compared with {spec ? `${spec.healers} ${a.you.specLabel}s` : 'healers of your spec'} in other raids, after taking out what your raid decides for you: damage
            taken per healer, number of healers, kill length and time on tanks. 50 is the middle.
          </p>
        </div>
      </div>
      <div className="kpis three">
        <Big label="This kill" value={kill?.score} sub={killSub} />
        <Big
          label="Last 4 weeks"
          value={weeks}
          sub={weeksSub}
          hint={`The average over your kills in the four weeks up to this raid. One week's kills against the next were 0.49 alike, so ${n || 'a few'} kill${n === 1 ? '' : 's'} give about ${reliability(Math.max(n, 1)).toFixed(2)}; 32 kills about 0.8.`}
        />
        <div className="kpi">
          <div className="eyebrow">Your kills</div>
          {rolling.fetching ? (
            <>
              <div className="kpi-value">
                {rolling.fetching.done}
                <span className="unit">of {rolling.fetching.of}</span>
              </div>
              <div className="kpi-bar">
                <div style={{ width: `${(rolling.fetching.done / Math.max(1, rolling.fetching.of)) * 100}%` }} />
              </div>
              <div className="kpi-sub">Fetching kills on your key</div>
            </>
          ) : rolling.missing.length > 0 ? (
            <>
              <button className="btn primary" onClick={rolling.fetchMissing}>
                Score {rolling.missing.length} more kill{rolling.missing.length === 1 ? '' : 's'}
              </button>
              <div className="kpi-sub">
                About {rolling.missing.length * REQUESTS_PER_KILL} requests on your key, once: this browser keeps them, for every healer in those kills.
              </div>
            </>
          ) : (
            <>
              <div className="kpi-value">{listed.length}</div>
              <div className="kpi-sub">{rolling.loading ? 'Looking up your ranked kills…' : rolling.history ? `Ranked kills since ${day(rolling.history.from)}, all here` : 'This kill only'}</div>
            </>
          )}
        </div>
      </div>
      {rolling.error && <div className="notes small">Couldn't get all your kills: {rolling.error}</div>}
      {held.length > 0 && (
        <div className="banner warn">
          {youHeld ? 'You look like you held back on this fight: ' : 'A healer looks like they held back on this fight: '}
          {[...(youHeld ? [youHeld] : []), ...othersHeld].map(why).join('; ')}, with a healer score of 35 or lower here. Healers taking turns holding back so
          one gets a high healing parse look like this{a.kill ? ", so the kill is left out of every healer's 4-week score" : ''}. Mechanics can do it too
          (an assignment off the raid, an early death), so it's a hint, not proof.
        </div>
      )}
      {split?.uneven && !held.length && (
        <div className="banner warn">
          The healing on this kill was split far more unevenly than in other raids on {a.encounter.name}. Each healer's share against their spec's usual:{' '}
          {split.shares.map((x) => `${x.name} ${times(x.share)}`).join(', ')}. The top healer did {times(split.spread)} the lowest's; 95% of
          other raids' kills here stay under {times(split.threshold!)}. Healers taking turns holding back so one gets a high parse look like this, so the kill is left out
          of every healer's 4-week score.
        </div>
      )}
      {(kill || n > 0) && (
        <table className="t">
          <thead>
            <tr>
              <th>Part</th>
              <th className="num">This kill</th>
              <th className="num">Last 4 weeks</th>
            </tr>
          </thead>
          <tbody>
            {SCORE_METRICS.map(({ key, label }) => {
              const k = kill?.parts[key];
              const w = mean((s) => s.parts[key]);
              if (k === undefined && w === undefined) return null;
              return (
                <tr key={key}>
                  <td>{label}</td>
                  <td className="num mono">{k === undefined ? '–' : Math.round(k)}</td>
                  <td className="num mono">{w === undefined ? '–' : Math.round(w)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {listed.length > 1 && (
        <details>
          <summary className="small muted">
            The {listed.length} kills{left ? `, ${left} left out (uneven healing split or a healer holding back)` : ''}
          </summary>
          <table className="t">
            <tbody>
              {listed.map((k) => (
                <tr
                  key={`${k.report}:${k.fight}`}
                  className={k.report === a.report && k.fight === a.fight ? 'you' : outReason(k) ? 'muted' : undefined}
                  title={outReason(k) ? `Left out of the 4-week score: ${outReason(k)}` : undefined}
                >
                  <td className="mono small">{day(k.startTime)}</td>
                  <td>
                    <a href={wclUrl(k.report, k.fight)} target="_blank" rel="noreferrer">
                      {k.name}
                    </a>
                  </td>
                  <td className="small muted">{outReason(k) ? `${outReason(k)}, left out` : ''}</td>
                  <td className="num mono">{Math.round(k.score.score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <div className="notes small">
        Percentiles among {scoreRef.pool}. Each part is how you rank on it; the score is the average of the habits (the first four) and HPS for your situation. It measures how you
        heal, not who saved the raid: which heals end up saving someone depends on the fight more than on the healer.
      </div>
    </section>
  );
}
