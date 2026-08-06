// Post-processing: per-participant FLAC + one combined grid MKV.
// Runs after the session ends — speed doesn't matter, so everything is
// niced right down to keep live calls smooth.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { recDir } from "./manager.js";

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

  for (const [, p] of rec.peers) {
    const name = safeName(p.name, used);
    const audioFile = rec.mode === "server"
      ? (p.files.server && path.join(raw, p.files.server))
      : (p.files.audio && path.join(raw, p.files.audio));
    const videoFile = rec.mode === "server"
      ? audioFile
      : (p.files.video && path.join(raw, p.files.video));
    const part = {
      name,
      offsetMs: p.startOffsetMs || 0,
      audioFile: audioFile && await exists(audioFile) ? audioFile : null,
      videoFile: videoFile && await exists(videoFile) ? videoFile : null
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

  // Combined grid MKV: video tiles stacked, all audio mixed
  const videos = parts.filter((p) => p.videoFile);
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

    const scaled = videos.map((p, i) =>
      `[${p.vIdx}:v]scale=${cellW}:${cellH}:force_original_aspect_ratio=increase,` +
      `crop=${cellW}:${cellH}:(iw-${cellW})/2:0,setsar=1[v${i}]`).join(";");
    const layout = videos.map((p, i) =>
      `${(i % cols) * cellW}_${Math.floor(i / cols) * cellH}`);
    const stack = videos.length === 1
      ? `[v0]copy[vout]`
      : `${videos.map((p, i) => `[v${i}]`).join("")}xstack=inputs=${videos.length}:layout=${layout.join("|")}:fill=black[vout]`;
    const amix = audios.length === 0
      ? null
      : audios.length === 1
        ? `[${audios[0].aIdx}:a]anull[aout]`
        : `${audios.map((p) => `[${p.aIdx}:a]`).join("")}amix=inputs=${audios.length}:normalize=0[aout]`;

    await ffmpeg([
      ...args,
      "-filter_complex", [scaled, stack, amix].filter(Boolean).join(";"),
      "-map", "[vout]", ...(amix ? ["-map", "[aout]"] : []),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac", "-b:a", "192k",
      "-y", path.join(out, "combined.mkv")
    ], "combined");
    files.push("combined.mkv");
  }

  return files;
}
