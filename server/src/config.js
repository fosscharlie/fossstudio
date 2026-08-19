import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function required(name) {
  const v = process.env[name];
  if (!v && process.env.NODE_ENV === "production") {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v || "";
}

const domain = process.env.DOMAIN || "localhost";

// The dedicated panel domains work out of the box: for each of
// admin/host, the sibling of DOMAIN (app.example.com -> admin.example.com)
// and the child (admin.<DOMAIN>) are both accepted, plus any explicit
// ADMIN_DOMAIN/HOST_DOMAIN. Point their DNS at this server and Caddy
// fetches their certificates on demand - nothing to configure.
export function panelDomains(kind) {
  const out = new Set();
  const explicit = kind === "admin" ? process.env.ADMIN_DOMAIN : process.env.HOST_DOMAIN;
  if (explicit) out.add(explicit.toLowerCase());
  if (domain && domain !== "localhost") {
    const labels = domain.split(".");
    // Sibling: replace the first label (app.example.com -> admin.example.com)
    if (labels.length >= 3) out.add([kind, ...labels.slice(1)].join(".").toLowerCase());
    // Child: prefix the whole domain (example.com -> admin.example.com)
    out.add(`${kind}.${domain}`.toLowerCase());
  }
  return out;
}

export const config = {
  domain,
  publicIp: process.env.PUBLIC_IP || "",
  httpPort: Number(process.env.HTTP_PORT || 3000),
  bindHost: process.env.BIND_HOST || "127.0.0.1",
  // Optional explicit panel domains; the derived defaults below cover
  // the common case with no configuration at all
  adminDomain: process.env.ADMIN_DOMAIN || "",
  hostDomain: process.env.HOST_DOMAIN || "",
  turnHost: process.env.TURN_HOST || domain,
  dataDir: process.env.DATA_DIR || path.join(root, "..", "data"),
  webDir: process.env.WEB_DIR || path.join(root, "..", "web"),
  sessionSecret: required("SESSION_SECRET"),
  hostPassword: required("HOST_PASSWORD"),
  turnSecret: required("TURN_SECRET"),
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "",
    alertTo: process.env.ALERT_EMAIL || ""
  }
};
