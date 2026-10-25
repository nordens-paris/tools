import { useState } from 'react';

import { CONSUME_CATEGORIES, type AnalysisResult, type ConsumeCategory } from '../../../shared/types.ts';
import { anyIcon } from '../format.ts';
import { useGroup } from '../group.ts';

function ConsumeIcon({ icon }: { icon?: string }) {
  if (!icon) return null;
  return <img className="consume-icon" src={anyIcon(icon)} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />;
}

type Status = 'missing' | 'elixirs' | 'different' | 'same' | 'extra' | 'none';

const STATUS: Record<Status, { label: string; pill: string }> = {
  missing: { label: 'Missing', pill: 'bad' },
  elixirs: { label: 'Elixirs instead', pill: 'warn' },
  different: { label: 'Different choice', pill: 'warn' },
  same: { label: 'Same as theirs', pill: 'ok' },
  extra: { label: 'They rarely use', pill: '' },
  none: { label: '—', pill: '' },
};
const ORDER: Status[] = ['missing', 'elixirs', 'different', 'same', 'extra', 'none'];
// Every alcohol (Kreeg's Stout Beatdown, Dire Drunkard...) shares one row.
const otherKey = (name: string) => (name.startsWith('Alcohol') ? 'Alcohol' : name);

/** Consumables per category: yours vs what the group you're compared with used, differences first. */
export function Consumes({ analysis }: { analysis: AnalysisResult }) {
  const G = useGroup();
  const [showMatrix, setShowMatrix] = useState(false);
  const top = analysis.top;
  const n = top.length;
  const iconOf = new Map([analysis.you, ...top].flatMap((p) => p.consumes.filter((c) => c.icon).map((c) => [c.name, c.icon] as const)));

  // "Other" is a grab bag (runes, smokes, alcohol...), so each of its items gets its own row.
  const otherNames = [...new Set([analysis.you, ...top].flatMap((p) => p.consumes.filter((c) => c.category === 'Other').map((c) => otherKey(c.name))))];
  const groups: { label: string; match: (c: { category: ConsumeCategory; name: string }) => boolean }[] = [
    ...CONSUME_CATEGORIES.filter((c) => c !== 'Other').map((cat) => ({ label: cat as string, match: (c: { category: ConsumeCategory }) => c.category === cat })),
    ...otherNames.map((name) => ({ label: name, match: (c: { category: ConsumeCategory; name: string }) => c.category === 'Other' && otherKey(c.name) === name })),
  ];
  const hasBoth = (cat: ConsumeCategory) => analysis.you.consumes.some((c) => c.category === cat);
  const twoElixirs = hasBoth('Battle Elixir') && hasBoth('Guardian Elixir');

  const rows = groups.map(({ label, match }) => {
    const mine = analysis.you.consumes.filter(match);
    const users = top.filter((p) => p.consumes.some(match)).length;
    const choices = new Map<string, number>();
    for (const p of top) for (const c of p.consumes.filter(match)) choices.set(c.name, (choices.get(c.name) ?? 0) + 1);
    const sorted = [...choices].sort((a, b) => b[1] - a[1]);
    const common = users >= Math.ceil(n * 0.6);
    // Your pick counts as "same" if a fair share of the top players use that exact item.
    const shared = mine.some((m) => (choices.get(m.name) ?? 0) >= Math.max(2, n * 0.4) || m.name === sorted[0]?.[0]);
    let status: Status = 'none';
    if (!mine.length && common) status = label === 'Flask' && twoElixirs ? 'elixirs' : 'missing';
    else if (mine.length && shared) status = 'same';
    else if (mine.length && common) status = 'different';
    else if (mine.length) status = 'extra';
    return { cat: label, mine, users, sorted, status };
  })
    .filter((r) => r.mine.length || r.users)
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));

  const issues = rows.filter((r) => r.status === 'missing' || r.status === 'different').length;

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Consumables</h2>
            <p className="sub">
              Your consumables next to what {G.noun} used, differences first. Drums show up for everyone in the group. Items marked “not simmed” can't be modelled by WoWSims.
            </p>
          </div>
          <span className={`pill ${issues ? 'warn' : 'ok'}`}>{issues ? `${issues} to look at` : `Matches ${G.noun}`}</span>
        </div>
        <div className="consume-list">
          <div className="consume-row consume-head">
            <div>Category</div>
            <div>You</div>
            <div>{G.short === 'Top 10' ? `Top ${n}` : 'Peers'}</div>
            <div>Used by</div>
            <div />
          </div>
          {rows.map((r) => (
            <div key={r.cat} className={`consume-row status-${r.status}`}>
              <div className="strong">{r.cat}</div>
              <div className="chips">
                {r.mine.length ? (
                  r.mine.map((m) => (
                    <span key={m.name} className="chip mine" title={m.simulated ? 'Included in sims' : 'Not modelled by the sim'}>
                      <ConsumeIcon icon={m.icon ?? iconOf.get(m.name)} />
                      {m.name}
                      {!m.simulated && <em>not simmed</em>}
                    </span>
                  ))
                ) : (
                  <span className="missing">None</span>
                )}
              </div>
              <div className="chips">
                {r.sorted.slice(0, 3).map(([name, count]) => (
                  <span key={name} className={`chip ${r.mine.some((m) => m.name === name) ? 'match' : ''}`}>
                    <ConsumeIcon icon={iconOf.get(name)} />
                    {name}
                    <b>{count}</b>
                  </span>
                ))}
                {r.sorted.length > 3 && <span className="muted small">+{r.sorted.length - 3} more</span>}
                {!r.sorted.length && <span className="missing">None</span>}
              </div>
              <div className="adoption">
                <div className="bar-track">
                  <div className="bar" style={{ width: `${(r.users / Math.max(n, 1)) * 100}%` }} />
                </div>
                <span className="mono small">
                  {r.users}/{n}
                </span>
              </div>
              <div>{r.status !== 'none' && <span className={`pill ${STATUS[r.status].pill}`}>{STATUS[r.status].label}</span>}</div>
            </div>
          ))}
        </div>
        <div>
          <button className="ghost" onClick={() => setShowMatrix((s) => !s)} aria-expanded={showMatrix}>
            {showMatrix ? 'Hide' : 'Show'} every player's consumables
          </button>
        </div>
        {showMatrix && <Matrix analysis={analysis} categories={rows.map((r) => r.cat)} />}
      </section>
    </>
  );
}

