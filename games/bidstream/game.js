/* =================================================================
   BIDSTREAM — RTB bidding game
   60s round. Bid requests arrive. Decide: bid high, bid low, or pass.
   Maximize ROAS. Avoid fraud.
   ================================================================= */

(() => {
  'use strict';

  // --------------------------------------------------------------
  // Config
  // --------------------------------------------------------------
  const GAME_SECONDS = 60;
  const START_BUDGET = 500;
  const CARD_TTL_MS = 4500;        // time before a card auto-passes
  const FRAUD_RATE = 0.18;         // ~18% of requests are fraud
  const HIGH_MULT = 1.30;
  const LOW_MULT = 0.90;
  const HIGH_WIN_CHANCE = 0.80;
  const LOW_WIN_CHANCE = 0.35;
  const FRAUD_PASS_BONUS = 2;      // correctly passing fraud
  const FRAUD_BID_PENALTY = 1.0;   // multiplier on bid cost if you bid on fraud (still lost)
  const SPAWN_INITIAL_MS = 1600;
  const SPAWN_FLOOR_MS = 700;      // fastest spawn late-game

  // Data pools
  const DOMAINS = [
    'cnn.com', 'nytimes.com', 'espn.com', 'bloomberg.com',
    'theverge.com', 'techcrunch.com', 'wsj.com', 'reuters.com',
    'wired.com', 'engadget.com', 'hulu.com', 'youtube.com',
    'spotify.com', 'pinterest.com', 'reddit.com', 'weather.com',
    'vox.com', 'polygon.com', 'kotaku.com', 'buzzfeed.com'
  ];
  const SHADY_DOMAINS = [
    'h0t-news24.biz', 'click-quiz4u.net', 'freewin-claim.co',
    'get-rich-2day.xyz', 'surveycash-win.top', 'viralnewsalert.info',
    'celeb-leaks-hd.online', 'autoplay-cash.click'
  ];
  const AD_UNITS = ['300x250', '728x90', '320x50', '970x250', '300x600', 'CTV_15s', 'CTV_30s', 'NATIVE'];

  const GOOD_FLAGS = [
    { label: 'BRAND SAFE', cls: 'flag-good' },
    { label: 'PMP', cls: 'flag-good' },
    { label: '1P DATA', cls: 'flag-good' }
  ];
  const WARN_FLAGS = [
    { label: 'APP-B', cls: 'flag-warn' },
    { label: 'LOW INV', cls: 'flag-warn' },
    { label: 'NO-REF', cls: 'flag-warn' }
  ];
  const BAD_FLAGS = [
    { label: 'BOT_SIGNAL', cls: 'flag-bad' },
    { label: 'IVT', cls: 'flag-bad' },
    { label: 'SPOOF_IP', cls: 'flag-bad' },
    { label: 'REDIRECT', cls: 'flag-bad' },
    { label: 'HIGH_CTR', cls: 'flag-bad' }
  ];

  // --------------------------------------------------------------
  // DOM refs
  // --------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const stage = $('stage');
  const noCard = $('no-card');
  const budgetEl = $('budget');
  const revenueEl = $('revenue');
  const roasEl = $('roas');
  const timeEl = $('time');
  const bestRoasEl = $('best-roas');
  const budgetBar = $('budget-bar');
  const revBar = $('rev-bar');
  const timeBar = $('time-bar');
  const actHigh = $('act-high');
  const actLow = $('act-low');
  const actPass = $('act-pass');
  const startOverlay = $('start-overlay');
  const endOverlay = $('end-overlay');
  const startBtn = $('start-btn');
  const restartBtn = $('restart-btn');
  const endRoasEl = $('end-roas');
  const endSpentEl = $('end-spent');
  const endEarnedEl = $('end-earned');
  const endWinsEl = $('end-wins');
  const endFraudEl = $('end-fraud');
  const endVerdictEl = $('end-verdict');
  const endNoteEl = $('end-note');
  const toastsEl = $('toasts');

  // --------------------------------------------------------------
  // State
  // --------------------------------------------------------------
  let state = null;
  const BEST_KEY = 'bidstream.bestRoas.v1';

  function freshState() {
    return {
      running: false,
      startTime: 0,
      budget: START_BUDGET,
      spent: 0,
      revenue: 0,
      wins: 0,
      fraudBlocked: 0,
      requestCount: 0,
      currentCard: null,
      currentReq: null,
      spawnTimer: null,
      ttlRaf: 0,
      ttlStart: 0,
      nextSpawnMs: SPAWN_INITIAL_MS,
    };
  }

  // --------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const rand = (a, b) => Math.random() * (b - a) + a;
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt$ = n => '$' + Math.round(n).toLocaleString('en-US');

  function tierColor(v, goodThresh, midThresh) {
    if (v >= goodThresh) return 'good';
    if (v >= midThresh) return 'mid';
    return 'bad';
  }

  // --------------------------------------------------------------
  // Bid request generation
  // --------------------------------------------------------------
  function makeRequest() {
    state.requestCount++;
    const isFraud = Math.random() < FRAUD_RATE;
    const req = {
      id: String(state.requestCount).padStart(4, '0'),
      isFraud,
      domain: isFraud && Math.random() < 0.7 ? pick(SHADY_DOMAINS) : pick(DOMAINS),
      adUnit: pick(AD_UNITS),
      // viewability and audience: fraud tends to have lower viewability and
      // strangely good or strangely bad audience match (telltale)
      viewability: isFraud ? randInt(20, 55) : randInt(45, 92),
      audience: isFraud ? (Math.random() < 0.5 ? randInt(92, 99) : randInt(10, 35)) : randInt(30, 88),
      floor: +rand(0.8, 4.5).toFixed(2),
      flags: []
    };

    // Base CPM from quality
    req.cpm = +(req.floor + (req.audience / 100) * 3 + (req.viewability / 100) * 2).toFixed(2);

    // Flags — fraud requests have one bad flag often
    if (isFraud) {
      req.flags.push(pick(BAD_FLAGS));
      if (Math.random() < 0.4) req.flags.push(pick(WARN_FLAGS));
    } else {
      // clean requests sometimes get a warn or good flag
      const r = Math.random();
      if (r < 0.35) req.flags.push(pick(GOOD_FLAGS));
      else if (r < 0.55) req.flags.push(pick(WARN_FLAGS));
      if (Math.random() < 0.25) req.flags.push(pick(GOOD_FLAGS));
    }

    return req;
  }

  function renderCard(req) {
    const card = document.createElement('div');
    card.className = 'bid-card' + (req.isFraud ? ' fraud' : '');

    const viewCls = tierColor(req.viewability, 70, 50);
    const audCls = tierColor(req.audience, 65, 40);

    const flagsHtml = req.flags.map(f =>
      `<span class="flag ${f.cls}">${f.label}</span>`
    ).join('');

    card.innerHTML = `
      <div class="bid-row">
        <span>REQUEST <span class="req-id">#${req.id}</span></span>
        <span>OPENRTB 2.6</span>
      </div>
      <div class="bid-head">
        <span class="bid-domain">${req.domain}</span>
        <span class="bid-ad-unit">${req.adUnit}</span>
      </div>
      <div class="bid-metrics">
        <div class="metric">
          <span class="metric-label">VIEWABILITY</span>
          <span class="metric-value ${viewCls}">${req.viewability}%</span>
        </div>
        <div class="metric">
          <span class="metric-label">AUDIENCE MATCH</span>
          <span class="metric-value ${audCls}">${req.audience}%</span>
        </div>
        <div class="metric">
          <span class="metric-label">BASE CPM</span>
          <span class="metric-value">$${req.cpm.toFixed(2)}</span>
        </div>
      </div>
      <div class="bid-footer">
        <span class="bid-floor">FLOOR: <strong>$${req.floor.toFixed(2)}</strong></span>
        <span class="bid-flags">${flagsHtml}</span>
      </div>
      <div class="ttl" style="width: 100%"></div>
    `;
    return card;
  }

  // --------------------------------------------------------------
  // TTL bar on card
  // --------------------------------------------------------------
  function startTtl(card) {
    const bar = card.querySelector('.ttl');
    state.ttlStart = performance.now();

    const tick = now => {
      if (!state.currentCard || state.currentCard !== card) return;
      const elapsed = now - state.ttlStart;
      const pct = clamp(1 - elapsed / CARD_TTL_MS, 0, 1);
      bar.style.width = (pct * 100) + '%';
      if (pct < 0.25) bar.classList.add('danger');
      if (elapsed >= CARD_TTL_MS) {
        // auto-pass (timeout)
        handleDecision('timeout');
        return;
      }
      state.ttlRaf = requestAnimationFrame(tick);
    };
    state.ttlRaf = requestAnimationFrame(tick);
  }

  function stopTtl() {
    cancelAnimationFrame(state.ttlRaf);
    state.ttlRaf = 0;
  }

  // --------------------------------------------------------------
  // Spawn flow
  // --------------------------------------------------------------
  function spawnNext() {
    if (!state.running) return;
    if (state.currentCard) return; // something already up
    if (state.budget <= 0) {
      // out of budget, but keep round going (can still pass on fraud for bonus)
    }

    const req = makeRequest();
    const card = renderCard(req);
    noCard.style.display = 'none';
    stage.appendChild(card);

    state.currentCard = card;
    state.currentReq = req;

    actHigh.disabled = false;
    actLow.disabled = false;
    actPass.disabled = false;

    startTtl(card);
  }

  function scheduleNextSpawn(delayMs = null) {
    if (state.spawnTimer) clearTimeout(state.spawnTimer);
    // Progressive difficulty: spawns get faster as time runs out
    const elapsed = (performance.now() - state.startTime) / 1000;
    const progress = clamp(elapsed / GAME_SECONDS, 0, 1);
    const target = SPAWN_INITIAL_MS - (SPAWN_INITIAL_MS - SPAWN_FLOOR_MS) * progress;
    const jitter = rand(0.8, 1.2);
    state.nextSpawnMs = (delayMs ?? target) * jitter;
    state.spawnTimer = setTimeout(spawnNext, state.nextSpawnMs);
  }

  // --------------------------------------------------------------
  // Decision handling
  // --------------------------------------------------------------
  function handleDecision(action) {
    if (!state.currentCard) return;
    stopTtl();

    const req = state.currentReq;
    const card = state.currentCard;
    let dismissCls = 'dismiss-pass';
    let toastMsg = '';
    let toastCls = 'neutral';

    actHigh.disabled = true;
    actLow.disabled = true;
    actPass.disabled = true;

    if (action === 'pass' || action === 'timeout') {
      if (req.isFraud) {
        state.fraudBlocked++;
        state.revenue += FRAUD_PASS_BONUS;
        toastMsg = action === 'timeout'
          ? `FRAUD DODGED +${fmt$(FRAUD_PASS_BONUS)}`
          : `FRAUD BLOCKED +${fmt$(FRAUD_PASS_BONUS)}`;
        toastCls = 'good';
        pulse(revenueEl, 'pop');
      } else {
        // passing on a clean opportunity: small missed-opportunity signal
        toastMsg = action === 'timeout' ? 'TIMEOUT · NO BID' : 'PASSED';
        toastCls = 'neutral';
      }
      dismissCls = 'dismiss-pass';
    } else {
      // BID (high or low)
      const isHigh = action === 'high';
      const costMult = isHigh ? HIGH_MULT : LOW_MULT;
      const winChance = isHigh ? HIGH_WIN_CHANCE : LOW_WIN_CHANCE;
      const bidCost = req.cpm * costMult;

      // Check budget
      if (bidCost > state.budget) {
        toastMsg = 'INSUFFICIENT BUDGET';
        toastCls = 'bad';
        dismissCls = 'dismiss-loss';
      } else {
        state.budget -= bidCost;
        state.spent += bidCost;
        pulse(budgetEl, 'pop-bad');

        // Fraud bid = automatic lose
        if (req.isFraud) {
          toastMsg = `FRAUD HIT −${fmt$(bidCost)}`;
          toastCls = 'bad';
          dismissCls = 'dismiss-loss';
        } else {
          // Roll for win
          const won = Math.random() < winChance;
          if (won) {
            // Revenue model: CPM return modulated by quality
            const qualityMult = (req.audience / 100) * 0.9 + (req.viewability / 100) * 0.6;
            const revenue = bidCost * (1.4 + qualityMult);
            state.revenue += revenue;
            state.wins++;
            toastMsg = `WIN +${fmt$(revenue)}`;
            toastCls = 'good';
            dismissCls = 'dismiss-win';
            pulse(revenueEl, 'pop');
          } else {
            toastMsg = `LOST AUCTION −${fmt$(bidCost)}`;
            toastCls = 'bad';
            dismissCls = 'dismiss-loss';
          }
        }
      }
    }

    showToast(toastMsg, toastCls);
    updateHud();

    card.classList.add(dismissCls);
    const activeCard = card;
    setTimeout(() => {
      if (activeCard.parentNode) activeCard.parentNode.removeChild(activeCard);
      if (state.currentCard === activeCard) {
        state.currentCard = null;
        state.currentReq = null;
        if (!stage.querySelector('.bid-card')) {
          noCard.style.display = '';
        }
        scheduleNextSpawn();
      }
    }, 280);
  }

  // --------------------------------------------------------------
  // HUD updates
  // --------------------------------------------------------------
  function updateHud() {
    budgetEl.textContent = Math.max(0, Math.round(state.budget));
    revenueEl.textContent = Math.round(state.revenue);
    const roas = state.spent > 0 ? state.revenue / state.spent : 0;
    roasEl.textContent = roas.toFixed(2);

    budgetBar.style.width = clamp(state.budget / START_BUDGET * 100, 0, 100) + '%';
    // revenue bar fills as revenue grows toward a reasonable "good ROAS" target (2x)
    const revTarget = START_BUDGET * 2;
    revBar.style.width = clamp(state.revenue / revTarget * 100, 0, 100) + '%';
  }

  function pulse(el, cls) {
    el.classList.remove(cls);
    // force reflow
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 400);
  }

  function showToast(msg, cls) {
    const t = document.createElement('div');
    t.className = `toast ${cls}`;
    t.textContent = msg;
    toastsEl.appendChild(t);
    setTimeout(() => t.remove(), 900);
  }

  // --------------------------------------------------------------
  // Timer
  // --------------------------------------------------------------
  function timerTick() {
    if (!state.running) return;
    const elapsed = (performance.now() - state.startTime) / 1000;
    const remaining = Math.max(0, GAME_SECONDS - elapsed);
    timeEl.textContent = Math.ceil(remaining) + 's';
    timeBar.style.width = (remaining / GAME_SECONDS * 100) + '%';
    if (remaining <= 0) {
      endGame();
      return;
    }
    requestAnimationFrame(timerTick);
  }

  // --------------------------------------------------------------
  // Start / end
  // --------------------------------------------------------------
  function startGame() {
    state = freshState();
    state.running = true;
    state.startTime = performance.now();

    updateHud();
    timeEl.textContent = GAME_SECONDS + 's';
    timeBar.style.width = '100%';

    startOverlay.setAttribute('hidden', '');
    endOverlay.setAttribute('hidden', '');

    requestAnimationFrame(timerTick);
    scheduleNextSpawn(600);
  }

  function endGame() {
    state.running = false;
    clearTimeout(state.spawnTimer);
    stopTtl();

    actHigh.disabled = true;
    actLow.disabled = true;
    actPass.disabled = true;

    if (state.currentCard) {
      state.currentCard.remove();
      state.currentCard = null;
    }
    noCard.style.display = '';

    const roas = state.spent > 0 ? state.revenue / state.spent : 0;

    endRoasEl.textContent = roas.toFixed(2) + 'x';
    endSpentEl.textContent = fmt$(state.spent);
    endEarnedEl.textContent = fmt$(state.revenue);
    endWinsEl.textContent = state.wins;
    endFraudEl.textContent = state.fraudBlocked;

    // verdict + note
    let verdict, note;
    if (roas >= 3) {
      verdict = 'ELITE BUYER';
      note = 'Your CFO just emailed you a raise.';
    } else if (roas >= 2) {
      verdict = 'STRONG CAMPAIGN';
      note = 'Solid ROAS. Sales would love this one.';
    } else if (roas >= 1.3) {
      verdict = 'PROFITABLE';
      note = 'Net positive, but leaving some on the table.';
    } else if (roas >= 1) {
      verdict = 'BREAK-EVEN';
      note = 'You kept the lights on. Barely.';
    } else if (roas > 0) {
      verdict = 'UNDERWATER';
      note = 'Budget out-paced the returns. Optimize and try again.';
    } else {
      verdict = 'NO SPEND';
      note = 'Passing on everything is a strategy. Just not a good one.';
    }
    endVerdictEl.textContent = verdict;
    endNoteEl.textContent = note;

    // Best ROAS
    const best = parseFloat(localStorage.getItem(BEST_KEY) || '0');
    if (roas > best) {
      localStorage.setItem(BEST_KEY, roas.toFixed(2));
      bestRoasEl.textContent = roas.toFixed(2) + 'x';
      endNoteEl.textContent += ' NEW BEST.';
    }

    endOverlay.removeAttribute('hidden');
  }

  // --------------------------------------------------------------
  // Input
  // --------------------------------------------------------------
  actHigh.addEventListener('click', () => handleDecision('high'));
  actLow.addEventListener('click', () => handleDecision('low'));
  actPass.addEventListener('click', () => handleDecision('pass'));

  document.addEventListener('keydown', e => {
    if (!state || !state.running) return;
    if (e.key === '1') handleDecision('high');
    else if (e.key === '2') handleDecision('low');
    else if (e.key === '3') handleDecision('pass');
  });

  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', startGame);

  // --------------------------------------------------------------
  // Init: show best ROAS from localStorage
  // --------------------------------------------------------------
  (function init() {
    const best = parseFloat(localStorage.getItem(BEST_KEY) || '0');
    bestRoasEl.textContent = best > 0 ? best.toFixed(2) + 'x' : '—';
  })();
})();
