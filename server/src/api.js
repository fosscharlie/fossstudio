// Host + public HTTP API. Admins see everything; sub-admins see only
// what they own (sessions, recordings, their own settings).
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import {
  tryLogin, setAuthCookie, clearAuthCookie, isAuthedRequest,
  changePassword, get2faState, setup2fa, confirm2fa, disable2fa
} from "./auth.js";
import {
  getSettings, updateSettings, listSessions, createSession, deleteSession, findSession
} from "./settings.js";
import { listUsers, createUser, deleteUser, findById, updateUser } from "./users.js";
import { hashPassword } from "./auth.js";
import { getRoom } from "./rooms.js";
import {
  verifyUploadToken, appendChunk, markPeerDone,
  listRecordings, deleteRecording, recDir
} from "./recording/manager.js";
import {
  recentLogs, makeBackup, listBackups, backupPath,
  restoreBackup, restartApp, streamFullExport
} from "./ops.js";
import { publicKey, addSubscription } from "./push.js";

export const api = express.Router();
api.use(express.json({ limit: "64kb" }));

function requireAuth(req, res, next) {
  const user = isAuthedRequest(req);
  if (!user) return res.status(401).json({ error: "not logged in" });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") return res.status(403).json({ error: "admin only" });
    next();
  });
}

// ---------- auth ----------

api.post("/login", async (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
  const result = await tryLogin(ip, req.body.username, req.body.password, req.body.totp);
  if (!result.ok) return res.status(401).json({ error: result.error });
  setAuthCookie(res, result.user);
  res.json({ ok: true });
});

