// NP Roster UI: shared state through the artifact database, rendering and interactions.

const S = {
  settings: withDefaults(null), settingsRaw: null, players: {}, weeks: {},
  view: 'week', weekId: null, sel: null, drafts: {}, suggestions: null, importOpen: null, confirm: null,
  db: null, canWrite: true, loaded: 0, pending: false, benchDraft: {}, decideOpen: {},
  history: {}, histLocal: {}, histData: {}, histReady: false, historyLast: 0, busy: false, logLimit: 200,
  me: null, userApi: null, names: {}, namesPending: new Set(), restore: null, card: null,
};
const view = document.getElementById('view');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ST_TEXT = { yes: 'Signed up', tentative: 'Tentative', late: 'Late', bench: 'Bench', absence: 'Absent', none: 'Not signed up' };
const ST_ORDER = ['yes', 'tentative', 'late', 'bench', 'absence', 'none'];

const ICON = {
  check: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  pin: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.5v4m0 0L4.5 9h7L8 5.5Zm0 3.5v5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lock: '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" stroke-width="1.6"/></svg>',
  undo: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5.5 3.5 2.5 6.5l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 6.5h6.5a4 4 0 0 1 0 8H7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  spark: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.5 9.4 6.6 14.5 8l-5.1 1.4L8 14.5 6.6 9.4 1.5 8l5.1-1.4L8 1.5Z" fill="currentColor"/></svg>',
};

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o ?? null));
const fmtDay = iso => parseIso(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const charOf = pid => charName(S.players, pid);
const week = () => S.weeks[S.weekId] || null;
const ctx = () => ({ week: week(), players: S.players, weeks: S.weeks, settings: S.settings });
const raidDef = rid => S.settings.raids.find(r => r.id === rid);
function store(k, v) { try { localStorage.setItem('npr.' + k, v); } catch (e) { /* storage blocked */ } }
function load(k) { try { return localStorage.getItem('npr.' + k); } catch (e) { return null; } }

let toastTimer;
function toast(msg, action) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-act="${action.act}">${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 7000 : 4500);
}
function setConn(state, text) {
  document.getElementById('conn').innerHTML = `<span class="dot ${state}"></span><span>${esc(text)}</span>`;
}

// ---------- persistence ----------
let queue = Promise.resolve();
function enqueue(fn) {
  queue = queue.then(fn).catch(e => {
    if (e && e.code === 'invalid_argument') { S.canWrite = false; toast('You have view access, so your changes are not saved. Ask the owner for Contributor or Editor access.'); }
    else if (e && e.code === 'quota_exceeded') toast('Storage is full: ' + e.message);
    else toast('Could not save: ' + ((e && e.message) || e));
  });
  return queue;
}
function deepMerge(t, p) {
  for (const [k, v] of Object.entries(p)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) deepMerge(t[k], v);
    else t[k] = v;
  }
  return t;
}
// Each save also goes into the history (see History below); `text` is its line in the Log.
function saveWeek(wid, patch, text) {
  const old = S.weeks[wid] || null;
  const local = old ? deepMerge(clone(old), patch) : clone(patch);
  S.weeks[wid] = local;
  schedule();
  if (S.db) enqueue(() => old ? S.db.doc('weeks/' + wid).update(patch) : S.db.doc('weeks/' + wid).set(local));
  record(weekChanges(wid, old, local, patch), text || `Changed ${weekName(wid)}`);
}
function deleteWeek(wid, text) {
  const old = S.weeks[wid] || null;
  delete S.weeks[wid];
  if (S.weekId === wid) S.weekId = null;
  schedule();
  if (S.db) enqueue(() => S.db.doc('weeks/' + wid).delete());
  record([{ p: 'w/' + wid, b: old, a: null }], text || `Deleted ${weekName(wid)}`);
}
function savePlayer(pid, data, text) {
  const old = S.players[pid] || null;
  S.players[pid] = data;
  schedule();
  if (S.db) enqueue(() => S.db.doc('players/' + pid).set(data));
  record([{ p: 'p/' + pid, b: old, a: data }], text || `Changed ${charOf(pid)}`);
}
function deletePlayer(pid, text) {
  const old = S.players[pid] || null;
  const name = charOf(pid);
  delete S.players[pid];
  schedule();
  if (S.db) enqueue(() => S.db.doc('players/' + pid).delete());
  record([{ p: 'p/' + pid, b: old, a: null }], text || `Deleted ${name}`);
}
let settingsTimer;
function saveSettings(next, text) {
  record([{ p: 's', b: S.settingsRaw, a: next }], text || 'Changed the settings');
  S.settingsRaw = next;
  S.settings = withDefaults(next);
  schedule();
  clearTimeout(settingsTimer);
  if (S.db) settingsTimer = setTimeout(() => enqueue(() => S.db.doc('settings/main').set(clone(next))), 400);
}
function settingsCopy() { return clone(S.settingsRaw ? withDefaults(S.settingsRaw) : S.settings); }

async function connect() {
  const c = window.claude && window.claude.use ? window.claude : null;
  const db = c ? await c.use('db') : null;
  if (!db) {
    setConn('off', 'Offline: changes stay in this tab');
    S.loaded = 3; S.histReady = true; schedule();
    return;
  }
  S.db = db;
  setConn('on', 'Shared · live');
  const fail = e => { setConn('off', 'Connection lost, reload the page'); toast((e && e.message) || 'Connection lost'); };
  db.collection('players').onSnapshot(snap => {
    S.players = Object.fromEntries(snap.docs.map(d => [d.id, clone(d.data())]));
    S.loaded |= 1; schedule();
  }, fail);
  db.collection('weeks').onSnapshot(snap => {
    S.weeks = Object.fromEntries(snap.docs.map(d => [d.id, { ...clone(d.data()), id: d.id }]));
    S.loaded |= 2; schedule();
  }, fail);
  db.doc('settings/main').onSnapshot(d => {
    S.settingsRaw = d.exists ? clone(d.data()) : null;
    S.settings = withDefaults(S.settingsRaw);
    schedule();
  }, fail);
  db.collection('history').orderBy('at', 'desc').limit(HIST_MAX).onSnapshot(snap => {
    S.history = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
    for (const id of Object.keys(S.histLocal)) if (S.history[id]) delete S.histLocal[id];
    for (const d of snap.docs) S.historyLast = Math.max(S.historyLast, d.data().at || 0);
    const first = !S.histReady;
    S.histReady = true;
    // Own changes are already shown; after the first load, others' entries only matter on the Log tab.
    if (first || S.view === 'log') schedule();
  }, () => { S.histReady = true; schedule(); toast('The change history could not be loaded. Roster changes still save.'); });
  const user = await c.use('user');
  if (user) {
    S.userApi = user;
    S.me = await user.id();
    const can = await user.can('data.write');
    if (can === false) { S.canWrite = false; setConn('on', 'Shared · view only'); }
  }
  setTimeout(pruneHistory, 8000);
}

// ---------- rendering ----------
// Animation frames pause in background tabs, so a timer backs them up.
let queued = false;
function schedule() {
  if (queued) return;
  queued = true;
  const run = () => { if (!queued) return; queued = false; render(); };
  requestAnimationFrame(run);
  setTimeout(run, 60);
}

function render() {
  const ae = document.activeElement;
  // Don't wipe a field someone is typing in; render again when they leave it.
  if (ae && view.contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && !ae.dataset.draft && ae.type !== 'checkbox' && ae.value !== ae.defaultValue) { S.pending = true; return; }
  // Nor replace the availability dropdowns while someone works through them: a redraw would close
  // the one they just opened. The rest of the page catches up when they click elsewhere.
  if (isStatusSelect(ae)) { S.pending = true; return; }
  const fid = ae && ae.id;
  let ss = null, se = null;
  try { ss = ae.selectionStart; se = ae.selectionEnd; } catch (e) { /* not a text field */ }
  relCache = {};
  document.querySelectorAll('#tabs a').forEach(a => a.setAttribute('aria-current', a.dataset.v === S.view ? 'page' : 'false'));
  if (S.view === 'players') view.innerHTML = renderPlayers();
  else if (S.view === 'attendance') view.innerHTML = renderAttendance();
  else if (S.view === 'settings') view.innerHTML = renderSettings();
  else if (S.view === 'log') view.innerHTML = renderLogView();
  else view.innerHTML = renderWeek();
  // The table-heavy tabs use more of a wide screen.
  document.body.classList.toggle('wide', S.view === 'players' || S.view === 'attendance');
  renderSelbar();
  renderCard();
  if (fid) {
    const el = document.getElementById(fid);
    if (el) { el.focus({ preventScroll: true }); try { if (ss != null) el.setSelectionRange(ss, se); } catch (e) { /* select etc. */ } }
  }
}
const isStatusSelect = el => !!(el && el.tagName === 'SELECT' && el.dataset.act === 'set-st' && view.contains(el));
view.addEventListener('focusout', e => {
  if (!S.pending || isStatusSelect(e.relatedTarget)) return;
  S.pending = false;
  setTimeout(render, 0);
});

function classOptions(sel) {
  return ['<option value="">Class…</option>'].concat(Object.keys(CLASSES).map(c => `<option ${c === sel ? 'selected' : ''}>${c}</option>`)).join('');
}
function specOptions(cls, sel, blank) {
  const specs = CLASSES[cls] ? Object.keys(CLASSES[cls]) : [];
  return (blank ? [`<option value="">${blank}</option>`] : []).concat(specs.map(s => `<option ${s === sel ? 'selected' : ''}>${s}</option>`)).join('');
}
// Blizzard's spec icons (class icon when the spec is unknown), published next to the page in icons/.
function iconUrl(c, s) {
  if (!CLASSES[c]) return null;
  return CLASSES[c][s] ? `icons/${c.toLowerCase()}-${s.toLowerCase()}.jpg` : `icons/class-${c.toLowerCase()}.jpg`;
}
function classIcon(c, s) {
  const url = iconUrl(c, s);
  if (!url) return '<span class="ci" title="Class not set"></span>';
  return `<img class="ci c-${esc(c)}" src="${url}" alt="" width="18" height="18" title="${esc(CLASSES[c][s] ? s + ' ' : '')}${esc(c)}">`;
}
const who = (pid, cls, spec) => {
  const p = S.players[pid] || {};
  return `<span class="who">${classIcon(cls || p.cls, spec || (cls && cls !== p.cls ? '' : p.main))}${esc(charOf(pid))}</span>`;
};
const loadingHtml = () => `<div class="empty">Loading the shared roster…</div>`;
const panelHead = (title, sub, actions) => `<div class="panel-head"><div><h2>${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${actions ? `<div class="row">${actions}</div>` : ''}</div>`;

// ---------- Week view ----------
function sortedWeeks() { return Object.values(S.weeks).filter(Boolean).sort((a, b) => b.id.localeCompare(a.id)); }
function pickWeek() {
  if (S.weekId && S.weeks[S.weekId]) return;
  const saved = load('week');
  if (saved && S.weeks[saved]) { S.weekId = saved; return; }
  const now = resetOf(isoDate(new Date()));
  const ws = sortedWeeks();
  S.weekId = (ws.find(w => w.id === now) || ws.slice().reverse().find(w => w.id > now) || ws[0] || {}).id || null;
}
function dayList(w) {
  return Object.entries(w.days || {}).filter(([, d]) => d).sort((a, b) => a[1].date.localeCompare(b[1].date));
}

function renderWeek() {
  if (S.loaded < 3) return loadingHtml();
  pickWeek();
  const ws = sortedWeeks();
  const w = week();
  // The next weeks that don't exist yet, by week number.
  const thisReset = resetOf(isoDate(new Date()));
  const newWeeks = Array.from({ length: 12 }, (_, i) => addDays(thisReset, 7 * i)).filter(id => !S.weeks[id]);
  const banner = !S.canWrite ? `<div class="banner">You can look, but not change anything. Ask the owner for Contributor or Editor access.</div>`
    : (!S.db ? `<div class="banner">The shared database is not available here, so nothing you do is saved. Open the page on claude.ai while signed in.</div>` : '');
  const head = `
    <section class="panel">
      ${banner}
      <div class="weekbar">
        <div class="row" style="align-items:flex-end">
          <div class="title"><span class="eyebrow">Raid week</span>
          ${ws.length ? `<select id="week-sel" data-act="pick-week" aria-label="Raid week">${ws.map(x => `<option value="${x.id}" ${x.id === S.weekId ? 'selected' : ''}>${esc(weekName(x.id))} · ${esc(weekSpan(x.id))} ${esc(addDays(x.id, 1).slice(0, 4))}</option>`).join('')}</select>` : '<h2>No weeks yet</h2>'}
          </div>
          ${w ? `<span class="pill ${w.status === 'final' ? 'ok' : ''}" style="margin-bottom:7px">${w.status === 'final' ? 'Final' : 'Draft'}</span>` : ''}
        </div>
        <div class="row" style="align-items:flex-end">
          ${undoTarget(w) ? `<button data-act="undo" title="Undo your last change to this week (Ctrl+Z): ${esc(undoTarget(w).text)}" ${S.busy ? 'disabled' : ''}>${ICON.undo} Undo</button>` : ''}
          <label class="f">New week<select id="new-week-sel" aria-label="New week">${newWeeks.map(id => `<option value="${id}">${esc(weekName(id))} · ${esc(weekSpan(id))}</option>`).join('')}</select></label>
          <button data-act="new-week">Create week</button>
        </div>
      </div>
    </section>`;
  if (!w) {
    return head + `<div class="empty"><h2>Plan your first raid week</h2><div>Weeks are named by week number and run from reset on Wednesday to Tuesday. Create one above, then import each raid day's Raid-Helper signups.</div></div>`;
  }
  const note = (w.notes || {}).week || '';
  const notes = `<section class="panel"><label class="f">Officer notes for ${esc(weekName(w.id))}<textarea id="note-week" data-act="note" data-k="week" class="note" placeholder="Only officers see this, e.g. who is late on Sunday or what to remind people of.">${esc(note)}</textarea></label></section>`;
  return head + notes + renderSummary(w) + renderDays(w) + renderAvailability(w) + renderPlan(w) + renderRaids(w) + renderExports(w);
}

function renderSummary(w) {
  const cards = S.settings.raids.map(def => {
    const raid = w.raids && w.raids[def.id];
    const size = (S.settings.types[def.type] || {}).size || 0;
    if (!raid || !raid.dayId || !w.days[raid.dayId]) {
      return `<button class="sum" data-act="goto" data-rid="${def.id}"><div class="top"><span class="name">${esc(def.name)}</span><span class="when">Not planned</span></div><div class="big">–</div><div class="meter">${S.settings.buffs.map(() => '<i></i>').join('')}</div></button>`;
    }
    const roster = raid.roster || [];
    const cov = coverage(roster, S.settings);
    const ok = cov.filter(c => c.ok).length;
    return `<button class="sum" data-act="goto" data-rid="${def.id}">
      <div class="top"><span class="name">${esc(def.name)}</span><span class="when">${esc(fmtDay(w.days[raid.dayId].date))}</span></div>
      <div class="row spread"><div class="big">${roster.length}<span>/${size}</span></div><span class="pill ${ok === cov.length ? 'ok' : 'warn'}">${ok}/${cov.length} buffs</span></div>
      <div class="meter" title="Buffs in priority order">${cov.map(c => `<i class="${c.ok ? 'on' : ''}"></i>`).join('')}</div>
    </button>`;
  }).join('');
  return `<div class="summary">${cards}</div>`;
}

function dayRoleCounts(w, did) {
  const av = availability(w, did, S.players);
  const rc = { Tank: 0, Healer: 0, Melee: 0, Ranged: 0 }, alt = { Tank: 0, Healer: 0, Melee: 0, Ranged: 0 }, st = {};
  for (const info of av.values()) {
    st[info.st] = (st[info.st] || 0) + 1;
    if (!AVAILABLE.has(info.st)) continue;
    rc[info.opts[0].r]++;
    for (const r of new Set(info.opts.slice(1).map(o => o.r))) if (r !== info.opts[0].r) alt[r]++;
  }
  return { rc, alt, st, n: [...av.values()].filter(i => AVAILABLE.has(i.st)).length };
}

function renderDays(w) {
  const days = dayList(w);
  const cards = days.map(([did, d]) => {
    const { rc, alt, st, n } = dayRoleCounts(w, did);
    const rcell = (k, l) => `<div class="rc" title="${rc[k]} main spec${alt[k] ? `, ${alt[k]} more as off-spec` : ''}"><span class="l">${l}</span><span class="v">${rc[k]}${alt[k] ? `<small>+${alt[k]}</small>` : ''}</span></div>`;
    const raidsHere = S.settings.raids.filter(def => w.raids && w.raids[def.id] && w.raids[def.id].dayId === did);
    const open = S.importOpen === did;
    const evId = S.drafts['ev-' + did] ?? d.eventId ?? '';
    const imp = open ? `
      <label class="f">Raid-Helper event link or ID<input id="ev-${did}" data-draft="ev-${did}" value="${esc(evId)}" placeholder="https://raid-helper.xyz/event/…"></label>
      ${eventIdFrom(evId) ? `<a class="btn" href="https://raid-helper.xyz/api/event/${eventIdFrom(evId)}" target="_blank" rel="noopener">Open event data ↗</a>` : '<div class="small muted">Paste the event link to get the data link.</div>'}
      <div class="small muted">Select all on that page (Ctrl+A), copy, and paste below.</div>
      <textarea id="imp-${did}" data-draft="imp-${did}" placeholder='{"date":"…","signups":[…]}'>${esc(S.drafts['imp-' + did] || '')}</textarea>
      <div class="row"><button class="primary" data-act="import" data-day="${did}">Import signups</button><button class="ghost" data-act="toggle-import" data-day="${did}">Cancel</button></div>` : '';
    return `
      <div class="day">
        <div class="row spread"><span class="date">${esc(fmtDay(d.date))}</span>
          <button class="ghost danger sm" data-act="remove-day" data-day="${did}">${S.confirm === 'day-' + did ? 'Confirm remove' : 'Remove'}</button></div>
        <div class="evt" title="${esc(d.eventTitle || '')}">${d.eventTitle ? esc(d.eventTitle) : 'No signups imported yet'}</div>
        <div class="row small"><b class="mono">${n}</b><span class="muted">available</span></div>
        <div class="rolecount">${rcell('Tank', 'Tanks')}${rcell('Healer', 'Healers')}${rcell('Melee', 'Melee')}${rcell('Ranged', 'Ranged')}</div>
        ${(raidsHere.length || st.tentative || st.late || st.bench || st.absence) ? `<div class="daytags">${raidsHere.map(def => `<span class="pill acc">${esc(def.name)}</span>`).join('')}${['tentative', 'late', 'bench', 'absence'].filter(k => st[k]).map(k => `<span class="pill ${k === 'absence' ? 'bad' : 'warn'}">${st[k]} ${STATUS_LABEL[k].toLowerCase()}</span>`).join('')}</div>` : ''}
        ${open ? imp : `<button data-act="toggle-import" data-day="${did}">${d.eventTitle ? 'Re-import signups' : 'Import signups'}</button>`}
      </div>`;
  }).join('');
  return `
    <section class="panel">
      ${panelHead('Raid days', 'Import each day from Raid-Helper, or all days at once. Numbers after + can play that role as off-spec.',
        `<button class="primary" data-act="toggle-import" data-day="all">Import all days</button><input type="date" id="add-day-date" min="${w.id}" max="${addDays(w.id, 6)}" value="${addDays(w.id, 1)}" aria-label="New raid day"><button data-act="add-day">Add raid day</button>`)}
      ${S.importOpen === 'all' ? `<div class="stack day">
        <b>Import all days at once</b>
        <div class="sub">Open each event's data link (raid-helper.xyz/api/event/<i>event ID</i>), select all, copy, and paste them here one after another. Each event goes to the raid day with its date; a day that is missing in this week is added.</div>
        <textarea id="imp-all" data-draft="imp-all" style="min-height:140px" placeholder='{"date":"…","signups":[…]}  {"date":"…","signups":[…]}'>${esc(S.drafts['imp-all'] || '')}</textarea>
        <div class="row"><button class="primary" data-act="import-week">Import</button><button class="ghost" data-act="toggle-import" data-day="all">Cancel</button></div>
      </div>` : ''}
      ${days.length ? `<div class="days">${cards}</div>` : '<div class="empty">No raid days in this week. Add one above.</div>'}
    </section>`;
}

