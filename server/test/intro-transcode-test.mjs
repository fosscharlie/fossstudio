// Intro videos are bounded at upload: oversized or heavy-codec uploads
// convert to 720p H.264 MP4, already-cheap ones keep their original
// video untouched. Exists because a fullscreen 1080p intro decoding on
// top of WebRTC froze a real host's machine mid-show. Also covers the
// boot migration that converts intros uploaded before the bound.
//
// Self-contained: spawns its own throwaway server on a scratch data
// dir, no args, no pre-existing server required.
//   node test/intro-transcode-test.mjs
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3981;
const B = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fossstudio-intro-test-"));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fossstudio-intro-src-"));

let pass = true;
function check(label, ok, extra = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !extra ? "" : ` (${extra})`}`);
  pass &&= ok;
}

function probe(file) {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json",
    "-show_format", "-show_streams", file]).toString());
  const v = (j.streams || []).find((s) => s.codec_type === "video");
  return { codec: v?.codec_name, height: v?.height, dur: parseFloat(j.format?.duration || 0) };
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

try {
  // Two source files: a 1080p VP8 WebM (must convert) and a 480p H.264
  // MP4 (must pass through untouched apart from audio levelling)
  execFileSync("ffmpeg", ["-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30:duration=3",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
    "-c:v", "libvpx", "-b:v", "2M", "-c:a", "libvorbis",
    "-y", path.join(TMP, "big.webm")]);
  execFileSync("ffmpeg", ["-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=size=854x480:rate=30:duration=3",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
    "-y", path.join(TMP, "small.mp4")]);

  if (!await waitHealthy()) throw new Error("server never became healthy");
  const admin = await login("admin", "testpass123");
  await fetch(`${B}/api/users`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: admin },
    body: JSON.stringify({ username: "testhost", password: "testhostpass123" })
  });
  const host = await login("testhost", "testhostpass123");
  const uid = (await (await fetch(`${B}/api/me`, { headers: { Cookie: host } })).json()).uid;

  const upload = async (file, type, name) => {
    const r = await fetch(`${B}/api/intros?name=${encodeURIComponent(name)}`, {
      method: "POST", headers: { "Content-Type": type, Cookie: host },
      body: fs.readFileSync(file)
    });
    if (!r.ok) throw new Error(`upload ${name}: ${r.status} ${await r.text()}`);
    return r.json();
  };

  // ---------- oversized upload converts ----------
  const big = await upload(path.join(TMP, "big.webm"), "video/webm", "Big Intro");
  check("oversized upload stored as mp4", big.ext === "mp4", big.ext);
  const bigFile = path.join(DATA_DIR, "uploads", `intro-${uid}-${big.id}.mp4`);
  const bigProbe = probe(bigFile);
  check("converted to H.264", bigProbe.codec === "h264", bigProbe.codec);
  check(`capped at 720p (${bigProbe.height})`, bigProbe.height === 720);
  check("length survives conversion", Math.abs(bigProbe.dur - 3) < 0.5, String(bigProbe.dur));
  check("duration recorded for the mute window", Math.abs(big.durationMs - 3000) < 500, String(big.durationMs));

  // ---------- already-cheap upload passes through ----------
  const small = await upload(path.join(TMP, "small.mp4"), "video/mp4", "Small Intro");
  check("small upload keeps mp4", small.ext === "mp4", small.ext);
  const smallProbe = probe(path.join(DATA_DIR, "uploads", `intro-${uid}-${small.id}.mp4`));
  check("small upload keeps its resolution (no re-encode)", smallProbe.height === 480, String(smallProbe.height));

  // ---------- boot migration converts pre-existing oversized intros ----------
  // Fake an intro uploaded before the bound: an oversized file with an
  // old-style record, then run the migration the way boot does
  const oldSrc = path.join(TMP, "big.webm");
  const oldId = "aabbccdd";
  fs.copyFileSync(oldSrc, path.join(DATA_DIR, "uploads", `intro-${uid}-${oldId}.webm`));
  const users = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "users.json"), "utf8"));
  const u = users.find((x) => x.id === uid);
  u.settings = u.settings || {};
  u.settings.intros = [...(u.settings.intros || []),
    { id: oldId, name: "Legacy Intro", ext: "webm", durationMs: 3000, hasAudio: true }];
  fs.writeFileSync(path.join(DATA_DIR, "users.json"), JSON.stringify(users, null, 2));

  execFileSync("node", ["--input-type=module", "-e", `
    import { migrateIntros } from "${path.join(HERE, "..", "src", "introcoder.js").replace(/\\\\/g, "/")}";
    const n = await migrateIntros();
    console.log("converted:", n);
  `], { env: { ...process.env, DATA_DIR, SESSION_SECRET: "x", HOST_PASSWORD: "x", TURN_SECRET: "x" }, cwd: path.join(HERE, "..") });

  const migrated = probe(path.join(DATA_DIR, "uploads", `intro-${uid}-${oldId}.mp4`));
  check("legacy intro converted by the migration",
    migrated.codec === "h264" && migrated.height === 720, `${migrated.codec} ${migrated.height}`);
  check("legacy original removed",
    !fs.existsSync(path.join(DATA_DIR, "uploads", `intro-${uid}-${oldId}.webm`)));
  const after = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "users.json"), "utf8"))
    .find((x) => x.id === uid).settings.intros.find((c) => c.id === oldId);
  check("legacy record points at the new file", after.ext === "mp4", after.ext);
  // The already-converted ones are left alone (idempotent)
  const before = fs.statSync(bigFile).mtimeMs;
  execFileSync("node", ["--input-type=module", "-e", `
    import { migrateIntros } from "${path.join(HERE, "..", "src", "introcoder.js").replace(/\\\\/g, "/")}";
    await migrateIntros();
  `], { env: { ...process.env, DATA_DIR, SESSION_SECRET: "x", HOST_PASSWORD: "x", TURN_SECRET: "x" }, cwd: path.join(HERE, "..") });
  check("migration is idempotent", fs.statSync(bigFile).mtimeMs === before);
} catch (err) {
  check(`test run: ${err.message}`, false);
} finally {
  server.kill("SIGKILL");
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(pass ? "ALL PASS" : "FAILURES");
process.exit(pass ? 0 : 1);
