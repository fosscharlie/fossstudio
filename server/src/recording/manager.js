// Recording orchestration. One active recording per room.
//
// Browser mode: each participant's browser records itself (PCM audio +
// VP8 video) and uploads chunks; the server just appends to files.
// Server mode (small sessions): the SFU pipes each participant's RTP
// to ffmpeg locally, so browsers do nothing extra.
//
// Either way, processing afterwards produces out/combined.mp4 plus one
// lossless FLAC per participant (and a combined.flac mixdown).
//
// A JSON snapshot of the in-progress `rec` is written to disk on every
// meaningful change and cleared once processing finishes (success or
// failure). If the process dies mid-render - a deploy recreating the
// container is exactly what did this once - the snapshot survives and
// resumeOrphanedRecordings() (called at startup) picks it back up and
// finishes the job, instead of the recording being stuck on
// "processing" forever with no active render behind it.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { readJson, writeJson } from "../storage.js";
import { startServerCapture, stopServerCapture } from "./serverRecorder.js";
import { processRecording } from "./processor.js";

const active = new Map(); // roomId -> rec
let renderCount = 0; // how many finalize() calls are running right now

// So a deploy can check "is anything rendering?" before it recreates
// the container - see /api/ops/render-status and scripts/deploy.sh.
export function activeRenderCount() {
  return renderCount;
}

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

function snapshotPath(recId) {
  return path.join(recDir(recId), "rec.json");
}

// Best-effort: a missed snapshot costs a little resume fidelity on the
// rare crash, never a live recording. Never let it throw.
async function saveSnapshot(rec) {
  try {
    const snap = {
      id: rec.id, roomId: rec.roomId, ownerId: rec.ownerId, mode: rec.mode,
      title: rec.title, titlePos: rec.titlePos, titleScale: rec.titleScale,
      layout: rec.layout, spotlightPeerId: rec.spotlightPeerId,
      startedAt: rec.startedAt,
      bg: rec.bg, wallpaper: rec.wallpaper, titleFile: rec.titleFile,
      peers: Object.fromEntries(rec.peers),
      overlays: rec.overlays, clips: rec.clips, intros: rec.intros
    };
    // writeJson: atomic (temp file + rename) and owner-only (0600), same
    // as every other file under the data directory.
    await writeJson(path.join("recordings", rec.id, "rec.json"), snap);
  } catch (err) {
    console.error("recording snapshot failed:", err.message);
  }
}

async function clearSnapshot(recId) {
  await fs.unlink(snapshotPath(recId)).catch(() => {});
}

// A soundboard clip fired mid-recording. Copy the source file now (the
// host could delete it later) and note when it played; the processor
// mixes these into combined.mp4 and exports them as one separate track.
export async function logClip(rec, clip, file) {
  const idx = rec.clips.length;
  const dest = `clip-${idx}-${clip.id}${path.extname(file)}`;
  try {
    await fs.copyFile(file, path.join(recDir(rec.id), "raw", dest));
    rec.clips.push({ name: clip.name, offsetMs: Date.now() - rec.startedAt, file: dest });
    await saveSnapshot(rec);
  } catch (err) {
    console.error("logClip failed:", err.message);
  }
}

// A fullscreen intro video played mid-recording. Copy the source now and
// note when it played and for how long; the processor covers the grid
// with it (and mixes its audio) over that window.
export async function logIntro(rec, intro, file, durationMs) {
  const idx = rec.intros.length;
  const dest = `intro-${idx}-${intro.id}${path.extname(file)}`;
  try {
    await fs.copyFile(file, path.join(recDir(rec.id), "raw", dest));
    rec.intros.push({
      offsetMs: Date.now() - rec.startedAt, file: dest, durationMs,
      hasAudio: intro.hasAudio !== false
    });
    await saveSnapshot(rec);
  } catch (err) {
    console.error("logIntro failed:", err.message);
  }
}

export async function logOverlay(rec, kind, adFile) {
  const entry = { kind, offsetMs: Date.now() - rec.startedAt };
  if (adFile) {
    // Snapshot the ad image now, in case the host replaces it later
    const fsMod = await import("node:fs/promises");
    const pathMod = await import("node:path");
    const name = `ad-ov-${rec.overlays.length}${pathMod.extname(adFile)}`;
    await fsMod.copyFile(adFile, pathMod.join(recDir(rec.id), "raw", name));
    entry.file = name;
  }
  rec.overlays.push(entry);
  await saveSnapshot(rec);
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
    title: room.title || "",
    titlePos: room.control?.titlePos || { x: 0.5, y: 0 },
    titleScale: room.control?.titleScale || 1,
    layout: room.control?.layout || "grid",
    spotlightPeerId: room.control?.spotlightPeerId || null,
    startedAt: Date.now(),
    peers: new Map(), // peerId -> {name, files:{}, clientStartOffsetMs, done}
    overlays: [],     // {kind, offsetMs, file?} baked into combined.mp4
    clips: [],        // soundboard clips fired during the take (separate track)
    intros: [],       // fullscreen intro videos, baked into combined.mp4
    stopping: false
  };
  // Background for the composite: the room's pinned theme, so the video
  // matches what everyone saw even if settings changed mid-session
  rec.bg = room.theme?.bg || null;
  rec.wallpaper = room.theme?.wallpaperPath || null;
  await fs.mkdir(path.join(recDir(recId), "raw"), { recursive: true });
  active.set(room.id, rec);

  for (const peer of room.peers.values()) {
    if (peer.role === "viewer") continue; // OBS clean feeds aren't in the show
    addPeerToRecording(rec, peer);
  }

  // Banners the host uploaded earlier (e.g. already live) apply here too
  const bdir = path.join(config.dataDir, "banners", room.id);
  try {
    for (const f of await fs.readdir(bdir)) {
      if (!f.endsWith(".png")) continue;
      if (f === "__title.png") {
        await fs.copyFile(path.join(bdir, f), path.join(recDir(recId), "raw", "title.png"));
        rec.titleFile = "title.png";
        continue;
      }
      const pid = f.slice(0, -4);
      const name = `banner-${pid}.png`;
      await fs.copyFile(path.join(bdir, f), path.join(recDir(recId), "raw", name));
      const rp = rec.peers.get(pid);
      if (rp) rp.banner = name;
    }
  } catch { /* no banners yet */ }

  if (mode === "server") await startServerCapture(rec, room);

  await saveSnapshot(rec);
  await saveIndex({
    id: recId, roomId: room.id, ownerId: rec.ownerId, mode, startedAt: rec.startedAt,
    status: "recording", title: rec.title, files: []
  });
  return rec;
}

