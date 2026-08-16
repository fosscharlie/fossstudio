// Setup self-check for people self-hosting this. Nearly every "it
// installed fine but the call is a black screen" report comes down to
// one of a handful of things: no public IP announced, the media/relay
// UDP ports not actually reachable, or the site served over plain HTTP.
// None of those surface as an error anywhere - the call just sits there
// silent - so this collects them in one place and says what to fix.
//
// Deliberately reachable without logging in: a broken setup often can't
// log in at all (session cookies are Secure-only, so plain HTTP fails
// login), and a check that needs a working install is no use when the
// install is what's broken. It takes no user input and reports only
// facts a guest already learns on joining a session: the domain, the
// announced IP, and which ports the media engine uses. No secrets, no
// TURN credentials, nothing about recordings, sessions or users.
import { config } from "./config.js";
import { workerAlive, RTC_MIN_PORT, RTC_MAX_PORT } from "./media.js";

export const TURN_PORT = 3478;
export const TURN_RELAY_MIN = 49160;
export const TURN_RELAY_MAX = 49200;

// Which of these an address falls in decides whether guests out on the
// internet can reach it at all, so the distinctions matter more than a
// plain public/private split would suggest.
function ipKind(ip) {
  if (!ip) return "unset";
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return "invalid";
  if (/^127\./.test(ip)) return "loopback";
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return "private";
  if (/^169\.254\./.test(ip)) return "linklocal";
  // 100.64.0.0/10: carrier-grade NAT, and also the range Tailscale uses
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return "cgnat";
  return "public";
}

function checkPublicIp() {
  const ip = config.publicIp;
  const kind = ipKind(ip);
  if (kind === "unset") {
    return {
      level: "fail",
      title: "PUBLIC_IP is not set",
      detail: "The media engine falls back to announcing 127.0.0.1, which only this machine can reach. Everyone will connect, see each other listed, and get a black screen with no sound.",
      fix: "Set PUBLIC_IP in .env to this server's public IPv4 address, then restart the stack."
    };
  }
  if (kind === "invalid") {
    return {
      level: "fail",
      title: "PUBLIC_IP is not a valid IPv4 address",
      detail: `PUBLIC_IP is set to "${ip}". It needs to be a bare IPv4 address, not a hostname or a URL.`,
      fix: "Set PUBLIC_IP to four numbers separated by dots, for example 203.0.113.10."
    };
  }
  if (kind === "loopback" || kind === "linklocal") {
    return {
      level: "fail",
      title: "PUBLIC_IP is a local-only address",
      detail: `PUBLIC_IP is ${ip}, which no other machine can reach. Calls will connect but carry no video or audio.`,
      fix: "Set PUBLIC_IP to the address other machines use to reach this server."
    };
  }
  if (kind === "cgnat") {
    return {
      level: "warn",
      title: "PUBLIC_IP is a Tailscale or carrier-NAT address",
      detail: `PUBLIC_IP is ${ip}, in the 100.64.0.0/10 range. That is correct for a Tailscale setup where everyone joins over your tailnet. If guests are meant to join over the open internet, they cannot reach this address.`,
      fix: "Leave as is for a tailnet-only studio. For public guests, set PUBLIC_IP to your real public IPv4 address."
    };
  }
  if (kind === "private") {
    return {
      level: "warn",
      title: "PUBLIC_IP is a private network address",
      detail: `PUBLIC_IP is ${ip}, which is reachable on your local network only. Guests on the same LAN will be fine; anyone joining over the internet will get a black screen with no sound.`,
      fix: "For guests outside your network, set PUBLIC_IP to your router's public IPv4 address and forward the UDP ports listed below to this machine."
    };
  }
  return {
    level: "ok",
    title: "PUBLIC_IP is a public address",
    detail: `The media engine announces ${ip} to guests.`,
    fix: ""
  };
}

function checkDomain() {
  if (!config.domain || config.domain === "localhost") {
    return {
      level: "warn",
      title: "DOMAIN is not set",
      detail: "DOMAIN is unset, so it falls back to localhost. Session links and the TURN relay address are both built from it.",
      fix: "Set DOMAIN in .env to the domain guests use to reach this studio."
    };
  }
  return {
    level: "ok",
    title: "DOMAIN is set",
    detail: `Session links are built as https://${config.domain}/s/<session>.`,
    fix: ""
  };
}

