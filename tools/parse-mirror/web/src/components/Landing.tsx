import { useState } from 'react';

import { parseLogUrl } from '../api.ts';
import { APP_NAME, EXAMPLES, GUILD_NAME, HEALERS, SUPPORTED, specIcon } from '../brand.ts';
import { game } from '../game.ts';
import { lastOpened, parseRoute } from '../route.ts';
import { LogSearch } from './LogSearch.tsx';

const FEATURES = [
  { title: 'Top 10 comparison', text: 'Your kill next to the best parses of your spec, or players with your gear who did a bit better.' },
  { title: 'Rotation & cooldowns', text: 'Casts per minute, uptimes, gaps between casts and when you pressed your cooldowns.' },
  { title: 'Sim what-ifs', text: 'WoWSims, in your browser, shows what their gear, consumes and buffs are worth to you.' },
  { title: 'Healers, judged fairly', text: 'Mana, overheal you chose, reactions and deaths, next to healers from clean raids with as many healers as yours.' },
  { title: 'Your raid, or everyone’s', text: 'Every boss: parses, consumes, gear and party; for officers also debuffs, parties and healers.' },
  { title: 'Luck, measured', text: 'Crits, misses and procs against the sim, so you can tell bad luck from bad play.' },
];

interface Props {
  onAnalyze: (r: string, f: number, s: number) => void;
  onRaid: (r: string, s: number) => void;
  onGuild: (r: string) => void;
  loading: boolean;
}

export function Landing({ onAnalyze, onRaid, onGuild, loading }: Props) {
  const [key, setKey] = useState(0);
  const [initialUrl, setInitialUrl] = useState('');
  const last = lastOpened();
  const openLast = () => {
    const r = parseRoute(new URL(last!.url, window.location.origin).search);
    if (r.view === 'analysis') onAnalyze(r.report, r.fight, r.source);
    else if (r.view === 'raid' || r.view === 'progress') onRaid(r.report, r.source);
    else if (r.view === 'guild') onGuild(r.report);
  };

  const runExample = (url: string) => {
    const p = parseLogUrl(url);
    setInitialUrl(url);
    setKey((k) => k + 1);
    if (p.report && p.fight && p.source) onAnalyze(p.report, p.fight, p.source);
    else if (p.report && p.source) onRaid(p.report, p.source);
  };

  return (
    <section className="landing">
      <img className="emblem-lg" src="/emblem.png" alt={GUILD_NAME} />
      <div>
        <div className="eyebrow">{GUILD_NAME}</div>
        <h1>{APP_NAME}</h1>
      </div>
      <p className="lede">
        Paste a raid log to see how you did on every boss, or a single kill to see what the top 10 players of your spec do differently and what it's worth in DPS. Healers are compared with healers from clean raids like theirs.
      </p>
      <div className="preview-note" role="note">
        <span className="preview-tag">Preview</span>
        <span>
          Works with <strong>{game.name}</strong> logs from {game.wclHost} only. It's a test run of what we're building for <strong>WoW Forever</strong>, so expect rough edges.
        </span>
      </div>
      <LogSearch key={key} variant="hero" onAnalyze={onAnalyze} onRaid={onRaid} onGuild={onGuild} loading={loading} initialUrl={initialUrl} />
      {last && (
        <button className="ghost continue" onClick={openLast} disabled={loading}>
          Continue: {last.label} →
        </button>
      )}
      <div className="example-groups">
        {[
          { label: 'Try a kill:', list: EXAMPLES.filter((ex) => ex.url.includes('fight=')) },
          { label: 'Or a whole raid:', list: EXAMPLES.filter((ex) => !ex.url.includes('fight=')) },
        ].map((group) => (
          <div key={group.label} className="examples">
            <span className="examples-label">{group.label}</span>
            {group.list.map((ex) => (
              <button key={ex.url} className="example" onClick={() => runExample(ex.url)} disabled={loading}>
                <img src={ex.icon} alt="" />
                {ex.label}
              </button>
            ))}
          </div>
        ))}
      </div>
      {loading && (
        <div className="loading">
          <div className="spinner" />
          <div style={{ textAlign: 'left' }}>
            <strong>Fetching logs…</strong>
            <div className="muted small">Pulling the fight and the players to compare with. The first run takes 10–30 s, then it's cached.</div>
          </div>
        </div>
      )}
      <div className="features">
        {FEATURES.map((f) => (
          <div key={f.title} className="feature">
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        ))}
      </div>
      <div className="supported">
        Supported:
        {SUPPORTED.map((s) => (
          <span key={s.specName} className="spec-chip">
            <img src={specIcon(s.className, s.specName)} alt="" />
            {s.specName} {s.className}
          </span>
        ))}
      </div>
      <div className="supported">
        {game.healersNeedOwnKey ? 'Healers (with your own API key):' : 'Healers:'}
        {HEALERS.map((s) => (
          <span key={`${s.specName} ${s.className}`} className="spec-chip">
            <img src={specIcon(s.className, s.specName)} alt="" />
            {s.specName} {s.className}
          </span>
        ))}
      </div>
    </section>
  );
}
