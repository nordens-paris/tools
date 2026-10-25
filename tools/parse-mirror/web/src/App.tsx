import { useEffect, useRef, useState } from 'react';

import type { AnalysisResult, GuildSummary, ProgressSummary, RaidSummary, SimResult } from '../../shared/types.ts';
import { analyze, getGuild, getProgress, getRaid, runSim } from './api.ts';
import { runBrowserSims } from './browserSims.ts';
import { game } from './game.ts';
import { APP_NAME, GUILD_NAME } from './brand.ts';
import { ApiKeyPanel } from './components/ApiKeyPanel.tsx';
import { BossPicker } from './components/BossPicker.tsx';
import { CastingTimeline } from './components/CastingTimeline.tsx';
import { Consumes } from './components/Consumes.tsx';
import { ComparePicker } from './components/ComparePicker.tsx';
import { Cooldowns } from './components/Cooldowns.tsx';
import { Findings } from './components/Findings.tsx';
import { FixFirst } from './components/FixFirst.tsx';
import { Gear } from './components/Gear.tsx';
import { GuildOverview } from './components/GuildOverview.tsx';
import { Landing } from './components/Landing.tsx';
import { LogSearch } from './components/LogSearch.tsx';
import { MetricTable } from './components/MetricTable.tsx';
import { MiniSim } from './components/MiniSim.tsx';
import { Progress } from './components/Progress.tsx';
import { RaidOverview } from './components/RaidOverview.tsx';
import { ReportHeader } from './components/ReportHeader.tsx';
import { SimPanel } from './components/SimPanel.tsx';
import { SummaryCards } from './components/SummaryCards.tsx';
import { ThemeToggle } from './components/ThemeToggle.tsx';
import { TopPlayers } from './components/TopPlayers.tsx';
import { GroupContext } from './group.ts';
import { parseRoute, rememberLast, routeUrl, type Route } from './route.ts';

