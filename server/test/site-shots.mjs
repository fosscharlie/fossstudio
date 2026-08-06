// Website screenshots: real UI, gradient fake cameras, themed session.
import { chromium } from "playwright";
import fs from "node:fs";
import { hostLogin, TEST_HOST } from "./helpers.mjs";

const B = "http://127.0.0.1:3999";
const PW = "testpass123";
const CAMS = "/tmp/claude-1000/-home-charlie-GitHub-fossstudio/30aef10b-264b-4404-9752-f5d84c9a6596/scratchpad";
const OUT = "/home/charlie/GitHub/fossstudio/docs/shots";
fs.mkdirSync(OUT, { recursive: true });

// Sessions list should look like a real show's
const cookie = await hostLogin(B, PW);
const mk = (title) => fetch(`${B}/api/sessions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ title })
}).then((r) => r.json());
await mk("Episode 41 — Package managers, ranked");
await mk("Episode 40 — The systemd episode");
const main = await mk("Episode 42 — Live from FOSDEM");

async function studio(cam, name, asHost) {
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${CAMS}/${cam}`,
      "--autoplay-policy=no-user-gesture-required"
    ]
  });
  const ctx = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport: { width: 1560, height: 975 },
    deviceScaleFactor: 2
  });
  if (asHost) {
    const login = await ctx.newPage();
    await login.goto(`${B}/host/login.html`);
    await login.fill("#username", TEST_HOST.username);
    await login.fill("#password", TEST_HOST.password);
    await login.click("button[type=submit]");
    await login.waitForURL("**/host/");
    await login.close();
  }
  const page = await ctx.newPage();
  await page.goto(`${B}/s/${main.id}${asHost ? "?as=host" : ""}`);
  await page.waitForSelector("#joinBtn:not([disabled])");
  await page.fill("#nameInput", name);
  return { browser, page };
}

const host = await studio("cam1.y4m", "Alex", true);
const g2 = await studio("cam2.y4m", "Robin", false);
const g3 = await studio("cam3.y4m", "Sam", false);

// Preview screen shot before anyone joins (guest's view)
await g2.page.screenshot({ path: `${OUT}/preview.png` });

for (const s of [host, g2, g3]) {
  await s.page.click("#joinBtn");
  await s.page.waitForSelector("#session:not([hidden])");
}
await new Promise((r) => setTimeout(r, 4000));

// Hero: the live grid from the host's seat
await host.page.screenshot({ path: `${OUT}/session.png` });

// Host controls open
await host.page.click("#hostPanelBtn");
await new Promise((r) => setTimeout(r, 500));
await host.page.screenshot({ path: `${OUT}/host-panel.png` });

for (const s of [host, g2, g3]) await s.browser.close();

// Dashboard shots
const plain = await chromium.launch();
const dctx = await plain.newContext({ viewport: { width: 1560, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
const dash = await dctx.newPage();
await dash.goto(`${B}/host/login.html`);
await dash.fill("#username", TEST_HOST.username);
await dash.fill("#password", TEST_HOST.password);
await dash.click("button[type=submit]");
await dash.waitForURL("**/host/");
await dash.waitForTimeout(700);
await dash.screenshot({ path: `${OUT}/dashboard.png` });

// Admin: hosts management
const actx = await plain.newContext({ viewport: { width: 1560, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
const admin = await actx.newPage();
await admin.goto(`${B}/host/login.html`);
await admin.fill("#username", "admin");
await admin.fill("#password", PW);
await admin.click("button[type=submit]");
await admin.waitForURL("**/host/");
await admin.waitForTimeout(700);
await admin.click('#mainMenu button:has-text("Hosts")');
await admin.waitForTimeout(400);
await admin.screenshot({ path: `${OUT}/hosts.png` });

await plain.close();
console.log("shots saved:", fs.readdirSync(OUT).join(", "));
