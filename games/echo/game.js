/* =================================================================
   ECHO — // THE_NYMPH_REPEATS
   Simon-style memory for the Olympus Arcade · ryannovak.net
   The mountain plays a sequence; the player echoes it back.
   Pure logic is exported for headless tests; DOM shell lives below.
   ================================================================= */
(() => {
  'use strict';

  // ---------------------------------------------------------------
  // Pure logic — NO DOM, NO window access in this block
  // ---------------------------------------------------------------
  const Logic = (() => {
    // mulberry32 — small deterministic PRNG, returns floats in [0, 1)
    const mulberry32 = seed => {
      let s = seed | 0;
      return () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };

    // One new step of the mountain's song: an int 0..3
    const nextStep = rng => Math.floor(rng() * 4);

    // Append one step (one round) to a sequence in place; returns it
    const extend = (sequence, rng) => {
      sequence.push(nextStep(rng));
      return sequence;
    };

    // Deterministic sequence of `length` steps from a seed
    const buildSequence = (seed, length) => {
      const rng = mulberry32(seed);
      const seq = [];
      for (let i = 0; i < length; i++) seq.push(nextStep(rng));
      return seq;
    };

    // True iff `input` is a correct prefix of `sequence` (and not longer)
    const verifyPrefix = (sequence, input) => {
      if (!Array.isArray(sequence) || !Array.isArray(input)) return false;
      if (input.length > sequence.length) return false;
      for (let i = 0; i < input.length; i++) {
        if (input[i] !== sequence[i]) return false;
      }
      return true;
    };

    // Playback pace in ms per step: ~620ms early, down to a 300ms floor
    // by round 12. Gentle ramp — the memory is the hard part, not the speed.
    const stepDuration = round => Math.max(300, 620 - (round - 1) * 30);

    return { mulberry32, nextStep, extend, buildSequence, verifyPrefix, stepDuration };
  })();

  if (typeof module !== 'undefined' && module.exports) { module.exports = Logic; return; }

  // ---------------------------------------------------------------
  // DOM shell
  // ---------------------------------------------------------------
  const GAME_ID = 'echo';
  const SOUND_KEY = 'echo.sound';
  const FREQS = [329.63, 392.00, 440.00, 523.25]; // E4 · G4 · A4 · C5

  const $ = id => document.getElementById(id);
  const tilesEl = $('tiles');
  const tileEls = [0, 1, 2, 3].map(i => $('tile-' + i));
  const statusEl = $('status');
  const roundEl = $('round');
  const progressEl = $('progress');
  const bestEl = $('best');
  const soundBtn = $('sound-btn');
  const startOverlay = $('start-overlay');
  const endOverlay = $('end-overlay');
  const startBtn = $('start-btn');
  const restartBtn = $('restart-btn');
  const endVerdict = $('end-verdict');
  const endRounds = $('end-rounds');
  const endRoundsUnit = $('end-rounds-unit');
  const endNote = $('end-note');
  const pbTag = $('pb-tag');
  const standingsEl = $('standings');

  const state = {
    sequence: [],
    input: [],
    round: 0,
    completed: 0,
    phase: 'idle', // idle | playback | input | wait | over
    rng: null,
    epoch: 0,
    timers: [],
    submitted: false
  };

  // ----- timers that die on reset -----
  const later = (fn, ms) => {
    const epoch = state.epoch;
    state.timers.push(setTimeout(() => { if (epoch === state.epoch) fn(); }, ms));
  };
  const clearTimers = () => {
    state.timers.forEach(clearTimeout);
    state.timers = [];
    state.epoch += 1;
  };

  // ----- audio: lazy AudioContext, created on first user gesture -----
  let audioCtx = null;
  let soundOn = true;
  try { soundOn = localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) { /* storage blocked */ }

  const ensureAudio = () => {
    if (!soundOn) return;
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { audioCtx = new AC(); } catch (e) { audioCtx = null; } }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  };

  const tone = (freq, durMs, type, peak) => {
    if (!soundOn || !audioCtx) return;
    try {
      const t0 = audioCtx.currentTime;
      const dur = Math.max(0.05, durMs / 1000);
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch (e) { /* audio is decorative */ }
  };

  const playNote = (i, durMs) => tone(FREQS[i], durMs, 'sine', 0.16);
  const wrongBuzz = () => {
    tone(98, 450, 'sawtooth', 0.12);
    tone(104, 450, 'sawtooth', 0.08);
  };

  // ----- rendering helpers -----
  const setStatus = (text, mood) => {
    statusEl.textContent = text;
    statusEl.className = 'status' + (mood ? ' ' + mood : '');
  };

  const updateHud = () => {
    roundEl.textContent = state.round > 0 ? String(state.round) : '—';
    progressEl.textContent = state.round > 0 && state.phase !== 'over'
      ? state.input.length + '/' + state.sequence.length
      : '—';
  };

  const renderBest = () => {
    const b = window.Arena && Arena.identity ? Arena.bestOf(GAME_ID) : null;
    bestEl.textContent = b == null ? '—' : String(b);
  };

  const renderSound = () => {
    soundBtn.textContent = soundOn ? 'ON' : 'OFF';
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    soundBtn.classList.toggle('off', !soundOn);
  };

  const clearTileClasses = () => {
    tileEls.forEach(el => el.classList.remove('lit', 'wrong'));
  };

  const light = (i, ms) => {
    const el = tileEls[i];
    el.classList.remove('lit');
    // force restart of the visual when the same tile repeats back-to-back
    void el.offsetWidth;
    el.classList.add('lit');
    later(() => el.classList.remove('lit'), ms);
  };

  // ----- game flow -----
  const startRun = () => {
    clearTimers();
    clearTileClasses();
    state.sequence = [];
    state.input = [];
    state.round = 0;
    state.completed = 0;
    state.submitted = false;
    state.rng = Logic.mulberry32((Math.random() * 0x7fffffff) | 0);
    startOverlay.hidden = true;
    endOverlay.hidden = true;
    pbTag.hidden = true;
    nextRound();
  };

  const nextRound = () => {
    state.round += 1;
    Logic.extend(state.sequence, state.rng);
    state.input = [];
    playback();
  };

  const playback = () => {
    state.phase = 'playback';
    tilesEl.classList.add('locked');
    setStatus('THE MOUNTAIN SPEAKS…', 'speaking');
    updateHud();
    const dur = Logic.stepDuration(state.round);
    const lead = 700; // a breath before the first note
    state.sequence.forEach((step, i) => {
      later(() => {
        light(step, Math.round(dur * 0.62));
        playNote(step, Math.round(dur * 0.58));
      }, lead + i * dur);
    });
    later(() => {
      state.phase = 'input';
      tilesEl.classList.remove('locked');
      setStatus('ECHO IT BACK', 'echoing');
      updateHud();
    }, lead + state.sequence.length * dur + 150);
  };

  const press = i => {
    if (state.phase !== 'input') return;
    ensureAudio();
    state.input.push(i);
    if (!Logic.verifyPrefix(state.sequence, state.input)) {
      fail(i);
      return;
    }
    light(i, 240);
    playNote(i, 260);
    updateHud();
    if (state.input.length === state.sequence.length) {
      state.completed = state.round;
      state.phase = 'wait';
      tilesEl.classList.add('locked');
      setStatus('ECHOED', 'echoing');
      later(nextRound, 850);
    }
  };

  const fail = i => {
    state.phase = 'over';
    tilesEl.classList.add('locked');
    const el = tileEls[i];
    el.classList.remove('lit');
    el.classList.add('wrong');
    wrongBuzz();
    setStatus('A FALSE NOTE', 'wrong');
    updateHud();
    later(() => el.classList.remove('wrong'), 700);
    later(finish, 950);
  };

  const finish = () => {
    if (state.submitted) return;
    state.submitted = true;
    const rounds = state.completed;

    let res = null;
    if (rounds >= 1 && window.Arena) {
      res = Arena.submitScore(GAME_ID, rounds);
    }

    endRounds.textContent = String(rounds);
    endRoundsUnit.textContent = rounds === 1 ? 'round' : 'rounds';
    endVerdict.textContent = (res && res.rank === 1)
      ? 'YOU SIT ATOP OLYMPUS'
      : 'THE MOUNTAIN FELL SILENT';
    pbTag.hidden = !(res && res.improved);

    endNote.textContent =
      rounds === 0 ? 'Not a single note returned. The mountain shrugs.' :
      rounds <= 3 ? 'A faint echo. It dies somewhere over the treeline.' :
      rounds <= 8 ? 'A clean echo. The immortals glance downhill.' :
      rounds <= 14 ? 'The valley rings all night. Pan takes notes.' :
      'Narcissus finally hears someone else.';

    if (window.Arena) Arena.renderBoard(standingsEl, GAME_ID);
    renderBest();
    endOverlay.hidden = false;
  };

  // ----- input wiring -----
  // pointerdown, not click: the light/tone must land on finger-down.
  // Keyboard activation of a focused tile arrives as a click with
  // detail 0, so that path stays alive without double-firing taps.
  tileEls.forEach((el, i) => {
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      ensureAudio();
      press(i);
    });
    el.addEventListener('click', e => {
      if (e.detail === 0) { ensureAudio(); press(i); }
    });
  });

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.repeat) return;
    const idx = ['1', '2', '3', '4'].indexOf(e.key);
    if (idx === -1) return;
    if (!startOverlay.hidden || !endOverlay.hidden) return;
    ensureAudio();
    press(idx);
  });

  startBtn.addEventListener('click', () => { ensureAudio(); startRun(); });
  restartBtn.addEventListener('click', () => { ensureAudio(); startRun(); });

  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch (e) { /* storage blocked */ }
    if (soundOn) { ensureAudio(); tone(FREQS[2], 140, 'sine', 0.1); }
    renderSound();
  });

  // ----- debug hook (?debug) -----
  if (new URLSearchParams(location.search).has('debug')) {
    window.__debug = {
      logic: Logic,
      get solution() { return state.sequence.slice(); },
      get phase() { return state.phase; },
      get round() { return state.round; },
      get completed() { return state.completed; },
      // instantly echo the current round correctly (advances to the next round)
      solve: () => {
        while (state.phase === 'input' && state.input.length < state.sequence.length) {
          press(state.sequence[state.input.length]);
        }
      },
      // jump straight to the end-of-run path (submit + standings)
      end: () => {
        if (state.phase === 'idle' || state.phase === 'over') return;
        clearTimers();
        state.phase = 'over';
        tilesEl.classList.add('locked');
        finish();
      }
    };
  }

  // ----- init -----
  renderSound();
  renderBest();
  updateHud();
  setStatus('PRESS START', '');
})();
