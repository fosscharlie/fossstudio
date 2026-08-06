// Email: SMTP settings live in the data dir (admin-managed via the
// dashboard), with .env values as the initial seed. Plain SMTP with
// STARTTLS — works with any provider, no lock-in.
import net from "node:net";
import tls from "node:tls";
import { config } from "./config.js";
import { readJson, writeJson } from "./storage.js";

export async function getSmtpConfig() {
  const stored = await readJson("smtp.json", {});
  return {
    host: stored.host ?? config.smtp.host,
    port: Number(stored.port ?? config.smtp.port ?? 587),
    user: stored.user ?? config.smtp.user,
    pass: stored.pass ?? config.smtp.pass,
    from: stored.from ?? config.smtp.from,
    alertTo: stored.alertTo ?? config.smtp.alertTo
  };
}

export async function saveSmtpConfig(patch) {
  const current = await getSmtpConfig();
  const next = {
    host: String(patch.host ?? current.host ?? "").trim().slice(0, 200),
    port: Math.min(65535, Math.max(1, Number(patch.port) || current.port || 587)),
    user: String(patch.user ?? current.user ?? "").trim().slice(0, 200),
    // Empty password field in the form means "keep the existing one"
    pass: patch.pass ? String(patch.pass).slice(0, 200) : current.pass,
    from: String(patch.from ?? current.from ?? "").trim().slice(0, 200),
    alertTo: String(patch.alertTo ?? current.alertTo ?? "").trim().slice(0, 200)
  };
  await writeJson("smtp.json", next);
  return next;
}

export function isConfigured(smtp) {
  return !!(smtp.host && (smtp.from || smtp.user));
}

export async function sendEmail(to, subject, body) {
  const smtp = await getSmtpConfig();
  if (!isConfigured(smtp)) throw new Error("Email isn't set up yet — add SMTP details in System → Email.");
  const { host, port, user, pass, from } = smtp;

  const read = (sock) => new Promise((resolve) => sock.once("data", (d) => resolve(d.toString())));
  const send = async (sock, line) => { sock.write(line + "\r\n"); return read(sock); };

  let sock = net.connect(port, host);
  await new Promise((r, j) => {
    sock.once("connect", r);
    sock.once("error", j);
    setTimeout(() => j(new Error("SMTP connection timed out")), 15000);
  });
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
    const authRes = await send(sock, Buffer.from(pass || "").toString("base64"));
    if (!authRes.startsWith("235")) { sock.end(); throw new Error("The SMTP server rejected the username/password."); }
  }
  await send(sock, `MAIL FROM:<${from || user}>`);
  const rcpt = await send(sock, `RCPT TO:<${to}>`);
  if (!rcpt.startsWith("250")) { sock.end(); throw new Error("The SMTP server rejected the recipient address."); }
  await send(sock, "DATA");
  await send(sock, [
    `From: FOSSStudio <${from || user}>`,
    `To: <${to}>`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
    "."
  ].join("\r\n"));
  await send(sock, "QUIT");
  sock.end();
  console.log(`email sent to ${to}: ${subject}`);
}

// Alerts are throttled so a crash loop can't flood the inbox
let lastAlertAt = 0;

export async function sendAlert(subject, body) {
  const smtp = await getSmtpConfig();
  if (!isConfigured(smtp) || !smtp.alertTo) return false;
  if (Date.now() - lastAlertAt < 10 * 60 * 1000) return false;
  lastAlertAt = Date.now();
  await sendEmail(smtp.alertTo, subject, body);
  return true;
}
