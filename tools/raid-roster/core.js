// NP Roster core: Raid-Helper parsing, the roster optimizer, groups and import/export formats.
// No DOM access here, so it also runs under Node for testing.

// ---------- Static game data ----------
const CLASSES = {
  Warrior: { Arms: 'Melee', Fury: 'Melee', Protection: 'Tank' },
  Paladin: { Holy: 'Healer', Protection: 'Tank', Retribution: 'Melee' },
  Druid: { Balance: 'Ranged', Feral: 'Melee', Guardian: 'Tank', Restoration: 'Healer', Dreamstate: 'Healer' },
  Rogue: { Assassination: 'Melee', Combat: 'Melee', Subtlety: 'Melee' },
  Hunter: { Beastmastery: 'Ranged', Marksmanship: 'Ranged', Survival: 'Ranged' },
  Priest: { Discipline: 'Healer', Holy: 'Healer', Shadow: 'Ranged', Smite: 'Ranged' },
  Mage: { Arcane: 'Ranged', Fire: 'Ranged', Frost: 'Ranged' },
  Warlock: { Affliction: 'Ranged', Demonology: 'Ranged', Destruction: 'Ranged' },
  Shaman: { Elemental: 'Ranged', Enhancement: 'Melee', Restoration: 'Healer' },
};
const SPEC_SHORT = {
  Protection: 'Prot', Retribution: 'Ret', Restoration: 'Resto', Enhancement: 'Enh', Elemental: 'Ele', Beastmastery: 'BM',
  Marksmanship: 'MM', Survival: 'Surv', Affliction: 'Affli', Demonology: 'Demo', Destruction: 'Destro', Assassination: 'Assa',
  Subtlety: 'Sub', Discipline: 'Disc', Balance: 'Boomkin', Guardian: 'Bear', Dreamstate: 'Dream',
};
// Raid-Helper puts all tanks under a "Tank" class, and some templates (wowforever) replace every class
// with Tank, Melee, Ranged or Healer, so the spec tells the class. A spec two classes share has a 1 on the second.
const SPEC_CLASS = { Protection: 'Warrior', Protection1: 'Paladin', Holy: 'Priest', Holy1: 'Paladin', Restoration: 'Druid', Restoration1: 'Shaman' };
for (const [c, specs] of Object.entries(CLASSES)) for (const s of Object.keys(specs)) if (!(s in SPEC_CLASS)) SPEC_CLASS[s] = c;
const STATUS_ORDER = ['yes', 'late', 'tentative', 'bench', 'absence'];
// Spec spread groups: every spec on its own, except these classes where all specs count as one.
const ONE_GROUP_CLASSES = new Set(['Mage', 'Warlock', 'Hunter', 'Rogue']);
function spreadKey(c, s) { return ONE_GROUP_CLASSES.has(c) ? c : `${c}:${s}`; }
const SPREAD_INDEX = {};
for (const [c, specs] of Object.entries(CLASSES)) for (const s of Object.keys(specs)) { const k = spreadKey(c, s); if (!(k in SPREAD_INDEX)) SPREAD_INDEX[k] = Object.keys(SPREAD_INDEX).length; }
// The n-th player of a spec group costs (n-1) x weight, so 4 Fury warriors cost 0+1+2+3 = 6 x weight.
function spreadCost(n, w) { return w * n * (n - 1) / 2; }
const STATUS_LABEL = { yes: 'Signed up', late: 'Late', tentative: 'Tentative', bench: 'Bench', absence: 'Absent' };
const AVAILABLE = new Set(['yes', 'late', 'tentative', 'bench']);

// Moonkin and Leader of the Pack are one raid-wide crit buff, so any one of these Druids covers it.
const CRIT_BUFF = { id: 'b6', label: 'Raid crit (Moonkin / Leader of the Pack)', cls: 'Druid', specs: ['Balance', 'Feral', 'Guardian'], min: 1 };
const DEFAULT_SETTINGS = {
  // The raid team's name, shown in the top bar and on the roster image.
  teamName: '',
  buffs: [
    { id: 'b1', label: 'Kings / Salvation', cls: 'Paladin', specs: [], min: 1 },
    { id: 'b2', label: 'Windfury Totem', cls: 'Shaman', specs: [], min: 1 },
    { id: 'b3', label: 'Curse of the Elements', cls: 'Warlock', specs: [], min: 1 },
    { id: 'b5', label: '2nd Paladin (Wisdom / Might)', cls: 'Paladin', specs: [], min: 2 },
    { id: 'b4', label: 'Fortitude', cls: 'Priest', specs: [], min: 1 },
    CRIT_BUFF,
    { id: 'b8', label: 'Battle Shout', cls: 'Warrior', specs: [], min: 1 },
    { id: 'b10', label: '2nd Shaman (Agility & more totems)', cls: 'Shaman', specs: [], min: 2 },
    // Party-wide 15% spirit; the groups put a Shadow Priest with the healers.
    { id: 'b11', label: 'Spirit (Shadow Priest, healer group)', cls: 'Priest', specs: ['Shadow'], min: 1 },
    { id: 'b9', label: 'Arcane Intellect', cls: 'Mage', specs: [], min: 1 },
  ],
  types: {
    '20': { size: 20, tanks: 2, healMin: 3, healMax: 4, healTarget: 3 },
    '10': { size: 10, tanks: 2, healMin: 2, healMax: 3, healTarget: 2 },
  },
  raids: [
    { id: 'r20', name: '20-man', type: '20' },
    { id: 'r10a', name: '10-man A', type: '10' },
    { id: 'r10b', name: '10-man B', type: '10' },
  ],
  defaultDays: [3, 0],
  maxRaidsPerDay: 2,
  weights: { fair: 600, prio: 300, parse: 2, offspec: 150, tentative: 250, late: 120, benchSignup: 600, specSpread: 80, raidBalance: 1500, reliability: 0, teams: 400 },
};

// Saved settings from before the two Druid crit buffs (b6, b7) became one: the merged buff takes the higher place.
function mergeCritBuffs(buffs) {
  if (!buffs.some(b => b.id === 'b6') || !buffs.some(b => b.id === 'b7')) return buffs;
  const first = buffs.find(b => b.id === 'b6' || b.id === 'b7');
  return buffs.filter(b => b === first || (b.id !== 'b6' && b.id !== 'b7')).map(b => (b === first ? { ...CRIT_BUFF } : b));
}

function withDefaults(s) {
  const d = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (!s) return d;
  return {
    ...d, ...s,
    types: { ...d.types, ...(s.types || {}) },
    weights: { ...d.weights, ...(s.weights || {}) },
    buffs: Array.isArray(s.buffs) ? mergeCritBuffs(s.buffs) : d.buffs,
    raids: Array.isArray(s.raids) ? s.raids : d.raids,
    defaultDays: Array.isArray(s.defaultDays) ? s.defaultDays : d.defaultDays,
  };
}

function roleOf(c, s) { return (CLASSES[c] && CLASSES[c][s]) || 'Ranged'; }
function normSpec(s) { return String(s || '').replace(/1$/, ''); }
function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function shortSpec(s) { return SPEC_SHORT[s] || s; }

// WoW Forever characters are "Firstname-Lastname", so a hyphen inside a word is part of the name.
// Discord nicknames like "Jonas - Firstname-Lastname", "Jonas | Firstname-Lastname" or
// "Jonas / Firstname-Lastname" put the character after the last separator.
function guessChar(name) {
  const clean = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = clean.split(/\s+-\s+|\s*[\/\\|]+\s*/).map(x => x.trim()).filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : clean;
  return last.split(' ').filter(Boolean).map(capFirst).join(' ') || clean;
}

