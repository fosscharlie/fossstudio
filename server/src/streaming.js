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
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");

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

// A one-frame rounded-rectangle alpha mask (white rounded rect on black),
// generated once per launch and reused for every tile via alphamerge.
function makeCornerMask(file, w, h, r) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-nostdin", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=black:s=${w}x${h}`, "-vf",
      `format=gray,geq=lum='lte(pow(max(0\\,max(${r}-X\\,X-(W-${r})))\\,2)+pow(max(0\\,max(${r}-Y\\,Y-(H-${r})))\\,2)\\,pow(${r}\\,2))*255'`,
      "-frames:v", "1", "-y", file]);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`mask gen exited ${code}`))));
  });
}

// Pre-scale an image to the canvas once, so the live graph doesn't
// re-scale a full-size wallpaper on every frame.
function prescaleImage(src, dst, w, h) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-nostdin", "-loglevel", "error", "-i", src, "-vf",
      `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`,
      "-frames:v", "1", "-y", dst]);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`prescale exited ${code}`))));
  });
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
  // Intro takeover: stream the uploaded file fullscreen instead of the
  // grid. The switch in and back out is masked by the intro transition.
  if (state.introFile) return launchIntro(state, gen);
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
      inputs.push({ sdpPath, kind: consumer.kind, name: peer.name, peerId: peer.id, role: peer.role });
      cleanup.transports.push(transport);
      cleanup.consumers.push(consumer);
    }
  }

  const videos = inputs.map((x, i) => ({ ...x, i })).filter((x) => x.kind === "video");
  // Host top-left, like every screen
  videos.sort((a, b) => (b.role === "host") - (a.role === "host"));
  const audios = inputs.map((x, i) => ({ ...x, i })).filter((x) => x.kind === "audio");
  if (videos.length === 0) throw new Error("nothing to stream yet");
  const overlay = state.pendingOverlay || null;
  state.pendingOverlay = null;

  // Presentation matching the on-screen grid: a background (the session
  // wallpaper if set, else its colour), gaps between tiles, and subtly
  // rounded corners. Canvas is a fixed 1280x720.
  const W = 1280, H = 720, GAP = 20, PAD = 24, RAD = 16;
  const n = videos.length;
  const cols = Math.ceil(Math.sqrt(n));
  const nRows = Math.ceil(n / cols);
  const availW = W - 2 * PAD, availH = H - 2 * PAD;
  let tileW = Math.min((availW - (cols - 1) * GAP) / cols,
    ((availH - (nRows - 1) * GAP) / nRows) * 16 / 9);
  tileW = Math.max(2, 2 * Math.floor(tileW / 2));
  const tileH = Math.max(2, 2 * Math.floor((tileW * 9 / 16) / 2));
  const rBase = Math.floor(n / nRows), rExtra = n % nRows;
  const rowSizes = Array.from({ length: nRows }, (_, r) => rBase + (r < rExtra ? 1 : 0));
  const blockH = nRows * tileH + (nRows - 1) * GAP;
  const startY = Math.round(PAD + Math.max(0, (availH - blockH) / 2));
  const positions = [];
  rowSizes.forEach((size, r) => {
    const rowW = size * tileW + (size - 1) * GAP;
    const x0 = Math.round(PAD + (availW - rowW) / 2);
    for (let c = 0; c < size; c++) {
      positions.push({ x: x0 + c * (tileW + GAP), y: startY + r * (tileH + GAP) });
    }
  });

  // Rounded-corner alpha mask (tile-sized), generated once for this launch
  const maskPath = path.join(workDir, "cornermask.png");
  await makeCornerMask(maskPath, tileW, tileH, RAD);

  // Background + mask inputs come first, then banners - the order fixes
  // the ffmpeg input indices used in the filter graph
  let nextIdx = inputs.length;
  // The room's pinned theme, so the stream matches what everyone sees
  // even if settings changed mid-session
  const bgIdx = nextIdx++;
  const wall = room.theme?.wallpaperPath;
  let bgArgs = null;
  if (wall && await fs.access(wall).then(() => true, () => false)) {
    // Pre-scale the wallpaper to the canvas once (cheaper than per-frame)
    const bgPre = path.join(workDir, "bg.png");
    try {
      await prescaleImage(wall, bgPre, W, H);
      bgArgs = ["-loop", "1", "-framerate", "5", "-i", bgPre];
    } catch { /* fall through to the colour background */ }
  }
  if (!bgArgs) {
    const bg = room.theme?.bg;
    const hex = (bg && /^#[0-9a-fA-F]{6}$/.test(bg)) ? bg.slice(1) : "14161a";
    bgArgs = ["-f", "lavfi", "-i", `color=c=0x${hex}:s=${W}x${H}`];
  }
  const maskIdx = nextIdx++;
  const maskArgs = ["-loop", "1", "-framerate", "5", "-i", maskPath];

  // Lower-third banners: the host's browser uploads each one as a PNG
  // (ffmpeg can't draw text) - overlaid on the tile, like the DOM
  const bannerArgs = [];
  for (const v of videos) {
    const f = path.join(config.dataDir, "banners", room.id, `${v.peerId}.png`);
    if (await fs.access(f).then(() => true, () => false)) {
      v.bnIdx = nextIdx++;
      bannerArgs.push("-loop", "1", "-framerate", "5", "-i", f);
    }
  }
  const bannerW = 2 * Math.round(0.38 * tileW / 2);

  const gp = [];
  gp.push(`[${bgIdx}:v]setsar=1,fps=30[bg]`);
  gp.push(`[${maskIdx}:v]format=gray,scale=${tileW}:${tileH},setsar=1[mk];` +
    `[mk]split=${n}${videos.map((_, k) => `[m${k}]`).join("")}`);
  videos.forEach((v, k) => {
    let t = `[${v.i}:v]scale=${tileW}:${tileH}:force_original_aspect_ratio=increase,` +
      `crop=${tileW}:${tileH}:(iw-${tileW})/2:(ih-${tileH})/2,setsar=1,fps=30`;
    if (v.bnIdx != null) {
      t += `[tb${k}];[${v.bnIdx}:v]scale=${bannerW}:-2[bn${k}];` +
        `[tb${k}][bn${k}]overlay=x=0:y=main_h-overlay_h:eof_action=repeat[tt${k}];` +
        `[tt${k}][m${k}]alphamerge[rt${k}]`;
    } else {
      t += `[tt${k}];[tt${k}][m${k}]alphamerge[rt${k}]`;
    }
    gp.push(t);
  });
  let prev = "[bg]";
  videos.forEach((_, k) => {
    const out = k === n - 1 ? "[vout]" : `[og${k}]`;
    gp.push(`${prev}[rt${k}]overlay=${positions[k].x}:${positions[k].y}${out}`);
    prev = out;
  });
  const grid = gp.join(";");
  const amix = audios.length === 0
    ? "anullsrc=r=44100:cl=stereo[aout]"
    : audios.length === 1
      ? `[${audios[0].i}:a]aresample=44100[aout]`
      : `${audios.map((a) => `[${a.i}:a]`).join("")}amix=inputs=${audios.length}:normalize=0,aresample=44100[aout]`;

  // Episode-title chip, top-centre - same as it floats over the grid
  let finalLabel = "[vout]";
  let titleArgs = [];
  let titleFilter = "";
  const titlePng = path.join(config.dataDir, "banners", room.id, "__title.png");
  if (await fs.access(titlePng).then(() => true, () => false)) {
    const ti = nextIdx++;
    const pos = room.control?.titlePos || { x: 0.5, y: 0 };
    const px = Number(pos.x).toFixed(3), py = Number(pos.y).toFixed(3);
    titleArgs = ["-loop", "1", "-framerate", "5", "-i", titlePng];
    titleFilter = `;[${ti}:v]scale=286:-2[tls];${finalLabel}[tls]overlay=` +
      `x=(main_w-overlay_w)*${px}:y=(main_h-overlay_h)*${py}+14*(1-${py}):eof_action=repeat[vtl]`;
    finalLabel = "[vtl]";
  }

  // Optional one-shot overlay (subscribe reminder / ad banner): part of
  // this launch's graph, slides in, auto-expires via its enable window.
  let overlayArgs = [];
  let overlayFilter = "";
  if (overlay) {
    const oi = nextIdx;
    const D = overlay.duration;
    const slide = (margin) =>
      `'main_h-(overlay_h+${margin})*clip(min(t/0.5\,(${D}-t)/0.5)\,0\,1)+${margin}*0'`;
    if (overlay.kind === "subscribe") {
      overlayArgs = ["-i", path.join(ASSETS, "subscribe.mp4")];
      overlayFilter = `;[${oi}:v]scale=1280:-2[ovv];${finalLabel}[ovv]overlay=x=0:y=${slide(0)}:eof_action=pass:enable='lte(t\,${D})'[vfin]`;
    } else {
      overlayArgs = ["-loop", "1", "-i", overlay.file];
      overlayFilter = `;[${oi}:v]scale=-2:150[ovv];${finalLabel}[ovv]overlay=x=main_w-overlay_w-24:y=${slide(24)}:eof_action=pass:enable='lte(t\,${D})'[vfin]`;
    }
    finalLabel = "[vfin]";
  }

  // "file:" destinations exist for tests; anything else goes out as RTMP
  const dest = state.rtmpUrl.startsWith("file:")
    ? [state.rtmpUrl.slice(5)]
    : ["-f", "flv", state.rtmpUrl];

  const ffArgs = [
    "-nostdin", "-loglevel", "warning",
    // the whitelist/probing flags are per-input options: precede every -i
    ...inputs.flatMap((x) => [
      "-protocol_whitelist", "file,udp,rtp",
      "-analyzeduration", "20M", "-probesize", "20M",
      "-i", x.sdpPath
    ]),
    ...bgArgs,
    ...maskArgs,
    ...bannerArgs,
    ...titleArgs,
    ...overlayArgs,
    "-filter_complex", `${grid};${amix}${titleFilter}${overlayFilter}`,
    "-map", finalLabel, "-map", "[aout]",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
    "-b:v", "2500k", "-maxrate", "2500k", "-bufsize", "5000k", "-g", "60",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    "-y", ...dest
  ];
  cleanup.ffmpeg = spawn("ffmpeg", ffArgs);
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
  for (const delay of [0, 1000, 2000, 4000, 8000, 12000]) {
    setTimeout(() => {
      for (const c of cleanup.consumers) {
        if (c.kind === "video" && !c.closed) c.requestKeyFrame().catch(() => {});
      }
    }, delay);
  }
  console.log(`streaming ${room.id}: ${videos.length} video + ${audios.length} audio inputs, ${bannerArgs.length / 6} banners`);
}

