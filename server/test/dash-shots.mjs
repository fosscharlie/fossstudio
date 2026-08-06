// Screenshot the host dashboard in light and dark themes.
import { chromium } from "playwright";
import { hostLogin } from "./helpers.mjs";

const B = process.argv[2] || "http://127.0.0.1:3999";
const PW = process.argv[3] || "testpass123";
const OUT = "/tmp/claude-1000/-home-charlie-GitHub-fossstudio/30aef10b-264b-4404-9752-f5d84c9a6596/scratchpad";

await hostLogin(B, PW); // ensures the testhost account exists
const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${B}/host/login.html`);
  if (scheme === "light") await page.screenshot({ path: `${OUT}/dash-login-${scheme}.png` });
  await page.fill("#username", "testhost");
await page.fill("#password", "testhostpass123");
  await page.click("button[type=submit]");
  await page.waitForURL("**/host/");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/dash-sessions-${scheme}.png` });
  await page.click('#mainMenu button:has-text("Settings")');
  await page.click('#subMenu button:has-text("Podcast banner")');
  await page.screenshot({ path: `${OUT}/dash-theme-${scheme}.png` });
  await ctx.close();
}
await browser.close();
console.log("done");
