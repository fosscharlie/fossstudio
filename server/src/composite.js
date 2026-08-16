// Geometry shared by the two things that composite a session into
// video: the recording processor and the live stream. Both draw the
// same picture, so anything that decides how big something lands in
// the frame belongs here rather than being written out twice.

// The episode logo/title block, as a fraction of frame width. The
// browser sizes the on-screen block by the same fraction of the video
// area (see --title-w in session.css), which is what keeps the
// recording looking like the screen people were actually on.
export const TITLE_WIDTH_FRACTION = 286 / 1280;

// Host-resizable between half and double size; ffmpeg needs an even
// width for yuv420p, so round to one.
export function titleWidth(scale, frameWidth = 1280) {
  const s = Math.min(2, Math.max(0.5, Number(scale) || 1));
  return Math.round(frameWidth * TITLE_WIDTH_FRACTION * s / 2) * 2;
}
