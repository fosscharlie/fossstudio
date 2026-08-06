import { chromium } from "playwright";
const B = "http://127.0.0.1:3999";
const ROOM = `dbg-${Date.now().toString(36)}`;
const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
});
async function join(name) {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log(`[${name}]`, m.type(), m.text().slice(0, 200)); });
  page.on("pageerror", (e) => console.log(`[${name}] pageerror:`, e.message));
  await page.goto(`${B}/s/${ROOM}`);
  await page.waitForSelector("#joinBtn:not([disabled])");
  await page.fill("#nameInput", name);
  await page.click("#joinBtn");
  await page.waitForSelector("#session:not([hidden])");
  return page;
}
const a = await join("Alpha");
const b = await join("Beta");
await new Promise((r) => setTimeout(r, 4000));
const report = await b.evaluate(() => {
  const out = [];
  for (const t of document.querySelectorAll(".tile")) {
    const v = t.querySelector("video");
    out.push({
      name: t.querySelector(".name").textContent,
      tracks: v.srcObject.getTracks().map((tr) => `${tr.kind}:${tr.readyState}:muted=${tr.muted}`),
      paused: v.paused, ready: v.readyState, w: v.videoWidth,
      err: v.error?.message || null
    });
  }
  return out;
});
console.log(JSON.stringify(report, null, 1));
await browser.close();
