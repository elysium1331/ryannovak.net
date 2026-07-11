/* =================================================================
   OLYMPUS — one bolt per realm
   A Queens-style placement puzzle for the Olympus Arcade.
   Pure logic (generator / solver / validator) is exported for
   headless testing; the DOM shell below only runs in a browser.
   ================================================================= */
(() => {
  'use strict';

  // ----------------------------------------------------------------
  // Pure logic: NO DOM, NO window access in this block
  // ----------------------------------------------------------------
  const Logic = (() => {

    // Deterministic PRNG for testing; games use Math.random.
    const mulberry32 = seed => () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const shuffle = (arr, rng) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    };

    // 1) Random valid solution: a permutation (one bolt per row+col)
    //    with the no-touch constraint. Rows >= 2 apart can never touch,
    //    so adjacency reduces to |col[r] - col[r-1]| >= 2.
    const generateSolution = (n, rng) => {
      const sol = new Array(n).fill(-1);
      const used = new Array(n).fill(false);
      const place = row => {
        if (row === n) return true;
        const order = shuffle(Array.from({ length: n }, (_, i) => i), rng);
        for (const c of order) {
          if (used[c]) continue;
          if (row > 0 && Math.abs(c - sol[row - 1]) < 2) continue;
          used[c] = true; sol[row] = c;
          if (place(row + 1)) return true;
          used[c] = false; sol[row] = -1;
        }
        return false;
      };
      return place(0) ? sol : null;
    };

    // 2) Grow N contiguous realms by randomized multi-source flood
    //    fill, one seed per solution cell. Per-realm growth weights
    //    vary so realm sizes come out uneven (helps uniqueness).
    const DR = [1, -1, 0, 0];
    const DC = [0, 0, 1, -1];

    const growRealms = (n, sol, rng) => {
      const realms = Array.from({ length: n }, () => new Array(n).fill(-1));
      for (let r = 0; r < n; r++) realms[r][sol[r]] = r;
      // Skewed weights give a mix of sprawling and pocket realms
      // (uneven realms are what make random partitions come out unique);
      // the size cap keeps any one realm from swallowing the board.
      const weights = Array.from({ length: n }, () => 0.1 + Math.pow(rng(), 3) * 3);
      const sizes = new Array(n).fill(1);
      const cap = Math.ceil(n * n * 0.28);
      let remaining = n * n - n;
      while (remaining > 0) {
        // Frontier: (uncoloredCell, adjacentRealm) pairs, realm-weighted.
        // Realms at the size cap only expand when nothing else can.
        const collect = ignoreCap => {
          const cand = [];
          let total = 0;
          for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
              if (realms[r][c] !== -1) continue;
              for (let k = 0; k < 4; k++) {
                const nr = r + DR[k], nc = c + DC[k];
                if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
                const id = realms[nr][nc];
                if (id === -1) continue;
                if (!ignoreCap && sizes[id] >= cap) continue;
                cand.push(r, c, id);
                total += weights[id];
              }
            }
          }
          return { cand, total };
        };
        let { cand, total } = collect(false);
        if (cand.length === 0) ({ cand, total } = collect(true));
        let pick = rng() * total;
        let idx = cand.length - 3;
        for (let i = 0; i < cand.length; i += 3) {
          pick -= weights[cand[i + 2]];
          if (pick <= 0) { idx = i; break; }
        }
        realms[cand[idx]][cand[idx + 1]] = cand[idx + 2];
        sizes[cand[idx + 2]]++;
        remaining--;
      }
      return realms;
    };

    // 3) Count solutions with backtracking; stop at `limit`.
    //    Every solution has exactly one bolt per row, so walk rows.
    const countSolutions = (n, realms, limit) => {
      limit = limit || 2;
      const usedCol = new Array(n).fill(false);
      const usedRealm = new Array(n).fill(false);
      let found = 0;
      const walk = (row, prevCol) => {
        if (row === n) { found++; return; }
        for (let c = 0; c < n && found < limit; c++) {
          if (usedCol[c]) continue;
          const id = realms[row][c];
          if (usedRealm[id]) continue;
          if (row > 0 && Math.abs(c - prevCol) <= 1) continue;
          usedCol[c] = true; usedRealm[id] = true;
          walk(row + 1, c);
          usedCol[c] = false; usedRealm[id] = false;
        }
      };
      walk(0, -9);
      return found;
    };

    // Full generation: retry until the realm partition admits
    // EXACTLY ONE solution.
    const generate = (n, rng) => {
      rng = rng || Math.random;
      for (let attempt = 1; attempt <= 1500; attempt++) {
        const solution = generateSolution(n, rng);
        if (!solution) continue;
        const realms = growRealms(n, solution, rng);
        if (countSolutions(n, realms, 2) === 1) {
          return { n, realms, solution, attempts: attempt };
        }
      }
      return null;
    };

    // Validate a full candidate answer (cols[r] = bolt column in row r).
    const validate = (puzzle, cols) => {
      const n = puzzle.n, realms = puzzle.realms;
      if (!Array.isArray(cols) || cols.length !== n) return false;
      const seenCol = new Array(n).fill(false);
      const seenRealm = new Array(n).fill(false);
      for (let r = 0; r < n; r++) {
        const c = cols[r];
        if (!Number.isInteger(c) || c < 0 || c >= n) return false;
        if (seenCol[c]) return false;
        seenCol[c] = true;
        const id = realms[r][c];
        if (seenRealm[id]) return false;
        seenRealm[id] = true;
        if (r > 0 && Math.abs(c - cols[r - 1]) <= 1) return false;
      }
      return true;
    };

    // Live conflict report for an arbitrary set of placed bolts.
    // bolts: [{r, c}, ...]. Returns duplicated rows/cols/realms and
    // the cells of bolts that touch (Chebyshev distance 1).
    const conflicts = (puzzle, bolts) => {
      const n = puzzle.n, realms = puzzle.realms;
      const rowN = new Array(n).fill(0);
      const colN = new Array(n).fill(0);
      const realmN = new Array(n).fill(0);
      for (const b of bolts) {
        rowN[b.r]++; colN[b.c]++; realmN[realms[b.r][b.c]]++;
      }
      const rows = [], cols = [], realmIds = [];
      for (let i = 0; i < n; i++) {
        if (rowN[i] > 1) rows.push(i);
        if (colN[i] > 1) cols.push(i);
        if (realmN[i] > 1) realmIds.push(i);
      }
      const touching = new Set();
      for (let i = 0; i < bolts.length; i++) {
        for (let j = i + 1; j < bolts.length; j++) {
          const a = bolts[i], b = bolts[j];
          if (Math.abs(a.r - b.r) <= 1 && Math.abs(a.c - b.c) <= 1) {
            touching.add(a.r + ',' + a.c);
            touching.add(b.r + ',' + b.c);
          }
        }
      }
      return {
        rows, cols, realms: realmIds,
        cells: Array.from(touching),
        any: rows.length > 0 || cols.length > 0 || realmIds.length > 0 || touching.size > 0
      };
    };

    const isSolved = (puzzle, bolts) => {
      if (bolts.length !== puzzle.n) return false;
      if (conflicts(puzzle, bolts).any) return false;
      const cols = new Array(puzzle.n).fill(-1);
      for (const b of bolts) cols[b.r] = b.c;
      return validate(puzzle, cols);
    };

    return { generate, generateSolution, growRealms, countSolutions, validate, conflicts, isSolved, mulberry32 };
  })();

  if (typeof module !== 'undefined' && module.exports) { module.exports = Logic; return; }

  // ----------------------------------------------------------------
  // DOM / game shell
  // ----------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const boardEl = $('board');
  const timerEl = $('timer');
  const bestSubEl = $('best-sub');
  const boltCountEl = $('bolt-count');
  const boltTotalEl = $('bolt-total');
  const statusEl = $('status');
  const startOverlay = $('start-overlay');
  const endOverlay = $('end-overlay');
  const endVerdictEl = $('end-verdict');
  const endTimeEl = $('end-time');
  const pbTagEl = $('pb-tag');
  const standingsEl = $('standings');

  const GAME_ID = 'olympus';
  const N = 8;
  const REALM_NAMES = ['Zeus', 'Poseidon', 'Hades', 'Athena', 'Apollo', 'Artemis', 'Hermes', 'Ares'];
  const STATE_NAMES = ['empty', 'marked', 'thunderbolt'];
  const BOLT_SVG =
    '<svg class="bolt" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M13.2 1.8 3.6 13.9h6.1L8.2 22.2 18.9 9.6h-6.4l2.6-7.8z"/></svg>';

  const reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let puzzle = null;
  let state = [];          // 0 blank, 1 mark, 2 bolt
  let cells = [];          // cells[r][c] -> button
  let undoStack = [];
  let started = false;
  let finished = false;
  let startTs = 0;
  let tickId = 0;
  let runId = 0;
  let cursor = { r: 0, c: 0 };

  // ---------- timer ----------
  const fmtClock = secs => {
    const t = Math.floor(secs);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  };
  const fmtPrecise = secs => {
    const m = Math.floor(secs / 60);
    const s = secs - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  };
  const elapsedSecs = () => (performance.now() - startTs) / 1000;

  const startTimer = () => {
    startTs = performance.now();
    timerEl.textContent = '0:00';
    clearInterval(tickId);
    tickId = setInterval(() => { timerEl.textContent = fmtClock(elapsedSecs()); }, 250);
  };
  const stopTimer = () => clearInterval(tickId);

  // ---------- board build ----------
  const buildBoard = () => {
    const n = puzzle.n;
    boardEl.style.setProperty('--n', n);
    boardEl.classList.remove('solved');
    boardEl.innerHTML = '';
    boltTotalEl.textContent = n;
    cells = [];
    for (let r = 0; r < n; r++) {
      const rowEl = document.createElement('div');
      rowEl.className = 'board-row';
      rowEl.setAttribute('role', 'row');
      const rowEls = [];
      for (let c = 0; c < n; c++) {
        const id = puzzle.realms[r][c];
        const btn = document.createElement('button');
        btn.className = 'cell realm-' + id;
        if (c === n - 1) btn.classList.add('last-c');
        if (r === n - 1) btn.classList.add('last-r');
        if (c < n - 1 && puzzle.realms[r][c + 1] !== id) btn.classList.add('rb-r');
        if (r < n - 1 && puzzle.realms[r + 1][c] !== id) btn.classList.add('rb-b');
        btn.setAttribute('role', 'gridcell');
        btn.dataset.r = r;
        btn.dataset.c = c;
        btn.tabIndex = (r === 0 && c === 0) ? 0 : -1;
        btn.innerHTML = BOLT_SVG + '<span class="dot"></span>';
        btn.addEventListener('click', () => tapCell(r, c));
        rowEl.appendChild(btn);
        rowEls.push(btn);
      }
      boardEl.appendChild(rowEl);
      cells.push(rowEls);
    }
    cursor = { r: 0, c: 0 };
  };

  const setCursor = (r, c) => {
    cells[cursor.r][cursor.c].tabIndex = -1;
    cursor = { r, c };
    cells[r][c].tabIndex = 0;
  };

  const cellLabel = (r, c) => {
    const realm = REALM_NAMES[puzzle.realms[r][c]] || 'realm ' + (puzzle.realms[r][c] + 1);
    return 'Row ' + (r + 1) + ', column ' + (c + 1) + ', realm of ' + realm +
      ' — ' + STATE_NAMES[state[r][c]];
  };

  // ---------- state / rendering ----------
  const boltList = () => {
    const out = [];
    for (let r = 0; r < puzzle.n; r++) {
      for (let c = 0; c < puzzle.n; c++) {
        if (state[r][c] === 2) out.push({ r, c });
      }
    }
    return out;
  };

  const refresh = () => {
    const n = puzzle.n;
    const bolts = boltList();
    const conf = Logic.conflicts(puzzle, bolts);
    const badRows = new Set(conf.rows);
    const badCols = new Set(conf.cols);
    const badRealms = new Set(conf.realms);
    const badCells = new Set(conf.cells);

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const btn = cells[r][c];
        const s = state[r][c];
        btn.classList.toggle('s-mark', s === 1);
        btn.classList.toggle('s-bolt', s === 2);
        const bad = badRows.has(r) || badCols.has(c) ||
          badRealms.has(puzzle.realms[r][c]) || badCells.has(r + ',' + c);
        btn.classList.toggle('conflict', bad);
        btn.setAttribute('aria-label', cellLabel(r, c));
      }
    }

    boltCountEl.textContent = bolts.length;
    if (conf.any) {
      statusEl.textContent = 'CONFLICT — BOLTS CLASH';
      statusEl.className = 'status bad';
    } else {
      statusEl.textContent = '';
      statusEl.className = 'status';
    }

    if (!finished && Logic.isSolved(puzzle, bolts)) finish();
  };

  // ---------- moves ----------
  const tapCell = (r, c) => {
    if (finished || !started) return;
    const from = state[r][c];
    const to = (from + 1) % 3;
    state[r][c] = to;
    undoStack.push({ type: 'cell', r, c, from });
    setCursor(r, c);
    refresh();
  };

  const undo = () => {
    if (finished || !started || undoStack.length === 0) return;
    const op = undoStack.pop();
    if (op.type === 'cell') {
      state[op.r][op.c] = op.from;
    } else if (op.type === 'snapshot') {
      state = op.grid.map(row => row.slice());
    }
    refresh();
  };

  const clearBoard = () => {
    if (finished || !started) return;
    if (!state.some(row => row.some(v => v !== 0))) return;
    undoStack.push({ type: 'snapshot', grid: state.map(row => row.slice()) });
    state = Array.from({ length: puzzle.n }, () => new Array(puzzle.n).fill(0));
    refresh();
  };

  // ---------- lifecycle ----------
  const freshPuzzle = () => {
    runId++;
    puzzle = null;
    for (const size of [N, N, N, 7, 7]) {
      puzzle = Logic.generate(size);
      if (puzzle) break;
    }
    while (!puzzle) puzzle = Logic.generate(7); // never leave the page dead
    state = Array.from({ length: puzzle.n }, () => new Array(puzzle.n).fill(0));
    undoStack = [];
    finished = false;
    buildBoard();
    refresh();
  };

  const updateBest = () => {
    if (!window.Arena) return;
    const b = Arena.bestOf(GAME_ID);
    bestSubEl.textContent = b == null ? '—' : Arena.formatValue(GAME_ID, b);
  };

  const finish = () => {
    finished = true;
    stopTimer();
    const secs = Math.round(elapsedSecs() * 10) / 10;
    boardEl.classList.add('solved');
    statusEl.textContent = 'SOLVED';
    statusEl.className = 'status good';

    let res = null;
    if (window.Arena) res = Arena.submitScore(GAME_ID, secs);
    updateBest();

    const thisRun = runId;
    const delay = reducedMotion ? 150 : 700;
    setTimeout(() => {
      if (runId !== thisRun) return;
      endTimeEl.textContent = fmtPrecise(secs);
      endVerdictEl.textContent = (res && res.rank === 1)
        ? 'YOU SIT ATOP OLYMPUS'
        : 'THE MOUNTAIN YIELDS';
      pbTagEl.hidden = !(res && res.improved);
      endOverlay.hidden = false;
      if (window.Arena) Arena.renderBoard(standingsEl, GAME_ID);
      $('again-btn').focus();
    }, delay);
  };

  const beginRun = () => {
    started = true;
    startOverlay.hidden = true;
    endOverlay.hidden = true;
    startTimer();
    if (cells[0] && cells[0][0]) cells[0][0].focus({ preventScroll: true });
  };

  // ---------- keyboard ----------
  const moveCursor = (dr, dc) => {
    const n = puzzle.n;
    const nr = Math.min(n - 1, Math.max(0, cursor.r + dr));
    const nc = Math.min(n - 1, Math.max(0, cursor.c + dc));
    setCursor(nr, nc);
    cells[nr][nc].focus({ preventScroll: true });
  };

  const focusOnLink = () =>
    document.activeElement && document.activeElement.tagName === 'A';

  document.addEventListener('keydown', e => {
    if (!startOverlay.hidden) {
      if (e.key === 'Enter' && !focusOnLink()) { e.preventDefault(); beginRun(); }
      return;
    }
    if (!endOverlay.hidden) {
      if (e.key === 'Enter' && !focusOnLink()) { e.preventDefault(); playAgain(); }
      return;
    }
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); moveCursor(-1, 0); break;
      case 'ArrowDown': e.preventDefault(); moveCursor(1, 0); break;
      case 'ArrowLeft': e.preventDefault(); moveCursor(0, -1); break;
      case 'ArrowRight': e.preventDefault(); moveCursor(0, 1); break;
      case ' ': case 'Enter': {
        const a = document.activeElement;
        if (a && a.classList && a.classList.contains('cell')) {
          e.preventDefault(); // stops native activation -> no double cycle
          tapCell(+a.dataset.r, +a.dataset.c);
        }
        break;
      }
      case 'z': case 'Z': case 'u': case 'U': e.preventDefault(); undo(); break;
      case 'c': case 'C': e.preventDefault(); clearBoard(); break;
      case 'n': case 'N': e.preventDefault(); newPuzzle(); break;
    }
  });

  // ---------- controls ----------
  const newPuzzle = () => {
    if (!started) return;
    freshPuzzle();
    endOverlay.hidden = true;
    startTimer();
  };

  const playAgain = () => {
    freshPuzzle();
    endOverlay.hidden = true;
    startTimer();
  };

  $('start-btn').addEventListener('click', beginRun);
  $('again-btn').addEventListener('click', playAgain);
  $('undo-btn').addEventListener('click', undo);
  $('clear-btn').addEventListener('click', clearBoard);
  $('new-btn').addEventListener('click', newPuzzle);

  // ---------- boot ----------
  freshPuzzle();
  updateBest();

  // ---------- debug hook ----------
  if (new URLSearchParams(location.search).has('debug')) {
    window.__debug = {
      get puzzle() { return puzzle; },
      get solution() { return puzzle ? puzzle.solution.slice() : null; },
      solve() {
        if (!started) beginRun();
        if (finished) return;
        for (let r = 0; r < puzzle.n; r++) {
          for (let c = 0; c < puzzle.n; c++) {
            state[r][c] = (puzzle.solution[r] === c) ? 2 : 0;
          }
        }
        undoStack = [];
        refresh();
      }
    };
  }
})();
