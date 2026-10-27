import { useEffect, useState } from 'react';

import type { HealerRaidRow, HealerRaidSummary, RaidSummary } from '../../../../shared/types.ts';
import { getGuildHealers } from '../../api.ts';
import { KEY_CHANGED, getApiKey, openKeyForm } from '../../apiKey.ts';
import { game } from '../../game.ts';
import { fmt, fmtTime, wclUrl } from '../../format.ts';
import { Hint } from '../Hint.tsx';
import { iconOf, pct } from './HealerTables.tsx';

const ROLE = { tank: 'Tanks', mixed: 'Both', raid: 'Raid' } as const;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : undefined;
};

/** Whether healer and tank views can run now: always locally, on the hosted site only with the visitor's own key. */
export function useRolesAllowed() {
  const [hasKey, setHasKey] = useState(!!getApiKey());
  useEffect(() => {
    const update = () => setHasKey(!!getApiKey());
    window.addEventListener(KEY_CHANGED, update);
    return () => window.removeEventListener(KEY_CHANGED, update);
  }, []);
  return !game.rolesNeedOwnKey || hasKey;
}

/** On the hosted site, healer and tank views need the visitor's own key; says so with a button to add it. */
export function HealerKeyNote() {
  return (
    <div className="banner info">
      Healer and tank stats fetch other raids' logs, so on this site they use your own Warcraft Logs key (it stays in your browser).{' '}
      <button className="btn small" onClick={openKeyForm}>
        Add your API key
      </button>
    </div>
  );
}

/** Healer KPIs over a player's raid. */
export function HealerRaidKpis({ raid }: { raid: RaidSummary }) {
  const rows = raid.bosses.map((b) => b.healing).filter((h): h is HealerRaidRow => !!h);
  const hpm = median(rows.map((r) => r.healPerMana).filter((v): v is number => v !== undefined));
  const own = median(rows.map((r) => r.ownOverheal));
  const withPotion = rows.filter((r) => r.potions > 0).length;
  const roles = rows.reduce((m, r) => ({ ...m, [r.role]: (m[r.role] ?? 0) + 1 }), {} as Record<string, number>);
  const role = Object.entries(roles).sort((a, b) => b[1] - a[1])[0]?.[0] as keyof typeof ROLE | undefined;
  return (
    <section className="kpis four">
      <div className="kpi">
        <span className="eyebrow">
          Healing per mana
          <Hint text="Median over your kills: effective healing per point of mana spent." />
        </span>
        <span className="kpi-value">{hpm !== undefined ? hpm.toFixed(1) : '–'}</span>
        <span className="kpi-sub">Median over {rows.length} kills</span>
      </div>
      <div className="kpi">
        <span className="eyebrow">
          Overheal by choice
          <Hint text="Heals already bigger than the gap when you committed, as a share of all your healing. Overheal caused by others landing first isn't counted." />
        </span>
        <span className="kpi-value">{own !== undefined ? pct(own) : '–'}</span>
        <span className="kpi-sub">Median over your kills</span>
      </div>
      <div className="kpi">
        <span className="eyebrow">Mana potions & runes</span>
        <span className="kpi-value">
          {withPotion}
          <span className="unit">/ {rows.length} kills</span>
        </span>
        <span className="kpi-sub">Kills with at least one</span>
      </div>
      <div className="kpi">
        <span className="eyebrow">Assignment</span>
        <span className="kpi-value">{role ? ROLE[role] : '–'}</span>
        <span className="kpi-sub">{Object.entries(roles).map(([r, n]) => `${ROLE[r as keyof typeof ROLE]} ${n}`).join(' · ')}</span>
      </div>
    </section>
  );
}

