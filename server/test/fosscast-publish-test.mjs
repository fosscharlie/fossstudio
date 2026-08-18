// Covers the FOSSCast integration: publishing a recording as a draft
// episode via FOSSCast's stable publish API (PUT media, POST episode,
// bearer token), and the settings that drive it. A stub FOSSCast runs
// locally so the whole flow is exercised without a real instance.
//
// Self-contained: spawns its own throwaway server on a scratch data
// dir, no args, no pre-existing server required.
//   node test/fosscast-publish-test.mjs
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3991;
const CAST_PORT = 3990;
const B = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fossstudio-publish-test-"));

let pass = true;
function check(label, ok, extra = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !extra ? "" : ` (${extra})`}`);
  pass &&= ok;
}

// ---------- stub FOSSCast ----------
const seen = { media: null, episode: null };
const cast = http.createServer((req, res) => {
  const auth = req.headers.authorization;
  if (auth !== "Bearer test-publisher-token") {
    res.writeHead(401); return res.end("{}");
  }
  const url = new URL(req.url, "http://localhost");
  if (req.method === "PUT" && url.pathname === "/api/v1/media") {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      seen.media = { filename: url.searchParams.get("filename"), size: Buffer.concat(chunks).length };
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ urlPath: `/media/test-show/${seen.media.filename}`, size: seen.media.size }));
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/v1/episodes") {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      seen.episode = JSON.parse(Buffer.concat(chunks).toString());
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, id: "ep1", draft: true, editUrl: "/admin/episodes/ep1" }));
    });
    return;
  }
  res.writeHead(404); res.end("{}");
});

// ---------- studio server ----------
const server = spawn("node", ["src/index.js"], {
  cwd: path.join(HERE, ".."),
  env: {
    ...process.env,
    HTTP_PORT: String(PORT), DATA_DIR, HOST_PASSWORD: "testpass123",
    SESSION_SECRET: "devsecret", TURN_SECRET: "devsecret",
    ALLOW_FILE_STREAM: "1" // lets fosscastUrl be http://127.0.0.1 for the stub
  },
  stdio: "pipe"
});

async function waitHealthy(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if ((await fetch(`${B}/healthz`)).ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function login(username, password) {
  const r = await fetch(`${B}/api/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!r.ok) throw new Error(`login ${username}: ${r.status}`);
  return r.headers.get("set-cookie").split(";")[0];
}

try {
  await new Promise((r) => cast.listen(CAST_PORT, "127.0.0.1", r));
  if (!await waitHealthy()) throw new Error("server never became healthy");

  const admin = await login("admin", "testpass123");
  await fetch(`${B}/api/users`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: admin },
    body: JSON.stringify({ username: "testhost", password: "testhostpass123" })
  });
  const host = await login("testhost", "testhostpass123");
  const j = (r) => r.json();
  const api = (p, opts = {}) => fetch(`${B}/api${p}`, {
    ...opts, headers: { "Content-Type": "application/json", Cookie: host, ...(opts.headers || {}) }
  });

  // ---------- settings round-trip ----------
  await api("/settings", { method: "PUT", body: JSON.stringify({
    fosscastUrl: `http://127.0.0.1:${CAST_PORT}`,
    fosscastToken: "test-publisher-token"
  }) });
  const s = await j(await api("/settings"));
  check("fosscast address saved", s.fosscastUrl === `http://127.0.0.1:${CAST_PORT}`, s.fosscastUrl);

  await api("/settings", { method: "PUT", body: JSON.stringify({ fosscastUrl: "javascript:alert(1)" }) });
  const s2 = await j(await api("/settings"));
  check("non-https fosscast address rejected", s2.fosscastUrl === `http://127.0.0.1:${CAST_PORT}`);

  // ---------- a recording to publish ----------
  const uid = (await j(await api("/me"))).uid;
  const recId = "testroom-2026-08-16T12-00-00";
  const outDir = path.join(DATA_DIR, "recordings", recId, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const bytes = Buffer.alloc(64 * 1024, 7);
  fs.writeFileSync(path.join(outDir, "combined.mp4"), bytes);
  fs.writeFileSync(path.join(DATA_DIR, "recordings.json"), JSON.stringify([{
    id: recId, roomId: "testroom", ownerId: uid, mode: "browser",
    title: "The Pilot Episode!", startedAt: Date.parse("2026-08-16T12:00:00Z"),
    endedAt: Date.parse("2026-08-16T13:00:00Z"), status: "ready", files: ["combined.mp4"]
  }]));

  // ---------- publish ----------
  const pub = await api(`/recordings/${recId}/publish`, {
    method: "POST", body: JSON.stringify({ file: "combined.mp4" })
  });
  const out = await j(pub);
  check("publish succeeds", pub.ok, JSON.stringify(out));
  check("arrives as a draft", out.draft === true);
  check("edit link returned", out.editUrl === "/admin/episodes/ep1", String(out.editUrl));
  check("media uploaded byte-for-byte", seen.media?.size === bytes.length, String(seen.media?.size));
  check("clean dated filename", seen.media?.filename === "2026-08-16-the-pilot-episode.mp4", seen.media?.filename);
  check("episode carries the title", seen.episode?.title === "The Pilot Episode!", seen.episode?.title);
  check("episode points at the uploaded media", seen.episode?.mediaUrl === `/media/test-show/${seen.media?.filename}`);

  // ---------- guard rails ----------
  const missing = await api(`/recordings/${recId}/publish`, {
    method: "POST", body: JSON.stringify({ file: "nope.mp4" })
  });
  check("unknown file rejected", missing.status === 404);

  await api("/settings", { method: "PUT", body: JSON.stringify({ fosscastToken: "" }) });
  const unconfigured = await api(`/recordings/${recId}/publish`, {
    method: "POST", body: JSON.stringify({ file: "combined.mp4" })
  });
  check("publish without a token explains itself", unconfigured.status === 400 &&
    (await j(unconfigured)).error.includes("FOSSCast"));
} catch (err) {
  check(`test run: ${err.message}`, false);
} finally {
  cast.close();
  server.kill("SIGKILL");
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(pass ? "ALL PASS" : "FAILURES");
process.exit(pass ? 0 : 1);
