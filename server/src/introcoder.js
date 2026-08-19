// Intro videos are bounded at upload: whatever arrives is converted to
// 720p H.264/AAC MP4. The whole pipeline is 720p anyway (the stream and
// the recording canvas both are), so nothing is lost - and every
// guest's browser gets a video it can decode cheaply, usually in
// hardware. An unbounded upload (4K, high framerate, VP9/HEVC/AV1)
// software-decoding fullscreen on top of WebRTC and noise suppression
// is exactly what froze a real host's machine mid-show once.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export function probeMedia(file) {
  return new Promise((resolve) => {
    let out = "";
    const p = spawn("ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
    p.stdout.on("data", (d) => { out += d; });
    p.on("error", () => resolve({ durationMs: 0, hasAudio: true, videoCodec: "", height: 0 }));
    p.on("close", () => {
      try {
        const j = JSON.parse(out);
        const video = (j.streams || []).find((s) => s.codec_type === "video");
        resolve({
          durationMs: Math.round(parseFloat(j.format?.duration || 0) * 1000) || 0,
          hasAudio: (j.streams || []).some((s) => s.codec_type === "audio"),
          videoCodec: video?.codec_name || "",
          height: video?.height || 0
        });
      } catch { resolve({ durationMs: 0, hasAudio: true, videoCodec: "", height: 0 }); }
    });
  });
}

// 720p cap keeping the shape, even dimensions for yuv420p, 30fps cap.
// Audio is levelled to speech loudness (EBU R128, -16 LUFS) in the same
// pass, like every other clip in the app.
export function transcodeIntro(src, dst, hasAudio) {
  return new Promise((resolve, reject) => {
    const p = spawn("nice", ["-n", "10", "ffmpeg", "-nostdin", "-loglevel", "error", "-i", src,
      "-vf", "scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
      ...(hasAudio
        ? ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "128k"]
        : ["-an"]),
      "-movflags", "+faststart",
      // Explicit format: the migration writes to a .converting temp
      // name, which ffmpeg cannot guess a muxer from
      "-f", "mp4",
      "-y", dst]);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`intro transcode exited ${code}`))));
  });
}

// Already within bounds: H.264 in MP4, 720p or smaller. Anything else
// gets converted - and only then, so the server never re-encodes video
// that is already cheap for every guest to decode.
export function needsConversion(ext, probe) {
  return ext !== "mp4" || probe.videoCodec !== "h264" || probe.height > 720;
}

// One-time pass over intros uploaded before the bound existed: convert
// them in place and point their records at the new file. Runs after
// boot, niced, one at a time - a failure leaves that intro as it was.
export async function migrateIntros() {
  const { listUsers, getUserSettings, updateUserSettings } = await import("./users.js");
  const dir = path.join(config.dataDir, "uploads");
  let converted = 0;
  for (const user of await listUsers()) {
    const settings = await getUserSettings(user.id);
    const intros = Array.isArray(settings.intros) ? settings.intros : [];
    let changed = false;
    for (const clip of intros) {
      const file = path.join(dir, `intro-${user.id}-${clip.id}.${clip.ext}`);
      const exists = await fs.access(file).then(() => true, () => false);
      if (!exists) continue;
      const probe = await probeMedia(file);
      if (!probe.videoCodec || !needsConversion(clip.ext, probe)) continue;
      const dst = path.join(dir, `intro-${user.id}-${clip.id}.mp4.converting`);
      try {
        await transcodeIntro(file, dst, probe.hasAudio);
        await fs.rename(dst, path.join(dir, `intro-${user.id}-${clip.id}.mp4`));
        if (clip.ext !== "mp4") await fs.unlink(file).catch(() => {});
        clip.ext = "mp4";
        changed = true;
        converted++;
        console.log(`intro converted to bounded 720p H.264: ${clip.name} (${user.username})`);
      } catch (err) {
        await fs.unlink(dst).catch(() => {});
        console.error(`intro conversion failed for ${clip.name}: ${err.message} - kept as-is`);
      }
    }
    if (changed) await updateUserSettings(user.id, { intros });
  }
  return converted;
}