/** A healer's boss kills: healing, efficiency, overheal and mana per kill. */
export function HealerBossTable({ raid, onOpen, loading }: { raid: RaidSummary; onOpen: (fight: number) => void; loading: boolean }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Boss kills</h2>
          <p className="sub">Your healing on each kill. Open a boss to compare with healers of your spec and assignment from well-run raids.</p>
        </div>
      </div>
      <div className="table-scroll">
        <table className="t raid">
          <thead>
            <tr>
              <th>Boss</th>
              <th>Assignment</th>
              <th className="num">HPS</th>
              <th className="num">
                Healing per mana
                <Hint text="Effective healing per point of mana spent." />
              </th>
              <th className="num">
                Overheal
                <Hint text="All overheal, and in brackets the part that was your own choice (heal bigger than the gap when you committed)." />
              </th>
              <th className="num">Mana left</th>
              <th className="num">Potions</th>
              <th className="num">
                Idle
                <Hint text="Seconds not casting while someone you heal was under 70%." />
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {raid.bosses.map((b) => {
              const h = b.healing;
              return (
                <tr key={b.fight}>
                  <td>
                    <a className="strong" href={wclUrl(raid.report, b.fight, raid.player.source).replace('type=damage-done', 'type=healing')} target="_blank" rel="noreferrer">
                      {b.name}
                    </a>
                    <div className="muted small mono">{fmtTime(b.durationSec)}</div>
                  </td>
                  {h ? (
                    <>
                      <td className="small">
                        {ROLE[h.role]} <span className="muted">· {pct(h.tankShare)} on tanks</span>
                      </td>
                      <td className="num mono strong">{fmt(h.hps)}</td>
                      <td className="num mono">{h.healPerMana !== undefined ? h.healPerMana.toFixed(1) : '–'}</td>
                      <td className="num mono">
                        {pct(h.overhealPct)} <span className="muted">({pct(h.ownOverheal)})</span>
                      </td>
                      <td className="num mono">{h.manaEnd !== undefined ? pct(h.manaEnd) : '–'}</td>
                      <td className={`num mono ${h.potions ? '' : 'tone-bad'}`}>{h.potions}</td>
                      <td className="num mono">{h.idleSec.toFixed(0)} s</td>
                    </>
                  ) : (
                    <td colSpan={7} className="muted small">
                      Not healing on this kill
                    </td>
                  )}
                  <td className="num">
                    <button disabled={!h || loading} onClick={() => onOpen(b.fight)}>
                      Analyze
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const VIEWS = [
  { key: 'hpm', label: 'Healing per mana', get: (r: HealerRaidRow) => (r.healPerMana !== undefined ? r.healPerMana.toFixed(1) : '–') },
  { key: 'own', label: 'Overheal by choice', get: (r: HealerRaidRow) => pct(r.ownOverheal) },
  { key: 'mana', label: 'Mana left', get: (r: HealerRaidRow) => (r.manaEnd !== undefined ? pct(r.manaEnd) : '–') },
  { key: 'potions', label: 'Potions', get: (r: HealerRaidRow) => String(r.potions) },
  { key: 'role', label: 'Assignment', get: (r: HealerRaidRow) => `${ROLE[r.role]} ${pct(r.tankShare)}` },
  { key: 'hps', label: 'HPS', get: (r: HealerRaidRow) => fmt(r.hps) },
] as const;

/** Every healer on every boss, loaded on request (about 10 requests per boss). */
export function HealerRaidPanel({ report, onFight }: { report: string; onFight: (fight: number, source: number) => void }) {
  const [data, setData] = useState<HealerRaidSummary>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [view, setView] = useState<(typeof VIEWS)[number]['key']>('hpm');
  const allowed = useRolesAllowed();
  const load = async () => {
    setLoading(true);
    setError(undefined);
    try {
      setData(await getGuildHealers(report));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const healers = new Map<number, HealerRaidRow>();
  for (const b of data?.bosses ?? []) for (const r of b.rows) if (!healers.has(r.source)) healers.set(r.source, r);
  const shown = VIEWS.find((v) => v.key === view)!;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Healers</h2>
          <p className="sub">Each healer on each boss: efficiency, overheal they chose, mana and potions. Open a cell for the full comparison with healers from well-run raids.</p>
        </div>
        {data && (
          <div className="segmented" role="group" aria-label="Healer view">
            {VIEWS.map((v) => (
              <button key={v.key} aria-pressed={view === v.key} onClick={() => setView(v.key)}>
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {!data && !allowed && <HealerKeyNote />}
      {!data && allowed && (
        <div>
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? 'Loading healers…' : 'Show healers'}
          </button>
          <span className="muted small"> Fetches each boss's healing from Warcraft Logs, so it takes a little while the first time.</span>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      {data && (
        <div className="table-scroll">
          <table className="t guild compact">
            <thead>
              <tr>
                <th>Healer</th>
                {data.bosses.map((b) => (
                  <th key={b.fight} className="num" title={`${b.name}: ${b.healers} healers, ${fmt(b.dtpsPerHealer)} damage/s each; deaths: ${b.deaths.window} with time to save, ${b.deaths.fast} fast, ${b.deaths.burst} burst`}>
                    {b.name.split(' ').at(-1)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...healers.values()].map((h) => (
                <tr key={h.source}>
                  <td>
                    <span className="spell-name">
                      <img src={iconOf(h.icon)} alt="" />
                      {h.name}
                    </span>
                  </td>
                  {data.bosses.map((b) => {
                    const r = b.rows.find((x) => x.source === h.source);
                    return (
                      <td key={b.fight} className={`num mono ${view === 'potions' && r && !r.potions ? 'cell-bad' : ''}`}>
                        {r ? (
                          <button className="link cell" onClick={() => onFight(b.fight, h.source)} title={`${h.name} on ${b.name}`}>
                            {shown.get(r)}
                          </button>
                        ) : (
                          <span className="muted">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