function renderAvailability(w) {
  const days = dayList(w);
  if (!days.length) return '';
  const pids = new Set();
  days.forEach(([did]) => ((w.signups || {})[did] || []).forEach(s => pids.add(s.p)));
  Object.entries(S.players).forEach(([pid, p]) => { if (p && p.active !== false) pids.add(pid); });
  const rows = [...pids].filter(pid => S.players[pid]).sort((a, b) => {
    const pa = S.players[a], pb = S.players[b];
    return String(pa.cls).localeCompare(String(pb.cls)) || charOf(a).localeCompare(charOf(b));
  });
  if (!rows.length) return '';
  const body = rows.map(pid => {
    const p = S.players[pid];
    const cells = days.map(([did]) => {
      const su = ((w.signups || {})[did] || []).find(s => s.p === pid);
      const st = su ? su.st : 'none';
      // A signup added by hand has no spec, so fall back to the player's registered main spec.
      const o = su ? playerOpts(S.players[pid], su)[0] : null;
      return `<td class="st"><select id="st-${did}-${pid}" class="stsel sd-${st}" data-act="set-st" data-day="${did}" data-pid="${pid}" aria-label="${esc(charOf(pid))} on ${esc(fmtDay(w.days[did].date))}" title="${o ? esc(`Signed up as ${o.s} ${o.c}`) : ''}">${ST_ORDER.map(k => `<option value="${k}" ${k === st ? 'selected' : ''}>${ST_TEXT[k]}</option>`).join('')}</select></td>`;
    }).join('');
    return `<tr><td>${cardLink(pid, who(pid))}${relWarn(pid)}</td><td class="muted small">${esc(p.main || '')}</td>${cells}</tr>`;
  }).join('');
  const legend = ST_ORDER.map(s => `<span class="sd sd-${s}">${ST_TEXT[s]}</span>`).join('');
  return `
    <section class="panel">
      <details class="big" ${load('av-open') === '0' ? '' : 'open'} data-act="av-toggle">
        <summary><h2 style="display:inline">Availability</h2></summary>
        <div class="row spread" style="margin-top:10px"><div class="legend">${legend}</div><span class="small muted">Change a status with its dropdown. Hover it to see the spec they signed up as.</span></div>
        <div class="scroll-x" style="margin-top:8px"><table class="grid-av"><thead><tr><th>Player</th><th>Main spec</th>${days.map(([, d]) => `<th style="text-align:center">${esc(fmtDay(d.date))}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>
      </details>
    </section>`;
}

function renderPlan(w) {
  const days = dayList(w);
  if (!days.length) return '';
  const sug = S.suggestions && S.suggestions.wid === w.id ? S.suggestions.list : null;
  const pinned = S.settings.raids.filter(r => w.raids && w.raids[r.id] && w.raids[r.id].pinDay && w.days[w.raids[r.id].pinDay]);
  let cards = '';
  if (sug) {
    cards = sug.length ? `<div class="sugg">${sug.map((opt, k) => {
      const byDay = {};
      for (const def of S.settings.raids) if (opt.assign[def.id]) (byDay[opt.assign[def.id]] ||= []).push(def);
      const lines = Object.entries(byDay).sort((a, b) => w.days[a[0]].date.localeCompare(w.days[b[0]].date)).map(([did, defs]) => `
        <div class="dayline"><span class="eyebrow">${esc(fmtDay(w.days[did].date))}</span>${defs.map(def => {
          const ros = opt.rosters[def.id] || [];
          const cov = coverage(ros, S.settings);
          const okN = cov.filter(c => c.ok).length;
          const size = S.settings.types[def.type].size;
          const miss = cov.filter(c => !c.ok).map(c => c.rule.label);
          return `<div class="rline"><b>${esc(def.name)}</b><span class="pill ${ros.length === size ? '' : 'warn'} mono">${ros.length}/${size}</span><span class="pill ${okN === cov.length ? 'ok' : 'warn'}">${okN}/${cov.length} buffs</span></div>${miss.length ? `<div class="miss">Missing: ${esc(miss.join(', '))}</div>` : ''}`;
        }).join('')}</div>`).join('');
      return `<div class="opt ${k === 0 ? 'best' : ''}"><div class="row spread"><b>${k === 0 ? 'Recommended' : 'Alternative ' + k}</b><button class="${k === 0 ? 'primary' : ''} sm" data-act="use-plan" data-k="${k}">Use this plan</button></div>${lines}</div>`;
    }).join('')}</div>` : '<div class="empty">No plan fits the raids-per-day limit. Add a raid day or raise the limit in Settings.</div>';
  }
  const pinText = pinned.length ? ` Pinned: ${pinned.map(r => esc(r.name) + ' on ' + esc(fmtDay(w.days[w.raids[r.id].pinDay].date))).join(', ')}.` : '';
  return `
    <section class="panel">
      ${panelHead('Plan the week', 'Tries every way to put the raids on your raid days. Rosters follow roles first, then buff priority, then bench fairness.' + pinText,
        `${pinned.length ? '<button data-act="unpin-all">Unpin days</button>' : ''}<button class="primary" data-act="suggest">${ICON.spark} Suggest plan</button>`)}
      ${cards}
    </section>`;
}

function chipHtml(w, rid, pid, entry, opts) {
  const p = S.players[pid] || {};
  const raid = w.raids[rid];
  const c = entry ? entry.c : p.cls;
  const s = entry ? entry.s : p.main;
  const lock = raid && raid.locks ? raid.locks[pid] : null;
  const av = raid && raid.dayId ? availability(w, raid.dayId, S.players).get(pid) : null;
  const st = av ? av.st : null;
  const buffs = entry ? S.settings.buffs.filter(ru => ruleMatches(ru, entry.c, entry.s)).map(ru => ru.label) : [];
  const sel = S.sel && S.sel.rid === rid && S.sel.pid === pid;
  const tags = [];
  if (lock === 'in') tags.push(`<span title="Kept here by an officer">${ICON.lock}</span>`);
  const def = raidDef(rid);
  if (entry && entry.r === 'Tank' && def && isDesignatedTank(p, def.type)) tags.push('<span class="tag acc" title="Designated tank for this raid size">tank</span>');
  if (st === 'tentative' || st === 'late') tags.push(`<span class="tag warn">${st === 'late' ? 'late' : 'maybe'}</span>`);
  if (st === 'bench') tags.push('<span class="tag acc">bench</span>');
  const rw = relWarn(pid);
  if (rw) tags.push(rw);
  if (opts && opts.dayTag) tags.push(`<span class="tag" title="Only signed up for some of this lockout's raid days">${esc(opts.dayTag)}</span>`);
  const title = `${charOf(pid)}: ${s || ''} ${c || ''}${entry && entry.off ? ' (off-spec)' : ''}${buffs.length ? '\nBrings: ' + buffs.join(', ') : ''}${!st && entry ? '\nNot signed up for this day' : ''}${opts && opts.why ? '\n' + opts.why : ''}`;
  return `<div class="chip c-${esc(c)} ${entry && entry.off ? 'off' : ''} ${entry && !st ? 'unavail' : ''} ${sel ? 'sel' : ''}" draggable="true" tabindex="0" role="button" data-pid="${pid}" data-rid="${rid}" title="${esc(title)}">${classIcon(c, s)}<span class="nm">${esc(charOf(pid))}</span><span class="sp">${esc(shortSpec(s || ''))}</span><span class="ic">${tags.join('')}</span></div>`;
}

// Raids of one size share players and a bench, so two or more of them render as one lockout card.
function renderRaids(w) {
  const seen = new Set();
  return S.settings.raids.map(def => {
    if (seen.has(def.type)) return '';
    seen.add(def.type);
    const defs = S.settings.raids.filter(r => r.type === def.type);
    return defs.length > 1 ? renderLockout(w, defs) : renderRaid(w, def);
  }).join('');
}

function renderLockout(w, defs) {
  const typeCfg = S.settings.types[defs[0].type] || { size: 10 };
  const planned = defs.filter(d => w.raids && w.raids[d.id] && w.raids[d.id].dayId && w.days[w.raids[d.id].dayId] && (w.raids[d.id].roster || []).length);
  const anchor = planned.length ? planned[planned.length - 1] : null;
  const total = planned.reduce((n, d) => n + w.raids[d.id].roster.length, 0);
  let bench = '';
  if (anchor) {
    const sb = sharedBench(w, S.settings, anchor.id);
    const sbl = sharedBenchList(w, S.settings, S.players, S.weeks, sb);
    const chips = sbl.list.map(e => {
      const rid = e.rids[0];
      const whyMap = Object.fromEntries(((w.raids[rid] || {}).explain || []).map(([p, t]) => [p, t]));
      return chipHtml(w, rid, e.p, null, { why: whyMap[e.p], dayTag: benchDayTag(w, sb, e, sbl.days) });
    }).join('');
    bench = `<div class="zone bench" data-rid="${anchor.id}" data-zone="bench"><div class="zt"><span>Bench for the lockout</span><span class="mono">${sbl.list.length}</span></div>${chips || '<span class="small muted" style="padding:0 4px 4px">Nobody on the bench.</span>'}</div>`;
  }
  return `
    <section class="raid lockout">
      <div class="head">
        <h3>${esc(typeCfg.size)}-man lockout</h3>
        <span class="small muted">${esc(defs.map(d => d.name).join(' and '))} share players and one bench. Each can be on its own day.</span>
        ${planned.length ? `<span class="pill mono">${total}/${typeCfg.size * planned.length}</span>` : ''}
        <div class="acts"><button class="sm" data-act="reopt" data-rid="${defs[0].id}" title="Re-pick both rosters on their current days, keeping players an officer placed">Re-optimize</button></div>
      </div>
      <div class="body">
        <div class="subraids">${defs.map(d => renderRaid(w, d, true)).join('')}</div>
        ${bench}
        ${anchor ? renderDecide(w, anchor) : ''}
      </div>
    </section>`;
}

function renderRaid(w, def, sub) {
  const raid = w.raids && w.raids[def.id];
  const typeCfg = S.settings.types[def.type] || { size: 10 };
  const days = dayList(w);
  const daySel = `<select data-act="raid-day" data-rid="${def.id}" id="day-${def.id}" aria-label="Raid day"><option value="">Not scheduled</option>${days.map(([did, d]) => `<option value="${did}" ${raid && raid.dayId === did ? 'selected' : ''}>${esc(fmtDay(d.date))}</option>`).join('')}</select>`;
  const tag = sub ? 'div' : 'section', cls = sub ? 'subraid' : 'raid';
  if (!raid || !raid.dayId || !w.days[raid.dayId]) {
    if (sub) return `<div class="subraid" id="raid-${def.id}"><div class="head"><h3>${esc(def.name)}</h3>${daySel}</div><div class="sr-empty"><div class="empty">Not planned yet. Use Suggest plan, or pick a day to fill it.</div></div></div>`;
    return `<${tag} class="${cls}" id="raid-${def.id}"><div class="head"><h3>${esc(def.name)}</h3>${daySel}</div><div class="body"><div class="empty">Not planned yet. Use Suggest plan, or pick a day to fill it.</div></div></${tag}>`;
  }
  const roster = raid.roster || [];
  const byP = Object.fromEntries(roster.map(e => [e.p, e]));
  const cov = coverage(roster, S.settings);
  const rc = roleCounts(roster);
  const okN = cov.filter(c => c.ok).length;
  const nG = Math.ceil(typeCfg.size / 5);
  const groups = (raid.groups || []).slice(0, nG);
  while (groups.length < nG) groups.push([]);
  const bench = benchFor(w, def.id, S.settings, S.players);
  const why = Object.fromEntries((raid.explain || []).map(([p, t]) => [p, t]));
  const roleOk = rc.Tank === typeCfg.tanks && rc.Healer >= typeCfg.healMin && rc.Healer <= typeCfg.healMax;
  return `
    <${tag} class="${cls}" id="raid-${def.id}">
      <div class="head">
        <h3>${esc(def.name)}</h3>${daySel}
        ${raid.pinDay ? `<span class="pill acc" title="You picked this day yourself, so Suggest plan keeps the raid on it and only moves unpinned raids. Use Unpin days under Plan the week to release it.">${ICON.pin} Pinned</span>` : ''}
        <span class="pill ${roster.length === typeCfg.size ? '' : 'warn'} mono">${roster.length}/${typeCfg.size}</span>
        <span class="pill ${roleOk ? '' : 'bad'}" title="${roleOk ? 'Role count of this roster' : `Needs ${typeCfg.tanks} tanks and ${typeCfg.healMin}–${typeCfg.healMax} healers`}">${rc.Tank} tanks · ${rc.Healer} healers · ${rc.Melee} melee · ${rc.Ranged} ranged</span>
        <span class="pill ${okN === cov.length ? 'ok' : 'warn'}">${okN}/${cov.length} buffs</span>
        ${raid.updatedAt ? `<span class="small muted" title="${esc(new Date(raid.updatedAt).toLocaleString('en-GB'))}">Edited by ${esc(nameOf(raid.updatedBy))} · ${esc(new Date(raid.updatedAt).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }))}</span>` : ''}
        <div class="acts">${(() => {
          const lk = Object.values(raid.locks || {}).filter(Boolean);
          if (!lk.length) return '';
          const nIn = lk.filter(v => v === 'in').length, nOut = lk.length - nIn;
          const what = [nIn ? `${nIn} kept in` : '', nOut ? `${nOut} kept out` : ''].filter(Boolean).join(', ');
          return `<button class="sm ghost" data-act="clear-locks" data-rid="${def.id}" title="Officer picks: ${what}. Re-optimize and Suggest plan always follow them. Clear them to let the optimizer choose freely again.">${S.confirm === 'locks-' + def.id ? 'Confirm: clear picks' : `Clear picks (${what})`}</button>`;
        })()}<button class="sm" data-act="regroup" data-rid="${def.id}">Re-sort groups</button>${sub ? '' : `<button class="sm" data-act="reopt" data-rid="${def.id}" title="Re-pick the roster on its current day, keeping players an officer placed">Re-optimize</button>`}</div>
      </div>
      ${sub ? '' : '<div class="body">'}
        ${sub ? '<div class="sr-notes">' : ''}<input id="note-${def.id}" class="rnote" data-act="note" data-k="${def.id}" value="${esc((w.notes || {})[def.id] || '')}" placeholder="Note for ${esc(def.name)} (officers only)" aria-label="Note for ${esc(def.name)}">${renderChanges(w, def)}
        ${(() => {
          const av = availability(w, raid.dayId, S.players);
          const lines = cov.filter(c => !c.ok).map(c => {
            const who2 = bench.filter(p => (av.get(p) || { opts: [] }).opts.some(o => ruleMatches(c.rule, o.c, o.s)));
            if (!who2.length) return '';
            const kept = who2.filter(p => (raid.locks || {})[p] === 'out').length;
            return `<div class="small" style="color:var(--warn)">${esc(c.rule.label)} is missing, but ${esc(who2.map(charOf).join(', '))} on the bench can bring it${kept ? ` (kept out by an officer${kept < who2.length ? ', some of them' : ''}: use Clear picks or move them in)` : ': press Re-optimize'}.</div>`;
          }).filter(Boolean);
          return lines.join('');
        })()}${sub ? '</div><div class="sr-buffs">' : ''}
        <div class="buffs">${cov.map(c => `<span class="buff ${c.ok ? 'ok' : 'miss'}" title="${esc(c.prov.map(charOf).join(', ') || 'Nobody')}">${c.ok ? ICON.check : ICON.x}${esc(c.rule.label)}${c.rule.min > 1 ? ` <span class="n">${c.prov.length}/${c.rule.min}</span>` : ''}</span>`).join('')}</div>
        ${sub ? '</div>' : ''}<div class="groups" style="--cols:${nG}">
          ${groups.map((g, i) => `<div class="zone" data-rid="${def.id}" data-zone="g${i}"><div class="zt"><span>Group ${i + 1}</span><span class="mono">${g.length}/5</span></div>${g.map(pid => chipHtml(w, def.id, pid, byP[pid])).join('')}${'<div class="slot"></div>'.repeat(Math.max(0, 5 - g.length))}</div>`).join('')}
        </div>
        ${sub ? '<div class="sr-foot">' : ''}${roster.some(e => e.off) ? '<div class="small muted">Specs in <span style="color:var(--warn)">amber</span> are off-specs: the player is in this raid on their second spec.</div>' : ''}${sub ? '</div>' : ''}
        ${sub ? '' : (() => {
          const sb = sharedBench(w, S.settings, def.id);
          if (!sb.show) {
            const last = raidDef(sb.with[sb.with.length - 1]);
            return `<div class="zone bench" data-rid="${def.id}" data-zone="bench"><div class="zt"><span>Bench · shared with ${esc(last.name)}</span></div><span class="small muted" style="padding:0 4px 4px">Same lockout, so the raids share one bench. It is shown under ${esc(last.name)}. Drop a player here to bench them.</span></div>`;
          }
          const sbl = sharedBenchList(w, S.settings, S.players, S.weeks, sb);
          const chips = sbl.list.map(e => {
            const rid = e.rids.includes(def.id) ? def.id : e.rids[0];
            const whyMap = Object.fromEntries(((w.raids[rid] || {}).explain || []).map(([p, t]) => [p, t]));
            return chipHtml(w, rid, e.p, null, { why: whyMap[e.p], dayTag: benchDayTag(w, sb, e, sbl.days) });
          }).join('');
          return `<div class="zone bench" data-rid="${def.id}" data-zone="bench"><div class="zt"><span>${esc(benchLabel(S.settings, sb))}</span><span class="mono">${sbl.list.length}</span></div>${chips || '<span class="small muted" style="padding:0 4px 4px">Nobody on the bench.</span>'}</div>`;
        })()}
        ${sub ? '' : renderDecide(w, def)}
      ${sub ? '' : '</div>'}
    </${tag}>`;
}

function renderExports(w) {
  const any = S.settings.raids.some(d => w.raids && w.raids[d.id] && (w.raids[d.id].roster || []).length);
  if (!any) return '';
  const mentions = load('mentions') !== '0';
  const discord = exportDiscord(w, S.settings, S.players, { mentions, weeks: S.weeks });
  const addon = exportAddon(w, S.settings, S.players, S.weeks);
  const planned = S.settings.raids.filter(d => w.raids && w.raids[d.id] && w.raids[d.id].dayId && w.days[w.raids[d.id].dayId]);
  if (IMG.sig !== imageSig(w) && IMG.failed !== imageSig(w)) buildImage(w);
  return `
    <section class="panel">
      ${panelHead('Share the roster', 'Post the image or text on Discord, and paste the addon string in game with /nproster.',
        `${postedPill(w)}${w.status === 'final' ? '<button data-act="unfinal">Back to draft</button>' : '<button class="primary" data-act="final" title="Final weeks count toward bench fairness">Mark week as final</button>'}`)}
      <div class="stack">
        <div class="row spread"><b>Roster image</b><div class="row"><button class="sm" data-act="img-copy" ${IMG.blob ? '' : 'disabled'}>Copy image</button><button class="sm" data-act="img-save" ${IMG.blob ? '' : 'disabled'}>Save image</button></div></div>
        ${IMG.url && IMG.sig === imageSig(w) ? `<img class="rosterimg" src="${IMG.url}" alt="Roster image with every raid's groups and bench">` : `<div class="empty">${IMG.failed === imageSig(w) ? 'The image could not be drawn. Use the Discord text below.' : 'Drawing the roster image…'}</div>`}
      </div>
      <div class="two">
        <div class="stack"><div class="row spread"><b>Discord text</b><div class="row"><label class="row small muted" style="gap:5px"><input type="checkbox" id="opt-mentions" data-act="mentions" ${mentions ? 'checked' : ''}>@mention players</label><button class="sm" data-act="copy" data-target="out-discord">Copy</button></div></div><textarea id="out-discord" readonly style="min-height:200px">${esc(discord)}</textarea></div>
        <div class="stack"><div class="row spread"><b>Addon string</b><button class="sm" data-act="copy" data-target="out-addon">Copy</button></div><textarea id="out-addon" readonly style="min-height:200px">${esc(addon)}</textarea></div>
      </div>
      <div class="row spread">
        <div class="row"><span class="small muted">No addon tonight? Record attendance from the plan:</span>${planned.map(d => `<button class="sm" data-act="att-from-plan" data-rid="${d.id}">${w.attendance && w.attendance[d.id] ? ICON.check + ' ' : ''}${esc(d.name)}</button>`).join('')}</div>
        <button class="ghost danger sm" data-act="del-week">${S.confirm === 'del-week' ? 'Confirm: delete this week' : 'Delete week'}</button>
      </div>
      ${(() => { const n = histEntries().filter(e => (e.wids || []).includes(w.id)).length + (w.log || []).length; return n ? `<div class="small muted">${n} change${n === 1 ? '' : 's'} this week. See them, undo them or restore an earlier state on the <a href="#log" data-v="log">Log</a> tab.</div>` : ''; })()}
    </section>`;
}

// ---------- Posted flag ----------
// Copying the image, text or addon string counts as posting. Later roster changes show as "changed since posted".
const postSig = w => exportAddon(w, S.settings, S.players);
function postedPill(w) {
  if (!w.posted) return '<span class="pill">Not posted yet</span>';
  const when = new Date(w.posted.at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return w.posted.sig === postSig(w)
    ? `<span class="pill ok" title="Posted by ${esc(nameOf(w.posted.by))}">Posted ${esc(when)}</span>`
    : `<span class="pill warn" title="Copy the image or text again and repost it">Changed since posted ${esc(when)}</span>`;
}
function markPosted() {
  const w = week();
  if (!w || !S.canWrite) return;
  const sig = postSig(w);
  if (w.posted && w.posted.sig === sig) return;
  saveWeek(w.id, { posted: { at: Date.now(), by: S.me, sig } }, 'Posted the roster');
}

// ---------- History ----------
// Every saved change becomes one history entry in two documents: `history/<id>` holds what the Log
// lists (when, who, what, and for each part that changed a fingerprint of its new value), and
// `historyData/<id>` (split into `<id>~1`, `<id>~2`… when large) holds the old values, read only when
// someone undoes or restores. A part is named by a path:
//   w/<week>                 a whole week (created or deleted)
//   w/<week>/<field>         the week's status, posted flag…
//   w/<week>/<field>/<key>   one raid, one day, one day's signups, one raid's attendance
//   p/<player>               a player
//   s                        the settings
const HIST_DAYS = 120, HIST_MAX = 1000, PART_BYTES = 200000;
const WEEK_PARTS = new Set(['raids', 'signups', 'days', 'attendance', 'drops', 'notes']);
let txn = null;

function nameOf(id) {
  if (!id) return 'someone';
  if (id === S.me) return 'you';
  if (S.names[id]) return S.names[id];
  resolveNames([id]);
  return 'an officer';
}
async function resolveNames(ids) {
  if (!S.userApi || !S.userApi.profiles) return;
  const need = ids.filter(id => id && !S.names[id] && !S.namesPending.has(id));
  if (!need.length) return;
  need.forEach(id => S.namesPending.add(id));
  try {
    const ps = await S.userApi.profiles(need);
    let found = false;
    for (const id of need) { const n = ps[id] && ps[id].name; if (n) { S.names[id] = n; found = true; } }
    if (found) schedule();
  } catch (e) { /* names stay generic */ }
}

// JSON with sorted keys and without empty fields, so a value compares equal however the database
// orders keys or stores a cleared field.
function stable(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== null && v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function fingerprint(v) {
  const s = stable(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + '.' + s.length.toString(36);
}
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const rootOf = p => { const s = p.split('/'); return s[0] === 's' ? 's' : s[0] + '/' + s[1]; };
const overlaps = (p, q) => p === q || p.startsWith(q + '/') || q.startsWith(p + '/');

function pathLabel(p, v) {
  const s = p.split('/');
  if (s[0] === 's') return 'Settings';
  if (s[0] === 'p') return (v && (v.char || (v.name && guessChar(v.name)))) || charOf(s[1]);
  if (s.length === 2) return 'Whole week';
  const k = s[3] || '';
  const day = /^d\d{4}-\d\d-\d\d$/.test(k) ? fmtDay(k.slice(1)) : k;
  const raid = (raidDef(k) || {}).name || k;
  return { raids: raid, signups: `Signups ${day}`, days: `Day ${day}`, attendance: `Attendance ${raid}`, drops: `Drops ${day}`, notes: k === 'week' ? 'Week note' : `Note ${raid}`, status: 'Week status', posted: 'Posted flag' }[s[2]] || s[2];
}

// The parts of a week a patch touches, with their values before and after it.
function weekChanges(wid, old, next, patch) {
  if (!old || !next) return [{ p: 'w/' + wid, b: old, a: next }];
  const out = [];
  for (const k of Object.keys(patch)) {
    if (k === 'id' || k === 'log') continue;
    if (WEEK_PARTS.has(k) && isObj(patch[k])) for (const sub of Object.keys(patch[k])) out.push({ p: `w/${wid}/${k}/${sub}`, b: (old[k] || {})[sub], a: (next[k] || {})[sub] });
    else out.push({ p: `w/${wid}/${k}`, b: old[k], a: next[k] });
  }
  return out;
}

// Saves made inside `fn` become one entry, so one action is one line in the Log and one undo.
// Returns the entry's id, or null when nothing changed.
function logged(text, fn, extra) {
  if (txn) { fn(); return null; }
  txn = { text, changes: [], extra };
  let id = null;
  try { fn(); } finally { const t = txn; txn = null; id = writeEntry(t.text, t.changes, t.extra); }
  return id;
}
function record(changes, text) {
  const real = changes.map(c => ({ p: c.p, b: clone(c.b), a: clone(c.a) })).filter(c => stable(c.b) !== stable(c.a));
  if (!real.length) return;
  if (!txn) { writeEntry(text, real); return; }
  for (const c of real) {
    const prev = txn.changes.find(x => x.p === c.p);
    if (prev) prev.a = c.a; else txn.changes.push(c);
  }
  txn.text ||= text;
}
function writeEntry(text, changes, extra) {
  changes = changes.filter(c => stable(c.b) !== stable(c.a));
  if (!changes.length) return null;
  // Never before the newest entry already seen, so entries keep their order even if clocks differ.
  const at = Math.max(Date.now(), S.historyLast + 1);
  const id = at.toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const parts = [];
  let part = [], size = 0;
  for (const c of changes) {
    const n = JSON.stringify(c.b).length + c.p.length + 16;
    if (part.length && size + n > PART_BYTES) { parts.push(part); part = []; size = 0; }
    part.push({ p: c.p, b: c.b }); size += n;
  }
  parts.push(part);
  const meta = {
    at, by: S.me, text: text || 'Changed something', parts: parts.length,
    wids: [...new Set(changes.filter(c => c.p.startsWith('w/')).map(c => c.p.split('/')[1]))],
    ch: changes.map(c => ({ p: c.p, h: fingerprint(c.a), l: pathLabel(c.p, c.a || c.b), ...(c.b == null ? { n: 1 } : {}) })),
    ...(extra || {}),
  };
  S.histLocal[id] = meta;
  S.histData[id] = clone(parts.flat());
  S.historyLast = at;
  schedule();
  if (S.db) {
    parts.forEach((ch, i) => enqueue(() => S.db.doc('historyData/' + id + (i ? '~' + i : '')).set({ ch })));
    enqueue(() => S.db.doc('history/' + id).set(meta));
  }
  return id;
}

// Newest first; own entries show at once, before the database confirms them.
function histEntries() {
  const all = { ...S.histLocal, ...S.history };
  return Object.entries(all).map(([id, e]) => ({ ...e, id })).sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
}
// Which entries were undone, and which were rolled back by a restore (unless that was undone again).
function histState(list) {
  const byId = Object.fromEntries(list.map(e => [e.id, e]));
  const undone = {}, rolled = {};
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e.undoOf) {
      undone[e.undoOf] = e;
      const t = byId[e.undoOf];
      if (t && t.undoOf) delete undone[t.undoOf];
      if (t && t.rolled) for (const r of t.rolled) if (rolled[r] === t) delete rolled[r];
    }
    if (e.rolled) for (const r of e.rolled) rolled[r] = e;
  }
  return { byId, undone, rolled };
}

function valueAt(p) {
  const s = p.split('/');
  if (s[0] === 's') return S.settingsRaw;
  if (s[0] === 'p') return S.players[s[1]] ?? null;
  let v = S.weeks[s[1]] ?? null;
  for (const k of s.slice(2)) v = isObj(v) ? v[k] ?? null : null;
  return v;
}
// Parts this entry changed that look different now. Players an import added are never removed
// again, so they don't count.
const conflicts = e => (e.ch || []).filter(c => !(c.n && c.p.startsWith('p/')) && fingerprint(valueAt(c.p)) !== c.h);
const laterChange = (e, p, list) => list.filter(x => x.at > e.at && (x.ch || []).some(c => overlaps(c.p, p))).pop();

async function loadData(e) {
  if (S.histData[e.id]) return S.histData[e.id];
  if (!S.db) return null;
  const out = [];
  for (let i = 0; i < (e.parts || 1); i++) {
    const d = await S.db.doc('historyData/' + e.id + (i ? '~' + i : '')).get();
    if (!d.exists) return null;
    out.push(...clone(d.data()).ch);
  }
  S.histData[e.id] = out;
  return out;
}

// Copies of the documents the entries touched, wound back one change at a time, newest first.
function rollBack(entries, data, roots) {
  const docs = {};
  const doc = root => { if (!(root in docs)) docs[root] = clone(valueAt(root)); return docs[root]; };
  for (const e of entries) {
    const ch = data[e.id];
    for (let i = ch.length - 1; i >= 0; i--) {
      const { p, b } = ch[i];
      const s = p.split('/'), root = rootOf(p);
      if (roots && !roots.includes(root)) continue;
      if (s[0] === 'p' && b == null) continue;
      if (s[0] !== 'w' || s.length === 2) { doc(root); docs[root] = clone(b); continue; }
      let o = doc(root) || (docs[root] = { id: s[1] });
      for (const k of s.slice(2, -1)) { if (!isObj(o[k])) o[k] = {}; o = o[k]; }
      o[s[s.length - 1]] = clone(b);
    }
  }
  return docs;
}
// The smallest patch that turns `cur` into `next` under the database's merge rules.
function diffPatch(cur, next) {
  const out = {};
  for (const k of new Set([...Object.keys(cur || {}), ...Object.keys(next || {})])) {
    const a = cur ? cur[k] : undefined, b = next ? next[k] : undefined;
    if (stable(a) === stable(b)) continue;
    out[k] = isObj(a) && isObj(b) ? diffPatch(a, b) : (b === undefined ? null : clone(b));
  }
  return out;
}
function writeDocs(docs) {
  for (const [root, val] of Object.entries(docs)) {
    const [k, id] = root.split('/');
    if (k === 's') { if (stable(val) !== stable(S.settingsRaw)) saveSettings(val ? clone(val) : clone(DEFAULT_SETTINGS)); continue; }
    if (k === 'p') { if (val) { if (stable(val) !== stable(S.players[id])) savePlayer(id, clone(val)); } else if (S.players[id]) deletePlayer(id); continue; }
    const cur = S.weeks[id];
    if (!val) { if (cur) deleteWeek(id); }
    else if (!cur) saveWeek(id, clone(val));
    else { const patch = diffPatch(cur, val); if (Object.keys(patch).length) saveWeek(id, patch); }
  }
}

const undoText = e => e.undoOf && /^Undid: /.test(e.text) ? 'Redid: ' + e.text.slice(7) : 'Undid: ' + e.text;
async function undoEntry(id) {
  const list = histEntries();
  const e = list.find(x => x.id === id);
  if (!e || S.busy) return;
  const why = () => {
    const bad = conflicts(e);
    if (!bad.length) return null;
    const later = laterChange(e, bad[0].p, list);
    return `Can't undo "${e.text}": ${bad[0].l || pathLabel(bad[0].p)} was changed since${later ? ` by ${nameOf(later.by)} ("${later.text}")` : ''}. Restore to before it instead to roll back the later changes too.`;
  };
  if (why()) { toast(why()); return; }
  S.busy = true; schedule();
  try {
    const data = await loadData(e);
    if (!data) { toast('The details of this change are missing, so it cannot be undone.'); return; }
    if (why()) { toast(why()); return; }
    logged(undoText(e), () => writeDocs(rollBack([e], { [e.id]: data })), { undoOf: e.id });
    toast((undoText(e).startsWith('Redid') ? 'Redone: ' : 'Undone: ') + e.text.replace(/^Undid: /, ''));
  } catch (err) { toast('Could not undo: ' + ((err && err.message) || err)); }
  finally { S.busy = false; schedule(); }
}

