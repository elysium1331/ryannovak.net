/* =================================================================
   QUIVER — a tap-away arrow puzzle · Olympus Arcade
   ryannovak.net

   7x7 field strewn with arrows. Tap one to loose it: it flies off
   the board in the direction it points, but only if no other arrow
   sits anywhere on its straight path to the edge. Boards are built
   by reverse insertion — every arrow's path was clear the moment it
   was placed — so firing in reverse insertion order always clears
   the board. And since loosing an arrow only vacates a cell, no
   move can ever block another: the field never dead-ends. Clear
   every arrow; the clock keeps score.
   ================================================================= */
(() => {
  'use strict';

  // ================================================================
  // Pure logic — no DOM, no window access. Node-testable.
  // ================================================================
  const Logic = (() => {
    const SIZE = 7;
    const CELLS = SIZE * SIZE;
    const EMPTY = -1;
    const MIN_ARROWS = 40;
    const MAX_ARROWS = 46;
    const MAX_FREE_RATIO = 0.35; // openings stay scarce — play needs scanning

    // directions: 0 up, 1 right, 2 down, 3 left
    const DR = [-1, 0, 1, 0];
    const DC = [0, 1, 0, -1];

    // Deterministic PRNG for seeded boards (same flavour as siblings)
    const mulberry32 = seed => () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const shuffle = (a, rng) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    };

    // How many cells lie between (r,c) and the edge in direction d
    const runLength = (r, c, d) =>
      d === 0 ? r : d === 1 ? SIZE - 1 - c : d === 2 ? SIZE - 1 - r : c;

    // Is the straight flight path from idx to the edge, heading d,
    // free of arrows?
    const pathClear = (cells, idx, d) => {
      let r = (idx / SIZE) | 0, c = idx % SIZE;
      for (;;) {
        r += DR[d]; c += DC[d];
        if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return true;
        if (cells[r * SIZE + c] !== EMPTY) return false;
      }
    };

    // First arrow sitting on idx's flight path, or -1 if none
    const firstBlocker = (cells, idx) => {
      const d = cells[idx];
      if (d === EMPTY) return -1;
      let r = (idx / SIZE) | 0, c = idx % SIZE;
      for (;;) {
        r += DR[d]; c += DC[d];
        if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return -1;
        if (cells[r * SIZE + c] !== EMPTY) return r * SIZE + c;
      }
    };

    const canFire = (cells, idx) =>
      cells[idx] !== EMPTY && pathClear(cells, idx, cells[idx]);

    // Loose the arrow at idx. Mutates: vacates the cell if the shot
    // is free. Returns whether it flew.
    const fire = (cells, idx) => {
      if (!canFire(cells, idx)) return false;
      cells[idx] = EMPTY;
      return true;
    };

    const remaining = cells => {
      let n = 0;
      for (let i = 0; i < CELLS; i++) if (cells[i] !== EMPTY) n++;
      return n;
    };

    const freeCount = cells => {
      let n = 0;
      for (let i = 0; i < CELLS; i++) if (canFire(cells, i)) n++;
      return n;
    };

    // Full clearing order via greedy simulation, or null if stuck.
    // Greedy suffices: loosing an arrow only vacates a cell, so a
    // free arrow can never become blocked — if any clearing order
    // exists, every greedy order completes.
    const solveOrder = cells => {
      const work = cells.slice();
      const order = [];
      let left = remaining(work);
      while (left > 0) {
        let fired = 0;
        for (let i = 0; i < CELLS; i++) {
          if (work[i] !== EMPTY && pathClear(work, i, work[i])) {
            work[i] = EMPTY;
            order.push(i);
            fired++; left--;
          }
        }
        if (!fired) return null;
      }
      return order;
    };

    // One reverse-insertion pass. Each arrow is placed on an empty
    // cell pointing along a currently clear path to the edge, which
    // guarantees the finished board clears in reverse insertion
    // order. Cells that can still take a non-trivial shot (path
    // length >= 1) are preferred, and directions are weighted toward
    // longer flight paths, so later insertions land on those paths
    // and keep the count of immediately-loose arrows low.
    const buildOnce = rng => {
      const cells = new Array(CELLS).fill(EMPTY);
      let placed = 0;
      const empties = [];
      const dirs = [];
      const weights = [];
      while (placed < MAX_ARROWS) {
        empties.length = 0;
        for (let i = 0; i < CELLS; i++) if (cells[i] === EMPTY) empties.push(i);
        shuffle(empties, rng);
        let chosen = -1, trivial = -1;
        for (let k = 0; k < empties.length; k++) {
          const i = empties[k];
          const r = (i / SIZE) | 0, c = i % SIZE;
          let inward = false, any = false;
          for (let d = 0; d < 4; d++) {
            if (!pathClear(cells, i, d)) continue;
            any = true;
            if (runLength(r, c, d) > 0) { inward = true; break; }
          }
          if (inward) { chosen = i; break; }
          if (any && trivial < 0) trivial = i; // only zero-length shots left here
        }
        if (chosen < 0) chosen = trivial;
        if (chosen < 0) break; // nowhere left to insert
        const r = (chosen / SIZE) | 0, c = chosen % SIZE;
        dirs.length = 0; weights.length = 0;
        let totalW = 0;
        for (let d = 0; d < 4; d++) {
          if (!pathClear(cells, chosen, d)) continue;
          const len = runLength(r, c, d);
          const w = len === 0 ? 0.2 : len * len;
          dirs.push(d); weights.push(w); totalW += w;
        }
        let d = dirs[dirs.length - 1];
        let pick = rng() * totalW;
        for (let j = 0; j < dirs.length; j++) {
          pick -= weights[j];
          if (pick < 0) { d = dirs[j]; break; }
        }
        cells[chosen] = d;
        placed++;
      }
      return cells;
    };

    // Generate a board: >= MIN_ARROWS arrows, and at most
    // MAX_FREE_RATIO of them loose from the first tap.
    const generate = seed => {
      const rng = seed == null ? Math.random : mulberry32(seed);
      let best = null, bestScore = Infinity;
      for (let attempt = 0; attempt < 500; attempt++) {
        const cells = buildOnce(rng);
        const total = remaining(cells);
        const free = freeCount(cells);
        if (total >= MIN_ARROWS && free <= total * MAX_FREE_RATIO) {
          return { size: SIZE, cells, total };
        }
        // Safety net (never observed in testing): keep the least-bad
        // board in case every attempt misses a gate.
        const score = Math.max(0, MIN_ARROWS - total) * 100 +
          free / Math.max(1, total);
        if (score < bestScore) {
          bestScore = score;
          best = { size: SIZE, cells, total };
        }
      }
      return best;
    };

    return {
      SIZE, EMPTY, MIN_ARROWS, MAX_ARROWS, MAX_FREE_RATIO,
      generate, canFire, fire, remaining, freeCount, solveOrder,
      firstBlocker, mulberry32
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
  const SIZE = Logic.SIZE, EMPTY = Logic.EMPTY;
  const CELLS = SIZE * SIZE;
  const GAME_ID = 'quiver';

  const DIR_CLASS = ['u', 'r', 'd', 'l'];
  const DIR_WORD = ['up', 'right', 'down', 'left'];
  const DR = [-1, 0, 1, 0];
  const DC = [0, 1, 0, -1];
  const FLY_MS = 180;
  const FLASH_MS = 260;

  const boardEl = $('board');
  const statusEl = $('status');
  const timerEl = $('timer');
  const bestEl = $('best');
  const leftEl = $('left');
  const totalEl = $('total');
  const newBtn = $('new-btn');

  // One chevron-arrow path, pointing up; rotated per direction in CSS
  const ARROW_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" ' +
    'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ' +
    'stroke-linejoin="round"><path d="M12 20V5M5.5 11.5 12 5l6.5 6.5"/></svg>';

  // ---- state -----------------------------------------------------
  let cells = null;       // flat 49-cell board, EMPTY or direction
  let total = 0;
  let left = 0;
  let cellEls = [];       // idx -> button
  let started = false;
  let finished = false;
  let startTime = 0;
  let timerId = null;
  let cursor = (CELLS / 2) | 0; // roving-tabindex position

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
  const cellLabel = i => {
    const r = ((i / SIZE) | 0) + 1, c = (i % SIZE) + 1;
    const v = cells[i];
    return 'Row ' + r + ', column ' + c + ': ' +
      (v === EMPTY ? 'empty' : 'arrow pointing ' + DIR_WORD[v]);
  };

  const setCursor = i => {
    if (cellEls[cursor]) cellEls[cursor].tabIndex = -1;
    cursor = i;
    if (cellEls[cursor]) cellEls[cursor].tabIndex = 0;
  };

  const buildBoard = () => {
    boardEl.innerHTML = '';
    cellEls = [];
    for (let i = 0; i < CELLS; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.dataset.i = i;
      if (cells[i] === EMPTY) {
        b.className = 'cell empty';
      } else {
        b.className = 'cell arrow';
        const g = document.createElement('span');
        g.className = 'glyph dir-' + DIR_CLASS[cells[i]];
        g.innerHTML = ARROW_SVG;
        b.appendChild(g);
      }
      b.setAttribute('aria-label', cellLabel(i));
      b.addEventListener('click', () => onCellTap(i));
      boardEl.appendChild(b);
      cellEls.push(b);
    }
    setCursor(cursor);
  };

  // ---- effects -------------------------------------------------------
  // The board state is already updated when these run; they are pure
  // decoration and never gate input.
  const flyOff = (i, d) => {
    const b = cellEls[i];
    const g = b.firstChild;
    b.className = 'cell empty';
    b.setAttribute('aria-label', cellLabel(i));
    if (!g) return;
    const r = (i / SIZE) | 0, c = i % SIZE;
    const dist = (d === 0 ? r : d === 1 ? SIZE - 1 - c :
      d === 2 ? SIZE - 1 - r : c) + 1.75;
    g.style.setProperty('--fx', (DC[d] * dist * 100) + '%');
    g.style.setProperty('--fy', (DR[d] * dist * 100) + '%');
    g.classList.add('fly');
    setTimeout(() => { if (g.parentNode) g.parentNode.removeChild(g); }, FLY_MS + 70);
  };

  const flash = i => {
    const b = cellEls[i];
    if (!b) return;
    b.classList.remove('deny');
    void b.offsetWidth; // restart the tint if it is already running
    b.classList.add('deny');
    clearTimeout(b._denyT);
    b._denyT = setTimeout(() => b.classList.remove('deny'), FLASH_MS);
  };

  const bump = (i, d) => {
    const b = cellEls[i];
    const g = b.firstChild;
    if (g) {
      g.classList.remove('bump');
      void g.offsetWidth;
      g.style.setProperty('--bx', (DC[d] * 16) + '%');
      g.style.setProperty('--by', (DR[d] * 16) + '%');
      g.classList.add('bump');
    }
    flash(i);
  };

  // ---- interaction -----------------------------------------------------
  const onCellTap = i => {
    if (!started || finished) return;
    setCursor(i);
    if (cells[i] === EMPTY) return;
    if (Logic.canFire(cells, i)) {
      const d = cells[i];
      cells[i] = EMPTY; // logic first — the animation never blocks taps
      left--;
      leftEl.textContent = left;
      flyOff(i, d);
      statusEl.textContent = '';
      statusEl.classList.remove('bad');
      if (left === 0) win();
    } else {
      const blocker = Logic.firstBlocker(cells, i);
      bump(i, cells[i]);
      if (blocker >= 0) flash(blocker);
      statusEl.textContent = 'PATH BLOCKED';
      statusEl.classList.add('bad');
    }
  };

  // ---- runs & winning -----------------------------------------------
  const newRun = () => {
    const board = Logic.generate();
    cells = board.cells;
    total = board.total;
    left = total;
    finished = false;
    totalEl.textContent = total;
    leftEl.textContent = left;
    statusEl.textContent = '';
    statusEl.classList.remove('bad');
    buildBoard();
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
    $('end-time').textContent = fmtPrecise(secs);
    let res = null;
    if (window.Arena) res = Arena.submitScore(GAME_ID, secs); // once per run
    $('end-verdict').textContent =
      res && res.rank === 1 ? 'YOU SIT ATOP OLYMPUS' : 'QUIVER EMPTIED';
    $('pb-tag').hidden = !(res && res.improved);
    if (window.Arena) Arena.renderBoard($('standings'), GAME_ID);
    refreshBest();
    $('end-overlay').hidden = false;
  };

  const startRun = () => {
    $('start-overlay').hidden = true;
    document.body.classList.remove('prestart');
    started = true;
    startTimer();
  };

  // ---- keyboard -------------------------------------------------------
  const moveCursor = (dr, dc) => {
    let r = (cursor / SIZE) | 0, c = cursor % SIZE;
    const a = document.activeElement;
    if (a && a.classList && a.classList.contains('cell')) {
      const i = +a.dataset.i;
      r = (i / SIZE) | 0; c = i % SIZE;
    }
    r = Math.min(SIZE - 1, Math.max(0, r + dr));
    c = Math.min(SIZE - 1, Math.max(0, c + dc));
    setCursor(r * SIZE + c);
    cellEls[cursor].focus();
  };

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!started || finished) return; // no cursor moves behind the end overlay
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); moveCursor(-1, 0); break;
      case 'ArrowDown': e.preventDefault(); moveCursor(1, 0); break;
      case 'ArrowLeft': e.preventDefault(); moveCursor(0, -1); break;
      case 'ArrowRight': e.preventDefault(); moveCursor(0, 1); break;
      case 'Enter': case ' ': {
        // A focused button or link handles its own Enter/Space; only
        // fire the cursor cell when nothing actionable holds focus.
        const a = document.activeElement;
        const busy = a && (a.tagName === 'BUTTON' || a.tagName === 'A');
        if (!busy) {
          e.preventDefault();
          onCellTap(cursor);
          if (cellEls[cursor]) cellEls[cursor].focus();
        }
        break;
      }
      case 'n': case 'N':
        if (!$('end-overlay').hidden) break;
        newRun();
        break;
    }
  });

  // ---- wire up ---------------------------------------------------------
  $('start-btn').addEventListener('click', startRun);
  $('restart-btn').addEventListener('click', newRun);
  newBtn.addEventListener('click', () => { if (started && !finished) newRun(); });

  // Veil the generated board until START so nobody pre-scans the
  // field while the clock is idle.
  document.body.classList.add('prestart');
  newRun();
  refreshBest();

  // ---- debug hook (?debug) ---------------------------------------------
  if (new URLSearchParams(location.search).has('debug')) {
    window.__debug = {
      get board() { return cells; },
      get solution() { return Logic.solveOrder(cells); },
      solve: () => {
        if (!started) startRun();
        if (finished) return;
        const order = Logic.solveOrder(cells);
        if (!order) return;
        for (const i of order) onCellTap(i); // real fire/win path
      }
    };
  }
})();
