// Web push for the host: "guest joined" and "recording ready" nudges.
// VAPID keys are generated on first boot and kept in the data dir.
import webpush from "web-push";
import { readJson, writeJson } from "./storage.js";
import { config } from "./config.js";

let keys = null;

export async function initPush() {
  keys = await readJson("push-keys.json");
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    await writeJson("push-keys.json", keys);
  }
  webpush.setVapidDetails(`https://${config.domain}`, keys.publicKey, keys.privateKey);
}

export function publicKey() {
  return keys?.publicKey;
}

export async function addSubscription(sub) {
  const subs = await readJson("push-subs.json", []);
  if (!subs.some((s) => s.endpoint === sub.endpoint)) {
    subs.push(sub);
    await writeJson("push-subs.json", subs);
  }
}

export async function notifyHost(title, body) {
  const subs = await readJson("push-subs.json", []);
  const alive = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify({ title, body }));
      alive.push(sub);
    } catch (err) {
      // 404/410 mean the subscription is dead; drop it
      if (![404, 410].includes(err.statusCode)) alive.push(sub);
    }
  }
  if (alive.length !== subs.length) await writeJson("push-subs.json", alive);
}