// What "Restore to before this" covers: the weeks the change touched, or else the players or settings.
function restoreScope(e, list) {
  const roots = [...new Set((e.ch || []).map(c => rootOf(c.p)))];
  const weeks = roots.filter(r => r.startsWith('w/'));
  const scope = weeks.length ? weeks : roots;
  const i = list.findIndex(x => x.id === e.id);
  const entries = list.slice(0, i + 1).filter(x => (x.ch || []).some(c => scope.includes(rootOf(c.p))));
  const label = scope.map(r => r === 's' ? 'the settings' : r.startsWith('w/') ? weekName(r.slice(2)) : pathLabel(r)).join(', ');
  return { scope, entries, label };
}
async function restoreBefore(id) {
  const list = histEntries();
  const e = list.find(x => x.id === id);
  if (!e || S.busy) return;
  const { scope, entries, label } = restoreScope(e, list);
  S.busy = true; schedule();
  try {
    const data = {};
    for (const x of entries) {
      data[x.id] = await loadData(x);
      if (!data[x.id]) { toast(`The details of "${x.text}" are missing, so ${label} can't be restored to before this.`); return; }
    }
    const n = entries.length;
    const made = logged(`Restored ${label} to before "${e.text}" (${n} change${n === 1 ? '' : 's'} rolled back)`,
      () => writeDocs(rollBack(entries, data, scope)), { restoreOf: e.id, rolled: entries.map(x => x.id) });
    toast(made ? `Restored ${label}. Undo it from the Log if needed.` : 'Nothing to restore: it already looks like that.');
  } catch (err) { toast('Could not restore: ' + ((err && err.message) || err)); }
  finally { S.busy = false; schedule(); }
}

// Ctrl+Z and the Undo button: your newest change to this week that is still in place.
function undoTarget(w) {
  if (!w) return null;
  const list = histEntries();
  const st = histState(list);
  return list.find(x => x.by === S.me && !x.undoOf && !st.undone[x.id] && !st.rolled[x.id] && (x.wids || []).includes(w.id)) || null;
}
function undo() {
  const e = undoTarget(week());
  if (!e) { toast('Nothing to undo.'); return; }
  undoEntry(e.id);
}

// Entries older than HIST_DAYS, or beyond the newest HIST_MAX, are deleted by the first officer
// who opens the page.
async function pruneHistory() {
  if (!S.db || !S.canWrite) return;
  try {
    const col = S.db.collection('history');
    // Older than HIST_DAYS, or older than the oldest of the newest HIST_MAX: whichever cuts more.
    const cutoff = Math.max(Date.now() - HIST_DAYS * 864e5, Object.keys(S.history).length >= HIST_MAX ? Math.min(...Object.values(S.history).map(e => e.at)) : 0);
    const old = await col.where('at', '<', cutoff).limit(300).get();
    for (const d of old.docs) {
      const parts = (d.data() || {}).parts || 1;
      for (let i = 0; i < parts; i++) enqueue(() => S.db.doc('historyData/' + d.id + (i ? '~' + i : '')).delete());
      enqueue(() => S.db.doc('history/' + d.id).delete());
    }
  } catch (e) { /* tried again on the next visit */ }
}