/**
 * Every player's consumables: one row per category, one column per player, the item's icon in each
 * cell (hover for the name). Your column is highlighted; the last column counts the others who used one.
 */
function Matrix({ analysis, categories }: { analysis: AnalysisResult; categories: string[] }) {
  const players = [analysis.you, ...analysis.top];
  return (
    <div className="table-scroll">
      <table className="cmatrix">
        <thead>
          <tr>
            <th className="cm-cat" />
            {players.map((p) => (
              <th key={`${p.report}-${p.source}`} className={p === analysis.you ? 'you-col' : ''} title={p.name}>
                <span className="cm-rank">{p.rank ? `#${p.rank}` : 'You'}</span>
                <span className="cm-name">{p.name}</span>
              </th>
            ))}
            <th className="cm-count">Used</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => {
            const usesOf = (p: (typeof players)[number]) => p.consumes.filter((c) => c.category === cat || (c.category === 'Other' && c.name === cat));
            const count = analysis.top.filter((p) => usesOf(p).length).length;
            return (
              <tr key={cat}>
                <th className="cm-cat">{cat}</th>
                {players.map((p) => {
                  const uses = usesOf(p);
                  return (
                    <td key={`${p.report}-${p.source}`} className={p === analysis.you ? 'you-col' : ''} title={uses.map((u) => u.name).join(', ') || 'None'}>
                      <div className="cm-cell">
                        {uses.length === 0 && <span className="cm-none" />}
                        {uses.slice(0, 2).map((u) => (u.icon ? <ConsumeIcon key={u.name} icon={u.icon} /> : <span key={u.name} className="cm-dot" />))}
                        {uses.length > 2 && <span className="cm-more">+{uses.length - 2}</span>}
                      </div>
                    </td>
                  );
                })}
                <td className="cm-count mono">
                  {count}/{analysis.top.length}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small" style={{ margin: '6px 0 0' }}>
        Hover an icon to see the item. Empty cells: nothing in that category.
      </p>
    </div>
  );
}
