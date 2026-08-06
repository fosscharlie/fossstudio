// Live-stream pipeline test: destination is a local file instead of
// YouTube, everything else identical. Verifies the composite output.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { apiLogin, makeRoom } from "./helpers.mjs";

const B = process.argv[2] || "http://127.0.0.1:3999";
const PW = process.argv[3] || "testpass123";
const ROOM = await makeRoom(B, PW);
const OUT = "/tmp/claude-1000/-home-charlie-GitHub-fossstudio/30aef10b-264b-4404-9752-f5d84c9a6596/scratchpad/live-out";
fs.mkdirSync(OUT, { recursive: true });

// Point the "stream" at a local file (server runs with ALLOW_FILE_STREAM=1)
const cookie = await apiLogin(B, PW);
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

await host.click("#hostPanelBtn");
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
  check("stream has h264 video + aac audio and >8s",
    codecs.includes("video:h264") && codecs.includes("audio:aac") && dur > 8);
  check("composited two tiles side by side (1280 wide)", video?.width === 1280);
} catch (e) {
  check(`probe failed: ${e.message.slice(0, 80)}`, false);
}

console.log(pass ? "ALL PASS" : "SOME CHECKS FAILED");
await browser.close();
process.exit(pass ? 0 : 1);
