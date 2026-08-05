import express from "express";
import path from "node:path";
import { config } from "./config.js";

const app = express();
app.disable("x-powered-by");

app.get("/healthz", (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

app.use(express.static(config.webDir, { index: "index.html" }));

app.use((req, res) => {
  res.status(404).sendFile(path.join(config.webDir, "404.html"), (err) => {
    if (err) res.status(404).send("Not found");
  });
});

// Only Caddy talks to the app directly, so bind to loopback.
app.listen(config.httpPort, "127.0.0.1", () => {
  console.log(`FOSS Studio listening on 127.0.0.1:${config.httpPort}`);
});
