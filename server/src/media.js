// mediasoup setup: one worker process handles all media forwarding.
// The worker never decodes video - it routes encrypted packets between
// peers, which is why a small VPS can handle a 10-person session.
import * as mediasoup from "mediasoup";
import { config } from "./config.js";

const RTC_MIN_PORT = 40000;
const RTC_MAX_PORT = 40100;

export const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: { "x-google-start-bitrate": 800 }
  },
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1
    }
  }
];

let worker;

export async function startMediasoup() {
  worker = await mediasoup.createWorker({
    rtcMinPort: RTC_MIN_PORT,
    rtcMaxPort: RTC_MAX_PORT,
    logLevel: "warn"
  });
  worker.on("died", () => {
    // If the media process dies the app is useless; exit and let
    // Docker's restart policy bring everything back clean.
    console.error("mediasoup worker died, exiting");
    process.exit(1);
  });
  return worker;
}

export async function createRouter() {
  return worker.createRouter({ mediaCodecs });
}

export async function createWebRtcTransport(router) {
  // Without a public IP (local dev) bind loopback so the advertised
  // candidate is reachable; 0.0.0.0 would be announced as-is otherwise.
  const listen = config.publicIp
    ? { ip: "0.0.0.0", announcedAddress: config.publicIp }
    : { ip: "127.0.0.1" };
  const transport = await router.createWebRtcTransport({
    listenInfos: [
      { protocol: "udp", ...listen },
      { protocol: "tcp", ...listen }
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1_000_000
  });
  return transport;
}
