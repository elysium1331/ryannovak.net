/* =================================================================
   PANTHEON — six sacred seals · Olympus Arcade
   ryannovak.net

   A 6x6 picture sudoku. Six divine emblems; every row, every column
   and every 2x3 house seats each god exactly once. Exactly one
   solution. The clock keeps score.
   ================================================================= */
(() => {
  'use strict';

  // ================================================================
  // Pure logic — no DOM, no window access. Node-testable.
  // ================================================================
  const Logic = (() => {
    const SIZE = 6;          // grid is 6x6, symbols are 1..6 (0 = empty)
    const HOUSE_R = 2;       // each house spans 2 rows...
    const HOUSE_C = 3;       // ...and 3 columns -> six houses
    const MIN_GIVENS = 15;   // stop carving here; keeps it casual
    const ALL = 0b1111110;   // candidate bitmask for values 1..6

    const houseOf = (r, c) =>
      ((r / HOUSE_R) | 0) * 2 + ((c / HOUSE_C) | 0);

    const emptyGrid = () =>
      Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));

    const cloneGrid = g => g.map(row => row.slice());

    const shuffle = (arr, rng) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    };

    // Random full valid grid via randomized backtracking with
    // row/col/house bitmasks.
    const fullGrid = rng => {
      const grid = emptyGrid();
      const rowM = new Array(SIZE).fill(0);
      const colM = new Array(SIZE).fill(0);
      const houseM = new Array(SIZE).fill(0);
      const vals = [1, 2, 3, 4, 5, 6];
      const bt = idx => {
        if (idx === SIZE * SIZE) return true;
        const r = (idx / SIZE) | 0, c = idx % SIZE, h = houseOf(r, c);
        const order = shuffle(vals, rng);
        for (let k = 0; k < SIZE; k++) {
          const v = order[k], bit = 1 << v;
          if ((rowM[r] | colM[c] | houseM[h]) & bit) continue;
          grid[r][c] = v; rowM[r] |= bit; colM[c] |= bit; houseM[h] |= bit;
          if (bt(idx + 1)) return true;
          grid[r][c] = 0; rowM[r] &= ~bit; colM[c] &= ~bit; houseM[h] &= ~bit;
        }
        return false;
      };
      bt(0);
      return grid;
    };

    const popcount = x => {
      let n = 0;
      while (x) { x &= x - 1; n++; }
      return n;
    };

    // Count completions of `givens` under the rules, stopping at
    // `cap`. MRV cell ordering keeps this near-instant on 6x6.
    const countSolutions = (givens, cap) => {
      const grid = cloneGrid(givens);
      const rowM = new Array(SIZE).fill(0);
      const colM = new Array(SIZE).fill(0);
      const houseM = new Array(SIZE).fill(0);
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++) {
          const v = grid[r][c];
          if (v === 0) continue;
          const bit = 1 << v, h = houseOf(r, c);
          if ((rowM[r] | colM[c] | houseM[h]) & bit) return 0; // broken givens
          rowM[r] |= bit; colM[c] |= bit; houseM[h] |= bit;
        }
      let count = 0;
      const bt = () => {
        if (count >= cap) return;
        let br = -1, bc = -1, bMask = 0, bN = SIZE + 1;
        for (let r = 0; r < SIZE; r++)
          for (let c = 0; c < SIZE; c++) {
            if (grid[r][c] !== 0) continue;
            const mask = ALL & ~(rowM[r] | colM[c] | houseM[houseOf(r, c)]);
            const n = popcount(mask);
            if (n === 0) return;                 // dead end
            if (n < bN) { bN = n; br = r; bc = c; bMask = mask; }
          }
        if (br === -1) { count++; return; }       // grid full
        const h = houseOf(br, bc);
        for (let v = 1; v <= SIZE; v++) {
          const bit = 1 << v;
          if (!(bMask & bit)) continue;
          grid[br][bc] = v; rowM[br] |= bit; colM[bc] |= bit; houseM[h] |= bit;
          bt();
          grid[br][bc] = 0; rowM[br] &= ~bit; colM[bc] &= ~bit; houseM[h] &= ~bit;
          if (count >= cap) return;
        }
      };
      bt();
      return count;
    };

    // Is `grid` a complete, correct solution of `puzzle`?
    const validate = (puzzle, grid) => {
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++) {
          const v = grid[r][c];
          if (!(v >= 1 && v <= SIZE)) return false;
          if (puzzle.givens[r][c] !== 0 && v !== puzzle.givens[r][c]) return false;
        }
      for (let i = 0; i < SIZE; i++) {
        let rowM = 0, colM = 0, houseM = 0;
        const hr = ((i / 2) | 0) * HOUSE_R, hc = (i % 2) * HOUSE_C;
        for (let j = 0; j < SIZE; j++) {
          rowM |= 1 << grid[i][j];
          colM |= 1 << grid[j][i];
          houseM |= 1 << grid[hr + ((j / HOUSE_C) | 0)][hc + (j % HOUSE_C)];
        }
        if (rowM !== ALL || colM !== ALL || houseM !== ALL) return false;
      }
      return true;
    };

    // Duplicate report for a partial grid — for gentle live
    // highlighting. cells[r][c] is true when that cell's value is
    // duplicated in its row, column or house.
    const conflicts = grid => {
      const cells = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));
      const rows = [], cols = [], houses = [];
      const scan = (unitCells, listOut, unitIdx) => {
        const seen = new Array(SIZE + 1).fill(0);
        for (const [r, c] of unitCells) seen[grid[r][c]]++;
        let dup = false;
        for (const [r, c] of unitCells) {
          const v = grid[r][c];
          if (v !== 0 && seen[v] > 1) { cells[r][c] = true; dup = true; }
        }
        if (dup) listOut.push(unitIdx);
      };
      for (let i = 0; i < SIZE; i++) {
        scan(Array.from({ length: SIZE }, (_, j) => [i, j]), rows, i);
        scan(Array.from({ length: SIZE }, (_, j) => [j, i]), cols, i);
        const hr = ((i / 2) | 0) * HOUSE_R, hc = (i % 2) * HOUSE_C;
        scan(Array.from({ length: SIZE },
          (_, j) => [hr + ((j / HOUSE_C) | 0), hc + (j % HOUSE_C)]), houses, i);
      }
      return { cells, rows, cols, houses };
    };

    // Placed count per symbol (givens included): counts[v] for v 1..6.
    const counts = grid => {
      const n = new Array(SIZE + 1).fill(0);
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
          if (grid[r][c] !== 0) n[grid[r][c]]++;
      return n;
    };

    // Generate a puzzle with EXACTLY ONE solution:
    // 1. Backtrack a random full valid grid.
    // 2. Remove cells one at a time in random order; a removal that
    //    breaks uniqueness (counting solver, cap 2) is put back.
    // 3. Stop at MIN_GIVENS remaining, or when the order is spent.
    const generate = (rng = Math.random) => {
      const solution = fullGrid(rng);
      const givens = cloneGrid(solution);
      let remaining = SIZE * SIZE;
      const order = shuffle(
        Array.from({ length: SIZE * SIZE }, (_, i) => i), rng);
      for (const idx of order) {
        if (remaining <= MIN_GIVENS) break;
        const r = (idx / SIZE) | 0, c = idx % SIZE;
        const v = givens[r][c];
        givens[r][c] = 0;
        if (countSolutions(givens, 2) !== 1) givens[r][c] = v;
        else remaining--;
      }
      return { size: SIZE, givens, solution };
    };

    return {
      SIZE, MIN_GIVENS, houseOf,
      generate, validate, conflicts, counts, countSolutions,
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
  const SIZE = Logic.SIZE;
  const GAME_ID = 'pantheon';

  const boardEl = $('board');
  const trayEl = $('tray');
  const statusEl = $('status');
  const timerEl = $('timer');
  const bestEl = $('best');
  const undoBtn = $('undo-btn');
  const clearBtn = $('clear-btn');
  const newBtn = $('new-btn');

  // ---- the six divine emblems (24x24 silhouettes) ----------------
  const svg = inner =>
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + inner + '</svg>';

  const EMBLEMS = {
    1: { // Zeus — thunderbolt (the Olympus bolt)
      label: 'Zeus — thunderbolt',
      svg: svg('<path fill="currentColor" d="M13.2 1.8 3.6 13.9h6.1L8.2 22.2 18.9 9.6h-6.4l2.6-7.8z"/>')
    },
    2: { // Poseidon — trident
      label: 'Poseidon — trident',
      svg: svg('<path fill="currentColor" d="M12 1.5 15.8 5.3 14.5 6.6 12.9 5V12.1c2-.4 3.5-2.1 3.5-4.2V6.3h1.8v1.6c0 3.1-2.3 5.6-5.3 6V22.5h-1.8V13.9c-3-.4-5.3-2.9-5.3-6V6.3h1.8v1.6c0 2.1 1.5 3.8 3.5 4.2V5L9.5 6.6 8.2 5.3Z"/>')
    },
    3: { // Athena — owl
      label: 'Athena — owl',
      svg: svg('<path fill="currentColor" fill-rule="evenodd" d="M6.2 3.2 9.4 5.7C10.2 5.4 11.1 5.2 12 5.2s1.8.2 2.6.5l3.2-2.5v5.5c1 1.6 1.6 3.4 1.6 5.3 0 4.6-3.1 8-7.4 8s-7.4-3.4-7.4-8c0-1.9.6-3.7 1.6-5.3ZM9.5 9.2a1.95 1.95 0 1 0 0 3.9 1.95 1.95 0 0 0 0-3.9Zm5 0a1.95 1.95 0 1 0 0 3.9 1.95 1.95 0 0 0 0-3.9ZM12 13.2l1.4 1.7-1.4 1.9-1.4-1.9Z"/>')
    },
    4: { // Apollo — lyre
      label: 'Apollo — lyre',
      svg: svg('<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M6.2 2.9c2.2 1.3 3.1 3.3 3.1 5.9v4.4a2.7 2.7 0 0 0 5.4 0V8.8c0-2.6.9-4.6 3.1-5.9"/>' +
        '<path d="M7.4 7.6h9.2"/>' +
        '<path d="M10.3 7.6v7.4M12 7.6v8.2M13.7 7.6v7.4"/>' +
        '<path d="M12 15.9v5M9.3 20.9h5.4"/></g>')
    },
    5: { // Ares — crested helm
      label: 'Ares — crested helm',
      svg: svg('<path fill="currentColor" fill-rule="evenodd" d="M4.4 9.9C5.6 4.7 9.9 1.4 14.9 2.2c3.1.5 5.7 2.4 7 5.2l-2-.2c-1.5-2-3.9-3.3-6.6-3.3-3.7 0-6.7 2.5-7.4 6.3ZM6.6 12c0-4.4 2.6-7.1 6-7.1s6 2.7 6 7.1v8.6l-2.8 1-.4-5.6-3.5.6-1.5 5.2-2.1-1.6v-5.3l-1.4-.6Zm1 -.8h3.8v1.4H7.6Z"/>')
    },
    6: { // Dionysus — grape cluster
      label: 'Dionysus — grapes',
      svg: svg('<g fill="currentColor">' +
        '<path d="M11.3 8.9c-.3-2.1.3-3.9 1.9-5.4l1.2 1.2c-1.2 1.1-1.7 2.4-1.4 4z"/>' +
        '<path d="M13.6 6.2c.9-2 3-3.1 5.6-2.8-.2 2.6-1.8 4.4-4 4.7-.8.1-1.4 0-2-.3z"/>' +
        '<circle cx="7.3" cy="11.4" r="2.6"/><circle cx="12" cy="11.4" r="2.6"/><circle cx="16.7" cy="11.4" r="2.6"/>' +
        '<circle cx="9.6" cy="15.6" r="2.6"/><circle cx="14.4" cy="15.6" r="2.6"/>' +
        '<circle cx="12" cy="19.8" r="2.6"/></g>')
    }
  };

  const ERASE_SVG = svg('<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M13.9 4.9a2 2 0 0 1 2.8 0l2.4 2.4a2 2 0 0 1 0 2.8l-8.7 8.7H6.2l-2.1-2.1a2 2 0 0 1 0-2.8Z"/>' +
    '<path d="m10.7 8.1 5.2 5.2"/><path d="M6 19h14"/></g>');

  // ---- state -----------------------------------------------------
  let puzzle = null;
  let grid = null;
  let cellEls = [];    // [r][c] -> button
  let slotEls = {};    // tool id (0..6) -> tray button
  let tool = 1;        // 1..6 emblem, 0 eraser
  let undoStack = [];  // entries: arrays of [r, c, prevValue]
  let started = false;
  let finished = false;
  let startTime = 0;
  let timerId = null;

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

  // ---- tray --------------------------------------------------------
  const selectTool = k => {
    tool = k;
    for (const id in slotEls)
      slotEls[id].setAttribute('aria-pressed', String(+id === k));
  };

  const buildTray = () => {
    trayEl.innerHTML = '';
    slotEls = {};
    for (let v = 1; v <= SIZE; v++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot g' + v;
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = EMBLEMS[v].svg + '<span class="slot-count">6</span>';
      b.addEventListener('click', () => selectTool(v));
      trayEl.appendChild(b);
      slotEls[v] = b;
    }
    const e = document.createElement('button');
    e.type = 'button';
    e.className = 'slot erase';
    e.setAttribute('aria-pressed', 'false');
    e.setAttribute('aria-label', 'Eraser — key E');
    e.innerHTML = ERASE_SVG;
    e.addEventListener('click', () => selectTool(0));
    trayEl.appendChild(e);
    slotEls[0] = e;
    selectTool(tool);
  };

  // ---- board construction ------------------------------------------
  const cellLabel = (r, c) => {
    const v = grid[r][c];
    const what = v === 0 ? 'empty' : EMBLEMS[v].label;
    const lock = puzzle.givens[r][c] !== 0 ? ', locked' : '';
    return 'Row ' + (r + 1) + ', column ' + (c + 1) + ': ' + what + lock;
  };

  const buildBoard = () => {
    boardEl.innerHTML = '';
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
        if (c === 2) b.classList.add('hb-r');           // house wall after col 3
        if (r === 1 || r === 3) b.classList.add('hb-b'); // house floor after rows 2, 4
        b.addEventListener('click', () => onCellTap(r, c));
        boardEl.appendChild(b);
        cellEls[r].push(b);
      }
    }
  };

  // ---- rendering -----------------------------------------------------
  const refresh = () => {
    const vio = Logic.conflicts(grid);
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        const b = cellEls[r][c];
        const v = grid[r][c];
        if (b.dataset.sym !== String(v)) {
          b.innerHTML = v === 0 ? '' : EMBLEMS[v].svg;
          b.dataset.sym = String(v);
          b.className = b.className.replace(/\bg[1-6]\b\s*/g, '').trim();
          if (v !== 0) b.classList.add('g' + v);
        }
        b.classList.toggle('err', vio.cells[r][c]);
        b.setAttribute('aria-label', cellLabel(r, c));
      }

    const n = Logic.counts(grid);
    for (let v = 1; v <= SIZE; v++) {
      const left = Math.max(0, SIZE - n[v]);
      const slot = slotEls[v];
      slot.querySelector('.slot-count').textContent = String(left);
      slot.classList.toggle('depleted', left === 0);
      slot.setAttribute('aria-label',
        EMBLEMS[v].label + ' — ' + left + ' remaining, key ' + v);
    }

    const parts = [];
    for (const i of vio.rows) parts.push('ROW ' + (i + 1));
    for (const i of vio.cols) parts.push('COL ' + (i + 1));
    for (const i of vio.houses) parts.push('HOUSE ' + (i + 1));
    statusEl.textContent = parts.length ? 'DOUBLED → ' + parts.join(' · ') : '';
    statusEl.classList.toggle('bad', parts.length > 0);

    undoBtn.disabled = undoStack.length === 0 || finished;
    clearBtn.disabled = finished;
  };

  // ---- interaction -----------------------------------------------------
  const pushUndo = entry => {
    undoStack.push(entry);
    if (undoStack.length > 600) undoStack.shift();
  };

  const onCellTap = (r, c) => {
    if (!started || finished || puzzle.givens[r][c] !== 0) return;
    const prev = grid[r][c];
    const next = (tool === 0 || prev === tool) ? 0 : tool; // re-tap lifts
    if (next === prev) return;
    grid[r][c] = next;
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

  // ---- runs & winning -----------------------------------------------
  const newRun = () => {
    puzzle = Logic.generate();
    grid = Logic.cloneGrid(puzzle.givens);
    undoStack = [];
    finished = false;
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
      statusEl.textContent =
        statusEl.textContent || 'FULL, BUT THE GODS ARE QUARRELING — RECHECK';
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
      res && res.rank === 1 ? 'YOU SIT ATOP OLYMPUS' : 'THE PANTHEON IS SEALED';
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
    const k = e.key;
    if (k >= '1' && k <= '6') { selectTool(+k); return; }
    if (k === '0' || k === 'e' || k === 'E') { selectTool(0); return; }
    switch (k) {
      case 'ArrowUp': e.preventDefault(); moveFocus(-1, 0); break;
      case 'ArrowDown': e.preventDefault(); moveFocus(1, 0); break;
      case 'ArrowLeft': e.preventDefault(); moveFocus(0, -1); break;
      case 'ArrowRight': e.preventDefault(); moveFocus(0, 1); break;
      case 'u': case 'U': undo(); break;
      case 'c': case 'C': clearBoard(); break;
      case 'n': case 'N': if (!$('end-overlay').hidden) break; newRun(); break;
    }
  });

  // ---- wire up ---------------------------------------------------------
  $('start-btn').addEventListener('click', startRun);
  $('restart-btn').addEventListener('click', newRun);
  undoBtn.addEventListener('click', undo);
  clearBtn.addEventListener('click', clearBoard);
  newBtn.addEventListener('click', () => { if (started && !finished) newRun(); });

  // Veil the generated board until START so nobody pre-studies the
  // puzzle while the clock is idle.
  document.body.classList.add('prestart');
  buildTray();
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
