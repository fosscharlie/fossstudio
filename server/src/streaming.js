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
import { titleWidth, LAYOUT, tileLayout } from "./composite.js";
import { notifyLive } from "./livechat.js";
import { saveIndex } from "./recording/manager.js";

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

// The two outputs are independent: "channel" is the studio's own watch
// page (HLS + chat + DVR), "rtmp" is YouTube or any RTMP destination.
// Each has its own button and its own clock in the host controls.
export function liveOutputs(roomId) {
  const state = streams.get(roomId);
  return {
    channel: !!state?.outputs.channel,
    rtmp: !!state?.outputs.rtmp,
    channelSince: state?.channelSince || null,
    rtmpSince: state?.rtmpSince || null
  };
}

// When the channel went live, for the watch page (rejoin-safe)
export function streamingSince(roomId) {
  return streams.get(roomId)?.channelSince || null;
}

// The session currently live on a host's permanent channel page
// (/live/<username>), if any
export function channelRoomForOwner(uid) {
  for (const state of streams.values()) {
    if (state.outputs.channel && state.room.ownerId === uid) return state.room.id;
  }
  return null;
}

// Turn one output on. The encode is shared: if the other output is
// already running this relaunches the graph with both destinations (a
// couple of seconds' blip, same as someone joining mid-stream).
export async function startOutput(room, target, rtmpUrl) {
  let state = streams.get(room.id);
  if (state?.outputs[target]) throw new Error("already live there");
  if (!state) {
    state = {
      room, rtmpUrl: null, liveDir: null,
      outputs: { channel: false, rtmp: false },
      generation: 0, stopping: false, startedAt: Date.now(),
      channelSince: null, rtmpSince: null
    };
    streams.set(room.id, state);
  }
  if (target === "channel") {
    state.liveDir = path.join(config.dataDir, "live", room.id);
    await fs.rm(state.liveDir, { recursive: true, force: true });
    await fs.mkdir(state.liveDir, { recursive: true });
    state.outputs.channel = true;
    state.channelSince = Date.now();
  } else {
    state.rtmpUrl = rtmpUrl;
    state.outputs.rtmp = true;
    state.rtmpSince = Date.now();
  }
  try {
    await launch(state);
  } catch (err) {
    state.outputs[target] = false;
    if (!state.outputs.channel && !state.outputs.rtmp) streams.delete(room.id);
    if (target === "channel") {
      await fs.rm(state.liveDir, { recursive: true, force: true }).catch(() => {});
      state.channelSince = null;
    } else {
      state.rtmpSince = null;
    }
    throw err;
  }
  if (target === "channel") notifyLive(room.id, true);
  return state;
}

// Turn one output off; the other keeps running on a fresh graph.
// Stopping the channel stitches what the audience watched into a ready
// recording, exactly as a full stop does.
export async function stopOutput(roomId, target) {
  const state = streams.get(roomId);
  if (!state || !state.outputs[target]) return;
  state.outputs[target] = false;
  if (!state.outputs.channel && !state.outputs.rtmp) {
    await stopStream(roomId);
    return;
  }
  await refreshNow(state);
  if (target === "channel") {
    notifyLive(roomId, false);
    await finalizeLive(state);
    state.channelSince = null;
  } else {
    state.rtmpSince = null;
  }
}

// Output arguments shared by the grid and intro launches: HLS for the
// watch page, plus RTMP via the tee muxer when configured - one encode
// either way. Each relaunch appends to the same playlist with a
// discontinuity marker, so viewers ride through the blip and the
// finished playlist is the whole show in order.
async function destArgs(state, gen) {
  // RTMP-only launches skip the HLS side entirely
  if (!state.outputs.channel) {
    return state.rtmpUrl.startsWith("file:")
      ? [state.rtmpUrl.slice(5)]
      : ["-f", "flv", "-y", state.rtmpUrl];
  }
  const dir = state.liveDir;
  const playlist = path.join(dir, "live.m3u8");
  // fMP4 segments with one init per generation: append_list rewrites
  // the playlist's EXT-X-MAP to the newest init, and each generation's
  // codec setup only truly matches its own - keeping them separate is
  // what lets finalizeLive() stitch the show together losslessly.
  const seg = path.join(dir, `seg-${gen}-%05d.m4s`);
  const init = `init-${gen}.mp4`;
  const appending = await fs.access(playlist).then(() => true, () => false);
  const flags = `omit_endlist${appending ? "+append_list+discont_start" : ""}`;
  if (!state.outputs.rtmp) {
    return ["-f", "hls", "-hls_time", "2", "-hls_list_size", "0",
      "-hls_flags", flags, "-hls_segment_type", "fmp4",
      "-hls_fmp4_init_filename", init,
      "-hls_segment_filename", seg, "-y", playlist];
  }
  // tee: same encoded packets to both. onfail=ignore on the RTMP leg so
  // a YouTube hiccup never kills the own-page stream.
  const rtmpLeg = state.rtmpUrl.startsWith("file:")
    ? `[f=flv:onfail=ignore]${state.rtmpUrl.slice(5)}`
    : `[f=flv:onfail=ignore]${state.rtmpUrl}`;
  const hlsLeg = `[f=hls:hls_time=2:hls_list_size=0:hls_flags=${flags}:` +
    `hls_segment_type=fmp4:hls_fmp4_init_filename=${init}:hls_segment_filename=${seg}]${playlist}`;
  return ["-f", "tee", "-use_fifo", "1", "-y", `${hlsLeg}|${rtmpLeg}`];
}

