// The live layer FOSSStudio took over from FOSSCast (its
// docs/live-handover.md): the watch page, the chat beside it, the word
// filter that masks rather than deletes, and blocking by name AND
// address with a reversible list. Also proves the DVR half: an HLS
// playlist stitches into a ready recording, so the saved video is the
// stream the audience watched.
//
// Self-contained: spawns its own throwaway server on a scratch data
// dir, no args, no pre-existing server required.
//   node test/live-watch-test.mjs
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3989;
const B = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fossstudio-live-test-"));

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

async function login(username, password) {
  const r = await fetch(`${B}/api/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!r.ok) throw new Error(`login ${username}: ${r.status}`);
  return r.headers.get("set-cookie").split(";")[0];
}

// A tiny request/response client over the chat socket. Distinct fake
// client addresses ride in via X-Forwarded-For, exactly as they would
// through the reverse proxy, so IP bans are testable from one machine.
function chatClient(roomId, { cookie, ip } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (ip) headers["X-Forwarded-For"] = ip;
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/chat?room=${roomId}`, { headers });
    const events = [];
    const pending = new Map();
    let nextId = 1;
    const c = {
      ws, events,
      closed: new Promise((r) => ws.on("close", (code) => r(code))),
      request(method, data) {
        return new Promise((res, rej) => {
          const id = nextId++;
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, data }));
          setTimeout(() => { if (pending.delete(id)) rej(new Error("no reply")); }, 5000);
        });
      },
      waitEvent(name, timeoutMs = 5000) {
        return new Promise((res, rej) => {
          const existing = events.find((e) => e.event === name);
          if (existing) return res(existing.data);
          const t = setTimeout(() => rej(new Error(`no ${name} event`)), timeoutMs);
          ws.on("message", function h(raw) {
            const m = JSON.parse(raw);
            if (m.event === name) { clearTimeout(t); ws.off("message", h); res(m.data); }
          });
        });
      }
    };
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.id) {
        const p = pending.get(m.id);
        if (p) { pending.delete(m.id); m.ok ? p.res(m.data) : p.rej(new Error(m.error)); }
      } else events.push(m);
    });
    ws.on("open", () => resolve(c));
    ws.on("error", reject);
  });
}

