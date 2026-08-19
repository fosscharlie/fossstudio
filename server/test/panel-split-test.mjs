// The admin (fleet) panel and a host dashboard are separate sessions
// with separate cookies, so both can be open in one browser at once.
// This drives one real browser context through exactly that: sign in
// as admin, then as a host in another tab, and confirm neither session
// evicts the other - which is what used to happen with a single shared
// cookie (going to the site root while the admin panel was open landed
// you in the fleet's host list).
//
// Self-contained: spawns its own throwaway server on a scratch data
// dir, no args, no pre-existing server required.
//   node test/panel-split-test.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3985;
const B = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fossstudio-panel-test-"));

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

async function waitHealthy(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if ((await fetch(`${B}/healthz`)).ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function signIn(page, username, password) {
  await page.goto(`${B}/host/login.html`);
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.endsWith("login.html"), { timeout: 8000 });
  return new URL(page.url()).pathname;
}

let browser;
try {
  if (!await waitHealthy()) throw new Error("server never became healthy");
  browser = await chromium.launch();
  // ONE context = one browser profile = shared cookie jar: the whole
  // point is that both sessions live in the same jar
  const ctx = await browser.newContext();

  // Admin signs in and lands in the fleet panel
  const adminPage = await ctx.newPage();
  const adminLanding = await signIn(adminPage, "admin", "testpass123");
  check("admin login lands at /admin/", adminLanding === "/admin/", adminLanding);
  await adminPage.waitForSelector('#mainMenu button:has-text("Hosts")');
  await adminPage.evaluate(() => fetch("/api/users", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Panel": "admin" },
    body: JSON.stringify({ username: "testhost", password: "testhostpass123" })
  }));

  // With only the admin session, the root leads to the HOST login -
  // not into the fleet
  const rootPage = await ctx.newPage();
  await rootPage.goto(`${B}/`);
  check("root shows the host login while the admin panel is open",
    new URL(rootPage.url()).pathname === "/host/login.html", rootPage.url());

  // A host signs in from that same tab; the admin panel must survive
  const hostLanding = await signIn(rootPage, "testhost", "testhostpass123");
  check("host login lands at /host/", hostLanding === "/host/", hostLanding);
  await rootPage.waitForSelector('#mainMenu button:has-text("Sessions")');

  // Both panels now work side by side, each as its own identity
  const adminMe = await adminPage.evaluate(() =>
    fetch("/api/me", { headers: { "X-Panel": "admin" } }).then((r) => r.json()));
  const hostMe = await rootPage.evaluate(() =>
    fetch("/api/me", { headers: { "X-Panel": "host" } }).then((r) => r.json()));
  check("admin tab still answers as admin", adminMe.role === "admin", JSON.stringify(adminMe));
  check("host tab answers as the host", hostMe.username === "testhost", JSON.stringify(hostMe));

  // The admin panel still does admin things after the host login
  const users = await adminPage.evaluate(() =>
    fetch("/api/users", { headers: { "X-Panel": "admin" } }).then((r) => r.status));
  check("admin APIs still work in the admin tab", users === 200, String(users));

  // /admin/ never opens for a host-only session, /host/ never for admin-only
  const hostOnlyCtx = await browser.newContext();
  const h = await hostOnlyCtx.newPage();
  await signIn(h, "testhost", "testhostpass123");
  await h.goto(`${B}/admin/`);
  check("a host session cannot open the fleet panel",
    new URL(h.url()).pathname === "/host/login.html", h.url());
  await hostOnlyCtx.close();

  // Logging out of one panel leaves the other signed in
  await rootPage.click("#logoutBtn");
  await rootPage.waitForURL("**/login.html");
  const adminStill = await adminPage.evaluate(() =>
    fetch("/api/me", { headers: { "X-Panel": "admin" } }).then((r) => r.json()));
  check("host logout leaves the admin session signed in", adminStill.role === "admin",
    JSON.stringify(adminStill));
} catch (err) {
  check(`test run: ${err.message}`, false);
} finally {
  await browser?.close();
  server.kill("SIGKILL");
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(pass ? "ALL PASS" : "FAILURES");
process.exit(pass ? 0 : 1);
