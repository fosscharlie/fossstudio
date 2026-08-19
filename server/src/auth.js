// Authentication: scrypt password hashing, HMAC-signed session cookies
// carrying {uid, role}, optional per-user TOTP. Only node:crypto.
import crypto from "node:crypto";
import { config } from "./config.js";

// Two separate cookies, so an admin session and a host session can
// coexist in one browser: the fleet panel stays open while the same
// person signs into a host dashboard in the next tab.
const COOKIES = { host: "fs_host", admin: "fs_admin" };
const SESSION_HOURS = 24 * 7;

// ---------- password ----------

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), check);
}

// ---------- session tokens (stateless, HMAC-signed) ----------

function sign(data) {
  return crypto.createHmac("sha256", config.sessionSecret).update(data).digest("base64url");
}

export function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({
    uid: user.id,
    role: user.role,
    exp: Date.now() + SESSION_HOURS * 3600 * 1000
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}

function cookieValue(req, name) {
  const raw = req.headers.cookie || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

// Returns {uid, role} or null. `prefer` picks which session to answer
// with when both cookies are present: "admin" and "host" look only at
// that session (each panel names itself via the X-Panel header), the
// default tries host first then admin - shared surfaces like chat
// moderation accept either.
export function isAuthedRequest(req, prefer = "any") {
  const host = () => {
    const t = verifyToken(cookieValue(req, COOKIES.host));
    return t && t.role !== "admin" ? t : null;
  };
  const admin = () => {
    const t = verifyToken(cookieValue(req, COOKIES.admin));
    return t && t.role === "admin" ? t : null;
  };
  if (prefer === "admin") return admin();
  if (prefer === "host") return host();
  return host() || admin();
}

export function setAuthCookie(res, user) {
  const name = user.role === "admin" ? COOKIES.admin : COOKIES.host;
  res.setHeader("Set-Cookie",
    `${name}=${makeToken(user)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`);
}

// Clears one panel's session ("admin"/"host"), or both by default -
// logging out of the dashboard never touches the other panel's tab.
export function clearAuthCookie(res, which = "both") {
  const gone = (name) => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  const names = which === "admin" ? [COOKIES.admin]
    : which === "host" ? [COOKIES.host]
    : [COOKIES.host, COOKIES.admin];
  res.setHeader("Set-Cookie", names.map(gone));
}

// ---------- TOTP (RFC 6238, standard authenticator apps) ----------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of str.replace(/=+$/, "").toUpperCase()) {
    const idx = B32.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totpCode(secretB32, timeStep = Math.floor(Date.now() / 30000)) {
  const key = base32Decode(secretB32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(timeStep));
  const h = crypto.createHmac("sha1", key).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24 | h[off + 1] << 16 | h[off + 2] << 8 | h[off + 3]) % 1_000_000;
  return String(code).padStart(6, "0");
}

export function verifyTotp(secretB32, code) {
  const step = Math.floor(Date.now() / 30000);
  // Accept the neighbouring steps to allow for clock drift
  return [step - 1, step, step + 1].some((s) => totpCode(secretB32, s) === String(code).trim());
}

// ---------- login with rate limiting ----------

const attempts = new Map(); // ip -> {count, until}
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

export async function tryLogin(ip, username, password, totp) {
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) {
    return { ok: false, error: "Too many attempts. Try again in 15 minutes." };
  }
  const { findByUsername } = await import("./users.js");
  const user = await findByUsername(username || "");
  // Invited users have no password until they accept their invite
  const passOk = user?.passwordHash ? verifyPassword(password || "", user.passwordHash) : false;
  const totpOk = user
    ? (!user.totpEnabled || (user.totpSecret && verifyTotp(user.totpSecret, totp || "")))
    : false;
  if (user && passOk && totpOk) {
    attempts.delete(ip);
    return { ok: true, user };
  }
  const next = { count: (a?.count || 0) + 1, until: 0 };
  if (next.count >= MAX_ATTEMPTS) { next.until = Date.now() + LOCK_MS; next.count = 0; }
  attempts.set(ip, next);
  return {
    ok: false,
    error: user && passOk && user.totpEnabled
      ? "That 2FA code isn't right."
      : "Wrong username or password."
  };
}

// ---------- per-user credential management ----------

export async function changePassword(uid, newPassword) {
  const { updateUser } = await import("./users.js");
  await updateUser(uid, { passwordHash: hashPassword(newPassword) });
}

export async function get2faState(uid) {
  const { findById } = await import("./users.js");
  const user = await findById(uid);
  return { enabled: !!user?.totpEnabled };
}

export async function setup2fa(uid) {
  const { updateUser } = await import("./users.js");
  const secret = base32Encode(crypto.randomBytes(20));
  await updateUser(uid, { totpSecret: secret, totpEnabled: false });
  return {
    secret,
    otpauth: `otpauth://totp/FOSSStudio?secret=${secret}&issuer=FOSSStudio`
  };
}

export async function confirm2fa(uid, code) {
  const { findById, updateUser } = await import("./users.js");
  const user = await findById(uid);
  if (!user?.totpSecret || !verifyTotp(user.totpSecret, code)) return false;
  await updateUser(uid, { totpEnabled: true });
  return true;
}

export async function disable2fa(uid, code) {
  const { findById, updateUser } = await import("./users.js");
  const user = await findById(uid);
  if (!user?.totpEnabled) return true;
  if (!verifyTotp(user.totpSecret, code)) return false;
  await updateUser(uid, { totpEnabled: false, totpSecret: null });
  return true;
}
