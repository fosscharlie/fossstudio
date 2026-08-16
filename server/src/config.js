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

export const config = {
  domain,
  publicIp: process.env.PUBLIC_IP || "",
  httpPort: Number(process.env.HTTP_PORT || 3000),
  bindHost: process.env.BIND_HOST || "127.0.0.1",
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
