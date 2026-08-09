// Host + public HTTP API. Admins see everything; sub-admins see only
// what they own (sessions, recordings, their own settings).
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config } from "./config.js";
import {
  tryLogin, setAuthCookie, clearAuthCookie, isAuthedRequest,
  changePassword, get2faState, setup2fa, confirm2fa, disable2fa
} from "./auth.js";
import {
  getSettings, updateSettings, listSessions, createSession, deleteSession, findSession,
  deleteSessionsByOwner,
  listSounds, addSound, removeSound, findSound,
  listIntros, addIntro, removeIntro, findIntro
} from "./settings.js";
import { listUsers, createUser, deleteUser, findById, updateUser, findByUsername } from "./users.js";
import { hashPassword } from "./auth.js";
import { getRoom } from "./rooms.js";
import {
  verifyUploadToken, appendChunk, markPeerDone,
  listRecordings, deleteRecording, deleteRecordingFile, recDir
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
  res.json({ authed: !!user, uid: user?.id, role: user?.role, username: user?.username });
});

// Rename your own account (the login name). The session cookie is keyed on
// the user id, not the name, so a rename never logs you out.
api.post("/username", requireAuth, async (req, res) => {
  const name = String(req.body.username || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,24}$/.test(name)) {
    return res.status(400).json({ error: "Names are 2-24 characters: lowercase letters, numbers, - or _." });
  }
  const existing = await findByUsername(name);
  if (existing && existing.id !== req.user.uid) {
    return res.status(400).json({ error: "That name is taken." });
  }
  await updateUser(req.user.uid, { username: name });
  res.json({ ok: true, username: name });
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
  ok ? res.json({ ok: true }) : res.status(400).json({ error: "That code isn't right - check your authenticator app." });
});
api.post("/2fa/disable", requireAuth, async (req, res) => {
  const ok = await disable2fa(req.user.uid, req.body.code);
  ok ? res.json({ ok: true }) : res.status(400).json({ error: "That code isn't right - check your authenticator app." });
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
            "You've been invited to host shows on FOSSStudio - your own sessions, recordings and branding, all ready to go.",
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
    const uid = String(req.params.id);
    // deleteUser enforces the "can't delete the only admin" rule and
    // removes the account first; if it throws, nothing below runs.
    await deleteUser(uid);
    // Complete deletion for privacy: purge everything the user owned -
    // recordings (and their files), sessions, uploaded media, push subs.
    for (const rec of (await listRecordings()).filter((r) => r.ownerId === uid)) {
      await deleteRecording(rec.id);
    }
    await deleteSessionsByOwner(uid);
    const udir = path.join(config.dataDir, "uploads");
    try {
      for (const f of await fs.readdir(udir)) {
        // wallpaper-/logo-/ad-/sound-/intro- files all embed the owner uid
        if (f.includes(uid)) await fs.unlink(path.join(udir, f)).catch(() => {});
      }
    } catch { /* no uploads dir */ }
    const { removeUserSubscriptions } = await import("./push.js");
    await removeUserSubscriptions(uid);
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
  const title = String(req.body.title || "").trim();
  if (!title) return res.status(400).json({ error: "Give the episode a title - it names the session and its recordings." });
  res.json(await createSession(req.user, title));
});

api.delete("/sessions/:id", requireAuth, async (req, res) => {
  await deleteSession(req.user, req.params.id);
  res.json({ ok: true });
});

// Podcast logo (part of the theme): shown above the episode title on
// the video and baked into recordings/streams
api.post("/logo", requireAuth,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "2mb" }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "Send a JPEG, PNG, or WebP image." });
    }
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[req.headers["content-type"]];
    const name = `logo-${req.user.uid}.${ext}`;
    const dir = path.join(config.dataDir, "uploads");
    await fs.mkdir(dir, { recursive: true });
    for (const f of await fs.readdir(dir)) {
      if (f.startsWith(`logo-${req.user.uid}.`)) await fs.unlink(path.join(dir, f));
    }
    await fs.writeFile(path.join(dir, name), req.body);
    await updateSettings(req.user.uid, { logo: name });
    res.json({ ok: true });
  });

api.delete("/logo", requireAuth, async (req, res) => {
  const dir = path.join(config.dataDir, "uploads");
  try {
    for (const f of await fs.readdir(dir)) {
      if (f.startsWith(`logo-${req.user.uid}.`)) await fs.unlink(path.join(dir, f));
    }
  } catch { /* nothing uploaded yet */ }
  await updateSettings(req.user.uid, { logo: null });
  res.json({ ok: true });
});

// Public: guests need the logo inside the session view
api.get("/logo/:uid", async (req, res) => {
  const s = await getSettings(path.basename(req.params.uid));
  if (!s.logo) return res.status(404).end();
  res.sendFile(path.join(config.dataDir, "uploads", path.basename(s.logo)));
});

// The dashboard preview uses the logged-in user's own logo
api.get("/logo", requireAuth, async (req, res) => {
  const s = await getSettings(req.user.uid);
  if (!s.logo) return res.status(404).end();
  res.sendFile(path.join(config.dataDir, "uploads", path.basename(s.logo)));
});

