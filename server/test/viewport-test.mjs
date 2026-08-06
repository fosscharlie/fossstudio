// Join a room at phone/tablet sizes and screenshot both stages.
import { chromium } from "playwright";
import { makeRoom } from "./helpers.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:3999";
const PW = process.argv[3] || "testpass123";
const ROOM = await makeRoom(BASE, PW);
const OUT = "/tmp/claude-1000/-home-charlie-GitHub-fossstudio/30aef10b-264b-4404-9752-f5d84c9a6596/scratchpad";

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
});

async function join(name, viewport) {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/s/${ROOM}`);
  await page.waitForSelector("#joinBtn:not([disabled])", { timeout: 10000 });
  await page.fill("#nameInput", name);
  await page.click("#joinBtn");
  await page.waitForSelector("#session:not([hidden])", { timeout: 15000 });
  return page;
}

const desktop = await join("Desktop Dan", { width: 1280, height: 800 });
const phonePage = await (async () => {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/s/${ROOM}`);
  await page.waitForSelector("#joinBtn:not([disabled])", { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/preview-phone.png` });
  await page.fill("#nameInput", "Phone Pat");
  await page.click("#joinBtn");
  await page.waitForSelector("#session:not([hidden])", { timeout: 15000 });
  return page;
})();
const tablet = await join("Tablet Tam", { width: 768, height: 1024 });

await new Promise((r) => setTimeout(r, 4000));
await phonePage.screenshot({ path: `${OUT}/session-phone.png` });
await tablet.screenshot({ path: `${OUT}/session-tablet.png` });
await desktop.screenshot({ path: `${OUT}/session-desktop.png` });
console.log("screenshots saved");
await browser.close();
