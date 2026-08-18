// Live chat for the watch page (/live/<session>). Viewers pick a name
// and talk while they watch; hosts appear in the same chat under their
// own name and can block people. This is the layer FOSSCast handed
// over (see its docs/live-handover.md): the studio originates the
// stream, so it hosts the audience too.
//
// Blocking bans both the username and the IP address, so a blocked
// person can neither rejoin from another IP under the same name nor
// pick a new name from the same connection. Blocked entries are kept
// on a visible list (data/chat-blocklist.json) so a mistake - or an
// accepted apology - can be undone from the dashboard. Their messages
// vanish for everyone the moment the block lands. Viewer IPs never
// reach any client.
//
// Every message passes the word filter before anyone sees it, the
// sender included.
import { WebSocketServer } from "ws";
import crypto from "node:crypto";
import { readJson, writeJson } from "./storage.js";
import { filterText } from "./wordfilter.js";
import { isAuthedRequest } from "./auth.js";
import { findSession } from "./settings.js";

const ROOM_ID_RE = /^[a-zA-Z0-9_-]{4,32}$/;
const NAME_RE = /^[\p{L}\p{N} _.-]{2,24}$/u;
const MAX_MSG = 500;
const HISTORY = 50;
const MSG_INTERVAL_MS = 2000; // one message per two seconds, like the proven FOSSCast chat

const rooms = new Map(); // roomId -> { clients:Set, history:[], live:bool }

const BLOCKLIST_FILE = "chat-blocklist.json";
let blocklist = null; // [{id, name, ip, by, blockedAt}]

async function loadBlocklist() {
  if (blocklist === null) blocklist = await readJson(BLOCKLIST_FILE, []);
  return blocklist;
}

export async function listBlocked() {
  // Names and timestamps only ever reach the dashboard; the stored IP
  // stays server-side even for hosts
  return (await loadBlocklist()).map(({ id, name, by, blockedAt }) => ({ id, name, by, blockedAt }));
}

export async function unblock(id) {
  const list = await loadBlocklist();
  const i = list.findIndex((b) => b.id === id);
  if (i === -1) return false;
  list.splice(i, 1);
  await writeJson(BLOCKLIST_FILE, list);
  return true;
}

async function isBlocked({ name, ip }) {
  const list = await loadBlocklist();
  const n = (name || "").trim().toLowerCase();
  return list.some((b) =>
    (ip && b.ip && b.ip === ip) || (n && b.name.toLowerCase() === n));
}

async function addBlock({ name, ip, by }) {
  const list = await loadBlocklist();
  if (list.some((b) => b.name.toLowerCase() === name.toLowerCase() && b.ip === ip)) return;
  list.unshift({
    id: crypto.randomBytes(6).toString("hex"),
    name, ip: ip || null, by, blockedAt: Date.now()
  });
  await writeJson(BLOCKLIST_FILE, list);
}

function clientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
}

function roomState(roomId) {
  let r = rooms.get(roomId);
  if (!r) {
    r = { clients: new Set(), history: [], live: false };
    rooms.set(roomId, r);
  }
  return r;
}

function broadcast(r, payload) {
  const raw = JSON.stringify(payload);
  for (const c of r.clients) {
    if (c.ws.readyState === 1) c.ws.send(raw);
  }
}

function viewerCount(r) {
  return [...r.clients].filter((c) => c.name).length;
}

// The stream engine flips this on start/stop so every open watch page
// switches between the player and the offline state without refreshing
export function notifyLive(roomId, live) {
  const r = roomState(roomId);
  r.live = live;
  broadcast(r, { event: "live", data: { live } });
  if (!live && r.clients.size === 0) rooms.delete(roomId);
}