// ---------- soundboard clips ----------
// Short audio the host fires one-click from the in-session soundboard.
const SOUND_TYPES = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a",
  "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/x-aac": "aac",
  "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav",
  "audio/wave": "wav", "audio/flac": "flac", "audio/x-flac": "flac",
  "audio/webm": "webm"
};

api.get("/sounds", requireAuth, async (req, res) => res.json(await listSounds(req.user.uid)));

api.post("/sounds", requireAuth,
  express.raw({ type: Object.keys(SOUND_TYPES), limit: "5mb" }),
  async (req, res) => {
    const ext = SOUND_TYPES[req.headers["content-type"]];
    if (!ext) return res.status(400).json({ error: "Send an MP3, WAV, OGG, AAC, M4A or WebM audio file." });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "That file was empty." });
    }
    try {
      const clip = await addSound(req.user.uid, { name: req.query.name, ext });
      const dir = path.join(config.dataDir, "uploads");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `sound-${req.user.uid}-${clip.id}.${ext}`), req.body);
      res.json(clip);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

api.delete("/sounds/:id", requireAuth, async (req, res) => {
  const id = path.basename(req.params.id);
  const clip = await findSound(req.user.uid, id);
  if (clip) {
    await removeSound(req.user.uid, id);
    await fs.unlink(path.join(config.dataDir, "uploads",
      `sound-${req.user.uid}-${clip.id}.${clip.ext}`)).catch(() => {});
  }
  res.json({ ok: true });
});

// The host's session page fetches the clip audio to play it. Resolved
// via the room owner, like the logo - the clip itself isn't sensitive.
api.get("/sounds/:uid/:id", async (req, res) => {
  const uid = path.basename(req.params.uid);
  const id = path.basename(req.params.id);
  const clip = await findSound(uid, id);
  if (!clip) return res.status(404).end();
  res.sendFile(path.join(config.dataDir, "uploads", `sound-${uid}-${clip.id}.${clip.ext}`));
});

// ---------- intro videos ----------
// Fullscreen takeovers the host fires between segments.
const VIDEO_TYPES = { "video/mp4": "mp4", "video/webm": "webm" };

// Probe length + whether there's an audio track, so the stream and the
// recording know the window and never render a missing [0:a].
function probeMedia(file) {
  return new Promise((resolve) => {
    let out = "";
    const p = spawn("ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
    p.stdout.on("data", (d) => { out += d; });
    p.on("error", () => resolve({ durationMs: 0, hasAudio: true }));
    p.on("close", () => {
      try {
        const j = JSON.parse(out);
        resolve({
          durationMs: Math.round(parseFloat(j.format?.duration || 0) * 1000) || 0,
          hasAudio: (j.streams || []).some((s) => s.codec_type === "audio")
        });
      } catch { resolve({ durationMs: 0, hasAudio: true }); }
    });
  });
}

api.get("/intros", requireAuth, async (req, res) => res.json(await listIntros(req.user.uid)));

api.post("/intros", requireAuth,
  express.raw({ type: Object.keys(VIDEO_TYPES), limit: "80mb" }),
  async (req, res) => {
    const ext = VIDEO_TYPES[req.headers["content-type"]];
    if (!ext) return res.status(400).json({ error: "Send an MP4 or WebM video." });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "That file was empty." });
    }
    const dir = path.join(config.dataDir, "uploads");
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `intro-tmp-${req.user.uid}-${Date.now()}.${ext}`);
    try {
      await fs.writeFile(tmp, req.body);
      const { durationMs, hasAudio } = await probeMedia(tmp);
      const clip = await addIntro(req.user.uid, { name: req.query.name, ext, durationMs, hasAudio });
      await fs.rename(tmp, path.join(dir, `intro-${req.user.uid}-${clip.id}.${ext}`));
      res.json(clip);
    } catch (err) {
      await fs.unlink(tmp).catch(() => {});
      res.status(400).json({ error: err.message });
    }
  });

api.delete("/intros/:id", requireAuth, async (req, res) => {
  const id = path.basename(req.params.id);
  const clip = await findIntro(req.user.uid, id);
  if (clip) {
    await removeIntro(req.user.uid, id);
    await fs.unlink(path.join(config.dataDir, "uploads",
      `intro-${req.user.uid}-${clip.id}.${clip.ext}`)).catch(() => {});
  }
  res.json({ ok: true });
});

// Everyone's session page fetches the intro to play it fullscreen.
api.get("/intros/:uid/:id", async (req, res) => {
  const uid = path.basename(req.params.uid);
  const id = path.basename(req.params.id);
  const clip = await findIntro(uid, id);
  if (!clip) return res.status(404).end();
  res.sendFile(path.join(config.dataDir, "uploads", `intro-${uid}-${clip.id}.${clip.ext}`));
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

// Delete a single file within a recording (one FLAC or the MP4)
api.delete("/recordings/:id/files/:file", requireAuth, async (req, res) => {
  const id = path.basename(req.params.id);
  if (!await recAccess(req, id)) return res.status(404).json({ error: "not found" });
  await deleteRecordingFile(id, path.basename(req.params.file));
  res.json({ ok: true });
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
