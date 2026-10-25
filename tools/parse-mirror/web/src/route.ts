// Every view has its own URL, so links can be shared and the back button works.
//   ?r=REPORT                  whole raid, every player (guild overview)
//   ?r=REPORT&s=SOURCE         one player's raid
//   ?r=REPORT&s=SOURCE&p=1     one player's progress over time
//   ?r=REPORT&f=FIGHT&s=SOURCE one fight vs the top 10 (&tab=Sim for a tab, &vs=peers for
//                              players with the same gear a step ahead)
export type Route =
  | { view: 'home' }
  | { view: 'guild'; report: string }
  | { view: 'raid'; report: string; source: number }
  | { view: 'progress'; report: string; source: number }
  | { view: 'analysis'; report: string; fight: number; source: number; tab?: string; peers?: boolean };

const REPORT = /^[A-Za-z0-9]{16}$/;

export function parseRoute(search: string): Route {
  const q = new URLSearchParams(search);
  const report = q.get('r') ?? '';
  const fight = Number(q.get('f'));
  const source = Number(q.get('s'));
  if (!REPORT.test(report)) return { view: 'home' };
  if (Number.isInteger(source) && source > 0) {
    if (Number.isInteger(fight) && fight > 0) {
      return { view: 'analysis', report, fight, source, tab: q.get('tab') ?? undefined, peers: q.get('vs') === 'peers' || undefined };
    }
    return q.get('p') ? { view: 'progress', report, source } : { view: 'raid', report, source };
  }
  return { view: 'guild', report };
}

export function routeUrl(route: Route): string {
  const q = new URLSearchParams();
  if (route.view !== 'home') q.set('r', route.report);
  if (route.view === 'analysis') q.set('f', String(route.fight));
  if (route.view === 'raid' || route.view === 'progress' || route.view === 'analysis') q.set('s', String(route.source));
  if (route.view === 'progress') q.set('p', '1');
  if (route.view === 'analysis' && route.peers) q.set('vs', 'peers');
  if (route.view === 'analysis' && route.tab && route.tab !== 'Overview') q.set('tab', route.tab);
  const s = q.toString();
  return s ? `/?${s}` : '/';
}

// The last thing opened, so the landing page can offer to go back to it.
const LAST_KEY = 'parse-mirror:last';

export function rememberLast(route: Route, label: string) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ url: routeUrl(route), label }));
  } catch {
    // Storage blocked (private window); not worth failing over.
  }
}

export function lastOpened(): { url: string; label: string } | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null');
    return v && typeof v.url === 'string' && typeof v.label === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}
