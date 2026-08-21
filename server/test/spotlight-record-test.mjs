// Spotlight used to exist on screen only: the compositors ignored it, so
// a spotlit session recorded as a plain even grid. This records a real
// spotlit take and checks the rendered frame is actually a spotlight.
//
// It is also the only cover for the mixed-tile-size ffmpeg graph, where
// the featured tile and the strip tiles need different corner masks.
//   node test/spotlight-record-test.mjs <url> <password>
import { chromium } from "playwright";
import { makeRoom } from "./helpers.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tileLayout } from "../src/composite.js";

const B = process.argv[2] || "http://127.0.0.1:3993";
const PASS = process.argv[3] || "testpass123";
const FFMPEG = "ffmpeg";
const DATA = process.env.DATA_DIR || "../data";
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "fossstudio-spot-test-"));

let pass = true;
function check(label, ok, extra = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !extra ? "" : ` (${extra})`}`);
  pass &&= ok;
}

// Mean colour of a box in the rendered frame
function sample(file, w, h, x, y) {
  const rgb = execFileSync(FFMPEG, ["-loglevel", "error", "-ss", "5", "-i", file,
    "-vf", `crop=${w}:${h}:${x}:${y}`, "-frames:v", "1",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i + 2 < rgb.length; i += 3) { r += rgb[i]; g += rgb[i + 1]; b += rgb[i + 2]; }
  const n = rgb.length / 3;
  return [r / n, g / n, b / n];
}
// The session background is #14161a; anything much brighter is a tile
const isBackground = ([r, g, b]) => r < 45 && g < 45 && b < 45;

const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
});
try {
  const roomId = await makeRoom(B, PASS, "Spotlight Test");
  const opts = { permissions: ["camera", "microphone"], viewport: { width: 1280, height: 820 } };

  const hostCtx = await browser.newContext(opts);
  const login = await hostCtx.newPage();
  await login.goto(`${B}/host/login.html`);
  await login.fill("#username", "testhost");
  await login.fill("#password", "testhostpass123");
  await login.click("button[type=submit]");
  await login.waitForURL("**/host/");

  const join = async (ctx, name, asHost) => {
    const page = await ctx.newPage();
    await page.goto(`${B}/s/${roomId}${asHost ? "?as=host" : ""}`);
    await page.waitForSelector("#joinBtn:not([disabled])", { timeout: 20000 });
    await page.fill("#nameInput", name);
    await page.click("#joinBtn");
    await page.waitForSelector("#session:not([hidden])", { timeout: 25000 });
    return page;
  };

  const host = await join(hostCtx, "Host", true);
  const guest = await join(await browser.newContext(opts), "Guest", false);
  await host.waitForTimeout(2000);

  // Spotlight the guest, then record
  await host.$$eval(".hp-guest .spot", (btns) => btns[1].click());
  await host.waitForTimeout(1500);
  check("session is in spotlight", await guest.$eval("#grid", (el) => el.classList.contains("spotlight")));

  await host.click("#hpRecordBtn");
  await host.waitForTimeout(12000);
  await host.click("#hpRecordBtn");
  await host.waitForTimeout(2000);

  let rec = null;
  for (let i = 0; i < 60; i++) {
    const list = await login.evaluate(() => fetch("/api/recordings").then((r) => r.json()));
    rec = list.find((r) => r.roomId === roomId);
    if (rec && ["ready", "failed"].includes(rec.status)) break;
    await host.waitForTimeout(2000);
  }
  // A broken filter graph shows up here: the render fails outright
  check(`recording processed (status: ${rec?.status})`, rec?.status === "ready");
  if (rec?.status !== "ready") throw new Error("nothing to inspect");

  // Read the render off disk: the test runs on the same machine, and
  // base64-ing a whole video through the page blows the stack
  const file = path.join(DATA, "recordings", rec.id, "out", "combined.mp4");
  check("combined.mp4 rendered", fs.existsSync(file), file);

  // Two people spotlit: the featured tile spans the frame at the top,
  // the other sits in the strip below. In an even grid the two tiles
  // would be side by side with background down the middle, so the
  // centre column is what tells the two layouts apart.
  const boxes = tileLayout(2, 0);
  const featured = boxes[0], strip = boxes[1];
  const mid = sample(file, 30, 30, 625, Math.round(featured.y + featured.h / 2));
  check("centre of the frame is video, not the gap of an even grid",
    !isBackground(mid), `rgb ${mid.map((v) => v.toFixed(0)).join(",")}`);

  const inStrip = sample(file, 30, 20, Math.round(strip.x + strip.w / 2), Math.round(strip.y + strip.h / 2));
  check("the strip below carries the other person",
    !isBackground(inStrip), `rgb ${inStrip.map((v) => v.toFixed(0)).join(",")}`);

  // Between the featured tile and the strip there is a real gap
  const gapY = featured.y + featured.h + 4;
  const between = sample(file, 30, 8, 625, Math.round(gapY));
  check("a gap separates the featured tile from the strip",
    isBackground(between), `rgb ${between.map((v) => v.toFixed(0)).join(",")}`);

  // And the very bottom edge is background, not tile
  const below = sample(file, 30, 8, 625, 715);
  check("padding below the strip", isBackground(below),
    `rgb ${below.map((v) => v.toFixed(0)).join(",")}`);
} catch (err) {
  check(`test run: ${err.message}`, false);
} finally {
  await browser.close();
  fs.rmSync(OUT, { recursive: true, force: true });
}

console.log(pass ? "ALL PASS" : "FAILURES");
process.exit(pass ? 0 : 1);
