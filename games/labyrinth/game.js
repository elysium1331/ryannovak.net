/* =================================================================
   LABYRINTH — a Zip-style path puzzle for the Olympus Arcade
   One unbroken thread: 1 → 7, every cell exactly once.
   ================================================================= */

(() => {
  'use strict';

  // ----------------------------------------------------------------
  // Pure logic: NO DOM, NO window access in this block.
  // ----------------------------------------------------------------
  const Logic = (() => {
    const W = 6, H = 6, N = W * H;
    const WAYPOINTS = 7;

    const rowOf = i => Math.floor(i / W);
    const colOf = i => i % W;

    // Precomputed orthogonal adjacency
    const NEI = (() => {
      const out = [];
      for (let i = 0; i < N; i++) {
        const r = rowOf(i), c = colOf(i), n = [];
        if (r > 0) n.push(i - W);
        if (r < H - 1) n.push(i + W);
        if (c > 0) n.push(i - 1);
        if (c < W - 1) n.push(i + 1);
        out.push(n);
      }
      return out;
    })();

    const adjacent = (a, b) => NEI[a].indexOf(b) !== -1;

    // Deterministic PRNG (mulberry32) so puzzles are seedable/testable
    const mulberry32 = seed => {
      let s = seed >>> 0;
      return () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };

    // Random Hamiltonian path on the 6x6 grid: randomized backtracking
    // with a Warnsdorff-style least-degree heuristic, step budget + retry.
    const hamiltonianPath = rand => {
      for (let attempt = 0; attempt < 400; attempt++) {
        const start = Math.floor(rand() * N);
        const visited = new Uint8Array(N);
        const path = [start];
        visited[start] = 1;
        let steps = 0;
        const BUDGET = 4000;

        const dfs = cur => {
          if (path.length === N) return true;
          if (++steps > BUDGET) return false;
          const cands = [];
          for (let i = 0; i < NEI[cur].length; i++) {
            const n = NEI[cur][i];
            if (visited[n]) continue;
            let deg = 0;
            for (let j = 0; j < NEI[n].length; j++) {
              if (!visited[NEI[n][j]]) deg++;
            }
            cands.push({ n, deg, tie: rand() });
          }
          cands.sort((a, b) => a.deg - b.deg || a.tie - b.tie);
          for (let i = 0; i < cands.length; i++) {
            const c = cands[i];
            visited[c.n] = 1;
            path.push(c.n);
            if (dfs(c.n)) return true;
            visited[c.n] = 0;
            path.pop();
          }
          return false;
        };

        if (dfs(start)) return path;
      }
      // Deterministic fallback: serpentine sweep (always a valid H-path).
      const p = [];
      for (let r = 0; r < H; r++) {
        for (let c = 0; c < W; c++) {
          p.push(r * W + (r % 2 ? W - 1 - c : c));
        }
      }
      return p;
    };

    // 5 interior waypoint positions along the path: roughly evenly
    // spaced with jitter, strictly increasing, clear of both ends.
    const interiorIndices = rand => {
      const idxs = [];
      let prev = 0;
      for (let k = 1; k <= WAYPOINTS - 2; k++) {
        let pos = Math.round((k * (N - 1)) / (WAYPOINTS - 1) + (rand() * 4 - 2));
        const maxAllowed = (N - 1) - 2 * (WAYPOINTS - 1 - k);
        pos = Math.max(prev + 2, Math.min(pos, maxAllowed));
        idxs.push(pos);
        prev = pos;
      }
      return idxs;
    };

    // generate(seed?) -> { size, waypoints: [{cell, label}], solution }
    const generate = seed => {
      const rand = seed == null
        ? mulberry32((Math.random() * 0xffffffff) >>> 0)
        : mulberry32(seed >>> 0);
      const solution = hamiltonianPath(rand);
      const waypoints = [{ cell: solution[0], label: 1 }];
      const interior = interiorIndices(rand);
      for (let i = 0; i < interior.length; i++) {
        waypoints.push({ cell: solution[interior[i]], label: i + 2 });
      }
      waypoints.push({ cell: solution[N - 1], label: WAYPOINTS });
      return { size: W, waypoints, solution };
    };

    // Full rules check. The game uses this same validator for the win test.
    // path = array of cell indices.
    const validate = (puzzle, path) => {
      if (!puzzle || !Array.isArray(puzzle.waypoints) || !Array.isArray(path)) return false;
      if (path.length !== N) return false;
      const seen = new Uint8Array(N);
      for (let i = 0; i < path.length; i++) {
        const c = path[i];
        if (!Number.isInteger(c) || c < 0 || c >= N || seen[c]) return false;
        seen[c] = 1;
      }
      for (let i = 1; i < N; i++) {
        if (!adjacent(path[i - 1], path[i])) return false;
      }
      const labelOf = new Map();
      for (let i = 0; i < puzzle.waypoints.length; i++) {
        labelOf.set(puzzle.waypoints[i].cell, puzzle.waypoints[i].label);
      }
      if (labelOf.get(path[0]) !== 1) return false;
      if (labelOf.get(path[N - 1]) !== WAYPOINTS) return false;
      let expect = 1;
      for (let i = 0; i < path.length; i++) {
        const l = labelOf.get(path[i]);
        if (l !== undefined) {
          if (l !== expect) return false;
          expect++;
        }
      }
      return expect === WAYPOINTS + 1;
    };

    return { W, H, N, WAYPOINTS, NEI, adjacent, rowOf, colOf, generate, validate };
  })();

  // Headless (node) export for tests; browsers continue to the shell.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logic;
    return;
  }

  // ----------------------------------------------------------------
  // DOM / game shell
  // ----------------------------------------------------------------
  const GAME_ID = 'labyrinth';
  const $ = id => document.getElementById(id);

  const boardEl = $('board');
  const cellsEl = $('cells');
  const glowEl = $('thread-glow');
  const lineEl = $('thread-line');
  const headEl = $('thread-head');
  const timeEl = $('time');
  const wpEl = $('wp-count');
  const cellCountEl = $('cell-count');
  const bestEl = $('best');
  const undoBtn = $('btn-undo');
  const clearBtn = $('btn-clear');
  const newBtn = $('btn-new');
  const startOverlay = $('start-overlay');
  const endOverlay = $('end-overlay');
  const startBtn = $('start-btn');
  const againBtn = $('again-btn');

  let puzzle = null;
  let labelByCell = new Map();
  let startCell = 0;
  let path = [];
  let cellNodes = [];
  let playing = false;
  let finished = false;
  let submitted = false;
  let dragging = false;
  let startAt = 0;
  let timerId = null;

  // ---------------- Rendering ----------------

  const buildBoard = () => {
    cellsEl.innerHTML = '';
    cellNodes = [];
    for (let i = 0; i < Logic.N; i++) {
      const d = document.createElement('div');
      d.className = 'cell';
      d.dataset.idx = i;
      const label = labelByCell.get(i);
      if (label !== undefined) {
        d.classList.add('wp');
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = label;
        d.appendChild(b);
      }
      cellsEl.appendChild(d);
      cellNodes.push(d);
    }
  };

  const center = i => [Logic.colOf(i) * 100 + 50, Logic.rowOf(i) * 100 + 50];

  const renderThread = () => {
    if (!path.length) {
      glowEl.setAttribute('d', '');
      lineEl.setAttribute('d', '');
      headEl.style.display = 'none';
      return;
    }
    let d = '';
    for (let i = 0; i < path.length; i++) {
      const c = center(path[i]);
      d += (i ? ' L' : 'M') + c[0] + ' ' + c[1];
    }
    if (path.length === 1) d += ' l0.01 0';
    glowEl.setAttribute('d', d);
    lineEl.setAttribute('d', d);
    const hc = center(path[path.length - 1]);
    headEl.setAttribute('cx', hc[0]);
    headEl.setAttribute('cy', hc[1]);
    headEl.style.display = '';
  };

  // Waypoint gating guarantees in-path waypoints are always in order,
  // so "collected" is simply the count of waypoint cells on the path.
  const collectedCount = () => {
    let n = 0;
    for (let i = 0; i < path.length; i++) {
      if (labelByCell.has(path[i])) n++;
    }
    return n;
  };

  const renderAll = () => {
    const inPath = new Set(path);
    const collected = collectedCount();
    for (let i = 0; i < Logic.N; i++) {
      const node = cellNodes[i];
      node.classList.toggle('visited', inPath.has(i));
      const label = labelByCell.get(i);
      if (label !== undefined) {
        node.classList.toggle('collected', label <= collected);
        node.classList.toggle('next', playing && !finished && label === collected + 1);
      }
    }
    renderThread();
    wpEl.textContent = puzzle ? collected + '/' + Logic.WAYPOINTS : '—';
    cellCountEl.textContent = puzzle ? path.length + '/' + Logic.N : '—';
  };

  const flashBlock = i => {
    const node = cellNodes[i];
    if (!node) return;
    node.classList.remove('blocked');
    // force restart of the animation
    void node.offsetWidth;
    node.classList.add('blocked');
    setTimeout(() => node.classList.remove('blocked'), 350);
  };

  // ---------------- Timer ----------------

  const elapsedSecs = () => (performance.now() - startAt) / 1000;

  const fmtClock = secs => {
    const total = Math.floor(secs);
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  };

  const fmtClockPrecise = secs => {
    const m = Math.floor(secs / 60);
    const s = secs - m * 60;
    return m + ':' + s.toFixed(1).padStart(4, '0');
  };

  const stopTimer = () => {
    if (timerId !== null) { clearInterval(timerId); timerId = null; }
  };

  const startTimer = () => {
    stopTimer();
    startAt = performance.now();
    timeEl.textContent = '0:00';
    timerId = setInterval(() => {
      const t = fmtClock(elapsedSecs());
      if (timeEl.textContent !== t) timeEl.textContent = t;
    }, 200);
  };

  const updateBest = () => {
    if (window.Arena && window.Arena.identity) {
      const b = window.Arena.bestOf(GAME_ID);
      bestEl.textContent = b != null ? window.Arena.formatValue(GAME_ID, b) : '—';
    }
  };

  // ---------------- Moves ----------------

  const headCell = () => path[path.length - 1];

  const canExtend = next => {
    if (next < 0 || next >= Logic.N) return false;
    if (path.indexOf(next) !== -1) return false;
    const label = labelByCell.get(next);
    if (label !== undefined) {
      const expect = collectedCount() + 1;
      if (label !== expect) { flashBlock(next); return false; }
      // 7 is the exit: only enterable as the 36th cell.
      if (label === Logic.WAYPOINTS && path.length !== Logic.N - 1) {
        flashBlock(next);
        return false;
      }
    }
    return true;
  };

  const maybeWin = () => {
    if (!finished && path.length === Logic.N && Logic.validate(puzzle, path)) win();
  };

  // Extend toward / retract to a target cell (drag + click entry point).
  const tryCell = target => {
    if (!playing || finished || target == null) return;
    const head = headCell();
    if (target === head) return;

    const at = path.indexOf(target);
    if (at !== -1) {                 // dragging back over the thread unwinds it
      path.length = at + 1;
      renderAll();
      return;
    }

    const hr = Logic.rowOf(head), hc = Logic.colOf(head);
    const tr = Logic.rowOf(target), tc = Logic.colOf(target);
    if (hr !== tr && hc !== tc) return;   // no diagonal jumps

    const step = hr === tr ? Math.sign(tc - hc) : Math.sign(tr - hr) * Logic.W;
    let cur = head, moved = false;
    while (cur !== target) {
      const next = cur + step;
      if (!canExtend(next)) break;
      path.push(next);
      moved = true;
      cur = next;
      if (path.length === Logic.N) break;
    }
    if (moved) {
      renderAll();
      maybeWin();
    }
  };

  const undo = () => {
    if (!playing || finished || path.length <= 1) return;
    path.pop();
    renderAll();
  };

  const clearPath = () => {
    if (!playing || finished) return;
    path = [startCell];
    renderAll();
  };

  // ---------------- Pointer input ----------------

  const cellFromEvent = e => {
    const rect = boardEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < -12 || y < -12 || x > rect.width + 12 || y > rect.height + 12) return null;
    const c = Math.max(0, Math.min(Logic.W - 1, Math.floor((x / rect.width) * Logic.W)));
    const r = Math.max(0, Math.min(Logic.H - 1, Math.floor((y / rect.height) * Logic.H)));
    return r * Logic.W + c;
  };

  boardEl.addEventListener('pointerdown', e => {
    if (!playing || finished) return;
    e.preventDefault();
    dragging = true;
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* no-op */ }
    tryCell(cellFromEvent(e));
  });

  boardEl.addEventListener('pointermove', e => {
    if (!dragging) return;
    e.preventDefault();
    tryCell(cellFromEvent(e));
  });

  const endDrag = () => { dragging = false; };
  boardEl.addEventListener('pointerup', endDrag);
  boardEl.addEventListener('pointercancel', endDrag);

  // ---------------- Keyboard input ----------------

  const KEY_STEP = {
    ArrowUp: -Logic.W, Up: -Logic.W, 38: -Logic.W,
    ArrowDown: Logic.W, Down: Logic.W, 40: Logic.W,
    ArrowLeft: -1, Left: -1, 37: -1,
    ArrowRight: 1, Right: 1, 39: 1
  };

  // e.key on real keyboards; e.code / keyCode as fallbacks for
  // synthetic events that omit key names.
  const arrowStep = e => {
    if (e.key in KEY_STEP) return KEY_STEP[e.key];
    if (e.code in KEY_STEP) return KEY_STEP[e.code];
    if (e.keyCode in KEY_STEP) return KEY_STEP[e.keyCode];
    return undefined;
  };

  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!playing || finished) return;
    const step = arrowStep(e);
    if (step !== undefined) {
      e.preventDefault();
      const head = headCell();
      // no wrap across rows
      if (step === -1 && Logic.colOf(head) === 0) return;
      if (step === 1 && Logic.colOf(head) === Logic.W - 1) return;
      const next = head + step;
      if (next < 0 || next >= Logic.N) return;
      if (path.length > 1 && next === path[path.length - 2]) {
        path.pop();                    // stepping backwards retracts
        renderAll();
        return;
      }
      if (canExtend(next)) {
        path.push(next);
        renderAll();
        maybeWin();
      }
    } else if (e.key === 'u' || e.key === 'U' || e.key === 'Backspace' ||
               e.code === 'KeyU' || e.code === 'Backspace') {
      e.preventDefault();
      undo();
    } else if (e.key === 'c' || e.key === 'C' || e.code === 'KeyC') {
      e.preventDefault();
      clearPath();
    }
  });

  // ---------------- Run lifecycle ----------------

  const newPuzzle = () => {
    puzzle = Logic.generate();
    labelByCell = new Map();
    for (let i = 0; i < puzzle.waypoints.length; i++) {
      labelByCell.set(puzzle.waypoints[i].cell, puzzle.waypoints[i].label);
    }
    startCell = puzzle.waypoints[0].cell;
    path = [startCell];
    finished = false;
    submitted = false;
    dragging = false;
    buildBoard();
    renderAll();
    startTimer();
  };

  const win = () => {
    finished = true;
    dragging = false;
    stopTimer();
    const secs = Math.round(elapsedSecs() * 10) / 10;
    timeEl.textContent = fmtClock(secs);

    let res = null;
    if (!submitted && window.Arena) {
      submitted = true;
      res = window.Arena.submitScore(GAME_ID, secs);
    }

    $('end-time').textContent = fmtClockPrecise(secs);
    $('end-pb').hidden = !(res && res.improved);
    const note = $('end-note');
    if (res && res.rank === 1) {
      note.textContent = 'You sit atop Olympus. The Immortals are checking the rulebook.';
    } else if (res && res.rank) {
      note.textContent = 'Rank ' + res.rank + ' this month. The thread never lied — only the detours did.';
    } else {
      note.textContent = 'Cookies are off, so the Fates could not record this run.';
    }

    renderAll();
    endOverlay.hidden = false;
    if (window.Arena) {
      window.Arena.renderBoard($('standings'), GAME_ID);
    }
    updateBest();
  };

  const beginRun = () => {
    playing = true;
    undoBtn.disabled = false;
    clearBtn.disabled = false;
    newBtn.disabled = false;
    newPuzzle();
    boardEl.focus({ preventScroll: true });
  };

  startBtn.addEventListener('click', () => {
    startOverlay.hidden = true;
    beginRun();
  });

  againBtn.addEventListener('click', () => {
    endOverlay.hidden = true;
    newPuzzle();
    boardEl.focus({ preventScroll: true });
  });

  undoBtn.addEventListener('click', undo);
  clearBtn.addEventListener('click', clearPath);
  newBtn.addEventListener('click', () => {
    if (!playing) return;
    if (!endOverlay.hidden) endOverlay.hidden = true;
    newPuzzle();
  });

  // Empty grid behind the start overlay
  buildBoard();
  renderAll();
  updateBest();

  // ---------------- Debug hook ----------------
  if (new URLSearchParams(location.search).has('debug')) {
    window.__debug = {
      get solution() { return puzzle ? puzzle.solution.slice() : null; },
      solve() {
        if (!playing || finished || !puzzle) return false;
        path = puzzle.solution.slice();
        renderAll();
        maybeWin();
        return finished;
      }
    };
  }
})();
