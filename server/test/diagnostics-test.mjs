// Covers the setup check, which exists because self-hosters kept
// hitting "it installed fine but the call is a black screen" with
// nothing on screen explaining why. The important case is the last
// one: a reverse proxy that forwards the page but drops the WebSocket
// upgrade (the stock Nginx config) accepts the connection and then
// hangs rather than refusing it, so the check has to catch a timeout,
// not just an error.
//
// Self-contained: spawns its own throwaway server and a deliberately
// broken proxy, no args, no pre-existing server required.
//   node test/diagnostics-test.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3996;
const PROXY_PORT = 3995;
const B = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fossstudio-diag-test-"));

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
    SESSION_SECRET: "devsecret", TURN_SECRET: "devsecret"
  },
  stdio: "pipe"
});

// Stands in for a stock Nginx config: proxies ordinary HTTP fine, never
// handles 'upgrade', so the WebSocket hangs instead of connecting.
const proxy = http.createServer((req, res) => {
  const up = http.request(
    { host: "127.0.0.1", port: PORT, path: req.url, method: req.method, headers: req.headers },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }
  );
  up.on("error", () => { res.writeHead(502); res.end("bad gateway"); });
  req.pipe(up);
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

// Reads the page's finished checks as {title: level}
async function runPage(page, url) {
  await page.goto(url);
  await page.waitForFunction(
    () => document.getElementById("verdict").dataset.level !== "pending",
    { timeout: 40000 }
  );
  const rows = await page.$$eval(".check", (els) =>
    Object.fromEntries(els.map((e) => [e.querySelector("b").textContent, e.dataset.level]))
  );
  return rows;
}

let browser;
try {
  if (!await waitHealthy()) throw new Error("server never became healthy");
  await new Promise((r) => proxy.listen(PROXY_PORT, "127.0.0.1", r));

  // --- server-side checks react to what the proxy forwards ---
  // Raw http.request, not fetch: fetch refuses to set a Host header, and
  // the localhost-is-a-secure-context branch turns on exactly that.
  const asProxy = (proto) => new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port: PORT, path: "/diagnostics.json",
      headers: { Host: "studio.example.com", ...(proto ? { "X-Forwarded-Proto": proto } : {}) }
    }, (res) => {
      let body = "";
      res.on("data", (d) => { body += d; });
      res.on("end", () => resolve(JSON.parse(body)));
    });
    req.on("error", reject);
    req.end();
  });

  const https = await asProxy("https");
  check("HTTPS behind a proxy passes", https.checks[0].level === "ok", https.checks[0].title);

  const plain = await asProxy("http");
  check("plain HTTP behind a proxy fails", plain.checks[0].level === "fail", plain.checks[0].title);

  const silent = await asProxy(null);
  check("missing X-Forwarded-Proto warns", silent.checks[0].level === "warn", silent.checks[0].title);

  // PUBLIC_IP is unset in this test env, which is the single most common
  // cause of the black-screen report
  const ipCheck = plain.checks.find((c) => c.title.startsWith("PUBLIC_IP"));
  check("unset PUBLIC_IP fails", ipCheck?.level === "fail", ipCheck?.title);
  check("failing checks carry a fix", plain.checks.every((c) => c.level === "ok" || c.fix.length > 0));
  check("reports the media and relay ports", plain.ports.length === 3);

  const body = JSON.stringify(plain);
  check("leaks no secrets", !body.includes("devsecret") && !body.includes("testpass123"));

  // --- browser-side checks ---
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  const direct = await runPage(page, `${B}/diagnostics`);
  check("secure context passes on localhost", direct["This page is a secure context"] === "ok");
  check("live connection passes when reachable", direct["Live connection works"] === "ok");
  // No coturn in this test env, so the relay check must notice
  check("relay failure is reported", direct["Relay did not answer"] === "fail");

  const behindProxy = await runPage(page, `http://127.0.0.1:${PROXY_PORT}/diagnostics`);
  const wsRow = Object.keys(behindProxy).find((t) => t.startsWith("Live connection"));
  check("dropped WebSocket upgrade is caught", behindProxy[wsRow] === "fail", wsRow);
  check("and it names the upgrade headers as the fix",
    await page.$$eval(".check", (els) =>
      els.some((e) => e.dataset.level === "fail" && e.textContent.includes("proxy_set_header Upgrade"))));

  check("page has no console errors", errors.length === 0, errors.join("; "));
} catch (err) {
  check(`test run: ${err.message}`, false);
} finally {
  await browser?.close();
  proxy.close();
  server.kill("SIGKILL");
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(pass ? "ALL PASS" : "FAILURES");
process.exit(pass ? 0 : 1);
