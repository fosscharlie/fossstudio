// Operations: in-app log buffer, backups, restore, restart, alerts.
// Everything a host needs day-to-day without touching a terminal.
import { spawn, execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
import { config } from "./config.js";

// ---------- log ring buffer ----------
// Keeps the last 500 log lines in memory so the dashboard can show
// them without needing docker access.

const LOG_MAX = 500;
const logLines = [];

function capture(kind, original) {
  return (...args) => {
    const line = `${new Date().toISOString()} [${kind}] ${args.map(String).join(" ")}`;
    logLines.push(line);
    if (logLines.length > LOG_MAX) logLines.shift();
    original(...args);
  };
}
console.log = capture("info", console.log.bind(console));
console.error = capture("error", console.error.bind(console));

export function recentLogs() {
  return logLines;
}

// ---------- backups ----------
// A backup is a tar.gz of everything except the recordings' media files
// (those are large; they're downloadable/deletable from the dashboard).

const backupDir = () => path.join(config.dataDir, "backups");

export async function makeBackup() {
  await fs.mkdir(backupDir(), { recursive: true });
  const name = `backup-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.tar.gz`;
  const file = path.join(backupDir(), name);
  await new Promise((resolve, reject) => {
    execFile("tar", [
      "-czf", file,
      "-C", config.dataDir,
      "--exclude", "./backups",
      "--exclude", "./recordings",
      "."
    ], (err) => (err ? reject(err) : resolve()));
  });
  // Rotate: keep the newest 14
  const all = (await fs.readdir(backupDir())).filter((f) => f.startsWith("backup-")).sort().reverse();
  for (const old of all.slice(14)) await fs.unlink(path.join(backupDir(), old));
  console.log(`backup created: ${name}`);
  return name;
}

export async function listBackups() {
  try {
    const files = (await fs.readdir(backupDir())).filter((f) => f.startsWith("backup-")).sort().reverse();
    return Promise.all(files.map(async (f) => ({
      name: f,
      size: (await fs.stat(path.join(backupDir(), f))).size
    })));
  } catch { return []; }
}

export function backupPath(name) {
  return path.join(backupDir(), path.basename(name));
}

export async function restoreBackup(name) {
  const file = backupPath(name);
  await fs.access(file);
  await new Promise((resolve, reject) => {
    execFile("tar", ["-xzf", file, "-C", config.dataDir], (err) =>
      (err ? reject(err) : resolve()));
  });
  console.log(`backup restored: ${name}`);
}

export function scheduleDailyBackups() {
  const run = () => makeBackup().catch((e) => console.error("daily backup failed:", e.message));
  // First backup shortly after boot, then every 24h
  setTimeout(run, 60_000);
  setInterval(run, 24 * 3600 * 1000);
}

// ---------- export everything ----------

export function streamFullExport(res) {
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", 'attachment; filename="fossstudio-export.tar.gz"');
  const tar = spawn("tar", ["-czf", "-", "-C", config.dataDir, "."]);
  tar.stdout.pipe(res);
  tar.on("error", () => res.end());
}

// ---------- restart ----------
// Exiting cleanly lets Docker's restart policy bring the app back.

export function restartApp() {
  console.log("restart requested from dashboard");
  setTimeout(() => process.exit(0), 300);
}

// ---------- email alerts (plain SMTP, no provider lock-in) ----------
// Minimal SMTP client for alert mail; avoids a dependency for one job.

let lastAlertAt = 0;

export async function sendAlertEmail(subject, body) {
  const { host, port, user, pass, from, alertTo } = config.smtp;
  if (!host || !alertTo) return false; // not configured yet
  if (Date.now() - lastAlertAt < 10 * 60 * 1000) return false; // max one per 10 min
  lastAlertAt = Date.now();

  const read = (sock) => new Promise((resolve) => sock.once("data", (d) => resolve(d.toString())));
  const send = async (sock, line) => { sock.write(line + "\r\n"); return read(sock); };

  let sock = net.connect(port, host);
  await new Promise((r, j) => { sock.once("connect", r); sock.once("error", j); });
  await read(sock); // greeting
  await send(sock, `EHLO ${config.domain}`);
  const upgraded = await send(sock, "STARTTLS");
  if (upgraded.startsWith("220")) {
    sock = tls.connect({ socket: sock, host });
    await new Promise((r, j) => { sock.once("secureConnect", r); sock.once("error", j); });
    await send(sock, `EHLO ${config.domain}`);
  }
  if (user) {
    await send(sock, "AUTH LOGIN");
    await send(sock, Buffer.from(user).toString("base64"));
    const authRes = await send(sock, Buffer.from(pass).toString("base64"));
    if (!authRes.startsWith("235")) { sock.end(); throw new Error("SMTP auth failed"); }
  }
  await send(sock, `MAIL FROM:<${from || user}>`);
  await send(sock, `RCPT TO:<${alertTo}>`);
  await send(sock, "DATA");
  await send(sock, [
    `From: FOSSStudio <${from || user}>`,
    `To: <${alertTo}>`,
    `Subject: ${subject}`,
    "",
    body,
    "."
  ].join("\r\n"));
  await send(sock, "QUIT");
  sock.end();
  console.log(`alert email sent: ${subject}`);
  return true;
}