// The Log: history entries plus the short logs weeks kept before history existed.
function renderLogView() {
  if (S.loaded < 3 || (S.db && !S.histReady)) return loadingHtml();
  const list = histEntries();
  const st = histState(list);
  const legacy = [];
  for (const w of sortedWeeks()) for (const e of w.log || []) legacy.push({ ...e, id: 'old-' + w.id + '-' + e.at, wids: [w.id], legacy: true });
  const all = [...list, ...legacy].sort((a, b) => b.at - a.at);
  const fw = S.drafts['log-week'] || '', fo = S.drafts['log-who'] || '';
  const officers = [...new Set(all.map(e => e.by).filter(Boolean))];
  const match = e => (!fw || (fw === '_other' ? !(e.wids || []).length : (e.wids || []).includes(fw))) && (!fo || e.by === fo);
  const filtered = all.filter(match);
  const shown = filtered.slice(0, S.logLimit);
  const weeksWithLog = sortedWeeks().filter(w => all.some(e => (e.wids || []).includes(w.id)));
  // While "Restore to before" waits for its second click, mark the changes it would roll back.
  const armed = S.confirm && S.confirm.startsWith('rs-') ? list.find(x => x.id === S.confirm.slice(3)) : null;
  const armedSet = armed ? new Set(restoreScope(armed, list).entries.map(x => x.id)) : null;
  const when = at => new Date(at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const rows = shown.map(e => {
    const undone = st.undone[e.id], rolled = st.rolled[e.id];
    const labels = [...new Set((e.ch || []).map(c => c.l || pathLabel(c.p)))];
    const areas = labels.length ? `<div class="areas">${labels.slice(0, 5).map(l => `<span>${esc(l)}</span>`).join('')}${labels.length > 5 ? `<span>+${labels.length - 5} more</span>` : ''}</div>` : '';
    const status = undone ? `<span class="pill" title="${esc(when(undone.at))}">Undone by ${esc(nameOf(undone.by))}</span>`
      : rolled ? `<span class="pill" title="${esc(rolled.text)}">Rolled back by ${esc(nameOf(rolled.by))}</span>` : '';
    let actions = '';
    if (e.legacy) actions = '<span class="small muted" title="Logged before the history was kept">Log only</span>';
    else if (S.canWrite) {
      const n = armedSet && armed.id === e.id ? armedSet.size : 0;
      actions = `${!undone && !rolled ? `<button class="sm" data-act="h-undo" data-id="${e.id}" ${S.busy ? 'disabled' : ''} title="Undo just this change">${ICON.undo} Undo</button>` : ''}
        <button class="sm ghost" data-act="h-restore" data-id="${e.id}" ${S.busy ? 'disabled' : ''} title="Put this back the way it was just before this change, rolling back everything after it too">${n ? `Roll back ${n} change${n === 1 ? '' : 's'}?` : 'Restore to before'}</button>`;
    }
    return `<tr class="${undone || rolled ? 'gone' : ''} ${armedSet && armedSet.has(e.id) ? 'hl' : ''}">
      <td class="mono small">${esc(when(e.at))}</td>
      <td class="small">${(e.wids || []).length ? e.wids.map(id => esc(weekName(id))).join(', ') : '<span class="muted">Players, settings</span>'}</td>
      <td>${esc(nameOf(e.by))}</td>
      <td class="change"><div class="ctext">${esc(e.text)} ${status}</div>${areas}</td>
      <td class="acts">${actions}</td>
    </tr>`;
  }).join('');
  return `
    <section class="panel">
      ${panelHead('Change log', `Every change officers make, newest first. <b>Undo</b> takes back one change; <b>Restore to before</b> puts the week back the way it was just before a change, rolling back everything after it too. Both are logged, so they can be undone as well. History is kept for ${HIST_DAYS} days.`,
        `<select id="log-week" data-act="log-filter" data-k="log-week" aria-label="Week"><option value="">All weeks</option>${weeksWithLog.map(w => `<option value="${w.id}" ${fw === w.id ? 'selected' : ''}>${esc(weekName(w.id))} · ${esc(weekSpan(w.id))}</option>`).join('')}<option value="_other" ${fw === '_other' ? 'selected' : ''}>Players and settings</option></select>
         <select id="log-who" data-act="log-filter" data-k="log-who" aria-label="Officer"><option value="">All officers</option>${officers.map(id => `<option value="${esc(id)}" ${fo === id ? 'selected' : ''}>${esc(nameOf(id))}</option>`).join('')}</select>`)}
      ${shown.length ? `<div class="scroll-x"><table class="logtable"><thead><tr><th>When</th><th>Week</th><th>Who</th><th>Change</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<div class="empty">No changes logged yet. Everything officers change shows up here.</div>'}
      ${filtered.length > shown.length ? `<div class="row"><button class="sm" data-act="log-more">Show older changes</button><span class="small muted">${filtered.length - shown.length} more</span></div>` : ''}
    </section>`;
}

// ---------- Signup changes ----------
// Each raid remembers the signups it was planned from; later imports are compared against that.
// Stored as [pid, status] pairs because the database merges objects but replaces lists.
function signupSnapshot(w, dayId) {
  return [...availability(w, dayId, S.players)].map(([pid, info]) => [pid, info.st]);
}
function signupChanges(w, rid) {
  const raid = w.raids[rid];
  if (!raid || !Array.isArray(raid.seen) || !raid.dayId) return null;
  const seen = Object.fromEntries(raid.seen);
  const live = Object.fromEntries(signupSnapshot(w, raid.dayId));
  const roster = new Set((raid.roster || []).map(e => e.p));
  const elsewhere = new Set();
  for (const other of sameTypeRaids(S.settings, rid)) ((w.raids[other] || {}).roster || []).forEach(e => elsewhere.add(e.p));
  const withdrew = [], changed = [], added = [];
  for (const pid of roster) {
    const was = seen[pid], now = live[pid];
    if (!now || now === 'absence') { if (was && was !== 'absence') withdrew.push(pid); }
    else if (was && was !== now) changed.push([pid, now]);
  }
  for (const [pid, st] of Object.entries(live)) if (AVAILABLE.has(st) && !seen[pid] && !roster.has(pid) && !elsewhere.has(pid)) added.push(pid);
  if (!withdrew.length && !changed.length && !added.length) return null;
  return { withdrew, changed, added };
}
function renderChanges(w, def) {
  const ch = signupChanges(w, def.id);
  if (!ch) return '';
  const names = list => list.map(p => esc(charOf(p))).join(', ');
  const parts = [];
  if (ch.withdrew.length) parts.push(`<b>${names(ch.withdrew)}</b> withdrew but ${ch.withdrew.length > 1 ? 'are' : 'is'} on the roster`);
  if (ch.changed.length) parts.push(ch.changed.map(([p, st]) => `<b>${esc(charOf(p))}</b> is now ${esc(STATUS_LABEL[st].toLowerCase())}`).join(', '));
  if (ch.added.length) parts.push(`<b>${names(ch.added)}</b> signed up since (on the bench)`);
  return `<div class="banner row spread"><span>Signups changed since this roster was made: ${parts.join('; ')}.</span><span class="row"><button class="sm" data-act="reopt" data-rid="${def.id}">Re-optimize</button><button class="sm ghost" data-act="seen-ack" data-rid="${def.id}">Dismiss</button></span></div>`;
}

// ---------- Roster image ----------
// Drawn for Discord's dark theme, so it keeps one fixed palette.
const IMG = { sig: null, url: null, blob: null, busy: false, wid: null };
const CLASS_COLOR = { Warrior: '#C69B6D', Paladin: '#F48CBA', Hunter: '#AAD372', Rogue: '#FFF468', Priest: '#FFFFFF', Shaman: '#0070DD', Mage: '#3FC7EB', Warlock: '#8788EE', Druid: '#FF7C0A' };
const PAL = { bg: '#101317', card: '#192029', line: '#28313c', fg: '#ecf1f6', muted: '#8b97a6', faint: '#5a6573', accent: '#6cc3ff', ok: '#5fd08a', warn: '#f0b44c' };
const imageSig = w => w.id + '|' + exportDiscord(w, S.settings, S.players, { weeks: S.weeks });

function plannedRaids(w) {
  return S.settings.raids.filter(d => w.raids && w.raids[d.id] && w.raids[d.id].dayId && w.days[w.raids[d.id].dayId] && (w.raids[d.id].roster || []).length)
    .sort((a, b) => w.days[w.raids[a.id].dayId].date.localeCompare(w.days[w.raids[b.id].dayId].date));
}

function drawRoster(w) {
  const SCALE = 2, W = 1080, PAD = 36, GAP = 12, COLS = 4;
  const colW = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
  const ROW = 26, GROUP_H = 34 + ROW * 5 + 10;
  const font = (wgt, px) => `${wgt} ${px}px Geist, "Segoe UI", system-ui, sans-serif`;
  const canvas = document.createElement('canvas');
  const c = canvas.getContext('2d');
  const defs = plannedRaids(w);
  const benchItems = def => {
    const sb = sharedBench(w, S.settings, def.id);
    if (!sb.show) return [];
    const sbl = sharedBenchList(w, S.settings, S.players, S.weeks, sb);
    return sbl.list.map(e => {
      const av = availability(w, w.raids[e.rids[0]].dayId, S.players).get(e.p);
      const o = av && av.opts[0];
      const d = benchDayTag(w, sb, e, sbl.days);
      return { name: charOf(e.p), cls: o ? o.c : (S.players[e.p] || {}).cls, spec: (o ? shortSpec(o.s) : '') + (d ? ` · ${d}` : ''), specFull: o ? o.s : '' };
    });
  };
  const itemW = it => {
    c.font = font(600, 14); const nw = c.measureText(it.name).width;
    c.font = font(400, 12); const sw = c.measureText(it.spec).width;
    return { nw, iw: 22 + nw + 6 + sw + 22 };
  };
  // Bench lines wrap, so measure them before sizing the canvas.
  const benchLines = def => {
    let x = 0, lines = 1;
    for (const it of benchItems(def)) {
      const { iw } = itemW(it);
      if (x + iw > W - PAD * 2 && x > 0) { lines++; x = 0; }
      x += iw;
    }
    return lines;
  };
  const sectionH = def => {
    const nG = Math.ceil(S.settings.types[def.type].size / 5);
    const bench = benchItems(def).length;
    return 44 + Math.ceil(nG / COLS) * (GROUP_H + GAP) + (bench ? 36 + benchLines(def) * 24 : 0) + 30;
  };
  const H = 104 + defs.reduce((h, d) => h + sectionH(d), 0) + 26;
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  c.scale(SCALE, SCALE);
  c.textBaseline = 'middle';
  const rr = (x, y, w2, h2, r, fill, stroke) => {
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w2, h2, r); else c.rect(x, y, w2, h2);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
  };
  const text = (t, x, y, f, color, align) => { c.font = f; c.fillStyle = color; c.textAlign = align || 'left'; c.fillText(t, x, y); };
  const fit = (t, f, max) => {
    c.font = f;
    if (c.measureText(t).width <= max) return t;
    while (t.length > 1 && c.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  };
  // Same spec icon as the page, with a thin ring in the class colour.
  const iconAt = (cx, cy, cls, spec) => {
    const S2 = 16, x0 = cx - 4, y0 = cy - S2 / 2;
    const img = ICON_IMAGES.get(iconUrl(cls, spec));
    c.save();
    c.beginPath();
    if (c.roundRect) c.roundRect(x0, y0, S2, S2, 3); else c.rect(x0, y0, S2, S2);
    c.clip();
    if (img) c.drawImage(img, x0, y0, S2, S2); else { c.fillStyle = CLASS_COLOR[cls] || PAL.muted; c.fillRect(x0, y0, S2, S2); }
    c.restore();
    rr(x0 - .5, y0 - .5, S2 + 1, S2 + 1, 3.5, null, CLASS_COLOR[cls] || PAL.line);
  };

  c.fillStyle = PAL.bg;
  c.fillRect(0, 0, W, H);
  text('HOLDET', PAD, 40, font(600, 12), PAL.accent);
  text('Raid roster', PAD, 70, font(700, 28), PAL.fg);
  text(`${weekName(w.id)} · ${weekSpan(w.id)}`, W - PAD, 70, font(400, 15), PAL.muted, 'right');
  let y = 104;
  for (const def of defs) {
    const raid = w.raids[def.id];
    const typeCfg = S.settings.types[def.type];
    const byP = Object.fromEntries((raid.roster || []).map(e => [e.p, e]));
    const cov = coverage(raid.roster || [], S.settings);
    const ok = cov.filter(x => x.ok).length;
    c.fillStyle = PAL.line;
    c.fillRect(PAD, y, W - PAD * 2, 1);
    y += 24;
    text(def.name, PAD, y, font(600, 20), PAL.fg);
    c.font = font(600, 20);
    const tw = c.measureText(def.name).width;
    text(parseIso(w.days[raid.dayId].date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }), PAD + tw + 12, y + 1, font(400, 15), PAL.muted);
    text(`${(raid.roster || []).length}/${typeCfg.size} players · ${ok}/${cov.length} buffs`, W - PAD, y, font(500, 13), ok === cov.length ? PAL.ok : PAL.warn, 'right');
    y += 20;
    const nG = Math.ceil(typeCfg.size / 5);
    for (let g = 0; g < nG; g++) {
      const gx = PAD + (g % COLS) * (colW + GAP), gy = y + Math.floor(g / COLS) * (GROUP_H + GAP);
      rr(gx, gy, colW, GROUP_H, 10, PAL.card, PAL.line);
      text(`GROUP ${g + 1}`, gx + 14, gy + 18, font(600, 11), PAL.muted);
      const members = (raid.groups || [])[g] || [];
      members.forEach((pid, i) => {
        const e = byP[pid] || {};
        const ry = gy + 42 + i * ROW;
        const color = CLASS_COLOR[e.c] || PAL.fg;
        const spec = shortSpec(e.s || '');
        c.font = font(400, 12);
        const sw = c.measureText(spec).width;
        iconAt(gx + 18, ry, e.c, e.s);
        text(fit(charOf(pid), font(600, 14), colW - 62 - sw), gx + 38, ry, font(600, 14), color);
        text(spec, gx + colW - 14, ry, font(400, 12), e.off ? PAL.warn : PAL.muted, 'right');
      });
      for (let i = members.length; i < 5; i++) text('–', gx + 38, gy + 42 + i * ROW, font(400, 13), PAL.faint);
    }
    y += Math.ceil(nG / COLS) * (GROUP_H + GAP);
    const items = benchItems(def);
    if (items.length) {
      y += 12;
      text(`${benchLabel(S.settings, sharedBench(w, S.settings, def.id)).toUpperCase()} · BE AVAILABLE ON DISCORD, YOU GET DKP`, PAD, y, font(600, 11), PAL.muted);
      y += 24;
      let x = PAD;
      for (const it of items) {
        const { nw, iw } = itemW(it);
        if (x + iw > W - PAD && x > PAD) { x = PAD; y += 24; }
        const color = CLASS_COLOR[it.cls] || PAL.fg;
        iconAt(x + 4, y, it.cls, it.specFull);
        text(it.name, x + 22, y, font(600, 14), color);
        text(it.spec, x + 22 + nw + 6, y, font(400, 12), PAL.muted);
        x += iw;
      }
      y += 12;
    }
    y += 30;
  }
  if (defs.some(def => (w.raids[def.id].roster || []).some(e => e.off))) text('Amber spec = playing their off-spec', PAD, H - 18, font(500, 11), PAL.warn);
  text('NP Roster', W - PAD, H - 18, font(500, 11), PAL.faint, 'right');
  return canvas;
}

const ICON_IMAGES = new Map();
function loadIcon(url) {
  if (!url || ICON_IMAGES.has(url)) return Promise.resolve();
  return new Promise(res => {
    const img = new Image();
    img.onload = () => { ICON_IMAGES.set(url, img); res(); };
    img.onerror = () => res();
    img.src = url;
  });
}

async function buildImage(w) {
  if (IMG.busy) return;
  IMG.busy = true;
  const sig = imageSig(w);
  try {
    try {
      await Promise.all([document.fonts.load('600 14px Geist'), document.fonts.load('400 12px Geist'), document.fonts.load('700 28px Geist')]);
    } catch (e) { /* falls back to the system font */ }
    const urls = new Set();
    for (const def of plannedRaids(w)) {
      for (const e of w.raids[def.id].roster || []) urls.add(iconUrl(e.c, e.s));
      const av = availability(w, w.raids[def.id].dayId, S.players);
      for (const p of benchFor(w, def.id, S.settings, S.players)) { const o = av.get(p) && av.get(p).opts[0]; if (o) urls.add(iconUrl(o.c, o.s)); }
    }
    await Promise.all([...urls].map(loadIcon));
    const canvas = drawRoster(w);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    if (blob) {
      if (IMG.url) URL.revokeObjectURL(IMG.url);
      Object.assign(IMG, { blob, url: URL.createObjectURL(blob), sig, wid: w.id });
    }
  } catch (e) {
    // Don't retry the same roster on every render; the text and addon string still work.
    IMG.failed = sig;
    toast('Could not draw the roster image: ' + ((e && e.message) || e));
  } finally {
    IMG.busy = false;
    schedule();
  }
}

function copyImage() {
  if (!IMG.blob) return;
  const blocked = () => toast('Copying images is blocked here. Use Save image, or right-click the picture and copy it.');
  try {
    navigator.clipboard.write([new ClipboardItem({ 'image/png': IMG.blob })]).then(() => toast('Image copied. Paste it in Discord with Ctrl+V.'), blocked);
  } catch (e) { blocked(); }
}

async function saveImage() {
  if (!IMG.blob) return;
  const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
  if (!dl) { toast('Saving is not available here. Right-click the picture and save it.'); return; }
  try { await dl.save({ filename: `raid-roster-${IMG.wid}.png`, data: IMG.blob }); }
  catch (e) { if (!e || e.code !== 'declined') toast('Could not save the image: ' + ((e && e.message) || e)); }
}

// ---------- Bench decision ----------
function weeksAgo(history) {
  const i = history.indexOf(true);
  return i < 0 ? null : i + 1;
}

function renderDecide(w, def) {
  const bc = benchCandidates(w, def.id, S.settings, S.players, S.weeks);
  if (!bc || !bc.rows.length) return '';
  const candidates = new Set(bc.rows.map(r => r.p));
  const draft = S.benchDraft[def.id] ? new Set([...S.benchDraft[def.id]].filter(p => candidates.has(p))) : null;
  const benched = draft || new Set(bc.rows.filter(r => !r.entry).map(r => r.p));
  const stats = attendanceStats();
  const must = bc.rows.filter(r => r.noBench || r.needed.length);
  const roles = bc.rows.filter(r => !(r.noBench || r.needed.length) && r.slot).sort((a, b) => a.slot.localeCompare(b.slot));
  const free = bc.rows.filter(r => !(r.noBench || r.needed.length) && !r.slot);
  const nBench = benched.size;
  const countPill = nBench === bc.toBench ? 'ok' : 'warn';
  // Coverage with the bench as ticked right now: who is still playing, and what they bring.
  // In a lockout every raid gets its own board; a player counts for the raid they are in.
  const tc = bc.typeCfg, rules = S.settings.buffs;
  const multi = bc.rids.length > 1;
  const playingIn = rid => bc.rows.filter(r => !benched.has(r.p) && (r.rid || bc.rids[0]) === rid);
  const freeFor = (r, rid) => !multi || (r.rids || []).includes(rid);
  const plays = (r, ru) => !!(r.opt && ruleMatches(ru, r.opt.c, r.opt.s));
  const could = (r, ru) => (r.opts || []).some(o => ruleMatches(ru, o.c, o.s));
  const short = l => l.replace(/\s*\(.*\)\s*/, '');
  const roleDefs = [
    { id: 'tank', label: 'Tanks', min: tc.tanks, is: r => r.opt && r.opt.r === 'Tank', can: r => (r.opts || []).some(o => o.r === 'Tank') },
    { id: 'heal', label: 'Healers', min: tc.healMin, is: r => r.opt && r.opt.r === 'Healer', can: r => (r.opts || []).some(o => o.r === 'Healer') },
  ];
  const cover = {};
  for (const rid of bc.rids) {
    const pl = playingIn(rid);
    cover[rid] = { buff: Object.fromEntries(rules.map(ru => [ru.id, pl.filter(r => plays(r, ru))])), role: Object.fromEntries(roleDefs.map(d => [d.id, pl.filter(d.is)])) };
  }
  const raidShort = rid => { const d = raidDef(rid); return multi ? (d.name.match(/\b([A-Z])$/) || [null, d.name])[1] : d.name; };
  const tile = (label, have, min, benchCan) => {
    const n = have.length;
    const state = n > min ? 'spare' : n === min && n > 0 ? 'exact' : benchCan.length ? 'fix' : 'none';
    const line = state === 'spare' ? `${n} of ${min} · ${n - min} can sit`
      : state === 'exact' ? `${n} of ${min} · keep ${n === 1 ? 'them' : 'all'}`
      : state === 'fix' ? `Missing · ${benchCan.length} on the bench can bring it`
      : 'Missing · nobody signed up';
    const names = (state === 'fix' ? benchCan : have).map(r => charOf(r.p));
    return `<div class="bt ${state}" title="${esc(label)}: ${esc(names.join(', ') || 'nobody')}"><span class="t">${esc(label)}</span><span class="s">${esc(line)}</span><span class="w">${esc(names.join(', ') || '–')}</span></div>`;
  };
  const boardFor = rid => roleDefs.map(d => tile(d.label, cover[rid].role[d.id], d.min, bc.rows.filter(r => benched.has(r.p) && freeFor(r, rid) && d.can(r))))
    .concat(rules.map(ru => tile(short(ru.label), cover[rid].buff[ru.id], ru.min || 1, bc.rows.filter(r => benched.has(r.p) && freeFor(r, rid) && could(r, ru))))).join('');
  const board = multi
    ? bc.rids.map(rid => `<div class="boardhead">${esc(raidDef(rid).name)} · ${esc(fmtDay(w.days[w.raids[rid].dayId].date))}</div><div class="buffboard">${boardFor(rid)}</div>`).join('')
    : `<div class="buffboard">${boardFor(bc.rids[0])}</div>`;
  // What benching (or playing) one player would change, given everyone else as ticked.
  const impact = r => {
    if (benched.has(r.p)) {
      const adds = [];
      for (const rid of bc.rids) {
        if (!freeFor(r, rid)) continue;
        const sfx = multi ? ` (${raidShort(rid)})` : '';
        rules.filter(ru => cover[rid].buff[ru.id].length < (ru.min || 1) && could(r, ru)).forEach(ru => adds.push(short(ru.label) + sfx));
        roleDefs.filter(d => cover[rid].role[d.id].length < d.min && d.can(r)).forEach(d => adds.push(d.label.toLowerCase().replace(/s$/, '') + sfx));
      }
      return adds.length ? `<span class="pill ok" title="Playing them adds: ${esc(adds.join(', '))}">Would add ${esc(adds.join(', '))}</span>` : '<span class="small muted">Adds nothing missing</span>';
    }
    const rid = r.rid || bc.rids[0];
    const lose = rules.filter(ru => plays(r, ru) && cover[rid].buff[ru.id].length <= (ru.min || 1)).map(ru => short(ru.label))
      .concat(roleDefs.filter(d => d.is(r) && cover[rid].role[d.id].length <= d.min).map(d => d.label.toLowerCase().replace(/s$/, '')));
    const where = multi ? ` in ${raidShort(rid)}` : '';
    return lose.length ? `<span class="pill bad" title="Benching them loses: ${esc(lose.join(', '))}${esc(where)}">Last ${esc(lose.join(', '))}${esc(where)}</span>` : '<span class="pill">Safe to bench</span>';
  };
  const brings = r => rules.filter(ru => plays(r, ru)).map(ru => ru.label);
  const hist = r => `<span class="hist" title="Last 8 weeks, newest first. Filled = benched.">${r.history.map(b => `<i class="${b ? 'on' : ''}"></i>`).join('')}${Array.from({ length: 8 - r.history.length }, () => '<i class="na"></i>').join('')}</span>`;
  const row = (r, rank) => {
    const p = S.players[r.p] || {};
    const s = stats[r.p];
    const pct = s && s.raids ? Math.round(100 * (s.present + s.bench) / s.raids) + '%' : '–';
    const n = r.history.filter(Boolean).length;
    const ago = weeksAgo(r.history);
    const isB = benched.has(r.p);
    const status = r.noBench ? '<span class="pill acc">Never bench</span>'
      : r.needed.length ? `<span class="pill bad" title="${esc(r.needed.join(', '))}">Needed</span><span class="small muted">${esc(r.needed.join(', '))}</span>`
      : r.slot ? `<span class="pill" title="Benching them means someone else takes the spot, maybe in an off-spec.">${r.slot === 'Tank' ? 'Tank spot' : 'Healer spot'}</span>`
      : `<span class="rank mono" title="Order the optimizer would bench DPS in">#${rank}</span>`;
    const warn = isB && (r.noBench || r.needed.length);
    return `<tr class="${isB ? 'is-bench' : ''} ${warn ? 'is-warn' : ''}">
      <td><input type="checkbox" id="bb-${def.id}-${r.p}" data-act="bench-toggle" data-rid="${def.id}" data-pid="${r.p}" ${isB ? 'checked' : ''} aria-label="Bench ${esc(charOf(r.p))}"></td>
      <td>${cardLink(r.p, r.opt ? who(r.p, r.opt.c, r.opt.s) : who(r.p))}${relWarn(r.p)}<span class="small muted" style="margin-left:6px">${esc(r.opt ? shortSpec(r.opt.s) : '')}${multi && r.rid ? ` · ${esc(raidShort(r.rid))}` : ''}</span></td>
      <td><span class="row" style="gap:6px;flex-wrap:nowrap">${status}</span></td>
      <td class="impact" title="${esc(brings(r).length ? 'Brings: ' + brings(r).join(', ') : 'Brings no raid buff')}">${impact(r)}</td>
      <td>${hist(r)} <span class="small muted">${n ? `${n}× · ${ago === 1 ? 'last week' : ago + ' wk ago'}` : 'never'}</span></td>
      <td class="num">${pct}</td>
      <td class="num">${p.parse ?? '–'}</td>
      <td>${r.st && r.st !== 'yes' ? `<span class="pill warn">${esc(STATUS_LABEL[r.st])}</span>` : (r.st ? '' : '<span class="pill">not signed</span>')}${Number(p.prio) ? ` <span class="pill">${p.prio > 0 ? '+' : ''}${p.prio}</span>` : ''}</td>
    </tr>`;
  };
  const open = S.decideOpen[def.id] ?? false;
  const warnings = bc.rows.filter(r => benched.has(r.p) && (r.noBench || r.needed.length)).map(r => charOf(r.p));
  // Same view as the boards: missing in a raid although a benched player free that day could bring it.
  const losses = [];
  for (const rid of bc.rids) {
    const sfx = multi ? ` in ${raidDef(rid).name}` : '';
    rules.filter(ru => cover[rid].buff[ru.id].length < (ru.min || 1) && bc.rows.some(r => benched.has(r.p) && freeFor(r, rid) && could(r, ru))).forEach(ru => losses.push(short(ru.label) + sfx));
    roleDefs.filter(d => cover[rid].role[d.id].length < d.min && bc.rows.some(r => benched.has(r.p) && freeFor(r, rid) && d.can(r))).forEach(d => losses.push(`${d.min} ${d.label.toLowerCase()}${sfx}`));
  }
  return `<details class="decide" data-act="decide-toggle" data-rid="${def.id}" ${open ? 'open' : ''}>
    <summary><b style="color:var(--fg)">Decide the bench${multi ? ' for the lockout' : ''}</b><span class="pill ${countPill}">${nBench} of ${bc.toBench} benched</span><span class="small muted">${bc.rows.length} available · ${bc.size} spots · ${must.length} must play · ${roles.length} tank/healer spots · ${free.length} DPS can sit</span></summary>
    <div class="stack" style="padding-top:12px">
      <div class="sub">Tick who sits. “Needed” players bring a buff or a tank/healer spot nobody else available covers. Tank and healer spots come next. DPS are in bench order: #1 is first in line to sit. Players who are the only one with a buff come last; after that it goes by who was benched least lately, priority, parse, how crowded their spec is, an unsure signup, and latest signup. The board and the “If benched” column follow your ticks live.</div>
      <div aria-label="Raid buffs with this bench">${board}</div>
      <div class="legend small"><span class="bt-key spare"></span>Spare: some can sit <span class="bt-key exact"></span>Just enough: keep them <span class="bt-key fix"></span>Missing, but a bench player has it <span class="bt-key none"></span>Nobody signed up</div>
      <div class="benchbar ${losses.length || warnings.length ? 'bad' : nBench !== bc.toBench ? 'warn' : draft ? 'ok' : ''}">
        <span class="msg">${losses.length ? `This bench leaves ${multi ? 'the raids' : 'the raid'} without ${esc(losses.join(', '))}, although someone available could bring it.`
          : warnings.length ? `Benching ${esc(warnings.join(', '))} loses a buff or role, or goes against “never bench”.`
          : nBench < bc.toBench ? `Pick ${bc.toBench - nBench} more, or the optimizer picks the rest when you apply.`
          : nBench > bc.toBench ? `${nBench - bc.toBench} more than needed, so the raid will be short.`
          : draft ? 'Ready. Apply to rebuild the roster around this bench.' : 'This is the current bench. Tick or untick players to change it.'}</span>
        <button class="primary sm" data-act="bench-apply" data-rid="${def.id}" ${draft ? '' : 'disabled'}>Apply bench</button>
        <button class="ghost sm" data-act="bench-reset" data-rid="${def.id}" ${draft ? '' : 'disabled'}>Reset</button>
      </div>
      <div class="scroll-x"><table class="decide-t"><thead><tr><th>Bench</th><th>Player</th><th>Status</th><th title="What benching this player would cost, with the bench as ticked now. For bench players: what playing them would add.">If benched</th><th>Benched, last 8 weeks</th><th class="num">Attend.</th><th class="num">Parse</th><th>Signup</th></tr></thead>
      <tbody>${must.map(r => row(r)).join('')}${roles.map(r => row(r)).join('')}${free.map((r, i) => row(r, i + 1)).join('')}</tbody></table></div>
    </div>
  </details>`;
}

