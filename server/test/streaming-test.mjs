// Live-stream pipeline test: destination is a local file instead of
// YouTube, everything else identical. Verifies the composite output.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hostLogin, makeRoom } from "./helpers.mjs";

const B = process.argv[2] || "http://127.0.0.1:3999";
const PW = process.argv[3] || "testpass123";
const ROOM = await makeRoom(B, PW);
// Own temp dir: this used to point at one machine's scratch directory
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "fossstudio-live-test-"));
fs.rmSync(`${OUT}/stream.flv`, { force: true }); // a stale file must not pass

// Point the "stream" at a local file (server runs with ALLOW_FILE_STREAM=1).
// Settings are per-host: save them as testhost, the session owner.
const cookie = await hostLogin(B, PW);
await fetch(`${B}/api/settings`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ streamUrl: `file:${OUT}`, streamKey: "stream.flv" })
});

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
});
let pass = true;
const check = (label, ok) => { console.log(`${ok ? "OK  " : "FAIL"} ${label}`); pass &&= ok; };

const hostCtx = await browser.newContext({ permissions: ["camera", "microphone"] });
const login = await hostCtx.newPage();
await login.goto(`${B}/host/login.html`);
await login.fill("#username", "testhost");
await login.fill("#password", "testhostpass123");
await login.click("button[type=submit]");
await login.waitForURL("**/host/");
await login.close();

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

const host = await join(hostCtx, "Host", true);
const guestCtx = await browser.newContext({ permissions: ["camera", "microphone"] });
const guest = await join(guestCtx, "Guest", false);
await new Promise((r) => setTimeout(r, 2000));

await host.click("#hpStreamBtn");
await new Promise((r) => setTimeout(r, 3000));
check("host sees LIVE indicator",
  await host.$eval("#banner", (el) => el.classList.contains("live")));
check("guest sees LIVE indicator",
  await guest.$eval("#banner", (el) => el.classList.contains("live")));

await new Promise((r) => setTimeout(r, 15000));
await host.click("#hpStreamBtn");
await new Promise((r) => setTimeout(r, 3000));
check("LIVE indicator cleared",
  await guest.$eval("#banner", (el) => !el.classList.contains("live")));

const outFile = `${OUT}/stream.flv`;
check("stream file exists", fs.existsSync(outFile));
try {
  const probe = JSON.parse(execFileSync(`${process.env.HOME}/.local/bin/ffprobe`,
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", outFile]));
  // A live FLV never gets its duration patched in; use the last packet time
  const lastPts = execFileSync(`${process.env.HOME}/.local/bin/ffprobe`,
    ["-v", "quiet", "-select_streams", "v", "-show_entries", "packet=pts_time",
     "-of", "csv=p=0", outFile]).toString().trim().split("\n").pop();
  const dur = Number(lastPts || 0);
  const codecs = probe.streams.map((s) => `${s.codec_type}:${s.codec_name}`).join(" ");
  const video = probe.streams.find((s) => s.codec_type === "video");
  console.log(`     stream: ${codecs}, ${dur.toFixed(1)}s, ${video?.width}x${video?.height}`);
  // ~15s of wall time; loaded test machines drop frames, so accept
  // anything comfortably past the 1-2s a genuinely stalled graph makes
  check("stream has h264 video + aac audio and >5s",
    codecs.includes("video:h264") && codecs.includes("audio:aac") && dur > 5);
  check("composited two tiles side by side (1280 wide)", video?.width === 1280);

  // Lower-third banners are composited bottom-left of each tile, in
  // the default dark banner colour (banners no longer follow accents)
  const rgb = execFileSync(`${process.env.HOME}/.local/bin/ffmpeg`, [
    "-loglevel", "quiet", "-err_detect", "ignore_err", "-i", outFile,
    "-vf", "crop=30:8:6:710", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"
  ]);
  const n = Math.floor(rgb.length / 3);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i + 2 < 3 * n; i += 3) { r += rgb[i]; g += rgb[i + 1]; b += rgb[i + 2]; }
  r /= n; g /= n; b /= n;
  check(`lower-third banner on the stream (rgb ${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)})`,
    r < 70 && g < 70 && b < 70);

  // Episode-title chip top-centre: dark pixels against the bright feed
  const trgb = execFileSync(`${process.env.HOME}/.local/bin/ffmpeg`, [
    "-loglevel", "quiet", "-err_detect", "ignore_err", "-i", outFile,
    "-vf", "crop=40:10:620:40", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"
  ]);
  const tn = Math.floor(trgb.length / 3);
  let tr = 0, tg = 0, tb = 0;
  for (let i = 0; i + 2 < 3 * tn; i += 3) { tr += trgb[i]; tg += trgb[i + 1]; tb += trgb[i + 2]; }
  tr /= tn; tg /= tn; tb /= tn;
  // The block (chip, text, maybe a logo) covers this area: anything
  // but the raw green video behind it proves it was composited
  check(`episode title on the stream (rgb ${tr.toFixed(0)},${tg.toFixed(0)},${tb.toFixed(0)})`,
    !(tg > 100 && tr < 60 && tb < 60));
} catch (e) {
  check(`probe failed: ${e.message.slice(0, 80)}`, false);
}

console.log(pass ? "ALL PASS" : "SOME CHECKS FAILED");
await browser.close();
process.exit(pass ? 0 : 1);
