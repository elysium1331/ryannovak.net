/* =================================================================
   ARENA — shared identity + standings library for the Olympus Arcade
   ryannovak.net

   What it does:
   - Assigns each browser (with cookies enabled) an anonymous token,
     stored in a cookie for one year.
   - Derives a stable, readable mythological name from that token
     (epithet + mortal hero, e.g. "Swift Atalanta").
   - Stores each player's best score per game in localStorage,
     namespaced by month — standings clear on the 1st of every month.
   - Merges local players with "immortals": seeded house entries
     (the Olympian gods) that set the pace each month.

   API (everything hangs off window.Arena):
     Arena.identity                -> {token, name} | null (cookies off)
     Arena.submitScore(gameId, v)  -> {improved, best, rank, board} | null
     Arena.bestOf(gameId)          -> best value this month | null
     Arena.board(gameId)           -> ranked rows (immortals + players)
     Arena.renderBoard(el, gameId) -> renders standings into an element
     Arena.formatValue(gameId, v)  -> display string for a score
     Arena.monthLabel()            -> "JULY 2026"
     Arena.nextResetLabel()        -> "AUG 1"
   A topbar element with [data-arena-chip] is auto-filled with
   "PLAYING AS <NAME>".
   ================================================================= */

(() => {
  'use strict';

  // --------------------------------------------------------------
  // Game registry
  // dir: 'asc'  -> lower is better (times)
  //      'desc' -> higher is better (rounds)
  // immortals: [lo, hi] score range the gods post each month
  // --------------------------------------------------------------
  const GAMES = {
    eclipse:   { name: 'ECLIPSE',   dir: 'asc',  kind: 'time',   immortals: [48, 360] },
    olympus:   { name: 'OLYMPUS',   dir: 'asc',  kind: 'time',   immortals: [65, 420] },
    labyrinth: { name: 'LABYRINTH', dir: 'asc',  kind: 'time',   immortals: [30, 300] },
    echo:      { name: 'ECHO',      dir: 'desc', kind: 'rounds', immortals: [4, 15]  },
    pantheon:  { name: 'PANTHEON',  dir: 'asc',  kind: 'time',   immortals: [55, 380] },
    mosaic:    { name: 'MOSAIC',    dir: 'asc',  kind: 'time',   immortals: [70, 430] },
    quiver:    { name: 'QUIVER',    dir: 'asc',  kind: 'time',   immortals: [35, 280] }
  };

  const IMMORTALS = [
    'Zeus', 'Hera', 'Poseidon', 'Athena', 'Apollo', 'Artemis',
    'Hermes', 'Ares', 'Aphrodite', 'Hephaestus', 'Demeter', 'Dionysus',
    'Hades', 'Persephone', 'Nike', 'Helios', 'Selene', 'Eos', 'Iris', 'Pan'
  ];
  const IMMORTALS_PER_BOARD = 7;

  // Mortal names for real players: epithet + hero, derived from token
  const EPITHETS = [
    'Swift', 'Radiant', 'Thunderous', 'Cunning', 'Golden', 'Stormborn',
    'Silver-Tongued', 'Iron-Willed', 'Startouched', 'Winedark', 'Bronze',
    'Untamed', 'Farseeing', 'Moonlit', 'Sunkissed', 'Waveborn',
    'Fleet-Footed', 'Owl-Eyed', 'Rosy-Fingered', 'Honeyvoiced',
    'Titanhearted', 'Laurel-Crowned', 'Amber-Eyed', 'Restless'
  ];
  const HEROES = [
    'Achilles', 'Odysseus', 'Perseus', 'Theseus', 'Atalanta', 'Penelope',
    'Ariadne', 'Cassandra', 'Icarus', 'Daedalus', 'Orion', 'Circe',
    'Calypso', 'Medusa', 'Chiron', 'Heracles', 'Jason', 'Hektor',
    'Andromeda', 'Antigone', 'Orpheus', 'Eurydice', 'Pandora', 'Prometheus',
    'Sisyphus', 'Tantalus', 'Narcissus', 'Midas', 'Leonidas', 'Hypatia',
    'Ajax', 'Nestor'
  ];

  const COOKIE_NAME = 'arena_id';
  const STORE_KEY = 'arena.v1';
  const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY',
                  'AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const MONTHS_SHORT = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

  // --------------------------------------------------------------
  // Small utilities
  // --------------------------------------------------------------
  const fnv1a = str => {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };

  // Deterministic PRNG (mulberry32) for seeding immortal scores
  const mulberry32 = seed => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const monthKey = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  };

  const monthLabel = () => {
    const d = new Date();
    return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  };

  const nextResetLabel = () => {
    const d = new Date();
    return MONTHS_SHORT[(d.getMonth() + 1) % 12] + ' 1';
  };

  const formatValue = (gameId, v) => {
    const g = GAMES[gameId];
    if (!g) return String(v);
    if (g.kind === 'time') {
      const total = Math.round(v);
      const m = Math.floor(total / 60);
      const s = total % 60;
      return m + ':' + String(s).padStart(2, '0');
    }
    return Math.round(v) + (Math.round(v) === 1 ? ' ROUND' : ' ROUNDS');
  };

  const better = (dir, a, b) => (dir === 'asc' ? a < b : a > b);

  // --------------------------------------------------------------
  // Identity: anonymous cookie token -> stable mythological name
  // --------------------------------------------------------------
  const readCookie = name => {
    const m = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
    return m ? decodeURIComponent(m[1]) : null;
  };

  const writeCookie = (name, value) => {
    document.cookie = name + '=' + encodeURIComponent(value) +
      '; max-age=31536000; path=/; SameSite=Lax';
  };

  const cookiesWork = () => {
    if (!navigator.cookieEnabled) return false;
    try {
      document.cookie = 'arena_probe=1; max-age=60; path=/; SameSite=Lax';
      const ok = document.cookie.indexOf('arena_probe=1') !== -1;
      document.cookie = 'arena_probe=; max-age=0; path=/';
      return ok;
    } catch (e) { return false; }
  };

  const nameFor = token => {
    const h = fnv1a(token);
    const epithet = EPITHETS[h % EPITHETS.length];
    const hero = HEROES[Math.floor(h / EPITHETS.length) % HEROES.length];
    return epithet + ' ' + hero;
  };

  const makeToken = () => {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'a-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 12);
  };

  let identity = null;
  if (cookiesWork()) {
    let token = readCookie(COOKIE_NAME);
    if (!token) {
      token = makeToken();
    }
    writeCookie(COOKIE_NAME, token); // refresh expiry on every visit
    identity = { token, name: nameFor(token) };
  }

  // --------------------------------------------------------------
  // Storage: best score per player per game, current month only.
  // Shape: { month: 'YYYY-MM',
  //          players: { token: { name, scores: { gameId: {best, plays, at} } } } }
  // Loading in a new month wipes scores -> standings reset on the 1st.
  // --------------------------------------------------------------
  const loadStore = () => {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { /* corrupt */ }
    if (!data || typeof data !== 'object' || !data.players) {
      data = { month: monthKey(), players: {} };
    }
    if (data.month !== monthKey()) {
      data = { month: monthKey(), players: {} }; // monthly reset
    }
    return data;
  };

  const saveStore = data => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* full/blocked */ }
  };

  // --------------------------------------------------------------
  // Immortals: deterministic house entries per game per month
  // --------------------------------------------------------------
  const immortalsFor = gameId => {
    const g = GAMES[gameId];
    if (!g) return [];
    const rand = mulberry32(fnv1a(gameId + '|' + monthKey()));
    const pool = IMMORTALS.slice();
    const picked = [];
    for (let i = 0; i < IMMORTALS_PER_BOARD && pool.length; i++) {
      picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    }
    const [lo, hi] = g.immortals;
    return picked.map(name => {
      // log-uniform spread: a couple of sharp gods, a long tail
      const v = lo * Math.pow(hi / lo, rand());
      return {
        name,
        value: g.kind === 'rounds' ? Math.max(lo, Math.round(v)) : Math.round(v),
        immortal: true
      };
    });
  };

  // --------------------------------------------------------------
  // Scores + standings
  // --------------------------------------------------------------
  const bestOf = gameId => {
    if (!identity) return null;
    const store = loadStore();
    const p = store.players[identity.token];
    const s = p && p.scores && p.scores[gameId];
    return s ? s.best : null;
  };

  const board = gameId => {
    const g = GAMES[gameId];
    if (!g) return [];
    const store = loadStore();
    const rows = immortalsFor(gameId);
    for (const token in store.players) {
      const p = store.players[token];
      const s = p.scores && p.scores[gameId];
      if (!s) continue;
      rows.push({
        name: p.name,
        value: s.best,
        immortal: false,
        you: !!(identity && token === identity.token)
      });
    }
    rows.sort((a, b) => (g.dir === 'asc' ? a.value - b.value : b.value - a.value));
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  };

  const submitScore = (gameId, value) => {
    const g = GAMES[gameId];
    if (!g || !identity || typeof value !== 'number' || !isFinite(value)) return null;
    value = g.kind === 'rounds' ? Math.round(value) : Math.round(value * 10) / 10;
    const store = loadStore();
    const p = store.players[identity.token] ||
      (store.players[identity.token] = { name: identity.name, scores: {} });
    p.name = identity.name;
    const s = p.scores[gameId];
    let improved = false;
    if (!s) {
      p.scores[gameId] = { best: value, plays: 1, at: Date.now() };
      improved = true;
    } else {
      s.plays += 1;
      if (better(g.dir, value, s.best)) {
        s.best = value;
        s.at = Date.now();
        improved = true;
      }
    }
    saveStore(store);
    const rows = board(gameId);
    const mine = rows.find(r => r.you);
    return {
      improved,
      best: p.scores[gameId].best,
      rank: mine ? mine.rank : null,
      board: rows
    };
  };

  // --------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const renderBoard = (container, gameId) => {
    const g = GAMES[gameId];
    if (!container || !g) return;
    container.innerHTML = '';

    const wrap = el('div', 'arena-board');
    const head = el('div', 'arena-board-head');
    head.appendChild(el('span', null, 'MOUNT OLYMPUS — ' + monthLabel()));
    head.appendChild(el('span', 'arena-board-game', g.name));
    wrap.appendChild(head);

    if (!identity) {
      wrap.appendChild(el('p', 'arena-note',
        'Cookies are off, so the Fates cannot remember you. Enable cookies to claim a name and enter the standings.'));
    }

    const rows = board(gameId);
    const list = el('ol', 'arena-rows');
    const MAX_ROWS = 10;
    const visible = rows.slice(0, MAX_ROWS);
    const mine = rows.find(r => r.you);
    const mineHidden = mine && mine.rank > MAX_ROWS;

    const addRow = r => {
      const li = el('li', 'arena-row' + (r.you ? ' you' : '') + (r.immortal ? ' immortal' : ''));
      li.appendChild(el('span', 'arena-rank', String(r.rank).padStart(2, '0')));
      const name = el('span', 'arena-name', r.name);
      if (r.immortal) name.appendChild(el('em', 'arena-tag', 'IMMORTAL'));
      if (r.you) name.appendChild(el('em', 'arena-tag arena-tag-you', 'YOU'));
      li.appendChild(name);
      li.appendChild(el('span', 'arena-score', formatValue(gameId, r.value)));
      list.appendChild(li);
    };

    visible.forEach(addRow);
    if (mineHidden) {
      list.appendChild(el('li', 'arena-row arena-gap', '···'));
      addRow(mine);
    }
    wrap.appendChild(list);

    wrap.appendChild(el('div', 'arena-board-foot',
      'Standings reset ' + nextResetLabel() + ' · Immortals set the pace — outscore them.'));
    container.appendChild(wrap);
  };

  const mountChips = () => {
    document.querySelectorAll('[data-arena-chip]').forEach(node => {
      node.classList.add('arena-chip');
      node.innerHTML = '';
      if (identity) {
        node.appendChild(el('span', 'arena-chip-label', 'PLAYING AS'));
        node.appendChild(el('strong', 'arena-chip-name', identity.name));
      } else {
        node.appendChild(el('span', 'arena-chip-label arena-chip-off', 'COOKIES OFF · SCORES NOT SAVED'));
      }
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountChips);
  } else {
    mountChips();
  }

  // --------------------------------------------------------------
  // Public surface
  // --------------------------------------------------------------
  window.Arena = {
    identity,
    games: GAMES,
    submitScore,
    bestOf,
    board,
    renderBoard,
    formatValue,
    monthLabel,
    nextResetLabel
  };
})();
