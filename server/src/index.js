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
