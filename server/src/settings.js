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
  if (typeof patch.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(patch.accent)) {
    clean.accent = patch.accent.toLowerCase();
  }
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
  return updateUserSettings(uid, clean);
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


export async function deleteSession(user, id) {
  const sessions = await readJson("sessions.json", []);
  await writeJson("sessions.json", sessions.filter((s) =>
    s.id !== id || (s.ownerId !== user.uid && user.role !== "admin")));
}
