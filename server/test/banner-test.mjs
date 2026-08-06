import { chromium } from "playwright";
import { makeRoom } from "./helpers.mjs";
const B = "http://127.0.0.1:3999";
const CAMS = "/tmp/claude-1000/-home-charlie-GitHub-fossstudio/30aef10b-264b-4404-9752-f5d84c9a6596/scratchpad";
const ROOM = await makeRoom(B, "testpass123");
let pass = true;
const check = (l, ok) => { console.log(`${ok ? "OK  " : "FAIL"} ${l}`); pass &&= ok; };

async function join(cam, name, tagline, asHost) {
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${CAMS}/${cam}`, "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
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
  if (tagline) await page.fill("#taglineInput", tagline);
  await page.click("#joinBtn");
  await page.waitForSelector("#session:not([hidden])");
  return { browser, page };
}

const host = await join("vcam1.y4m", "Anna", "Host — awesomepodcast.org", true);
const guest = await join("vcam2.y4m", "Dev", "Kernel maintainer", false);
await new Promise((r) => setTimeout(r, 3000));

check("banner sits below video (not overlapping)",
  await guest.page.evaluate(() => {
    const t = document.querySelector(".tile:not(.self)");
    const v = t.querySelector("video").getBoundingClientRect();
    const b = t.querySelector(".lower-third").getBoundingClientRect();
    return b.top >= v.bottom - 1;
  }));

// Host changes banner colour to pink; guest should follow
await host.page.click("#hostPanelBtn");
await host.page.evaluate(() => {
  const inp = document.getElementById("hpBannerHex");
  inp.value = "#e8207e";
  inp.dispatchEvent(new Event("change"));
});
await new Promise((r) => setTimeout(r, 1500));
const guestColor = await guest.page.evaluate(() =>
  getComputedStyle(document.querySelector(".tile .lower-third")).backgroundColor);
check(`guest banner turned pink (${guestColor})`, guestColor === "rgb(232, 32, 126)");

await host.page.screenshot({ path: `${CAMS}/banner-under.png` });
console.log(pass ? "ALL PASS" : "SOME CHECKS FAILED");
await host.browser.close(); await guest.browser.close();
process.exit(pass ? 0 : 1);
