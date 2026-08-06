// Full recording pipeline test: host + guest join, host records ~12s,
// stops, then we wait for processing and sanity-check the output files.
// Usage: node test/recording-test.mjs [url] [password] [mode]
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { makeRoom, setServerRecPermission } from "./helpers.mjs";

const B = process.argv[2] || "http://127.0.0.1:3999";
const PW = process.argv[3] || "testpass123";
const MODE = process.argv[4] || "browser";
await setServerRecPermission(B, PW, MODE === "server");
const ROOM = await makeRoom(B, PW);
const OUT = "/tmp/claude-1000/-home-charlie-GitHub-fossstudio/30aef10b-264b-4404-9752-f5d84c9a6596/scratchpad/rec-out";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
});

let pass = true;
const check = (label, ok) => { console.log(`${ok ? "OK  " : "FAIL"} ${label}`); pass &&= ok; };

// Host logs in, sets the recording mode, joins as host
const hostCtx = await browser.newContext({ permissions: ["camera", "microphone"] });
const dash = await hostCtx.newPage();
await dash.goto(`${B}/host/login.html`);
await dash.fill("#username", "testhost");
await dash.fill("#password", "testhostpass123");
await dash.click("button[type=submit]");
await dash.waitForURL("**/host/");


async function join(ctx, name, asHost) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${name}] pageerror:`, e.message));
  await page.goto(`${B}/s/${ROOM}${asHost ? "?as=host" : ""}`);
  await page.waitForSelector("#joinBtn:not([disabled])");
  await page.fill("#nameInput", name);
  await page.click("#joinBtn");
  await page.waitForSelector("#session:not([hidden])");
  return page;
}

const host = await join(hostCtx, "Charlie Host", true);
const guestCtx = await browser.newContext({ permissions: ["camera", "microphone"] });
const guest = await join(guestCtx, "Guest Greta", false);
await new Promise((r) => setTimeout(r, 2000));

// Turn the shared banner red so its pixels are easy to probe later
await host.click('.hp-swatch[aria-label="Banner colour #f34236"]');
await new Promise((r) => setTimeout(r, 500));

// Start recording (mode picked per session in the host panel)
if (MODE === "server") {
  const visible = await host.$eval("#hpServerRecRow", (el) => !el.hidden);
  console.log(`${visible ? "OK  " : "FAIL"} server-rec toggle visible for permitted host`);
  await host.$eval("#hpServerRec", (el) => el.click());
}
await host.click("#hpRecordBtn");
await new Promise((r) => setTimeout(r, 2500));
check("host sees REC indicator",
  await host.$eval("#banner", (el) => el.classList.contains("recording")));
check("guest sees REC indicator",
  await guest.$eval("#banner", (el) => el.classList.contains("recording")));

// Record for a while, then stop
await new Promise((r) => setTimeout(r, 12000));
await host.click("#hpRecordBtn");
await new Promise((r) => setTimeout(r, 2000));
check("REC indicator cleared on guest",
  await guest.$eval("#banner", (el) => !el.classList.contains("recording")));

// Wait for processing to finish
let rec = null;
for (let i = 0; i < 60; i++) {
  const list = await dash.evaluate(() => fetch("/api/recordings").then((r) => r.json()));
  rec = list.find((r) => r.roomId === ROOM);
  if (rec && ["ready", "failed"].includes(rec.status)) break;
  await new Promise((r) => setTimeout(r, 2000));
}
check(`recording processed (status: ${rec?.status})`, rec?.status === "ready");
const flacs = (rec?.files || []).filter((f) => f.endsWith(".flac"));
check(`two FLACs present (${flacs.join(", ")})`, flacs.length === 2);
check("combined.mkv present", (rec?.files || []).includes("combined.mkv"));
check(`recording named after the episode (${rec?.title})`, rec?.title === "Automated test");

// The host's browser should have uploaded a lower-third PNG per person
if (rec) {
  const banners = fs.readdirSync(`../data/recordings/${rec.id}/raw`)
    .filter((f) => f.startsWith("banner-"));
  check(`banner PNGs uploaded for both peers (${banners.length})`, banners.length === 2);
}

// Download and probe the outputs
if (rec?.status === "ready") {
  for (const f of rec.files) {
    const dl = await dash.evaluate(async ({ id, f }) => {
      const r = await fetch(`/api/recordings/${encodeURIComponent(id)}/files/${encodeURIComponent(f)}`);
      if (!r.ok) return { status: r.status };
      const buf = new Uint8Array(await r.arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { status: r.status, b64: btoa(s) };
    }, { id: rec.id, f });
    check(`download ${f} (${dl.status})`, dl.status === 200);
    if (!dl.b64) continue;
    fs.writeFileSync(`${OUT}/${f}`, Buffer.from(dl.b64, "base64"));
    try {
      const probe = JSON.parse(execFileSync(`${process.env.HOME}/.local/bin/ffprobe`,
        ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", `${OUT}/${f}`]));
      const dur = Number(probe.format.duration || 0);
      const codecs = probe.streams.map((s) => s.codec_name).join("+");
      check(`${f}: ${codecs}, ${dur.toFixed(1)}s`, dur > 8);
    } catch {
      check(`${f}: probe failed`, false);
    }
  }

  // The episode-title chip is baked in top-centre: dark chip pixels
  try {
    const rgb = execFileSync(`${process.env.HOME}/.local/bin/ffmpeg`, [
      "-loglevel", "error", "-ss", "5", "-i", `${OUT}/combined.mkv`,
      "-vf", "crop=40:10:620:40", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"
    ]);
    let r = 0, g = 0, b = 0;
    const n = rgb.length / 3;
    for (let i = 0; i + 2 < rgb.length; i += 3) { r += rgb[i]; g += rgb[i + 1]; b += rgb[i + 2]; }
    r /= n; g /= n; b /= n;
    // The block (chip, text, maybe a logo) covers this area: anything
    // but the raw green video behind it proves it was composited
    check(`episode title baked top-centre (rgb ${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)})`,
      !(g > 100 && r < 60 && b < 60));
  } catch (e) {
    check(`title pixel probe failed: ${e.message}`, false);
  }

  // Lower-thirds are baked in: the bottom-left corner of the first tile
  // should be the red banner we picked, not video content
  try {
    const rgb = execFileSync(`${process.env.HOME}/.local/bin/ffmpeg`, [
      "-loglevel", "error", "-ss", "5", "-i", `${OUT}/combined.mkv`,
      "-vf", "crop=30:8:6:710", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"
    ]);
    let r = 0, g = 0, b = 0;
    for (let i = 0; i + 2 < rgb.length; i += 3) { r += rgb[i]; g += rgb[i + 1]; b += rgb[i + 2]; }
    const n = rgb.length / 3;
    r /= n; g /= n; b /= n;
    check(`banner baked into combined.mkv (rgb ${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)})`,
      r > 140 && r - g > 60 && r - b > 60);
  } catch (e) {
    check(`banner pixel probe failed: ${e.message}`, false);
  }
}

console.log(pass ? "ALL PASS" : "SOME CHECKS FAILED");
await browser.close();
process.exit(pass ? 0 : 1);