export function attachChat() {
  // noServer: index.js routes upgrade requests by path (see signaling.js)
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const roomId = url.searchParams.get("room") || "";
    if (!ROOM_ID_RE.test(roomId)) return ws.close(4400, "bad room id");

    const ip = clientIp(req);
    // Hosts moderate: anyone with a dashboard login (any of the hosts
    // can block somebody, not just the show's owner)
    const auth = isAuthedRequest(req);
    const client = { ws, ip, name: null, isHost: !!auth, lastMsgAt: 0 };
    let r = null;

    const send = (payload) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(payload));
    };

    // The admission checks are async, but the message listener must be
    // attached before the first await or a fast client's first message
    // is silently dropped (the same race once lost a mid-recording
    // joiner's footage over in signaling). Every message waits for
    // admission to settle; admission failing closes the socket.
    const admitted = (async () => {
      const session = await findSession(roomId);
      if (!session) { ws.close(4404, "no such session"); return false; }
      if (!client.isHost && await isBlocked({ ip })) {
        ws.close(4403, "blocked");
        return false;
      }
      r = roomState(roomId);
      r.clients.add(client);
      send({
        event: "hello",
        data: { isHost: client.isHost, live: r.live, viewers: viewerCount(r), history: r.history }
      });
      return true;
    })();

    ws.on("message", async (raw) => {
      if (!await admitted) return;
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      const { id, method, data = {} } = msg;
      const reply = (payload) => send({ id, ok: true, data: payload });
      const fail = (error) => send({ id, ok: false, error });

      try {
        switch (method) {
          case "join": {
            const name = String(data.name || "").trim();
            if (!NAME_RE.test(name)) return fail("Pick a name: 2 to 24 letters or numbers.");
            if (await isBlocked({ name, ip: client.isHost ? null : ip })) {
              return fail("You are blocked from this chat.");
            }
            // One person per name, so a block always lands on who it names
            const taken = [...r.clients].some((c) => c !== client &&
              c.name && c.name.toLowerCase() === name.toLowerCase());
            if (taken) return fail("That name is already in the chat - pick another.");
            const first = !client.name;
            client.name = name;
            reply({ name });
            if (first) broadcast(r, { event: "viewers", data: { viewers: viewerCount(r) } });
            break;
          }
          case "message": {
            if (!client.name) return fail("Join with a name first.");
            if (await isBlocked({ name: client.name, ip: client.isHost ? null : ip })) {
              ws.close(4403, "blocked");
              return;
            }
            const now = Date.now();
            if (now - client.lastMsgAt < MSG_INTERVAL_MS) return fail("Slow down a little.");
            const text = filterText(String(data.text || "").trim().slice(0, MAX_MSG));
            if (!text) return fail("Nothing to send.");
            client.lastMsgAt = now;
            const entry = {
              id: crypto.randomBytes(6).toString("hex"),
              name: client.name, host: client.isHost, text, ts: now
            };
            r.history.push(entry);
            if (r.history.length > HISTORY) r.history.shift();
            broadcast(r, { event: "message", data: entry });
            reply({});
            break;
          }
          case "block": {
            if (!client.isHost) return fail("host only");
            const name = String(data.name || "").trim();
            if (!name) return fail("who?");
            // The live connection supplies the IP; a block still lands
            // on the name alone if they already left
            const target = [...r.clients].find((c) =>
              c.name && c.name.toLowerCase() === name.toLowerCase());
            if (target?.isHost) return fail("Hosts can't be blocked.");
            await addBlock({ name: target?.name || name, ip: target?.ip || null, by: auth.uid });
            if (target) {
              target.ws.close(4403, "blocked");
              r.clients.delete(target);
            }
            // Their messages vanish for everyone, instantly
            r.history = r.history.filter((m) => m.name.toLowerCase() !== name.toLowerCase());
            broadcast(r, { event: "blocked", data: { name: target?.name || name, viewers: viewerCount(r) } });
            reply({});
            break;
          }
          default:
            fail("unknown method");
        }
      } catch (err) {
        fail(err.message);
      }
    });

    ws.on("close", () => {
      if (!r) return;
      r.clients.delete(client);
      if (client.name) broadcast(r, { event: "viewers", data: { viewers: viewerCount(r) } });
      if (r.clients.size === 0 && !r.live) rooms.delete(roomId);
    });
  });

  return wss;
}

// Test hook: forget the cached blocklist so a different data dir applies
export function reloadBlocklist() {
  blocklist = null;
}