// ---------- Selection bar ----------
function renderSelbar() {
  const bar = document.getElementById('selbar');
  const w = week();
  if (S.view !== 'week' || !S.sel || !w || !w.raids || !w.raids[S.sel.rid]) { bar.hidden = true; return; }
  const { rid, pid } = S.sel;
  const raid = w.raids[rid];
  const def = raidDef(rid);
  const entry = (raid.roster || []).find(e => e.p === pid);
  const info = availability(w, raid.dayId, S.players).get(pid);
  const opts = info ? info.opts : playerOpts(S.players[pid], null);
  const lock = (raid.locks || {})[pid] || '';
  const nG = Math.ceil((S.settings.types[def.type] || { size: 10 }).size / 5);
  const inGroup = (raid.groups || []).findIndex(g => g.includes(pid));
  bar.hidden = false;
  bar.innerHTML = `<div class="in">
    ${entry ? who(pid, entry.c, entry.s) : who(pid)}<span class="muted small">${esc(def.name)} · ${info ? esc(STATUS_LABEL[info.st]) : 'not signed up'}</span>
    <span class="sep"></span>
    ${entry ? `<select id="sel-spec" data-act="sel-spec" aria-label="Spec">${opts.map((o, i) => `<option value="${i}" ${o.c === entry.c && o.s === entry.s ? 'selected' : ''}>${esc(o.s)} ${esc(o.c)}${o.off ? ' (off-spec)' : ''}</option>`).join('')}</select>` : ''}
    <div class="seg">${Array.from({ length: nG }, (_, i) => `<button class="sm" data-act="sel-move" data-zone="g${i}" ${inGroup === i ? 'disabled' : ''}>G${i + 1}</button>`).join('')}${entry ? '<button class="sm" data-act="sel-move" data-zone="bench">Bench</button>' : ''}</div>
    <select id="sel-lock" data-act="sel-lock" title="What Re-optimize may do with this player" aria-label="Re-optimize rule">
      <option value="" ${!lock ? 'selected' : ''}>Optimizer decides</option><option value="in" ${lock === 'in' ? 'selected' : ''}>Keep in this raid</option><option value="out" ${lock === 'out' ? 'selected' : ''}>Keep out of this raid</option>
    </select>
    <button class="sm" data-act="card" data-pid="${pid}">Player card</button>
    <button class="ghost sm" data-act="sel-close" style="margin-left:auto">Close</button>
  </div>`;
}

// ---------- Week actions ----------
function newWeek(date) {
  const id = resetOf(date);
  if (S.weeks[id]) { S.weekId = id; store('week', id); schedule(); toast(`${weekName(id)} already exists, so it is open now.`); return; }
  const days = {};
  for (const wd of S.settings.defaultDays || []) {
    const d = addDays(id, weekdayOffset(wd));
    days['d' + d] = { date: d };
  }
  saveWeek(id, { id, days, signups: {}, raids: {}, status: 'draft', createdAt: Date.now() }, `Created ${weekName(id)}`);
  S.weekId = id; store('week', id);
}

function importSignups(did) {
  const w = week();
  const text = S.drafts['imp-' + did] || '';
  let res;
  try { res = parseRaidHelper(text); } catch (e) { toast(e.message); return; }
  const day = w.days[did];
  const list = res.signups.map(s => ({ p: s.p, n: s.n, st: s.st, opts: s.opts, t: s.t }));
  const drops = dropPatch(w, did, list);
  logged(`Imported signups for ${fmtDay(day.date)}`, () => {
    upsertPlayers(res);
    saveWeek(w.id, {
      days: { [did]: { ...day, eventId: res.event.id, eventTitle: res.event.title, importedAt: Date.now() } },
      signups: { [did]: list },
      ...(drops ? { drops: { [did]: drops } } : {}),
    });
  });
  if (drops) { const gone = Object.keys(drops).filter(p => drops[p]); if (gone.length) setTimeout(() => toast(`Dropped after the roster was made: ${gone.map(charOf).join(', ')}.`), 1500); }
  delete S.drafts['imp-' + did];
  S.importOpen = null;
  const n = res.signups.filter(s => AVAILABLE.has(s.st)).length;
  toast(`Imported ${res.signups.length} signups (${n} available)${res.event.date && res.event.date !== day.date ? `. Note: the event is on ${fmtDay(res.event.date)}, this day is ${fmtDay(day.date)}.` : '.'}`);
}

// Several events in one paste: each goes to the raid day with its date (a missing day in this week is added).
function importWeek() {
  const w = week();
  let events;
  try { events = parseRaidHelperMany(S.drafts['imp-all'] || ''); } catch (e) { toast(e.message); return; }
  const days = {}, signups = {}, drops = {}, done = [], skipped = [], used = [];
  for (const res of events) {
    const date = res.event.date;
    if (!date || resetOf(date) !== w.id) { skipped.push(`${res.event.title}${date ? ` (${fmtDay(date)})` : ''}`); continue; }
    const did = Object.keys(w.days || {}).find(k => w.days[k] && w.days[k].date === date) || 'd' + date;
    used.push(res);
    days[did] = { ...((w.days || {})[did] || {}), date, eventId: res.event.id, eventTitle: res.event.title, importedAt: Date.now() };
    signups[did] = res.signups.map(s => ({ p: s.p, n: s.n, st: s.st, opts: s.opts, t: s.t }));
    const d = dropPatch(w, did, signups[did]);
    if (d) drops[did] = d;
    done.push(fmtDay(date));
  }
  if (done.length) logged(`Imported signups for ${done.join(', ')}`, () => { used.forEach(upsertPlayers); saveWeek(w.id, { days, signups, ...(Object.keys(drops).length ? { drops } : {}) }); });
  delete S.drafts['imp-all'];
  S.importOpen = null;
  toast(`${done.length ? `Imported ${done.join(', ')}.` : 'Nothing imported.'}${skipped.length ? ` Skipped, not in this week: ${skipped.join(', ')}.` : ''}`);
}

function upsertPlayers(res) {
  for (const su of res.signups) {
    const known = S.players[su.p];
    if (known) {
      // Until an officer confirms a character name, it follows the player's Discord nickname.
      const guess = guessChar(su.n);
      const next = clone(known);
      if (known.charSource !== 'manual' && (known.char !== guess || known.name !== su.n)) Object.assign(next, { name: su.n, char: guess, charSource: 'guess' });
      // A first signup as Late/Tentative carries no class; take it from a later one.
      const o = su.opts[0];
      if (!CLASSES[known.cls] && o) Object.assign(next, { cls: o.c, main: o.s, off: (su.opts.find(x => x.c === o.c && x.s !== o.s) || {}).s || '' });
      if (JSON.stringify(next) !== JSON.stringify(known)) savePlayer(su.p, next);
      continue;
    }
    const o = su.opts[0] || {};
    const off = su.opts.find(x => x.c === o.c && x.s !== o.s);
    savePlayer(su.p, { name: su.n, char: guessChar(su.n), charSource: 'guess', cls: o.c || '', main: o.s || '', off: off ? off.s : '', active: true, prio: 0, parse: null, notes: '', createdAt: Date.now() });
  }
}

// A player on a planned roster for this day who is no longer available has dropped; signing up
// again clears it. Returns the patch for week.drops[did], or null when nothing changes.
function dropPatch(w, did, list) {
  const onRoster = new Set();
  for (const raid of Object.values(w.raids || {})) if (raid && raid.dayId === did) (raid.roster || []).forEach(e => onRoster.add(e.p));
  const was = new Map(((w.signups || {})[did] || []).map(s => [s.p, s.st]));
  const now = new Map(list.map(s => [s.p, s.st]));
  const cur = (w.drops || {})[did] || {};
  const out = {};
  for (const pid of onRoster) {
    const before = AVAILABLE.has(was.get(pid)), after = AVAILABLE.has(now.get(pid));
    if (before && !after && !cur[pid]) out[pid] = Date.now();
    else if (after && cur[pid]) out[pid] = null;
  }
  return Object.keys(out).length ? out : null;
}

// An officer's correction of one player's status on one day ('none' removes the signup).
function setStatus(did, pid, st) {
  const w = week();
  const list = clone((w.signups || {})[did] || []);
  const i = list.findIndex(s => s.p === pid);
  const cur = i >= 0 ? list[i].st : 'none';
  if (st === cur) return;
  if (st === 'none') list.splice(i, 1);
  else if (i >= 0) list[i].st = st;
  else list.push({ p: pid, n: (S.players[pid] || {}).name || '', st, opts: [], t: Date.now() / 1000, manual: true });
  const drops = dropPatch(w, did, list);
  saveWeek(w.id, { signups: { [did]: list }, ...(drops ? { drops: { [did]: drops } } : {}) }, `Set ${charOf(pid)} to ${ST_TEXT[st].toLowerCase()} on ${fmtDay(w.days[did].date)}`);
}

const RAID_KEYS = ['dayId', 'pinDay', 'roster', 'groups', 'locks'];
const raidSig = r => JSON.stringify(r ? RAID_KEYS.map(k => k === 'locks' ? Object.entries(r.locks || {}).filter(([, v]) => v).sort() : r[k] ?? null) : null);

// Patch for one raid that turns `cur` into `next` under the database's merge rules:
// keep-in/keep-out entries that disappear are written as null.
function raidPatch(cur, next) {
  if (!next) return null;
  const locks = {};
  for (const k of Object.keys((cur && cur.locks) || {})) locks[k] = null;
  Object.assign(locks, next.locks || {});
  return { ...next, locks };
}

// Saves only the raids whose roster, groups, day or keep-rules changed, so two officers editing
// different raids at once don't overwrite each other.
function commitRaids(w, msg, note, rebuilt) {
  const before = (S.weeks[w.id] && S.weeks[w.id].raids) || {};
  const changed = Object.keys(w.raids).filter(rid => raidSig(before[rid]) !== raidSig(w.raids[rid]));
  if (!changed.length) return;
  const patch = {};
  for (const rid of changed) {
    const raid = w.raids[rid];
    if (raid) {
      raid.bench = benchFor(w, rid, S.settings, S.players);
      raid.explain = explainBench(w, rid, S.settings, S.players, S.weeks).map(x => [x.p, x.why]);
      raid.updatedAt = Date.now();
      raid.updatedBy = S.me;
      if (raid.dayId && (rebuilt || !Array.isArray(raid.seen))) raid.seen = signupSnapshot(w, raid.dayId);
    }
    patch[rid] = raidPatch(before[rid], raid);
  }
  const text = note || msg || `Changed ${changed.map(rid => (raidDef(rid) || {}).name || rid).join(', ')}`;
  saveWeek(w.id, { raids: patch }, text);
  if (msg) toast(msg, { act: 'undo', label: 'Undo' });
}

// Stores every raid's bench when the week is final, since bench history drives fairness.
function finalizeWeek() {
  const w = clone(week());
  const raids = {};
  for (const [rid, raid] of Object.entries(w.raids || {})) {
    if (!raid || !raid.dayId) continue;
    raids[rid] = { bench: benchFor(w, rid, S.settings, S.players), explain: explainBench(w, rid, S.settings, S.players, S.weeks).map(x => [x.p, x.why]) };
  }
  saveWeek(w.id, { status: 'final', raids }, 'Marked the week final');
}

function applyRosters(w, rosters, assign, msg, note) {
  for (const [rid, ros] of Object.entries(rosters)) {
    const def = raidDef(rid);
    if (!def) continue;
    const prev = w.raids[rid] || {};
    w.raids[rid] = { ...prev, dayId: assign ? assign[rid] : prev.dayId, roster: ros, groups: makeGroups(ros, S.settings.types[def.type].size), locks: prev.locks || {}, updatedAt: Date.now() };
  }
  commitRaids(w, msg, note, true);
}

function suggest() {
  const w = week();
  const list = planWeek(w, ctx());
  S.suggestions = { wid: w.id, list };
  schedule();
}

function reoptimize(rid, base, msg) {
  const w = base || clone(week());
  w.raids ||= {};
  const def = raidDef(rid);
  const defs = S.settings.raids.filter(r => r.type === def.type && w.raids[r.id] && w.raids[r.id].dayId);
  if (!defs.length) { toast('Pick a day for the raid first.'); return; }
  const res = optimizeType(defs.map(d => ({ rid: d.id, dayId: w.raids[d.id].dayId, locks: w.raids[d.id].locks || {} })), S.settings.types[def.type], { ...ctx(), week: w, type: def.type });
  applyRosters(w, res.rosters, null, msg || `Re-optimized ${defs.map(d => d.name).join(' and ')}.`);
}

