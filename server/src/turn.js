// Time-limited TURN credentials using coturn's REST auth scheme:
// the username carries an expiry timestamp and the password is an
// HMAC of it, so no credential list ever needs storing or syncing.
import crypto from "node:crypto";
import { config } from "./config.js";

export function iceServers() {
  const ttlSeconds = 12 * 3600;
  const username = `${Math.floor(Date.now() / 1000) + ttlSeconds}:fossstudio`;
  const credential = crypto
    .createHmac("sha1", config.turnSecret)
    .update(username)
    .digest("base64");
  // TURN_HOST exists for setups where DOMAIN doesn't resolve to this
  // server directly (Cloudflare proxied DNS / tunnels): relay traffic
  // must reach coturn itself, not a CDN edge that drops port 3478.
  return [
    {
      urls: [
        `stun:${config.turnHost}:3478`
      ]
    },
    {
      urls: [
        `turn:${config.turnHost}:3478?transport=udp`,
        `turn:${config.turnHost}:3478?transport=tcp`
      ],
      username,
      credential
    }
  ];
}
