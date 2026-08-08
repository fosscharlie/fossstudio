// User accounts: one admin plus any number of sub-admins. Each user
// carries their own settings (theme, stream key, recording mode), so
// several shows can share the server without sharing anything else.
import crypto from "node:crypto";
import { readJson, writeJson } from "./storage.js";
import { hashPassword } from "./auth.js";
import { config } from "./config.js";

export const USER_SETTINGS_DEFAULTS = {
  wallpaper: null,
  bg: null,
  logo: null,
  streamUrl: "rtmp://a.rtmp.youtube.com/live2",
  streamKey: "",
  sounds: [],  // soundboard clips: [{ id, name, ext }]
  intros: []   // fullscreen intro videos: [{ id, name, ext }]
};

let cache = null;

async function load() {
  if (cache) return cache;
  let users = await readJson("users.json");
  if (!users) {
    // Migrate from the single-user era: auth.json + settings.json
    const legacyAuth = await readJson("auth.json");
    const legacySettings = await readJson("settings.json", {});
    users = [{
      id: crypto.randomUUID(),
      username: "admin",
      role: "admin",
      passwordHash: legacyAuth?.passwordHash || hashPassword(config.hostPassword),
      totpEnabled: legacyAuth?.totpEnabled || false,
      totpSecret: legacyAuth?.totpSecret || null,
      settings: { ...USER_SETTINGS_DEFAULTS, ...legacySettings }
    }];
    await writeJson("users.json", users);
    // Old sessions predate ownership — they belong to the admin now
    const sessions = await readJson("sessions.json", []);
    if (sessions.some((s) => !s.ownerId)) {
      for (const s of sessions) s.ownerId = s.ownerId || users[0].id;
      await writeJson("sessions.json", sessions);
    }
    console.log("migrated single-user auth to users.json (username: admin)");
  }
  cache = users;
  return users;
}

async function persist() {
  await writeJson("users.json", cache);
}

export async function findByUsername(username) {
  const users = await load();
  return users.find((u) => u.username.toLowerCase() === String(username).toLowerCase().trim()) || null;
}

export async function findById(id) {
  const users = await load();
  return users.find((u) => u.id === id) || null;
}

export async function listUsers() {
  const users = await load();
  return users.map((u) => ({
    id: u.id, username: u.username, role: u.role,
    totpEnabled: u.totpEnabled,
    allowServerRecording: !!u.allowServerRecording,
    invited: !u.passwordHash
  }));
}

export async function createUser(username, password, role = "subadmin", allowServerRecording = false) {
  const users = await load();
  const name = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,24}$/.test(name)) {
    throw new Error("Usernames are 2-24 characters: letters, numbers, - or _.");
  }
  if (users.some((u) => u.username.toLowerCase() === name)) {
    throw new Error("That username is taken.");
  }
  if (String(password).length < 10) {
    throw new Error("Password needs at least 10 characters.");
  }
  const user = {
    id: crypto.randomUUID(),
    username: name,
    role: role === "admin" ? "admin" : "subadmin",
    allowServerRecording: !!allowServerRecording,
    passwordHash: hashPassword(password),
    totpEnabled: false,
    totpSecret: null,
    settings: { ...USER_SETTINGS_DEFAULTS }
  };
  users.push(user);
  await persist();
  return { id: user.id, username: user.username, role: user.role };
}

// ---------- email invitations ----------
// The admin enters a username + email; the new host follows an emailed
// link and picks their own password. No password ever changes hands.

export async function createInvitedUser(username, email, allowServerRecording) {
  const users = await load();
  const name = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,24}$/.test(name)) {
    throw new Error("Usernames are 2-24 characters: letters, numbers, - or _.");
  }
  if (users.some((u) => u.username.toLowerCase() === name)) {
    throw new Error("That username is taken.");
  }
  const addr = String(email).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
    throw new Error("That email address doesn't look right.");
  }
  const user = {
    id: crypto.randomUUID(),
    username: name,
    email: addr,
    role: "subadmin",
    allowServerRecording: !!allowServerRecording,
    passwordHash: null, // can't log in until the invite is accepted
    inviteToken: crypto.randomBytes(24).toString("base64url"),
    inviteExpires: Date.now() + 7 * 24 * 3600 * 1000,
    totpEnabled: false,
    totpSecret: null,
    settings: { ...USER_SETTINGS_DEFAULTS }
  };
  users.push(user);
  await persist();
  return user;
}

export async function findByInviteToken(token) {
  if (!token) return null;
  const users = await load();
  const user = users.find((u) => u.inviteToken === token);
  if (!user || user.inviteExpires < Date.now()) return null;
  return user;
}

export async function acceptInvite(token, password) {
  const user = await findByInviteToken(token);
  if (!user) throw new Error("This invite link has expired or was already used.");
  if (String(password).length < 10) {
    throw new Error("Password needs at least 10 characters.");
  }
  user.passwordHash = hashPassword(password);
  user.inviteToken = null;
  user.inviteExpires = null;
  await persist();
  return user;
}

export async function deleteUser(id) {
  const users = await load();
  const user = users.find((u) => u.id === id);
  if (!user) return;
  if (user.role === "admin" && users.filter((u) => u.role === "admin").length === 1) {
    throw new Error("Can't delete the only admin.");
  }
  cache = users.filter((u) => u.id !== id);
  await persist();
}

export async function updateUser(id, patch) {
  const user = await findById(id);
  if (!user) throw new Error("no such user");
  Object.assign(user, patch);
  await persist();
  return user;
}

export async function getUserSettings(id) {
  const user = await findById(id);
  return { ...USER_SETTINGS_DEFAULTS, ...(user?.settings || {}) };
}

export async function updateUserSettings(id, clean) {
  const user = await findById(id);
  if (!user) throw new Error("no such user");
  user.settings = { ...USER_SETTINGS_DEFAULTS, ...user.settings, ...clean };
  await persist();
  return user.settings;
}
