// Host + public HTTP API.
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import {
  tryLogin, setAuthCookie, clearAuthCookie, isAuthedRequest,
  changePassword, get2faState, setup2fa, confirm2fa, disable2fa
} from "./auth.js";
import { getSettings, updateSettings, listSessions, createSession, deleteSession } from "./settings.js";
import { getRoom } from "./rooms.js";

export const api = express.Router();
api.use(express.json({ limit: "64kb" }));

function requireAuth(req, res, next) {
  if (!isAuthedRequest(req)) return res.status(401).json({ error: "not logged in" });
  next();
}

// ---------- auth ----------

api.post("/login", async (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
  const result = await tryLogin(ip, req.body.password, req.body.totp);
  if (!result.ok) return res.status(401).json({ error: result.error });
  setAuthCookie(res);
  res.json({ ok: true });
});

api.post("/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

api.get("/me", (req, res) => {
  res.json({ authed: isAuthedRequest(req) });
});

api.post("/password", requireAuth, async (req, res) => {
  const pw = String(req.body.password || "");
  if (pw.length < 10) {
    return res.status(400).json({ error: "Password needs at least 10 characters." });
  }
  await changePassword(pw);
  res.json({ ok: true });
});

api.get("/2fa", requireAuth, async (req, res) => res.json(await get2faState()));
api.post("/2fa/setup", requireAuth, async (req, res) => res.json(await setup2fa()));
api.post("/2fa/enable", requireAuth, async (req, res) => {
  const ok = await confirm2fa(req.body.code);
  ok ? res.json({ ok: true }) : res.status(400).json({ error: "That code isn't right — check your authenticator app." });
});
api.post("/2fa/disable", requireAuth, async (req, res) => {
  const ok = await disable2fa(req.body.code);
  ok ? res.json({ ok: true }) : res.status(400).json({ error: "That code isn't right — check your authenticator app." });
});

// ---------- settings & theme ----------

api.get("/settings", requireAuth, async (req, res) => res.json(await getSettings()));
api.put("/settings", requireAuth, async (req, res) => res.json(await updateSettings(req.body)));

// Public: what the guest session page needs to draw itself
api.get("/theme", async (req, res) => {
  const s = await getSettings();
  res.json({
    podcastName: s.podcastName,
    accent: s.accent,
    wallpaper: s.wallpaper ? "/api/wallpaper" : null,
    autoGain: s.autoGain
  });
});

// Wallpaper upload: raw image body, capped size
api.post("/wallpaper", requireAuth,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "8mb" }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "Send a JPEG, PNG, or WebP image." });
    }
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[req.headers["content-type"]];
    const name = `wallpaper.${ext}`;
    const dir = path.join(config.dataDir, "uploads");
    await fs.mkdir(dir, { recursive: true });
    // Remove any previous wallpaper so only one exists
    for (const f of await fs.readdir(dir)) {
      if (f.startsWith("wallpaper.")) await fs.unlink(path.join(dir, f));
    }
    await fs.writeFile(path.join(dir, name), req.body);
    await updateSettings({ wallpaper: name });
    res.json({ ok: true });
  });

api.delete("/wallpaper", requireAuth, async (req, res) => {
  const dir = path.join(config.dataDir, "uploads");
  try {
    for (const f of await fs.readdir(dir)) {
      if (f.startsWith("wallpaper.")) await fs.unlink(path.join(dir, f));
    }
  } catch { /* nothing uploaded yet */ }
  await updateSettings({ wallpaper: null });
  res.json({ ok: true });
});

api.get("/wallpaper", async (req, res) => {
  const s = await getSettings();
  if (!s.wallpaper) return res.status(404).end();
  res.sendFile(path.join(config.dataDir, "uploads", path.basename(s.wallpaper)));
});

// ---------- sessions ----------

api.get("/sessions", requireAuth, async (req, res) => {
  const sessions = await listSessions();
  res.json(sessions.map((s) => ({
    ...s,
    live: !!getRoom(s.id),
    participants: getRoom(s.id)?.peers.size || 0
  })));
});

api.post("/sessions", requireAuth, async (req, res) => {
  res.json(await createSession(req.body.title));
});

api.delete("/sessions/:id", requireAuth, async (req, res) => {
  await deleteSession(req.params.id);
  res.json({ ok: true });
});
