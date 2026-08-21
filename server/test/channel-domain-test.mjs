// A host's custom channel domain (live.fossnerds.org): saved in the
// dashboard, gating /tls-allowed, and serving the channel page at the
// domain's root. All plain HTTP with a spoofed Host header - Caddy
// passes the original Host through, so the app sees exactly this.
//
// Self-contained: spawns its own throwaway server, no args.
//   node test/channel-domain-test.mjs
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hostLogin, TEST_HOST } from "./helpers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3994;
const B = `http://127.0.0.1:${PORT}`;
const DOMAIN = "live.fossnerds.example";
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fossstudio-chandom-test-"));

let pass = true;
function check(label, ok, extra = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !extra ? "" : ` (${extra})`}`);
  pass &&= ok;
}

const server = spawn("node", ["src/index.js"], {
  cwd: path.join(HERE, ".."),
  env: {
    ...process.env,
    HTTP_PORT: String(PORT), DATA_DIR, HOST_PASSWORD: "testpass123",
    SESSION_SECRET: "devsecret", TURN_SECRET: "devsecret",
    DOMAIN: "app.studio.example"
  },
  stdio: "pipe"
});

async function waitHealthy(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${B}/healthz`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// fetch() silently rewrites a spoofed Host header to the real target,
// so requests pretending to arrive on the channel domain go over the
// raw http client instead
const asDomain = (p) => new Promise((resolve, reject) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p, headers: { Host: DOMAIN } }, (r) => {
    let body = "";
    r.on("data", (c) => { body += c; });
    r.on("end", () => resolve({ status: r.statusCode, text: () => body, json: () => JSON.parse(body) }));
  }).on("error", reject);
});

try {
  check("server came up", await waitHealthy());
  const cookie = await hostLogin(B, "testpass123");
  const put = (body) => fetch(`${B}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body)
  });

  // Before anyone claims it: no certificate, and the root is the login redirect
  check("unclaimed domain gets no certificate",
    (await fetch(`${B}/tls-allowed?domain=${DOMAIN}`)).status === 404);
  check("unclaimed domain root is not a channel page",
    (await asDomain("/")).status === 302);

  // Claim it
  let r = await put({ channelDomain: ` HTTPS://${DOMAIN}/some/path ` });
  const saved = await r.json();
  check("saving normalises scheme, path and case", saved.channelDomain === DOMAIN,
    JSON.stringify(saved.channelDomain));

  // Now: certificate approved, channel page at the root, status by Host
  check("claimed domain gets a certificate",
    (await fetch(`${B}/tls-allowed?domain=${DOMAIN}`)).status === 200);
  const root = await asDomain("/");
  check("claimed domain root serves the watch page",
    root.status === 200 && root.text().includes("live.js"));
  const here = (await asDomain("/api/live-here")).json();
  check("live-here answers for the domain's owner",
    here.live === false && here.title === TEST_HOST.username, JSON.stringify(here));
  check("live-here on the studio domain is a 404",
    (await fetch(`${B}/api/live-here`)).status === 404);

  // What can't be claimed
  check("the studio's own domain is refused",
    (await put({ channelDomain: "app.studio.example" })).status === 400);
  check("a derived panel domain is refused",
    (await put({ channelDomain: "admin.studio.example" })).status === 400);
  check("a non-domain is refused",
    (await put({ channelDomain: "not a domain" })).status === 400);
  const admin = await fetch(`${B}/api/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "testpass123" })
  }).then((res) => res.headers.get("set-cookie").split(";")[0]);
  const steal = await fetch(`${B}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: admin },
    body: JSON.stringify({ channelDomain: DOMAIN })
  });
  check("another account cannot claim a taken domain", steal.status === 400);

  // Clearing releases it
  r = await put({ channelDomain: "" });
  check("clearing empties the setting", (await r.json()).channelDomain === "");
  check("released domain loses its certificate",
    (await fetch(`${B}/tls-allowed?domain=${DOMAIN}`)).status === 404);
} finally {
  server.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(pass ? "\nPASS  channel domains behave" : "\nFAIL  see above");
process.exit(pass ? 0 : 1);
