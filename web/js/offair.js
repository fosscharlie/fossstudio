// Chain reaction, for the watch page while the show is off air: dots
// drift across the screen and you get ONE click - it plants a pulse,
// every dot it touches pulses too, and the chain does the rest. Catch
// the quota to move up a level. Pure canvas, no assets, no storage,
// no requests - progress lives only as long as the tab.
window.OffAir = (() => {
  const W = 640, H = 320;
  let canvas = null, ctx = null, raf = 0, running = false;
  let state = "idle"; // idle | aim | burst | cleared | failed

  // The site's card palette on the page's dark ground
  const HUES = ["#fbc711", "#2295f1", "#019587", "#e8207e", "#4bae4f",
                "#fe9700", "#9b26ae", "#00bcd3", "#f34236"];
  const TEXT = "#e8eaed", MUTED = "#9aa0a8";

  let dots = [], pulses = [], level = 1, best = 0, caught = 0, quota = 0, t = 0;

  // Dots on screen and the one-click quota: an easy first win, then a
  // climb - the late levels ask for most of the field in one chain
  const count = (l) => Math.min(10 + l * 5, 60);
  const need = (l) => Math.min(Math.round(count(l) * Math.min(0.85, 0.15 + l * 0.07)), count(l) - 2);

  function newLevel() {
    caught = 0;
    quota = need(level);
    dots = [];
    pulses = [];
    const n = count(level);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.35 + Math.random() * 0.55;
      dots.push({
        x: 20 + Math.random() * (W - 40),
        y: 20 + Math.random() * (H - 40),
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        c: HUES[i % HUES.length]
      });
    }
    state = "aim";
  }

  // life: grow ~0.5s, hold ~1.6s, fade ~0.6s
  const GROW = 26, HOLD = 130, FADE = 40, RMAX = 62;
  function radius(p) {
    if (p.age < GROW) return RMAX * (p.age / GROW);
    if (p.age < GROW + HOLD) return RMAX;
    return RMAX * Math.max(0, 1 - (p.age - GROW - HOLD) / FADE);
  }

  function plant(x, y, c) {
    pulses.push({ x, y, c, age: 0 });
  }

  function step() {
    t++;
    for (const d of dots) {
      d.x += d.vx; d.y += d.vy;
      if (d.x < 6 || d.x > W - 6) d.vx *= -1;
      if (d.y < 6 || d.y > H - 6) d.vy *= -1;
    }
    if (state !== "burst") return;
    for (const p of pulses) p.age++;
    pulses = pulses.filter((p) => p.age < GROW + HOLD + FADE);
    for (let i = dots.length - 1; i >= 0; i--) {
      const d = dots[i];
      for (const p of pulses) {
        if (Math.hypot(d.x - p.x, d.y - p.y) < radius(p) + 5) {
          dots.splice(i, 1);
          caught++;
          plant(d.x, d.y, d.c);
          break;
        }
      }
    }
    if (!pulses.length) {
      if (caught >= quota) {
        best = Math.max(best, level);
        level++;
        state = "cleared";
      } else {
        state = "failed";
      }
      setTimeout(() => { if (running && (state === "cleared" || state === "failed")) newLevel(); }, 1800);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // Pulses first, soft glow under the dots
    for (const p of pulses) {
      const r = radius(p);
      if (r <= 0) continue;
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = p.c;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const d of dots) {
      ctx.fillStyle = d.c;
      ctx.beginPath(); ctx.arc(d.x, d.y, 5, 0, Math.PI * 2); ctx.fill();
    }
    // HUD
    ctx.fillStyle = MUTED;
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`Level ${level}`, 14, 24);
    ctx.textAlign = "right";
    ctx.fillText(best ? `caught ${caught}/${quota} · best level ${best}` : `caught ${caught}/${quota}`, W - 14, 24);
    ctx.textAlign = "center";
    if (state === "idle") {
      ctx.fillStyle = "rgba(20,22,26,0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = TEXT;
      ctx.font = "700 16px system-ui, sans-serif";
      ctx.fillText("One click. Start a chain.", W / 2, H / 2 - 14);
      ctx.fillStyle = MUTED;
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.fillText(`Anything your pulse touches pulses too. Catch ${need(1)} of ${count(1)}.`, W / 2, H / 2 + 10);
      ctx.fillText("Tap anywhere to begin.", W / 2, H / 2 + 30);
    } else if (state === "aim") {
      ctx.fillStyle = MUTED;
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.fillText(`One click: catch ${quota} of ${dots.length}`, W / 2, H - 14);
    } else if (state === "cleared") {
      ctx.fillStyle = TEXT;
      ctx.font = "700 15px system-ui, sans-serif";
      ctx.fillText(`Beautiful - ${caught} caught. Level ${level} coming up.`, W / 2, 52);
    } else if (state === "failed") {
      ctx.fillStyle = TEXT;
      ctx.font = "700 15px system-ui, sans-serif";
      ctx.fillText(`${caught} of ${quota} - the chain fizzled. Again?`, W / 2, 52);
    }
  }

  const toLocal = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  };
  const onDown = (e) => {
    e.preventDefault();
    if (state === "idle") { newLevel(); return; }
    if (state !== "aim") return;
    const p = toLocal(e);
    plant(p.x, p.y, TEXT);
    state = "burst";
  };
  // Keyboard: arrows drift a crosshair, Space plants the pulse
  const cross = { x: W / 2, y: H / 2, on: false };
  const onKey = (e) => {
    if (!canvas || canvas.offsetParent === null) return; // page is live, game hidden
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "Enter"].includes(e.code)) return;
    e.preventDefault();
    if (state === "idle") { newLevel(); return; }
    if (state !== "aim") return;
    cross.on = true;
    const s = 18;
    if (e.code === "ArrowLeft") cross.x = Math.max(0, cross.x - s);
    if (e.code === "ArrowRight") cross.x = Math.min(W, cross.x + s);
    if (e.code === "ArrowUp") cross.y = Math.max(0, cross.y - s);
    if (e.code === "ArrowDown") cross.y = Math.min(H, cross.y + s);
    if (e.code === "Space" || e.code === "Enter") {
      plant(cross.x, cross.y, TEXT);
      state = "burst";
      cross.on = false;
    }
  };
  // The crosshair rides on top of draw() so it needs its own pass
  const drawCross = () => {
    if (!cross.on || state !== "aim") return;
    ctx.strokeStyle = TEXT;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(cross.x - 8, cross.y); ctx.lineTo(cross.x + 8, cross.y);
    ctx.moveTo(cross.x, cross.y - 8); ctx.lineTo(cross.x, cross.y + 8);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  const baseDraw = draw;
  const drawAll = () => { baseDraw(); drawCross(); };

  function loopAll() {
    if (!running) return;
    step();
    drawAll();
    raf = requestAnimationFrame(loopAll);
  }

  function start(el) {
    if (running) return;
    canvas = el;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state = "idle";
    level = 1; best = 0;
    // A living background even before the first click
    quota = need(1);
    dots = [];
    newLevel();
    state = "idle";
    running = true;
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    loopAll();
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    canvas.removeEventListener("pointerdown", onDown);
    window.removeEventListener("keydown", onKey);
    state = "idle";
  }

  return { start, stop };
})();