api.post("/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

api.get("/me", async (req, res) => {
  const payload = isAuthedRequest(req);
  if (!payload) return res.json({ authed: false });
  const user = await findById(payload.uid);
  res.json({ authed: !!user, role: user?.role, username: user?.username });
});

api.post("/password", requireAuth, async (req, res) => {
  const pw = String(req.body.password || "");
  if (pw.length < 10) {
    return res.status(400).json({ error: "Password needs at least 10 characters." });
  }
  await changePassword(req.user.uid, pw);
  res.json({ ok: true });
});

api.get("/2fa", requireAuth, async (req, res) => res.json(await get2faState(req.user.uid)));
api.post("/2fa/setup", requireAuth, async (req, res) => res.json(await setup2fa(req.user.uid)));
api.post("/2fa/enable", requireAuth, async (req, res) => {
  const ok = await confirm2fa(req.user.uid, req.body.code);
  ok ? res.json({ ok: true }) : res.status(400).json({ error: "That code isn't right — check your authenticator app." });
});
api.post("/2fa/disable", requireAuth, async (req, res) => {
  const ok = await disable2fa(req.user.uid, req.body.code);
  ok ? res.json({ ok: true }) : res.status(400).json({ error: "That code isn't right — check your authenticator app." });
});

// ---------- users (admin only) ----------

api.get("/users", requireAdmin, async (req, res) => res.json(await listUsers()));

api.post("/users", requireAdmin, async (req, res) => {
  try {
    res.json(await createUser(
      req.body.username, req.body.password, req.body.role,
      !!req.body.allowServerRecording
    ));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Invite a host by email: they set their own password via the link
api.post("/users/invite", requireAdmin, async (req, res) => {
  try {
    const { createInvitedUser } = await import("./users.js");
    const { sendEmail, getSmtpConfig, isConfigured } = await import("./email.js");
    const user = await createInvitedUser(
      req.body.username, req.body.email, !!req.body.allowServerRecording
    );
    const inviteUrl = `https://${config.domain}/host/invite.html?token=${user.inviteToken}`;
    let emailed = false;
    if (isConfigured(await getSmtpConfig())) {
      try {
        await sendEmail(user.email, "You're invited to host on FOSSStudio", {
          paragraphs: [
            `Hello ${user.username},`,
            "You've been invited to host shows on FOSSStudio — your own sessions, recordings and branding, all ready to go.",
            "Click the button below to choose your password and get started."
          ],
          button: { label: "Choose your password", url: inviteUrl },
          footer: "The link works for 7 days and can only be used once. If it expires, just ask for a fresh invite."
        });
        emailed = true;
      } catch (err) {
        console.error("invite email failed:", err.message);
      }
    }
    res.json({ ok: true, emailed, inviteUrl });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Public: accepting an invite (token is the credential)
api.get("/invite/:token", async (req, res) => {
  const { findByInviteToken } = await import("./users.js");
  const user = await findByInviteToken(req.params.token);
  user
    ? res.json({ username: user.username })
    : res.status(404).json({ error: "This invite link has expired or was already used." });
});

api.post("/invite/accept", async (req, res) => {
  try {
    const { acceptInvite } = await import("./users.js");
    await acceptInvite(String(req.body.token || ""), String(req.body.password || ""));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// SMTP settings (password write-only; never echoed back)
api.get("/smtp", requireAdmin, async (req, res) => {
  const { getSmtpConfig } = await import("./email.js");
  const smtp = await getSmtpConfig();
  res.json({ ...smtp, pass: undefined, hasPass: !!smtp.pass });
});

api.put("/smtp", requireAdmin, async (req, res) => {
  const { saveSmtpConfig } = await import("./email.js");
  const saved = await saveSmtpConfig(req.body || {});
  res.json({ ...saved, pass: undefined, hasPass: !!saved.pass });
});

api.post("/smtp/test", requireAdmin, async (req, res) => {
  try {
    const { sendEmail, getSmtpConfig } = await import("./email.js");
    const smtp = await getSmtpConfig();
    const to = smtp.alertTo || smtp.from || smtp.user;
    if (!to) return res.status(400).json({ error: "Add an alert address first." });
    await sendEmail(to, "FOSSStudio test email", {
      paragraphs: [
        "If you can read this, email is working. 🎙",
        "Host invites and warning emails will arrive looking just like this one."
      ]
    });
    res.json({ ok: true, to });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post("/users/:id/permissions", requireAdmin, async (req, res) => {
  try {
    await updateUser(req.params.id, { allowServerRecording: !!req.body.allowServerRecording });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.delete("/users/:id", requireAdmin, async (req, res) => {
  try {
    await deleteUser(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post("/users/:id/password", requireAdmin, async (req, res) => {
  const pw = String(req.body.password || "");
  if (pw.length < 10) {
    return res.status(400).json({ error: "Password needs at least 10 characters." });
  }
  try {
    await updateUser(req.params.id, { passwordHash: hashPassword(pw) });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- settings & theme ----------

api.get("/settings", requireAuth, async (req, res) => res.json(await getSettings(req.user.uid)));
api.put("/settings", requireAuth, async (req, res) => res.json(await updateSettings(req.user.uid, req.body)));

// Public: what a guest's session page needs, resolved via the room owner
api.get("/theme", async (req, res) => {
  const session = req.query.room ? await findSession(String(req.query.room)) : null;
  const s = await getSettings(session?.ownerId);
  res.json({
    podcastName: s.podcastName,
    accent: s.accent,
    wallpaper: s.wallpaper && session ? `/api/wallpaper/${session.ownerId}` : null
  });
});

// Wallpaper: per-user file, capped size
api.post("/wallpaper", requireAuth,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "8mb" }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "Send a JPEG, PNG, or WebP image." });
    }
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[req.headers["content-type"]];
    const name = `wallpaper-${req.user.uid}.${ext}`;
    const dir = path.join(config.dataDir, "uploads");
    await fs.mkdir(dir, { recursive: true });
    for (const f of await fs.readdir(dir)) {
      if (f.startsWith(`wallpaper-${req.user.uid}.`)) await fs.unlink(path.join(dir, f));
    }
    await fs.writeFile(path.join(dir, name), req.body);
    await updateSettings(req.user.uid, { wallpaper: name });
    res.json({ ok: true });
  });

api.delete("/wallpaper", requireAuth, async (req, res) => {
  const dir = path.join(config.dataDir, "uploads");
  try {
    for (const f of await fs.readdir(dir)) {
      if (f.startsWith(`wallpaper-${req.user.uid}.`)) await fs.unlink(path.join(dir, f));
    }
  } catch { /* nothing uploaded yet */ }
  await updateSettings(req.user.uid, { wallpaper: null });
  res.json({ ok: true });
});

api.get("/wallpaper/:uid", async (req, res) => {
  const s = await getSettings(path.basename(req.params.uid));
  if (!s.wallpaper) return res.status(404).end();
  res.sendFile(path.join(config.dataDir, "uploads", path.basename(s.wallpaper)));
});

// The dashboard preview uses the logged-in user's own wallpaper
api.get("/wallpaper", requireAuth, async (req, res) => {
  const s = await getSettings(req.user.uid);
  if (!s.wallpaper) return res.status(404).end();
  res.sendFile(path.join(config.dataDir, "uploads", path.basename(s.wallpaper)));
});

// Advertising banner for stream overlays: per-user image
api.post("/adbanner", requireAuth,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "4mb" }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "Send a JPEG, PNG, or WebP image." });
    }
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[req.headers["content-type"]];
    const name = `ad-${req.user.uid}.${ext}`;
    const dir = path.join(config.dataDir, "uploads");
    await fs.mkdir(dir, { recursive: true });
    for (const f of await fs.readdir(dir)) {
      if (f.startsWith(`ad-${req.user.uid}.`)) await fs.unlink(path.join(dir, f));
    }
    await fs.writeFile(path.join(dir, name), req.body);
    await updateSettings(req.user.uid, { adBanner: name });
    res.json({ ok: true });
  });

api.delete("/adbanner", requireAuth, async (req, res) => {
  const dir = path.join(config.dataDir, "uploads");
  try {
    for (const f of await fs.readdir(dir)) {
      if (f.startsWith(`ad-${req.user.uid}.`)) await fs.unlink(path.join(dir, f));
    }
  } catch { /* nothing uploaded yet */ }
  await updateSettings(req.user.uid, { adBanner: null });
  res.json({ ok: true });
});

api.get("/adbanner/:uid", async (req, res) => {
  const s = await getSettings(path.basename(req.params.uid));
  if (!s.adBanner) return res.status(404).end();
  res.sendFile(path.join(config.dataDir, "uploads", path.basename(s.adBanner)));
});

api.get("/adbanner", requireAuth, async (req, res) => {
  const s = await getSettings(req.user.uid);
  if (!s.adBanner) return res.status(404).end();
  res.sendFile(path.join(config.dataDir, "uploads", path.basename(s.adBanner)));
});

// ---------- sessions ----------

api.get("/sessions", requireAuth, async (req, res) => {
  const sessions = await listSessions(req.user);
  res.json(sessions.map((s) => ({
    ...s,
    live: !!getRoom(s.id),
    participants: getRoom(s.id)?.peers.size || 0
  })));
});

api.post("/sessions", requireAuth, async (req, res) => {
  if (req.user.role === "admin") {
    return res.status(403).json({ error: "Admins manage hosts; sessions belong to host accounts." });
  }
  res.json(await createSession(req.user, req.body.title));
});

api.delete("/sessions/:id", requireAuth, async (req, res) => {
  await deleteSession(req.user, req.params.id);
  res.json({ ok: true });
});

// ---------- recording ----------

function chunkAuth(req, res, next) {
  const { rec, peer, token } = req.query;
  if (!rec || !peer || !verifyUploadToken(String(rec), String(peer), String(token))) {
    return res.status(403).json({ error: "bad upload token" });
  }
  next();
}

api.post("/rec/chunk", chunkAuth,
  express.raw({ type: () => true, limit: "32mb" }),
  async (req, res) => {
    try {
      await appendChunk(
        String(req.query.rec), String(req.query.peer),
        String(req.query.kind), Number(req.query.seq), req.body
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

api.post("/rec/done", chunkAuth, (req, res) => {
  markPeerDone(String(req.query.rec), String(req.query.peer));
  res.json({ ok: true });
});

async function recAccess(req, id) {
  const recs = await listRecordings();
  const rec = recs.find((r) => r.id === id);
  if (!rec) return null;
  if (req.user.role !== "admin" && rec.ownerId !== req.user.uid) return null;
  return rec;
}

api.get("/recordings", requireAuth, async (req, res) => {
  const recs = await listRecordings();
  res.json(req.user.role === "admin"
    ? recs
    : recs.filter((r) => r.ownerId === req.user.uid));
});

api.get("/recordings/:id/files/:file", requireAuth, async (req, res) => {
  const id = path.basename(req.params.id);
  if (!await recAccess(req, id)) return res.status(404).json({ error: "not found" });
  const file = path.basename(req.params.file);
  res.download(path.join(recDir(id), "out", file), file, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "file not found" });
  });
});

api.delete("/recordings/:id", requireAuth, async (req, res) => {
  const id = path.basename(req.params.id);
  if (!await recAccess(req, id)) return res.status(404).json({ error: "not found" });
  await deleteRecording(id);
  res.json({ ok: true });
});

// ---------- ops: admin only ----------

api.get("/ops/logs", requireAdmin, (req, res) => {
  res.json({ lines: recentLogs() });
});

api.post("/ops/backup", requireAdmin, async (req, res) => {
  res.json({ name: await makeBackup() });
});

api.get("/ops/backups", requireAdmin, async (req, res) => {
  res.json(await listBackups());
});

api.get("/ops/backups/:name", requireAdmin, (req, res) => {
  const name = path.basename(req.params.name);
  res.download(backupPath(name), name, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "backup not found" });
  });
});

api.post("/ops/restore", requireAdmin, async (req, res) => {
  try {
    await restoreBackup(String(req.body.name || ""));
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: "Couldn't restore that backup." });
  }
});

api.post("/ops/restart", requireAdmin, (req, res) => {
  res.json({ ok: true });
  restartApp();
});

api.get("/ops/export", requireAdmin, (req, res) => {
  streamFullExport(res);
});

// ---------- push notifications (per user) ----------

api.get("/push/key", requireAuth, (req, res) => {
  res.json({ key: publicKey() });
});

api.post("/push/subscribe", requireAuth, async (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint || !sub?.keys) return res.status(400).json({ error: "bad subscription" });
  await addSubscription(req.user.uid, sub);
  res.json({ ok: true });
});
