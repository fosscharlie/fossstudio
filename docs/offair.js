// COPY of web/js/offair.js for the website's playable demo - if the
// game changes there, refresh this file with it.
// Asteroids, for the watch page while the show is off air. Arrow keys
// rotate and thrust, space fires; on touch screens the corners grow
// buttons. Rocks split, the screen wraps, waves build. Pure canvas, no
// assets, no storage, no requests - the best score lives only as long
// as the tab.
window.OffAir = (() => {
  const W = 800, H = 400;
  let canvas = null, ctx = null, raf = 0, running = false;
  let state = "idle"; // idle | play | over

  const TEXT = "#e8eaed", MUTED = "#9aa0a8", ACCENT = "#fbc711";
  const TAU = Math.PI * 2;
  const touch = window.matchMedia?.("(pointer: coarse)").matches || false;

  const ship = { x: W / 2, y: H / 2, a: -TAU / 4, vx: 0, vy: 0, safe: 0 };
  let rocks = [], shots = [], sparks = [];
  let score = 0, best = 0, lives = 3, wave = 0, t = 0, flash = 0;
  const keys = { left: false, right: false, up: false };

  const wrap = (o) => {
    if (o.x < -20) o.x += W + 40; if (o.x > W + 20) o.x -= W + 40;
    if (o.y < -20) o.y += H + 40; if (o.y > H + 20) o.y -= H + 40;
  };

  function makeRock(x, y, size) {
    const r = size === 3 ? 26 : size === 2 ? 15 : 8;
    const verts = [];
    const n = 9 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) verts.push(r * (0.72 + Math.random() * 0.45));
    const a = Math.random() * TAU;
    const v = (size === 3 ? 0.7 : size === 2 ? 1.1 : 1.6) * (0.7 + Math.random() * 0.6);
    return { x, y, size, r, verts, spin: (Math.random() - 0.5) * 0.03, rot: Math.random() * TAU,
             vx: Math.cos(a) * v, vy: Math.sin(a) * v };
  }

  function newWave() {
    wave++;
    for (let i = 0; i < Math.min(3 + wave, 8); i++) {
      // spawn away from the ship, never on top of it
      let x, y;
      do {
        x = Math.random() * W; y = Math.random() * H;
      } while (Math.hypot(x - ship.x, y - ship.y) < 120);
      rocks.push(makeRock(x, y, 3));
    }
  }

  function newGame() {
    score = 0; lives = 3; wave = 0;
    rocks = []; shots = []; sparks = [];
    ship.x = W / 2; ship.y = H / 2; ship.vx = ship.vy = 0; ship.a = -TAU / 4; ship.safe = 90;
    newWave();
    state = "play";
  }

  function fire() {
    if (state !== "play" || shots.length >= 5) return;
    shots.push({
      x: ship.x + Math.cos(ship.a) * 12, y: ship.y + Math.sin(ship.a) * 12,
      vx: Math.cos(ship.a) * 6.5 + ship.vx, vy: Math.sin(ship.a) * 6.5 + ship.vy,
      life: 55
    });
  }

  function boom(x, y, n, c) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = 0.6 + Math.random() * 2.2;
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 22 + Math.random() * 14, c });
    }
  }

  function splitRock(i) {
    const r = rocks[i];
    rocks.splice(i, 1);
    score += r.size === 3 ? 20 : r.size === 2 ? 50 : 100;
    boom(r.x, r.y, r.size * 5, MUTED);
    if (r.size > 1) {
      rocks.push(makeRock(r.x, r.y, r.size - 1), makeRock(r.x, r.y, r.size - 1));
    }
    if (!rocks.length) { newWave(); ship.safe = Math.max(ship.safe, 40); }
  }

  function step() {
    t++;
    if (flash) flash--;
    for (const r of rocks) { r.x += r.vx; r.y += r.vy; r.rot += r.spin; wrap(r); }
    for (const s of sparks) { s.x += s.vx; s.y += s.vy; s.life--; s.vx *= 0.97; s.vy *= 0.97; }
    sparks = sparks.filter((s) => s.life > 0);
    if (state !== "play") return;
    if (keys.left) ship.a -= 0.075;
    if (keys.right) ship.a += 0.075;
    if (keys.up) {
      ship.vx += Math.cos(ship.a) * 0.14;
      ship.vy += Math.sin(ship.a) * 0.14;
    }
    ship.vx *= 0.992; ship.vy *= 0.992;
    const vmax = 5.5, v = Math.hypot(ship.vx, ship.vy);
    if (v > vmax) { ship.vx *= vmax / v; ship.vy *= vmax / v; }
    ship.x += ship.vx; ship.y += ship.vy;
    wrap(ship);
    if (ship.safe) ship.safe--;
    for (const s of shots) { s.x += s.vx; s.y += s.vy; s.life--; wrap(s); }
    shots = shots.filter((s) => s.life > 0);
    // shots vs rocks
    outer:
    for (let i = rocks.length - 1; i >= 0; i--) {
      for (let j = shots.length - 1; j >= 0; j--) {
        if (Math.hypot(rocks[i].x - shots[j].x, rocks[i].y - shots[j].y) < rocks[i].r) {
          shots.splice(j, 1);
          splitRock(i);
          continue outer;
        }
      }
    }
    // rocks vs ship
    if (!ship.safe) {
      for (let i = rocks.length - 1; i >= 0; i--) {
        if (Math.hypot(rocks[i].x - ship.x, rocks[i].y - ship.y) < rocks[i].r + 8) {
          boom(ship.x, ship.y, 22, ACCENT);
          flash = 8;
          splitRock(i);
          lives--;
          if (lives <= 0) {
            best = Math.max(best, score);
            state = "over";
          } else {
            ship.x = W / 2; ship.y = H / 2; ship.vx = ship.vy = 0; ship.a = -TAU / 4; ship.safe = 110;
          }
          break;
        }
      }
    }
  }

  function drawShip(x, y, a, ghost) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.strokeStyle = ghost ? MUTED : TEXT;
    ctx.beginPath();
    ctx.moveTo(12, 0); ctx.lineTo(-9, 7); ctx.lineTo(-5, 0); ctx.lineTo(-9, -7);
    ctx.closePath();
    ctx.stroke();
    if (keys.up && state === "play" && !ghost && (t & 2)) {
      ctx.strokeStyle = ACCENT;
      ctx.beginPath();
      ctx.moveTo(-7, 3); ctx.lineTo(-14, 0); ctx.lineTo(-7, -3);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Touch controls: rotate bottom-left, thrust + fire bottom-right
  const pads = [
    { id: "left",  x: 42,      y: H - 38, glyph: "arc-l" },
    { id: "right", x: 100,     y: H - 38, glyph: "arc-r" },
    { id: "up",    x: W - 100, y: H - 38, glyph: "thrust" },
    { id: "fire",  x: W - 42,  y: H - 38, glyph: "fire" }
  ];
  const PAD_R = 24;
  function drawPads() {
    if (!touch || state !== "play") return;
    ctx.strokeStyle = MUTED;
    ctx.globalAlpha = 0.5;
    for (const p of pads) {
      ctx.beginPath(); ctx.arc(p.x, p.y, PAD_R, 0, TAU); ctx.stroke();
      ctx.beginPath();
      if (p.glyph === "arc-l") { ctx.moveTo(p.x + 5, p.y - 8); ctx.lineTo(p.x - 6, p.y); ctx.lineTo(p.x + 5, p.y + 8); }
      if (p.glyph === "arc-r") { ctx.moveTo(p.x - 5, p.y - 8); ctx.lineTo(p.x + 6, p.y); ctx.lineTo(p.x - 5, p.y + 8); }
      if (p.glyph === "thrust") { ctx.moveTo(p.x - 8, p.y + 5); ctx.lineTo(p.x, p.y - 6); ctx.lineTo(p.x + 8, p.y + 5); }
      if (p.glyph === "fire") { ctx.arc(p.x, p.y, 4, 0, TAU); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (flash) { ctx.fillStyle = "rgba(255,107,96,0.08)"; ctx.fillRect(0, 0, W, H); }
    ctx.lineWidth = 1.5;
    for (const r of rocks) {
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.rot);
      ctx.strokeStyle = MUTED;
      ctx.beginPath();
      for (let i = 0; i < r.verts.length; i++) {
        const a = (i / r.verts.length) * TAU;
        const d = r.verts[i];
        i ? ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d) : ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = ACCENT;
    for (const s of shots) { ctx.beginPath(); ctx.arc(s.x, s.y, 2, 0, TAU); ctx.fill(); }
    for (const s of sparks) {
      ctx.globalAlpha = Math.min(1, s.life / 14);
      ctx.fillStyle = s.c;
      ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
    if (state === "play" && (!ship.safe || (t & 4))) drawShip(ship.x, ship.y, ship.a, ship.safe > 0);
    drawPads();
    // HUD
    ctx.fillStyle = MUTED;
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(String(score).padStart(5, "0"), 14, 24);
    ctx.textAlign = "right";
    ctx.fillText(best ? `best ${best}` : `wave ${wave}`, W - 14, 24);
    // lives as little ships
    for (let i = 0; i < lives && state === "play"; i++) drawShip(24 + i * 20, 44, -TAU / 4, true);
    ctx.textAlign = "center";
    if (state === "idle") {
      ctx.fillStyle = "rgba(20,22,26,0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = TEXT;
      ctx.font = "700 16px system-ui, sans-serif";
      ctx.fillText("Asteroids, while you wait", W / 2, H / 2 - 16);
      ctx.fillStyle = MUTED;
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.fillText(touch ? "Corner buttons steer, thrust and fire." : "Arrow keys turn and thrust · space fires", W / 2, H / 2 + 8);
      ctx.fillText(touch ? "Tap to start." : "Big rocks split - small ones score the most. Space to start.", W / 2, H / 2 + 28);
    } else if (state === "over") {
      ctx.fillStyle = TEXT;
      ctx.font = "700 16px system-ui, sans-serif";
      ctx.fillText(`Out of ships - ${score} points`, W / 2, H / 2 - 6);
      ctx.fillStyle = MUTED;
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.fillText(touch ? "Tap to fly again." : "Space to fly again.", W / 2, H / 2 + 18);
    }
  }

  function loop() {
    if (!running) return;
    // Off-play screens (idle card, game over) animate slow drifts
    // only - half the frame rate is invisible and halves the burn
    frame++;
    if (state === "play" || (frame & 1)) {
      step();
      draw();
    }
    raf = requestAnimationFrame(loop);
  }
  let frame = 0;

  // ---------- input ----------

  const KEYMAP = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up" };
  const onKeyDown = (e) => {
    if (!canvas || canvas.offsetParent === null) return; // page is live, game hidden
    if (!(e.code in KEYMAP) && e.code !== "Space" && e.code !== "ArrowDown") return;
    e.preventDefault();
    if (e.repeat) return;
    if (state !== "play") { if (e.code === "Space") newGame(); return; }
    if (e.code === "Space") fire();
    else if (e.code in KEYMAP) keys[KEYMAP[e.code]] = true;
  };
  const onKeyUp = (e) => {
    if (e.code in KEYMAP) keys[KEYMAP[e.code]] = false;
  };

  const toLocal = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  };
  const activePads = new Map(); // pointerId -> pad id
  const onDown = (e) => {
    e.preventDefault();
    if (state !== "play") { newGame(); return; }
    const p = toLocal(e);
    for (const pad of pads) {
      if (Math.hypot(p.x - pad.x, p.y - pad.y) < PAD_R + 12) {
        activePads.set(e.pointerId, pad.id);
        if (pad.id === "fire") fire();
        else keys[pad.id] = true;
        return;
      }
    }
    fire(); // tapping open space fires too
  };
  const onUp = (e) => {
    const id = activePads.get(e.pointerId);
    if (id && id !== "fire") keys[id] = false;
    activePads.delete(e.pointerId);
  };

  function start(el) {
    if (running) return;
    canvas = el;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state = "idle";
    // (best is deliberately NOT reset: it lives as long as the tab,
    // surviving the game being swapped out while the show is live)
    // A living background under the idle card
    rocks = []; shots = []; sparks = [];
    score = 0; lives = 3; wave = 0;
    newWave();
    running = true;
    canvas.addEventListener("pointerdown", onDown);
    // pointerup on window, not the canvas: the pads sit at the edges,
    // and a finger that slides off before lifting must still release
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    loop();
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    canvas.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    keys.left = keys.right = keys.up = false;
    state = "idle";
  }

  return { start, stop };
})();