export function addPeerToRecording(rec, peer) {
  if (rec.peers.has(peer.id) || rec.stopping) return null;
  rec.peers.set(peer.id, {
    name: peer.name,
    role: peer.role,
    startOffsetMs: Date.now() - rec.startedAt,
    done: rec.mode === "server", // server mode needs no client uploads
    files: {}
  });
  saveSnapshot(rec).catch(() => {});
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
  saveSnapshot(rec).catch(() => {});
}

export function markPeerDone(recId, peerId) {
  const rec = [...active.values()].find((r) => r.id === recId);
  if (!rec) return;
  const p = rec.peers.get(peerId);
  if (p) p.done = true;
  saveSnapshot(rec).catch(() => {});
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
  await saveSnapshot(rec);
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
      id: rec.id, roomId: rec.roomId, ownerId: rec.ownerId, mode: rec.mode, title: rec.title,
      startedAt: rec.startedAt,
      status: "failed", error: "Processing failed - the raw files are kept.", files: []
    });
    // A genuine ffmpeg failure isn't retried automatically on the next
    // restart (that would just repeat the same failure forever) - the
    // raw files are kept for a manual look, same as always.
    await clearSnapshot(rec.id);
  });
}

async function finalize(rec) {
  renderCount++;
  try {
    await saveIndex({
      id: rec.id, roomId: rec.roomId, ownerId: rec.ownerId, mode: rec.mode, title: rec.title,
      startedAt: rec.startedAt,
      endedAt: Date.now(), status: "processing", files: []
    });
    const files = await processRecording(rec);
    await saveIndex({
      id: rec.id, roomId: rec.roomId, ownerId: rec.ownerId, mode: rec.mode, title: rec.title,
      startedAt: rec.startedAt,
      endedAt: Date.now(), status: "ready", files
    });
    await clearSnapshot(rec.id);
    const { notifyUser } = await import("../push.js");
    notifyUser(rec.ownerId, "Recording ready", `Session ${rec.roomId} is processed - ${files.length} files to download.`)
      .catch(() => {});
  } finally {
    renderCount--;
  }
}

// Called once at server startup. A snapshot on disk with the recording
// still marked "processing" in the index means the process died before
// finalize() finished (a deploy recreating the container mid-render is
// exactly what happened once) - there is no active render behind it to
// wait for, so pick the snapshot back up and finish the job now.
// Returns how many were found, for a startup log line / alert.
export async function resumeOrphanedRecordings() {
  const dir = path.join(config.dataDir, "recordings");
  const ids = await fs.readdir(dir).catch(() => []);
  const index = await readJson("recordings.json", []);
  let resumed = 0;
  for (const id of ids) {
    const snap = await readJson(path.join("recordings", id, "rec.json"), null);
    if (!snap) continue;
    const entry = index.find((r) => r.id === id);
    if (entry?.status !== "processing") {
      // Stale snapshot with no matching stuck entry (shouldn't normally
      // happen) - clear it rather than leave dead weight behind.
      await clearSnapshot(id);
      continue;
    }
    const rec = { ...snap, peers: new Map(Object.entries(snap.peers || {})) };
    console.log(`resuming orphaned recording ${id} (interrupted mid-render)`);
    resumed++;
    finalize(rec).catch(async (err) => {
      console.error(`resume of ${id} failed:`, err.message);
      await saveIndex({
        id: rec.id, roomId: rec.roomId, ownerId: rec.ownerId, mode: rec.mode, title: rec.title,
        startedAt: rec.startedAt,
        status: "failed", error: "Processing failed - the raw files are kept.", files: []
      });
      await clearSnapshot(rec.id);
    });
  }
  return resumed;
}

export async function deleteRecording(id) {
  const list = await readJson("recordings.json", []);
  await writeJson("recordings.json", list.filter((r) => r.id !== id));
  await fs.rm(recDir(id), { recursive: true, force: true });
}

// Remove a single output file (one FLAC or the combined MP4) from a
// recording, leaving the rest. Returns false if it wasn't one of its files.
export async function deleteRecordingFile(id, file) {
  const safe = path.basename(file);
  const list = await readJson("recordings.json", []);
  const rec = list.find((r) => r.id === id);
  if (!rec || !(rec.files || []).includes(safe)) return false;
  await fs.rm(path.join(recDir(id), "out", safe), { force: true });
  rec.files = rec.files.filter((f) => f !== safe);
  await writeJson("recordings.json", list);
  return true;
}