// The playlist the audience just watched, stitched losslessly into one
// file and filed as a ready recording - the saved video is exactly the
// stream, by construction.
export async function finalizeLive(state) {
  try {
    // Each generation (one per relaunch) becomes a valid fMP4 by
    // prepending its own init to its segments; the generations then
    // stream-copy concat into one file. Reading back the playlist
    // would map every generation to the newest init, which corrupts
    // all the earlier ones - this way each keeps its own.
    const files = await fs.readdir(state.liveDir);
    const gens = [...new Set(files
      .map((f) => /^seg-(\d+)-\d+\.m4s$/.exec(f)?.[1])
      .filter(Boolean).map(Number))].sort((a, b) => a - b);
    if (gens.length === 0) throw new Error("no segments");
    const parts = [];
    for (const g of gens) {
      const segs = files.filter((f) => f.startsWith(`seg-${g}-`) && f.endsWith(".m4s")).sort();
      const dest = path.join(state.liveDir, `gen-${g}.mp4`);
      const fh = await fs.open(dest, "w");
      for (const piece of [`init-${g}.mp4`, ...segs]) {
        await fh.writeFile(await fs.readFile(path.join(state.liveDir, piece)));
      }
      await fh.close();
      parts.push(dest);
    }
    const listFile = path.join(state.liveDir, "concat.txt");
    await fs.writeFile(listFile, parts.map((p) => `file '${p}'`).join("\n") + "\n");
    const recId = `${state.room.id}-live-${new Date(state.startedAt).toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
    const { recDir } = await import("./recording/manager.js");
    const out = path.join(recDir(recId), "out");
    await fs.mkdir(out, { recursive: true });
    await new Promise((resolve, reject) => {
      const p = spawn("nice", ["-n", "15", "ffmpeg", "-nostdin", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", listFile,
        "-c", "copy", "-movflags", "+faststart",
        "-y", path.join(out, "live.mp4")]);
      let err = "";
      p.stderr.on("data", (d) => { err += d; });
      p.on("close", (code) => code === 0 ? resolve()
        : reject(new Error(`live concat exited ${code}: ${err.slice(-300)}`)));
    });
    await saveIndex({
      id: recId, roomId: state.room.id, ownerId: state.room.ownerId || null,
      mode: "live", title: state.room.title || "",
      startedAt: state.startedAt, endedAt: Date.now(),
      status: "ready", files: ["live.mp4"]
    });
    await fs.rm(state.liveDir, { recursive: true, force: true });
  } catch (err) {
    // Keep the raw segments rather than lose the show: the operator can
    // stitch by hand from data/live/<session>
    console.error(`live finalize for ${state.room.id} failed: ${err.message} - raw segments kept`);
  }
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
  const W = 1280, H = 720;
  // Same fractions the live grid uses of its video area
  const PAD = Math.round(W * LAYOUT.pad);
  const GAP = Math.round(W * LAYOUT.gap);
  const RAD = Math.round(W * LAYOUT.radius);
  const n = videos.length;
  // Spotlight puts one person above a strip of everyone else, exactly as
  // the session view does; -1 means the plain even grid
  const spotIndex = room.control?.layout === "spotlight" && room.control?.spotlightPeerId
    ? videos.findIndex((v) => v.peerId === room.control.spotlightPeerId)
    : -1;
  const boxes = tileLayout(n, spotIndex, W, H);

  // Rounded-corner alpha masks, generated once for this launch. Spotlight
  // tiles are not all one size, so there is one mask per distinct size.
  const sizeKey = (b) => `${b.w}x${b.h}`;
  const maskPaths = new Map();
  for (const key of new Set(boxes.map(sizeKey))) {
    const [mw, mh] = key.split("x").map(Number);
    const file = path.join(workDir, `cornermask-${key}.png`);
    await makeCornerMask(file, mw, mh, RAD);
    maskPaths.set(key, file);
  }

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
  const maskIdxBySize = new Map();
  const maskArgs = [];
  for (const [key, file] of maskPaths) {
    maskIdxBySize.set(key, nextIdx++);
    maskArgs.push("-loop", "1", "-framerate", "5", "-i", file);
  }

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
  // Banner PNGs are drawn at 20px per cqw (tile = 2000px design width)
  // and now hug their text, so scale each by its own tile's width
  const bannerScale = (w) => `scale=w=trunc(iw*${w}/4000)*2:h=-2`;

  const gp = [];
  gp.push(`[${bgIdx}:v]setsar=1,fps=30[bg]`);
  // One mask per distinct tile size, split between the tiles using it
  for (const [key, mIdx] of maskIdxBySize) {
    const users = boxes.map((b, k) => (sizeKey(b) === key ? k : -1)).filter((k) => k >= 0);
    const [mw, mh] = key.split("x").map(Number);
    gp.push(`[${mIdx}:v]format=gray,scale=${mw}:${mh},setsar=1[mk${key}];` +
      `[mk${key}]split=${users.length}${users.map((k) => `[m${k}]`).join("")}`);
  }
  videos.forEach((v, k) => {
    const b = boxes[k];
    let t = `[${v.i}:v]scale=${b.w}:${b.h}:force_original_aspect_ratio=increase,` +
      `crop=${b.w}:${b.h}:(iw-${b.w})/2:(ih-${b.h})/2,setsar=1,fps=30`;
    if (v.bnIdx != null) {
      t += `[tb${k}];[${v.bnIdx}:v]${bannerScale(b.w)}[bn${k}];` +
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
    gp.push(`${prev}[rt${k}]overlay=${boxes[k].x}:${boxes[k].y}${out}`);
    prev = out;
  });
  const grid = gp.join(";");
  // Mono out: voices arrive as stereo with sound only in the left
  // channel, so fold every input to its left channel before mixing
  const amix = audios.length === 0
    ? "anullsrc=r=44100:cl=mono[aout]"
    : audios.length === 1
      ? `[${audios[0].i}:a]pan=mono|c0=c0,aresample=44100[aout]`
      : `${audios.map((a, k) => `[${a.i}:a]pan=mono|c0=c0[sa${k}];`).join("")}` +
        `${audios.map((_, k) => `[sa${k}]`).join("")}amix=inputs=${audios.length}:normalize=0,aresample=44100[aout]`;

  // Episode-title chip, top-centre - same as it floats over the grid
  let finalLabel = "[vout]";
  let titleArgs = [];
  let titleFilter = "";
  const titlePng = path.join(config.dataDir, "banners", room.id, "__title.png");
  if (await fs.access(titlePng).then(() => true, () => false)) {
    const ti = nextIdx++;
    const pos = room.control?.titlePos || { x: 0.5, y: 0 };
    const px = Number(pos.x).toFixed(3), py = Number(pos.y).toFixed(3);
    const tw = titleWidth(room.control?.titleScale);
    titleArgs = ["-loop", "1", "-framerate", "5", "-i", titlePng];
    titleFilter = `;[${ti}:v]scale=${tw}:-2[tls];${finalLabel}[tls]overlay=` +
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

  const dest = await destArgs(state, gen);

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
    ...dest
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
  const dest = await destArgs(state, gen);
  // Silent intros still need an audio track for the AAC/RTMP output
  const audioIn = state.introHasAudio
    ? []
    : ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono"];
  // Mono like the grid stream, so the channel count never flips mid-stream
  const aLabel = state.introHasAudio
    ? "[0:a]aformat=channel_layouts=mono,aresample=44100[aout]"
    : "[1:a]anull[aout]";
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
    ...dest
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
// Immediate relaunch with the current output set (used when one output
// turns off while the other keeps going)
async function refreshNow(state) {
  clearTimeout(state.refreshTimer);
  state.relaunching = true;
  try {
    await teardown(state.current);
    await launch(state);
  } finally {
    state.relaunching = false;
  }
}

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
  if (state.outputs.channel || state.channelSince) {
    notifyLive(roomId, false);
    await finalizeLive(state);
  }
  console.log(`stream stopped for ${roomId}`);
}
