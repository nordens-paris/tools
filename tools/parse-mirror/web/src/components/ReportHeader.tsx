import type { ReactNode } from 'react';

import type { AnalysisResult } from '../../../shared/types.ts';
import { specIcon } from '../brand.ts';
import { fmtTime, specLabel, wclUrl } from '../format.ts';

export function ReportHeader({ analysis: a, picker, onRaid }: { analysis: AnalysisResult; picker?: ReactNode; onRaid?: () => void }) {
  const you = a.you;
  return (
    <section className="report-head">
      <img className="spec-icon" src={specIcon(a.spec.className, a.spec.specName)} alt="" />
      <div className="report-title">
        <div className="eyebrow">
          {specLabel(a.spec.specName)} {a.spec.className} · {a.encounter.name}
        </div>
        <h1>
          {you.name}
          {you.server && <span className="server">{you.server}</span>}
        </h1>
        <div className="report-meta">
          <span className={`pill ${you.kill ? 'ok' : 'bad'}`}>
            {you.kill ? 'Kill' : 'Wipe'} · {fmtTime(you.durationSec)}
          </span>
          <span className="pill">{you.race}</span>
          <span className="pill" title={you.talents}>
            Talents {you.talentSplit.join('/')}
            {you.talentSource === 'armory' ? ' · armory' : ' · standard build'}
          </span>
          <span className="pill">ilvl {you.avgItemLevel.toFixed(1)}</span>
          {(you.pets ?? [])
            .filter((p) => p.kind === 'pet' && p.sharePct >= 1)
            .map((p) => (
              <span
                key={p.name}
                className="pill"
                title={`Pet abilities: ${p.abilities.join(', ')}. Its damage counts as yours, in the log and in the sim.${
                  p.uptimePct !== undefined ? ` Attacking ${Math.round(p.uptimePct)}% of the fight (the sim uses the same).` : ''
                }`}
              >
                Pet {p.name}
                {p.family && p.family !== p.name ? ` (${p.family.replace(/([a-z])([A-Z])/g, '$1 $2')})` : ''} · {Math.round(p.sharePct)}% of damage
                {p.uptimePct !== undefined ? ` · up ${Math.round(p.uptimePct)}%` : ''}
              </span>
            ))}
        </div>
      </div>
      <div className="head-actions report-actions">
        {picker}
        {onRaid && (
          <button className="btn" onClick={onRaid} title={`${you.name} on every boss in this raid: parses, consumes, gear and party`}>
            Whole raid →
          </button>
        )}
        <a className="btn" href={wclUrl(you.report, you.fight, you.source)} target="_blank" rel="noreferrer">
          Warcraft Logs ↗
        </a>
      </div>
    </section>
  );
}
