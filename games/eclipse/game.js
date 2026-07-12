/* =================================================================
   ECLIPSE — a sun/moon binary logic puzzle · Olympus Arcade
   ryannovak.net

   6x6 grid. Three suns and three moons in every row and column,
   never three alike consecutive. "=" edges match, "×" edges differ.
   One solution. The clock keeps score.
   ================================================================= */
(() => {
  'use strict';

  // ================================================================
  // Pure logic — no DOM, no window access. Node-testable.
  // ================================================================
  const Logic = (() => {
    const SIZE = 6;
    const HALF = 3;
    const SUN = 1;
    const MOON = 2;

    const emptyGrid = () =>
      Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));

    const cloneGrid = g => g.map(row => row.slice());

    const gridsEqual = (a, b) => {
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
          if (a[r][c] !== b[r][c]) return false;
      return true;
    };

    const shuffle = (arr, rng) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    };

    // Could v sit at (r,c) without busting counts or forming a
    // filled run of three? (Partial-grid safe.)
    const fits = (grid, r, c, v) => {
      let n = 0;
      for (let i = 0; i < SIZE; i++) if (grid[r][i] === v) n++;
      if (n >= HALF) return false;
      n = 0;
      for (let i = 0; i < SIZE; i++) if (grid[i][c] === v) n++;
      if (n >= HALF) return false;
      grid[r][c] = v;
      let ok = true;
      const cHi = Math.min(c, SIZE - 3);
      for (let s = Math.max(0, c - 2); s <= cHi && ok; s++) {
        const a = grid[r][s];
        if (a !== 0 && a === grid[r][s + 1] && a === grid[r][s + 2]) ok = false;
      }
      const rHi = Math.min(r, SIZE - 3);
      for (let s = Math.max(0, r - 2); s <= rHi && ok; s++) {
        const a = grid[s][c];
        if (a !== 0 && a === grid[s + 1][c] && a === grid[s + 2][c]) ok = false;
      }
      grid[r][c] = 0;
      return ok;
    };

    // Random full valid grid via randomized backtracking.
    const fullGrid = rng => {
      const grid = emptyGrid();
      const bt = idx => {
        if (idx === SIZE * SIZE) return true;
        const r = (idx / SIZE) | 0, c = idx % SIZE;
        const first = rng() < 0.5 ? SUN : MOON;
        const order = [first, first === SUN ? MOON : SUN];
        for (let k = 0; k < 2; k++) {
          const v = order[k];
          if (fits(grid, r, c, v)) {
            grid[r][c] = v;
            if (bt(idx + 1)) return true;
            grid[r][c] = 0;
          }
        }
        return false;
      };
      bt(0);
      return grid;
    };

    // Constraint: { r, c, dir: 'h'|'v', type: '='|'x' }
    // 'h' links (r,c)-(r,c+1); 'v' links (r,c)-(r+1,c).
    const otherCell = cn =>
      cn.dir === 'h' ? [cn.r, cn.c + 1] : [cn.r + 1, cn.c];

    const constraintSatisfied = (cn, grid) => {
      const o = otherCell(cn);
      const a = grid[cn.r][cn.c], b = grid[o[0]][o[1]];
      if (a === 0 || b === 0) return true; // undecided — not a violation
      return cn.type === '=' ? a === b : a !== b;
    };

    // Count completions of puzzle.givens under all rules, stopping
    // at `cap`. Optionally collects found grids into `out`.
    const countSolutions = (puzzle, cap, out) => {
      const grid = cloneGrid(puzzle.givens);
      const consAt = Array.from({ length: SIZE * SIZE }, () => []);
      for (const cn of puzzle.constraints) {
        const o = otherCell(cn);
        consAt[cn.r * SIZE + cn.c].push({ or: o[0], oc: o[1], type: cn.type });
        consAt[o[0] * SIZE + o[1]].push({ or: cn.r, oc: cn.c, type: cn.type });
      }
      const empties = [];
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
          if (grid[r][c] === 0) empties.push([r, c]);
      let count = 0;
      const bt = idx => {
        if (count >= cap) return;
        if (idx === empties.length) {
          count++;
          if (out) out.push(cloneGrid(grid));
          return;
        }
        const r = empties[idx][0], c = empties[idx][1];
        for (let v = SUN; v <= MOON; v++) {
          if (!fits(grid, r, c, v)) continue;
          grid[r][c] = v;
          let ok = true;
          const cons = consAt[r * SIZE + c];
          for (let i = 0; i < cons.length && ok; i++) {
            const cn = cons[i];
            const ov = grid[cn.or][cn.oc];
            if (ov !== 0 && (cn.type === '=' ? v !== ov : v === ov)) ok = false;
          }
          if (ok) bt(idx + 1);
          grid[r][c] = 0;
        }
      };
      bt(0);
      return count;
    };

    // Is `grid` a complete, correct solution of `puzzle`?
    const validate = (puzzle, grid) => {
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++) {
          const v = grid[r][c];
          if (v !== SUN && v !== MOON) return false;
          if (puzzle.givens[r][c] !== 0 && v !== puzzle.givens[r][c]) return false;
        }
      for (let i = 0; i < SIZE; i++) {
        let rowSuns = 0, colSuns = 0;
        for (let j = 0; j < SIZE; j++) {
          if (grid[i][j] === SUN) rowSuns++;
          if (grid[j][i] === SUN) colSuns++;
        }
        if (rowSuns !== HALF || colSuns !== HALF) return false;
      }
      for (let i = 0; i < SIZE; i++)
        for (let s = 0; s <= SIZE - 3; s++) {
          if (grid[i][s] === grid[i][s + 1] && grid[i][s] === grid[i][s + 2]) return false;
          if (grid[s][i] === grid[s + 1][i] && grid[s][i] === grid[s + 2][i]) return false;
        }
      for (const cn of puzzle.constraints)
        if (!constraintSatisfied(cn, grid)) return false;
      return true;
    };

    // Definite violations in a partial grid. No longer surfaced in the
    // UI (live feedback leaked answers) — retained for headless tests.
    const violations = (puzzle, grid) => {
      const rows = [], cols = [], cons = [];
      for (let i = 0; i < SIZE; i++) {
        let rSun = 0, rMoon = 0, cSun = 0, cMoon = 0;
        let rTrip = false, cTrip = false;
        for (let j = 0; j < SIZE; j++) {
          const rv = grid[i][j], cv = grid[j][i];
          if (rv === SUN) rSun++; else if (rv === MOON) rMoon++;
          if (cv === SUN) cSun++; else if (cv === MOON) cMoon++;
          if (j <= SIZE - 3) {
            if (rv !== 0 && rv === grid[i][j + 1] && rv === grid[i][j + 2]) rTrip = true;
            if (cv !== 0 && cv === grid[j + 1][i] && cv === grid[j + 2][i]) cTrip = true;
          }
        }
        if (rSun > HALF || rMoon > HALF || rTrip) rows.push(i);
        if (cSun > HALF || cMoon > HALF || cTrip) cols.push(i);
      }
      for (let i = 0; i < puzzle.constraints.length; i++)
        if (!constraintSatisfied(puzzle.constraints[i], grid)) cons.push(i);
      return { rows, cols, cons };
    };

    // Generate a puzzle with EXACTLY ONE solution.
    // 1. Backtrack a random full valid grid.
    // 2. Deal 4–7 edge constraints and 8–12 givens from it.
    // 3. Count solutions (cap 2); while a rival solution exists, pin
    //    a cell where the rival disagrees — strict progress, so the
    //    loop terminates well before the grid fills.
    const generate = (rng = Math.random) => {
      const solution = fullGrid(rng);

      const edges = [];
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++) {
          if (c < SIZE - 1) edges.push({ r, c, dir: 'h' });
          if (r < SIZE - 1) edges.push({ r, c, dir: 'v' });
        }
      const nCons = 4 + Math.floor(rng() * 4); // 4–7
      const constraints = shuffle(edges, rng).slice(0, nCons).map(e => {
        const o = e.dir === 'h' ? [e.r, e.c + 1] : [e.r + 1, e.c];
        return {
          r: e.r, c: e.c, dir: e.dir,
          type: solution[e.r][e.c] === solution[o[0]][o[1]] ? '=' : 'x'
        };
      });

      const givens = emptyGrid();
      const order = shuffle(Array.from({ length: SIZE * SIZE }, (_, i) => i), rng);
      const nGivens = 8 + Math.floor(rng() * 5); // 8–12
      for (let i = 0; i < nGivens; i++) {
        const r = (order[i] / SIZE) | 0, c = order[i] % SIZE;
        givens[r][c] = solution[r][c];
      }

      const puzzle = { size: SIZE, givens, constraints, solution };

      for (let guard = 0; guard < SIZE * SIZE; guard++) {
        const sols = [];
        if (countSolutions(puzzle, 2, sols) === 1) return puzzle;
        let rival = null;
        for (const s of sols)
          if (!gridsEqual(s, solution)) { rival = s; break; }
        const diffs = [];
        for (let r = 0; r < SIZE; r++)
          for (let c = 0; c < SIZE; c++)
            if (givens[r][c] === 0 && rival[r][c] !== solution[r][c])
              diffs.push([r, c]);
        const pick = diffs[Math.floor(rng() * diffs.length)];
        givens[pick[0]][pick[1]] = solution[pick[0]][pick[1]];
      }
      return puzzle; // unreachable: each pass pins at least one cell
    };

    return {
      SIZE, SUN, MOON,
      generate, validate, violations, countSolutions,
      cloneGrid, emptyGrid
    };
  })();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logic;
    return;
  }

  // ================================================================
  // DOM shell
  // ================================================================
  const $ = id => document.getElementById(id);
  const SIZE = Logic.SIZE, SUN = Logic.SUN, MOON = Logic.MOON;
  const GAME_ID = 'eclipse';

  const boardEl = $('board');
  const consEl = $('cons');
  const statusEl = $('status');
  const timerEl = $('timer');
  const bestEl = $('best');
  const undoBtn = $('undo-btn');
  const clearBtn = $('clear-btn');
  const newBtn = $('new-btn');
  const hintBtn = $('hint-btn');

  // ---- inline SVG symbols (crisper than emoji) -------------------
  const sunSVG = (() => {
    let rays = '';
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      const x1 = (12 + Math.cos(a) * 7.4).toFixed(2);
      const y1 = (12 + Math.sin(a) * 7.4).toFixed(2);
      const x2 = (12 + Math.cos(a) * 10.2).toFixed(2);
      const y2 = (12 + Math.sin(a) * 10.2).toFixed(2);
      rays += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="4.9" fill="currentColor"/>' +
      '<g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none">' +
      rays + '</g></svg>';
  })();

  const moonSVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" ' +
    'd="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z"/></svg>';

  // ---- state -----------------------------------------------------
  let puzzle = null;
  let grid = null;
  let cellEls = [];   // [r][c] -> button
  let undoStack = []; // entries: arrays of [r, c, prevValue]
  let started = false;
  let finished = false;
  let startTime = 0;
  let timerId = null;
  let hintsLeft = 3;

  // ---- time formatting --------------------------------------------
  const fmtClock = secs => {
    const t = Math.floor(secs);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  };
  const fmtPrecise = secs => {
    const tenths = Math.round(secs * 10);
    const t = Math.floor(tenths / 600) * 60 + Math.floor((tenths % 600) / 10);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0') +
      '.' + (tenths % 10);
  };

  // ---- timer -------------------------------------------------------
  const tick = () => {
    timerEl.textContent = fmtClock((performance.now() - startTime) / 1000);
  };
  const startTimer = () => {
    if (timerId) clearInterval(timerId);
    startTime = performance.now();
    timerId = setInterval(tick, 200);
    tick();
  };
  const stopTimer = () => {
    if (timerId) { clearInterval(timerId); timerId = null; }
  };

  const refreshBest = () => {
    if (!window.Arena) return;
    const b = Arena.bestOf(GAME_ID);
    bestEl.textContent = b == null ? '—' : Arena.formatValue(GAME_ID, b);
  };

  // ---- board construction ------------------------------------------
  // Screen readers can't see the =/× glyph layer, so each cell's label
  // spells out the constraints it participates in.
  let conLabelMap = new Map();
  const buildConLabels = () => {
    conLabelMap = new Map();
    const add = (r, c, txt) => {
      const k = r + ',' + c;
      conLabelMap.set(k, (conLabelMap.get(k) ? conLabelMap.get(k) + '; ' : '') + txt);
    };
    for (const cn of puzzle.constraints) {
      const same = cn.type === '=';
      if (cn.dir === 'h') {
        add(cn.r, cn.c, same ? 'matches cell to the right' : 'differs from cell to the right');
        add(cn.r, cn.c + 1, same ? 'matches cell to the left' : 'differs from cell to the left');
      } else {
        add(cn.r, cn.c, same ? 'matches cell below' : 'differs from cell below');
        add(cn.r + 1, cn.c, same ? 'matches cell above' : 'differs from cell above');
      }
    }
  };

  const cellLabel = (r, c) => {
    const v = grid[r][c];
    const what = v === SUN ? 'sun' : v === MOON ? 'moon' : 'empty';
    const lock = puzzle.givens[r][c] !== 0 ? ', locked' : '';
    const cons = conLabelMap.get(r + ',' + c);
    return 'Row ' + (r + 1) + ', column ' + (c + 1) + ': ' + what + lock +
      (cons ? ', ' + cons : '');
  };

  const buildBoard = () => {
    boardEl.innerHTML = '';
    consEl.innerHTML = '';
    cellEls = [];
    for (let r = 0; r < SIZE; r++) {
      cellEls.push([]);
      for (let c = 0; c < SIZE; c++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cell';
        b.dataset.r = r;
        b.dataset.c = c;
        if (puzzle.givens[r][c] !== 0) b.classList.add('given');
        b.addEventListener('click', () => onCellTap(r, c));
        boardEl.appendChild(b);
        cellEls[r].push(b);
      }
    }
    for (const cn of puzzle.constraints) {
      const s = document.createElement('span');
      s.className = 'con';
      s.textContent = cn.type === '=' ? '=' : '×';
      const x = cn.dir === 'h' ? (cn.c + 1) / SIZE : (cn.c + 0.5) / SIZE;
      const y = cn.dir === 'h' ? (cn.r + 0.5) / SIZE : (cn.r + 1) / SIZE;
      s.style.left = (x * 100) + '%';
      s.style.top = (y * 100) + '%';
      consEl.appendChild(s);
    }
  };

  // ---- rendering -----------------------------------------------------
  // Deliberately NO live rule-checking here: flagging violations as a
  // cell is cycled hands over the answer two taps at a time. Feedback
  // arrives only once the grid is full — see checkWin.
  const refresh = () => {
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        const b = cellEls[r][c];
        const v = grid[r][c];
        b.classList.toggle('sun', v === SUN);
        b.classList.toggle('moon', v === MOON);
        const want = v === SUN ? sunSVG : v === MOON ? moonSVG : '';
        if (b.dataset.sym !== String(v)) {
          b.innerHTML = want;
          b.dataset.sym = String(v);
        }
        b.setAttribute('aria-label', cellLabel(r, c));
      }

    statusEl.textContent = '';
    statusEl.classList.remove('bad');

    undoBtn.disabled = undoStack.length === 0 || finished;
    clearBtn.disabled = finished;
    updateHintBtn();
  };

  // ---- interaction -----------------------------------------------------
  const pushUndo = entry => {
    undoStack.push(entry);
    if (undoStack.length > 600) undoStack.shift();
  };

  const onCellTap = (r, c) => {
    if (!started || finished || puzzle.givens[r][c] !== 0) return;
    const prev = grid[r][c];
    grid[r][c] = prev === 0 ? SUN : prev === SUN ? MOON : 0;
    pushUndo([[r, c, prev]]);
    refresh();
    checkWin();
  };

  const undo = () => {
    if (!started || finished || undoStack.length === 0) return;
    const entry = undoStack.pop();
    for (const m of entry) grid[m[0]][m[1]] = m[2];
    refresh();
  };

  const clearBoard = () => {
    if (!started || finished) return;
    const entry = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (puzzle.givens[r][c] === 0 && grid[r][c] !== 0) {
          entry.push([r, c, grid[r][c]]);
          grid[r][c] = 0;
        }
    if (entry.length) { pushUndo(entry); refresh(); }
  };

  // ---- hints -----------------------------------------------------------
  // Three per puzzle. Each one fills a not-yet-correct row with the
  // solution and pushes the clock forward five seconds.
  const updateHintBtn = () => {
    hintBtn.textContent = 'HINT (' + hintsLeft + ')';
    hintBtn.disabled = !started || finished || hintsLeft === 0;
  };

  const useHint = () => {
    if (!started || finished || hintsLeft === 0) return;
    const rows = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++)
        if (grid[r][c] !== puzzle.solution[r][c]) { rows.push(r); break; }
    }
    if (!rows.length) return;
    const r = rows[Math.floor(Math.random() * rows.length)];
    const entry = [];
    for (let c = 0; c < SIZE; c++)
      if (puzzle.givens[r][c] === 0 && grid[r][c] !== puzzle.solution[r][c]) {
        entry.push([r, c, grid[r][c]]);
        grid[r][c] = puzzle.solution[r][c];
      }
    if (entry.length) pushUndo(entry);
    hintsLeft--;
    startTime -= 5000; // +5s penalty: elapsed = now - startTime
    tick();
    refresh();
    checkWin();
    if (!finished && !statusEl.textContent) {
      statusEl.textContent = 'HELIOS REVEALS ROW ' + (r + 1) + ' · +5s';
      statusEl.classList.remove('bad');
    }
  };

  // ---- runs & winning -----------------------------------------------
  const newRun = () => {
    puzzle = Logic.generate();
    grid = Logic.cloneGrid(puzzle.givens);
    undoStack = [];
    finished = false;
    hintsLeft = 3;
    buildConLabels();
    buildBoard();
    refresh();
    $('end-overlay').hidden = true;
    if (started) startTimer();
    else timerEl.textContent = '0:00';
  };

  const checkWin = () => {
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (grid[r][c] === 0) return;
    if (!Logic.validate(puzzle, grid)) {
      // The puzzle has exactly one solution, so "wrong" is well-defined.
      let wrong = 0;
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
          if (grid[r][c] !== puzzle.solution[r][c]) wrong++;
      statusEl.textContent = 'SKY FULL — ' + wrong +
        (wrong === 1 ? ' CELL IS OFF' : ' CELLS ARE OFF');
      statusEl.classList.add('bad');
      return;
    }
    win();
  };

  const win = () => {
    if (finished) return;
    finished = true;
    stopTimer();
    const secs = Math.max(0.1,
      Math.round(((performance.now() - startTime) / 1000) * 10) / 10);
    $('end-time').textContent = fmtPrecise(secs);
    let res = null;
    if (window.Arena) res = Arena.submitScore(GAME_ID, secs); // once per run
    $('end-verdict').textContent =
      res && res.rank === 1 ? 'YOU SIT ATOP OLYMPUS' : 'SKY BALANCED';
    $('pb-tag').hidden = !(res && res.improved);
    if (window.Arena) Arena.renderBoard($('standings'), GAME_ID);
    refreshBest();
    refresh();
    $('end-overlay').hidden = false;
  };

  const startRun = () => {
    $('start-overlay').hidden = true;
    document.body.classList.remove('prestart');
    started = true;
    startTimer();
    updateHintBtn();
  };

  // ---- keyboard -------------------------------------------------------
  const moveFocus = (dr, dc) => {
    const a = document.activeElement;
    let r = 0, c = 0;
    if (a && a.classList && a.classList.contains('cell')) {
      r = Math.min(SIZE - 1, Math.max(0, (+a.dataset.r) + dr));
      c = Math.min(SIZE - 1, Math.max(0, (+a.dataset.c) + dc));
    }
    cellEls[r][c].focus();
  };

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!started) return;
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); moveFocus(-1, 0); break;
      case 'ArrowDown': e.preventDefault(); moveFocus(1, 0); break;
      case 'ArrowLeft': e.preventDefault(); moveFocus(0, -1); break;
      case 'ArrowRight': e.preventDefault(); moveFocus(0, 1); break;
      case 'u': case 'U': undo(); break;
      case 'c': case 'C': clearBoard(); break;
      case 'h': case 'H': useHint(); break;
      case 'n': case 'N': if (!$('end-overlay').hidden) break; newRun(); break;
    }
  });

  // ---- wire up ---------------------------------------------------------
  $('start-btn').addEventListener('click', startRun);
  $('restart-btn').addEventListener('click', newRun);
  undoBtn.addEventListener('click', undo);
  clearBtn.addEventListener('click', clearBoard);
  hintBtn.addEventListener('click', useHint);
  newBtn.addEventListener('click', () => { if (started && !finished) newRun(); });

  // Veil the generated board until START so nobody pre-studies the
  // puzzle while the clock is idle.
  document.body.classList.add('prestart');
  newRun();
  refreshBest();

  // ---- debug hook (?debug) ---------------------------------------------
  if (new URLSearchParams(location.search).has('debug')) {
    window.__debug = {
      get puzzle() { return puzzle; },
      get solution() { return puzzle ? puzzle.solution : null; },
      solve: () => {
        if (!started) startRun();
        if (finished) return;
        for (let r = 0; r < SIZE; r++)
          for (let c = 0; c < SIZE; c++)
            grid[r][c] = puzzle.solution[r][c];
        refresh();
        checkWin();
      }
    };
  }
})();
