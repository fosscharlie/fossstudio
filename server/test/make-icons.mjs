// Render the app icon at 192 and 512 px via headless Chromium.
import { chromium } from "playwright";

const html = (size) => `<!doctype html><style>
  body { margin: 0; }
  .icon {
    width: ${size}px; height: ${size}px;
    background: #14161a;
    display: grid; place-items: center;
    font-family: sans-serif;
  }
  .mark { font-weight: 800; font-size: ${size * 0.42}px; letter-spacing: -0.04em; }
  .f { color: #fbc711; }
  .s { color: #e8eaed; }
</style><body><div class="icon"><div class="mark"><span class="f">F</span><span class="s">S</span></div></div>`;

const browser = await chromium.launch();
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(html(size));
  await page.screenshot({ path: `/home/charlie/GitHub/fossstudio/web/icons/icon-${size}.png` });
}
await browser.close();
console.log("icons made");
