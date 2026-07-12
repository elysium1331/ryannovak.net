/* =================================================================
   MOSAIC — a nonogram in warm stone · Olympus Arcade
   ryannovak.net

   8x8 picross. Run-length clues on every row and column, one buried
   mosaic, no guessing required: every puzzle is fully determined by
   pure line logic. The clock keeps score.
   ================================================================= */
(() => {
  'use strict';

  // ================================================================
  // Pure logic — no DOM, no window access. Node-testable.
  // ================================================================
  const Logic = (() => {
    const SIZE = 8;
    const CELLS = SIZE * SIZE;
    const FULL = (1 << SIZE) - 1; // 0b11111111

    // Run-lengths of consecutive 1s in a 0/1 array, in order.
    const lineRuns = cells => {
      const runs = [];
      let n = 0;
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] === 1) n++;
        else if (n) { runs.push(n); n = 0; }
      }
      if (n) runs.push(n);
      return runs;
    };

    const runsEqual = (a, b) => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    };

    // Precompute: every 8-bit line pattern, keyed by its run signature.
    // Bit i of a mask = cell i of the line.
    const PATTERNS = (() => {
      const map = new Map();
      for (let m = 0; m <= FULL; m++) {
        const cells = [];
        for (let i = 0; i < SIZE; i++) cells.push((m >> i) & 1);
        const key = lineRuns(cells).join(',');
        let list = map.get(key);
        if (!list) map.set(key, list = []);
        list.push(m);
      }
      return map;
    })();

    const patternsFor = clue => PATTERNS.get(clue.join(',')) || [];

    // Row and column clues of a complete 0/1 grid.
    const clues = grid => {
      const rows = grid.map(row => lineRuns(row));
      const cols = [];
      for (let c = 0; c < SIZE; c++) {
        const col = [];
        for (let r = 0; r < SIZE; r++) col.push(grid[r][c]);
        cols.push(lineRuns(col));
      }
      return { rows, cols };
    };

    // Iterated per-line constraint propagation: for each line, keep
    // every placement of its clue consistent with the known cells and
    // intersect them — cells set in ALL placements are filled, cells
    // set in NONE are empty. Loop until no line changes.
    // Returns { grid, solved } where grid holds -1 unknown / 0 / 1.
    const lineSolve = (rowClues, colClues) => {
      const st = Array.from({ length: SIZE }, () => new Array(SIZE).fill(-1));
      const rowCand = rowClues.map(cl => patternsFor(cl).slice());
      const colCand = colClues.map(cl => patternsFor(cl).slice());

      // get/set cell i of a line; returns -1 on contradiction,
      // 1 if the pass changed something, 0 otherwise.
      const applyLine = (cand, get, set) => {
        let mustFill = 0, mustEmpty = 0;
        for (let i = 0; i < SIZE; i++) {
          const v = get(i);
          if (v === 1) mustFill |= 1 << i;
          else if (v === 0) mustEmpty |= 1 << i;
        }
        let w = 0;
        for (let k = 0; k < cand.length; k++) {
          const m = cand[k];
          if ((m & mustFill) === mustFill && (m & mustEmpty) === 0) cand[w++] = m;
        }
        cand.length = w;
        if (w === 0) return -1;
        let and = FULL, or = 0;
        for (let k = 0; k < w; k++) { and &= cand[k]; or |= cand[k]; }
        let changed = 0;
        for (let i = 0; i < SIZE; i++) {
          if (get(i) !== -1) continue;
          const bit = 1 << i;
          if (and & bit) { set(i, 1); changed = 1; }
          else if (!(or & bit)) { set(i, 0); changed = 1; }
        }
        return changed;
      };

      for (;;) {
        let changed = false;
        for (let r = 0; r < SIZE; r++) {
          const res = applyLine(rowCand[r], i => st[r][i], (i, v) => { st[r][i] = v; });
          if (res === -1) return { grid: st, solved: false, contradiction: true };
          if (res === 1) changed = true;
        }
        for (let c = 0; c < SIZE; c++) {
          const res = applyLine(colCand[c], i => st[i][c], (i, v) => { st[i][c] = v; });
          if (res === -1) return { grid: st, solved: false, contradiction: true };
          if (res === 1) changed = true;
        }
        if (!changed) break;
      }

      let solved = true;
      for (let r = 0; r < SIZE && solved; r++)
        for (let c = 0; c < SIZE; c++)
          if (st[r][c] === -1) { solved = false; break; }
      return { grid: st, solved };
    };

    // Emergency fallback (never expected to trigger): alternating full
    // and bare rows — trivially line-solvable, density exactly 0.5.
    const fallbackPattern = () =>
      Array.from({ length: SIZE }, (_, r) => new Array(SIZE).fill(r % 2 === 0 ? 1 : 0));

    // Generate a puzzle whose clues are fully determined by pure line
    // logic (which also guarantees exactly one solution):
    // 1. Sample each cell independently at density 0.45–0.55.
    // 2. Reject boards whose realized density falls outside 0.40–0.60.
    // 3. Accept only if the line solver settles every cell.
    const generate = (rng = Math.random) => {
      let attempts = 0;
      while (attempts < 20000) {
        attempts++;
        const p = 0.45 + rng() * 0.10;
        const grid = [];
        let filled = 0;
        for (let r = 0; r < SIZE; r++) {
          const row = [];
          for (let c = 0; c < SIZE; c++) {
            const v = rng() < p ? 1 : 0;
            filled += v;
            row.push(v);
          }
          grid.push(row);
        }
        const density = filled / CELLS;
        if (density < 0.40 || density > 0.60) continue;
        const cl = clues(grid);
        if (!lineSolve(cl.rows, cl.cols).solved) continue;
        return { size: SIZE, rows: cl.rows, cols: cl.cols, solution: grid, attempts };
      }
      const grid = fallbackPattern();
      const cl = clues(grid);
      return { size: SIZE, rows: cl.rows, cols: cl.cols, solution: grid, attempts };
    };

    // Accepts a Set/array of filled cell indices (r*8+c) or an 8x8
    // grid where 1 = filled. True iff the filled pattern satisfies
    // every row and column clue (with unique puzzles this is exactly
    // "equals the solution").
    const toGrid = filled => {
      if (Array.isArray(filled) && filled.length === SIZE && Array.isArray(filled[0])) {
        if (!filled.every(row => Array.isArray(row) && row.length === SIZE)) return null;
        return filled.map(row => row.map(v => (v === 1 ? 1 : 0)));
      }
      const iter = filled instanceof Set ? filled : Array.isArray(filled) ? filled : null;
      if (!iter) return null;
      const g = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
      for (const idx of iter) {
        if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= CELLS) return null;
        g[(idx / SIZE) | 0][idx % SIZE] = 1;
      }
      return g;
    };

    const validate = (puzzle, filled) => {
      if (!puzzle || !Array.isArray(puzzle.rows) || !Array.isArray(puzzle.cols)) return false;
      const grid = toGrid(filled);
      if (!grid) return false;
      const cl = clues(grid);
      for (let i = 0; i < SIZE; i++) {
        if (!runsEqual(cl.rows[i], puzzle.rows[i])) return false;
        if (!runsEqual(cl.cols[i], puzzle.cols[i])) return false;
      }
      return true;
    };

    return { SIZE, generate, clues, lineSolve, validate, lineRuns, runsEqual };
  })();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logic;
    return;
  }

  // ================================================================
  // DOM shell
  // ================================================================
  const $ = id => document.getElementById(id);
  const SIZE = Logic.SIZE;
  const CELLS = SIZE * SIZE;
  const GAME_ID = 'mosaic';
  const EMPTY = 0, TILE = 1, MARK = 2;

  const boardEl = $('board');
  const rcluesEl = $('rclues');
  const ccluesEl = $('cclues');
  const statusEl = $('status');
  const timerEl = $('timer');
  const bestEl = $('best');
  const undoBtn = $('undo-btn');
  const clearBtn = $('clear-btn');
  const newBtn = $('new-btn');
  const solveBtn = $('solve-btn');
  const tileBtn = $('tool-tile');
  const markBtn = $('tool-mark');

  const REDUCED = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- state -----------------------------------------------------
  let puzzle = null;
  let state = null;       // Uint8Array(64): 0 empty, 1 tile, 2 mark
  let solFlat = null;     // Uint8Array(64) of 0/1
  let solCount = 0;       // tesserae in the solution
  let cellEls = [];       // flat [64]
  let rowClueEls = [];
  let colClueEls = [];
  let undoStack = [];     // entries: arrays of [idx, prevValue]
  let surrendered = false; // SOLVE pressed: reveal the floor, no score
  let stroke = null;      // { eff, action, changes, visited }
  let tool = 'tile';
  let started = false;
  let finished = false;
  let startTime = 0;
  let timerId = null;
  let winTimeout = null;
  let clickGuard = -1e9;  // last pointer activity, to skip synthetic clicks

  // ---- time formatting -------------------------------------------
  const fmtClock = secs => {
    const t = Math.floor(secs);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  };
  const fmtPrecise = secs => {
    const tenths = Math.round(secs * 10);
    const t = Math.floor(tenths / 10);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0') +
      '.' + (tenths % 10);
  };

  // ---- timer ------------------------------------------------------
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

  // ---- board / clue construction ----------------------------------
  const buildBoard = () => {
    boardEl.classList.remove('won');
    boardEl.innerHTML = '';
    cellEls = [];
    for (let i = 0; i < CELLS; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.dataset.idx = i;
      // Stable per-cell jitter, seeded from the cell index.
      const h = ((i + 1) * 2654435761) >>> 0;
      b.style.setProperty('--h', String(34 + (h % 9)));            // hue 34–42
      b.style.setProperty('--l', String(47 + ((h >>> 3) % 9)));    // light 47–55
      b.style.setProperty('--h2', String(30 + ((h >>> 6) % 17)));  // win hue 30–46
      b.style.setProperty('--d', (((i % SIZE) + ((i / SIZE) | 0)) * 45) + 'ms');
      b.addEventListener('click', onCellClick);
      boardEl.appendChild(b);
      cellEls.push(b);
    }
  };

  const buildClues = () => {
    rcluesEl.innerHTML = '';
    ccluesEl.innerHTML = '';
    rowClueEls = [];
    colClueEls = [];
    for (let r = 0; r < SIZE; r++) {
      const d = document.createElement('div');
      d.className = 'rclue';
      d.textContent = puzzle.rows[r].length ? puzzle.rows[r].join(' ') : '0';
      rcluesEl.appendChild(d);
      rowClueEls.push(d);
    }
    for (let c = 0; c < SIZE; c++) {
      const d = document.createElement('div');
      d.className = 'cclue';
      const nums = puzzle.cols[c].length ? puzzle.cols[c] : [0];
      for (const n of nums) {
        const s = document.createElement('span');
        s.textContent = String(n);
        d.appendChild(s);
      }
      ccluesEl.appendChild(d);
      colClueEls.push(d);
    }
  };

  // ---- rendering ----------------------------------------------------
  const renderCell = i => {
    const b = cellEls[i];
    const v = state[i];
    b.classList.toggle('fill', v === TILE);
    b.classList.toggle('mark', v === MARK);
    b.setAttribute('aria-label',
      'Row ' + (((i / SIZE) | 0) + 1) + ', column ' + ((i % SIZE) + 1) + ': ' +
      (v === TILE ? 'tile' : v === MARK ? 'marked empty' : 'empty'));
  };

  const lineState = (isRow, k) => {
    const cells = [];
    for (let j = 0; j < SIZE; j++)
      cells.push(state[isRow ? k * SIZE + j : j * SIZE + k] === TILE ? 1 : 0);
    return cells;
  };

  const refreshClues = () => {
    let done = 0, placed = 0;
    for (let i = 0; i < CELLS; i++) if (state[i] === TILE) placed++;
    for (let r = 0; r < SIZE; r++) {
      const ok = Logic.runsEqual(Logic.lineRuns(lineState(true, r)), puzzle.rows[r]);
      rowClueEls[r].classList.toggle('done', ok);
      if (ok) done++;
    }
    for (let c = 0; c < SIZE; c++) {
      const ok = Logic.runsEqual(Logic.lineRuns(lineState(false, c)), puzzle.cols[c]);
      colClueEls[c].classList.toggle('done', ok);
      if (ok) done++;
    }
    statusEl.textContent = started
      ? 'TESSERAE ' + placed + '/' + solCount + ' · LINES ' + done + '/' + (SIZE * 2)
      : '';
    undoBtn.disabled = !started || finished || undoStack.length === 0;
    clearBtn.disabled = !started || finished;
    solveBtn.disabled = !started || finished;
  };

  const refreshAll = () => {
    for (let i = 0; i < CELLS; i++) renderCell(i);
    refreshClues();
  };

  // ---- interaction ----------------------------------------------------
  const pushUndo = entry => {
    undoStack.push(entry);
    if (undoStack.length > 400) undoStack.shift();
  };

  const checkSolved = () => {
    for (let i = 0; i < CELLS; i++)
      if ((state[i] === TILE ? 1 : 0) !== solFlat[i]) return false;
    return true;
  };

  const cellAt = e => {
    const rect = boardEl.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return -1;
    const c = Math.min(SIZE - 1, Math.floor((x / rect.width) * SIZE));
    const r = Math.min(SIZE - 1, Math.floor((y / rect.height) * SIZE));
    return r * SIZE + c;
  };

  const endStroke = () => {
    if (!stroke) return;
    clickGuard = performance.now();
    if (stroke.changes.length) pushUndo(stroke.changes);
    stroke = null;
    // the stroke's undo entry lands after the last refreshClues() ran,
    // so re-derive the button state here or UNDO stays disabled
    undoBtn.disabled = !started || finished || undoStack.length === 0;
  };

  const strokeCell = i => {
    if (!stroke || finished || stroke.visited.has(i)) return;
    stroke.visited.add(i);
    const prev = state[i];
    let next = prev;
    if (stroke.action === EMPTY) {
      if (prev === stroke.eff) next = EMPTY; // erase only the stroke's own state
    } else {
      next = stroke.action;                  // paint (overwrites the other note)
    }
    if (next === prev) return;
    state[i] = next;
    stroke.changes.push([i, prev]);
    renderCell(i);
    refreshClues();
    if (checkSolved()) { endStroke(); win(); }
  };

  boardEl.addEventListener('contextmenu', e => e.preventDefault());

  boardEl.addEventListener('pointerdown', e => {
    if (!started || finished) return;
    if (e.button !== 0 && e.button !== 2) return;
    if (!e.isPrimary) return; // second finger must not clobber the stroke
    const i = cellAt(e);
    if (i < 0) return;
    if (stroke) endStroke(); // commit any in-flight stroke before a new one
    e.preventDefault();
    clickGuard = performance.now();
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    const t = tool === 'tile' ? TILE : MARK;
    const eff = e.button === 2 ? (t === TILE ? MARK : TILE) : t;
    // Standard picross stroke semantics: the first cell decides.
    const action = state[i] === eff ? EMPTY : eff;
    stroke = { eff, action, changes: [], visited: new Set() };
    strokeCell(i);
  });

  boardEl.addEventListener('pointermove', e => {
    if (!stroke) return;
    const i = cellAt(e);
    if (i >= 0) strokeCell(i);
  });

  boardEl.addEventListener('pointerup', endStroke);
  boardEl.addEventListener('pointercancel', endStroke);

  // Keyboard activation (Enter/Space on a focused cell). Pointer taps
  // are already handled above, so skip clicks that follow a pointer.
  const onCellClick = e => {
    if (performance.now() - clickGuard < 450) return;
    if (!started || finished) return;
    const i = +e.currentTarget.dataset.idx;
    const t = tool === 'tile' ? TILE : MARK;
    const prev = state[i];
    state[i] = prev === t ? EMPTY : t;
    pushUndo([[i, prev]]);
    renderCell(i);
    refreshClues();
    if (checkSolved()) win();
  };

  const setTool = t => {
    tool = t;
    tileBtn.setAttribute('aria-pressed', String(t === 'tile'));
    markBtn.setAttribute('aria-pressed', String(t === 'mark'));
  };

  const undo = () => {
    if (!started || finished || undoStack.length === 0) return;
    const entry = undoStack.pop();
    for (let k = entry.length - 1; k >= 0; k--) {
      state[entry[k][0]] = entry[k][1];
      renderCell(entry[k][0]);
    }
    refreshClues();
  };

  const clearBoard = () => {
    if (!started || finished) return;
    const entry = [];
    for (let i = 0; i < CELLS; i++)
      if (state[i] !== EMPTY) {
        entry.push([i, state[i]]);
        state[i] = EMPTY;
        renderCell(i);
      }
    if (entry.length) { pushUndo(entry); refreshClues(); }
  };

  // ---- runs & winning -----------------------------------------------
  const newRun = () => {
    if (winTimeout) { clearTimeout(winTimeout); winTimeout = null; }
    puzzle = Logic.generate();
    state = new Uint8Array(CELLS);
    solFlat = new Uint8Array(CELLS);
    solCount = 0;
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        solFlat[r * SIZE + c] = puzzle.solution[r][c];
        solCount += puzzle.solution[r][c];
      }
    undoStack = [];
    stroke = null;
    finished = false;
    surrendered = false;
    buildBoard();
    buildClues();
    refreshAll();
    $('end-overlay').hidden = true;
    if (started) startTimer();
    else timerEl.textContent = '0:00';
  };

  const win = () => {
    if (finished) return;
    finished = true;
    stopTimer();
    const secs = Math.max(0.1,
      Math.round(((performance.now() - startTime) / 1000) * 10) / 10);

    boardEl.classList.add('won'); // brief reveal: the floor warms up
    refreshClues();

    $('end-time').textContent = fmtPrecise(secs);
    let res = null;
    if (!surrendered && window.Arena) res = Arena.submitScore(GAME_ID, secs); // once per run
    $('end-verdict').textContent = surrendered
      ? 'THE GODS RESTORE IT — NO SCORE'
      : (res && res.rank === 1 ? 'YOU SIT ATOP OLYMPUS' : 'MOSAIC RESTORED');
    $('pb-tag').hidden = !(res && res.improved);
    if (window.Arena) Arena.renderBoard($('standings'), GAME_ID);
    refreshBest();

    winTimeout = setTimeout(() => {
      winTimeout = null;
      $('end-overlay').hidden = false;
    }, REDUCED ? 250 : 1150);
  };

  const startRun = () => {
    $('start-overlay').hidden = true;
    document.body.classList.remove('prestart');
    started = true;
    startTimer();
    refreshClues();
  };

  // SOLVE: lay every tessera where it belongs and end the run — the
  // floor gets restored, but the score belongs to the gods.
  const surrender = () => {
    if (!started || finished) return;
    surrendered = true;
    endStroke();
    for (let i = 0; i < CELLS; i++) state[i] = solFlat[i] ? TILE : EMPTY;
    refreshAll();
    win();
  };

  // ---- keyboard -------------------------------------------------------
  const moveFocus = (dr, dc) => {
    const a = document.activeElement;
    let r = 0, c = 0;
    if (a && a.classList && a.classList.contains('cell')) {
      const i = +a.dataset.idx;
      r = Math.min(SIZE - 1, Math.max(0, ((i / SIZE) | 0) + dr));
      c = Math.min(SIZE - 1, Math.max(0, (i % SIZE) + dc));
    }
    cellEls[r * SIZE + c].focus();
  };

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!started) return;
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); moveFocus(-1, 0); break;
      case 'ArrowDown': e.preventDefault(); moveFocus(1, 0); break;
      case 'ArrowLeft': e.preventDefault(); moveFocus(0, -1); break;
      case 'ArrowRight': e.preventDefault(); moveFocus(0, 1); break;
      case 't': case 'T': setTool('tile'); break;
      case 'm': case 'M': setTool('mark'); break;
      case 'u': case 'U': undo(); break;
      case 'c': case 'C': clearBoard(); break;
      case 'n': case 'N': if (started && !finished) newRun(); break;
    }
  });

  // ---- wire up ---------------------------------------------------------
  $('start-btn').addEventListener('click', startRun);
  $('restart-btn').addEventListener('click', newRun);
  undoBtn.addEventListener('click', undo);
  clearBtn.addEventListener('click', clearBoard);
  newBtn.addEventListener('click', () => { if (started && !finished) newRun(); });
  solveBtn.addEventListener('click', surrender); // button only — no hotkey, too costly to fat-finger
  tileBtn.addEventListener('click', () => setTool('tile'));
  markBtn.addEventListener('click', () => setTool('mark'));

  // Veil the generated puzzle until START so nobody pre-studies the
  // clues while the clock is idle.
  document.body.classList.add('prestart');
  setTool('tile');
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
        for (let i = 0; i < CELLS; i++) state[i] = solFlat[i] ? TILE : EMPTY;
        refreshAll();
        if (checkSolved()) win();
      }
    };
  }
})();
