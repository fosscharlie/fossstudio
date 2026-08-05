import express from "express";
import http from "node:http";
import path from "node:path";
import { config } from "./config.js";
import { startMediasoup } from "./media.js";
import { attachSignaling } from "./signaling.js";

const app = express();
app.disable("x-powered-by");

app.get("/healthz", (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

// Session links guests receive: https://<domain>/s/<room-id>
app.get("/s/:roomId([a-zA-Z0-9_-]{4,32})", (req, res) => {
  res.sendFile(path.join(config.webDir, "session.html"));
});

app.use(express.static(config.webDir, { index: "index.html" }));

app.use((req, res) => {
  res.status(404).sendFile(path.join(config.webDir, "404.html"), (err) => {
    if (err) res.status(404).send("Not found");
  });
});

const server = http.createServer(app);
attachSignaling(server);

await startMediasoup();

// Only Caddy talks to the app directly, so bind to loopback.
server.listen(config.httpPort, "127.0.0.1", () => {
  console.log(`FOSS Studio listening on 127.0.0.1:${config.httpPort}`);
});
