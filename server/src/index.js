import express from "express";
import http from "node:http";
import path from "node:path";
import { config } from "./config.js";
import { startMediasoup } from "./media.js";
import { attachSignaling } from "./signaling.js";
import { api } from "./api.js";
import { isAuthedRequest } from "./auth.js";
import { scheduleDailyBackups, sendAlertEmail } from "./ops.js";
import { initPush } from "./push.js";

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
    "script-src 'self'",
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
  // Pages and the service worker must always come from the server —
  // a cached copy pins old asset versions and serves stale app code
  if (/^\/(s\/|host\/?$|sw\.js$)|\.html$|^\/$/.test(req.path)) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

app.use("/api", api);

// The dashboard shell requires login; everything inside it is API-gated too
app.get(["/host", "/host/"], (req, res) => {
  if (!isAuthedRequest(req)) return res.redirect("/host/login.html");
  res.sendFile(path.join(config.webDir, "host", "index.html"));
});

app.get("/healthz", (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

// Session links guests receive: https://<domain>/s/<room-id>
app.get("/s/:roomId([a-zA-Z0-9_-]{4,32})", (req, res) => {
  res.sendFile(path.join(config.webDir, "session.html"));
});

// Big unchanging assets get real caching; pages stay fresh
for (const dir of ["assets", "fonts", "icons"]) {
  app.use(`/${dir}`, express.static(path.join(config.webDir, dir), { maxAge: "7d" }));
}
app.use(express.static(config.webDir, { index: "index.html" }));

app.use((req, res) => {
  res.status(404).sendFile(path.join(config.webDir, "404.html"), (err) => {
    if (err) res.status(404).send("Not found");
  });
});

const server = http.createServer(app);
attachSignaling(server);

await startMediasoup();
await initPush();
scheduleDailyBackups();

process.on("uncaughtException", (err) => {
  console.error("uncaught exception:", err.stack || err.message);
  sendAlertEmail("FOSSStudio hit an error", String(err.stack || err.message)).catch(() => {});
});
process.on("unhandledRejection", (err) => {
  console.error("unhandled rejection:", err?.stack || String(err));
});

// Only Caddy talks to the app directly, so bind to loopback.
server.listen(config.httpPort, "127.0.0.1", () => {
  console.log(`FOSS Studio listening on 127.0.0.1:${config.httpPort}`);
});
