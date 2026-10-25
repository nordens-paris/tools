import { useState } from 'react';

import type { Finding, Severity } from '../../../shared/types.ts';
import { useGroup } from '../group.ts';

const LABEL: Record<Severity, string> = { high: 'Big impact', medium: 'Worth fixing', low: 'Minor', info: 'Context' };
const ICON: Record<Severity, string> = { high: '!!', medium: '!', low: '·', info: 'i' };
const PILL: Record<Severity, string> = { high: 'bad', medium: 'warn', low: '', info: 'acc' };

export function Findings({ findings, warnings }: { findings: Finding[]; warnings: string[] }) {
  const [area, setArea] = useState<string>();
  const G = useGroup();
  const areas = [...new Set(findings.map((f) => f.area))];
  const shown = area ? findings.filter((f) => f.area === area) : findings;
  const actionable = findings.filter((f) => f.severity !== 'info').length;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>What to look at</h2>
          <p className="sub">
            {actionable ? `${actionable} thing${actionable === 1 ? '' : 's'} to improve, ranked by impact.` : `Nothing stands out against ${G.noun}.`}{' '}
            Context items explain differences that aren't about your play.
          </p>
        </div>
      </div>
      {areas.length > 1 && (
        <div className="filter-row">
          <button aria-pressed={!area} onClick={() => setArea(undefined)}>
            All {findings.length}
          </button>
          {areas.map((a) => (
            <button key={a} aria-pressed={area === a} onClick={() => setArea(area === a ? undefined : a)}>
              {a} {findings.filter((f) => f.area === a).length}
            </button>
          ))}
        </div>
      )}
      <ul className="findings">
        {shown.map((f, i) => (
          <li key={i} className={`finding sev-${f.severity}`}>
            <div className="finding-icon">{ICON[f.severity]}</div>
            <div>
              <div className="finding-title">
                {f.title}
                <span className={`pill ${PILL[f.severity]}`}>{LABEL[f.severity]}</span>
                <span className="pill">{f.area}</span>
              </div>
              <div className="finding-detail">{f.detail}</div>
            </div>
          </li>
        ))}
      </ul>
      {warnings.length > 0 && (
        <div className="notes">
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
