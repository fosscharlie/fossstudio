// Regression test for the exact failure that lost part of a real show
// (see CHANGELOG "resume orphaned recordings"): a deploy recreating the
// app container mid-render left a recording stuck on "processing"
// forever, with no active render behind it. This test reproduces that
// precisely - kills the server itself while a render is in flight -
// then restarts it and confirms resumeOrphanedRecordings() finishes
// the job automatically.
//
// Self-contained: spawns its own throwaway server on a scratch data
// dir, no args, no pre-existing server required.
//   node test/resume-orphaned-recording-test.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hostLogin, makeRoom } from "./helpers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const B = "http://127.0.0.1:3998";
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fossstudio-resume-test-"));
const ENV = {
  ...process.env,
  HTTP_PORT: "3998", DATA_DIR, HOST_PASSWORD: "testpass123",
  SESSION_SECRET: "devsecret", TURN_SECRET: "devsecret"
};

let pass = true;
function check(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  pass &&= ok;
}

function startServer() {
  const p = spawn("node", ["src/index.js"], { cwd: path.join(HERE, ".."), env: ENV, stdio: "pipe" });
  let out = "";
  p.stdout.on("data", (d) => { out += d; });
  p.stderr.on("data", (d) => { out += d; });
  p.getLog = () => out;
  return p;
}

async function waitHealthy(timeoutMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${B}/healthz`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

let server = startServer();
check("server started", await waitHealthy());

const cookie = await hostLogin(B, "testpass123");
const ROOM = await makeRoom(B, "testpass123", "Resume test");

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required"]
});
const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1400, height: 900 } });
const login = await ctx.newPage();
await login.goto(`${B}/host/login.html`);
await login.fill("#username", "testhost");
await login.fill("#password", "testhostpass123");
await login.click("button[type=submit]");
await login.waitForURL("**/host/");
await login.close();
const page = await ctx.newPage();
await page.goto(`${B}/s/${ROOM}?as=host`);
await page.waitForSelector("#joinBtn:not([disabled])");
await page.fill("#nameInput", "Host");
await page.click("#joinBtn");
await page.waitForSelector("#session:not([hidden])");
await page.click("#hpRecordBtn");
await page.waitForTimeout(15000);
await page.click("#hpRecordBtn"); // stop -> finalize() starts server-side

// Poll for the exact instant finalize() has started (status flips to
// "processing") and kill the server right then - no fixed sleep, so
// this reliably lands mid-render regardless of machine speed.
let recId = null;
let caughtProcessing = false;
for (let i = 0; i < 400 && !caughtProcessing; i++) {
  const recs = await fetch(`${B}/api/recordings`, { headers: { Cookie: cookie } })
    .then((r) => r.json()).catch(() => []);
  const rec = Array.isArray(recs) ? recs.find((r) => r.roomId === ROOM) : null;
  if (rec?.status === "processing") { recId = rec.id; caughtProcessing = true; break; }
  if (rec?.status === "ready") break; // too fast to catch - report below
  await new Promise((r) => setTimeout(r, 40));
}
check("caught the recording mid-render (status=processing)", caughtProcessing);

await browser.close();

if (caughtProcessing) {
  server.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 500));
  check("server process actually died", !(await waitHealthy(1500)));

  const snapshotPath = path.join(DATA_DIR, "recordings", recId, "rec.json");
  check("crash snapshot (rec.json) was left behind", fs.existsSync(snapshotPath));
  const outDir = path.join(DATA_DIR, "recordings", recId, "out");
  const midCrashFiles = fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
  check("combined.mp4 did NOT exist right after the crash (proves it died mid-render)",
    !midCrashFiles.includes("combined.mp4"));

  // Restart on the same data dir - this is the actual fix under test
  server = startServer();
  check("server restarted", await waitHealthy());
  check("startup log reports the resume",
    /resumed 1 orphaned recording/.test(server.getLog()) || await (async () => {
      // log may arrive a beat after healthz; give it a moment
      await new Promise((r) => setTimeout(r, 500));
      return /resumed 1 orphaned recording/.test(server.getLog());
    })());

  // Give the (tiny) render time to finish, then check the outcome
  let final = null;
  for (let i = 0; i < 100; i++) {
    const recs = await fetch(`${B}/api/recordings`, { headers: { Cookie: cookie } })
      .then((r) => r.json()).catch(() => []);
    final = Array.isArray(recs) ? recs.find((r) => r.id === recId) : null;
    if (final && ["ready", "failed"].includes(final.status)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  check(`recording self-healed to ready (status: ${final?.status})`, final?.status === "ready");
  check(`combined.mp4 present after resume (${(final?.files || []).join(", ")})`,
    (final?.files || []).includes("combined.mp4"));
  check("combined.flac present after resume", (final?.files || []).includes("combined.flac"));
  check("per-person FLAC present after resume", (final?.files || []).some((f) => f.endsWith(".flac") && f !== "combined.flac"));
  check("snapshot cleared after successful resume", !fs.existsSync(snapshotPath));
}

server.kill("SIGKILL");
fs.rmSync(DATA_DIR, { recursive: true, force: true });

console.log(pass ? "\nALL PASS" : "\nSOME CHECKS FAILED");
process.exit(pass ? 0 : 1);
