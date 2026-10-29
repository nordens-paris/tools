// The rolling healer score's kills, kept in the browser (IndexedDB): the server has no lasting
// cache on the hosted site, so each kill's ~10 requests are paid once per visitor, and a kill
// fetched for one healer covers every healer in it.
import { useEffect, useRef, useState } from 'react';

import { healerScore, healingSplit, type HealerScore, type HealerScoreRef, type HealingSplit } from '../../shared/healerScore.ts';
import ref from '../../shared/healerScoreRef.json';
import type { HealerAnalysis, HealerHistory, HealerKillRef, HealerKillScores } from '../../shared/types.ts';
import { getHealerHistory, getHealerKill } from './api.ts';

export const scoreRef = ref as HealerScoreRef;

/** About this many requests per kill, for the button. */
export const REQUESTS_PER_KILL = 10;
const PARALLEL = 2;

const DB = 'parse-mirror';
const STORE = 'healer-kills';
// Without IndexedDB (private windows, blocked site data) kills are kept for this page load only.
const memory = new Map<string, HealerKillScores>();

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadAll(): Promise<HealerKillScores[]> {
  try {
    const db = await open();
    const all = await new Promise<HealerKillScores[]>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as HealerKillScores[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    for (const k of all) memory.set(`${k.report}:${k.fight}`, k);
  } catch {
    // Fall back to what this page load has seen.
  }
  return [...memory.values()];
}

async function save(k: HealerKillScores) {
  memory.set(`${k.report}:${k.fight}`, k);
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(k, `${k.report}:${k.fight}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Kept in memory only.
  }
}

/** The same kill from another report (several people log a raid): same boss, pulled within 2 minutes. */
const sameKill = (a: HealerKillRef, b: HealerKillRef) => a.encounterId === b.encounterId && Math.abs(a.startTime - b.startTime) < 120_000;

export interface ScoredKill extends HealerKillRef {
  score: HealerScore;
  split?: HealingSplit;
}

/** The kill's healing split, from every healer's score inputs. */
export const splitOf = (healers: HealerKillScores['healers'], encounterId: number) =>
  healingSplit(healers.map((h) => ({ name: h.name, spec: h.inputs.spec, hps: h.inputs.values.hps ?? 0 })), scoreRef, encounterId);

export interface RollingScore {
  history?: HealerHistory;
  /** Kills in the window this browser has, scored for the healer. */
  kills: ScoredKill[];
  /** Scored kills left out of the average: the healing split was far more uneven than in other raids. */
  leftOut: ScoredKill[];
  /** Kills in the window this browser hasn't fetched yet. */
  missing: HealerKillRef[];
  loading: boolean;
  fetching?: { done: number; of: number };
  error?: string;
  fetchMissing: () => void;
}

function scoredFor(name: string, wanted: HealerKillRef[], stored: HealerKillScores[]): ScoredKill[] {
  const out: ScoredKill[] = [];
  for (const w of wanted) {
    const k = stored.find((s) => sameKill(s, w));
    const inputs = k?.healers.find((h) => h.name === name)?.inputs;
    const score = inputs && healerScore(inputs, scoreRef, w.encounterId);
    if (k && score) out.push({ ...w, score, split: splitOf(k.healers, w.encounterId) });
  }
  return out.sort((a, b) => a.startTime - b.startTime);
}

/** The healer's score over the four weeks up to this kill's report. */
export function useRollingScore(a: HealerAnalysis): RollingScore {
  const [history, setHistory] = useState<HealerHistory>();
  const [stored, setStored] = useState<HealerKillScores[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState<{ done: number; of: number }>();
  const [error, setError] = useState<string>();
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    setLoading(true);
    setError(undefined);
    setFetching(undefined);
    (async () => {
      // This kill is already here: keep it for every healer in it.
      if (a.kill && a.scores?.length) {
        await save({ report: a.report, fight: a.fight, encounterId: a.encounter.id, name: a.encounter.name, startTime: a.startTime, healers: a.scores });
      }
      setStored(await loadAll());
      try {
        const h = await getHealerHistory(a.report, a.you.source);
        if (!cancelled.current) setHistory(h);
      } catch (err) {
        if (!cancelled.current) setError((err as Error).message);
      }
      if (!cancelled.current) setLoading(false);
    })();
    return () => {
      cancelled.current = true;
    };
  }, [a.id]);

  // The window's kills, plus this one if it isn't ranked (a wipe isn't scored).
  const self: HealerKillRef = { report: a.report, fight: a.fight, encounterId: a.encounter.id, name: a.encounter.name, startTime: a.startTime };
  const wanted = [...(history?.kills ?? [])];
  if (a.kill && !wanted.some((k) => sameKill(k, self))) wanted.push(self);
  const missing = wanted.filter((w) => !stored.some((s) => sameKill(s, w)));

  const fetchMissing = () => {
    if (fetching) return;
    const queue = [...missing];
    const of = queue.length;
    let done = 0;
    setError(undefined);
    setFetching({ done, of });
    const worker = async () => {
      for (let k = queue.shift(); k && !cancelled.current; k = queue.shift()) {
        try {
          const scores = await getHealerKill(k.report, k.fight);
          await save(scores);
          if (!cancelled.current) setStored((s) => [...s.filter((x) => !(x.report === scores.report && x.fight === scores.fight)), scores]);
        } catch (err) {
          if (!cancelled.current) setError((err as Error).message);
          // Rate limited: the rest would fail the same way.
          if (/rate limit/i.test((err as Error).message)) queue.length = 0;
        }
        if (!cancelled.current) setFetching({ done: ++done, of });
      }
    };
    Promise.all(Array.from({ length: PARALLEL }, worker)).then(() => {
      if (!cancelled.current) setFetching(undefined);
    });
  };

  const scored = scoredFor(a.you.name, wanted, stored);
  return { history, kills: scored.filter((k) => !k.split?.uneven), leftOut: scored.filter((k) => k.split?.uneven), missing, loading, fetching, error, fetchMissing };
}
