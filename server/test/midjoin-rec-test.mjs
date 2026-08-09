// Regression test for the Charlie bug: a guest who joins while the
// recording is already running must still upload their chunks.
import { chromium } from "playwright";
import { makeRoom } from "./helpers.mjs";
import fs from "node:fs";

const B = "http://127.0.0.1:3999";
const CAMS = "/tmp/claude-1000/-home-charlie-GitHub-fossstudio/30aef10b-264b-4404-9752-f5d84c9a6596/scratchpad";
const ROOM = await makeRoom(B, "testpass123");

async function join(cam, name, asHost) {
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${CAMS}/${cam}`, "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1400, height: 900 } });
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
  return { browser, page };
}

const host = await join("vcam1.y4m", "Host", true);
await host.page.click("#hpRecordBtn");           // start recording, host alone
await host.page.waitForTimeout(3000);

const late = await join("vcam2.y4m", "Latecomer", false);  // joins mid-recording
await late.page.waitForTimeout(12000);           // long enough for 5s chunk uploads

await host.page.click("#hpRecordBtn");           // stop
await host.page.waitForTimeout(4000);

const recDir = fs.readdirSync("/home/charlie/GitHub/fossstudio/data/recordings").find((d) => d.includes(ROOM));
const raw = `/home/charlie/GitHub/fossstudio/data/recordings/${recDir}/raw`;
const files = fs.readdirSync(raw).filter((f) => f.endsWith(".webm"));
const peers = new Set(files.map((f) => f.split("-audio")[0].split("-video")[0]));
console.log("raw webm files:", files.length, "distinct peers:", peers.size);
const ok = peers.size === 2;
console.log(ok ? "PASS  mid-recording joiner uploaded their track" : "FAIL  latecomer's track missing");
await host.browser.close();
await late.browser.close();
process.exit(ok ? 0 : 1);
