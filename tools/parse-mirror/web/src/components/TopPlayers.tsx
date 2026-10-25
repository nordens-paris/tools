import type { AnalysisResult } from '../../../shared/types.ts';
import { fmt, wclUrl } from '../format.ts';

export function TopPlayers({ analysis }: { analysis: AnalysisResult }) {
  const players = [analysis.you, ...analysis.top];
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Compared players</h2>
          <p className="sub">
            {analysis.comparison.description} {analysis.top.length} {analysis.spec.specName} {analysis.spec.className} kills on {analysis.encounter.name}, from Warcraft Logs rankings.
          </p>
        </div>
      </div>
      <div className="table-scroll">
        <table className="t">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th className="num">DPS</th>
              <th className="num" title="Hit chance from gear, talents and party auras, against the cap for a raid boss">Hit</th>
              <th className="num">Kill time</th>
              <th className="num">{analysis.spec.activityLabel}</th>
              <th className="num">Item level</th>
              <th>Talents</th>
              <th>Race</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={`${p.report}-${p.source}`} className={p === analysis.you ? 'you' : ''}>
                <td>{p.rank ? <span className="rank">#{p.rank}</span> : <span className="you-tag">You</span>}</td>
                <td className="strong">
                  {p.name}
                  {p.server && <span className="muted" style={{ fontWeight: 400 }}> · {p.server}</span>}
                </td>
                <td className="num">
                  {p.powerInfusion && (
                    <span className="pill warn" title={`Got Power Infusion ${p.powerInfusion.uses}× from a priest, worth about ${fmt(p.powerInfusion.dps)} DPS. Without it: ${fmt(p.dps - p.powerInfusion.dps)}.`}>
                      PI +{fmt(p.powerInfusion.dps)}
                    </span>
                  )}{' '}
                  {fmt(p.dps)}
                </td>
                <td className={`num ${p.hit && p.hit.pct < p.hit.capPct - 0.5 ? 'muted' : ''}`} title={p.hit ? `${p.hit.fromRating.toFixed(1)}% from rating${p.hit.extras.length ? `, ${p.hit.extras.join(', ')}` : ''}; cap ${p.hit.capPct}%` : undefined}>
                  {p.hit ? `${fmt(p.hit.pct, 1)}%` : '–'}
                </td>
                <td className="num">{fmt(p.durationSec)}s</td>
                <td className="num">{fmt(p.activePct)}%</td>
                <td className="num">{p.gear.length ? fmt(p.avgItemLevel, 1) : '–'}</td>
                <td>
                  <span className="mono small">{p.talentSplit.join('/')}</span>{' '}
                  <span className={`pill ${p.talentSource === 'armory' ? 'acc' : ''}`} title={p.talents}>
                    {p.talentSource === 'armory' ? 'armory' : 'standard'}
                  </span>
                </td>
                <td>{p.race}</td>
                <td className="num">
                  <a href={wclUrl(p.report, p.fight, p.source)} target="_blank" rel="noreferrer">
                    Log ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
