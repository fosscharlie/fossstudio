import express from "express";
import http from "node:http";
import path from "node:path";
import { config, panelDomains } from "./config.js";
import { startMediasoup } from "./media.js";
import { attachSignaling } from "./signaling.js";
import { api } from "./api.js";
import { isAuthedRequest } from "./auth.js";
import { scheduleDailyBackups, sendAlertEmail } from "./ops.js";
import { initPush } from "./push.js";
import { resumeOrphanedRecordings, activeRenderCount } from "./recording/manager.js";
import { diagnostics } from "./diagnostics.js";
import { attachChat } from "./livechat.js";
import { migrateIntros } from "./introcoder.js";
import { findSession } from "./settings.js";

const app = express();
app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  // Content Security Policy: everything loads from our own origin. No
  // inline scripts (they were externalised); inline styles are still
  // used as element style= attributes. blob:/data: cover the audio
  // worklet and canvas-drawn banner images; wss: is the signaling
  // socket. frame-ancestors none double-locks against clickjacking.
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    // wasm-unsafe-eval lets the RNNoise AudioWorklet compile its
    // WebAssembly (noise suppression). It permits WASM only - NOT JS
    // eval() - so script-src stays strict against injected scripts.
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self' wss: ws:",
    "worker-src 'self' blob:",
    "font-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'"
  ].join("; "));
  // Pages and the service worker must always come from the server -
  // a cached copy pins old asset versions and serves stale app code
  if (/^\/(s\/|host\/?$|admin\/?$|sw\.js$)|\.html$|^\/$/.test(req.path)) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

app.use("/api", api);

// The two panels are separate sessions with separate cookies, so the
// admin (fleet) panel and a host dashboard can be open side by side.
// Same shell, gated by the matching cookie; everything inside is
// API-gated too.
app.get(["/host", "/host/"], (req, res) => {
  if (!isAuthedRequest(req, "host")) return res.redirect("/host/login.html");
  res.sendFile(path.join(config.webDir, "host", "index.html"));
});
app.get(["/admin", "/admin/"], (req, res) => {
  if (!isAuthedRequest(req, "admin")) return res.redirect("/host/login.html");
  res.sendFile(path.join(config.webDir, "host", "index.html"));
});

