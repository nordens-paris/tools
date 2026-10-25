import type { ReactNode } from 'react';

import type { AnalysisResult } from '../../../shared/types.ts';
import { specIcon } from '../brand.ts';
import { fmtTime, wclUrl } from '../format.ts';

export function ReportHeader({ analysis: a, picker, onRaid }: { analysis: AnalysisResult; picker?: ReactNode; onRaid?: () => void }) {
  const you = a.you;
  return (
    <section className="report-head">
      <img className="spec-icon" src={specIcon(a.spec.className, a.spec.specName)} alt="" />
      <div className="report-title">
        <div className="eyebrow">
          {a.spec.specName} {a.spec.className} · {a.encounter.name}
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
