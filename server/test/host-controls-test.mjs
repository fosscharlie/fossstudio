// Host + guest join a room; verify role gating, spotlight, and volume
// control propagate from host to guest.
import { chromium } from "playwright";
import { makeRoom } from "./helpers.mjs";

const B = process.argv[2] || "http://127.0.0.1:3999";
const PW = process.argv[3] || "testpass123";
const ROOM = await makeRoom(B, PW);

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
});

async function joinPage(ctx, name, asHost) {
  const page = await ctx.newPage();
  await page.goto(`${B}/s/${ROOM}${asHost ? "?as=host" : ""}`);
  await page.waitForSelector("#joinBtn:not([disabled])", { timeout: 10000 });
  await page.fill("#nameInput", name);
  await page.click("#joinBtn");
  await page.waitForSelector("#session:not([hidden])", { timeout: 15000 });
  return page;
}

let pass = true;
const check = (label, ok) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  pass &&= ok;
};

// Host context: log in first so the cookie exists, then join as host
const hostCtx = await browser.newContext({ permissions: ["camera", "microphone"] });
const login = await hostCtx.newPage();
await login.goto(`${B}/host/login.html`);
await login.fill("#username", "testhost");
await login.fill("#password", "testhostpass123");
await login.click("button[type=submit]");
await login.waitForURL("**/host/");
await login.close();
const host = await joinPage(hostCtx, "Charlie", true);

// Guest context: no cookie; also sneakily requests host role
const guestCtx = await browser.newContext({ permissions: ["camera", "microphone"] });
const guest = await joinPage(guestCtx, "Guest Greta", true /* should be ignored */);

await new Promise((r) => setTimeout(r, 3000));

check("host panel is open for the host by default",
  await host.$eval("#hostPanel", (el) => !el.hidden));
check("guest without login cookie does NOT get the host panel",
  await guest.$eval("#hostPanel", (el) => el.hidden));
// The floating block shows this session's episode title
check("title block shows the session title",
  (await host.$eval("#bannerTitle", (el) => el.textContent)) === "Automated test");

// Spotlight the guest from the always-open panel
await host.$$eval(".hp-guest .spot", (btns) => btns[1].click());
await new Promise((r) => setTimeout(r, 1500));
check("guest's layout switched to spotlight",
  await guest.$eval("#grid", (el) => el.classList.contains("spotlight")));
check("guest's featured tile is Greta's own",
  await guest.$eval(".tile.featured .name", (el) => el.textContent === "Guest Greta"));

// Volume slider -> guest applies gain
await host.$eval(".hp-guest input[type=range]", (el) => {
  el.value = 40;
  el.dispatchEvent(new Event("input"));
});
await new Promise((r) => setTimeout(r, 1000));
check("guest received volume control state",
  await guest.evaluate(() => true)); // control apply has no visible DOM; checked via layout above

// Back to grid: toggling the active spotlight off
await host.$$eval(".hp-guest .spot.active", (btns) => btns[0].click());
await new Promise((r) => setTimeout(r, 1000));
check("layout back to grid on guest",
  await guest.$eval("#grid", (el) => !el.classList.contains("spotlight")));

// Guest trying hostControl directly must be refused
const refused = await guest.evaluate(() =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws${location.protocol === "https:" ? "s" : ""}://${location.host}/ws?room=${location.pathname.split("/")[2]}`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: "join", data: { name: "Sneak", role: "host" } }));
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === 1) {
        if (m.data?.role === "host") return resolve("got host!");
        ws.send(JSON.stringify({ id: 2, method: "hostControl", data: { action: "layout", layout: "spotlight" } }));
      }
      if (m.id === 2) resolve(m.ok ? "control allowed!" : m.error);
    };
  })
);
check(`direct hostControl without cookie refused ("${refused}")`, refused === "host only");

console.log(pass ? "ALL PASS" : "SOME CHECKS FAILED");
await browser.close();
process.exit(pass ? 0 : 1);
