// In-memory room state. Rooms exist while people are in them;
// session history that must survive restarts goes to flat files later.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRouter } from "./media.js";
import { config } from "./config.js";

export const MAX_GUESTS = 10;
export const MAX_VIEWERS = 4; // receive-only OBS/clean-feed connections

const rooms = new Map();

export async function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      router: await createRouter(),
      peers: new Map(),
      createdAt: Date.now(),
      // Live host-controlled state, mirrored to every client
      control: {
        layout: "grid",          // "grid" | "spotlight"
        spotlightPeerId: null,
        volumes: {},             // peerId -> 0..1.5
        muted: {},               // peerId -> true when mic is muted
        noise: {},               // peerId -> noise suppression on/off
        hands: {},               // peerId -> wants to talk
        bannerColor: null,       // solid colour of the name banners
        bannerMulti: false,      // one colour per person instead
        bannerChoice: false,     // guests may pick their own colour
        bannerColors: {},        // peerId -> hex when bannerMulti
        autoGain: true,          // per-session, host-toggled (on by default)
        titlePos: { x: 0.5, y: 0 } // logo/title block, fraction of free space
      }
    };
    rooms.set(roomId, room);
  }
  return room;
}

export function getRoom(roomId) {
  return rooms.get(roomId);
}

// Freeze the theme for the life of the room: title, colour, and private
// copies of the logo/wallpaper files. Settings changed mid-session (or a
// renamed session) only show once the room has emptied and re-formed -
// everyone in a session always sees the same thing. The copies live in
// the room's banners dir, which is already deleted when the room dies.
export async function pinTheme(room, session, settings) {
  room.title = session.title === "Untitled session" ? "" : session.title;
  const theme = {
    bg: settings.bg || null,
    logoUrl: null, logoPath: null,
    wallpaperUrl: null, wallpaperPath: null
  };
  const dir = path.join(config.dataDir, "banners", room.id);
  await fs.mkdir(dir, { recursive: true });
  for (const [kind, file] of [["logo", settings.logo], ["wallpaper", settings.wallpaper]]) {
    if (!file) continue;
    const src = path.join(config.dataDir, "uploads", path.basename(file));
    const dst = path.join(dir, `theme-${kind}${path.extname(file)}`);
    try {
      await fs.copyFile(src, dst);
      theme[`${kind}Path`] = dst;
      theme[`${kind}Url`] = `/api/room-theme/${room.id}/${kind}`;
    } catch { /* source vanished: theme falls back to the colour */ }
  }
  room.theme = theme;
}

export function addPeer(room, { name, tagline, role, socket }) {
  // Viewers (OBS clean feeds) have their own small pool so they can
  // never crowd out a person - and people never crowd them out
  const viewers = [...room.peers.values()].filter((p) => p.role === "viewer").length;
  const full = role === "viewer"
    ? viewers >= MAX_VIEWERS
    : room.peers.size - viewers >= MAX_GUESTS;
  if (full) {
    throw Object.assign(new Error("session full"), { code: "ROOM_FULL" });
  }
  const peer = {
    id: crypto.randomUUID(),
    name,
    tagline: tagline || "",
    role, // "host" | "guest"
    socket,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map()
  };
  room.peers.set(peer.id, peer);
  return peer;
}

export function removePeer(room, peerId) {
  const peer = room.peers.get(peerId);
  if (!peer) return;
  for (const t of peer.transports.values()) {
    try { t.close(); } catch { /* already closed */ }
  }
  room.peers.delete(peerId);
  delete room.control.volumes[peerId];
  delete room.control.muted[peerId];
  delete room.control.bannerColors[peerId];
  delete room.control.noise[peerId];
  delete room.control.hands[peerId];
  if (room.peers.size === 0) {
    try { room.router.close(); } catch { /* already closed */ }
    rooms.delete(room.id);
    fs.rm(path.join(config.dataDir, "banners", room.id), { recursive: true, force: true })
      .catch(() => {});
  }
}

export function peerSummary(peer) {
  return {
    id: peer.id,
    name: peer.name,
    tagline: peer.tagline,
    role: peer.role,
    producers: [...peer.producers.values()].map((p) => ({
      id: p.id,
      kind: p.kind,
      source: p.appData?.source || p.kind
    }))
  };
}

export function broadcast(room, exceptPeerId, message) {
  const raw = JSON.stringify(message);
  for (const peer of room.peers.values()) {
    if (peer.id === exceptPeerId) continue;
    if (peer.socket.readyState === 1) peer.socket.send(raw);
  }
}
