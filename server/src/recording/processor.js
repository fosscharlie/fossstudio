// Post-processing: per-participant FLAC + one combined grid MKV.
// Runs after the session ends - speed doesn't matter, so everything is
// niced right down to keep live calls smooth.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { recDir } from "./manager.js";
import { fileURLToPath } from "node:url";

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "assets");

function ffmpeg(args, label) {
  return new Promise((resolve, reject) => {
    const p = spawn("nice", ["-n", "15", "ffmpeg", "-nostdin", "-loglevel", "error", ...args]);
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => code === 0
      ? resolve()
      : reject(new Error(`${label}: ffmpeg exited ${code}: ${err.slice(-400)}`)));
  });
}

async function exists(f) {
  return fs.access(f).then(() => true, () => false);
}

// Duration of a media file in seconds (0 if unknown). Used to hard-cap
// the combined render: its background is an endless looped image, and
// -shortest doesn't reliably terminate that with browser-recorded WebM.
function probeDuration(file) {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration",
      "-of", "default=nk=1:nw=1", file]);
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("error", () => resolve(0));
    p.on("close", () => resolve(parseFloat(out) || 0));
  });
}

function safeName(name, used) {
  let base = name.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 30) || "guest";
  let candidate = base, i = 2;
  while (used.has(candidate)) candidate = `${base}-${i++}`;
  used.add(candidate);
  return candidate;
}

