// Per-user settings (validated patches) and the session registry.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson } from "./storage.js";
import { getUserSettings, updateUserSettings } from "./users.js";
import { config } from "./config.js";

export async function getSettings(uid) {
  return getUserSettings(uid);
}

export async function updateSettings(uid, patch) {
  const clean = {};
  if (patch.wallpaper === null || typeof patch.wallpaper === "string") {
    clean.wallpaper = patch.wallpaper;
  }
  if (patch.bg === null || (typeof patch.bg === "string" && /^#[0-9a-fA-F]{6}$/.test(patch.bg))) {
    clean.bg = patch.bg ? patch.bg.toLowerCase() : null;
  }
  if (patch.logo === null || typeof patch.logo === "string") {
    clean.logo = patch.logo;
  }
  if (patch.adBanner === null || typeof patch.adBanner === "string") {
    clean.adBanner = patch.adBanner;
  }
  if (typeof patch.streamUrl === "string") {
    const u = patch.streamUrl.trim();
    // file: destinations are for automated tests only
    if (/^rtmps?:\/\/[^\s]+$/.test(u) ||
        (process.env.ALLOW_FILE_STREAM === "1" && u.startsWith("file:"))) {
      clean.streamUrl = u.slice(0, 200);
    }
  }
  if (typeof patch.streamKey === "string") {
    clean.streamKey = patch.streamKey.trim().slice(0, 200);
  }
  // FOSSCast publish API, for pushing finished recordings as episodes
  if (typeof patch.fosscastUrl === "string") {
    const u = patch.fosscastUrl.trim().replace(/\/$/, "");
    if (u === "" || /^https:\/\/[^\s]+$/.test(u) ||
        (process.env.ALLOW_FILE_STREAM === "1" && u.startsWith("http://127.0.0.1"))) {
      clean.fosscastUrl = u.slice(0, 200);
    }
  }
  if (typeof patch.fosscastToken === "string") {
    clean.fosscastToken = patch.fosscastToken.trim().slice(0, 300);
  }
  return updateUserSettings(uid, clean);
}

// ---------- soundboard clips (per user) ----------
// The host uploads short audio clips (laughs, applause, stings) in the
// dashboard and fires them one-click from the in-session soundboard.
export const MAX_SOUNDS = 20;

export async function listSounds(uid) {
  const s = await getUserSettings(uid);
  return Array.isArray(s.sounds) ? s.sounds : [];
}

export async function findSound(uid, id) {
  return (await listSounds(uid)).find((c) => c.id === id) || null;
}

export async function addSound(uid, { name, ext }) {
  const sounds = await listSounds(uid);
  if (sounds.length >= MAX_SOUNDS) {
    throw new Error(`You can keep up to ${MAX_SOUNDS} sounds - remove one first.`);
  }
  const id = crypto.randomBytes(4).toString("hex");
  const clip = { id, name: String(name || "").trim().slice(0, 40) || "Sound", ext };
  await updateUserSettings(uid, { sounds: [...sounds, clip] });
  return clip;
}

export async function removeSound(uid, id) {
  const sounds = await listSounds(uid);
  await updateUserSettings(uid, { sounds: sounds.filter((c) => c.id !== id) });
}

// Fullscreen intro videos: the host fires one and it takes over every
// screen (and the recording/stream), muting everyone until it ends.
export const MAX_INTROS = 5;

export async function listIntros(uid) {
  const s = await getUserSettings(uid);
  return Array.isArray(s.intros) ? s.intros : [];
}

export async function findIntro(uid, id) {
  return (await listIntros(uid)).find((c) => c.id === id) || null;
}

export async function addIntro(uid, { name, ext, durationMs = 0, hasAudio = true }) {
  const intros = await listIntros(uid);
  if (intros.length >= MAX_INTROS) {
    throw new Error(`You can keep up to ${MAX_INTROS} intro videos - remove one first.`);
  }
  const id = crypto.randomBytes(4).toString("hex");
  const clip = {
    id, name: String(name || "").trim().slice(0, 40) || "Intro", ext,
    durationMs: Math.max(0, Math.round(durationMs)), hasAudio: hasAudio !== false
  };
  await updateUserSettings(uid, { intros: [...intros, clip] });
  return clip;
}

export async function removeIntro(uid, id) {
  const intros = await listIntros(uid);
  await updateUserSettings(uid, { intros: intros.filter((c) => c.id !== id) });
}

// ---------- sessions (each belongs to a user) ----------

export async function listSessions(user) {
  const sessions = await readJson("sessions.json", []);
  return user.role === "admin"
    ? sessions
    : sessions.filter((s) => s.ownerId === user.uid);
}

export async function findSession(id) {
  const sessions = await readJson("sessions.json", []);
  return sessions.find((s) => s.id === id) || null;
}

export async function createSession(user, title) {
  const sessions = await readJson("sessions.json", []);
  const session = {
    id: crypto.randomBytes(4).toString("hex"),
    ownerId: user.uid,
    title: String(title || "").trim().slice(0, 80) || "Untitled session",
    createdAt: new Date().toISOString()
  };
  sessions.unshift(session);
  await writeJson("sessions.json", sessions);
  return session;
}


export async function renameSession(user, id, title) {
  const sessions = await readJson("sessions.json", []);
  const session = sessions.find((s) =>
    s.id === id && (s.ownerId === user.uid || user.role === "admin"));
  if (!session) return null;
  session.title = String(title || "").trim().slice(0, 80) || "Untitled session";
  await writeJson("sessions.json", sessions);
  return session;
}

export async function deleteSession(user, id) {
  const sessions = await readJson("sessions.json", []);
  await writeJson("sessions.json", sessions.filter((s) =>
    s.id !== id || (s.ownerId !== user.uid && user.role !== "admin")));
}

// Remove every session belonging to a user (used when the account is deleted)
export async function deleteSessionsByOwner(uid) {
  const sessions = await readJson("sessions.json", []);
  await writeJson("sessions.json", sessions.filter((s) => s.ownerId !== uid));
}
