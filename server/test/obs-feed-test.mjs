// OBS clean-feed (?output=1) smoke test: a guest joins normally, a
// viewer opens the clean feed. Checks the viewer sees the guest's tile
// with no controls, and the guest never sees the viewer.
import { chromium } from "playwright";
import { makeRoom } from "./helpers.mjs";

const B = process.argv[2] || "http://127.0.0.1:3999";
const PW = process.argv[3] || "testpass123";

const roomId = await makeRoom(B, PW, "OBS feed test");

// Guest with a fake camera
const guestBrowser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required"]
});
const gctx = await guestBrowser.newContext({ permissions: ["camera", "microphone"] });
const guest = await gctx.newPage();
await guest.goto(`${B}/s/${roomId}`);
await guest.waitForSelector("#joinBtn:not([disabled])");
await guest.fill("#nameInput", "Alice");
await guest.click("#joinBtn");
await guest.waitForSelector("#session:not([hidden])");

// The clean feed - plain browser, no camera at all
const feedBrowser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"]
});
const feed = await feedBrowser.newPage();
await feed.goto(`${B}/s/${roomId}?output=1`);
await feed.waitForSelector("#session:not([hidden])", { timeout: 10000 });
await feed.waitForSelector('.tile[data-peer-id]', { timeout: 10000 });
await feed.waitForTimeout(2000);

const checks = await feed.evaluate(() => ({
  tiles: document.querySelectorAll(".tile").length,
  name: document.querySelector(".tile .name")?.textContent,
  controlsHidden: getComputedStyle(document.querySelector(".controls")).display === "none",
  previewHidden: document.getElementById("preview").hidden,
  videoPlaying: [...document.querySelectorAll(".tile video")]
    .some((v) => v.readyState >= 2 && !v.paused)
}));
const guestChecks = await guest.evaluate(() => ({
  tiles: document.querySelectorAll(".tile").length
}));

await feed.screenshot({ path: process.env.SHOT || "/tmp/obs-feed.png" });
await feedBrowser.close();
await guestBrowser.close();

let fails = 0;
function expect(label, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) fails++;
}
expect("feed shows exactly the guest's tile", checks.tiles === 1);
expect("tile carries the guest's banner name", checks.name === "Alice");
expect("controls bar hidden on the feed", checks.controlsHidden);
expect("join screen never shown on the feed", checks.previewHidden);
expect("remote video playing on the feed", checks.videoPlaying);
expect("guest sees only their own tile (viewer invisible)", guestChecks.tiles === 1);
process.exit(fails ? 1 : 0);
