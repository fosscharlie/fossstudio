// Theme logo: upload in Settings -> Themes, shows above the episode
// title on the video, removable, and the host can drag the block.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hostLogin, makeRoom } from "./helpers.mjs";

const B = process.argv[2] || "http://127.0.0.1:3999";
const PW = process.argv[3] || "testpass123";
let pass = true;
const check = (label, ok) => { console.log(`${ok ? "OK  " : "FAIL"} ${label}`); pass &&= ok; };

const logoPng = path.join(os.tmpdir(), "fossstudio-testlogo.png");
execFileSync(`${process.env.HOME}/.local/bin/ffmpeg`, ["-y", "-loglevel", "error",
  "-f", "lavfi", "-i", "color=c=0xfbc711:size=360x100", "-frames:v", "1", logoPng]);

const cookie = await hostLogin(B, PW);
const up = await fetch(`${B}/api/logo`, {
  method: "POST", headers: { "Content-Type": "image/png", Cookie: cookie },
  body: fs.readFileSync(logoPng)
});
check(`logo upload accepted (${up.status})`, up.status === 200);

const ROOM = await makeRoom(B, PW, "Logo Test Episode");
const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
});
const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1280, height: 860 } });
const login = await ctx.newPage();
await login.goto(`${B}/host/login.html`);
await login.fill("#username", "testhost");
await login.fill("#password", "testhostpass123");
await login.click("button[type=submit]");
await login.waitForURL("**/host/");
await login.close();

const host = await ctx.newPage();
await host.goto(`${B}/s/${ROOM}?as=host`);
await host.waitForSelector("#joinBtn:not([disabled])");
await host.fill("#nameInput", "Charlie");
await host.click("#joinBtn");
await host.waitForSelector("#session:not([hidden])");
await new Promise((r) => setTimeout(r, 2000));

check("block shows the theme logo above the title",
  await host.$eval("#bannerLogo", (el) => !el.hidden && el.naturalWidth > 0));
check("block shows the episode title",
  (await host.$eval("#bannerTitle", (el) => el.textContent)) === "Logo Test Episode");

// Drag the block towards the bottom-left; position must move
const before = await host.$eval("#banner", (el) => ({ l: el.offsetLeft, t: el.offsetTop }));
const box = await host.$eval("#banner", (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await host.mouse.move(box.x, box.y);
await host.mouse.down();
await host.mouse.move(box.x - 250, box.y + 350, { steps: 10 });
await host.mouse.up();
await new Promise((r) => setTimeout(r, 1000));
const after = await host.$eval("#banner", (el) => ({ l: el.offsetLeft, t: el.offsetTop }));
check(`host dragged the block (${before.l},${before.t}) -> (${after.l},${after.t})`,
  after.l < before.l - 100 && after.t > before.t + 200);
await browser.close();

// Removal: the next join is text-only
await fetch(`${B}/api/logo`, { method: "DELETE", headers: { Cookie: cookie } });
const b2 = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
});
const g = await (await b2.newContext({ permissions: ["camera", "microphone"] })).newPage();
await g.goto(`${B}/s/${ROOM}`);
await g.waitForSelector("#joinBtn:not([disabled])");
await g.fill("#nameInput", "Greta");
await g.click("#joinBtn");
await g.waitForSelector("#session:not([hidden])");
await new Promise((r) => setTimeout(r, 1500));
check("after removal the block is text-only",
  await g.$eval("#bannerLogo", (el) => el.hidden) &&
  (await g.$eval("#bannerTitle", (el) => el.textContent)) === "Logo Test Episode");

console.log(pass ? "ALL PASS" : "SOME CHECKS FAILED");
await b2.close();
process.exit(pass ? 0 : 1);
