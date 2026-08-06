// Live streaming: composite every participant's feed server-side with
// ffmpeg and push it to YouTube over RTMP.
//
// The ffmpeg filter graph is fixed at launch, so when someone joins or
// leaves mid-stream we relaunch it (a couple of seconds' blip on the
// stream, and the grid is correct again).
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const streams = new Map(); // roomId -> state

function sdpFor(port, consumer) {
  const { codecs } = consumer.rtpParameters;
  const c = codecs[0];
  const kind = consumer.kind;
  return [
    "v=0", "o=- 0 0 IN IP4 127.0.0.1", "s=fossstudio-live", "c=IN IP4 127.0.0.1", "t=0 0",
    `m=${kind} ${port} RTP/AVP ${c.payloadType}`,
    `a=rtpmap:${c.payloadType} ${c.mimeType.split("/")[1]}/${c.clockRate}${kind === "audio" ? `/${c.channels}` : ""}`,
    "a=recvonly", ""
  ].join("\n");
}

let nextPort = 46000;
function allocPort() {
  nextPort += 2;
  if (nextPort > 46900) nextPort = 46000;
  return nextPort;
}

export function isStreaming(roomId) {
  return streams.has(roomId);
}

export async function startStream(room, rtmpUrl) {
  if (streams.has(room.id)) throw new Error("already streaming");
  const state = { room, rtmpUrl, generation: 0, stopping: false };
  streams.set(room.id, state);
  await launch(state);
  return state;
}

async function launch(state) {
  const { room } = state;
  const gen = ++state.generation;
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "fslive-"));
  const cleanup = { transports: [], consumers: [], ffmpeg: null, workDir };
  state.current = cleanup;

  const inputs = []; // {sdpPath, kind, peer}
  for (const peer of room.peers.values()) {
    for (const producer of peer.producers.values()) {
      const port = allocPort();
      const transport = await room.router.createPlainTransport({
        listenInfo: { protocol: "udp", ip: "127.0.0.1" },
        rtcpMux: true, comedia: false
      });
      await transport.connect({ ip: "127.0.0.1", port });
      const consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities: room.router.rtpCapabilities,
        paused: true
      });
      const sdpPath = path.join(workDir, `${crypto.randomUUID()}.sdp`);
      await fs.writeFile(sdpPath, sdpFor(port, consumer));
      inputs.push({ sdpPath, kind: consumer.kind, name: peer.name });
      cleanup.transports.push(transport);
      cleanup.consumers.push(consumer);
    }
  }

  const videos = inputs.map((x, i) => ({ ...x, i })).filter((x) => x.kind === "video");
  const audios = inputs.map((x, i) => ({ ...x, i })).filter((x) => x.kind === "audio");
  if (videos.length === 0) throw new Error("nothing to stream yet");

  const cols = Math.ceil(Math.sqrt(videos.length));
  const rows = Math.ceil(videos.length / cols);
  const cellW = 2 * Math.round(1280 / cols / 2);
  const cellH = 2 * Math.round(720 / rows / 2);
  const scaled = videos.map((v, k) =>
    `[${v.i}:v]scale=${cellW}:${cellH}:force_original_aspect_ratio=decrease,` +
    `pad=${cellW}:${cellH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${k}]`).join(";");
  const layout = videos.map((v, k) => `${(k % cols) * cellW}_${Math.floor(k / cols) * cellH}`);
  const stack = videos.length === 1
    ? "[v0]copy[vout]"
    : `${videos.map((v, k) => `[v${k}]`).join("")}xstack=inputs=${videos.length}:layout=${layout.join("|")}:fill=black[vout]`;
  const amix = audios.length === 0
    ? "anullsrc=r=44100:cl=stereo[aout]"
    : audios.length === 1
      ? `[${audios[0].i}:a]aresample=44100[aout]`
      : `${audios.map((a) => `[${a.i}:a]`).join("")}amix=inputs=${audios.length}:normalize=0,aresample=44100[aout]`;

  // "file:" destinations exist for tests; anything else goes out as RTMP
  const dest = state.rtmpUrl.startsWith("file:")
    ? [state.rtmpUrl.slice(5)]
    : ["-f", "flv", state.rtmpUrl];

  cleanup.ffmpeg = spawn("ffmpeg", [
    "-nostdin", "-loglevel", "warning",
    // the whitelist/probing flags are per-input options: precede every -i
    ...inputs.flatMap((x) => [
      "-protocol_whitelist", "file,udp,rtp",
      "-analyzeduration", "10M", "-probesize", "10M",
      "-i", x.sdpPath
    ]),
    "-filter_complex", `${scaled};${stack};${amix}`,
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
    "-b:v", "2500k", "-maxrate", "2500k", "-bufsize", "5000k", "-g", "60",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    "-y", ...dest
  ]);
  cleanup.ffmpeg.stderr.on("data", (d) => {
    const line = d.toString().trim();
    if (line) console.error(`stream[${room.id}]: ${line.slice(0, 200)}`);
  });
  cleanup.ffmpeg.on("close", (code) => {
    // If ffmpeg dies while we still think we're live, stop cleanly
    const s = streams.get(room.id);
    if (s && s.generation === gen && !s.stopping && !s.relaunching) {
      console.error(`stream ffmpeg exited (${code}); stopping stream`);
      stopStream(room.id).catch(() => {});
    }
  });

  for (const c of cleanup.consumers) await c.resume();
  // ffmpeg needs a keyframe to lock onto each video stream; ask a few
  // times in case the first request races its port setup
  for (const delay of [0, 1000, 2000, 4000]) {
    setTimeout(() => {
      for (const c of cleanup.consumers) {
        if (c.kind === "video" && !c.closed) c.requestKeyFrame().catch(() => {});
      }
    }, delay);
  }
  console.log(`streaming ${room.id}: ${videos.length} video + ${audios.length} audio inputs`);
}

async function teardown(cleanup) {
  if (!cleanup) return;
  for (const c of cleanup.consumers) { try { c.close(); } catch { /* closed */ } }
  for (const t of cleanup.transports) { try { t.close(); } catch { /* closed */ } }
  if (cleanup.ffmpeg) {
    cleanup.ffmpeg.kill("SIGINT");
    await new Promise((resolve) => {
      cleanup.ffmpeg.on("close", resolve);
      setTimeout(() => { cleanup.ffmpeg.kill("SIGKILL"); resolve(); }, 4000);
    });
  }
  await fs.rm(cleanup.workDir, { recursive: true, force: true }).catch(() => {});
}

// Membership changed mid-stream: relaunch with the new grid (debounced)
export function refreshStream(roomId) {
  const state = streams.get(roomId);
  if (!state || state.stopping) return;
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(async () => {
    if (!streams.has(roomId) || state.stopping) return;
    state.relaunching = true;
    try {
      await teardown(state.current);
      if (state.room.peers.size > 0) await launch(state);
      else await stopStream(roomId);
    } catch (err) {
      console.error("stream relaunch failed:", err.message);
      await stopStream(roomId).catch(() => {});
    } finally {
      state.relaunching = false;
    }
  }, 2000);
}

export async function stopStream(roomId) {
  const state = streams.get(roomId);
  if (!state) return;
  state.stopping = true;
  clearTimeout(state.refreshTimer);
  streams.delete(roomId);
  await teardown(state.current);
  console.log(`stream stopped for ${roomId}`);
}
