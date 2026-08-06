// End-to-end call test: N fake-camera browsers join the same room and
// each must end up seeing video flowing from every other participant.
// Usage: node test/call-test.mjs [url] [guests]
import { chromium } from "playwright";
import { makeRoom } from "./helpers.mjs";

const BASE = process.argv[2] || "https://fossstudio.fosscharlie.uk";
const GUESTS = Number(process.argv[3] || 3);
const PW = process.argv[4] || "testpass123";
const ROOM = await makeRoom(BASE, PW);

const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required"
  ]
});

async function joinAsGuest(name) {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${name}] pageerror:`, e.message));
  await page.goto(`${BASE}/s/${ROOM}`);
  await page.waitForSelector("#joinBtn:not([disabled])", { timeout: 10000 });
  await page.fill("#nameInput", name);
  await page.click("#joinBtn");
  await page.waitForSelector("#session:not([hidden])", { timeout: 15000 });
  return page;
}

function tileStats(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".tile")].map((t) => {
      const v = t.querySelector("video");
      return {
        name: t.querySelector(".name").textContent,
        tracks: v.srcObject ? v.srcObject.getTracks().length : 0,
        playing: v.readyState >= 2 && !v.paused,
        width: v.videoWidth
      };
    })
  );
}

try {
  const pages = [];
  for (let i = 1; i <= GUESTS; i++) {
    pages.push(await joinAsGuest(`Guest ${i}`));
    console.log(`Guest ${i} joined`);
  }

  // Give video a moment to start flowing everywhere
  await new Promise((r) => setTimeout(r, 5000));

  let allGood = true;
  for (let i = 0; i < pages.length; i++) {
    const stats = await tileStats(pages[i]);
    const ok =
      stats.length === GUESTS &&
      stats.every((s) => s.playing && s.width > 0);
    allGood &&= ok;
    console.log(
      `Guest ${i + 1} sees: ${stats
        .map((s) => `${s.name}(${s.tracks}t,${s.playing ? "▶" : "×"},${s.width}px)`)
        .join(" ")} ${ok ? "OK" : "FAIL"}`
    );
  }

  // One guest leaves; the others should see the tile disappear
  await pages[0].click("#leaveBtn");
  await new Promise((r) => setTimeout(r, 2000));
  const after = await tileStats(pages[1]);
  const leaveOk = after.length === GUESTS - 1;
  console.log(`After Guest 1 left, Guest 2 sees ${after.length} tiles ${leaveOk ? "OK" : "FAIL"}`);

  console.log(allGood && leaveOk ? "ALL PASS" : "SOME CHECKS FAILED");
  process.exit(allGood && leaveOk ? 0 : 1);
} finally {
  await browser.close();
}
