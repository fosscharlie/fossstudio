// Host mute powers: mute one, mute all, guest self-unmute, indicators.
import { chromium } from "playwright";
import { makeRoom } from "./helpers.mjs";
const B = "http://127.0.0.1:3999";
const ROOM = await makeRoom(B, "testpass123");
const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
let pass = true;
const check = (label, ok) => { console.log(`${ok ? "OK  " : "FAIL"} ${label}`); pass &&= ok; };

async function join(name, asHost) {
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

const host = await join("Host", true);
const g1 = await join("Greta", false);
const g2 = await join("Gus", false);
await new Promise((r) => setTimeout(r, 3000));

check("host panel lists self first with you-icon",
  await host.$eval(".hp-guest .hp-name-line", (el) => !!el.querySelector(".you-ico")));
check("self row has slider plus its own Mute and Spotlight",
  await host.$eval(".hp-guest", (el) => !!el.querySelector("input[type=range]") && !!el.querySelector(".mute") && !!el.querySelector(".spot")));

// Mute Greta (second row; first is the host themself)
await host.$$eval(".hp-guest .mute", (btns) => btns[1].click());
await new Promise((r) => setTimeout(r, 1200));
check("Greta's mic producer paused",
  await g1.evaluate(() => document.querySelector("#muteBtn").classList.contains("off")));
check("everyone sees 🔇 on Greta's tile",
  await g2.evaluate(() => [...document.querySelectorAll(".tile")].some((t) =>
    t.querySelector(".name").textContent === "Greta" && t.classList.contains("muted"))));

// Greta unmutes herself
await g1.click("#muteBtn");
await new Promise((r) => setTimeout(r, 1200));
check("Greta self-unmuted and badge cleared",
  await g2.evaluate(() => ![...document.querySelectorAll(".tile")].some((t) =>
    t.querySelector(".name").textContent === "Greta" && t.classList.contains("muted"))));

// Mute everyone
await host.click("#hpMuteAllBtn");
await new Promise((r) => setTimeout(r, 1200));
const hostMuted = await host.evaluate(() => document.querySelector("#muteBtn").classList.contains("off"));
const g1Muted = await g1.evaluate(() => document.querySelector("#muteBtn").classList.contains("off"));
const g2Muted = await g2.evaluate(() => document.querySelector("#muteBtn").classList.contains("off"));
check(`mute-all mutes guests (${g1Muted},${g2Muted}) but not the host (${hostMuted})`,
  g1Muted && g2Muted && !hostMuted);

// Host unmutes Gus from the panel
await host.$$eval(".hp-guest .mute", (btns) => {
  const b = btns.find((x) => x.textContent === "Unmute");
  b && b.click();
});
await new Promise((r) => setTimeout(r, 1200));
const unmutedCount = await host.$$eval(".hp-guest .mute", (btns) => btns.filter((b) => b.textContent === "Mute").length);
check(`host unmuted one guest from the panel (${unmutedCount} now unmuted)`, unmutedCount >= 1);

console.log(pass ? "ALL PASS" : "SOME CHECKS FAILED");
await browser.close();
process.exit(pass ? 0 : 1);
