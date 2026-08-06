// Ten guests: does the whole host panel fit without scrolling?
import { chromium } from "playwright";
import { makeRoom } from "./helpers.mjs";
const B = "http://127.0.0.1:3999";
const S = "/tmp/claude-1000/-home-charlie-GitHub-fossstudio/30aef10b-264b-4404-9752-f5d84c9a6596/scratchpad";
const ROOM = await makeRoom(B, "testpass123");
const cams = ["vcam1","vcam2","vcam3","vcam4","vcam5","vcam6","vcam7","cam1","cam2","cam3"];
const names = ["Alexandra Featherstone","Dev","Margot","Ken","Amara","Rob","Priya","Sam","Jules","Nate"];
const sessions = [];
for (let i = 0; i < 10; i++) {
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${S}/${cams[i]}.y4m`, "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1720, height: 920 }, deviceScaleFactor: i === 0 ? 2 : 1 });
  if (i === 0) {
    const login = await ctx.newPage();
    await login.goto(`${B}/host/login.html`);
    await login.fill("#username", "testhost");
    await login.fill("#password", "testhostpass123");
    await login.click("button[type=submit]");
    await login.waitForURL("**/host/");
    await login.close();
  }
  const page = await ctx.newPage();
  await page.goto(`${B}/s/${ROOM}${i === 0 ? "?as=host" : ""}`);
  await page.waitForSelector("#joinBtn:not([disabled])");
  await page.fill("#nameInput", names[i]);
  await page.click("#joinBtn");
  await page.waitForSelector("#session:not([hidden])");
  sessions.push({ browser, page });
  console.log(`${names[i]} in`);
}
await new Promise((r) => setTimeout(r, 5000));
const host = sessions[0].page;
const fit = await host.evaluate(() => {
  const p = document.querySelector(".host-panel");
  return { scrollH: p.scrollHeight, clientH: p.clientHeight, fits: p.scrollHeight <= p.clientHeight + 4, cards: document.querySelectorAll(".hp-guest").length };
});
console.log(`panel: ${fit.cards} cards, scrollHeight ${fit.scrollH} vs visible ${fit.clientH} -> ${fit.fits ? "ALL FITS" : "SCROLLS"}`);
await host.screenshot({ path: `${S}/ten-up.png` });
for (const s of sessions) await s.browser.close();
process.exit(fit.fits && fit.cards === 10 ? 0 : 1);
