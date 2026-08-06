// In-memory room state. Rooms exist while people are in them;
// session history that must survive restarts goes to flat files later.
import crypto from "node:crypto";
import { createRouter } from "./media.js";

export const MAX_GUESTS = 10;

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
        volumes: {}              // peerId -> 0..1.5
      }
    };
    rooms.set(roomId, room);
  }
  return room;
}

export function getRoom(roomId) {
  return rooms.get(roomId);
}

export function addPeer(room, { name, role, socket }) {
  if (room.peers.size >= MAX_GUESTS) {
    throw Object.assign(new Error("session full"), { code: "ROOM_FULL" });
  }
  const peer = {
    id: crypto.randomUUID(),
    name,
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
  if (room.peers.size === 0) {
    try { room.router.close(); } catch { /* already closed */ }
    rooms.delete(room.id);
  }
}

export function peerSummary(peer) {
  return {
    id: peer.id,
    name: peer.name,
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
