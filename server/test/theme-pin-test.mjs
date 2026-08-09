// Theme pinning: settings changed mid-session must not show to
// rejoiners until the room has fully emptied.
import { chromium } from "playwright";
import { hostLogin, makeRoom } from "./helpers.mjs";

const B = process.argv[2] || "http://127.0.0.1:3999";
const PW = process.argv[3] || "testpass123";

const cookie = await hostLogin(B, PW);
const setBg = (bg) => fetch(`${B}/api/settings`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ bg })
});

await setBg("#123456");
const roomId = await makeRoom(B, PW, "Theme pin test");

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required"]
});
async function joinGuest(name) {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
  const page = await ctx.newPage();
  await page.goto(`${B}/s/${roomId}`);
  await page.waitForSelector("#joinBtn:not([disabled])");
  await page.fill("#nameInput", name);
  await page.click("#joinBtn");
  await page.waitForSelector("#session:not([hidden])");
  return { ctx, page };
}
const bgOf = (p) => p.page.evaluate(() =>
  getComputedStyle(document.getElementById("grid")).backgroundColor);

const a = await joinGuest("Anna");
const before = await bgOf(a);

// Host changes the background colour while Anna is in the session
await setBg("#654321");

// Ben joins mid-session: must see the pinned colour, not the new one
const b = await joinGuest("Ben");
const benSees = await bgOf(b);

// Everyone leaves; the room dies; a new gathering gets the new colour
await a.ctx.close();
await b.ctx.close();
await new Promise((r) => setTimeout(r, 1500));
const c = await joinGuest("Cara");
const afterRestart = await bgOf(c);
await browser.close();

let fails = 0;
const expect = (label, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) fails++; };
expect(`first guest got the original colour (${before})`, before === "rgb(18, 52, 86)");
expect(`mid-session joiner still sees the pinned colour (${benSees})`, benSees === "rgb(18, 52, 86)");
expect(`new session after everyone left gets the new colour (${afterRestart})`, afterRestart === "rgb(101, 67, 33)");
process.exit(fails ? 1 : 0);
