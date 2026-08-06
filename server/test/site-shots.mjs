// Website screenshots. Two separate sessions and a solo preview so no
// generated face appears in more than one image on the site.
import { chromium } from "playwright";
import fs from "node:fs";
import { hostLogin, TEST_HOST } from "./helpers.mjs";

const B = "http://127.0.0.1:3999";
const PW = "testpass123";
const CAMS = "/tmp/claude-1000/-home-charlie-GitHub-fossstudio/30aef10b-264b-4404-9752-f5d84c9a6596/scratchpad";
const OUT = "/home/charlie/GitHub/fossstudio/docs/shots";
fs.mkdirSync(OUT, { recursive: true });

const cookie = await hostLogin(B, PW);
const mk = (title) => fetch(`${B}/api/sessions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ title })
}).then((r) => r.json());
await mk("Episode 41: Package Managers, Ranked");
await mk("Episode 40: The systemd Episode");
const sessionA = await mk("Episode 42: Live From FOSDEM");
const sessionB = await mk("Episode 39: Homelab Horror Stories");

async function studio(cam, name, tagline, sessionId, asHost) {
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
  await page.goto(`${B}/s/${sessionId}${asHost ? "?as=host" : ""}`);
  await page.waitForSelector("#joinBtn:not([disabled])");
  await page.fill("#nameInput", name);
  if (tagline) await page.fill("#taglineInput", tagline);
  return { browser, page };
}

async function joinAll(list) {
  for (const s of list) {
    await s.page.click("#joinBtn");
    await s.page.waitForSelector("#session:not([hidden])");
  }
}

// --- Session A: the hero shot (three unique people) ---
const a1 = await studio("vcam1.y4m", "Anna", "awesomepodcast.org", sessionA.id, true);
const a2 = await studio("vcam2.y4m", "Dev", "Kernel maintainer", sessionA.id, false);
const a3 = await studio("vcam3.y4m", "Margot", "Tech author", sessionA.id, false);
await joinAll([a1, a2, a3]);
await new Promise((r) => setTimeout(r, 4000));
await a2.page.screenshot({ path: `${OUT}/session.png` });
for (const s of [a1, a2, a3]) await s.browser.close();

// --- Session B: host panel open (three different people) ---
const b1 = await studio("vcam4.y4m", "Ken", "ken.codes", sessionB.id, true);
const b2 = await studio("vcam5.y4m", "Amara", "Homelab editor", sessionB.id, false);
const b3 = await studio("vcam6.y4m", "Rob", "selfhosted.town", sessionB.id, false);
await joinAll([b1, b2, b3]);
await new Promise((r) => setTimeout(r, 4000));
await new Promise((r) => setTimeout(r, 500));
await b1.page.screenshot({ path: `${OUT}/host-panel.png` });
for (const s of [b1, b2, b3]) await s.browser.close();

// --- Preview: a seventh person, never seen elsewhere ---
const p = await studio("vcam7.y4m", "", "", sessionA.id, false);
await new Promise((r) => setTimeout(r, 800));
await p.page.screenshot({ path: `${OUT}/preview.png` });
await p.browser.close();

// --- Dashboard shots (no faces) ---
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

const actx = await plain.newContext({ viewport: { width: 1560, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
const admin = await actx.newPage();
await admin.goto(`${B}/host/login.html`);
await admin.fill("#username", "admin");
await admin.fill("#password", PW);
await admin.click("button[type=submit]");
await admin.waitForURL("**/host/");
await admin.waitForTimeout(700);
await admin.click('#mainMenu button:has-text("Hosts")');
await admin.waitForTimeout(500);
await admin.screenshot({ path: `${OUT}/hosts.png` });

await plain.close();
console.log("shots saved:", fs.readdirSync(OUT).join(", "));