let browser;
try {
  if (!await waitHealthy()) throw new Error("server never became healthy");
  const admin = await login("admin", "testpass123");
  await fetch(`${B}/api/users`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: admin },
    body: JSON.stringify({ username: "testhost", password: "testhostpass123" })
  });
  const host = await login("testhost", "testhostpass123");
  const mk = await fetch(`${B}/api/sessions`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: host },
    body: JSON.stringify({ title: "Live Watch Test" })
  });
  const roomId = (await mk.json()).id;

  // ---------- watch page + status ----------
  check("watch page serves", (await fetch(`${B}/live/${roomId}`)).status === 200);
  check("unknown show 404s", (await fetch(`${B}/live/nosuchroom`)).status === 404);
  const status = await (await fetch(`${B}/api/live/${roomId}`)).json();
  check("status: offline with the show's title",
    status.live === false && status.title === "Live Watch Test", JSON.stringify(status));

  // ---------- chat: join, filter, host powers ----------
  const viewer = await chatClient(roomId, { ip: "203.0.113.5" });
  check("viewer must pick a name first",
    await viewer.request("message", { text: "hi" }).then(() => false, (e) => /name/i.test(e.message)));
  await viewer.request("join", { name: "Heckler" });
  const hostChat = await chatClient(roomId, { cookie: host });
  const hello = await hostChat.waitEvent("hello");
  check("host is recognised as a moderator", hello?.isHost === true, JSON.stringify(hello));
  await hostChat.request("join", { name: "Charlie" });

  await viewer.request("message", { text: "This fucking rules! Greetings from Scunthorpe. Ass." });
  const seen = await hostChat.waitEvent("message");
  check("banned words masked, first and last letter kept",
    seen.text.includes("f*****g"), seen.text);
  check("innocent containing words untouched", seen.text.includes("Scunthorpe"), seen.text);
  check("short banned words fully starred except ends", seen.text.includes("A*s"), seen.text);
  check("rate limit: one message per two seconds",
    await viewer.request("message", { text: "again" }).then(() => false, (e) => /slow/i.test(e.message)));

  // ---------- blocking: name AND address, reversible ----------
  check("viewers cannot block", await viewer.request("block", { name: "Charlie" })
    .then(() => false, (e) => /host/i.test(e.message)));
  await hostChat.request("block", { name: "Heckler" });
  check("blocked viewer's socket closes", await viewer.closed === 4403);
  const wiped = await hostChat.waitEvent("blocked");
  check("everyone told, so their messages vanish", wiped.name === "Heckler");

  // Same name from a DIFFERENT address: refused (the name is banned,
  // so they cannot dodge the block by hopping networks)
  const again = await chatClient(roomId, { ip: "203.0.113.99" });
  check("blocked name cannot rejoin from a new address",
    await again.request("join", { name: "heckler" }).then(() => false, (e) => /blocked/i.test(e.message)));
  again.ws.close();

  // Same address, any name: refused at the door (the IP is banned too)
  const sameIp = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/chat?room=${roomId}`,
      { headers: { "X-Forwarded-For": "203.0.113.5" } });
    ws.on("close", (code) => resolve(code));
    ws.on("error", () => resolve(-1));
  });
  check("blocked address cannot connect at all", sameIp === 4403, String(sameIp));

  // The list is visible and reversible, and never exposes the IP
  const blockedList = await (await fetch(`${B}/api/chat/blocked`, { headers: { Cookie: host } })).json();
  check("block list shows the name", blockedList.length === 1 && blockedList[0].name === "Heckler");
  check("block list never exposes the address", !("ip" in (blockedList[0] || {})));
  check("block list needs a login", (await fetch(`${B}/api/chat/blocked`)).status === 401);
  await fetch(`${B}/api/chat/blocked/${blockedList[0].id}`, { method: "DELETE", headers: { Cookie: host } });
  const back = await chatClient(roomId, { ip: "203.0.113.5" });
  await back.request("join", { name: "Heckler" });
  check("unblock lets them straight back in", true);
  back.ws.close();
  hostChat.ws.close();

  // ---------- DVR: the watched playlist becomes a ready recording ----------
  const liveDir = path.join(DATA_DIR, "live", roomId);
  fs.mkdirSync(liveDir, { recursive: true });
  // Two generations, like a real relaunch when someone joins mid-show
  const genArgs = (src, dur, freq, gen, flags) => ["-loglevel", "error",
    "-f", "lavfi", "-i", `${src}=size=640x360:rate=15:duration=${dur}`,
    "-f", "lavfi", "-i", `sine=frequency=${freq}:duration=${dur}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-g", "30",
    "-f", "hls", "-hls_time", "2", "-hls_list_size", "0",
    "-hls_flags", flags, "-hls_segment_type", "fmp4",
    "-hls_fmp4_init_filename", `init-${gen}.mp4`,
    "-hls_segment_filename", path.join(liveDir, `seg-${gen}-%05d.m4s`),
    "-y", path.join(liveDir, "live.m3u8")];
  execFileSync("ffmpeg", genArgs("testsrc", 4, 440, 1, "omit_endlist"));
  execFileSync("ffmpeg", genArgs("testsrc2", 4, 880, 2, "omit_endlist+append_list+discont_start"));
  // finalizeLive runs inside the server process normally; here it runs
  // in a child with the same DATA_DIR so the whole path is real
  execFileSync("node", ["--input-type=module", "-e", `
    import { finalizeLive } from "${path.join(HERE, "..", "src", "streaming.js").replace(/\\\\/g, "/")}";
    await finalizeLive({
      liveDir: ${JSON.stringify(liveDir)},
      room: { id: ${JSON.stringify(roomId)}, ownerId: "u1", title: "Live Watch Test" },
      startedAt: Date.now() - 6000
    });
  `], { env: { ...process.env, DATA_DIR }, cwd: path.join(HERE, "..") });

  const recs = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "recordings.json"), "utf8"));
  const live = recs.find((r) => r.mode === "live");
  check("stream filed as a ready recording", live?.status === "ready" && live.files.includes("live.mp4"));
  const mp4 = path.join(DATA_DIR, "recordings", live.id, "out", "live.mp4");
  const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries",
    "format=duration", "-of", "default=nk=1:nw=1", mp4]).toString());
  check(`saved video spans both generations (${dur.toFixed(1)}s of 8s)`, dur > 7 && dur < 9);
  const decodeErrs = (() => {
    try {
      execFileSync("ffmpeg", ["-v", "error", "-i", mp4, "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
      return 0;
    } catch (e) { return (e.stderr?.toString() || "x").split("\n").filter(Boolean).length; }
  })();
  check("and decodes cleanly across the relaunch boundary", decodeErrs === 0, `${decodeErrs} decode errors`);
  check("segments cleaned up after stitching", !fs.existsSync(liveDir));

  // ---------- the page itself ----------
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${B}/live/${roomId}`);
  await page.waitForSelector("#offline:not([hidden])", { timeout: 10000 });
  check("page shows the offline state with the show's name",
    (await page.textContent("#offlineTitle")).includes("Live Watch Test"));
  // Off air there is no chat - the page is a waiting room with the
  // game instead (the chat protocol itself is covered above, over ws)
  check("chat panel hidden while off air",
    await page.$eval("#chatPanel", (el) => el.hidden));
  check("the waiting-room game is on screen",
    await page.$eval("#game", (el) => !el.hidden && el.getBoundingClientRect().width > 100));
  check("page has no console errors", errors.length === 0, errors.join("; "));
} catch (err) {
  check(`test run: ${err.message}`, false);
} finally {
  await browser?.close();
  server.kill("SIGKILL");
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(pass ? "ALL PASS" : "FAILURES");
process.exit(pass ? 0 : 1);
