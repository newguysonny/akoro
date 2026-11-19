/**
 * modules/pharmd/contentKey.js — versioned identity for a topic PDF.
 *
 * The parse cache is keyed by the file's identity, not just its path: when a
 * catalogue PDF is replaced at the same Storage path, the bytes change and the
 * old markdown must not be served. The key is
 *
 *   pharmd:<stored path>[#<content hash>]
 *
 * The hash is the SHA-256 of the uploaded bytes (32 hex chars), written by the
 * uploader and backfilled for older rows. Topics without a hash keep the
 * legacy path-only key, so nothing breaks before the backfill runs.
 */

export const PHARMD_PREFIX = "pharmd:";

/** The canonical key for a topic row ({ file_path, file_hash }). */
export function pharmdContentKey(topic) {
  const path = String(topic?.file_path || "");
  if (!path) return null;
  const hash = String(topic?.file_hash || "").trim();
  return `${PHARMD_PREFIX}${path}${hash ? `#${hash}` : ""}`;
}

/** Split a key into { path, hash } (hash null for legacy path-only keys). */
export function parsePharmdKey(key) {
  const raw = String(key || "");
  if (!raw.startsWith(PHARMD_PREFIX)) return null;
  const body = raw.slice(PHARMD_PREFIX.length);
  const at = body.indexOf("#");
  if (at < 0) return { path: body, hash: null };
  return { path: body.slice(0, at), hash: body.slice(at + 1) || null };
}
