/* =================================================================
   ZEN — a gentle physics toy
   Dependency-free. Canvas 2D.
   ================================================================= */

(() => {
  'use strict';

  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d');

  // --------------------------------------------------------------
  // Constants
  // --------------------------------------------------------------
  const BALL_COUNT = 14;
  const MIN_R = 16;
  const MAX_R = 44;
  const GRAVITY = 0.6;
  const FRICTION = 0.998;
  const RESTITUTION = 0.72;
  const DRAG_STIFFNESS = 0.32;
  const MAX_FLING = 28;
  const SPILL_INTERVAL_MS = 70;
  const SPAWN_VX = 5;
  const SPAWN_VY = 3;
  const SOLVER_PASSES = 3;
  const PALETTE = [
    '#00e5a0',
    '#5ca2be',
    '#2a4353',
    '#8b96a5',
    '#e6ecf3',
    '#135487',
  ];

  // --------------------------------------------------------------
  // State
  // --------------------------------------------------------------
  let W = 0, H = 0, DPR = 1;
  let balls = [];
  let gravityX = 0, gravityY = GRAVITY;
  let pointer = { x: 0, y: 0, prevX: 0, prevY: 0, down: false, held: null };
  let spillTimer = 0;

  // --------------------------------------------------------------
  // Setup
  // --------------------------------------------------------------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  function randFloat(a, b) { return Math.random() * (b - a) + a; }

  function makeBall(x, y, r) {
    const color = PALETTE[randInt(0, PALETTE.length - 1)];
    return {
      x, y, r,
      vx: randFloat(-SPAWN_VX, SPAWN_VX),
      vy: randFloat(-SPAWN_VY, SPAWN_VY),
      mass: r * r,
      color,
      rings: makeRings(r)
    };
  }

  function makeRings(r) {
    const n = randInt(3, 8);
    const rings = [];
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const mix = PALETTE[randInt(0, PALETTE.length - 1)];
      rings.push({ radius: r * (1 - t * 0.95), color: mix });
    }
    return rings;
  }

  function spawnInitial() {
    balls = [];
    for (let i = 0; i < BALL_COUNT; i++) {
      const r = randFloat(MIN_R, MAX_R);
      const x = randFloat(r + 10, W - r - 10);
      const y = randFloat(r + 10, H / 2);
      balls.push(makeBall(x, y, r));
    }
  }

  // --------------------------------------------------------------
  // Physics
  // --------------------------------------------------------------
  function step() {
    // Integrate — always applies gravity, no sleep system
    for (const b of balls) {
      if (b === pointer.held) continue;
      b.vx += gravityX;
      b.vy += gravityY;
      b.vx *= FRICTION;
      b.vy *= FRICTION;
      b.x += b.vx;
      b.y += b.vy;
    }

    // Held ball follows pointer with spring
    if (pointer.held) {
      const b = pointer.held;
      const dx = pointer.x - b.x;
      const dy = pointer.y - b.y;
      b.vx = dx * DRAG_STIFFNESS;
      b.vy = dy * DRAG_STIFFNESS;
      b.x += b.vx;
      b.y += b.vy;
    }

    // Wall collisions
    for (const b of balls) {
      if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx) * RESTITUTION; }
      if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * RESTITUTION; }
      if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy) * RESTITUTION; }
      if (b.y + b.r > H) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * RESTITUTION; }
    }

    // Ball-ball collisions — multiple passes help stacking
    for (let pass = 0; pass < SOLVER_PASSES; pass++) {
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          resolveCollision(balls[i], balls[j]);
        }
      }
    }
  }

  function resolveCollision(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distSq = dx * dx + dy * dy;
    const minDist = a.r + b.r;
    if (distSq >= minDist * minDist || distSq === 0) return;

    const dist = Math.sqrt(distSq);
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;

    // Positional correction proportional to mass
    const totalMass = a.mass + b.mass;
    const corrA = overlap * (b.mass / totalMass);
    const corrB = overlap * (a.mass / totalMass);

    if (a !== pointer.held) { a.x -= nx * corrA; a.y -= ny * corrA; }
    if (b !== pointer.held) { b.x += nx * corrB; b.y += ny * corrB; }

    // Relative velocity along normal
    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const velAlongNormal = rvx * nx + rvy * ny;
    if (velAlongNormal > 0) return;

    const e = RESTITUTION;
    const jImpulse = -(1 + e) * velAlongNormal / (1 / a.mass + 1 / b.mass);
    const ix = jImpulse * nx;
    const iy = jImpulse * ny;

    if (a !== pointer.held) { a.vx -= ix / a.mass; a.vy -= iy / a.mass; }
    if (b !== pointer.held) { b.vx += ix / b.mass; b.vy += iy / b.mass; }
  }

  // --------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------
  function draw() {
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(0, 0, W, H);
    drawGrid();

    for (const b of balls) {
      for (const ring of b.rings) {
        ctx.beginPath();
        ctx.fillStyle = ring.color;
        ctx.arc(b.x, b.y, ring.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (pointer.held) {
      const b = pointer.held;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0, 229, 160, 0.7)';
      ctx.lineWidth = 2;
      ctx.arc(b.x, b.y, b.r + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawGrid() {
    const size = 80;
    ctx.strokeStyle = 'rgba(31, 38, 48, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += size) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += size) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }

  // --------------------------------------------------------------
  // Input
  // --------------------------------------------------------------
  function getBallAt(x, y) {
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      const dx = x - b.x;
      const dy = y - b.y;
      if (dx * dx + dy * dy <= b.r * b.r) return b;
    }
    return null;
  }

  function onDown(x, y) {
    pointer.down = true;
    pointer.x = pointer.prevX = x;
    pointer.y = pointer.prevY = y;
    const hit = getBallAt(x, y);
    if (hit) {
      pointer.held = hit;
      hit.vx = 0; hit.vy = 0;
    } else {
      spawnAtPointer();
      if (spillTimer) clearInterval(spillTimer);
      spillTimer = setInterval(spawnAtPointer, SPILL_INTERVAL_MS);
    }
  }

  function spawnAtPointer() {
    const r = randFloat(MIN_R, MAX_R);
    balls.push(makeBall(
      pointer.x + randFloat(-8, 8),
      pointer.y + randFloat(-8, 8),
      r
    ));
  }

  function onMove(x, y) {
    pointer.prevX = pointer.x;
    pointer.prevY = pointer.y;
    pointer.x = x;
    pointer.y = y;
  }

  function onUp() {
    if (spillTimer) { clearInterval(spillTimer); spillTimer = 0; }
    if (pointer.held) {
      const b = pointer.held;
      const fx = clamp(pointer.x - pointer.prevX, -MAX_FLING, MAX_FLING);
      const fy = clamp(pointer.y - pointer.prevY, -MAX_FLING, MAX_FLING);
      b.vx = fx;
      b.vy = fy;
    }
    pointer.down = false;
    pointer.held = null;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Mouse
  canvas.addEventListener('mousedown', e => onDown(e.clientX, e.clientY));
  window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', onUp);

  // Touch
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    onDown(t.clientX, t.clientY);
  }, { passive: true });

  canvas.addEventListener('touchmove', e => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    onMove(t.clientX, t.clientY);
  }, { passive: true });

  canvas.addEventListener('touchend', onUp);
  canvas.addEventListener('touchcancel', onUp);

  // Reset button + R key
  document.getElementById('reset').addEventListener('click', spawnInitial);
  window.addEventListener('keydown', e => {
    if (e.key === 'r' || e.key === 'R') spawnInitial();
  });

  // Device orientation (tilt gravity)
  function installTilt() {
    window.addEventListener('deviceorientation', e => {
      if (e.gamma == null || e.beta == null) return;
      gravityX = Math.sin(e.gamma * Math.PI / 180) * 0.6;
      gravityY = Math.sin(((Math.PI / 4) + e.beta * Math.PI / 180)) * 0.6;
    });
  }

  // iOS 13+ requires permission
  const tiltBtn = document.getElementById('tilt-enable');
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    tiltBtn.hidden = false;
    tiltBtn.addEventListener('click', async () => {
      try {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm === 'granted') { installTilt(); tiltBtn.hidden = true; }
      } catch (err) {
        console.warn('Tilt permission denied:', err);
      }
    });
  } else if ('ondeviceorientation' in window) {
    installTilt();
  }

  // --------------------------------------------------------------
  // Main loop
  // --------------------------------------------------------------
  function loop() {
    step();
    draw();
    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', resize);
  resize();
  spawnInitial();
  loop();
})();
