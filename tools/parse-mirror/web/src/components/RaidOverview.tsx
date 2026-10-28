import type { RaidBoss, RaidSummary } from '../../../shared/types.ts';
import { specIcon } from '../brand.ts';
import { downloadCsv } from '../csv.ts';
import { fmt, fmtSigned, fmtTime, itemIcon, wclReportUrl, wclUrl } from '../format.ts';
import { Hint } from './Hint.tsx';
import { GearChips, PlayerName, classIcon, upClass } from './RaidChecks.tsx';
import { HealerBossTable, HealerKeyNote, HealerRaidKpis } from './healer/HealerRaid.tsx';
import { TankBossTable, TankRaidKpis } from './tank/TankRaid.tsx';

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Warcraft Logs' percentile colours: grey, green, blue, purple, orange, pink, gold. */
export function pctClass(p: number) {
  if (p >= 100) return 'pct-gold';
  if (p >= 99) return 'pct-pink';
  if (p >= 95) return 'pct-orange';
  if (p >= 75) return 'pct-purple';
  if (p >= 50) return 'pct-blue';
  if (p >= 25) return 'pct-green';
  return 'pct-grey';
}

/** What was missing at the pull on one kill (flask/elixirs, food, oil), or only half there. */
function consumeState(b: RaidBoss, dps: boolean): { missing: string[]; half: boolean } {
  const c = b.consumes;
  const missing = c ? ([c.flask === 'none' && 'flask or elixir', !c.food && 'food', c.weapon === false && 'weapon oil'].filter(Boolean) as string[]) : [];
  if (dps && !b.potions.length) missing.push('potion');
  return { missing, half: c?.flask === 'half' };
}

// Titles dropped in the narrow tables ("High Warlord Naj'entus" -> "Naj'entus").
const BOSS_PREFIX = /^(High Warlord|The|Mother|Lady|Fathom-Lord|High Astromancer|Gurtogg|Teron) /;

const date = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** Every boss kill of one player in a report, with their consumes, gear, party and raid next to them. */
interface Props {
  raid: RaidSummary;
  onOpen: (fight: number) => void;
  onProgress: () => void;
  onGuild: () => void;
  loading: boolean;
}