const TABS = ['Overview', 'Rotation', 'Cooldowns', 'Consumes', 'Gear', 'Sim', 'Players'] as const;
type Tab = (typeof TABS)[number];
const asTab = (t?: string): Tab => (TABS as readonly string[]).includes(t ?? '') ? (t as Tab) : 'Overview';

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.search));
  const [analysis, setAnalysis] = useState<AnalysisResult>();
  const [raid, setRaid] = useState<RaidSummary>();
  const [guild, setGuild] = useState<GuildSummary>();
  const [progress, setProgress] = useState<ProgressSummary>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [sim, setSim] = useState<SimResult>();
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string>();
  // Browser sims: how many of the sims so far are done.
  const [simProgress, setSimProgress] = useState<{ done: number; total: number }>();
  // Latest request; slower earlier ones are ignored when they finish.
  const latest = useRef(0);
  // Fights opened this session, so back/forward doesn't re-run the analysis and sims.
  const fightCache = useRef(new Map<string, { analysis: AnalysisResult; sim?: SimResult }>());
  const fightKey = (r: Extract<Route, { view: 'analysis' }>) => `${r.report}:${r.fight}:${r.source}:${r.peers ? 'peers' : 'top'}`;
  /** Whether an analysis is the one a route asks for (same fight, player and comparison group). */
  const matches = (x: AnalysisResult | undefined, r: Route): x is AnalysisResult =>
    !!x && r.view === 'analysis' && x.you.report === r.report && x.you.fight === r.fight && x.you.source === r.source && x.comparison.mode === (r.peers ? 'peers' : 'top');
  const tab = route.view === 'analysis' ? asTab(route.tab) : 'Overview';

  useEffect(() => {
    const title =
      route.view === 'analysis' && analysis
        ? `${analysis.you.name} · ${analysis.encounter.name}`
        : route.view === 'raid' && raid
          ? `${raid.player.name} · ${raid.title}`
          : route.view === 'progress' && progress
            ? `${progress.player.name} · progress`
            : route.view === 'guild' && guild
              ? guild.title
              : '';
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
    if (title) rememberLast(route, title);
  }, [route, analysis, raid, guild, progress]);

  const startSim = async (id: string, token = latest.current) => {
    setSimLoading(true);
    setSimError(undefined);
    setSimProgress(undefined);
    try {
      const result =
        game.simMode === 'browser'
          ? await runBrowserSims(id, (done, total) => token === latest.current && setSimProgress({ done, total }))
          : await runSim(id);
      for (const entry of fightCache.current.values()) if (entry.analysis.id === id) entry.sim = result;
      if (token === latest.current) setSim(result);
    } catch (err) {
      const message = (err as Error).message;
      // The server forgot the analysis (restarted): drop it here too and run it again.
      if (message.startsWith('Analysis not found') && token === latest.current) {
        for (const [k, entry] of fightCache.current) if (entry.analysis.id === id) fightCache.current.delete(k);
        setAnalysis(undefined);
        void loadRef.current(parseRoute(window.location.search), true);
        return;
      }
      if (token === latest.current) setSimError(message);
    } finally {
      if (token === latest.current) setSimLoading(false);
    }
  };

  /** Fetches what a route shows, unless it's already loaded. */
  const load = async (r: Route, force = false) => {
    setError(undefined);
    if (r.view === 'home') return;
    const loaded =
      (r.view === 'guild' && guild?.report === r.report) ||
      (r.view === 'raid' && raid?.report === r.report && raid.player.source === r.source) ||
      (r.view === 'progress' && progress?.report === r.report && progress.player.source === r.source) ||
      matches(analysis, r);
    if (loaded && !force) return;
    const cached = r.view === 'analysis' ? fightCache.current.get(fightKey(r)) : undefined;
    if (cached) {
      ++latest.current;
      setAnalysis(cached.analysis);
      setSim(cached.sim);
      setSimError(undefined);
      setSimLoading(false);
      setLoading(false);
      if (!cached.sim) void startSim(cached.analysis.id);
      return;
    }
    const token = ++latest.current;
    setLoading(true);
    try {
      if (r.view === 'guild') {
        const g = await getGuild(r.report);
        if (token === latest.current) setGuild(g);
      } else if (r.view === 'raid') {
        const x = await getRaid(r.report, r.source);
        if (token === latest.current) setRaid(x);
      } else if (r.view === 'progress') {
        const p = await getProgress(r.report, r.source);
        if (token === latest.current) setProgress(p);
      } else {
        setSim(undefined);
        setSimError(undefined);
        setSimLoading(false);
        const result = await analyze(r.report, r.fight, r.source, r.peers ? 'peers' : 'top');
        if (token !== latest.current) return;
        fightCache.current.set(fightKey(r), { analysis: result });
        setAnalysis(result);
        // Sims take a few seconds; start them in the background right away.
        void startSim(result.id, token);
      }
    } catch (err) {
      if (token === latest.current) setError((err as Error).message);
    } finally {
      if (token === latest.current) setLoading(false);
    }
  };

  const go = (r: Route) => {
    window.history.pushState(null, '', routeUrl(r));
    setRoute(r);
    window.scrollTo({ top: 0 });
    void load(r);
  };
  const setTab = (t: Tab) => {
    if (route.view !== 'analysis') return;
    const r = { ...route, tab: t };
    window.history.replaceState(null, '', routeUrl(r));
    setRoute(r);
  };

  // The popstate listener is added once; it calls the current load through a ref.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    void loadRef.current(route);
    const onPop = () => {
      const r = parseRoute(window.location.search);
      setRoute(r);
      void loadRef.current(r);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openFight = (report: string, fight: number, source: number) => go({ view: 'analysis', report, fight, source });
  const openRaid = (report: string, source: number) => go({ view: 'raid', report, source });
  const openGuild = (report: string) => go({ view: 'guild', report });
  const openProgress = (report: string, source: number) => go({ view: 'progress', report, source });

  // Show data only when it belongs to the current route (a new route may still be loading).
  const a = matches(analysis, route) ? analysis : undefined;
  const raidShown = route.view === 'raid' && raid?.report === route.report && raid.player.source === route.source ? raid : undefined;
  const guildShown = route.view === 'guild' && guild?.report === route.report ? guild : undefined;
  const progressShown = route.view === 'progress' && progress?.report === route.report && progress.player.source === route.source ? progress : undefined;
  const sameReport = (report?: string) => route.view !== 'home' && report === route.report;

  return (
    <>
      <header className="top">
        <div className="wrap">
          <button className="brand" onClick={() => go({ view: 'home' })} title="Start over">
            <img className="emblem" src="/emblem.png" alt="" />
            <span className="brand-text">
              {APP_NAME}
              <small>{GUILD_NAME}</small>
            </span>
          </button>
          {a && (
            <nav className="tabs" aria-label="Report sections">
              {TABS.map((t) => (
                <button key={t} aria-current={t === tab ? 'page' : undefined} onClick={() => setTab(t)}>
                  {t}
                  {t === 'Overview' && a.findings.length > 0 && <span className="count">{a.findings.length}</span>}
                  {t === 'Sim' && simLoading && <span className="dot" />}
                </button>
              ))}
            </nav>
          )}
          <div className="top-actions">
            {route.view !== 'home' && <LogSearch variant="compact" onAnalyze={openFight} onRaid={openRaid} onGuild={openGuild} loading={loading} />}
            <ApiKeyPanel />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="wrap">
        {error && <div className="banner error">{error}</div>}

        {route.view === 'home' && <Landing onAnalyze={openFight} onRaid={openRaid} onGuild={openGuild} loading={loading} />}

        {route.view !== 'home' && loading && (
          <div className="loading">
            <div className="spinner" />
            <div>
              <strong>Fetching logs…</strong>
              <div className="muted small">
                {route.view === 'analysis' ? 'Pulling the fight and the top 10 parses from Warcraft Logs.' : 'Pulling the boss kills and parses from Warcraft Logs.'}
              </div>
            </div>
          </div>
        )}

        {guildShown && (
          <GuildOverview guild={guildShown} onRaid={(source) => openRaid(guildShown.report, source)} onFight={(fight, source) => openFight(guildShown.report, fight, source)} />
        )}

        {raidShown && (
          <>
            {sameReport(guild?.report) && (
              <button className="ghost back" onClick={() => openGuild(raidShown.report)}>
                ← Everyone in {raidShown.title}
              </button>
            )}
            <RaidOverview
              raid={raidShown}
              loading={loading}
              onOpen={(fight) => openFight(raidShown.report, fight, raidShown.player.source)}
              onProgress={() => openProgress(raidShown.report, raidShown.player.source)}
              onGuild={() => openGuild(raidShown.report)}
            />
          </>
        )}

        {progressShown && (
          <>
            <button className="ghost back" onClick={() => openRaid(progressShown.report, progressShown.player.source)}>
              ← {progressShown.player.name}'s raid
            </button>
            <Progress progress={progressShown} />
          </>
        )}

        {a && (
          <GroupContext.Provider value={a.comparison}>
            <ReportHeader
              analysis={a}
              onRaid={() => openRaid(a.you.report, a.you.source)}
              picker={
                route.view === 'analysis' && (
                  <BossPicker report={a.you.report} fight={a.you.fight} source={a.you.source} loading={loading} onChange={(fight) => go({ ...route, fight })} />
                )
              }
            />
            {route.view === 'analysis' && (
              <ComparePicker analysis={a} loading={loading} onChange={(peers) => go({ ...route, peers: peers || undefined })} />
            )}
            <SummaryCards analysis={a} sim={sim} />

            {tab === 'Overview' && (
              <>
                <FixFirst analysis={a} sim={sim} onTab={(t) => setTab(asTab(t))} />
                <div className="grid-2">
                  <Findings findings={a.findings} warnings={a.warnings} />
                  <div className="stack">
                    <MiniSim sim={sim} loading={simLoading} progress={simProgress} error={simError} onOpen={() => setTab('Sim')} />
                    <CastingTimeline analysis={a} compact />
                  </div>
                </div>
              </>
            )}
            {tab === 'Rotation' && (
              <>
                <CastingTimeline analysis={a} />
                <MetricTable title="Cast efficiency" subtitle="Casts as a share of the most casts possible on cooldown." rows={a.metrics.efficiency} top={a.top} />
                <MetricTable title="Casts per minute" rows={a.metrics.casts} top={a.top} />
                <MetricTable title="Uptimes" subtitle="Buffs on you, and debuffs you keep on the boss." rows={a.metrics.uptimes} top={a.top} />
              </>
            )}
            {tab === 'Cooldowns' && <Cooldowns analysis={a} />}
            {tab === 'Consumes' && <Consumes analysis={a} />}
            {tab === 'Gear' && (
              <>
                <MetricTable
                  title="Hit chance"
                  subtitle={`Hit from gear rating, talents and party auras (Draenei, Totem of Wrath), against the ${a.you.hit?.capPct ?? ''}% cap for a raid boss.`}
                  rows={a.metrics.summary.filter((m) => m.key === 'hit')}
                  top={a.top}
                />
                <Gear analysis={a} />
              </>
            )}
            {tab === 'Sim' && <SimPanel sim={sim} loading={simLoading} progress={simProgress} error={simError} onRetry={() => startSim(a.id)} />}
            {tab === 'Players' && <TopPlayers analysis={a} />}
          </GroupContext.Provider>
        )}
      </main>

      <footer className="foot">
        {GUILD_NAME} · Data from Warcraft Logs · Talents from Classic Armory · Sims by WoWSims (MIT) · Tooltips by Wowhead
      </footer>
    </>
  );
}
