// A stand-in for the Firebase compat SDK, for testing firebase-backend.js without a Firebase project
// (build.py --fake). Data lives in localStorage; it refuses nested arrays and undefined like Firestore.
(function () {
  const KEY = 'fakeFirestore';
  const clone = o => JSON.parse(JSON.stringify(o));
  let store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { store = {}; }
  // A first visit gets one team the fake account is an officer of.
  if (!Object.keys(store).length) store = { 'access/officer@example.com': { teams: { demo: 'officer' } }, 'teams/demo': { name: 'Demo' } };
  const subs = new Set();
  const persist = () => { localStorage.setItem(KEY, JSON.stringify(store)); for (const f of subs) setTimeout(f, 0); };
  let ignoreUndefined = false;
  function check(v, inArray, path) {
    if (v === undefined && !ignoreUndefined) throw new Error('Unsupported field value: undefined at ' + path);
    if (Array.isArray(v)) { if (inArray) throw new Error('Nested arrays are not supported at ' + path); v.forEach((x, i) => check(x, true, path + '.' + i)); }
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) check(x, false, path + '.' + k);
  }
  const strip = v => JSON.parse(JSON.stringify(v));
  function merge(t, p) {
    for (const [k, v] of Object.entries(p)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) merge(t[k], v);
      else t[k] = v;
    }
    return t;
  }
  const docSnap = path => {
    const has = Object.prototype.hasOwnProperty.call(store, path);
    const data = has ? clone(store[path]) : undefined;
    return { id: path.split('/').pop(), exists: has, data: () => data };
  };
  const tick = () => new Promise(r => setTimeout(r, window.__fakeDelay || 20));
  function doc(path) {
    return {
      id: path.split('/').pop(),
      async get() { await tick(); return docSnap(path); },
      async set(d, opts) { check(d, false, path); await tick(); store[path] = opts && opts.merge && store[path] ? merge(clone(store[path]), strip(d)) : strip(d); persist(); },
      async delete() { await tick(); delete store[path]; persist(); },
      onSnapshot(next) { const f = () => next(docSnap(path)); subs.add(f); setTimeout(f, 0); return () => subs.delete(f); },
    };
  }
  const OPS = { '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '==': (a, b) => a === b, 'array-contains': (a, b) => Array.isArray(a) && a.includes(b) };
  function coll(path, q = { where: [], order: null, limit: 0 }) {
    const run = () => {
      const depth = path.split('/').length + 1;
      let docs = Object.keys(store).filter(k => k.startsWith(path + '/') && k.split('/').length === depth).map(docSnap);
      for (const [f, op, v] of q.where) docs = docs.filter(d => OPS[op](d.data()[f], v));
      if (q.order) docs.sort((a, b) => (a.data()[q.order[0]] > b.data()[q.order[0]] ? 1 : -1) * (q.order[1] === 'desc' ? -1 : 1));
      if (q.limit) docs = docs.slice(0, q.limit);
      return { docs, size: docs.length, empty: !docs.length };
    };
    return {
      where: (f, op, v) => coll(path, { ...q, where: q.where.concat([[f, op, v]]) }),
      orderBy: (f, dir) => coll(path, { ...q, order: [f, dir] }),
      limit: n => coll(path, { ...q, limit: n }),
      async get() { await tick(); return run(); },
      onSnapshot(next) { const f = () => next(run()); subs.add(f); setTimeout(f, 0); return () => subs.delete(f); },
      doc: id => doc(path + '/' + id),
    };
  }
  const firestore = { settings: s => { ignoreUndefined = !!s.ignoreUndefinedProperties; }, doc, collection: coll };

  const authSubs = [];
  let current = JSON.parse(localStorage.getItem('fakeUser') || 'null');
  const auth = {
    get currentUser() { return current; },
    onAuthStateChanged(f) { authSubs.push(f); setTimeout(() => f(current), 0); },
    async signInWithPopup() { current = window.__fakeAccount || { uid: 'u_test', email: 'officer@example.com' }; localStorage.setItem('fakeUser', JSON.stringify(current)); authSubs.forEach(f => f(current)); },
    async signOut() { current = null; localStorage.removeItem('fakeUser'); authSubs.forEach(f => f(null)); },
  };
  function GoogleAuthProvider() {}
  window.firebase = {
    initializeApp: () => ({}),
    auth: Object.assign(() => auth, { GoogleAuthProvider }),
    firestore: () => firestore,
  };
  window.__fake = { get store() { return store; }, reset(s) { store = s || {}; persist(); } };
})();
