// Catalogue files (PHARM.D topics / programme materials) are not learner
// records: they live in the `pharmd-courses` storage bucket (occasionally
// another Supabase bucket, or R2) and are addressed by `pharmd:<path>#<hash>`
// content keys. Extraction covered only record files, so opening an
// un-extracted catalogue PDF and tapping Extract answered "This record has no
// stored file to recognise." These helpers resolve a catalogue key to readable
// bytes (OCR) or a temporary URL (stored-text read).
import { parsePharmdKey } from "../../lib/contentKey.js";
import { createPresignedDownload, readFileObject } from "./lib/storage.js";

const dbLazy = async () => (await import("../../db.js")).default;

/** contentKey → { path, buckets, name, mime } | null. */
export async function catalogueFileFor(contentKey) {
  const parsed = parsePharmdKey(contentKey);
  if (!parsed?.path) return null;
  let topic = null;
  try {
    const db = await dbLazy();
    const { data } = await db.schema("edu").from("pharmd_topics")
      .select("title, file_bucket, file_path, file_mime").eq("file_path", parsed.path).maybeSingle();
    topic = data;
  } catch { /* a lookup hiccup still lets R2 answer by path */ }
  const path = topic?.file_path || parsed.path;
  const base = String(topic?.title || "PHARMD topic").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 120);
  return {
    path,
    buckets: [...new Set([topic?.file_bucket, "pharmd-courses"].filter(Boolean))],
    name: /\.pdf$/i.test(base) ? base : `${base}.pdf`,
    mime: topic?.file_mime || "application/pdf",
  };
}

/** The catalogue file's bytes, Supabase buckets first, then R2. */
export async function readCatalogueFile(contentKey) {
  const file = await catalogueFileFor(contentKey);
  if (!file) return null;
  try {
    const db = await dbLazy();
    for (const bucket of file.buckets) {
      try {
        const { data, error } = await db.storage.from(bucket).download(file.path);
        if (!error && data) return { ...file, buffer: Buffer.from(await data.arrayBuffer()) };
      } catch { /* try the next store */ }
    }
  } catch { /* fall through to R2 */ }
  try {
    const { body, contentType } = await readFileObject(file.path);
    return { ...file, buffer: body, mime: contentType || file.mime };
  } catch { return null; }
}

/** A short-lived URL for the catalogue file (stored-text/stat reads). */
export async function catalogueDownloadUrl(contentKey) {
  const file = await catalogueFileFor(contentKey);
  if (!file) return null;
  try {
    const db = await dbLazy();
    for (const bucket of file.buckets) {
      try {
        const { data } = await db.storage.from(bucket).createSignedUrl(file.path, 6 * 60 * 60);
        if (data?.signedUrl) return data.signedUrl;
      } catch { /* try the next store */ }
    }
  } catch { /* fall through to R2 */ }
  try { return await createPresignedDownload(file.path, { downloadName: file.name }); }
  catch { return null; }
}