app.get("/healthz", (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

// A deploy checks this before recreating the container: recreating it
// mid-render kills the ffmpeg process (that cost a real show its
// combined video once) - the deploy script waits a bit if this is
// nonzero. No details beyond a count; same posture as /healthz, and
// kept at top level (not under /api) for the same reason.
app.get("/render-status", (req, res) => {
  res.json({ rendering: activeRenderCount() });
});

// Setup self-check for whoever installed this. Unauthenticated on
// purpose - see the note at the top of diagnostics.js.
app.get("/diagnostics", (req, res) => {
  res.sendFile(path.join(config.webDir, "diagnostics.html"));
});
app.get("/diagnostics.json", (req, res) => {
  res.json(diagnostics(req));
});

// The root goes to the dashboard: on the dedicated panel domains
// (admin.example.com / host.example.com, when configured) straight to
// that panel; anywhere else to the host side. Each shows its login when
// signed out. Guests never visit the root - they arrive on /s/<id>
// links - so nothing is lost by forwarding it.
app.get("/", (req, res) => {
  const target = panelDomains("admin").has((req.hostname || "").toLowerCase())
    ? "/admin/" : "/host/";
  res.redirect(target);
});

// Caddy asks here before fetching a certificate on demand: only the
// panel domains derived from DOMAIN (plus explicit ADMIN_DOMAIN /
// HOST_DOMAIN) are approved, so pointing a random name at this server
// can never mint a certificate. Same public posture as /healthz - the
// answer reveals nothing beyond names any visitor already sees.
app.get("/tls-allowed", (req, res) => {
  const d = String(req.query.domain || "").toLowerCase();
  const ok = panelDomains("admin").has(d) || panelDomains("host").has(d);
  res.status(ok ? 200 : 404).end();
});

// Session links guests receive: https://<domain>/s/<room-id>
app.get("/s/:roomId([a-zA-Z0-9_-]{4,32})", (req, res) => {
  res.sendFile(path.join(config.webDir, "session.html"));
});

// The audience watch page: the live show with chat beside it. Public by
// design, same trust as a session link - it can only ever receive.
app.get("/live/:roomId([a-zA-Z0-9_-]{4,32})", async (req, res) => {
  const session = await findSession(req.params.roomId);
  if (!session) {
    return res.status(404).sendFile(path.join(config.webDir, "404.html"), (err) => {
      if (err) res.status(404).send("Not found");
    });
  }
  res.sendFile(path.join(config.webDir, "live.html"));
});

// HLS playlist and segments for the watch page, written by the stream
// engine under data/live/<room>. The playlist must never be cached (it
// grows while live); finished segments never change, so a short cache
// keeps many viewers cheap.
app.get("/live/:roomId([a-zA-Z0-9_-]{4,32})/media/:file", (req, res) => {
  const file = path.basename(req.params.file);
  if (!/^(live\.m3u8|seg-\d+-\d+\.m4s|init-\d+\.mp4)$/.test(file)) return res.status(404).end();
  res.setHeader("Cache-Control", file.endsWith(".m3u8") ? "no-store" : "public, max-age=60");
  res.sendFile(path.join(config.dataDir, "live", req.params.roomId, file), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// Big unchanging assets get real caching; pages stay fresh
for (const dir of ["assets", "fonts", "icons"]) {
  app.use(`/${dir}`, express.static(path.join(config.webDir, dir), { maxAge: "7d" }));
}
app.use(express.static(config.webDir, { index: false }));

app.use((req, res) => {
  res.status(404).sendFile(path.join(config.webDir, "404.html"), (err) => {
    if (err) res.status(404).send("Not found");
  });
});

const server = http.createServer(app);
// Two WebSocket endpoints share the server: /ws (session signaling) and
// /chat (watch-page chat). Routed here by path - ws's own per-path
// binding rejects the other endpoint's upgrades with a 400.
const wssSignal = attachSignaling();
const wssChat = attachChat();
server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const wss = pathname === "/ws" ? wssSignal : pathname === "/chat" ? wssChat : null;
  if (!wss) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

await startMediasoup();
await initPush();
scheduleDailyBackups();

// A recording can be left mid-render if the process dies before it
// finishes (a deploy recreating the container is exactly what did this
// once) - pick any of those back up now, rather than leaving them
// stuck on "processing" forever with no active render behind them.
resumeOrphanedRecordings().then((n) => {
  if (n > 0) {
    console.log(`resumed ${n} orphaned recording(s) from a previous run`);
    sendAlertEmail(
      "FOSSStudio resumed interrupted recording(s)",
      `${n} recording(s) were mid-render when the server last stopped and have been resumed automatically. Worth checking the dashboard to confirm they came out correctly.`
    ).catch(() => {});
  }
}).catch((err) => console.error("resumeOrphanedRecordings failed:", err.message));

// Intros uploaded before the 720p bound existed get converted once,
// quietly, after boot - so no guest's machine ever has to fight an
// oversized fullscreen video mid-show again.
migrateIntros().then((n) => {
  if (n > 0) console.log(`${n} intro(s) converted to bounded 720p H.264`);
}).catch((err) => console.error("intro migration failed:", err.message));

process.on("uncaughtException", (err) => {
  console.error("uncaught exception:", err.stack || err.message);
  sendAlertEmail("FOSSStudio hit an error", String(err.stack || err.message)).catch(() => {});
});
process.on("unhandledRejection", (err) => {
  console.error("unhandled rejection:", err?.stack || String(err));
});

// Loopback by default: only the reverse proxy on this host talks to the
// app directly. BIND_HOST widens that for setups with no local proxy
// (e.g. a Tailscale address, or 0.0.0.0 behind a proxy in another
// container) - never expose the app port itself to the open internet.
server.listen(config.httpPort, config.bindHost, () => {
  console.log(`FOSS Studio listening on ${config.bindHost}:${config.httpPort}`);
});