// Character names compare without case, and with spaces and hyphens treated alike.
function nameKey(name) { return String(name || '').trim().toLowerCase().replace(/[\s-]+/g, '-'); }

// ---------- Dates ----------
function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function parseIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); }
function addDays(s, n) { const d = parseIso(s); d.setDate(d.getDate() + n); return isoDate(d); }
// EU weekly reset is Wednesday, so a raid week runs Wednesday to Tuesday.
function resetOf(s) { const d = parseIso(s); const diff = (d.getDay() - 3 + 7) % 7; d.setDate(d.getDate() - diff); return isoDate(d); }
function weekdayOffset(wd) { return (wd - 3 + 7) % 7; }

// ISO week number (weeks start Monday; week 1 holds the year's first Thursday).
function isoWeek(s) {
  const d = parseIso(s);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(d.getFullYear(), 0, 4, 12);
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}
// A raid week is named by the ISO week of its reset Wednesday, which Wednesday and Sunday raids share.
function weekName(id) { return `Week ${isoWeek(id)}`; }
function weekSpan(id) {
  const a = parseIso(id), b = parseIso(addDays(id, 6));
  const m = d => d.toLocaleDateString('en-GB', { month: 'short' });
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${m(b)}` : `${a.getDate()} ${m(a)} – ${b.getDate()} ${m(b)}`;
}

// ---------- Raid-Helper import ----------
function parseRaidHelper(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { throw new Error('That is not valid JSON. Open the event data link, select all (Ctrl+A), copy and paste again.'); }
  const list = obj.signups || obj.signUps;
  if (!Array.isArray(list)) throw new Error('No signups found. Make sure you copied the event data link, not the normal event page.');
  let date = null;
  const ts = obj.unixtime || obj.startTime;
  if (ts) date = isoDate(new Date(ts * 1000));
  else if (typeof obj.date === 'string' && /^\d{2}-\d{2}-\d{4}$/.test(obj.date)) { const [d, m, y] = obj.date.split('-'); date = `${y}-${m}-${d}`; }
  const people = {};
  for (const x of list) {
    const pid = String(x.userid ?? x.userId ?? '');
    if (!pid) continue;
    let cls = x.class ?? x.className ?? '';
    const rawSpec = x.spec ?? x.specName ?? '';
    const rawSpec2 = x.spec2 ?? '';
    let st = 'yes';
    const lc = String(cls).toLowerCase();
    if (['late', 'bench', 'tentative', 'absence'].includes(lc)) st = lc;
    if (!CLASSES[cls]) cls = SPEC_CLASS[rawSpec] || '';
    const opts = [];
    if (cls && CLASSES[cls]) {
      const s = normSpec(rawSpec);
      if (CLASSES[cls][s]) opts.push({ c: cls, s });
      const s2 = normSpec(rawSpec2);
      if (s2 && CLASSES[cls][s2] && s2 !== s) opts.push({ c: cls, s: s2 });
    }
    const t = Number(x.signuptime ?? x.entryTime ?? x.timestamp ?? 0) || 0;
    const prev = people[pid];
    if (!prev) { people[pid] = { p: pid, n: String(x.name || ''), st, opts, t }; continue; }
    // One person with several signups: merge their options and keep the most available status.
    for (const o of opts) if (!prev.opts.some(q => q.c === o.c && q.s === o.s)) prev.opts.push(o);
    if (STATUS_ORDER.indexOf(st) < STATUS_ORDER.indexOf(prev.st)) prev.st = st;
    if (t && (!prev.t || t < prev.t)) prev.t = t;
  }
  return {
    event: { id: String(obj.raidid ?? obj.id ?? ''), title: String(obj.title || obj.displayTitle || 'Raid-Helper event'), date, time: obj.time || '' },
    signups: Object.values(people),
  };
}

// Several events pasted one after another: split the text into its top-level JSON objects.
function splitJsonObjects(text) {
  const out = [];
  let depth = 0, start = -1, inStr = false, escNext = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escNext) escNext = false;
      else if (ch === '\\') escNext = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}' && depth > 0) { depth--; if (depth === 0 && start >= 0) { out.push(text.slice(start, i + 1)); start = -1; } }
  }
  return out;
}

function parseRaidHelperMany(text) {
  const parts = splitJsonObjects(String(text || ''));
  if (!parts.length) throw new Error('No event data found. Open each event data link, select all (Ctrl+A), copy and paste them here one after another.');
  return parts.map(parseRaidHelper);
}

function eventIdFrom(text) {
  const m = String(text || '').match(/(\d{15,22})/);
  return m ? m[1] : '';
}

// ---------- Availability ----------
// The options a player can bring on a day: what they signed up as first, then their registered specs.
function playerOpts(player, signup) {
  const out = [];
  const add = (c, s) => { if (c && s && CLASSES[c] && CLASSES[c][s] && !out.some(o => o.c === c && o.s === s)) out.push({ c, s, r: roleOf(c, s) }); };
  if (signup && signup.opts) for (const o of signup.opts) add(o.c, o.s);
  if (player && (!out.length || out[0].c === player.cls)) { add(player.cls, player.main); add(player.cls, player.off); }
  // Alts: their specs too, when the signup is for that class or there is no signup to go by.
  for (const a of (player && Array.isArray(player.alts) ? player.alts : [])) {
    if (a && (!signup || !(signup.opts || []).length || (out[0] && out[0].c === a.cls))) { add(a.cls, a.main); add(a.cls, a.off); }
  }
  return out.map((o, i) => ({ ...o, off: i > 0 }));
}

// A planned absence (Players → Away) covering the date, or null.
function awayOn(pl, date) {
  return (pl && Array.isArray(pl.away) && date ? pl.away : []).find(a => a && a.from <= date && date <= a.to) || null;
}

function availability(week, dayId, players) {
  const m = new Map();
  const list = (week.signups && week.signups[dayId]) || [];
  const date = ((week.days || {})[dayId] || {}).date;
  for (const su of list) {
    const pl = players[su.p];
    // 'none' is an officer's "not signed up", kept so a re-import doesn't bring the signup back.
    if (su.st === 'none' || (pl && pl.active === false)) continue;
    const opts = playerOpts(pl, su);
    if (!opts.length) continue;
    // A planned absence counts as absent, unless an officer set the status by hand.
    const away = su.manual ? null : awayOn(pl, date);
    m.set(su.p, { pid: su.p, st: away ? 'absence' : su.st, opts, t: su.t || 0, away });
  }
  return m;
}

// How much a player is "owed" a spot: recent benches count most, recent raids pay it back a little.
// The last `n` weeks before weekId, newest first: true where the player sat on the bench in a raid of this size.
function benchHistory(pid, type, weekId, weeks, settings, n = 8) {
  const prev = Object.values(weeks).filter(w => w && w.id < weekId).sort((a, b) => b.id.localeCompare(a.id)).slice(0, n);
  return prev.map(w => {
    let played = false, benched = false;
    for (const [rid, raid] of Object.entries(w.raids || {})) {
      const def = settings.raids.find(r => r.id === rid);
      if (!raid || !def || def.type !== type) continue;
      const att = w.attendance && w.attendance[rid];
      if ((att ? (att.present || []) : (w.status === 'final' ? (raid.roster || []).map(e => e.p) : [])).includes(pid)) played = true;
      else if ((att ? (att.bench || []) : (w.status === 'final' ? (raid.bench || []) : [])).includes(pid)) benched = true;
    }
    return benched && !played;
  });
}

function benchDebt(pid, type, weekId, weeks, settings) {
  const prev = Object.values(weeks).filter(w => w && w.id < weekId).sort((a, b) => b.id.localeCompare(a.id)).slice(0, 8);
  let debt = 0;
  // Raids of one size share a lockout, so a week counts once: played in any of them, else benched in any.
  prev.forEach((w, age) => {
    let played = false, benched = false;
    for (const [rid, raid] of Object.entries(w.raids || {})) {
      if (!raid) continue;
      const def = settings.raids.find(r => r.id === rid);
      if (!def || def.type !== type) continue;
      const att = w.attendance && w.attendance[rid];
      if ((att ? (att.present || []) : (w.status === 'final' ? (raid.roster || []).map(e => e.p) : [])).includes(pid)) played = true;
      else if ((att ? (att.bench || []) : (w.status === 'final' ? (raid.bench || []) : [])).includes(pid)) benched = true;
    }
    if (played) debt -= 0.15 * Math.pow(0.85, age);
    else if (benched) debt += Math.pow(0.85, age);
  });
  return Math.max(0, debt);
}

// ---------- Reliability ----------
// What happened to a player in one raid: 'played', 'bench', 'missed' (planned to play or sit on the
// bench but did neither, or marked as a no-show), 'none', or null when no attendance is recorded.
function attendanceCellOf(w, rid, pid) {
  const att = (w.attendance || {})[rid];
  if (!att) return null;
  if ((att.present || []).includes(pid)) return 'played';
  if ((att.bench || []).includes(pid)) return 'bench';
  if ((att.missed || []).includes(pid)) return 'missed';
  const raid = (w.raids || {})[rid] || {};
  const planned = (raid.roster || []).some(e => e.p === pid) || (raid.bench || []).includes(pid);
  return planned ? 'missed' : 'none';
}

// No-shows (once per lockout per week) and drops (pulling out of a raid day after a roster with them
// was made) over the last `n` weeks before weekId, or up to and including it with `include`.
function reliability(pid, weekId, weeks, settings, opts = {}) {
  const list = Object.values(weeks).filter(w => w && (opts.include ? w.id <= weekId : w.id < weekId))
    .sort((a, b) => b.id.localeCompare(a.id)).slice(0, opts.n ?? 8);
  const types = [...new Set(settings.raids.map(r => r.type))];
  let noShows = 0, drops = 0;
  for (const w of list) {
    for (const type of types) {
      const cells = settings.raids.filter(r => r.type === type && (w.attendance || {})[r.id]).map(r => attendanceCellOf(w, r.id, pid));
      if (cells.includes('missed') && !cells.includes('played') && !cells.includes('bench')) noShows++;
    }
    for (const day of Object.values(w.drops || {})) if (day && day[pid]) drops++;
  }
  return { noShows, drops, points: noShows + drops / 2 };
}
// Two no-shows, or one and two drops, within the window earns a warning.
const UNRELIABLE_POINTS = 2;

// ---------- Fixed teams ----------
// For each player, the raid of this size they were last in (within the last `n` weeks), as
// "<week>:<raid>". Players with the same key played together; attendance wins over the plan.
function lastTeams(type, weekId, weeks, settings, n = 4) {
  const out = {};
  const prev = Object.values(weeks || {}).filter(w => w && w.id < weekId).sort((a, b) => b.id.localeCompare(a.id)).slice(0, n);
  for (const w of prev) {
    for (const def of settings.raids) {
      const raid = (w.raids || {})[def.id];
      if (def.type !== type || !raid || !raid.dayId) continue;
      const att = (w.attendance || {})[def.id];
      for (const p of att ? (att.present || []) : (raid.roster || []).map(e => e.p)) if (!(p in out)) out[p] = `${w.id}:${def.id}`;
    }
  }
  return out;
}
// The largest group in a roster that played together last time: [count, key].
function teamCore(roster, teams) {
  const n = {};
  for (const e of roster) { const k = teams[e.p]; if (k) n[k] = (n[k] || 0) + 1; }
  return Object.entries(n).reduce((best, [k, c]) => (c > best[0] ? [c, k] : best), [0, null]);
}

// ---------- Optimizer ----------
// "Never bench" beats every buff combined but never breaks the tank and healer rules.
const NEVER_BENCH_BONUS = 2e6;
// A designated tank for this raid size gets the tank spots first; only roles weigh more.
const TANK_BONUS = 3e6;
function isDesignatedTank(pl, type) { return !!(pl && Array.isArray(pl.tankFor) && pl.tankFor.includes(type)); }

// How much a player is wanted for a DPS spot, before buffs and roles. Higher plays, lower sits.
function playerValue(pl, st, debt, W) {
  const stPen = { yes: 0, late: W.late, tentative: W.tentative, bench: W.benchSignup };
  return W.fair * debt + W.prio * (Number(pl && pl.prio) || 0) + W.parse * (Number(pl && pl.parse) || 0) - (stPen[st] || 0);
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Earlier buffs always beat every later one combined, so the priority list is respected strictly.
function buffWeights(n) { return Array.from({ length: n }, (_, i) => 1000 * Math.pow(2, n - 1 - i)); }
function ruleMatches(rule, c, s) { return rule.cls === c && (!rule.specs || !rule.specs.length || rule.specs.includes(s)); }

// Plans every raid of one type at once (they share a lockout, so nobody can be in two of them).
// raids: [{rid, dayId, locks}]. Returns {rosters: {rid: [{p, c, s, r, off}]}, score}.
function optimizeType(raids, typeCfg, ctx) {
  const { week, players, weeks, settings, type } = ctx;
  const W = settings.weights, rules = settings.buffs, R = rules.length, bw = buffWeights(R);
  const debtCache = {};
  const debt = pid => (debtCache[pid] ??= benchDebt(pid, type, week.id, weeks, settings));
  const relCost = pid => (W.reliability ? W.reliability * reliability(pid, week.id, weeks || {}, settings).points : 0);
  // A player kept in one raid of the lockout is no candidate for the others.
  const keptIn = {};
  // Fixed teams only matter when several raids of this size split the players between them.
  const TEAMS = raids.length > 1 ? (Number(W.teams) || 0) : 0;
  const teamOf = TEAMS ? lastTeams(type, week.id, weeks, settings) : {};
  const teamIdx = {};
  for (const rd of raids) for (const [pid, l] of Object.entries(rd.locks || {})) if (l === 'in' && !keptIn[pid]) keptIn[pid] = rd.rid;

  const prep = raids.map(rd => {
    const av = rd.dayId ? availability(week, rd.dayId, players) : new Map();
    const locks = rd.locks || {};
    const cands = new Map();
    const addCand = (pid, info) => {
      const pl = players[pid] || {};
      const base = playerValue(pl, info.st, debt(pid), W) - relCost(pid) + (pl.noBench ? NEVER_BENCH_BONUS : 0);
      const opts = info.opts.map(o => {
        let mask = 0;
        rules.forEach((ru, k) => { if (ruleMatches(ru, o.c, o.s)) mask |= 1 << k; });
        const role = o.r === 'Tank' ? 1 : o.r === 'Healer' ? 2 : 0;
        return { ...o, mask, role, ci: SPREAD_INDEX[spreadKey(o.c, o.s)] ?? 0, tankBonus: role === 1 && isDesignatedTank(pl, type) ? TANK_BONUS : 0 };
      });
      const tk = teamOf[pid];
      cands.set(pid, { pid, st: info.st, opts, base, team: tk ? (teamIdx[tk] ??= Object.keys(teamIdx).length) : -1 });
    };
    for (const [pid, info] of av) if (AVAILABLE.has(info.st) && locks[pid] !== 'out' && (!keptIn[pid] || keptIn[pid] === rd.rid)) addCand(pid, info);
    for (const [pid, l] of Object.entries(locks)) {
      if (l === 'in' && keptIn[pid] === rd.rid && !cands.has(pid)) {
        const opts = playerOpts(players[pid], null);
        if (opts.length) addCand(pid, { st: 'yes', opts });
      }
    }
    // Tie-break: earlier signups get a small edge.
    const byTime = [...cands.values()].map(c => [c.pid, (av.get(c.pid) || {}).t || Infinity]).sort((a, b) => a[1] - b[1]);
    byTime.forEach(([pid], k) => { cands.get(pid).base += 40 * (1 - k / Math.max(1, byTime.length)); });
    return { ...rd, locks, cands, target: Math.min(typeCfg.size, cands.size) };
  });
  // Not enough players for every raid of the lockout: split them evenly instead of filling one first.
  if (prep.length > 1) {
    const union = new Set(prep.flatMap(P => [...P.cands.keys()])).size;
    if (union < prep.reduce((n, P) => n + P.target, 0)) {
      const base = Math.floor(union / prep.length), extra = union % prep.length;
      prep.forEach((P, i) => { P.target = Math.min(P.cands.size, typeCfg.size, base + (i < extra ? 1 : 0)); });
    }
  }

  const cnt = new Int16Array(32), perClass = new Int16Array(Object.keys(SPREAD_INDEX).length);
  const spread = Number(W.specSpread) || 0;
  function score(mem) {
    let sc = 0, t = 0, h = 0;
    cnt.fill(0); perClass.fill(0);
    for (const m of mem) {
      const o = m.info.opts[m.oi];
      sc += m.info.base - (o.off ? W.offspec : 0) + o.tankBonus;
      if (o.role === 1) t++; else if (o.role === 2) h++;
      perClass[o.ci]++;
      for (let k = 0; k < R; k++) if ((o.mask >> k) & 1) cnt[k]++;
    }
    if (spread) for (let i = 0; i < perClass.length; i++) if (perClass[i] > 1) sc -= spreadCost(perClass[i], spread);
    sc -= 1e7 * Math.abs(t - typeCfg.tanks);
    if (h < typeCfg.healMin) sc -= 1e7 * (typeCfg.healMin - h);
    if (h > typeCfg.healMax) sc -= 1e7 * (h - typeCfg.healMax);
    sc -= 800 * Math.abs(h - typeCfg.healTarget);
    for (let k = 0; k < R; k++) if (cnt[k] >= (rules[k].min || 1)) sc += bw[k];
    // Fixed teams: every pair that played together last time again, scaled so a whole team kept
    // together is worth TEAMS per player. At 400 one player costs about 800, below the lowest buff.
    if (TEAMS) {
      const tc = new Map();
      for (const m of mem) if (m.info.team >= 0) tc.set(m.info.team, (tc.get(m.info.team) || 0) + 1);
      for (const n of tc.values()) sc += TEAMS * n * (n - 1) / Math.max(1, typeCfg.size - 1);
    }
    return sc;
  }

  // Buffs covered by one raid, and the cost of raids of this size ending up uneven: per buff of
  // difference between the best and worst covered raid. 1500 sits between the two lowest buff
  // weights, so evening out can cost the lowest-priority buff but never a higher one.
  const BAL = prep.length > 1 ? (Number(W.raidBalance) || 0) : 0;
  function covered(mem) {
    cnt.fill(0);
    for (const m of mem) { const o = m.info.opts[m.oi]; for (let k = 0; k < R; k++) if ((o.mask >> k) & 1) cnt[k]++; }
    let n = 0;
    for (let k = 0; k < R; k++) if (cnt[k] >= (rules[k].min || 1)) n++;
    return n;
  }
  const unevenCost = oks => BAL ? BAL * (Math.max(...oks) - Math.min(...oks)) : 0;

  // Pick the best spec for each flexible player, given everyone else.
  function reopt(mem) {
    let best = score(mem);
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const m of mem) {
        if (m.info.opts.length < 2) continue;
        let bestOi = m.oi;
        for (let oi = 0; oi < m.info.opts.length; oi++) {
          if (oi === bestOi) continue;
          m.oi = oi;
          const s = score(mem);
          if (s > best + 1e-6) { best = s; bestOi = oi; changed = true; }
        }
        m.oi = bestOi;
      }
      if (!changed) break;
    }
    return best;
  }

  const rng = mulberry32(1337);
  const restarts = prep.length > 1 ? 6 : 8;
  let best = null, bestScore = -Infinity;

  for (let r = 0; r < restarts; r++) {
    const noise = new Map();
    const v = c => {
      if (!noise.has(c.pid)) noise.set(c.pid, r === 0 ? 0 : (rng() - 0.5) * W.fair * 2.5);
      return c.base + noise.get(c.pid);
    };
    const used = new Set();
    const mems = prep.map(() => []);
    const order = prep.map((_, i) => i);
    if (r % 2 === 1) order.reverse();

    // Greedy start: locked players, then tanks, healers, missing buffs, then the most owed DPS.
    for (const i of order) {
      const P = prep[i], mem = mems[i];
      const take = (c, oi) => { mem.push({ info: c, oi: Math.max(0, oi) }); used.add(c.pid); };
      const free = () => [...P.cands.values()].filter(c => !used.has(c.pid));
      for (const c of free()) if (P.locks[c.pid] === 'in' && mem.length < P.target) take(c, 0);
      const countRole = role => mem.filter(m => m.info.opts[m.oi].role === role).length;
      // Designated tanks first, then by value.
      const bonusFor = (c, role) => Math.max(0, ...c.opts.filter(o => o.role === role).map(o => o.tankBonus || 0));
      const pickRole = role => {
        const pool = free().filter(c => c.opts.some(o => o.role === role)).sort((a, b) => bonusFor(b, role) - bonusFor(a, role) || v(b) - v(a));
        if (!pool.length) return false;
        const best = pool[0].opts.reduce((bi, o, i, arr) => (o.role === role && (bi < 0 || (o.tankBonus || 0) > (arr[bi].tankBonus || 0)) ? i : bi), -1);
        take(pool[0], best);
        return true;
      };
      while (countRole(1) < typeCfg.tanks && mem.length < P.target && pickRole(1)) { /* fill tanks */ }
      while (countRole(2) < typeCfg.healTarget && mem.length < P.target && pickRole(2)) { /* fill healers */ }
      rules.forEach((ru, k) => {
        let have = mem.filter(m => (m.info.opts[m.oi].mask >> k) & 1).length;
        while (have < (ru.min || 1) && mem.length < P.target) {
          const pool = free().filter(c => c.opts.some(o => ((o.mask >> k) & 1) && o.role === 0)).sort((a, b) => v(b) - v(a));
          if (!pool.length) break;
          take(pool[0], pool[0].opts.findIndex(o => ((o.mask >> k) & 1) && o.role === 0));
          have++;
        }
      });
      for (const c of free().sort((a, b) => v(b) - v(a))) {
        if (mem.length >= P.target) break;
        take(c, c.opts.findIndex(o => o.role === 0));
      }
    }

    // Hill climb: swap a member for a candidate, or exchange two players between raids of this type.
    const where = new Map();
    mems.forEach((mem, i) => mem.forEach(m => where.set(m.info.pid, i)));
    const sc = mems.map(mem => reopt(mem));
    const oks = mems.map(covered);
    let improved = true, guard = 0;
    while (improved && guard++ < 60) {
      improved = false;
      for (let i = 0; i < prep.length; i++) {
        const P = prep[i];
        for (let a = 0; a < mems[i].length; a++) {
          const out = mems[i][a];
          if (P.locks[out.info.pid] === 'in') continue;
          for (const c of P.cands.values()) {
            const j = where.has(c.pid) ? where.get(c.pid) : -1;
            if (j === i) continue;
            let b = -1;
            if (j >= 0) {
              if (prep[j].locks[c.pid] === 'in' || !prep[j].cands.has(out.info.pid)) continue;
              b = mems[j].findIndex(m => m.info.pid === c.pid);
            }
            const snapI = mems[i].map(m => m.oi);
            const snapJ = j >= 0 ? mems[j].map(m => m.oi) : null;
            const oldJ = j >= 0 ? mems[j][b] : null;
            const before = sc[i] + (j >= 0 ? sc[j] : 0) - unevenCost(oks);
            mems[i][a] = { info: c, oi: 0 };
            if (j >= 0) mems[j][b] = { info: prep[j].cands.get(out.info.pid), oi: 0 };
            const ni = reopt(mems[i]);
            const nj = j >= 0 ? reopt(mems[j]) : 0;
            const newOks = oks.slice();
            if (BAL) { newOks[i] = covered(mems[i]); if (j >= 0) newOks[j] = covered(mems[j]); }
            if (ni + nj - unevenCost(newOks) > before + 1e-6) {
              if (BAL) { oks[i] = newOks[i]; if (j >= 0) oks[j] = newOks[j]; }
              sc[i] = ni;
              if (j >= 0) { sc[j] = nj; where.set(out.info.pid, j); } else where.delete(out.info.pid);
              where.set(c.pid, i);
              improved = true;
              break;
            }
            mems[i][a] = out;
            mems[i].forEach((m, k) => { m.oi = snapI[k]; });
            if (j >= 0) { mems[j][b] = oldJ; mems[j].forEach((m, k) => { m.oi = snapJ[k]; }); }
          }
        }
      }
    }
    const total = sc.reduce((x, y) => x + y, 0) - unevenCost(oks);
    if (total > bestScore) {
      bestScore = total;
      best = mems.map(mem => mem.map(m => { const o = m.info.opts[m.oi]; return { p: m.info.pid, c: o.c, s: o.s, r: o.r, off: !!o.off }; }));
    }
  }
  const rosters = {};
  prep.forEach((P, i) => { rosters[P.rid] = best ? best[i] : []; });
  const missing = prep.reduce((x, P) => x + (typeCfg.size - (rosters[P.rid] || []).length), 0);
  return { rosters, score: bestScore, missing };
}

// Tries every way of putting the raids on the raid days and returns the best few plans.
function planWeek(week, ctx) {
  const settings = ctx.settings;
  const dayIds = Object.entries(week.days || {}).filter(([, d]) => d).sort((a, b) => a[1].date.localeCompare(b[1].date)).map(([id]) => id);
  if (!dayIds.length) return [];
  const byType = {};
  for (const r of settings.raids) (byType[r.type] ||= []).push(r);
  const typeOptions = {};
  for (const [type, defs] of Object.entries(byType)) {
    const typeCfg = settings.types[type];
    if (!typeCfg) continue;
    const pins = defs.map(d => (week.raids && week.raids[d.id] && week.raids[d.id].pinDay) || null);
    const tuples = [];
    const rec = (k, acc, minIdx) => {
      if (k === defs.length) { tuples.push(acc.slice()); return; }
      if (pins[k] && dayIds.includes(pins[k])) { acc.push(pins[k]); rec(k + 1, acc, minIdx); acc.pop(); return; }
      // Raids of one type are interchangeable, so only keep day orders that never go backwards.
      for (let d = pins.some(Boolean) ? 0 : minIdx; d < dayIds.length; d++) { acc.push(dayIds[d]); rec(k + 1, acc, d); acc.pop(); }
    };
    rec(0, [], 0);
    typeOptions[type] = tuples.map(tuple => {
      const raids = defs.map((d, k) => ({ rid: d.id, dayId: tuple[k], locks: (week.raids && week.raids[d.id] && week.raids[d.id].locks) || {} }));
      const res = optimizeType(raids, typeCfg, { ...ctx, type });
      return { assign: Object.fromEntries(defs.map((d, k) => [d.id, tuple[k]])), ...res, value: res.score - 5e6 * res.missing };
    });
  }
  // Combine the per-type choices, respecting the raids-per-day limit.
  let combos = [{ assign: {}, rosters: {}, value: 0 }];
  for (const opts of Object.values(typeOptions)) {
    const next = [];
    for (const base of combos) for (const o of opts) next.push({ assign: { ...base.assign, ...o.assign }, rosters: { ...base.rosters, ...o.rosters }, value: base.value + o.value });
    combos = next;
  }
  const maxPer = settings.maxRaidsPerDay || 99;
  combos = combos.filter(c => {
    const per = {};
    for (const d of Object.values(c.assign)) per[d] = (per[d] || 0) + 1;
    return Object.values(per).every(x => x <= maxPer);
  });
  combos.sort((a, b) => b.value - a.value);
  return combos.slice(0, 3);
}

// ---------- Coverage, groups, bench ----------
function coverage(roster, settings) {
  return settings.buffs.map(ru => {
    const prov = roster.filter(e => ruleMatches(ru, e.c, e.s)).map(e => e.p);
    return { rule: ru, prov, ok: prov.length >= (ru.min || 1) };
  });
}
function roleCounts(roster) {
  const out = { Tank: 0, Healer: 0, Melee: 0, Ranged: 0 };
  for (const e of roster) out[e.r] = (out[e.r] || 0) + 1;
  return out;
}

const MELEE_ORDER = ['Rogue', 'Druid', 'Paladin', 'Shaman', 'Warrior'];
const CASTER_ORDER = ['Priest', 'Mage', 'Warlock', 'Druid', 'Shaman', 'Paladin', 'Hunter', 'Warrior', 'Rogue'];
const isShadow = e => e.c === 'Priest' && e.s === 'Shadow';
const isArcane = e => e.c === 'Mage' && e.s === 'Arcane';

// The last group is the healers', the first the tanks'. In a 20-man melee fill 1>2>3>4, healers 4>3 and
// ranged 3>4>2>1 with hunters after the casters. Shadow Priests and Arcane Mages take what is left of the
// healer group before anyone else. A 10-man has no ranged group, so its ranged fill 2>1.
// Shamans go where their Tremor Totem is needed before the groups fill, so nobody has to move for them.
function makeGroups(roster, size) {
  const nG = Math.max(1, Math.ceil(size / 5));
  const groups = Array.from({ length: nG }, () => []);
  const healGroup = groups[nG - 1];
  const backToFront = groups.slice().reverse();
  const rangedFill = nG > 2 ? [groups[nG - 2], healGroup, ...groups.slice(0, nG - 2).reverse()] : backToFront;
  const place = (e, fill) => (fill.find(g => g.length < 5) || healGroup).push(e);

  roster.filter(e => e.r === 'Tank').forEach(e => place(e, groups));
  const placed = placeShamans(roster, groups, healGroup);
  const free = roster.filter(e => !placed.includes(e));
  free.filter(e => e.r === 'Healer').sort((a, b) => (b.c === 'Shaman') - (a.c === 'Shaman')).forEach(e => place(e, backToFront));
  const ranged = free.filter(e => e.r === 'Ranged').sort((a, b) => CASTER_ORDER.indexOf(a.c) - CASTER_ORDER.indexOf(b.c));
  const rest = [];
  for (const e of [...ranged.filter(isShadow), ...ranged.filter(isArcane), ...ranged.filter(e => !isShadow(e) && !isArcane(e))]) {
    if ((isShadow(e) || isArcane(e)) && healGroup.length < 5) healGroup.push(e);
    else rest.push(e);
  }
  free.filter(e => e.r === 'Melee').sort((a, b) => MELEE_ORDER.indexOf(a.c) - MELEE_ORDER.indexOf(b.c)).forEach(e => place(e, groups));
  rest.forEach(e => place(e, rangedFill));
  return groups.map(g => g.map(e => e.p));
}

// The first Shaman goes with the tanks in group 1, the second with the healers and the third in group 2.
// Non-healers are picked first for group 1 and 2, a Restoration Shaman first for the healers.
function placeShamans(roster, groups, healGroup) {
  const targets = [...new Set([groups[0], healGroup, groups[1]])].filter(Boolean);
  const left = roster.filter(e => e.c === 'Shaman'), placed = [];
  const spreadOrder = { Melee: 0, Ranged: 1, Healer: 2 }, healOrder = { Healer: 0, Ranged: 1, Melee: 2 };
  for (const t of targets) {
    if (!left.length || t.length >= 5) continue;
    const order = t === healGroup ? healOrder : spreadOrder;
    const s = left.slice().sort((a, b) => order[a.r] - order[b.r])[0];
    left.splice(left.indexOf(s), 1);
    placed.push(s);
    t.push(s);
  }
  return placed;
}

function sameTypeRaids(settings, rid) {
  const def = settings.raids.find(r => r.id === rid);
  return def ? settings.raids.filter(r => r.type === def.type && r.id !== rid).map(r => r.id) : [];
}

// Bench = everyone available that day who is not playing this raid or another raid of the same lockout.
function benchFor(week, rid, settings, players) {
  const raid = week.raids && week.raids[rid];
  if (!raid || !raid.dayId) return [];
  const inRoster = new Set((raid.roster || []).map(e => e.p));
  for (const other of sameTypeRaids(settings, rid)) {
    const o = week.raids[other];
    if (o && o.roster) o.roster.forEach(e => inRoster.add(e.p));
  }
  const av = availability(week, raid.dayId, players);
  const out = [];
  for (const [pid, info] of av) if (AVAILABLE.has(info.st) && !inRoster.has(pid)) out.push(pid);
  return out;
}

// Who can sit. Raids of one size share a lockout, so this covers all of them at once: everyone on any
// of their rosters plus the shared bench. A player is "needed" when the lockout cannot cover a buff or a
// tank/healer minimum (per raid, times the number of raids) without them.
function benchCandidates(week, rid, settings, players, weeks) {
  const raid = week.raids && week.raids[rid];
  const def = settings.raids.find(r => r.id === rid);
  if (!raid || !raid.dayId || !def) return null;
  const typeCfg = settings.types[def.type];
  const sb = sharedBench(week, settings, rid);
  const rids = sb.with.includes(rid) ? sb.with : [rid];
  const n = rids.length;
  const avs = Object.fromEntries(rids.map(r => [r, availability(week, week.raids[r].dayId, players)]));
  const inRoster = new Map();
  for (const r of rids) for (const e of week.raids[r].roster || []) if (!inRoster.has(e.p)) inRoster.set(e.p, { ...e, rid: r });
  const benchPids = [];
  for (const r of rids) for (const p of benchFor(week, r, settings, players)) if (!inRoster.has(p) && !benchPids.includes(p)) benchPids.push(p);
  const pool = [...inRoster.keys(), ...benchPids].map(pid => {
    const ent = inRoster.get(pid);
    const free = ent ? [ent.rid] : rids.filter(r => avs[r].has(pid));
    const info = (ent && avs[ent.rid].get(pid)) || free.map(r => avs[r].get(pid)).find(Boolean);
    const opts = info ? info.opts : playerOpts(players[pid], null);
    return { pid, opts, st: info ? info.st : null, t: info ? info.t : 0, rids: free };
  });
  const can = (c, test) => c.opts.some(test);
  const reasons = {};
  const need = (pid, why) => (reasons[pid] ||= []).push(why);
  for (const ru of settings.buffs) {
    const want = (ru.min || 1) * n;
    const prov = pool.filter(c => can(c, o => ruleMatches(ru, o.c, o.s)));
    if (prov.length && prov.length <= want) prov.forEach(c => need(c.pid, want > 1 ? `${ru.label} (${prov.length} of ${want})` : `only one for ${ru.label}`));
  }
  const tanks = pool.filter(c => can(c, o => o.r === 'Tank'));
  if (tanks.length <= typeCfg.tanks * n) tanks.forEach(c => need(c.pid, `tank (${tanks.length} of ${typeCfg.tanks * n})`));
  const heals = pool.filter(c => can(c, o => o.r === 'Healer'));
  if (heals.length <= typeCfg.healMin * n) heals.forEach(c => need(c.pid, `healer (${heals.length} of ${typeCfg.healMin * n})`));
  // Per raid: what its roster would lose without each member, and what each bench player free that day would add.
  const brings = {}, adds = {};
  for (const r of rids) {
    const roster = week.raids[r].roster || [];
    for (const ru of settings.buffs) {
      const prov = roster.filter(e => ruleMatches(ru, e.c, e.s));
      if (prov.length && prov.length <= (ru.min || 1)) prov.forEach(e => (brings[e.p] ||= []).push(ru.label));
      if (prov.length < (ru.min || 1)) pool.filter(c => !inRoster.has(c.pid) && c.rids.includes(r) && can(c, o => ruleMatches(ru, o.c, o.s))).forEach(c => (adds[c.pid] ||= []).push(ru.label));
    }
  }
  const W = settings.weights;
  const rows = pool.map(c => {
    const pl = players[c.pid] || {};
    const ent = inRoster.get(c.pid) || null;
    const debt = benchDebt(c.pid, def.type, week.id, weeks, settings);
    const rel = reliability(c.pid, week.id, weeks || {}, settings);
    return {
      p: c.pid, entry: ent, rid: ent ? ent.rid : null, rids: c.rids, opt: ent || c.opts[0] || null, st: c.st,
      needed: reasons[c.pid] || [], noBench: !!pl.noBench, locked: ent ? ((week.raids[ent.rid].locks || {})[c.pid] || null) : null,
      slot: ent && ['Tank', 'Healer'].includes(ent.r) ? ent.r : null,
      history: benchHistory(c.pid, def.type, week.id, weeks, settings), debt, rel, value: playerValue(pl, c.st, debt, W) - (Number(W.reliability) || 0) * rel.points,
      brings: brings[c.pid] || [], adds: adds[c.pid] || [], t: c.t, opts: c.opts,
    };
  });
  // Bench order for DPS: no buff at stake first, then the lowest value (players of a crowded spec
  // group in their raid count a little lower), then the latest signup.
  const groupCount = Object.fromEntries(rids.map(r => [r, {}]));
  for (const r of rids) for (const e of week.raids[r].roster || []) { const k = spreadKey(e.c, e.s); groupCount[r][k] = (groupCount[r][k] || 0) + 1; }
  for (const r of rows) {
    const k = r.opt ? spreadKey(r.opt.c, r.opt.s) : '';
    const crowd = r.entry ? (groupCount[r.rid][k] || 0) : Math.min(...(r.rids.length ? r.rids : rids).map(x => (groupCount[x][k] || 0) + 1));
    r.crowd = crowd;
    r.orderValue = r.value - (Number(W.specSpread) || 0) * Math.max(0, crowd - 1);
  }
  const key = r => (r.brings.length ? 1 : 0) - (r.adds.length ? 1 : 0);
  rows.sort((a, b) => key(a) - key(b) || a.orderValue - b.orderValue || (b.t || 0) - (a.t || 0));
  return { rows, rids, size: typeCfg.size * n, typeCfg, toBench: Math.max(0, pool.length - typeCfg.size * n) };
}

// Why each bench player sits, in words an officer can pass on.
function explainBench(week, rid, settings, players, weeks) {
  const raid = week.raids[rid];
  const def = settings.raids.find(r => r.id === rid);
  if (!raid || !def) return [];
  const typeCfg = settings.types[def.type];
  const W = settings.weights;
  const roster = raid.roster || [];
  const rc = roleCounts(roster);
  const av = availability(week, raid.dayId, players);
  const locks = raid.locks || {};
  const name = (p, c) => charName(players, p, null, c);
  const debtOf = p => benchDebt(p, def.type, week.id, weeks || {}, settings);
  const relOf = p => (W.reliability ? reliability(p, week.id, weeks || {}, settings).points : 0);
  // What a player is worth for a DPS spot, the same way the optimizer weighs it.
  const value = p => playerValue(players[p] || {}, (av.get(p) || {}).st, debtOf(p), W) - (Number(W.reliability) || 0) * relOf(p);
  const dps = roster.filter(e => e.r === 'Melee' || e.r === 'Ranged');
  // Buffs this roster would lose without the player.
  const carries = e => settings.buffs.filter(ru => ruleMatches(ru, e.c, e.s) && roster.filter(x => ruleMatches(ru, x.c, x.s)).length <= (ru.min || 1)).map(ru => ru.label);
  return benchFor(week, rid, settings, players).map(pid => {
    const info = av.get(pid);
    const why = [];
    const pl = players[pid] || {};
    if (locks[pid] === 'out') why.push('Kept out by an officer');
    else if (info.st === 'bench') why.push('Signed up as bench');
    else {
      const roles = new Set(info.opts.map(o => o.r));
      if (roles.size === 1 && roles.has('Tank') && rc.Tank >= typeCfg.tanks) why.push('Tank spots are full');
      else if (roles.size === 1 && roles.has('Healer') && rc.Healer >= typeCfg.healTarget) why.push('Healer spots are full');
      else {
        const v = value(pid);
        // DPS who got in although they weigh the same or less: say what kept them in.
        const notAbove = dps.filter(e => value(e.p) <= v + 1e-6);
        // Only buffs this player could not have brought instead count as a reason.
        const short = l => l.replace(/\s*\(.*\)\s*/, '');
        const canBring = ru => info.opts.some(o => ruleMatches(ru, o.c, o.s));
        const held = notAbove.map(e => {
          if (locks[e.p] === 'in') return `${name(e.p, e.c)} (kept in by an officer)`;
          if ((players[e.p] || {}).noBench) return `${name(e.p, e.c)} (never bench)`;
          const c = carries(e).filter(l => !canBring(settings.buffs.find(ru => ru.label === l)));
          return c.length ? `${name(e.p, e.c)} (${c.map(short).join(', ')})` : null;
        }).filter(Boolean);
        if (held.length) why.push(`DPS spots went to players the raid needs: ${held.slice(0, 3).join(', ')}${held.length > 3 ? ` and ${held.length - 3} more` : ''}`);
        else if (notAbove.length) {
          // Same footing as some who play: the spec mix or the signup time decided.
          const o = info.opts[0];
          const same = roster.filter(e => spreadKey(e.c, e.s) === spreadKey(o.c, o.s)).length;
          const label = ONE_GROUP_CLASSES.has(o.c) ? `${o.c}s` : `${o.s} ${o.c}s`;
          const later = notAbove.every(e => ((av.get(e.p) || {}).t || 0) <= (info.t || 0));
          why.push(W.specSpread && same >= 2 ? `DPS spots full: already ${same} ${label} in the raid`
            : later ? 'DPS spots full: signed up later than the others' : 'DPS spots went to a better mix of specs and teams');
        } else {
          // Everyone in weighs more: name what counts most against this player.
          const others = dps.map(e => e.p);
          const avg = f => others.length ? others.reduce((n, p) => n + f(p), 0) / others.length : 0;
          const parts = [];
          if (info.st === 'tentative' || info.st === 'late') parts.push(`signed up ${info.st}`);
          if (debtOf(pid) < avg(debtOf) - 0.05) parts.push('benched less lately than the others');
          if ((Number(pl.prio) || 0) < avg(p => Number((players[p] || {}).prio) || 0) - 0.01) parts.push('lower priority');
          if (W.parse && (Number(pl.parse) || 0) < avg(p => Number((players[p] || {}).parse) || 0) - 5) parts.push('lower parse');
          if (relOf(pid) > 0) parts.push('recent no-shows or drops');
          why.push(parts.length ? `DPS spots full: ${parts.join(', ')}` : 'DPS spots full: the others weigh more');
        }
      }
    }
    if (why[0] && !/^DPS spots full/.test(why[0]) && (info.st === 'tentative' || info.st === 'late')) why.push(`signed up ${info.st}`);
    return { p: pid, why: why.join(', '), debt: debtOf(pid) };
  });
}

// ---------- Bench statistics ----------
// Per player and raid size, over every week that counts (final, or with recorded attendance): how many
// lockouts they played, sat on the bench, and the last week they sat. A lockout counts once a week.
function benchStats(weeks, settings) {
  const out = {};
  const types = [...new Set(settings.raids.map(r => r.type))];
  const list = Object.values(weeks || {}).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
  for (const w of list) {
    for (const type of types) {
      const played = new Set(), benched = new Set();
      for (const def of settings.raids) {
        const raid = (w.raids || {})[def.id];
        if (def.type !== type || !raid) continue;
        const att = (w.attendance || {})[def.id];
        if (!att && w.status !== 'final') continue;
        (att ? att.present || [] : (raid.roster || []).map(e => e.p)).forEach(p => played.add(p));
        (att ? att.bench || [] : raid.bench || []).forEach(p => benched.add(p));
      }
      for (const p of new Set([...played, ...benched])) {
        const s = ((out[p] ||= {})[type] ||= { played: 0, bench: 0, last: null });
        if (played.has(p)) s.played++;
        else { s.bench++; s.last = w.id; }
      }
    }
  }
  return out;
}

// ---------- Export / import strings ----------
// The character a player is on: an alt's name when they play that alt's class, else their main.
function charName(players, pid, fallback, cls) {
  const pl = players[pid];
  const alt = pl && cls && cls !== pl.cls && Array.isArray(pl.alts) ? pl.alts.find(a => a && a.cls === cls && a.char) : null;
  if (alt) return alt.char;
  return (pl && pl.char) || guessChar(fallback || (pl && pl.name) || pid);
}

// Raids of one size share a lockout, so they share one bench: everyone signed up for any of them who
// plays none of them. It is shown once, with the last of them, whatever days they are on.
// with = the raids sharing it, show = whether this raid shows it.
function sharedBench(week, settings, rid) {
  const raid = week.raids && week.raids[rid];
  const def = settings.raids.find(r => r.id === rid);
  if (!raid || !raid.dayId || !def) return { show: true, with: [rid] };
  const group = settings.raids.filter(r => r.type === def.type && week.raids[r.id] && week.raids[r.id].dayId && week.days && week.days[week.raids[r.id].dayId] && (week.raids[r.id].roster || []).length).map(r => r.id);
  if (group.length < 2 || !group.includes(rid)) return { show: true, with: [rid] };
  return { show: group[group.length - 1] === rid, with: group };
}

// The shared bench in call-in order: [{p, rids}], rids = the raids of the lockout they are free for.
// days = how many different days the lockout is on (day tags only matter when it is more than one).
function sharedBenchList(week, settings, players, weeks, sb) {
  const out = [], seen = new Map();
  for (const rid of sb.with) {
    for (const p of benchByTurn(week, rid, settings, players, weeks)) {
      if (!seen.has(p)) { seen.set(p, { p, rids: [] }); out.push(seen.get(p)); }
      seen.get(p).rids.push(rid);
    }
  }
  const days = new Set(sb.with.map(rid => week.raids[rid].dayId)).size;
  return { list: out, days };
}

// "Wed only" when a bench player is free for just some days of the lockout.
function benchDayTag(week, sb, entry, days) {
  if (days < 2 || entry.rids.length === sb.with.length) return '';
  const names = [...new Set(entry.rids.map(rid => parseIso(week.days[week.raids[rid].dayId].date).toLocaleDateString('en-GB', { weekday: 'short' })))];
  return `${names.join('/')} only`;
}
function benchLabel(settings, sb) {
  return sb.with.length > 1 ? `Bench for ${sb.with.map(id => (settings.raids.find(r => r.id === id) || {}).name || id).join(' and ')}` : 'Bench';
}

// Bench players with the one most owed a spot first: the order the addon calls them in.
function benchByTurn(week, rid, settings, players, weeks) {
  const bench = benchFor(week, rid, settings, players);
  if (!weeks) return bench;
  const bc = benchCandidates(week, rid, settings, players, weeks);
  if (!bc) return bench;
  const order = bc.rows.map(r => r.p).reverse();
  return bench.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

// Each player is "Name:Class:Spec" so the addon can show class icons and colours.
function exportAddon(week, settings, players, weeks) {
  const lines = ['!NPR1!', `W;${week.id}`];
  const tag = (p, o) => `${charName(players, p, null, o && o.c)}${o ? `:${o.c}:${o.s}` : ''}`;
  for (const def of settings.raids) {
    const raid = week.raids && week.raids[def.id];
    if (!raid || !raid.dayId || !(raid.roster || []).length) continue;
    if (!week.days || !week.days[raid.dayId]) continue;
    const date = week.days[raid.dayId].date;
    lines.push(`R;${def.id};${def.type};${date};${def.name.replace(/[;|]/g, '/')}`);
    const byP = Object.fromEntries((raid.roster || []).map(e => [e.p, e]));
    const av = availability(week, raid.dayId, players);
    (raid.groups || []).forEach((g, i) => { if (g.length) lines.push(`G;${i + 1};${g.map(p => tag(p, byP[p])).join(',')}`); });
    const bench = benchByTurn(week, def.id, settings, players, weeks);
    if (bench.length) lines.push(`B;${bench.map(p => tag(p, (av.get(p) || { opts: [] }).opts[0])).join(',')}`);
  }
  return lines.join('\n');
}

// opts.mentions: write players as Discord @mentions (players imported from Raid-Helper have their Discord ID).
function exportDiscord(week, settings, players, opts = {}) {
  const tag = (p, c) => (opts.mentions && /^\d{15,22}$/.test(p) ? `<@${p}>` : charName(players, p, null, c));
  const fmtDay = iso => parseIso(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  const out = [`**Raid roster, ${weekName(week.id).toLowerCase()} (${weekSpan(week.id)})**`];
  const days = week.days || {};
  const defs = settings.raids.filter(d => week.raids && week.raids[d.id] && days[week.raids[d.id].dayId] && (week.raids[d.id].roster || []).length)
    .sort((a, b) => days[week.raids[a.id].dayId].date.localeCompare(days[week.raids[b.id].dayId].date));
  for (const def of defs) {
    const raid = week.raids[def.id];
    const byP = Object.fromEntries((raid.roster || []).map(e => [e.p, e]));
    out.push('', `__${fmtDay(week.days[raid.dayId].date)}: ${def.name}__`);
    (raid.groups || []).forEach((g, i) => {
      if (!g.length) return;
      out.push(`G${i + 1}: ${g.map(p => `${tag(p, byP[p] && byP[p].c)} (${byP[p] ? shortSpec(byP[p].s) + ' ' + byP[p].c : '?'})`).join(', ')}`);
    });
    const sb = sharedBench(week, settings, def.id);
    const sbl = sb.show ? sharedBenchList(week, settings, players, opts.weeks, sb) : { list: [], days: 1 };
    if (sbl.list.length) out.push(`${benchLabel(settings, sb)} (be available on Discord, you get DKP): ${sbl.list.map(e => { const d = benchDayTag(week, sb, e, sbl.days); return tag(e.p) + (d ? ` (${d})` : ''); }).join(', ')}`);
  }
  if (defs.some(def => (week.raids[def.id].roster || []).some(e => e.off))) out.push('', '_Specs are what each player plays in that raid; some are off-specs._');
  return out.join('\n');
}

// "!NPA1!" attendance from the addon -> {weekId, rid, date, present: [pid], bench: [pid], late: [pid], unknown: [name]}
function parseAttendance(text, players) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines[0] !== '!NPA1!') throw new Error('This is not an NP Roster attendance string. In game, type /nproster, open Attendance and copy the string.');
  const byName = {};
  for (const [pid, pl] of Object.entries(players)) {
    if (pl && pl.char) byName[nameKey(pl.char)] = pid;
    for (const a of (pl && Array.isArray(pl.alts) ? pl.alts : [])) if (a && a.char) byName[nameKey(a.char)] = pid;
  }
  // unknown: in-game names no player has yet, with the list each came from, so officers can match them.
  const res = { weekId: '', rid: '', date: '', present: [], bench: [], late: [], unknown: [], unknownIn: {} };
  const map = (list, where) => list.split(',').map(s => s.trim()).filter(Boolean).map(n => {
    const name = n;
    const pid = byName[nameKey(name)];
    if (!pid) {
      if (!res.unknown.includes(name)) res.unknown.push(name);
      (res.unknownIn[name] ||= []).push(where);
    }
    return pid;
  }).filter(Boolean);
  for (const l of lines.slice(1)) {
    // The addon writes ';' (WoW edit boxes treat '|' as an escape), '|' is accepted too.
    const [k, ...rest] = l.replace(/\|\|/g, '|').split(/[;|]/);
    if (k === 'R') { [res.rid, res.weekId, res.date] = rest; }
    else if (k === 'P') res.present = map(rest.join(','), 'present');
    else if (k === 'B') res.bench = map(rest.join(','), 'bench');
    else if (k === 'L') res.late = map(rest.join(','), 'late');
  }
  if (!res.rid || !res.weekId) throw new Error('The attendance string is missing its raid line. Copy the whole string from the addon.');
  return res;
}

if (typeof module !== 'undefined') {
  module.exports = {
    CLASSES, DEFAULT_SETTINGS, withDefaults, spreadKey, isoWeek, weekName, weekSpan, parseRaidHelper, parseRaidHelperMany, splitJsonObjects, benchByTurn, guessChar, nameKey, availability, playerOpts, optimizeType, planWeek,
    makeGroups, coverage, roleCounts, benchFor, attendanceCellOf, lastTeams, awayOn, benchStats, charName, teamCore, reliability, UNRELIABLE_POINTS, explainBench, benchCandidates, sharedBench, sharedBenchList, benchDayTag, benchLabel, benchHistory, playerValue, isDesignatedTank, exportAddon, exportDiscord, parseAttendance, resetOf, addDays, benchDebt,
  };
}
