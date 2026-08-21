// A tiny one-button runner for the watch page while the show is off
// air: a microphone hops over amps and mic stands. Something to fiddle
// with while waiting. Pure canvas, no assets, no storage - the best
// score lives only as long as the tab.
window.OffAir = (() => {
  const W = 640, H = 200, GROUND = 168;
  let canvas = null, ctx = null, raf = 0, running = false;
  let state = "idle"; // idle | run | dead
  let best = 0;

  // Palette matched to the page
  const C = {
    line: "#2c3038", panel: "#1e2127", text: "#e8eaed",
    muted: "#9aa0a8", accent: "#fbc711", faint: "rgba(232,234,237,0.05)"
  };

  const player = { x: 74, y: GROUND, vy: 0, w: 22, h: 40 };
  let obstacles = [], waves = [], speed = 0, dist = 0, spawnAt = 0, t = 0;

  function reset() {
    player.y = GROUND; player.vy = 0;
    obstacles = []; speed = 4.4; dist = 0; spawnAt = W + 80; t = 0;
    if (!waves.length) {
      for (let i = 0; i < 6; i++) {
        waves.push({ x: Math.floor((i * 137) % W), y: 24 + ((i * 53) % 96), r: 10 + ((i * 29) % 26) });
      }
    }
  }

  function jump() {
    if (state === "idle") { state = "run"; reset(); return; }
    if (state === "dead") { state = "run"; reset(); return; }
    if (player.y >= GROUND - 0.5) player.vy = -10.6;
  }

  function spawn() {
    const roll = Math.random();
    if (roll < 0.45) {           // amp cabinet
      const s = 26 + Math.random() * 12;
      obstacles.push({ kind: "amp", x: W + 40, w: s, h: s });
    } else if (roll < 0.7) {     // stacked amps
      const s = 24 + Math.random() * 8;
      obstacles.push({ kind: "stack", x: W + 40, w: s, h: s * 1.8 });
    } else {                     // mic stand
      obstacles.push({ kind: "stand", x: W + 40, w: 16, h: 52 });
    }
    spawnAt = 230 + Math.random() * 320;
  }

  function step() {
    t++;
    speed = Math.min(9.5, speed + 0.0016);
    dist += speed;
    for (const w of waves) { w.x -= speed * 0.25; if (w.x < -40) { w.x += W + 80; } }
    spawnAt -= speed;
    if (spawnAt <= 0) spawn();
    player.vy += 0.52;
    player.y = Math.min(GROUND, player.y + player.vy);
    for (const o of obstacles) o.x -= speed;
    obstacles = obstacles.filter((o) => o.x + o.w > -20);
    // Collision, a touch forgiving on purpose
    const px = player.x - player.w / 2 + 3, pw = player.w - 6;
    const py = player.y - player.h + 4, ph = player.h - 6;
    for (const o of obstacles) {
      const ox = o.x - o.w / 2 + 2, ow = o.w - 4;
      const oy = GROUND - o.h + 2, oh = o.h - 2;
      if (px < ox + ow && px + pw > ox && py < oy + oh && py + ph > oy) {
        state = "dead";
        best = Math.max(best, score());
        break;
      }
    }
  }

  const score = () => Math.floor(dist / 12);

  function drawMic(x, y) {
    // A hand mic standing on its tail: rounded body, round grille head
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = C.text;
    const bw = player.w, bh = player.h - bw; // body below the head
    ctx.beginPath();
    ctx.roundRect(-bw / 2 + 3, -bh, bw - 6, bh, 4);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -bh - bw / 2 + 4, bw / 2 + 2, 0, Math.PI * 2);
    ctx.fillStyle = C.accent;
    ctx.fill();
    ctx.strokeStyle = C.panel;
    ctx.lineWidth = 1.5;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 5 - 3, -bh - bw + 2);
      ctx.lineTo(i * 5 + 3, -bh + 1);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawObstacle(o) {
    const x = o.x - o.w / 2, y = GROUND - o.h;
    ctx.strokeStyle = C.muted;
    ctx.fillStyle = C.panel;
    ctx.lineWidth = 2;
    if (o.kind === "stand") {
      ctx.beginPath();
      ctx.moveTo(o.x - o.w / 2, GROUND); ctx.lineTo(o.x + o.w / 2, GROUND); // base
      ctx.moveTo(o.x, GROUND); ctx.lineTo(o.x, y + 8);                      // pole
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(o.x, y + 5, 5, 0, Math.PI * 2);                               // mic clip
      ctx.fillStyle = C.muted;
      ctx.fill();
      return;
    }
    const one = (bx, by, bw, bh) => {
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 3); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(bx + bw / 2, by + bh / 2, Math.min(bw, bh) * 0.28, 0, Math.PI * 2); ctx.stroke();
    };
    if (o.kind === "stack") { one(x, y + o.h / 2, o.w, o.h / 2); one(x + 1, y, o.w - 2, o.h / 2); }
    else one(x, y, o.w, o.h);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // Drifting sound-ripple arcs, very faint
    ctx.strokeStyle = C.faint;
    ctx.lineWidth = 2;
    for (const w of waves) {
      for (let r = w.r; r > 0; r -= 9) {
        ctx.beginPath();
        ctx.arc(w.x, w.y, r, -0.6, 0.6);
        ctx.stroke();
      }
    }
    // Ground
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, GROUND + 1); ctx.lineTo(W, GROUND + 1); ctx.stroke();
    for (const o of obstacles) drawObstacle(o);
    drawMic(player.x, player.y);
    ctx.fillStyle = C.muted;
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.textAlign = "right";
    if (state !== "idle") ctx.fillText(String(score()).padStart(4, "0"), W - 14, 24);
    if (best > 0) ctx.fillText(`best ${best}`, W - 14, state === "idle" ? 24 : 42);
    ctx.textAlign = "center";
    if (state === "idle") {
      ctx.fillStyle = C.text;
      ctx.font = "700 15px system-ui, sans-serif";
      ctx.fillText("Sound check while you wait?", W / 2, 78);
      ctx.fillStyle = C.muted;
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.fillText("Tap or press space to jump", W / 2, 100);
    } else if (state === "dead") {
      ctx.fillStyle = C.text;
      ctx.font = "700 15px system-ui, sans-serif";
      ctx.fillText(`Off air! ${score()} - tap to go again`, W / 2, 78);
    }
  }

  function loop() {
    if (!running) return;
    if (state === "run") step();
    else for (const w of waves) { w.x -= 0.35; if (w.x < -40) w.x += W + 80; }
    draw();
    raf = requestAnimationFrame(loop);
  }

  const onKey = (e) => {
    if (e.code !== "Space" && e.code !== "ArrowUp") return;
    if (!canvas || canvas.offsetParent === null) return; // page is live, game hidden
    e.preventDefault();
    jump();
  };
  const onPointer = (e) => { e.preventDefault(); jump(); };

  function start(el) {
    if (running) return;
    canvas = el;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state = "idle";
    reset();
    running = true;
    canvas.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    loop();
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    canvas.removeEventListener("pointerdown", onPointer);
    window.removeEventListener("keydown", onKey);
    state = "idle";
  }

  return { start, stop };
})();