export function RaidOverview({ raid, onOpen, onProgress, onGuild, loading }: Props) {
  const { player, bosses, peers } = raid;
  // A bare class icon ("Priest") gets the spec they healed as, when they healed.
  const [className, specName = ''] = (
    player.icon.includes('-') ? player.icon : (bosses.find((b) => b.tanking)?.tanking?.icon ?? bosses.find((b) => b.healing)?.healing?.icon ?? player.icon)
  ).split('-');
  const ranked = bosses.filter((b) => b.percentile !== undefined).map((b) => b.percentile!);
  const vsTop = bosses.filter((b) => b.topMedianDps).map((b) => (b.dps / b.topMedianDps!) * 100);
  const deltas = bosses.filter((b) => b.percentile !== undefined && b.previous).map((b) => b.percentile! - b.previous!.percentile);
  const ranks = bosses.filter((b) => b.raidRank).map((b) => b.raidRank!);
  const bestRank = [...bosses].filter((b) => b.raidRank).sort((a, b) => a.raidRank!.rank - b.raidRank!.rank)[0];
  const prepared = bosses.filter((b) => b.consumes && !consumeState(b, false).missing.length).length;
  const withInfo = bosses.filter((b) => b.consumes).length;
  const potions = bosses.filter((b) => b.potions.length).length;
  // The weakest kill relative to the top 10 is the best place to start.
  const weakest = bosses.filter((b) => b.topMedianDps).sort((a, b) => a.dps / a.topMedianDps! - b.dps / b.topMedianDps!)[0];
  const debuffCols = bosses[0]?.debuffs ?? [];
  const anyParty = bosses.some((b) => b.party);

  const exportCsv = () =>
    downloadCsv(`${player.name}-${raid.title}.csv`, [
      ['Boss', 'Kill time (s)', 'DPS', 'Top 10 median DPS', 'Parse', 'Previous parse', 'Raid rank', 'Consumes', 'Potions', ...peers.players.map((p) => `${p.name} DPS`)],
      ...bosses.map((b) => [
        b.name,
        b.durationSec,
        b.dps,
        b.topMedianDps,
        b.percentile,
        b.previous?.percentile,
        b.raidRank ? `${b.raidRank.rank}/${b.raidRank.of}` : undefined,
        (b.consumes?.used ?? []).map((u) => u.name).join('; '),
        b.potions.map((p) => p.name).join('; '),
        ...peers.players.map((p) => b.peerDps[p.source]),
      ]),
    ]);

  return (
    <>
      <section className="report-head">
        {specName && <img className="spec-icon" src={specIcon(className, specName)} alt="" onError={(e) => (e.currentTarget.src = classIcon(player.icon))} />}
        <div className="report-title">
          <div className="eyebrow">
            {specName} {className} · {raid.title}
          </div>
          <h1>
            {player.name}
            {player.server && <span className="server">{player.server}</span>}
          </h1>
          <div className="report-meta">
            <span className="pill acc">Whole raid</span>
            <span className="pill">{bosses.length} boss kills</span>
            <span className="pill">{fmt(bosses.reduce((s, b) => s + b.durationSec, 0) / 60, 1)} min on bosses</span>
          </div>
        </div>
        <div className="head-actions">
          <button onClick={onProgress}>Progress over time</button>
          <button onClick={onGuild}>Everyone in this raid</button>
          <a className="btn" href={wclReportUrl(raid.report)} target="_blank" rel="noreferrer">
            Warcraft Logs ↗
          </a>
        </div>
      </section>

      {player.tank ? (
        <TankRaidKpis raid={raid} />
      ) : player.healer ? (
        <HealerRaidKpis raid={raid} />
      ) : (
        <section className="kpis four">
          <div className="kpi">
            <span className="eyebrow">Median parse</span>
            <span className={`kpi-value ${ranked.length ? pctClass(median(ranked)) : ''}`}>
              {ranked.length ? fmt(median(ranked)) : '–'}
              {deltas.length > 0 && <span className={`delta ${median(deltas) >= 0 ? 'good' : 'bad'}`}>{fmtSigned(median(deltas))}</span>}
            </span>
            <span className="kpi-sub">{ranked.length ? `${ranked.length} ranked kills${deltas.length ? ' · change vs your previous kill of each boss' : ''}` : 'No ranked kills found'}</span>
          </div>
          <div className="kpi">
            <span className="eyebrow">DPS vs top 10</span>
            <span className="kpi-value">
              {vsTop.length ? fmt(median(vsTop)) : '–'}
              {vsTop.length > 0 && <span className="unit">%</span>}
            </span>
            <span className="kpi-sub">{weakest ? `Furthest behind on ${weakest.name}` : 'Median over bosses, of the top 10 median DPS'}</span>
          </div>
          <div className="kpi">
            <span className="eyebrow">Place in the raid</span>
            <span className="kpi-value">
              {ranks.length ? `#${fmt(median(ranks.map((r) => r.rank)))}` : '–'}
              {ranks.length > 0 && <span className="unit">of {ranks[0].of}</span>}
            </span>
            <span className="kpi-sub">{bestRank ? `Median DPS place · best #${bestRank.raidRank!.rank} on ${bestRank.name}` : 'Healers and tanks aren’t ranked'}</span>
          </div>
          <div className="kpi">
            <span className="eyebrow">
              Prepared
              <Hint text="Kills with a flask (or a battle and a guardian elixir), food and, for casters and healers, a weapon oil at the pull. Potions count from just before the pull to the kill." />
            </span>
            <span className="kpi-value">
              {prepared}
              <span className="unit">/ {withInfo} kills</span>
            </span>
            <span className="kpi-sub">
              Fully consumed · potion on {potions} of {bosses.length}
            </span>
          </div>
        </section>
      )}

      <section className={`gear-strip ${raid.gearIssues.length ? 'has-issues' : ''}`}>
        <span className="gear-strip-title">
          Gear check
          <Hint text="From your gear on your latest kill. Enchants are checked on the slots everyone can enchant (not rings; ranged only for hunters). Hit is checked for the specs with a full analysis, with standard talents, Draenei auras and Totem of Wrath when an Elemental shaman was in your party." />
        </span>
        {raid.gearIssues.length > 0 ? <GearChips issues={raid.gearIssues} /> : <span className="all-good">✓ Everything enchanted and gemmed</span>}
      </section>

      {player.healerLocked && <HealerKeyNote />}

      {player.tank ? (
        <TankBossTable raid={raid} onOpen={onOpen} loading={loading} />
      ) : player.healer ? (
        <HealerBossTable raid={raid} onOpen={onOpen} loading={loading} />
      ) : (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Boss kills</h2>
              <p className="sub">Your DPS next to the top 10 of your spec and your raid, with what you had at the pull. Open a boss for the full comparison and sims.</p>
            </div>
            <button className="ghost" onClick={exportCsv}>
              Export CSV
            </button>
          </div>
          {bosses.length === 0 ? (
            <p className="muted">No boss kills for this player in the report.</p>
          ) : (
            <div className="table-scroll">
              <table className="t raid">
                <thead>
                  <tr>
                    <th>Boss</th>
                    <th className="num">DPS</th>
                    <th>vs top 10 median</th>
                    <th className="num">Raid</th>
                    <th className="num">
                      Parse
                      <Hint text="Warcraft Logs parse percentile, with the change from your previous kill of the boss. Hover for the previous kill and your best this tier." />
                    </th>
                    <th>Consumes</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {bosses.map((b) => {
                    const pct = b.topMedianDps ? (b.dps / b.topMedianDps) * 100 : undefined;
                    const delta = b.percentile !== undefined && b.previous ? b.percentile - b.previous.percentile : undefined;
                    const state = consumeState(b, player.dps);
                    const icons = [...(b.consumes?.used ?? []), ...b.potions];
                    return (
                      <tr key={b.fight}>
                        <td>
                          <a className="strong" href={wclUrl(raid.report, b.fight, player.source)} target="_blank" rel="noreferrer">
                            {b.name}
                          </a>
                          <div className="muted small mono">
                            {fmtTime(b.durationSec)}
                            {b.topMedianDurationSec !== undefined && ` · ${fmtSigned(b.durationSec - b.topMedianDurationSec)}s vs top 10`}
                          </div>
                        </td>
                        <td className="num mono strong">{fmt(b.dps)}</td>
                        <td>
                          {pct !== undefined ? (
                            <div className="adoption wide">
                              <div className="bar-track">
                                <div className={`bar ${pct >= 95 ? 'good' : pct >= 80 ? 'neutral' : 'bad'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                              </div>
                              <span className="mono small">{fmt(pct)}%</span>
                            </div>
                          ) : (
                            <span className="muted small">–</span>
                          )}
                        </td>
                        <td className="num mono">{b.raidRank ? <span title={`${b.raidRank.rank} of ${b.raidRank.of} DPS players`}>#{b.raidRank.rank}</span> : <span className="muted">–</span>}</td>
                        <td
                          className="num"
                          title={[b.previous && `Previous kill: ${fmt(b.previous.percentile)} (${date(b.previous.startTime)})`, b.bestPercentile !== undefined && `Best this tier: ${fmt(b.bestPercentile)}`].filter(Boolean).join('\n')}
                        >
                          <span className={`mono strong ${b.percentile !== undefined ? pctClass(b.percentile) : 'muted'}`}>{b.percentile !== undefined ? fmt(b.percentile) : '–'}</span>
                          {delta !== undefined && Math.round(delta) !== 0 && <span className={`trend ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? '▲' : '▼'}{fmt(Math.abs(delta))}</span>}
                        </td>
                        <td
                          className={`cons-cell ${state.missing.length ? 'cell-bad' : state.half ? 'cell-half' : ''}`}
                          title={[
                            b.consumes ? `At the pull: ${b.consumes.used.map((u) => u.name).join(', ') || 'nothing'}` : 'Out of range at the pull',
                            `Potions: ${b.potions.map((p) => p.name).join(', ') || 'none'}`,
                            state.missing.length ? `Missing: ${state.missing.join(', ')}` : '',
                            state.half ? 'Only one elixir' : '',
                          ]
                            .filter(Boolean)
                            .join('\n')}
                        >
                          <span className="icon-row start">
                            {icons.map((x, i) => (
                              <img key={i} className="ic" src={itemIcon(x.icon ?? 'inv_misc_questionmark')} alt={x.name} />
                            ))}
                            {state.missing.length > 0 && <span className="miss-label">no {state.missing.join(', ')}</span>}
                          </span>
                        </td>
                        <td className="num">
                          {/* A player who tanked or healed only some kills (a Protection paladin off-tanking)
                              isn't a tank for the raid as a whole, but those kills have their analysis. */}
                          <button
                            disabled={!(player.supported || b.tanking || b.healing) || loading}
                            onClick={() => onOpen(b.fight)}
                            title={
                              player.supported || b.tanking || b.healing
                                ? ''
                                : bosses.some((x) => x.tanking || x.healing)
                                  ? "Not tanking or healing on this kill, and this spec's DPS isn't supported yet"
                                  : "This spec isn't supported yet"
                            }
                          >
                            Analyze
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <div className="grid-2 even">
        {peers.players.length > 0 && player.dps && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Next to your raid</h2>
                <p className="sub">
                  {peers.basis === 'class'
                    ? `Your DPS, and how far the other ${className.toLowerCase()}s in the raid were ahead (red) or behind (green).`
                    : `No other ${className.toLowerCase()}s in the raid, so here are the raid's top ${peers.players.length} doing the same kind of damage.`}
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table className="t guild compact peers">
                <thead>
                  <tr>
                    <th>Boss</th>
                    <th className="num">You</th>
                    {peers.players.map((p) => (
                      <th key={p.source} className="num" title={p.icon.replace('-', ' ')}>
                        <PlayerName p={p} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bosses.map((b) => (
                    <tr key={b.fight}>
                      <td className="strong boss-name" title={b.name}>
                        {b.name.replace(BOSS_PREFIX, '')}
                      </td>
                      <td className="num mono strong">{fmt(b.dps)}</td>
                      {peers.players.map((p) => {
                        const d = b.peerDps[p.source];
                        if (d === undefined) return <td key={p.source} className="num muted">·</td>;
                        const diff = d - b.dps;
                        return (
                          <td key={p.source} className="num mono" title={`${p.name}: ${fmt(d)} DPS`}>
                            <span className={diff > 0 ? 'peer-ahead' : 'peer-behind'}>{fmtSigned(diff)}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {(anyParty || debuffCols.length > 0) && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>
                  Your raid setup
                  <Hint text="Your party per kill, worked out from drums, Vampiric Touch mana and party auras; faded members were seated by guess. Debuffs are the ones that raise your damage, as uptime % on the boss (green on target). Low everywhere on one boss usually means it couldn't be attacked for part of the fight." />
                </h2>
                <p className="sub">Your party and the boss debuffs that raise your damage. Gaps here are raid setup, not your play.</p>
              </div>
            </div>
            <div className="table-scroll">
              <table className="t guild compact setup">
                <thead>
                  <tr>
                    <th>Boss</th>
                    {anyParty && <th>Your party</th>}
                    {anyParty && <th className="num">Drums</th>}
                    {debuffCols.map((d) => (
                      <th key={d.name} className="num" title={d.name}>
                        <img className="ic" src={itemIcon(d.icon)} alt={d.name} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bosses.map((b) => (
                    <tr key={b.fight}>
                      <td className="strong boss-name" title={b.name}>
                        {b.name.replace(BOSS_PREFIX, '')}
                        {b.party?.notes.map((n) => (
                          <div key={n} className="setup-note">
                            {n}
                          </div>
                        ))}
                      </td>
                      {anyParty && (
                        <td>
                          <span className="party-icons">
                            {(b.party?.members ?? [])
                              .filter((id) => id !== player.source)
                              .map((id) => {
                                const p = raid.people[id];
                                const guess = b.party?.guessed.includes(id);
                                return p ? (
                                  <img key={id} className={`ic ${guess ? 'guessed' : ''}`} src={classIcon(p.icon)} alt={p.name} title={`${p.name} (${p.icon.replace('-', ' ')})${guess ? ', seated by guess' : ''}`} />
                                ) : null;
                              })}
                          </span>
                        </td>
                      )}
                      {anyParty && <td className={`num mono ${b.party?.drums ? '' : 'muted'}`}>{b.party?.drums ?? '–'}</td>}
                      {b.debuffs.map((d) => (
                        <td key={d.name} className={`num mono ${upClass(d.uptime, d.target)}`} title={`${d.name} on ${b.name}: ${fmt(d.uptime)}% (target ${d.target}%)`}>
                          {fmt(d.uptime)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {debuffCols.length > 0 && (
              <div className="debuff-legend">
                {debuffCols.map((d) => (
                  <span key={d.name}>
                    <img className="ic sm" src={itemIcon(d.icon)} alt="" />
                    {d.name}
                  </span>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