// Fullscreen intro: one file, looped and paced in realtime, scaled to
// 720p. No RTP inputs - the participants keep producing, we just don't
// consume them until we relaunch back to the grid.
async function launchIntro(state, gen) {
  const cleanup = { transports: [], consumers: [], ffmpeg: null, workDir: null };
  state.current = cleanup;
  const dest = state.rtmpUrl.startsWith("file:")
    ? [state.rtmpUrl.slice(5)]
    : ["-f", "flv", state.rtmpUrl];
  // Silent intros still need an audio track for the AAC/RTMP output
  const audioIn = state.introHasAudio
    ? []
    : ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"];
  const aLabel = state.introHasAudio ? "[0:a]aresample=44100[aout]" : "[1:a]anull[aout]";
  const ffArgs = [
    "-nostdin", "-loglevel", "warning",
    "-re", "-stream_loop", "-1", "-i", state.introFile,
    ...audioIn,
    "-filter_complex",
    "[0:v]scale=1280:720:force_original_aspect_ratio=decrease," +
      `pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[vout];${aLabel}`,
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
    "-b:v", "2500k", "-maxrate", "2500k", "-bufsize", "5000k", "-g", "60",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    "-y", ...dest
  ];
  cleanup.ffmpeg = spawn("ffmpeg", ffArgs);
  cleanup.ffmpeg.stderr.on("data", (d) => {
    const line = d.toString().trim();
    if (line) console.error(`stream[${state.room.id}] intro: ${line.slice(0, 200)}`);
  });
  cleanup.ffmpeg.on("close", (code) => {
    const s = streams.get(state.room.id);
    // If the intro ffmpeg dies unexpectedly, fall back to the grid
    if (s && s.generation === gen && !s.stopping && !s.relaunching) {
      console.error(`intro ffmpeg exited (${code}); returning to grid`);
      s.introFile = null;
      refreshStream(state.room.id);
    }
  });
  console.log(`streaming ${state.room.id}: intro takeover`);
}

