/**
 * podcastTimeline — follow a podcast episode turn by turn.
 *
 * The server joins one MP3 per turn and reports each turn's byte range.
 * OpenAI's MP3 is constant bit-rate, so a byte fraction is a time fraction:
 * near-exact, and it needs no decoding. These map between the two.
 */

/** The turn playing at `time` seconds of `duration` → its index, or -1. */
export function turnAt(segments, totalBytes, time, duration) {
  if (!Array.isArray(segments) || !segments.length || !(totalBytes > 0) || !(duration > 0)) return -1;
  const byte = Math.max(0, Math.min(1, time / duration)) * totalBytes;
  for (let i = 0; i < segments.length; i++) if (byte < segments[i].byteEnd) return i;
  return segments.length - 1;
}

/** Where turn i starts, in seconds of `duration`. */
export function turnStart(segments, totalBytes, i, duration) {
  const seg = segments?.[i];
  if (!seg || !(totalBytes > 0) || !(duration > 0)) return 0;
  return (seg.byteStart / totalBytes) * duration;
}

/** 42 → "0:42", 125 → "2:05". */
export const clock = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};