// The officer's bench pick: benched players are kept out, everyone else in, then specs and groups are redone.
function applyBench(rid) {
  const draft = S.benchDraft[rid];
  if (!draft) return;
  const w = clone(week());
  const bc = benchCandidates(w, rid, S.settings, S.players, S.weeks);
  // Benched players are kept out of every raid of the lockout; anyone un-benched loses an old keep-out.
  // Nobody is forced in, so the optimizer still decides who plays which raid around the bench.
  for (const r0 of bc.rids) {
    const raid = w.raids[r0];
    raid.locks ||= {};
    for (const r of bc.rows) {
      if (draft.has(r.p)) raid.locks[r.p] = 'out';
      else if (raid.locks[r.p] === 'out') raid.locks[r.p] = null;
    }
  }
  delete S.benchDraft[rid];
  reoptimize(rid, w, `Bench set for ${bc.rids.map(r => raidDef(r).name).join(' and ')}.`);
}

function defaultEntry(w, dayId, pid) {
  const info = availability(w, dayId, S.players).get(pid);
  const o = (info ? info.opts : playerOpts(S.players[pid], null))[0];
  return o ? { p: pid, c: o.c, s: o.s, r: o.r, off: false } : null;
}

function moveChip(fromRid, pid, toRid, zone, targetPid) {
  if (zone === 'bench' && fromRid && fromRid !== toRid && sameTypeRaids(S.settings, toRid).includes(fromRid)) toRid = fromRid;
  const w = clone(week());
  const raid = w.raids[toRid];
  if (!raid || !raid.dayId) return;
  raid.locks ||= {}; raid.roster ||= []; raid.groups ||= [];
  const removeFrom = (r, p) => { r.roster = (r.roster || []).filter(e => e.p !== p); r.groups = (r.groups || []).map(g => g.filter(x => x !== p)); };
  const posOf = (r, p) => { for (let i = 0; i < (r.groups || []).length; i++) { const j = r.groups[i].indexOf(p); if (j >= 0) return [i, j]; } return null; };
  if (zone === 'bench') {
    if (!raid.roster.some(e => e.p === pid)) return;
    removeFrom(raid, pid);
    raid.locks[pid] = 'out';
  } else {
    const gi = Number(zone.slice(1));
    while (raid.groups.length <= gi) raid.groups.push([]);
    const fromEntry = fromRid && w.raids[fromRid] ? (w.raids[fromRid].roster || []).find(e => e.p === pid) : null;
    const entry = raid.roster.find(e => e.p === pid) || (fromEntry ? { ...fromEntry } : defaultEntry(w, raid.dayId, pid));
    if (!entry) return;
    const wasIn = raid.roster.some(e => e.p === pid);
    // Swapping across two raids of one lockout: the displaced player takes the mover's old spot.
    const src = fromRid && fromRid !== toRid && sameTypeRaids(S.settings, toRid).includes(fromRid) ? w.raids[fromRid] : null;
    const srcPos = src ? posOf(src, pid) : null;
    const target = targetPid && raid.groups[gi].includes(targetPid) ? (raid.roster.find(e => e.p === targetPid) || null) : null;
    for (const other of sameTypeRaids(S.settings, toRid)) {
      const o = w.raids[other];
      if (o && (o.roster || []).some(e => e.p === pid)) { removeFrom(o, pid); o.locks ||= {}; o.locks[pid] = null; }
    }
    const from = posOf(raid, pid);
    const g = raid.groups[gi];
    if (targetPid && targetPid !== pid && g.includes(targetPid)) {
      const ti = g.indexOf(targetPid);
      if (from) { raid.groups[from[0]][from[1]] = targetPid; g[ti] = pid; }
      else {
        g[ti] = pid;
        raid.roster = raid.roster.filter(e => e.p !== targetPid);
        raid.roster.push(entry);
        // The swapped-out player is no longer kept here, or Re-optimize would put them back.
        if (raid.locks[targetPid] === 'in') raid.locks[targetPid] = null;
        if (src && srcPos && target && availability(w, src.dayId, S.players).has(targetPid)) {
          src.groups[srcPos[0]].splice(srcPos[1], 0, targetPid);
          src.roster.push({ ...target });
          src.locks ||= {}; src.locks[targetPid] = 'in';
        }
      }
    } else {
      if (from && from[0] === gi) return;
      if (g.length >= 5) { toast(`Group ${gi + 1} is full. Drop onto a player to swap them.`); return; }
      if (from) raid.groups[from[0]].splice(from[1], 1);
      g.push(pid);
      if (!wasIn) raid.roster.push(entry);
    }
    const size = (S.settings.types[raidDef(toRid).type] || {}).size || 40;
    if (raid.roster.length > size) { toast('The raid is full. Drop onto a player to swap them.'); return; }
    if (!wasIn) raid.locks[pid] = 'in';
  }
  if (S.sel && S.sel.pid === pid) S.sel = { rid: toRid, pid };
  const where = zone === 'bench' ? 'the bench' : `group ${Number(zone.slice(1)) + 1}`;
  commitRaids(w, null, `Moved ${charOf(pid)} to ${where} in ${raidDef(toRid).name}${targetPid && zone !== 'bench' ? `, swapping with ${charOf(targetPid)}` : ''}`);
}

function setSpec(rid, pid, idx) {
  const w = clone(week());
  const raid = w.raids[rid];
  const info = availability(w, raid.dayId, S.players).get(pid);
  const opts = info ? info.opts : playerOpts(S.players[pid], null);
  const o = opts[idx];
  if (!o) return;
  raid.roster = raid.roster.map(e => e.p === pid ? { p: pid, c: o.c, s: o.s, r: o.r, off: !!o.off } : e);
  commitRaids(w, null, `Set ${charOf(pid)} to ${o.s} ${o.c} in ${raidDef(rid).name}`);
}

function setLock(rid, pid, v) {
  const w = clone(week());
  const raid = w.raids[rid];
  raid.locks ||= {};
  raid.locks[pid] = v || null;
  if (v === 'out' && (raid.roster || []).some(e => e.p === pid)) {
    raid.roster = raid.roster.filter(e => e.p !== pid);
    raid.groups = (raid.groups || []).map(g => g.filter(x => x !== pid));
  }
  commitRaids(w, null, v === 'in' ? `Kept ${charOf(pid)} in ${raidDef(rid).name}` : v === 'out' ? `Kept ${charOf(pid)} out of ${raidDef(rid).name}` : `Cleared the pick for ${charOf(pid)} in ${raidDef(rid).name}`);
}

function recordFromPlan(rid) {
  const w = week();
  const raid = w.raids[rid];
  saveWeek(w.id, { attendance: { [rid]: { present: (raid.roster || []).map(e => e.p), bench: benchFor(w, rid, S.settings, S.players), late: [], date: w.days[raid.dayId] ? w.days[raid.dayId].date : '', source: 'plan', importedAt: Date.now() } } }, `Recorded attendance for ${raidDef(rid).name} from the plan`);
  toast('Attendance recorded from the plan. An addon import later replaces it.');
}

// ---------- Attendance actions ----------
function saveAttendance(res) {
  saveWeek(res.weekId, { attendance: { [res.rid]: { present: res.present, bench: res.bench, late: res.late, date: res.date, source: 'addon', importedAt: Date.now() } } }, `Imported attendance for ${(raidDef(res.rid) || {}).name || res.rid}`);
  toast(`Imported: ${res.present.length} played, ${res.bench.length} bench.`);
}

// Unknown in-game names matched to players: the name becomes their confirmed character name.
function saveMatchedAttendance() {
  const res = clone(S.attPending);
  logged(`Imported attendance for ${(raidDef(res.rid) || {}).name || res.rid}`, () => {
    for (const name of res.unknown) {
      const pid = S.drafts['match:' + name] || (document.getElementById('match-' + name) || {}).value;
      if (!pid) continue;
      savePlayer(pid, { ...clone(S.players[pid]), char: name, charSource: 'manual' });
      for (const where of res.unknownIn[name] || []) if (!res[where].includes(pid)) res[where].push(pid);
    }
    S.attPending = null;
    saveAttendance(res);
  });
}

const ATT_NEXT = { played: 'bench', bench: 'missed', missed: 'played' };
function cycleAttendance(wid, rid, pid) {
  const w = S.weeks[wid];
  const att = clone(w.attendance[rid]);
  const cur = attendanceCell(w, rid, pid);
  const next = ATT_NEXT[cur] || 'played';
  att.present = (att.present || []).filter(x => x !== pid);
  att.bench = (att.bench || []).filter(x => x !== pid);
  att.missed = (att.missed || []).filter(x => x !== pid);
  if (next === 'played') att.present.push(pid);
  else if (next === 'bench') att.bench.push(pid);
  else att.missed.push(pid);
  att.edited = Date.now();
  saveWeek(wid, { attendance: { [rid]: att } }, `Marked ${charOf(pid)} as ${next} in ${(raidDef(rid) || {}).name || rid}`);
}

// ---------- Player card ----------
// Reliability for warnings, worked out once per render.
let relCache = {};
function relOf(pid) {
  const w = week();
  return (relCache[pid] ??= reliability(pid, w ? w.id : '9999', S.weeks, S.settings, { include: true }));
}
const relText = r => [r.noShows ? `${r.noShows} no-show${r.noShows > 1 ? 's' : ''}` : '', r.drops ? `${r.drops} drop${r.drops > 1 ? 's' : ''} after the roster was made` : ''].filter(Boolean).join(', ');
function relWarn(pid) {
  const r = relOf(pid);
  return r.points >= UNRELIABLE_POINTS ? `<span class="tag bad" title="Last 8 weeks: ${esc(relText(r))}">!</span>` : '';
}
// Any player name that opens their card.
const cardLink = (pid, inner) => `<button class="link" data-act="card" data-pid="${pid}" title="Open player card">${inner}</button>`;

