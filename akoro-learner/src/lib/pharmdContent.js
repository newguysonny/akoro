/**
 * PHARM.D shared-extraction identity.
 *
 * The server keys a catalogue file's parse by `pharmd:<stored path>`
 * (e.g. `pharmd:BIO 111/01 - Cell Structure and Organization.pdf`). Topics
 * normally carry `contentKey`, but a stale cached course payload may not —
 * then derive it from the public file URL, which ends with
 * `/object/public/pharmd-courses/<path>`.
 */

const PUBLIC_PHARMD = /\/object\/public\/pharmd-courses\/([^?#]+)/i;

export function pharmdContentKey(topic) {
  if (topic?.contentKey) return String(topic.contentKey);
  const url = String(topic?.file_url || "");
  const m = url.match(PUBLIC_PHARMD);
  if (!m) return null;
  try {
    return `pharmd:${decodeURIComponent(m[1])}`;
  } catch {
    return `pharmd:${m[1]}`;
  }
}

/* A local marker so a flaky cache read on refresh cannot make us ask for an
   extraction that already finished. It is a hint only: the server cache is
   still the truth. */
const MARK = "akoro_pharmd_parsed:";

export function markPharmdParsed(key) {
  if (!key) return;
  try { localStorage.setItem(MARK + key, "1"); } catch { /* private mode */ }
}

export function hasPharmdParsedMark(key) {
  if (!key) return false;
  try { return localStorage.getItem(MARK + key) === "1"; } catch { return false; }
}
