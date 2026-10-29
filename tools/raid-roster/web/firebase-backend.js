// Runs NP Roster on Firebase instead of a claude.ai artifact. Officers sign in with Google, and each
// raid team's data lives in Firestore under teams/<team>/. It offers the same window.claude.use()
// that the artifact runtime gives (db, user, downloads), so app.js runs unchanged.
(function () {
  const firebase = window.firebase;
  firebase.initializeApp(window.NP_FIREBASE_CONFIG);
  const auth = firebase.auth();
  const fs = firebase.firestore();
  fs.settings({ ignoreUndefinedProperties: true });

  // ---------- Data encoding ----------
  // Firestore cannot store an array inside an array (the tool keeps groups as lists of lists), so an
  // inner array is stored as {__arr: [...]} and turned back on the way out.
  const ARR = '__arr';
  function enc(v, inArray) {
    if (Array.isArray(v)) { const a = v.map(x => enc(x, true)); return inArray ? { [ARR]: a } : a; }
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = enc(x, false);
      return o;
    }
    return v;
  }
  function dec(v) {
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === ARR && Array.isArray(v[ARR])) return dec(v[ARR]);
      const o = {};
      for (const k of keys) o[k] = dec(v[k]);
      return o;
    }
    return v;
  }

  // ---------- Database (the artifact db API on top of Firestore) ----------
  let base = '';
  const wrapDoc = d => ({ id: d.id, exists: d.exists, data: () => (d.exists ? dec(d.data()) : undefined) });
  const wrapQuery = s => ({ docs: s.docs.map(wrapDoc), size: s.size, empty: s.empty });
  function query(ref) {
    return {
      where: (f, op, v) => query(ref.where(f, op, v)),
      orderBy: (f, dir) => query(ref.orderBy(f, dir)),
      limit: n => query(ref.limit(n)),
      get: async () => wrapQuery(await ref.get()),
      onSnapshot: (next, err) => ref.onSnapshot(s => next(wrapQuery(s)), err),
    };
  }
  function docRef(path) {
    const ref = fs.doc(base + path);
    return {
      id: ref.id, path,
      get: async () => wrapDoc(await ref.get()),
      set: d => ref.set(enc(d)),
      // Like the artifact database: objects merge field by field, arrays and other values replace.
      update: d => ref.set(enc(d), { merge: true }),
      delete: () => ref.delete(),
      onSnapshot: (next, err) => ref.onSnapshot(d => next(wrapDoc(d)), err),
    };
  }
  const db = {
    doc: docRef,
    collection: path => ({ ...query(fs.collection(base + path)), doc: id => docRef(path + '/' + id) }),
  };

  // ---------- Who is signed in ----------
  let me = null, role = null;
  const names = {};
  const user = {
    id: async () => me.uid,
    me: async () => ({ id: me.uid, name: names[me.uid] || '' }),
    isOwner: async () => false,
    canEdit: async () => role === 'officer',
    can: async name => (name === 'data.write' ? role === 'officer' : null),
    profiles: async ids => {
      const out = {};
      await Promise.all([].concat(ids).map(async id => {
        if (!(id in names)) {
          try { const d = await fs.doc(base + 'members/' + id).get(); names[id] = (d.exists && d.data().name) || ''; } catch (e) { names[id] = ''; }
        }
        out[id] = { id, name: names[id] };
      }));
      return out;
    },
  };

  const downloads = {
    save: async ({ filename, data }) => {
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { status: 'saved' };
    },
  };

  // ---------- Sign-in and team choice ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = (k, v) => { try { localStorage.setItem('npr.' + k, v); } catch (e) { /* storage blocked */ } };
  const load = k => { try { return localStorage.getItem('npr.' + k); } catch (e) { return null; } };
  let gate;
  function show(html) {
    if (!gate) {
      gate = document.createElement('div');
      gate.className = 'np-gate';
      document.body.appendChild(gate);
    }
    gate.innerHTML = `<div class="np-card"><img src="icons/emblem.png" alt="" width="64" height="57"><h1>NP Roster</h1>${html}</div>`;
    gate.hidden = false;
  }
  const hide = () => { if (gate) gate.hidden = true; };

  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });

  // access/<e-mail> lists the person's teams and role in each (see firestore.rules).
  async function teamsFor(email) {
    const acc = await fs.doc('access/' + email).get();
    const roles = (acc.exists && acc.data().teams) || {};
    const teams = await Promise.all(Object.entries(roles).filter(([, r]) => r === 'officer' || r === 'viewer').map(async ([id, r]) => {
      const t = await fs.doc('teams/' + id).get();
      return { id, name: (t.exists && t.data().name) || id, role: r };
    }));
    return teams.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function chooseTeam(teams) {
    const wanted = new URLSearchParams(location.search).get('team') || load('team');
    const hit = teams.find(t => t.id === wanted) || (teams.length === 1 ? teams[0] : null);
    if (hit) return hit;
    return new Promise(res => {
      show(`<p>Pick your raid team.</p><div class="np-teams">${teams.map(t => `<button data-team="${esc(t.id)}">${esc(t.name)}</button>`).join('')}</div>`);
      gate.querySelectorAll('[data-team]').forEach(b => b.addEventListener('click', () => res(teams.find(t => t.id === b.dataset.team))));
    });
  }

  // The name other officers see in the log. Asked once per team, never taken from the Google account.
  async function ensureName(team) {
    const ref = fs.doc(`teams/${team.id}/members/${me.uid}`);
    const d = await ref.get();
    if (d.exists && d.data().name) { names[me.uid] = d.data().name; return; }
    const name = await new Promise(res => {
      show(`<p>Which name should the other officers see in the log? Your Discord or character name works well.</p>
        <form class="np-name"><input id="np-name" maxlength="32" required placeholder="e.g. Darkfade" autocomplete="nickname"><button class="primary" type="submit">Continue</button></form>`);
      const form = gate.querySelector('form');
      form.addEventListener('submit', e => { e.preventDefault(); const v = form.querySelector('input').value.trim(); if (v) res(v); });
      gate.querySelector('input').focus();
    });
    await ref.set({ name, at: Date.now() });
    names[me.uid] = name;
  }

  function addHeaderButtons(teams) {
    const theme = document.getElementById('theme-btn');
    if (!theme || document.getElementById('np-signout')) return;
    const html = (teams.length > 1 ? '<button class="ghost sm" id="np-switch" type="button">Switch team</button>' : '')
      + '<button class="ghost sm" id="np-signout" type="button">Sign out</button>';
    theme.insertAdjacentHTML('beforebegin', html);
    const sw = document.getElementById('np-switch');
    if (sw) sw.addEventListener('click', () => { store('team', ''); location.search = ''; });
    document.getElementById('np-signout').addEventListener('click', () => auth.signOut().then(() => { store('team', ''); location.search = ''; }));
  }

  async function start(u) {
    me = u;
    const email = String(u.email || '').toLowerCase();
    let teams;
    try { teams = await teamsFor(email); } catch (e) { teams = []; }
    if (!teams.length) {
      show(`<p>${esc(email)} is not on any raid team yet. Ask the officer who runs NP Roster to add this address.</p><button id="np-out">Sign out</button>`);
      gate.querySelector('#np-out').addEventListener('click', () => auth.signOut());
      return;
    }
    const team = await chooseTeam(teams);
    store('team', team.id);
    if (new URLSearchParams(location.search).get('team') !== team.id) history.replaceState(null, '', '?team=' + encodeURIComponent(team.id) + location.hash);
    base = `teams/${team.id}/`;
    role = team.role;
    await ensureName(team);
    hide();
    addHeaderButtons(teams);
    resolveReady();
  }

  let started = false;
  // This script runs in <head>; the sign-in screen needs the page first.
  const domReady = new Promise(r => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r, { once: true }) : r()));
  domReady.then(() => auth.onAuthStateChanged(u => {
    if (u && !started) { started = true; start(u).catch(e => show(`<p>Something went wrong: ${esc(e.message || e)}</p>`)); return; }
    if (!u) {
      if (started) { location.reload(); return; }
      show(`<p>Sign in with the Google account your officers added to the team.</p><button class="primary" id="np-in">Sign in with Google</button>`);
      gate.querySelector('#np-in').addEventListener('click', () => {
        auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(e => {
          if (e && e.code === 'auth/popup-closed-by-user') return;
          show(`<p>Sign-in failed: ${esc((e && (e.message || e.code)) || e)}</p><button id="np-retry">Try again</button>`);
          gate.querySelector('#np-retry').addEventListener('click', () => location.reload());
        });
      });
    }
  }));

  window.claude = {
    use: async name => {
      await ready;
      return name === 'db' ? db : name === 'user' ? user : name === 'downloads' ? downloads : null;
    },
  };
  window.__npEncode = { enc, dec };
})();