// One player's whole story: settings, numbers, bench fairness and every week they were part of.
function renderCard() {
  const el = document.getElementById('pcard');
  const pid = S.card, p = pid && S.players[pid];
  if (!p) { el.hidden = true; el.innerHTML = ''; return; }
  const stats = attendanceStats()[pid] || { raids: 0, present: 0, bench: 0, late: 0, missed: 0 };
  const pct = stats.raids ? Math.round(100 * (stats.present + stats.bench) / stats.raids) + '%' : '–';
  const w = week();
  const recent = relOf(pid);
  const all = reliability(pid, '9999', S.weeks, S.settings, { n: 999 });
  const weeks = sortedWeeks();
  let unsure = 0;
  const specs = {};
  const rows = [];
  for (const wk of weeks) {
    const days = dayList(wk);
    const sus = days.map(([did, d]) => {
      const su = ((wk.signups || {})[did] || []).find(s => s.p === pid);
      if (su && (su.st === 'tentative' || su.st === 'late')) unsure++;
      const drop = ((wk.drops || {})[did] || {})[pid];
      return su || drop ? `<span class="pill ${!su || su.st === 'absence' ? 'bad' : su.st === 'yes' ? '' : 'warn'}" title="${esc(fmtDay(d.date))}">${esc(parseIso(d.date).toLocaleDateString('en-GB', { weekday: 'short' }))} ${esc(su ? STATUS_LABEL[su.st] || su.st : 'Not signed up')}${drop ? ' · dropped' : ''}</span>` : '';
    }).filter(Boolean);
    const raids = S.settings.raids.map(def => {
      const raid = (wk.raids || {})[def.id];
      if (!raid || !raid.dayId) return '';
      const entry = (raid.roster || []).find(e => e.p === pid);
      if (entry) specs[`${entry.s} ${entry.c}`] = (specs[`${entry.s} ${entry.c}`] || 0) + 1;
      const cell = attendanceCellOf(wk, def.id, pid);
      const onBench = (raid.bench || benchFor(wk, def.id, S.settings, S.players)).includes(pid);
      const why = onBench ? ((raid.explain || []).find(([x]) => x === pid) || [])[1] : '';
      const spec = entry ? ` (${shortSpec(entry.s)}${entry.off ? ', off-spec' : ''})` : '';
      if (cell === 'played') return `<span class="cell-p">${esc(def.name)}: played${esc(spec)}</span>`;
      if (cell === 'bench') return `<span class="cell-b" title="${esc(why || '')}">${esc(def.name)}: bench${why ? ` · ${esc(why)}` : ''}</span>`;
      if (cell === 'missed') return `<span class="cell-x">${esc(def.name)}: no-show</span>`;
      if (cell === 'none') return '';
      if (entry) return `<span>${esc(def.name)}: ${wk.status === 'final' ? 'played' : 'planned'}${esc(spec)}</span>`;
      if (onBench) return `<span class="cell-b">${esc(def.name)}: bench${why ? ` · ${esc(why)}` : ''}</span>`;
      return '';
    }).filter(Boolean);
    if (!sus.length && !raids.length) continue;
    rows.push(`<tr><td class="small">${esc(weekName(wk.id))}<div class="muted">${esc(weekSpan(wk.id))}</div></td><td><div class="row" style="gap:4px">${sus.join('') || '<span class="small muted">–</span>'}</div></td><td class="small" style="white-space:normal">${raids.join('<br>') || '<span class="muted">Not in any raid</span>'}</td></tr>`);
  }
  const types = [...new Set(S.settings.raids.map(r => r.type))];
  const fairness = types.map(t => {
    const h = benchHistory(pid, t, w ? addDays(w.id, 1) : '9999', S.weeks, S.settings);
    const debt = benchDebt(pid, t, w ? addDays(w.id, 1) : '9999', S.weeks, S.settings);
    const n = h.filter(Boolean).length;
    return `<div class="row"><b style="min-width:70px">${esc(t)}-man</b><span class="hist" title="Last 8 weeks, newest first. Filled = benched.">${h.map(b => `<i class="${b ? 'on' : ''}"></i>`).join('')}${Array.from({ length: 8 - h.length }, () => '<i class="na"></i>').join('')}</span><span class="small muted">${n ? `benched ${n}× in 8 weeks` : 'not benched in 8 weeks'}${debt > 0 ? ` · owed ${debt.toFixed(2)}` : ''}</span></div>`;
  }).join('');
  const tile = (l, v, cls, t) => `<div class="tile ${cls || ''}" ${t ? `title="${esc(t)}"` : ''}><span class="l">${esc(l)}</span><span class="v">${v}</span></div>`;
  const tags = [
    `${esc(p.main || '?')} ${esc(p.cls || '')}${p.off ? ` · off-spec ${esc(p.off)}` : ''}`,
    Number(p.prio) ? `priority ${p.prio > 0 ? '+' : ''}${p.prio}` : '',
    p.noBench ? 'never bench' : '',
    Array.isArray(p.tankFor) && p.tankFor.length ? `tank in ${p.tankFor.join(' and ')}-man` : '',
    p.active === false ? 'inactive' : '',
  ].filter(Boolean).map(t => `<span class="pill">${t}</span>`).join('');
  el.hidden = false;
  el.innerHTML = `<div class="in" role="dialog" aria-modal="true" aria-label="Player card for ${esc(charOf(pid))}">
    <div class="row spread" style="align-items:flex-start">
      <div class="stack" style="gap:6px"><h2 class="row" style="gap:8px">${classIcon(p.cls, p.main)}${esc(charOf(pid))}${p.charSource === 'manual' ? '' : ' <span class="tag" title="Guessed from the Discord name">guess</span>'}</h2>
        <div class="small muted">${p.name ? `Discord: ${esc(p.name)}` : 'Added by hand'}</div><div class="row" style="gap:6px">${tags}</div></div>
      <button class="ghost sm" data-act="card-close">Close</button>
    </div>
    ${recent.points >= UNRELIABLE_POINTS ? `<div class="banner">Last 8 weeks: ${esc(relText(recent))}.${S.settings.weights.reliability ? ' This counts against them when DPS spots are picked.' : ''}</div>` : ''}
    <div class="tiles">
      ${tile('Attendance', pct, '', 'Played or bench while available, per lockout per week')}
      ${tile('Played', stats.present, stats.present ? 'cell-p' : '')}${tile('Bench', stats.bench, stats.bench ? 'cell-b' : '')}
      ${tile('No-shows', all.noShows, all.noShows ? 'cell-x' : '', `Planned to play or sit on the bench, but did not. Last 8 weeks: ${recent.noShows}`)}
      ${tile('Drops', all.drops, all.drops ? 'cell-x' : '', `Pulled out of a raid day after a roster with them was made. Last 8 weeks: ${recent.drops}`)}
      ${tile('Tentative/late', unsure, '', 'Days signed up as tentative or late')}
      ${tile('Parse', p.parse ?? '–')}
    </div>
    <div class="stack"><b>Bench fairness</b>${fairness}</div>
    ${Object.keys(specs).length ? `<div class="stack"><b>Played as</b><div class="row" style="gap:6px">${Object.entries(specs).sort((a, b) => b[1] - a[1]).map(([s, n]) => `<span class="pill">${esc(s)} × ${n}</span>`).join('')}</div></div>` : ''}
    ${p.notes ? `<div class="stack"><b>Notes</b><div class="small">${esc(p.notes)}</div></div>` : ''}
    <div class="stack"><b>Week by week</b>${rows.length ? `<div class="scroll-x"><table><thead><tr><th>Week</th><th>Signups</th><th>Raids</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<div class="small muted">Not in any week yet.</div>'}</div>
    <div class="small muted">Change their settings on the Players tab.</div>
  </div>`;
}

// ---------- Players view ----------
function renderPlayers() {
  if (S.loaded < 3) return loadingHtml();
  const list = Object.entries(S.players).sort((a, b) => (b[1].active !== false) - (a[1].active !== false) || String(a[1].cls).localeCompare(String(b[1].cls)) || charOf(a[0]).localeCompare(charOf(b[0])));
  const rows = list.map(([pid, p]) => `
    <tr${p.active === false ? ' style="opacity:.55"' : ''}>
      <td><span class="who">${classIcon(p.cls, p.main)}<input id="p-char-${pid}" data-act="p-field" data-pid="${pid}" data-f="char" value="${esc(p.char || '')}" maxlength="30" placeholder="Firstname-Lastname" class="w-char" aria-label="Character name">${p.charSource === 'manual' ? '' : '<span class="tag" title="Guessed from the Discord name. Type the real name to confirm it.">guess</span>'}</span></td>
      <td class="muted small discord" title="${esc(p.name || '')}">${esc(p.name || '')}</td>
      <td><select id="p-cls-${pid}" data-act="p-field" data-pid="${pid}" data-f="cls" aria-label="Class"${CLASSES[p.cls] ? '' : ' style="border-color:var(--warn)"'}>${classOptions(p.cls)}</select></td>
      <td><select id="p-main-${pid}" data-act="p-field" data-pid="${pid}" data-f="main" aria-label="Main spec"${CLASSES[p.cls] && CLASSES[p.cls][p.main] ? '' : ' style="border-color:var(--warn)"'}>${specOptions(p.cls, p.main, 'Main…')}</select></td>
      <td><select id="p-off-${pid}" data-act="p-field" data-pid="${pid}" data-f="off" aria-label="Off-spec">${specOptions(p.cls, p.off, 'None')}</select></td>
      <td><select id="p-prio-${pid}" data-act="p-field" data-pid="${pid}" data-f="prio" aria-label="Priority">${[2, 1, 0, -1, -2].map(v => `<option value="${v}" ${Number(p.prio || 0) === v ? 'selected' : ''}>${v > 0 ? '+' + v : v}${v === 0 ? ' normal' : v === -2 ? ' trial' : v === 2 ? ' core' : ''}</option>`).join('')}</select></td>
      <td><input id="p-parse-${pid}" data-act="p-field" data-pid="${pid}" data-f="parse" type="number" min="0" max="100" step="1" value="${p.parse ?? ''}" class="w-parse" aria-label="Average parse"></td>
      <td>${Object.values(CLASSES[p.cls] || {}).includes('Tank') ? `<span class="tankbox">${Object.keys(S.settings.types).sort((x, y) => Number(y) - Number(x)).map(t => `<label><input type="checkbox" id="p-tank-${t}-${pid}" data-act="p-tank" data-pid="${pid}" data-t="${t}" ${isDesignatedTank(p, t) ? 'checked' : ''}>${esc(t)}</label>`).join('')}</span>` : '<span class="muted small">–</span>'}</td>
      <td><input type="checkbox" id="p-nobench-${pid}" data-act="p-field" data-pid="${pid}" data-f="noBench" ${p.noBench ? 'checked' : ''} aria-label="Never bench"></td>
      <td><input type="checkbox" id="p-active-${pid}" data-act="p-field" data-pid="${pid}" data-f="active" ${p.active !== false ? 'checked' : ''} aria-label="Active"></td>
      <td><input id="p-notes-${pid}" data-act="p-field" data-pid="${pid}" data-f="notes" value="${esc(p.notes || '')}" class="w-notes" title="${esc(p.notes || '')}" aria-label="Notes"></td>
      <td><span class="row" style="flex-wrap:nowrap;gap:4px"><button class="sm" data-act="card" data-pid="${pid}" title="Open player card">Card</button>${relWarn(pid)}</span></td>
      <td><button class="ghost danger sm ${S.confirm === 'p-' + pid ? '' : 'icon'}" data-act="p-del" data-pid="${pid}" title="Delete player" aria-label="Delete ${esc(charOf(pid))}">${S.confirm === 'p-' + pid ? 'Confirm' : ICON.x}</button></td>
    </tr>`).join('');
  const noSpec = list.filter(([, p]) => p.active !== false && !(CLASSES[p.cls] && CLASSES[p.cls][p.main])).length;
  return `
    <section class="panel">
      ${panelHead('Players', `Signups add new players automatically. The addon invites by character name (Firstname-Lastname), so check the names.${noSpec ? ` <b>${noSpec} player${noSpec > 1 ? 's have' : ' has'} no class or main spec</b> and can only be planned when they sign up with one.` : ''}`)}
      ${list.length ? `<div class="scroll-x"><table class="ptable"><thead><tr><th>Character</th><th>Discord</th><th>Class</th><th>Main spec</th><th>Off-spec</th><th title="Extra weight when picking DPS spots">Priority</th><th title="Average parse from Warcraft Logs, 0-100">Avg parse</th><th title="Designated tank for these raid sizes: they get the tank spots first">Tanks in</th><th title="Always plays when signed up. Only tank and healer rules can overrule it.">Never bench</th><th>Active</th><th>Notes</th><th title="History, attendance and reliability">Card</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="empty">No players yet. Import a Raid-Helper event on the Week tab, or add players below.</div>'}
      <div class="row">
        <input id="np-char" placeholder="Firstname-Lastname" data-draft="np-char" value="${esc(S.drafts['np-char'] || '')}" maxlength="30" aria-label="New character name">
        <select id="np-cls" data-act="np-cls" aria-label="New player class">${classOptions(S.drafts['np-cls'] || '')}</select>
        <select id="np-main" aria-label="New player main spec">${specOptions(S.drafts['np-cls'] || '', '', 'Main spec…')}</select>
        <button data-act="p-add">Add player</button>
      </div>
      <div class="small muted">Tanks in: tick the raid sizes a player is a set tank for (for example 20 and 10 for main tanks, only 10 for 10-man tanks); they get the tank spots first. Priority +2 is core, -2 is trial. Never bench players always play when they sign up. Inactive players are ignored when planning.</div>
    </section>
    <section class="panel">
      ${panelHead('Warcraft Logs parses', 'Import each character’s average parse from a Warcraft Logs report. This arrives after launch, once there are WoW Forever logs to build it against. Until then, type parses in the Avg parse column above.')}
      <div class="row">
        <input id="wcl-link" placeholder="https://…warcraftlogs.com/reports/…" style="flex:1;min-width:240px" disabled aria-label="Warcraft Logs report link">
        <button disabled title="Not available yet">Import parses</button>
        <span class="pill">Coming after launch</span>
      </div>
    </section>`;
}

// ---------- Attendance view ----------
// What happened to one player in one raid: played, bench, a no-show (planned to play or sit on the bench, but neither), or nothing.
const attendanceCell = attendanceCellOf;

// Each week, each lockout (the 20-man, the pair of 10-mans) is one chance per player:
// played in any of its raids, else bench, else a no-show if they were planned, else absent.
function attendanceStats() {
  const stats = {};
  const ensure = pid => (stats[pid] ||= { raids: 0, present: 0, bench: 0, late: 0, missed: 0 });
  const types = [...new Set(S.settings.raids.map(r => r.type))];
  for (const w of sortedWeeks()) {
    for (const type of types) {
      const rids = S.settings.raids.filter(r => r.type === type && (w.attendance || {})[r.id]).map(r => r.id);
      if (!rids.length) continue;
      for (const [pid, p] of Object.entries(S.players)) {
        if (!p || p.active === false) continue;
        const cells = rids.map(rid => attendanceCell(w, rid, pid));
        const s = ensure(pid);
        s.raids++;
        if (cells.includes('played')) s.present++;
        else if (cells.includes('bench')) s.bench++;
        else if (cells.includes('missed')) s.missed++;
        if (rids.some(rid => (w.attendance[rid].late || []).includes(pid))) s.late++;
      }
    }
  }
  return stats;
}

// In-game names the tool doesn't know yet: pick the player each belongs to.
function renderMatch() {
  const res = S.attPending;
  if (!res) return '';
  const opts = Object.entries(S.players).filter(([, p]) => p && p.active !== false)
    .sort((a, b) => (a[1].charSource === 'manual') - (b[1].charSource === 'manual') || String(a[1].name || a[1].char).localeCompare(String(b[1].name || b[1].char)));
  const rows = res.unknown.map(name => `
    <div class="row"><b style="min-width:150px">${esc(name)}</b><span class="small muted">${esc((res.unknownIn[name] || []).join(', '))}</span>
    <select id="match-${esc(name)}" data-act="match" data-name="${esc(name)}" aria-label="Player for ${esc(name)}"><option value="">Not one of our raiders</option>${opts.map(([pid, p]) => `<option value="${pid}" ${S.drafts['match:' + name] === pid ? 'selected' : ''}>${esc(p.name || p.char)}${p.charSource === 'manual' ? ` (${esc(p.char)})` : ' (no character yet)'}</option>`).join('')}</select></div>`).join('');
  return `<div class="stack" style="border-top:1px solid var(--line);padding-top:14px">
    <b>Match ${res.unknown.length} in-game name${res.unknown.length > 1 ? 's' : ''}</b>
    <div class="sub">These names are not on any player yet. Pick who each one is, and the name is saved as their character, so the addon and future imports know them.</div>
    ${rows}
    <div class="row"><button class="primary" data-act="att-match-save">Save attendance</button><button class="ghost" data-act="att-match-cancel">Cancel</button></div>
  </div>`;
}

// Recent raids with attendance: click a player to switch between played, bench and no-show.
function renderReview() {
  const items = [];
  for (const w of sortedWeeks().slice(0, 3)) {
    for (const def of S.settings.raids) {
      const att = (w.attendance || {})[def.id];
      if (!att) continue;
      const raid = (w.raids || {})[def.id] || {};
      const pids = new Set([...(raid.roster || []).map(e => e.p), ...(raid.bench || []), ...(att.present || []), ...(att.bench || []), ...(att.missed || [])]);
      const groups = { played: [], bench: [], missed: [] };
      for (const pid of pids) { const c = attendanceCell(w, def.id, pid); if (groups[c] && S.players[pid]) groups[c].push(pid); }
      const chip = pid => `<button class="sm" data-act="att-cycle" data-wid="${w.id}" data-rid="${def.id}" data-pid="${pid}" title="Click to change">${who(pid)}</button>`;
      const col = (k, label, cls) => `<div class="stack"><span class="eyebrow ${cls}">${label} · ${groups[k].length}</span><div class="row">${groups[k].sort((a, b) => charOf(a).localeCompare(charOf(b))).map(p => chip(p)).join('') || '<span class="small muted">Nobody</span>'}</div></div>`;
      items.push(`<details ${items.length ? '' : 'open'}><summary><b style="color:var(--fg)">${esc(def.name)}</b> · ${esc(att.date ? fmtDay(att.date) : fmtDay(w.id))} · ${groups.played.length} played, ${groups.bench.length} bench, ${groups.missed.length} no-show${att.source === 'plan' ? ' · from plan' : ''}</summary>
        <div class="stack" style="padding-top:10px">${col('played', 'Played', 'cell-p')}${col('bench', 'Bench', 'cell-b')}${col('missed', 'No-show', 'cell-x')}</div></details>`);
    }
  }
  if (!items.length) return '';
  return `<section class="panel">${panelHead('Check recent raids', 'Click a player to move them between played, bench and no-show, for example a bench player who could not be reached on Discord.')}${items.join('')}</section>`;
}

function renderAttendance() {
  if (S.loaded < 3) return loadingHtml();
  const stats = attendanceStats();
  const ws = sortedWeeks().filter(w => w.attendance && Object.values(w.attendance).some(Boolean)).slice(0, 8).reverse();
  const raidDefs = S.settings.raids;
  const rows = Object.entries(S.players).filter(([, p]) => p && p.active !== false).sort((a, b) => {
    const sa = stats[a[0]] || {}, sb = stats[b[0]] || {};
    const pa = sa.raids ? (sa.present + sa.bench) / sa.raids : -1, pb = sb.raids ? (sb.present + sb.bench) / sb.raids : -1;
    return pb - pa || charOf(a[0]).localeCompare(charOf(b[0]));
  }).map(([pid, p]) => {
    const s = stats[pid] || { raids: 0, present: 0, bench: 0, late: 0, missed: 0 };
    const pct = s.raids ? Math.round(100 * (s.present + s.bench) / s.raids) : null;
    const cells = ws.map(w => `<td class="mono small">${raidDefs.map(d => {
      const cell = attendanceCell(w, d.id, pid);
      if (cell === 'played') return `<span class="cell-p" title="${esc(d.name)}: played">P</span>`;
      if (cell === 'bench') return `<span class="cell-b" title="${esc(d.name)}: bench">B</span>`;
      if (cell === 'missed') return `<span class="cell-x" title="${esc(d.name)}: planned, did not show">✕</span>`;
      if (cell === 'none') return `<span class="cell-n" title="${esc(d.name)}: not in this raid">·</span>`;
      return '';
    }).join(' ')}</td>`).join('');
    return `<tr><td>${cardLink(pid, who(pid))}${relWarn(pid)}</td>
      <td class="num">${pct == null ? '–' : pct + '%'}</td><td><div class="bar"><i style="width:${pct || 0}%"></i></div></td>
      <td class="num">${s.present}</td><td class="num">${s.bench}</td><td class="num">${s.missed}</td><td class="num">${s.late}</td><td class="num">${p.parse ?? '–'}</td>${cells}</tr>`;
  }).join('');
  return `
    <section class="panel">
      ${panelHead('Import attendance', 'After the raid, type <span class="mono">/nproster</span> in game, open Attendance and copy the string. Everyone on the planned bench counts as bench. Mark anyone who was not available on Discord below.')}
      <textarea id="att-in" data-draft="att-in" placeholder="!NPA1!">${esc(S.drafts['att-in'] || '')}</textarea>
      <div class="row"><button class="primary" data-act="att-import">Import attendance</button></div>
      ${renderMatch()}
    </section>
    ${renderReview()}
    <section class="panel">
      ${panelHead('Attendance', `Each week the 20-man and the 10-man lockout count once: played or bench while available counts as attended. P played, B bench, ✕ planned but did not show. Week columns list ${raidDefs.map(d => esc(d.name)).join(', ')} in order.`)}
      ${ws.length ? '' : '<div class="empty">No attendance recorded yet. Import a string from the addon, or record it from the plan on the Week tab.</div>'}
      ${rows ? `<div class="scroll-x"><table><thead><tr><th>Player</th><th class="num">Attend.</th><th></th><th class="num">Played</th><th class="num">Bench</th><th class="num">No-show</th><th class="num">Late</th><th class="num">Parse</th>${ws.map(w => `<th title="${esc(weekSpan(w.id))}">${esc(weekName(w.id).replace('Week ', 'W'))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No players yet.</div>'}
    </section>`;
}

// ---------- Settings view ----------
function renderSettings() {
  const st = S.settings;
  const buffs = st.buffs.map((b, i) => `
    <div class="rule">
      <span class="prio">${i + 1}</span>
      <input id="b-label-${i}" data-act="b-field" data-i="${i}" data-f="label" value="${esc(b.label)}" aria-label="Buff name">
      <select id="b-cls-${i}" data-act="b-field" data-i="${i}" data-f="cls" aria-label="Class">${classOptions(b.cls)}</select>
      <input id="b-specs-${i}" data-act="b-field" data-i="${i}" data-f="specs" value="${esc((b.specs || []).join(', '))}" placeholder="Any spec" title="Comma separated, e.g. Feral, Guardian" aria-label="Specs">
      <input id="b-min-${i}" data-act="b-field" data-i="${i}" data-f="min" type="number" min="1" max="5" value="${b.min || 1}" title="How many of this class are needed" aria-label="Number needed">
      <span class="row" style="flex-wrap:nowrap;gap:2px"><button class="ghost icon sm" data-act="b-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button class="ghost icon sm" data-act="b-down" data-i="${i}" ${i === st.buffs.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button><button class="ghost danger icon sm" data-act="b-del" data-i="${i}" aria-label="Remove">${ICON.x}</button></span>
    </div>`).join('');
  const typeRows = Object.entries(st.types).map(([t, c]) => `
    <tr><td><b>${esc(t)}-man</b></td>${['size', 'tanks', 'healMin', 'healMax', 'healTarget'].map(f => `<td><input id="t-${t}-${f}" data-act="t-field" data-t="${t}" data-f="${f}" type="number" min="0" max="40" value="${c[f]}" style="width:64px" aria-label="${f}"></td>`).join('')}</tr>`).join('');
  const raids = st.raids.map((r, i) => `
    <div class="row"><input id="r-name-${i}" data-act="r-field" data-i="${i}" data-f="name" value="${esc(r.name)}" aria-label="Raid name"><select id="r-type-${i}" data-act="r-field" data-i="${i}" data-f="type" aria-label="Raid size">${Object.keys(st.types).map(t => `<option value="${t}" ${t === r.type ? 'selected' : ''}>${t}-man</option>`).join('')}</select><button class="ghost danger sm" data-act="r-del" data-i="${i}">Remove</button></div>`).join('');
  const W = st.weights;
  const weightInfo = [
    ['fair', 'Bench fairness', 'Per recent bench. Higher gets benched players back in sooner.'],
    ['prio', 'Player priority', 'Per priority step on the Players tab.'],
    ['parse', 'Parse', 'Per parse point. At 2, a 90 parse beats a 40 parse by 100.'],
    ['offspec', 'Off-spec penalty', 'Cost of asking someone to play their off-spec.'],
    ['tentative', 'Tentative penalty', 'Cost of picking someone who signed up tentative.'],
    ['late', 'Late penalty', 'Cost of picking someone who signed up late.'],
    ['benchSignup', 'Signed up as bench', 'Cost of picking someone who signed up as bench.'],
    ['raidBalance', 'Raid balance', 'Cost per buff of difference between raids of the same size, so both 10-mans get about as many buffs. At 1500 it may trade the lowest-priority buff for balance, never a higher one. 0 turns it off.'],
    ['reliability', 'Reliability', 'Per no-show in the last 8 weeks; a drop after the roster was made counts half. Players with 2 or more points get a warning either way. 0 only warns.'],
    ['specSpread', 'Spec spread', 'Cost per extra player of the same spec (the 4th Fury warrior costs 3×). All Mage, Warlock, Hunter and Rogue specs count as one. Makes rosters lean towards a mix when all else is equal. 0 turns it off.'],
  ];
  return `
    <section class="panel">
      ${panelHead('Buff priority', 'Top of the list wins. When signups cannot cover everything, buffs at the bottom are dropped first. A line is covered when the raid has at least “Need” players of that class and spec.')}
      <div class="rule head"><span></span><span>Buff</span><span>Class</span><span>Specs</span><span>Need</span><span></span></div>
      <div class="rules">${buffs}</div>
      <div class="row"><button data-act="b-add">Add buff</button></div>
    </section>
    <div class="two">
      <section class="panel">
        ${panelHead('Raid sizes and roles', 'Tanks includes the off-tank. Healers aim for the target and never go outside min and max.')}
        <div class="scroll-x"><table><thead><tr><th></th><th>Size</th><th>Tanks</th><th>Min heal</th><th>Max heal</th><th>Target</th></tr></thead><tbody>${typeRows}</tbody></table></div>
      </section>
      <section class="panel">
        ${panelHead('Raids each week', 'Raids of the same size share a lockout, so nobody is put in both 10-mans.')}
        <div class="rules">${raids}</div>
        <div class="row"><button data-act="r-add">Add raid</button></div>
        <label class="f">Max raids per day<input id="max-per-day" data-act="s-field" data-f="maxRaidsPerDay" type="number" min="1" max="4" value="${st.maxRaidsPerDay}" style="width:90px"></label>
        <div class="f">Default raid days for new weeks<div class="row">${[3, 4, 5, 6, 0, 1, 2].map(d => `<label class="row small" style="gap:5px;color:var(--fg)"><input type="checkbox" id="dd-${d}" data-act="dd" data-d="${d}" ${st.defaultDays.includes(d) ? 'checked' : ''}>${WEEKDAYS[d].slice(0, 3)}</label>`).join('')}</div></div>
      </section>
    </div>
    <section class="panel">
      ${panelHead('Optimizer weights', 'Roles and buffs always come first. These decide who gets the DPS spots.')}
      <div class="two">${weightInfo.map(([k, l, d]) => `<label class="f">${esc(l)}<input id="w-${k}" data-act="w-field" data-f="${k}" type="number" value="${W[k]}" style="width:110px"><span class="small">${esc(d)}</span></label>`).join('')}</div>
      <div class="row"><button class="danger" data-act="s-reset">${S.confirm === 's-reset' ? 'Confirm reset' : 'Reset all settings to defaults'}</button></div>
    </section>
    <section class="panel">
      ${panelHead('Backup', 'Save everything (players, weeks, attendance, settings) as a file, or put a saved file back. Restoring replaces what is here now for all officers.')}
      <div class="row"><button data-act="backup-save">Save backup</button><label class="btn" for="backup-file">Restore from file…</label><input type="file" id="backup-file" accept=".json,application/json" data-act="backup-file" hidden></div>
      ${S.restore ? `<div class="banner row spread"><span>Backup from ${esc(new Date(S.restore.exportedAt).toLocaleString('en-GB'))}: ${Object.keys(S.restore.players).length} players and ${Object.keys(S.restore.weeks).length} week${Object.keys(S.restore.weeks).length === 1 ? '' : 's'}. Restoring replaces all current data.</span><span class="row"><button class="sm danger" data-act="backup-apply">${S.confirm === 'restore' ? 'Confirm: replace everything' : 'Replace everything'}</button><button class="sm ghost" data-act="backup-cancel">Cancel</button></span></div>` : ''}
    </section>`;
}

// ---------- Backup ----------
async function saveBackup() {
  const data = { app: 'np-roster', version: 1, exportedAt: Date.now(), settings: S.settingsRaw, players: S.players, weeks: S.weeks };
  const json = JSON.stringify(data, null, 1);
  const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
  if (!dl) { toast('Saving files is not available here.'); return; }
  try { await dl.save({ filename: `np-roster-backup-${isoDate(new Date())}.json`, data: json }); }
  catch (e) { if (!e || e.code !== 'declined') toast('Could not save the backup: ' + ((e && e.message) || e)); }
}

function readBackup(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!data || data.app !== 'np-roster' || !data.players || typeof data.players !== 'object' || !data.weeks || typeof data.weeks !== 'object') throw new Error('bad');
      S.restore = data;
    } catch (e) { toast('That file is not an NP Roster backup.'); }
    schedule();
  };
  r.readAsText(file);
}

