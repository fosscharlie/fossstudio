// The recording and the stream are supposed to be the same picture the
// people in the session were looking at. That only holds if the browser
// and the compositors lay tiles out the same way, and they cannot share
// code (the browser can't load anything from server/src), so this
// compares the real DOM against tileLayout() rather than trusting that
// two copies of the same maths stayed in step.
//
// It also covers spotlight, which the compositors ignored entirely until
// now: a spotlit session recorded as a plain even grid.
//   node test/geometry-test.mjs <url> <password>
import { chromium } from "playwright";
import { makeRoom } from "./helpers.mjs";
import { tileLayout, LAYOUT } from "../src/composite.js";

const B = process.argv[2] || "http://127.0.0.1:3993";
const PASS = process.argv[3] || "testpass123";

let pass = true;
function check(label, ok, extra = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !extra ? "" : ` (${extra})`}`);
  pass &&= ok;
}

// Every tile as a fraction of the video area, so a 1600px-wide grid and
// a 1280px-wide frame are directly comparable
const measure = (page) => page.evaluate(() => {
  const g = document.getElementById("grid");
  const gr = g.getBoundingClientRect();
  const cs = getComputedStyle(g);
  return {
    gw: gr.width, gh: gr.height,
    pad: parseFloat(cs.paddingLeft),
    gap: parseFloat(cs.gap),
    radius: parseFloat(getComputedStyle(document.querySelector(".tile")).borderRadius),
    tiles: [...g.querySelectorAll(".tile")].map((t) => {
      const r = t.getBoundingClientRect();
      return {
        x: (r.left - gr.left) / gr.width, y: (r.top - gr.top) / gr.height,
        w: r.width / gr.width, h: r.height / gr.height,
        featured: t.classList.contains("featured"),
        peerId: t.dataset.peerId || null
      };
    })
  };
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

const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
});
const pages = [];
try {
  const roomId = await makeRoom(B, PASS, "Geometry Test");
  // A 16:9 grid is the only shape that can match a 16:9 frame exactly;
  // the sidebar is closed for a guest, so this is the clean comparison
  const opts = { permissions: ["camera", "microphone"], viewport: { width: 1280, height: 900 } };

  const hostCtx = await browser.newContext(opts);
  const login = await hostCtx.newPage();
  await login.goto(`${B}/host/login.html`);
  await login.fill("#username", "testhost");
  await login.fill("#password", "testhostpass123");
  await login.click("button[type=submit]");
  await login.waitForURL("**/host/");
  await login.close();

  const host = await join(hostCtx, roomId, "Host", true);
  pages.push(host);
  for (let i = 1; i <= 2; i++) {
    const ctx = await browser.newContext(opts);
    pages.push(await join(ctx, roomId, `Guest ${i}`, false));
  }
  const guest = pages[1];
  await guest.waitForTimeout(2000);
  // A 16:9 video area is the only shape that can match a 16:9 frame
  // exactly. Everything else here is measured against that, so that any
  // failure is a real layout difference and not just the browser window
  // being a different shape from the video.
  for (let i = 0; i < 5; i++) {
    const { gw, gh } = await measure(guest);
    const want = gw * 9 / 16;
    if (Math.abs(gh - want) < 1) break;
    const vp = guest.viewportSize();
    await guest.setViewportSize({ width: vp.width, height: Math.round(vp.height + (want - gh)) });
    await guest.waitForTimeout(250);
  }

  // --- spacing comes from the shared fractions ---
  const m = await measure(guest);
  const gw = m.gw;
  for (const [name, actual, frac] of [
    ["padding", m.pad, LAYOUT.pad],
    ["gap", m.gap, LAYOUT.gap],
    ["corner radius", m.radius, LAYOUT.radius]
  ]) {
    const want = gw * frac;
    check(`${name} matches the frame fraction (${actual.toFixed(1)}px, want ${want.toFixed(1)}px)`,
      Math.abs(actual - want) <= 1.5);
  }

  // --- even grid: every tile lands where the compositor puts it ---
  // The grid is 16:9 here, so the two are directly comparable
  const cmp = (got, want, gwPx, ghPx, label) => {
    const boxes = want.map((b) => ({
      x: b.x / 1280, y: b.y / 720, w: b.w / 1280, h: b.h / 720
    }));
    let worst = 0, which = "";
    got.forEach((t, i) => {
      for (const k of ["x", "y", "w", "h"]) {
        const d = Math.abs(t[k] - boxes[i][k]) * (k === "x" || k === "w" ? gwPx : ghPx);
        if (d > worst) { worst = d; which = `tile ${i} ${k}`; }
      }
    });
    check(`${label}: every tile within 6px of the compositor`, worst <= 6,
      `worst ${worst.toFixed(1)}px at ${which}`);
  };

  const gridM = await measure(guest);
  check("three people, three tiles", gridM.tiles.length === 3, String(gridM.tiles.length));
  cmp(gridM.tiles, tileLayout(3, -1), gridM.gw, gridM.gh, "even grid");

  // --- spotlight ---
  // Spotlight from the host panel, the way a host actually does it
  const spotButtons = await host.$$(".hp-guest .spot");
  check("host panel offers a spotlight button", spotButtons.length > 1);
  await host.$$eval(".hp-guest .spot", (btns) => btns[1].click());
  await guest.waitForTimeout(1500);

  const spotM = await measure(guest);
  const featuredIdx = spotM.tiles.findIndex((t) => t.featured);
  check("guest sees the spotlight", featuredIdx >= 0);
  cmp(spotM.tiles, tileLayout(spotM.tiles.length, featuredIdx), spotM.gw, spotM.gh, "spotlight");

  const featured = spotM.tiles[featuredIdx];
  check("featured tile fills most of the frame", featured.h > 0.6, featured.h.toFixed(2));
  const strip = spotM.tiles.filter((t) => !t.featured);
  check("everyone else shares one strip",
    strip.every((t) => Math.abs(t.y - strip[0].y) < 0.01 && Math.abs(t.h - strip[0].h) < 0.01));
  check("the strip is the shared fraction of the frame height",
    Math.abs(strip[0].h - LAYOUT.strip) < 0.02, strip[0].h.toFixed(3));
} catch (err) {
  check(`test run: ${err.message}`, false);
} finally {
  await browser.close();
}

console.log(pass ? "ALL PASS" : "FAILURES");
process.exit(pass ? 0 : 1);
