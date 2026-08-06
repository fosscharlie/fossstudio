// Recording orchestration. One active recording per room.
//
// Browser mode: each participant's browser records itself (PCM audio +
// VP8 video) and uploads chunks; the server just appends to files.
// Server mode (small sessions): the SFU pipes each participant's RTP
// to ffmpeg locally, so browsers do nothing extra.
//
// Either way, processing afterwards produces out/combined.mkv plus one
// lossless FLAC per participant.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { readJson, writeJson } from "../storage.js";
import { startServerCapture, stopServerCapture } from "./serverRecorder.js";
import { processRecording } from "./processor.js";

const active = new Map(); // roomId -> rec

export function recDir(recId) {
  return path.join(config.dataDir, "recordings", recId);
}

function uploadToken(recId, peerId) {
  return crypto.createHmac("sha256", config.sessionSecret)
    .update(`${recId}:${peerId}`).digest("base64url");
}

export function verifyUploadToken(recId, peerId, token) {
  const expected = uploadToken(recId, peerId);
  return token?.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export function activeRecording(roomId) {
  return active.get(roomId) || null;
}

export function uploadCreds(rec, peerId) {
  return { recId: rec.id, peerId, token: uploadToken(rec.id, peerId) };
}

async function saveIndex(entry) {
  const list = await readJson("recordings.json", []);
  const i = list.findIndex((r) => r.id === entry.id);
  i === -1 ? list.unshift(entry) : (list[i] = entry);
  await writeJson("recordings.json", list);
}

export async function listRecordings() {
  return readJson("recordings.json", []);
}

export async function startRecording(room, mode) {
  if (active.has(room.id)) throw new Error("already recording");
  const recId = `${room.id}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const rec = {
    id: recId,
    roomId: room.id,
    ownerId: room.ownerId || null,
    mode,
    startedAt: Date.now(),
    peers: new Map(), // peerId -> {name, files:{}, clientStartOffsetMs, done}
    stopping: false
  };
  await fs.mkdir(path.join(recDir(recId), "raw"), { recursive: true });
  active.set(room.id, rec);

  for (const peer of room.peers.values()) addPeerToRecording(rec, peer);
  if (mode === "server") await startServerCapture(rec, room);

  await saveIndex({
    id: recId, roomId: room.id, ownerId: rec.ownerId, mode, startedAt: rec.startedAt,
    status: "recording", title: room.id, files: []
  });
  return rec;
}

export function addPeerToRecording(rec, peer) {
  if (rec.peers.has(peer.id) || rec.stopping) return null;
  rec.peers.set(peer.id, {
    name: peer.name,
    startOffsetMs: Date.now() - rec.startedAt,
    done: rec.mode === "server", // server mode needs no client uploads
    files: {}
  });
  return {
    recId: rec.id,
    peerId: peer.id,
    token: uploadToken(rec.id, peer.id)
  };
}

export async function appendChunk(recId, peerId, kind, seq, buf) {
  const rec = [...active.values()].find((r) => r.id === recId);
  if (!rec) throw new Error("no such recording");
  const p = rec.peers.get(peerId);
  if (!p) throw new Error("peer not in recording");
  if (!["audio", "video"].includes(kind)) throw new Error("bad kind");
  const safe = `${peerId}-${kind}.webm`;
  p.files[kind] = safe;
  await fs.appendFile(path.join(recDir(recId), "raw", safe), buf);
}

export function markPeerDone(recId, peerId) {
  const rec = [...active.values()].find((r) => r.id === recId);
  if (!rec) return;
  const p = rec.peers.get(peerId);
  if (p) p.done = true;
  maybeFinalize(rec);
}

export async function stopRecording(room) {
  const rec = active.get(room.id);
  if (!rec) return null;
  rec.stopping = true;
  if (rec.mode === "server") {
    await stopServerCapture(rec);
    for (const p of rec.peers.values()) p.done = true;
  }
  // Browser mode: clients get the stop event and send their final
  // chunks + done marker; finalize fires when all are in (or timeout).
  rec.stopTimeout = setTimeout(() => {
    for (const p of rec.peers.values()) p.done = true;
    maybeFinalize(rec);
  }, 20000);
  maybeFinalize(rec);
  return rec;
}

function maybeFinalize(rec) {
  if (!rec.stopping) return;
  if (![...rec.peers.values()].every((p) => p.done)) return;
  clearTimeout(rec.stopTimeout);
  active.delete(rec.roomId);
  finalize(rec).catch(async (err) => {
    console.error("recording processing failed:", err);
    await saveIndex({
      id: rec.id, roomId: rec.roomId, ownerId: rec.ownerId, mode: rec.mode, startedAt: rec.startedAt,
      status: "failed", error: "Processing failed — the raw files are kept.", files: []
    });
  });
}

async function finalize(rec) {
  await saveIndex({
    id: rec.id, roomId: rec.roomId, ownerId: rec.ownerId, mode: rec.mode, startedAt: rec.startedAt,
    endedAt: Date.now(), status: "processing", files: []
  });
  const files = await processRecording(rec);
  await saveIndex({
    id: rec.id, roomId: rec.roomId, ownerId: rec.ownerId, mode: rec.mode, startedAt: rec.startedAt,
    endedAt: Date.now(), status: "ready", files
  });
  const { notifyUser } = await import("../push.js");
  notifyUser(rec.ownerId, "Recording ready", `Session ${rec.roomId} is processed — ${files.length} files to download.`)
    .catch(() => {});
}

export async function deleteRecording(id) {
  const list = await readJson("recordings.json", []);
  await writeJson("recordings.json", list.filter((r) => r.id !== id));
  await fs.rm(recDir(id), { recursive: true, force: true });
}
