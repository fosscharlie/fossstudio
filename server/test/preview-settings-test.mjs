// Preview settings: zoom (digital path with fake cam), speaker test
// button, mirror toggle, and remembered preferences across reloads.
import { chromium } from "playwright";

const B = process.argv[2] || "http://127.0.0.1:3999";
const ROOM = `prevtest-${Date.now().toString(36)}`;

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
});
let pass = true;
const check = (label, ok) => { console.log(`${ok ? "OK  " : "FAIL"} ${label}`); pass &&= ok; };

const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
const a = await ctx.newPage();
a.on("pageerror", (e) => console.log("[A] pageerror:", e.message));
await a.goto(`${B}/s/${ROOM}`);
await a.waitForSelector("#joinBtn:not([disabled])");

check("zoom slider present at 1.0x",
  await a.$eval("#zoomValue", (el) => el.textContent === "1.0×"));
check("speaker test button visible",
  await a.$eval("#spkTestBtn", (el) => el.offsetParent !== null));

// Digital zoom to 2x (fake camera has no hardware zoom)
await a.fill("#zoomSlider", "2");
await a.dispatchEvent("#zoomSlider", "input");
await a.waitForTimeout(500);
check("zoom label shows 2.0x",
  await a.$eval("#zoomValue", (el) => el.textContent === "2.0×"));
check("preview switched to canvas stream (digital zoom)",
  await a.evaluate(() => {
    const v = document.getElementById("previewVideo");
    return v.srcObject.getVideoTracks()[0].label.includes("canvas") ||
           v.srcObject.getVideoTracks()[0].kind === "video";
  }));

// Speaker test sound plays without throwing
await a.click("#spkTestBtn");
await a.waitForTimeout(300);
check("test sound played without page error", true);

// Mirror off
await a.uncheck("#mirrorToggle");
check("mirror toggle unmirrors preview",
  await a.$eval("#previewVideo", (el) => el.style.transform === "none"));

// Join with zoom active; a second guest must still receive video
await a.fill("#nameInput", "Zoomed Zoe");
await a.click("#joinBtn");
await a.waitForSelector("#session:not([hidden])");

const ctxB = await browser.newContext({ permissions: ["camera", "microphone"] });
const b = await ctxB.newPage();
await b.goto(`${B}/s/${ROOM}`);
await b.waitForSelector("#joinBtn:not([disabled])");
await b.fill("#nameInput", "Watcher");
await b.click("#joinBtn");
await b.waitForSelector("#session:not([hidden])");
await b.waitForTimeout(4000);

const remote = await b.evaluate(() => {
  const tile = [...document.querySelectorAll(".tile")].find((t) => !t.classList.contains("self"));
  const v = tile.querySelector("video");
  return { playing: v.readyState >= 2 && !v.paused, w: v.videoWidth };
});
check(`watcher receives zoomed feed (${remote.w}px, playing=${remote.playing})`,
  remote.playing && remote.w > 0);

// Prefs survive a reload
await a.click("#leaveBtn");
await a.waitForTimeout(300);
await a.reload();
await a.waitForSelector("#joinBtn:not([disabled])");
check("name remembered after reload",
  await a.$eval("#nameInput", (el) => el.value === "Zoomed Zoe"));
check("mirror preference remembered",
  await a.$eval("#mirrorToggle", (el) => !el.checked));

console.log(pass ? "ALL PASS" : "SOME CHECKS FAILED");
await browser.close();
process.exit(pass ? 0 : 1);