export async function processRecording(rec) {
  const dir = recDir(rec.id);
  const raw = path.join(dir, "raw");
  const out = path.join(dir, "out");
  await fs.mkdir(out, { recursive: true });

  const files = [];
  const used = new Set();
  // Per participant: which input file carries their video / audio.
  // Server mode: one file has both. Browser mode: two separate files.
  const parts = []; // {name, offsetMs, videoFile, audioFile}
  let maxEnd = 0;   // latest (offset + duration) across participants, seconds

  for (const [peerId, p] of rec.peers) {
    const name = safeName(p.name, used);
    const audioFile = rec.mode === "server"
      ? (p.files.server && path.join(raw, p.files.server))
      : (p.files.audio && path.join(raw, p.files.audio));
    const videoFile = rec.mode === "server"
      ? audioFile
      : (p.files.video && path.join(raw, p.files.video));
    const bannerFile = path.join(raw, p.banner || `banner-${peerId}.png`);
    const part = {
      name,
      role: p.role,
      offsetMs: p.startOffsetMs || 0,
      audioFile: audioFile && await exists(audioFile) ? audioFile : null,
      videoFile: videoFile && await exists(videoFile) ? videoFile : null,
      bannerFile: await exists(bannerFile) ? bannerFile : null
    };

    // Lossless FLAC per participant
    if (part.audioFile) {
      const flac = `${name}.flac`;
      // Mono: mics are one channel, but the capture arrives as stereo
      // with the voice in the left - keep just that channel
      await ffmpeg(["-i", part.audioFile, "-map", "0:a:0", "-af", "pan=mono|c0=c0",
        "-c:a", "flac", "-y", path.join(out, flac)],
        `flac ${name}`);
      files.push(flac);
      // FLAC carries a real duration (the source WebM often doesn't) -
      // use it to cap the combined render's length
      const dur = await probeDuration(path.join(out, flac));
      if (dur > 0) maxEnd = Math.max(maxEnd, (part.offsetMs || 0) / 1000 + dur);
    }
    if (part.audioFile || part.videoFile) parts.push(part);
  }

  // Combined grid MKV: video tiles stacked, all audio mixed.
  // Host top-left, like every screen.
  const videos = parts.filter((p) => p.videoFile)
    .sort((a, b) => (b.role === "host") - (a.role === "host"));
  const audios = parts.filter((p) => p.audioFile);
  if (videos.length > 0) {
    const args = [];
    const inputIdx = new Map(); // file -> ffmpeg input index
    const addInput = (file, offsetMs) => {
      if (inputIdx.has(file)) return inputIdx.get(file);
      const idx = inputIdx.size;
      args.push("-itsoffset", (offsetMs / 1000).toFixed(3), "-i", file);
      inputIdx.set(file, idx);
      return idx;
    };
    for (const p of parts) {
      if (p.videoFile) p.vIdx = addInput(p.videoFile, p.offsetMs);
      if (p.audioFile) p.aIdx = addInput(p.audioFile, p.offsetMs);
    }

    // Presentation matches the on-screen grid: a background (the session
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

    // Rounded-corner alpha mask (white rounded rect on black), tile-sized
    const maskPath = path.join(raw, "cornermask.png");
    await ffmpeg(["-f", "lavfi", "-i", `color=black:s=${tileW}x${tileH}`, "-vf",
      `format=gray,geq=lum='lte(pow(max(0\\,max(${RAD}-X\\,X-(W-${RAD})))\\,2)+pow(max(0\\,max(${RAD}-Y\\,Y-(H-${RAD})))\\,2)\\,pow(${RAD}\\,2))*255'`,
      "-frames:v", "1", "-y", maskPath], "cornermask");

    // Background input: wallpaper if set, else the session colour. The
    // wallpaper is pre-scaled to the canvas once here (a single frame) so
    // the main graph doesn't re-scale a full-size image every frame.
    let bgIdx = inputIdx.size;
    if (rec.wallpaper && await exists(rec.wallpaper)) {
      const bgPre = path.join(raw, "bg.png");
      await ffmpeg(["-i", rec.wallpaper, "-vf",
        `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`,
        "-frames:v", "1", "-y", bgPre], "bg-prescale");
      args.push("-loop", "1", "-i", bgPre);
    } else {
      const hex = (rec.bg && /^#[0-9a-fA-F]{6}$/.test(rec.bg)) ? rec.bg.slice(1) : "14161a";
      args.push("-f", "lavfi", "-i", `color=c=0x${hex}:s=${W}x${H}`);
    }
    inputIdx.set("__bg", bgIdx);
    const maskIdx = inputIdx.size;
    args.push("-loop", "1", "-i", maskPath);
    inputIdx.set("__mask", maskIdx);

    // The host uploads each on-screen lower-third as a PNG (ffmpeg can't
    // draw text); overlay it bottom-left of the tile, like the DOM does
    for (const p of videos) { if (p.bannerFile) p.bnIdx = addInput(p.bannerFile, 0); }
    // Banner PNGs are drawn at 20px per cqw (tile = 2000px design width)
    // and now hug their text, so scale each by its own width, not a fixed
    // fraction of the tile
    const bannerScale = `scale=w=trunc(iw*${tileW}/4000)*2:h=-2`;

    const gp = [];
    gp.push(`[${bgIdx}:v]setsar=1[bg]`);
    gp.push(`[${maskIdx}:v]format=gray,scale=${tileW}:${tileH},setsar=1[mk];` +
      `[mk]split=${n}${videos.map((_, i) => `[m${i}]`).join("")}`);
    videos.forEach((p, i) => {
      let t = `[${p.vIdx}:v]scale=${tileW}:${tileH}:force_original_aspect_ratio=increase,` +
        `crop=${tileW}:${tileH}:(iw-${tileW})/2:(ih-${tileH})/2,setsar=1`;
      if (p.bnIdx != null) {
        t += `[tb${i}];[${p.bnIdx}:v]${bannerScale}[bn${i}];` +
          `[tb${i}][bn${i}]overlay=x=0:y=main_h-overlay_h:eof_action=repeat[tt${i}];` +
          `[tt${i}][m${i}]alphamerge[rt${i}]`;
      } else {
        t += `[tt${i}];[tt${i}][m${i}]alphamerge[rt${i}]`;
      }
      gp.push(t);
    });
    let prev = "[bg]";
    videos.forEach((_, i) => {
      const out = i === n - 1 ? "[vout]" : `[og${i}]`;
      gp.push(`${prev}[rt${i}]overlay=${positions[i].x}:${positions[i].y}${out}`);
      prev = out;
    });
    const grid = gp.join(";");
    // Episode-title chip, top-centre - same as it floats over the grid
    let finalLabel = "[vout]";
    let overlayFilters = "";
    const titleFile = rec.titleFile && path.join(raw, rec.titleFile);
    if (titleFile && await exists(titleFile)) {
      const ti = addInput(titleFile, 0);
      const pos = rec.titlePos || { x: 0.5, y: 0 };
      const px = Number(pos.x).toFixed(3), py = Number(pos.y).toFixed(3);
      overlayFilters += `;[${ti}:v]scale=286:-2[tls];${finalLabel}[tls]overlay=` +
        `x=(main_w-overlay_w)*${px}:y=(main_h-overlay_h)*${py}+14*(1-${py}):eof_action=repeat[vtl]`;
      finalLabel = "[vtl]";
    }
    // Bake in any overlays triggered during the recording
    (rec.overlays || []).forEach((ov, i) => {
      const t0 = (ov.offsetMs / 1000).toFixed(2);
      const dur = ov.kind === "subscribe" ? 6 : 18;
      const t1 = (Number(t0) + dur).toFixed(2);
      const oi = inputIdx.size;
      const slide = (m) =>
        `'main_h-(overlay_h+${m})*clip(min((t-${t0})/0.5\,(${t1}-t)/0.5)\,0\,1)'`;
      if (ov.kind === "subscribe") {
        args.push("-itsoffset", t0, "-i", path.join(ASSETS, "subscribe.mp4"));
        inputIdx.set(`__ov${i}`, oi);
        overlayFilters += `;[${oi}:v]scale=${W}:-2[ovs${i}];${finalLabel}[ovs${i}]overlay=x=0:y=${slide(0)}:eof_action=pass:enable='between(t\,${t0}\,${t1})'[vo${i}]`;
      } else if (ov.file) {
        args.push("-loop", "1", "-i", path.join(raw, ov.file));
        inputIdx.set(`__ov${i}`, oi);
        overlayFilters += `;[${oi}:v]scale=-2:150[ovs${i}];${finalLabel}[ovs${i}]overlay=x=main_w-overlay_w-24:y=${slide(24)}:eof_action=pass:enable='between(t\,${t0}\,${t1})'[vo${i}]`;
      } else { return; }
      finalLabel = `[vo${i}]`;
    });

    // Soundboard clips fired during the take: place each on a silent
    // timeline at its offset, mix them into one bus, then split it - one
    // copy folds into the combined audio, the other becomes a separate
    // lossless track the host can remix.
    let clipFilters = "";
    let clipMixLabel = null, clipOutLabel = null;
    const clipParts = [];
    (rec.clips || []).forEach((cl, i) => {
      const off = Math.max(0, Math.round(cl.offsetMs));
      const idx = inputIdx.size;
      args.push("-i", path.join(raw, cl.file));
      inputIdx.set(`__clip${i}`, idx);
      clipFilters += `;[${idx}:a]aresample=44100,aformat=channel_layouts=mono,adelay=${off}[clipin${i}]`;
      clipParts.push(`[clipin${i}]`);
    });
    if (clipParts.length) {
      const merged = clipParts.length === 1
        ? `${clipParts[0]}anull[clipall]`
        : `${clipParts.join("")}amix=inputs=${clipParts.length}:normalize=0:duration=longest[clipall]`;
      clipFilters += `;${merged};[clipall]asplit=2[clipmix][clipout]`;
      clipMixLabel = "[clipmix]";
      clipOutLabel = "[clipout]";
    }

    // Intro videos: each covers the whole frame for its window (scaled to
    // the composite size), crossfading in over the grid and back out, with
    // its audio fading with it. Positioned at its trigger time (setpts /
    // adelay) and overlaid last, so it sits above everything.
    const introW = W, introH = H;
    const XF = 0.4; // crossfade seconds each side
    const introAudioLabels = [];
    (rec.intros || []).forEach((iv, i) => {
      const off = Math.max(0, Math.round(iv.offsetMs));
      const t0s = off / 1000;
      const durS = Math.max(XF * 2 + 0.1, (iv.durationMs || 8000) / 1000);
      const t0 = t0s.toFixed(2);
      const t1 = (t0s + durS).toFixed(2);
      const fo = (durS - XF).toFixed(2); // fade-out start, in the intro's own time
      const idx = inputIdx.size;
      args.push("-i", path.join(raw, iv.file));
      inputIdx.set(`__intro${i}`, idx);
      // Alpha-fade the intro in and out, then shift it to its trigger time
      overlayFilters += `;[${idx}:v]scale=${introW}:${introH}:force_original_aspect_ratio=decrease,` +
        `pad=${introW}:${introH}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuva420p,` +
        `fade=t=in:st=0:d=${XF}:alpha=1,fade=t=out:st=${fo}:d=${XF}:alpha=1,setpts=PTS+${t0}/TB[introv${i}];` +
        `${finalLabel}[introv${i}]overlay=0:0:enable='between(t,${t0},${t1})':eof_action=pass[vintro${i}]`;
      finalLabel = `[vintro${i}]`;
      if (iv.hasAudio !== false) {
        clipFilters += `;[${idx}:a]aresample=44100,aformat=channel_layouts=mono,` +
          `afade=t=in:st=0:d=${XF},afade=t=out:st=${fo}:d=${XF},adelay=${off}[introa${i}]`;
        introAudioLabels.push(`[introa${i}]`);
      }
    });

    // Combined-audio mix = participants + the clip bus + intro audio.
    // Everything is folded to mono first (voices arrive as stereo with
    // the sound only in the left channel), so the mix and the MP4 are mono.
    audios.forEach((p, i) => { clipFilters += `;[${p.aIdx}:a]pan=mono|c0=c0[pmono${i}]`; });
    const mixLabels = audios.map((_, i) => `[pmono${i}]`);
    if (clipMixLabel) mixLabels.push(clipMixLabel);
    mixLabels.push(...introAudioLabels);
    // Split the final mix: one copy feeds the MP4's AAC track, the other
    // becomes a standalone lossless combined.flac - everyone's voice
    // (plus clips/intro audio) merged into one file, full quality.
    const amix = mixLabels.length === 0
      ? null
      : mixLabels.length === 1
        ? `${mixLabels[0]}asplit=2[aout][aoutflac]`
        : `${mixLabels.join("")}amix=inputs=${mixLabels.length}:normalize=0[aoutmix];[aoutmix]asplit=2[aout][aoutflac]`;

    // An intro fired near the very end can run slightly past the last
    // audio - don't let the hard cap clip it
    for (const iv of rec.intros || []) {
      maxEnd = Math.max(maxEnd, (iv.offsetMs || 0) / 1000 + (iv.durationMs || 8000) / 1000);
    }
    // Hard duration cap: the background is an endless looped source, and
    // -shortest doesn't reliably terminate it with browser-recorded WebM.
    // -t stops the muxer at the real session length no matter what.
    const capArgs = maxEnd > 0 ? ["-t", (maxEnd + 0.3).toFixed(2)] : [];

    await ffmpeg([
      ...args,
      "-filter_complex",
      grid + clipFilters + (amix ? ";" + amix : "") + overlayFilters,
      "-map", finalLabel, ...(amix ? ["-map", "[aout]"] : []),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      // MP4 (H.264/AAC) so it plays in any browser for preview and is a
      // universal download; +faststart moves the index up front for streaming
      "-movflags", "+faststart",
      ...capArgs,
      "-shortest",
      "-y", path.join(out, "combined.mp4"),
      // Lossless mixdown: everyone (plus clips/intro audio), one file,
      // full quality - the same mix as the MP4's audio track
      ...(amix
        ? ["-map", "[aoutflac]", "-c:a", "flac", ...capArgs, "-shortest", "-y", path.join(out, "combined.flac")]
        : []),
      // Separate soundboard track: clips only, on their timeline
      ...(clipOutLabel
        ? ["-map", clipOutLabel, "-c:a", "flac", "-y", path.join(out, "soundboard.flac")]
        : [])
    ], "combined");
    files.push("combined.mp4");
    if (amix) files.push("combined.flac");
    if (clipOutLabel) files.push("soundboard.flac");
  }

  return files;
}