function checkTurnHost() {
  if (config.turnHost === config.domain) {
    return {
      level: "ok",
      title: "TURN relay address follows DOMAIN",
      detail: `Guests reach the relay at ${config.turnHost}:${TURN_PORT}. That is the right default unless DOMAIN sits behind Cloudflare or another proxy that does not forward this port.`,
      fix: ""
    };
  }
  return {
    level: "ok",
    title: "TURN relay address is set separately",
    detail: `Guests reach the relay at ${config.turnHost}:${TURN_PORT} rather than at DOMAIN. That is what you want when DOMAIN is proxied by Cloudflare or served through a tunnel.`,
    fix: ""
  };
}

// Behind a reverse proxy the app itself always sees plain HTTP, so the
// only honest signal is what the proxy forwarded. No header means we
// cannot tell rather than that it failed.
function checkHttps(req) {
  const forwarded = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const host = String(req.headers.host || "");
  const isLocal = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  if (forwarded === "https") {
    return {
      level: "ok",
      title: "Served over HTTPS",
      detail: "Your proxy is terminating TLS and telling the app about it.",
      fix: ""
    };
  }
  if (forwarded === "http" && !isLocal) {
    return {
      level: "fail",
      title: "Served over plain HTTP",
      detail: "Browsers refuse camera and microphone access on pages that are not HTTPS, and this app's login cookie is marked Secure so it is never stored. Nothing here works properly over plain HTTP.",
      fix: "Terminate TLS at your reverse proxy (certbot for Nginx, or tailscale serve on a tailnet) and redirect HTTP to HTTPS."
    };
  }
  if (isLocal) {
    return {
      level: "ok",
      title: "Checked over localhost",
      detail: "Browsers treat localhost as a secure context, so camera and microphone work here without HTTPS. A real domain still needs TLS.",
      fix: ""
    };
  }
  return {
    level: "warn",
    title: "Cannot tell whether HTTPS is in use",
    detail: "Your reverse proxy is not sending an X-Forwarded-Proto header, so the app cannot confirm the page reached the browser over HTTPS. The page check below settles it either way.",
    fix: "Add: proxy_set_header X-Forwarded-Proto $scheme;  to your Nginx location block."
  };
}

function checkMediaEngine() {
  if (workerAlive()) {
    return {
      level: "ok",
      title: "Media engine is running",
      detail: `mediasoup is up and using UDP ports ${RTC_MIN_PORT}-${RTC_MAX_PORT}.`,
      fix: ""
    };
  }
  return {
    level: "fail",
    title: "Media engine is not running",
    detail: "mediasoup is not up, so no call can carry video or audio at all.",
    fix: "Check the app container's logs: docker compose logs app"
  };
}

function checkSecrets() {
  const weak = ["SESSION_SECRET", "TURN_SECRET"]
    .filter((name) => {
      const value = name === "SESSION_SECRET" ? config.sessionSecret : config.turnSecret;
      return value.length < 32;
    });
  if (weak.length === 0) {
    return {
      level: "ok",
      title: "Secrets are set and long enough",
      detail: "SESSION_SECRET and TURN_SECRET are both at least 32 characters.",
      fix: ""
    };
  }
  return {
    level: "warn",
    title: "Some secrets are short or missing",
    detail: `${weak.join(" and ")} ${weak.length === 1 ? "is" : "are"} under 32 characters. TURN_SECRET must also match the one coturn was started with, or the relay quietly rejects every guest behind a strict firewall.`,
    fix: "Generate with: openssl rand -hex 32  then restart the whole stack so the app and coturn pick up the same value."
  };
}

export function diagnostics(req) {
  const checks = [
    checkHttps(req),
    checkPublicIp(),
    checkDomain(),
    checkTurnHost(),
    checkMediaEngine(),
    checkSecrets()
  ];
  return {
    checks,
    // The page runs its own browser-side tests against these
    turnHost: config.turnHost,
    turnPort: TURN_PORT,
    ports: [
      { label: "Media (this app)", range: `${RTC_MIN_PORT}-${RTC_MAX_PORT}`, protocol: "UDP" },
      { label: "TURN relay control", range: String(TURN_PORT), protocol: "UDP and TCP" },
      { label: "TURN relay media", range: `${TURN_RELAY_MIN}-${TURN_RELAY_MAX}`, protocol: "UDP" }
    ]
  };
}
