// The episode logo/title block has to be the same size on screen as it
// is in the recording and the stream. It used to be sized in viewport
// units while the compositors used a fixed fraction of the frame, so
// the two drifted apart by up to 38% on wide screens - and further for
// the host, whose grid is narrower because of the sidebar.
//
// Also covers the host's block tools: resize, and dropping either the
// logo or the title.
//   node test/title-block-test.mjs <url> <password>
import { chromium } from "playwright";
import { makeRoom } from "./helpers.mjs";
import { titleWidth, TITLE_WIDTH_FRACTION } from "../src/composite.js";

const B = process.argv[2] || "http://127.0.0.1:3993";
const PASS = process.argv[3] || "testpass123";

let pass = true;
function check(label, ok, extra = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !extra ? "" : ` (${extra})`}`);
  pass &&= ok;
}

// Block width as a fraction of the video area it sits in
const measure = (page) => page.evaluate(() => {
  const b = document.getElementById("banner");
  const g = document.getElementById("grid");
  return { w: b.getBoundingClientRect().width, grid: g.clientWidth };
});

async function join(ctx, roomId, name, asHost) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message));
  await page.goto(`${B}/s/${roomId}${asHost ? "?as=host" : ""}`);
  await page.waitForSelector("#joinBtn:not([disabled])", { timeout: 20000 });
  await page.fill("#nameInput", name);
  await page.click("#joinBtn");
  await page.waitForSelector("#session:not([hidden])", { timeout: 25000 });
  return page;
}

// The tools only exist while the block is hovered, like any hover control
async function tool(page, id) {
  await page.hover("#banner");
  await page.click(id);
  await page.waitForTimeout(400);
}

const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
});
try {
  const roomId = await makeRoom(B, PASS, "Title Block Test");
  const opts = {
    permissions: ["camera", "microphone"], viewport: { width: 1600, height: 900 }
  };
  // The host role needs the host cookie in that browser context
  const hostCtx = await browser.newContext(opts);
  const login = await hostCtx.newPage();
  await login.goto(`${B}/host/login.html`);
  await login.fill("#username", "testhost");
  await login.fill("#password", "testhostpass123");
  await login.click("button[type=submit]");
  await login.waitForURL("**/host/");
  await login.close();

  const guestCtx = await browser.newContext(opts);
  const host = await join(hostCtx, roomId, "Host", true);
  const guest = await join(guestCtx, roomId, "Guest", false);
  await host.waitForTimeout(1500);

  // The compositors' share of the frame is what the DOM must match
  const target = TITLE_WIDTH_FRACTION;

  for (const [who, page] of [["host", host], ["guest", guest]]) {
    const m = await measure(page);
    const frac = m.w / m.grid;
    const driftPct = Math.abs(frac - target) / target * 100;
    check(`${who}: block is ${(frac * 100).toFixed(1)}% of the video area (video uses ${(target * 100).toFixed(1)}%)`,
      driftPct < 2, `${driftPct.toFixed(1)}% off`);
  }

  // Same fraction whatever the window size: the old viewport-unit sizing
  // is exactly what this catches
  for (const width of [900, 1280, 1920]) {
    await guest.setViewportSize({ width, height: 900 });
    await guest.waitForTimeout(300);
    const m = await measure(guest);
    const frac = m.w / m.grid;
    const driftPct = Math.abs(frac - target) / target * 100;
    check(`guest at ${width}px: ${(frac * 100).toFixed(1)}% of the video area`,
      driftPct < 2, `${driftPct.toFixed(1)}% off`);
  }
  await guest.setViewportSize({ width: 1600, height: 900 });

  // --- host tools ---
  const toolsVisible = await host.evaluate(() => !document.getElementById("titleTools").hidden);
  check("host gets the block tools", toolsVisible);
  const guestNoTools = await guest.evaluate(() => document.getElementById("titleTools").hidden);
  check("guests do not", guestNoTools);

  const before = (await measure(host)).w;
  await tool(host, "#titleBigger");
  const bigger = (await measure(host)).w;
  check("bigger makes it bigger", bigger > before * 1.05, `${before.toFixed(0)} -> ${bigger.toFixed(0)}`);

  // and everyone else sees the new size, at the same fraction
  await guest.waitForTimeout(800);
  const gm = await measure(guest);
  const hm = await measure(host);
  check("guests see the resize too",
    Math.abs(gm.w / gm.grid - hm.w / hm.grid) / (hm.w / hm.grid) < 0.02,
    `guest ${(gm.w / gm.grid * 100).toFixed(1)}% vs host ${(hm.w / hm.grid * 100).toFixed(1)}%`);

  // the compositor scales the same way
  check("compositor matches the new scale",
    titleWidth(1.1) === Math.round(1280 * TITLE_WIDTH_FRACTION * 1.1 / 2) * 2,
    String(titleWidth(1.1)));

  await tool(host, "#titleSmaller");
  check("smaller undoes it", Math.abs((await measure(host)).w - before) < 2);

  // Dropping the title: this session has no logo, so the block empties
  await tool(host, "#titleTextBtn");
  await host.waitForTimeout(500);
  const hidden = await guest.evaluate(() =>
    getComputedStyle(document.getElementById("bannerTitle")).display === "none" ||
    document.getElementById("bannerTitle").hidden);
  check("dropping the title hides it for everyone", hidden);
  const guestBlockGone = await guest.evaluate(() =>
    getComputedStyle(document.getElementById("banner")).display === "none");
  check("and the empty block does not sit there on guests' screens", guestBlockGone);
  const hostKeepsHandle = await host.evaluate(() =>
    getComputedStyle(document.getElementById("banner")).display !== "none");
  check("but the host keeps a handle to bring it back", hostKeepsHandle);

  await tool(host, "#titleTextBtn");
  await host.waitForTimeout(500);
  const restored = await guest.evaluate(() => !document.getElementById("bannerTitle").hidden);
  check("and it comes back", restored);
} catch (err) {
  check(`test run: ${err.message}`, false);
} finally {
  await browser.close();
}

console.log(pass ? "ALL PASS" : "FAILURES");
process.exit(pass ? 0 : 1);