function applyRestore() {
  const data = S.restore;
  if (!data) return;
  S.restore = null;
  logged('Restored a backup', () => {
    const oldPlayers = Object.keys(S.players), oldWeeks = Object.keys(S.weeks);
    for (const pid of oldPlayers) if (!data.players[pid]) deletePlayer(pid);
    for (const wid of oldWeeks) if (!data.weeks[wid]) deleteWeek(wid);
    for (const [pid, p] of Object.entries(data.players)) if (stable(p) !== stable(S.players[pid])) savePlayer(pid, p);
    for (const [wid, w] of Object.entries(data.weeks)) {
      if (stable(w) === stable(S.weeks[wid])) continue;
      record([{ p: 'w/' + wid, b: S.weeks[wid] || null, a: w }]);
      S.weeks[wid] = w;
      if (S.db) enqueue(() => S.db.doc('weeks/' + wid).set(clone(w)));
    }
    saveSettings(data.settings || clone(DEFAULT_SETTINGS));
  });
  schedule();
  toast('Backup restored.');
}

// ---------- Events ----------
function guard() { if (!S.canWrite) { toast('You have view access, so nothing can be changed.'); return false; } return true; }
function confirmTwice(key) {
  if (S.confirm === key) { S.confirm = null; return true; }
  S.confirm = key; schedule();
  setTimeout(() => { if (S.confirm === key) { S.confirm = null; schedule(); } }, 4000);
  return false;
}

document.addEventListener('click', e => {
  // A click beside the player card closes it.
  if (e.target.id === 'pcard') { S.card = null; schedule(); return; }
  const el = e.target.closest('[data-act]');
  const chip = e.target.closest('.chip');
  if (chip && (!el || !chip.contains(el))) {
    const { rid, pid } = chip.dataset;
    S.sel = S.sel && S.sel.rid === rid && S.sel.pid === pid ? null : { rid, pid };
    schedule();
    return;
  }
  if (!el || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'button') || el.tagName === 'DETAILS') return;
  const a = el.dataset.act;
  const w = week();
  switch (a) {
    case 'new-week': { const sel = document.getElementById('new-week-sel'); if (guard() && sel && sel.value) newWeek(sel.value); break; }
    case 'add-day': {
      if (!guard()) return;
      const d = document.getElementById('add-day-date').value;
      if (!d || resetOf(d) !== w.id) { toast('Pick a date inside this raid week (Wednesday to Tuesday).'); return; }
      saveWeek(w.id, { days: { ['d' + d]: { date: d } } }, `Added ${fmtDay(d)} as a raid day`);
      break;
    }
    case 'remove-day': {
      if (!guard() || !confirmTwice('day-' + el.dataset.day)) return;
      const did = el.dataset.day;
      const raids = {};
      for (const [rid, r] of Object.entries(w.raids || {})) if (r && r.dayId === did) raids[rid] = { dayId: null, pinDay: null, roster: [], groups: [], bench: [], explain: [] };
      saveWeek(w.id, { days: { [did]: null }, signups: { [did]: null }, raids }, `Removed ${fmtDay(w.days[did].date)} as a raid day`);
      break;
    }
    case 'toggle-import': S.importOpen = S.importOpen === el.dataset.day ? null : el.dataset.day; schedule(); break;
    case 'import': if (guard()) importSignups(el.dataset.day); break;
    case 'import-week': if (guard()) importWeek(); break;
    case 'seen-ack': {
      if (!guard()) return;
      const raid = w.raids[el.dataset.rid];
      saveWeek(w.id, { raids: { [el.dataset.rid]: { seen: signupSnapshot(w, raid.dayId) } } }, `Dismissed the signup changes for ${raidDef(el.dataset.rid).name}`);
      break;
    }
    case 'backup-save': saveBackup(); break;
    case 'backup-apply': if (guard() && confirmTwice('restore')) applyRestore(); break;
    case 'backup-cancel': S.restore = null; schedule(); break;
    case 'suggest': suggest(); break;
    case 'goto': { const t = document.getElementById('raid-' + el.dataset.rid); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); break; }
    case 'use-plan': {
      if (!guard()) return;
      const opt = S.suggestions && S.suggestions.list[Number(el.dataset.k)];
      if (!opt) return;
      const wc = clone(w); wc.raids ||= {};
      S.suggestions = null;
      applyRosters(wc, opt.rosters, opt.assign, 'Plan applied. Drag players to adjust; anyone you place stays put on Re-optimize.', 'Applied a suggested plan');
      break;
    }
    case 'unpin-all': {
      if (!guard()) return;
      const raids = {};
      for (const rid of Object.keys(w.raids || {})) if (w.raids[rid]) raids[rid] = { pinDay: null };
      saveWeek(w.id, { raids }, 'Unpinned the raid days');
      break;
    }
    case 'undo': if (guard()) undo(); document.getElementById('toast').hidden = true; break;
    case 'reopt': if (guard()) reoptimize(el.dataset.rid); break;
    case 'clear-locks': {
      if (!guard() || !confirmTwice('locks-' + el.dataset.rid)) return;
      const wc = clone(w);
      wc.raids[el.dataset.rid].locks = {};
      commitRaids(wc, `Cleared officer picks in ${raidDef(el.dataset.rid).name}. Re-optimize to let the optimizer choose.`, `Cleared officer picks in ${raidDef(el.dataset.rid).name}`);
      break;
    }
    case 'regroup': {
      if (!guard()) return;
      const wc = clone(w); const raid = wc.raids[el.dataset.rid];
      raid.groups = makeGroups(raid.roster || [], S.settings.types[raidDef(el.dataset.rid).type].size);
      commitRaids(wc, 'Groups re-sorted.');
      break;
    }
    case 'copy': {
      const ta = document.getElementById(el.dataset.target);
      markPosted();
      const done = () => toast('Copied.');
      const fallback = () => { ta.focus(); ta.select(); toast('Press Ctrl+C to copy.'); };
      try { navigator.clipboard.writeText(ta.value).then(done, fallback); } catch (err) { fallback(); }
      break;
    }
    case 'final': if (guard()) finalizeWeek(); break;
    case 'unfinal': if (guard()) saveWeek(w.id, { status: 'draft' }, 'Reopened the week as a draft'); break;
    case 'del-week': if (guard() && confirmTwice('del-week')) { deleteWeek(w.id); store('week', ''); } break;
    case 'att-from-plan': if (guard()) recordFromPlan(el.dataset.rid); break;
    case 'sel-move': if (guard()) moveChip(S.sel.rid, S.sel.pid, S.sel.rid, el.dataset.zone, null); break;
    case 'sel-close': S.sel = null; schedule(); break;
    case 'p-del': if (guard() && confirmTwice('p-' + el.dataset.pid)) deletePlayer(el.dataset.pid); break;
    case 'card': S.card = el.dataset.pid; schedule(); break;
    case 'card-close': S.card = null; schedule(); break;
    case 'h-undo': if (guard()) undoEntry(el.dataset.id); break;
    case 'h-restore': if (guard() && confirmTwice('rs-' + el.dataset.id)) restoreBefore(el.dataset.id); break;
    case 'log-more': S.logLimit += 200; schedule(); break;
    case 'p-add': {
      if (!guard()) return;
      const char = (S.drafts['np-char'] || '').trim();
      const cls = S.drafts['np-cls'] || '';
      const main = document.getElementById('np-main').value;
      if (!char || !cls) { toast('Enter a character name and class.'); return; }
      savePlayer('m' + Date.now(), { name: '', char, charSource: 'manual', cls, main, off: '', active: true, prio: 0, parse: null, notes: 'Added by hand', createdAt: Date.now() }, `Added ${char} by hand`);
      delete S.drafts['np-char']; delete S.drafts['np-cls'];
      break;
    }
    case 'att-import': {
      if (!guard()) return;
      let res;
      try { res = parseAttendance(S.drafts['att-in'], S.players); } catch (err) { toast(err.message); return; }
      if (!S.weeks[res.weekId]) { toast(`${weekName(res.weekId)} (${weekSpan(res.weekId)}) is not in the tool.`); return; }
      delete S.drafts['att-in'];
      if (res.unknown.length) { S.attPending = res; schedule(); break; }
      saveAttendance(res);
      break;
    }
    case 'att-match-save': if (guard()) saveMatchedAttendance(); break;
    case 'att-match-cancel': S.attPending = null; schedule(); break;
    case 'bench-apply': if (guard()) applyBench(el.dataset.rid); break;
    case 'bench-reset': delete S.benchDraft[el.dataset.rid]; schedule(); break;
    case 'att-cycle': if (guard()) cycleAttendance(el.dataset.wid, el.dataset.rid, el.dataset.pid); break;
    case 'img-copy': copyImage(); markPosted(); break;
    case 'img-save': saveImage(); markPosted(); break;
    case 'b-up': case 'b-down': case 'b-del': case 'b-add': {
      if (!guard()) return;
      const s = settingsCopy(); const i = Number(el.dataset.i); const lbl = (s.buffs[i] || {}).label;
      if (a === 'b-add') s.buffs.push({ id: 'b' + Date.now(), label: 'New buff', cls: 'Warrior', specs: [], min: 1 });
      else if (a === 'b-del') s.buffs.splice(i, 1);
      else { const j = a === 'b-up' ? i - 1 : i + 1; [s.buffs[i], s.buffs[j]] = [s.buffs[j], s.buffs[i]]; }
      saveSettings(s, a === 'b-add' ? 'Added a buff' : `${a === 'b-del' ? 'Removed' : 'Moved'} the buff ${lbl}${a === 'b-up' ? ' up' : a === 'b-down' ? ' down' : ''}`);
      break;
    }
    case 'r-add': case 'r-del': {
      if (!guard()) return;
      const s = settingsCopy();
      const gone = a === 'r-del' ? s.raids[Number(el.dataset.i)].name : '';
      if (a === 'r-add') s.raids.push({ id: 'r' + Date.now(), name: 'New raid', type: '10' });
      else s.raids.splice(Number(el.dataset.i), 1);
      saveSettings(s, a === 'r-add' ? 'Added a raid' : `Removed the raid ${gone}`);
      break;
    }
    case 's-reset': if (guard() && confirmTwice('s-reset')) saveSettings(clone(DEFAULT_SETTINGS), 'Restored the default settings'); break;
    default: break;
  }
});

document.addEventListener('input', e => {
  const k = e.target.dataset && e.target.dataset.draft;
  if (!k) return;
  S.drafts[k] = e.target.value;
  if (k.startsWith('ev-')) {
    // Refresh the "Open event data" link without losing focus.
    const id = eventIdFrom(e.target.value);
    const link = e.target.closest('.day').querySelector('a.btn');
    if (id && !link) schedule();
    else if (link) link.href = `https://raid-helper.xyz/api/event/${id}`;
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  const a = el.dataset && el.dataset.act;
  if (!a) return;
  const w = week();
  if (a === 'pick-week') { S.weekId = el.value; store('week', el.value); S.sel = null; S.suggestions = null; schedule(); return; }
  if (a === 'np-cls') { S.drafts['np-cls'] = el.value; schedule(); return; }
  if (a === 'mentions') { store('mentions', el.checked ? '1' : '0'); schedule(); return; }
  if (a === 'log-filter') { S.drafts[el.dataset.k] = el.value; schedule(); return; }
  if (a === 'match') { S.drafts['match:' + el.dataset.name] = el.value; return; }
  if (a === 'backup-file') { readBackup(el.files && el.files[0]); el.value = ''; return; }
  if (!guard()) { schedule(); return; }
  switch (a) {
    case 'raid-day': {
      const rid = el.dataset.rid;
      const prev = (w.raids || {})[rid] || {};
      const wc = clone(w); wc.raids ||= {};
      wc.raids[rid] = el.value
        ? { ...prev, dayId: el.value, pinDay: el.value, roster: prev.roster || [], groups: prev.groups || [], locks: prev.locks || {} }
        : { ...prev, dayId: null, pinDay: null, roster: [], groups: [], locks: prev.locks || {} };
      if (el.value && !(prev.roster || []).length) {
        const def = raidDef(rid);
        const defs = S.settings.raids.filter(r => r.type === def.type && wc.raids[r.id] && wc.raids[r.id].dayId);
        const res = optimizeType(defs.map(d => ({ rid: d.id, dayId: wc.raids[d.id].dayId, locks: wc.raids[d.id].locks || {} })), S.settings.types[def.type], { ...ctx(), week: wc, type: def.type });
        applyRosters(wc, res.rosters, null, null, `Put ${def.name} on ${fmtDay(wc.days[el.value].date)}`);
      } else commitRaids(wc, el.value && (prev.roster || []).length && prev.dayId !== el.value ? 'Day changed. Press Re-optimize to rebuild the roster from that day\'s signups.' : null,
        el.value ? `Moved ${raidDef(rid).name} to ${fmtDay(wc.days[el.value].date)}` : `Took ${raidDef(rid).name} off the schedule`);
      break;
    }
    case 'sel-spec': setSpec(S.sel.rid, S.sel.pid, Number(el.value)); break;
    case 'note': {
      const k = el.dataset.k, v = el.value.trim();
      if (v === ((w.notes || {})[k] || '')) break;
      saveWeek(w.id, { notes: { [k]: v } }, k === 'week' ? 'Changed the week note' : `Changed the note for ${raidDef(k).name}`);
      break;
    }
    case 'set-st': el.className = `stsel sd-${el.value}`; setStatus(el.dataset.day, el.dataset.pid, el.value); break;
    case 'bench-toggle': {
      const rid = el.dataset.rid;
      const bc = benchCandidates(w, rid, S.settings, S.players, S.weeks);
      const set = S.benchDraft[rid] || new Set(bc.rows.filter(r => !r.entry).map(r => r.p));
      if (el.checked) set.add(el.dataset.pid); else set.delete(el.dataset.pid);
      // Back to the current bench means nothing to apply.
      const current = bc.rows.filter(r => !r.entry).map(r => r.p);
      if (set.size === current.length && current.every(p => set.has(p))) delete S.benchDraft[rid];
      else S.benchDraft[rid] = set;
      schedule();
      break;
    }
    case 'sel-lock': setLock(S.sel.rid, S.sel.pid, el.value); break;
    case 'p-tank': {
      const p = clone(S.players[el.dataset.pid]);
      const set = new Set(Array.isArray(p.tankFor) ? p.tankFor : []);
      if (el.checked) set.add(el.dataset.t); else set.delete(el.dataset.t);
      p.tankFor = [...set].sort();
      savePlayer(el.dataset.pid, p, `${el.checked ? 'Set' : 'Removed'} ${charOf(el.dataset.pid)} as ${el.dataset.t}-man tank`);
      break;
    }
    case 'p-field': {
      const pid = el.dataset.pid, f = el.dataset.f;
      const p = clone(S.players[pid]);
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (f === 'prio') v = Number(v);
      if (f === 'parse') v = v === '' ? null : Math.max(0, Math.min(100, Number(v)));
      if (f === 'char') { v = String(v).trim(); p.charSource = 'manual'; }
      p[f] = v;
      if (f === 'cls') { if (!CLASSES[v] || !CLASSES[v][p.main]) p.main = ''; if (!CLASSES[v] || !CLASSES[v][p.off]) p.off = ''; }
      if (f === 'parse') p.parseUpdated = Date.now();
      const FIELD = { char: 'character name', cls: 'class', main: 'main spec', off: 'off-spec', prio: 'priority', parse: 'parse', notes: 'notes', active: 'active', noBench: 'never bench' };
      savePlayer(pid, p, `Changed ${charOf(pid)}: ${FIELD[f] || f}${typeof v === 'boolean' ? (v ? ' on' : ' off') : f === 'notes' ? '' : ` to ${v === null || v === '' ? 'nothing' : v}`}`);
      break;
    }
    case 'b-field': {
      const s = settingsCopy(); const b = s.buffs[Number(el.dataset.i)]; const f = el.dataset.f;
      if (f === 'specs') b.specs = el.value.split(',').map(x => capFirst(x.trim())).filter(Boolean);
      else if (f === 'min') b.min = Math.max(1, Number(el.value) || 1);
      else b[f] = el.value;
      saveSettings(s, `Changed the buff ${b.label}`);
      break;
    }
    case 't-field': { const s = settingsCopy(); s.types[el.dataset.t][el.dataset.f] = Math.max(0, Number(el.value) || 0); saveSettings(s, `Set ${el.dataset.t}-man ${el.dataset.f} to ${s.types[el.dataset.t][el.dataset.f]}`); break; }
    case 'r-field': { const s = settingsCopy(); const r = s.raids[Number(el.dataset.i)]; const was = r.name; r[el.dataset.f] = el.value; saveSettings(s, el.dataset.f === 'name' ? `Renamed the raid ${was} to ${el.value}` : `Changed the raid ${r.name}`); break; }
    case 'w-field': { const s = settingsCopy(); s.weights[el.dataset.f] = Number(el.value) || 0; saveSettings(s, `Set the weight ${el.dataset.f} to ${s.weights[el.dataset.f]}`); break; }
    case 's-field': { const s = settingsCopy(); s[el.dataset.f] = Math.max(1, Number(el.value) || 1); saveSettings(s, `Set ${el.dataset.f} to ${s[el.dataset.f]}`); break; }
    case 'dd': {
      const s = settingsCopy(); const d = Number(el.dataset.d);
      s.defaultDays = el.checked ? [...new Set([...s.defaultDays, d])] : s.defaultDays.filter(x => x !== d);
      saveSettings(s, `${el.checked ? 'Added' : 'Removed'} ${WEEKDAYS[d]} as a default raid day`);
      break;
    }
    default: break;
  }
});

document.addEventListener('toggle', e => {
  if (e.target.dataset && e.target.dataset.act === 'av-toggle') store('av-open', e.target.open ? '1' : '0');
  if (e.target.dataset && e.target.dataset.act === 'decide-toggle') S.decideOpen[e.target.dataset.rid] = e.target.open;
}, true);

document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (e.key === 'Escape' && S.card) { S.card = null; schedule(); return; }
  if (e.key === 'Escape' && S.sel) { S.sel = null; schedule(); }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing && S.view === 'week') { e.preventDefault(); if (guard()) undo(); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.chip')) { e.preventDefault(); e.target.click(); }
});

// Drag and drop between groups, the bench and the other raids.
let drag = null;
document.addEventListener('dragstart', e => {
  const chip = e.target.closest && e.target.closest('.chip');
  if (!chip) return;
  drag = { pid: chip.dataset.pid, rid: chip.dataset.rid };
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', chip.dataset.pid); } catch (err) { /* some browsers */ }
});
document.addEventListener('dragover', e => {
  const zone = e.target.closest && e.target.closest('.zone');
  if (!zone || !drag) return;
  e.preventDefault();
  document.querySelectorAll('.zone.over').forEach(z => z !== zone && z.classList.remove('over'));
  zone.classList.add('over');
});
document.addEventListener('dragleave', e => {
  const zone = e.target.closest && e.target.closest('.zone');
  if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('over');
});
document.addEventListener('drop', e => {
  const zone = e.target.closest && e.target.closest('.zone');
  document.querySelectorAll('.zone.over').forEach(z => z.classList.remove('over'));
  if (!zone || !drag) return;
  e.preventDefault();
  const target = e.target.closest('.chip');
  if (guard()) moveChip(drag.rid, drag.pid, zone.dataset.rid, zone.dataset.zone, target ? target.dataset.pid : null);
  drag = null;
});
document.addEventListener('dragend', () => { drag = null; document.querySelectorAll('.zone.over').forEach(z => z.classList.remove('over')); });

// Tabs follow the URL hash so each view can be linked.
function readHash() {
  const h = (location.hash || '').slice(1);
  S.view = ['week', 'players', 'attendance', 'log', 'settings'].includes(h) ? h : 'week';
  schedule();
}
window.addEventListener('hashchange', readHash);
document.getElementById('tabs').addEventListener('click', e => {
  const a = e.target.closest('a[data-v]');
  if (!a) return;
  e.preventDefault();
  S.view = a.dataset.v;
  try { history.replaceState(null, '', '#' + S.view); } catch (err) { /* sandboxed */ }
  schedule();
});

readHash();
connect();
