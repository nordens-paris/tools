import { useState } from 'react';

import { getReport, parseLogUrl, type ReportInfo } from '../api.ts';

interface Props {
  variant: 'hero' | 'compact';
  onAnalyze: (report: string, fight: number, source: number) => void;
  /** The whole raid for one player: every boss kill in the report. */
  onRaid: (report: string, source: number) => void;
  /** Everyone in the report on every boss. */
  onGuild: (report: string) => void;
  loading: boolean;
  initialUrl?: string;
}

/** Fight select value for "every boss in the report". */
const WHOLE_RAID = 0;

/**
 * Log link input. A link with fight and player opens that fight; a player without a fight opens the
 * raid overview. Otherwise it lets you pick them from the report.
 */
export function LogSearch({ variant, onAnalyze, onRaid, onGuild, loading, initialUrl = '' }: Props) {
  const [url, setUrl] = useState(initialUrl);
  const [report, setReport] = useState<ReportInfo & { code: string }>();
  const [fight, setFight] = useState<number>(WHOLE_RAID);
  const [error, setError] = useState<string>();

  const submit = async (e?: React.FormEvent, value = url) => {
    e?.preventDefault();
    setError(undefined);
    const parsed = parseLogUrl(value);
    if (!parsed.report) {
      setError('That doesn’t look like a Warcraft Logs report link.');
      return;
    }
    if (parsed.source) {
      setReport(undefined);
      if (parsed.fight) onAnalyze(parsed.report, parsed.fight, parsed.source);
      else onRaid(parsed.report, parsed.source);
      return;
    }
    try {
      const info = await getReport(parsed.report);
      setReport({ ...info, code: parsed.report });
      setFight(parsed.fight ?? WHOLE_RAID);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const kills = report?.fights.filter((f) => f.kill) ?? [];
  const players = (report?.players ?? [])
    .filter((p) => (fight === WHOLE_RAID ? kills.some((k) => p.fights.includes(k.id)) : p.fights.includes(fight)))
    .sort((a, b) => Number(b.supported) - Number(a.supported) || a.name.localeCompare(b.name));

  const pick = (source: number) => {
    if (!report) return;
    if (fight === WHOLE_RAID) onRaid(report.code, source);
    else onAnalyze(report.code, fight, source);
    setReport(undefined);
  };

  const picker = report && (
    <div className={`picker ${variant === 'compact' ? 'popover' : ''}`}>
      <div className="picker-head">
        <div className="eyebrow">{report.title}</div>
        {variant === 'compact' && (
          <button className="ghost small" onClick={() => setReport(undefined)} aria-label="Close">
            ✕
          </button>
        )}
      </div>
      <select value={fight} onChange={(e) => setFight(Number(e.target.value))} aria-label="Boss fight">
        <option value={WHOLE_RAID}>Whole raid · {kills.length} boss kills</option>
        {report.fights.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name} {f.kill ? '(kill)' : '(wipe)'} · {Math.round(f.durationSec)}s
          </option>
        ))}
      </select>
      {fight === WHOLE_RAID && (
        <button
          className="primary"
          disabled={loading}
          onClick={() => {
            onGuild(report.code);
            setReport(undefined);
          }}
        >
          Everyone on every boss →
        </button>
      )}
      <div className="muted small">{fight === WHOLE_RAID ? 'Or pick a player to see their boss kills:' : 'Pick a player:'}</div>
      <div className="picker-players">
        {players.map((p) => (
          <button
            key={p.id}
            // The raid overview works for any class; the full analysis needs a supported spec.
            disabled={(fight !== WHOLE_RAID && !p.supported) || loading}
            title={p.supported ? '' : `${p.icon.replace('-', ' ')} isn't supported yet`}
            onClick={() => pick(p.id)}
          >
            <span className={`cls-${p.icon.split('-')[0]}`}>{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  );

  if (variant === 'compact') {
    return (
      <div className="top-search-wrap">
        <form className="top-search" onSubmit={submit}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste another log link…" spellCheck={false} aria-label="Warcraft Logs link" />
          <button type="submit" disabled={loading || !url}>
            Analyze
          </button>
        </form>
        {error && <div className="banner error popover">{error}</div>}
        {picker}
      </div>
    );
  }

  return (
    <>
      <form className="search" onSubmit={submit}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a Warcraft Logs link: a whole raid or one fight"
          spellCheck={false}
          aria-label="Warcraft Logs link"
          autoFocus
        />
        <button type="submit" className="primary" disabled={loading || !url}>
          {loading ? 'Analyzing…' : 'Analyze'}
        </button>
      </form>
      {error && <div className="banner error">{error}</div>}
      {picker}
    </>
  );
}
