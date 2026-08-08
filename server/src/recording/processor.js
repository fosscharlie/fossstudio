// Post-processing: per-participant FLAC + one combined grid MKV.
// Runs after the session ends — speed doesn't matter, so everything is
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
      await ffmpeg(["-i", part.audioFile, "-map", "0:a:0", "-c:a", "flac", "-y", path.join(out, flac)],
        `flac ${name}`);
      files.push(flac);
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

    const cols = Math.ceil(Math.sqrt(videos.length));
    const rows = Math.ceil(videos.length / cols);
    const cellW = 2 * Math.round(1280 / cols / 2);
    const cellH = 2 * Math.round(720 / rows / 2);

    // The host uploads each on-screen lower-third as a PNG (ffmpeg can't
    // draw text); overlay it bottom-left of the tile, like the DOM does
    for (const p of videos) {
      if (p.bannerFile) p.bnIdx = addInput(p.bannerFile, 0);
    }
    const bannerW = 2 * Math.round(0.38 * cellW / 2);
    const scaled = videos.map((p, i) => {
      const base = `[${p.vIdx}:v]scale=${cellW}:${cellH}:force_original_aspect_ratio=increase,` +
        `crop=${cellW}:${cellH}:(iw-${cellW})/2:(ih-${cellH})/2,setsar=1`;
      if (p.bnIdx == null) return `${base}[v${i}]`;
      return `${base}[t${i}];[${p.bnIdx}:v]scale=${bannerW}:-2[bn${i}];` +
        `[t${i}][bn${i}]overlay=x=0:y=main_h-overlay_h:eof_action=repeat[v${i}]`;
    }).join(";");
    // Balanced centred rows, matching the on-screen layout (7 = 3+2+2)
    const nRows = Math.ceil(videos.length / cols);
    const rBase = Math.floor(videos.length / nRows), rExtra = videos.length % nRows;
    const rowSizes = Array.from({ length: nRows }, (_, r) => rBase + (r < rExtra ? 1 : 0));
    const layout = [];
    rowSizes.forEach((size, r) => {
      const xoff = Math.round((cols * cellW - size * cellW) / 2);
      for (let cix = 0; cix < size; cix++) layout.push(`${xoff + cix * cellW}_${r * cellH}`);
    });
    const stack = videos.length === 1
      ? `[v0]copy[vout]`
      : `${videos.map((p, i) => `[v${i}]`).join("")}xstack=inputs=${videos.length}:layout=${layout.join("|")}:fill=black[vout]`;
    // Episode-title chip, top-centre — same as it floats over the grid
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
        overlayFilters += `;[${oi}:v]scale=${cols * cellW}:-2[ovs${i}];${finalLabel}[ovs${i}]overlay=x=0:y=${slide(0)}:eof_action=pass:enable='between(t\,${t0}\,${t1})'[vo${i}]`;
      } else if (ov.file) {
        args.push("-loop", "1", "-i", path.join(raw, ov.file));
        inputIdx.set(`__ov${i}`, oi);
        overlayFilters += `;[${oi}:v]scale=-2:150[ovs${i}];${finalLabel}[ovs${i}]overlay=x=main_w-overlay_w-24:y=${slide(24)}:eof_action=pass:enable='between(t\,${t0}\,${t1})'[vo${i}]`;
      } else { return; }
      finalLabel = `[vo${i}]`;
    });

    // Soundboard clips fired during the take: place each on a silent
    // timeline at its offset, mix them into one bus, then split it — one
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
      clipFilters += `;[${idx}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${off}|${off}[clipin${i}]`;
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
    const introW = cols * cellW, introH = nRows * cellH;
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
        clipFilters += `;[${idx}:a]aresample=44100,aformat=channel_layouts=stereo,` +
          `afade=t=in:st=0:d=${XF},afade=t=out:st=${fo}:d=${XF},adelay=${off}|${off}[introa${i}]`;
        introAudioLabels.push(`[introa${i}]`);
      }
    });

    // Combined-audio mix = participants + the clip bus + intro audio
    const mixLabels = audios.map((p) => `[${p.aIdx}:a]`);
    if (clipMixLabel) mixLabels.push(clipMixLabel);
    mixLabels.push(...introAudioLabels);
    const amix = mixLabels.length === 0
      ? null
      : mixLabels.length === 1
        ? `${mixLabels[0]}anull[aout]`
        : `${mixLabels.join("")}amix=inputs=${mixLabels.length}:normalize=0[aout]`;

    await ffmpeg([
      ...args,
      "-filter_complex",
      [scaled, stack].filter(Boolean).join(";") + clipFilters +
        (amix ? ";" + amix : "") + overlayFilters,
      "-map", finalLabel, ...(amix ? ["-map", "[aout]"] : []),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      // MP4 (H.264/AAC) so it plays in any browser for preview and is a
      // universal download; +faststart moves the index up front for streaming
      "-movflags", "+faststart",
      "-y", path.join(out, "combined.mp4"),
      // Separate soundboard track: clips only, on their timeline
      ...(clipOutLabel
        ? ["-map", clipOutLabel, "-c:a", "flac", "-y", path.join(out, "soundboard.flac")]
        : [])
    ], "combined");
    files.push("combined.mp4");
    if (clipOutLabel) files.push("soundboard.flac");
  }

  return files;
}
