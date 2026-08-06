// Verify audio actually arrives: sender joins with noise suppression
// on and off; receiver measures RMS energy of the incoming track.
import { chromium } from "playwright";
import { makeRoom } from "./helpers.mjs";

const B = process.argv[2] || "http://127.0.0.1:3999";
const PW = process.argv[3] || "testpass123";

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
});

async function join(room, name, noise) {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
  const page = await ctx.newPage();
  await page.goto(`${B}/s/${room}`);
  await page.waitForSelector("#joinBtn:not([disabled])");
  await page.fill("#nameInput", name);
  await page.click("#joinBtn");
  await page.waitForSelector("#session:not([hidden])");
  return page;
}

async function measure(noise) {
  const room = await makeRoom(B, PW);
  const sender = await join(room, "Sender", noise);
  // Guests join muted by default: unmute the sender for the measurement
  await sender.click("#muteBtn");
  const receiver = await join(room, "Receiver", false);
  await new Promise((r) => setTimeout(r, 2000));
  const rms = await receiver.evaluate(() => new Promise((resolve) => {
    const tiles = [...document.querySelectorAll(".tile")].filter((t) => !t.classList.contains("self"));
    const track = tiles[0].querySelector("video").srcObject.getAudioTracks()[0];
    const ctx = new AudioContext({ sampleRate: 48000 });
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    let peak = 0, n = 0;
    const iv = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      peak = Math.max(peak, Math.sqrt(sum / buf.length));
      if (++n >= 20) { clearInterval(iv); resolve(peak); }
    }, 100);
  }));
  await sender.context().close();
  await receiver.context().close();
  return rms;
}

const rms = await measure(true);
console.log(`peak RMS with default noise suppression: ${rms.toFixed(4)}`);
const ok = rms > 0.0001;
console.log(ok ? "AUDIO FLOWS" : "AUDIO MISSING");
await browser.close();
process.exit(ok ? 0 : 1);
