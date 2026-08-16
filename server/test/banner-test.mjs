import { chromium } from "playwright";
import { makeRoom } from "./helpers.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const B = process.argv[2] || "http://127.0.0.1:3999";
// Fake cameras are generated here on the fly: this used to point at one
// machine's scratch directory, so the test only ran for whoever made it
const CAMS = fs.mkdtempSync(path.join(os.tmpdir(), "fossstudio-banner-test-"));
for (const cam of ["vcam1.y4m", "vcam2.y4m"]) {
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i",
    "testsrc=size=640x480:rate=15:duration=30", "-pix_fmt", "yuv420p",
    "-y", path.join(CAMS, cam)]);
}
const ROOM = await makeRoom(B, "testpass123");
let pass = true;
const check = (l, ok) => { console.log(`${ok ? "OK  " : "FAIL"} ${l}`); pass &&= ok; };

async function join(cam, name, tagline, asHost) {
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${CAMS}/${cam}`, "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  if (asHost) {
    const login = await ctx.newPage();
    await login.goto(`${B}/host/login.html`);
    await login.fill("#username", "testhost");
    await login.fill("#password", "testhostpass123");
    await login.click("button[type=submit]");
    await login.waitForURL("**/host/");
    await login.close();
  }
  const page = await ctx.newPage();
  await page.goto(`${B}/s/${ROOM}${asHost ? "?as=host" : ""}`);
  await page.waitForSelector("#joinBtn:not([disabled])");
  await page.fill("#nameInput", name);
  if (tagline) await page.fill("#taglineInput", tagline);
  await page.click("#joinBtn");
  await page.waitForSelector("#session:not([hidden])");
  return { browser, page };
}

const host = await join("vcam1.y4m", "Anna", "Host - awesomepodcast.org", true);
const guest = await join("vcam2.y4m", "Dev", "Kernel maintainer", false);
await new Promise((r) => setTimeout(r, 3000));

check("banner overlays the bottom-left of the video, compact width",
  await guest.page.evaluate(() => {
    const t = document.querySelector(".tile:not(.self)");
    const v = t.querySelector("video").getBoundingClientRect();
    const b = t.querySelector(".lower-third").getBoundingClientRect();
    const inside = b.bottom <= v.bottom + 1 && b.top > v.top;
    const compact = b.width >= v.width * 0.2 && b.width <= v.width * 0.9;
    const flushLeft = Math.abs(b.left - v.left) < 2;
    return inside && compact && flushLeft;
  }));

// Host changes banner colour to pink; guest should follow
await host.page.evaluate(() => {
  const inp = document.getElementById("hpBannerHex");
  inp.value = "#e8207e";
  inp.dispatchEvent(new Event("change"));
});
await new Promise((r) => setTimeout(r, 1500));
const guestColor = await guest.page.evaluate(() =>
  getComputedStyle(document.querySelector(".tile .lower-third")).backgroundColor);
check(`guest banner turned pink (${guestColor})`, guestColor === "rgb(232, 32, 126)");

// Multi-colour mode: each person gets their own banner colour
await host.page.click("#hpBannerMulti");
await new Promise((r) => setTimeout(r, 1500));
const colours = await guest.page.evaluate(() =>
  [...document.querySelectorAll(".tile .lower-third")].map((el) => getComputedStyle(el).backgroundColor));
check(`per-person colours differ (${colours.join(" vs ")})`,
  colours.length === 2 && colours[0] !== colours[1]);

// Back to a single colour via a swatch
await host.page.$$eval(".hp-swatch", (btns) => btns[5].click());
await new Promise((r) => setTimeout(r, 1500));
const uniform = await guest.page.evaluate(() =>
  [...document.querySelectorAll(".tile .lower-third")].map((el) => getComputedStyle(el).backgroundColor));
check(`swatch returns everyone to one colour (${uniform[0]})`,
  uniform[0] === uniform[1]);

// Guests pick their own colour
await host.page.click("#hpBannerChoice");
await new Promise((r) => setTimeout(r, 1200));
check("guest sees their own colour button",
  await guest.page.$eval("#myColorBtn", (el) => !el.hidden));
await guest.page.click("#myColorBtn");
await guest.page.$$eval("#myColorPop .hp-swatch", (btns) => btns[3].click());
await new Promise((r) => setTimeout(r, 1200));
const chosen = await host.page.evaluate(() => {
  const t = [...document.querySelectorAll(".tile")].find((x) => !x.classList.contains("self"));
  return getComputedStyle(t.querySelector(".lower-third")).backgroundColor;
});
check(`guest's chosen colour shows for everyone (${chosen})`, chosen === "rgb(155, 38, 174)");
check("layout: grid and panel share the row (no overlap)",
  await host.page.evaluate(() => {
    const g = document.getElementById("grid").getBoundingClientRect();
    const p = document.getElementById("hostPanel").getBoundingClientRect();
    return g.right <= p.left + 1;
  }));

await host.page.screenshot({ path: `${CAMS}/banner-under.png` });
console.log(pass ? "ALL PASS" : "SOME CHECKS FAILED");
await host.browser.close(); await guest.browser.close();
process.exit(pass ? 0 : 1);
