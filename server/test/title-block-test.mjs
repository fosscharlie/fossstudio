// The episode logo/title block has to be the same size on screen as it
// is in the recording and the stream. It used to be sized in viewport
// units while the compositors used a fixed fraction of the frame, so
// the two drifted apart by up to 38% on wide screens - and further for
// the host, whose grid is narrower because of the sidebar.
//
// Also covers the host's right-click menu on the block: resize, logo
// position (left by default), and dropping either the logo or the
// title.
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

// The block's controls live in its right-click menu
async function menuClick(page, selector) {
  await page.click("#banner", { button: "right" });
  await page.waitForSelector("#titleMenu:not([hidden])", { timeout: 4000 });
  await page.click(selector);
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

  // --- the right-click menu ---
  await host.click("#banner", { button: "right" });
  const menuShown = await host.waitForSelector("#titleMenu:not([hidden])", { timeout: 4000 })
    .then(() => true, () => false);
  check("right-click opens the block menu for the host", menuShown);
  check("no drag tooltip pill on the block",
    await host.evaluate(() => !document.getElementById("banner").dataset.tip));
  await host.keyboard.press("Escape");
  await guest.click("#banner", { button: "right" }).catch(() => {});
  await guest.waitForTimeout(300);
  check("guests get no menu", await guest.evaluate(() =>
    document.getElementById("titleMenu").hidden));

  const before = (await measure(host)).w;
  await menuClick(host, "#tmBigger");
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

  await menuClick(host, "#tmSmaller");
  check("smaller undoes it", Math.abs((await measure(host)).w - before) < 2);

  // Dropping every part empties the block (the logo too, when the
  // theme carries one from an earlier run against the same data)
  const hasLogo = await host.evaluate(() =>
    !!document.getElementById("bannerLogo").getAttribute("src"));
  if (hasLogo) await menuClick(host, "#tmLogo");
  await menuClick(host, "#tmText");
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

  await menuClick(host, "#tmText");
  if (hasLogo) await menuClick(host, "#tmLogo");
  await host.waitForTimeout(500);
  const restored = await guest.evaluate(() => !document.getElementById("bannerTitle").hidden);
  check("and it comes back", restored);

  // --- logo position: left is the default, changes reach everyone ---
  // A second session whose theme carries a logo
  const logoUp = await host.evaluate(async () => {
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAECAYAAAC3OK7NAAAAFklEQVR4nGP8z8DwnwEPYMKnYDAoAADAgQMBVti6WgAAAABJRU5ErkJggg==";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const r = await fetch("/api/logo", {
      method: "POST", headers: { "Content-Type": "image/png" }, body: bytes
    });
    return r.status;
  });
  check("logo uploaded for the layout checks", logoUp === 200, String(logoUp));
  const roomId2 = await makeRoom(B, PASS, "Layout Test");
  const host2 = await join(hostCtx, roomId2, "Host", true);
  const guest2 = await join(guestCtx, roomId2, "Guest", false);
  await host2.waitForTimeout(1500);

  const layoutOf = (page) => page.evaluate(() =>
    [...document.getElementById("banner").classList].find((c) => c.startsWith("layout-")));
  check("logo sits left of the title by default", await layoutOf(host2) === "layout-left",
    String(await layoutOf(host2)));
  check("guests see the same default", await layoutOf(guest2) === "layout-left");

  await host2.click("#banner", { button: "right" });
  await host2.waitForSelector("#titleMenu:not([hidden])", { timeout: 4000 });
  await host2.click('.tm-layout[data-layout="top"]');
  await host2.waitForTimeout(800);
  check("host moved the logo above the title", await layoutOf(host2) === "layout-top");
  check("guests follow the layout change", await layoutOf(guest2) === "layout-top",
    String(await layoutOf(guest2)));
} catch (err) {
  check(`test run: ${err.message}`, false);
} finally {
  await browser.close();
}

console.log(pass ? "ALL PASS" : "FAILURES");
process.exit(pass ? 0 : 1);
