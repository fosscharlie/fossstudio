import { chromium } from "playwright";
import { makeRoom } from "./helpers.mjs";
const B = process.argv[2] || "http://127.0.0.1:3999";
const ROOM = await makeRoom(B, process.argv[3] || "testpass123");
const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
await page.goto(`${B}/s/${ROOM}`);
await page.waitForSelector("#joinBtn:not([disabled])");
await page.evaluate(() => {
  for (const sel of ["camSelect", "micSelect", "spkSelect"]) {
    const s = document.getElementById(sel);
    for (const o of s.options) o.textContent = "Very Long Device Name Logitech BRIO 4K Stream Edition Ultra (046d:085e) #2";
  }
});
let bad = 0;
for (let w = 320; w <= 1400; w += 20) {
  await page.setViewportSize({ width: w, height: 1000 });
  await page.waitForTimeout(60);
  const r = await page.evaluate(() => {
    const card = document.querySelector(".preview-card").getBoundingClientRect();
    let worst = 0, who = "";
    for (const el of document.querySelectorAll(".preview-card, .preview-card *")) {
      if (el.tagName === "OPTION") continue;
      const bb = el.getBoundingClientRect();
      if (bb.width === 0 && bb.height === 0) continue;
      const b = el.getBoundingClientRect();
      const over = Math.max(b.right - card.right, card.left - b.left, b.right - window.innerWidth);
      if (over > worst + 0.5) { worst = over; who = el.id || el.className?.toString().slice(0, 30) || el.tagName; }
    }
    const doc = document.documentElement;
    const hscroll = doc.scrollWidth - doc.clientWidth;
    return { worst: worst.toFixed(1), who, hscroll };
  });
  if (Number(r.worst) > 1 || r.hscroll > 0) {
    console.log(`w=${w}: overflow ${r.worst}px (${r.who}) hscroll=${r.hscroll}`);
    bad++;
  }
}
console.log(bad === 0 ? "NO OVERFLOW AT ANY WIDTH" : `${bad} widths overflow`);
await browser.close();
