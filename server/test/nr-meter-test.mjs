import { chromium } from "playwright";
import { makeRoom } from "./helpers.mjs";
const B = "http://127.0.0.1:3999";
const ROOM = await makeRoom(B, "testpass123");
const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
let pass = true;
const check = (l, ok) => { console.log(`${ok ? "OK  " : "FAIL"} ${l}`); pass &&= ok; };

async function join(name, asHost, noise) {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
  if (asHost) {
    const login = await ctx.newPage();
    await login.goto(`${B}/host/login.html`);
    await login.fill("#username", "testhost");
    await login.fill("#password", "testhostpass123");
    await login.click("button[type=submit]");
    await login.waitForURL("**/host/");
    await login.close();
  }
  const page = await ctx.newPage();
  await page.goto(`${B}/s/${ROOM}${asHost ? "?as=host" : ""}`);
  await page.waitForSelector("#joinBtn:not([disabled])");
  await page.fill("#nameInput", name);
  await page.click("#joinBtn");
  await page.waitForSelector("#session:not([hidden])");
  return page;
}

const host = await join("Host", true, true);
const guest = await join("Greta", false, true);
await new Promise((r) => setTimeout(r, 3000));

check("guest joined with NR applied",
  await guest.evaluate(() => window.__noiseApplied === true));
check("host sees guest's NR button active",
  await host.$$eval(".hp-guest .nr", (btns) => btns[1].classList.contains("active")));

// Host turns Greta's NR off
await host.$$eval(".hp-guest .nr", (btns) => btns[1].click());
await new Promise((r) => setTimeout(r, 1500));
check("guest's noise processing switched off remotely",
  await guest.evaluate(() => window.__noiseApplied === false));
check("host's NR button now shows off",
  await host.$$eval(".hp-guest .nr", (btns) => !btns[1].classList.contains("active")));

// And back on
await host.$$eval(".hp-guest .nr", (btns) => btns[1].click());
await new Promise((r) => setTimeout(r, 1500));
check("guest's noise processing switched back on",
  await guest.evaluate(() => window.__noiseApplied === true));

// Meters: fake mics emit a tone, so at least one meter should move
await new Promise((r) => setTimeout(r, 1500));
const meterMoves = await host.evaluate(() =>
  [...document.querySelectorAll(".hp-meter-fill")].some((el) => parseFloat(el.style.width) > 2));
check("sound meters register audio", meterMoves);

console.log(pass ? "ALL PASS" : "SOME CHECKS FAILED");
await browser.close();
process.exit(pass ? 0 : 1);
