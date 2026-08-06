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

// ---------- the house email template ----------
// Every outgoing email uses this: navy header with the FOSSStudio mark,
// white card, yellow action button. Inline styles + tables only, so it
// renders everywhere. Content arrives as {paragraphs, button?, footer?}.

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderEmail({ title, paragraphs = [], button = null, footer = "" }) {
  const paras = paragraphs.map((p) =>
    `<p style="margin:0 0 14px; font-size:15px; line-height:1.65; color:#3f3f46;">${esc(p)}</p>`
  ).join("");
  const btn = button ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto 8px;">
      <tr><td style="border-radius:10px; background:#fbc711;">
        <a href="${esc(button.url)}"
           style="display:inline-block; padding:13px 26px; font-size:15px; font-weight:700;
                  color:#111827; text-decoration:none; border-radius:10px;">
          ${esc(button.label)}
        </a>
      </td></tr>
    </table>
    <p style="margin:6px 0 0; font-size:12px; line-height:1.5; color:#a1a1aa; text-align:center; word-break:break-all;">
      or copy this link: ${esc(button.url)}
    </p>` : "";
  const foot = footer
    ? `<p style="margin:20px 0 0; font-size:13px; line-height:1.6; color:#71717a;">${esc(footer)}</p>`
    : "";

  return `<!doctype html>
<html>
<body style="margin:0; padding:0; background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7; padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px; width:100%; background:#ffffff; border:1px solid #e4e4e7;
                    border-radius:14px; overflow:hidden;">
        <tr>
          <td style="background:#111827; padding:22px 32px; font-family:Arial,Helvetica,sans-serif;">
            <span style="font-size:22px; font-weight:800; letter-spacing:-0.5px;">
              <span style="color:#fbc711;">FOSS</span><span style="color:#ffffff;">Studio</span>
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:30px 32px 26px; font-family:Arial,Helvetica,sans-serif;">
            <h1 style="margin:0 0 16px; font-size:19px; line-height:1.4; color:#111827;">${esc(title)}</h1>
            ${paras}
            ${btn}
            ${foot}
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#a1a1aa;">
        Sent by FOSSStudio &middot; <a href="https://fossstudio.org" style="color:#a1a1aa;">fossstudio.org</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderPlainText({ title, paragraphs = [], button = null, footer = "" }) {
  return [
    `FOSSStudio — ${title}`,
    "",
    ...paragraphs,
    ...(button ? ["", `${button.label}: ${button.url}`] : []),
    ...(footer ? ["", footer] : []),
    "",
    "— Sent by FOSSStudio (fossstudio.org)"
  ].join("\n");
}

// content: a plain string, or {paragraphs, button?, footer?}
export async function sendEmail(to, subject, content) {
  const parts = typeof content === "string"
    ? { title: subject, paragraphs: content.split(/\n{2,}/).map((p) => p.replace(/\n/g, " ").trim()).filter(Boolean) }
    : { title: subject, ...content };
  const html = renderEmail(parts);
  const text = renderPlainText(parts);
  return sendMime(to, subject, text, html);
}

async function sendMime(to, subject, text, html) {
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
  // multipart/alternative: plain text for old clients, HTML for the rest.
  // base64 bodies sidestep line-length and dot-stuffing pitfalls.
  const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const boundary = `fs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  await send(sock, [
    `From: FOSSStudio <${from || user}>`,
    `To: <${to}>`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(text),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(html),
    `--${boundary}--`,
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
