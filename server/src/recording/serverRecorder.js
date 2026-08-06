// Server-side capture: for each participant, consume their producers on
// a PlainTransport and pipe RTP into a local ffmpeg that writes
// video (VP8 copied, no transcode) and audio to disk.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { recDir } from "./manager.js";

let nextPort = 45000;
function allocPort() {
  nextPort += 4;
  if (nextPort > 45900) nextPort = 45000;
  return nextPort;
}

function sdpFor(audioPort, videoPort, audioConsumer, videoConsumer) {
  const lines = ["v=0", "o=- 0 0 IN IP4 127.0.0.1", "s=fossstudio", "c=IN IP4 127.0.0.1", "t=0 0"];
  if (audioConsumer) {
    const { codecs } = audioConsumer.rtpParameters;
    const pt = codecs[0].payloadType;
    lines.push(`m=audio ${audioPort} RTP/AVP ${pt}`,
      `a=rtpmap:${pt} ${codecs[0].mimeType.split("/")[1]}/${codecs[0].clockRate}/${codecs[0].channels}`,
      "a=recvonly");
  }
  if (videoConsumer) {
    const { codecs } = videoConsumer.rtpParameters;
    const pt = codecs[0].payloadType;
    lines.push(`m=video ${videoPort} RTP/AVP ${pt}`,
      `a=rtpmap:${pt} ${codecs[0].mimeType.split("/")[1]}/${codecs[0].clockRate}`,
      "a=recvonly");
  }
  return lines.join("\n") + "\n";
}

export async function startServerCapture(rec, room) {
  rec.captures = [];
  for (const peer of room.peers.values()) {
    await capturePeer(rec, room, peer).catch((e) =>
      console.error(`server capture failed for ${peer.name}:`, e.message));
  }
}

export async function capturePeer(rec, room, peer) {
  const producers = [...peer.producers.values()];
  const audioProd = producers.find((p) => p.kind === "audio");
  const videoProd = producers.find((p) => p.kind === "video");
  if (!audioProd && !videoProd) return;

  const capture = { peerId: peer.id, transports: [], consumers: [], ffmpeg: null };
  const audioPort = allocPort();
  const videoPort = allocPort();

  async function pipe(producer, port) {
    const transport = await room.router.createPlainTransport({
      listenInfo: { protocol: "udp", ip: "127.0.0.1" },
      rtcpMux: true,
      comedia: false
    });
    await transport.connect({ ip: "127.0.0.1", port });
    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities: room.router.rtpCapabilities,
      paused: true
    });
    capture.transports.push(transport);
    capture.consumers.push(consumer);
    return consumer;
  }

  const audioConsumer = audioProd ? await pipe(audioProd, audioPort) : null;
  const videoConsumer = videoProd ? await pipe(videoProd, videoPort) : null;

  const sdpPath = path.join(recDir(rec.id), "raw", `${peer.id}.sdp`);
  await fs.writeFile(sdpPath, sdpFor(audioPort, videoPort, audioConsumer, videoConsumer));

  const outPath = path.join(recDir(rec.id), "raw", `${peer.id}-server.mkv`);
  const p = rec.peers.get(peer.id);
  if (p) { p.files.server = `${peer.id}-server.mkv`; }

  capture.ffmpeg = spawn("ffmpeg", [
    "-nostdin", "-loglevel", "error",
    "-protocol_whitelist", "file,udp,rtp",
    "-i", sdpPath,
    ...(videoConsumer ? ["-map", "0:v", "-c:v", "copy"] : []),
    ...(audioConsumer ? ["-map", "0:a", "-c:a", "copy"] : []),
    "-y", outPath
  ]);
  capture.ffmpeg.stderr.on("data", (d) => {
    const line = d.toString().trim();
    if (line) console.error(`ffmpeg[${peer.name}]: ${line.slice(0, 200)}`);
  });

  // ffmpeg is listening; unpause so RTP starts flowing
  for (const c of capture.consumers) await c.resume();
  // Ask for a keyframe so video starts cleanly
  if (videoConsumer) await videoConsumer.requestKeyFrame().catch(() => {});

  rec.captures = rec.captures || [];
  rec.captures.push(capture);
}

export async function stopServerCapture(rec) {
  for (const cap of rec.captures || []) {
    for (const c of cap.consumers) { try { c.close(); } catch { /* closed */ } }
    for (const t of cap.transports) { try { t.close(); } catch { /* closed */ } }
    if (cap.ffmpeg) {
      cap.ffmpeg.kill("SIGINT"); // lets ffmpeg finish the file cleanly
      await new Promise((resolve) => {
        cap.ffmpeg.on("close", resolve);
        setTimeout(() => { cap.ffmpeg.kill("SIGKILL"); resolve(); }, 5000);
      });
    }
  }
}