// Play a fullscreen intro on the live stream, then return to the grid.
export async function playIntroOnStream(roomId, file, durationMs, hasAudio) {
  const state = streams.get(roomId);
  if (!state || state.stopping || state.relaunching) return;
  state.relaunching = true;
  try {
    state.introFile = file;
    state.introHasAudio = hasAudio !== false;
    await teardown(state.current);
    await launch(state);
  } finally {
    state.relaunching = false;
  }
  clearTimeout(state.introTimer);
  state.introTimer = setTimeout(async () => {
    if (!streams.has(roomId) || state.stopping) return;
    state.relaunching = true;
    try {
      state.introFile = null;
      await teardown(state.current);
      if (state.room.peers.size > 0) await launch(state);
      else await stopStream(roomId);
    } catch (err) {
      console.error("intro->grid relaunch failed:", err.message);
      await stopStream(roomId).catch(() => {});
    } finally {
      state.relaunching = false;
    }
  }, durationMs + 300);
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
  if (cleanup.workDir) {
    await fs.rm(cleanup.workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Membership changed mid-stream: relaunch with the new grid (debounced)
export function refreshStream(roomId) {
  const state = streams.get(roomId);
  if (!state || state.stopping) return;
  // Don't disturb an intro takeover - its own timer relaunches the grid
  if (state.introFile) return;
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

// Relaunch immediately with a one-shot overlay in the graph
export async function showOverlay(roomId, spec) {
  const state = streams.get(roomId);
  if (!state || state.stopping) throw new Error("not streaming");
  if (state.relaunching) throw new Error("stream is busy, try again in a moment");
  state.relaunching = true;
  try {
    state.pendingOverlay = spec;
    await teardown(state.current);
    await launch(state);
  } finally {
    state.relaunching = false;
  }
}

export async function stopStream(roomId) {
  const state = streams.get(roomId);
  if (!state) return;
  state.stopping = true;
  clearTimeout(state.refreshTimer);
  clearTimeout(state.introTimer);
  streams.delete(roomId);
  await teardown(state.current);
  console.log(`stream stopped for ${roomId}`);
}
