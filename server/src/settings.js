// Studio settings: theme, banner, sessions list. All flat JSON.
import crypto from "node:crypto";
import { readJson, writeJson } from "./storage.js";

const DEFAULTS = {
  podcastName: "FOSSStudio",
  accent: "#fbc711",
  wallpaper: null,          // filename inside data/uploads, or null
  autoGain: false,
  recordingMode: "browser"  // "browser" (each guest records) | "server" (small sessions)
};

export async function getSettings() {
  return { ...DEFAULTS, ...(await readJson("settings.json", {})) };
}

export async function updateSettings(patch) {
  const clean = {};
  if (typeof patch.podcastName === "string") {
    clean.podcastName = patch.podcastName.trim().slice(0, 80) || DEFAULTS.podcastName;
  }
  if (typeof patch.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(patch.accent)) {
    clean.accent = patch.accent.toLowerCase();
  }
  if (patch.wallpaper === null || typeof patch.wallpaper === "string") {
    clean.wallpaper = patch.wallpaper;
  }
  if (typeof patch.autoGain === "boolean") clean.autoGain = patch.autoGain;
  if (["browser", "server"].includes(patch.recordingMode)) {
    clean.recordingMode = patch.recordingMode;
  }
  const next = { ...(await getSettings()), ...clean };
  await writeJson("settings.json", next);
  return next;
}

// ---------- saved sessions (the links the host hands out) ----------

export async function listSessions() {
  return readJson("sessions.json", []);
}

export async function createSession(title) {
  const sessions = await listSessions();
  const words = crypto.randomBytes(4).toString("hex");
  const session = {
    id: words,
    title: String(title || "").trim().slice(0, 80) || "Untitled session",
    createdAt: new Date().toISOString()
  };
  sessions.unshift(session);
  await writeJson("sessions.json", sessions);
  return session;
}

export async function deleteSession(id) {
  const sessions = await listSessions();
  await writeJson("sessions.json", sessions.filter((s) => s.id !== id));
}
