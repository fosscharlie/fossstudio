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
  return [
    {
      urls: [
        `stun:${config.domain}:3478`
      ]
    },
    {
      urls: [
        `turn:${config.domain}:3478?transport=udp`,
        `turn:${config.domain}:3478?transport=tcp`
      ],
      username,
      credential
    }
  ];
}
