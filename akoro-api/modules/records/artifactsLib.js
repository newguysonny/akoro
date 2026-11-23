/**
 * modules/records/artifactsLib.js — what a learner makes in the reader, kept.
 *
 * Generated study tabs (summary / quiz / flashcards / podcast), notes,
 * annotations and hidden passages used to live in the reader's component
 * state and vanished when it closed. They are rows in edu.record_artifacts
 * now: private per (learner, document), restored when the reader reopens.
 *
 * The pure validators are exported for the contract test; db access is lazy.
 */

export const ARTIFACT_KINDS = Object.freeze(["summary", "quiz", "flashcards", "notes", "podcast", "annotation", "redaction"]);
export const ARTIFACT_LIMITS = Object.freeze({
  MAX_CONTENT_BYTES: 200_000,   // a 10-question quiz with progress is ~10 KB
  MAX_PARAMS_BYTES: 2_000,
  MAX_PER_DOCUMENT: 300,
  LIST_LIMIT: 300,
});

const jsonSize = (v) => {
  try { return Buffer.byteLength(JSON.stringify(v ?? null), "utf8"); } catch { return Infinity; }
};
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Validate a new artifact → { row } | { error }. `content` and `params` must
 * be plain objects within the size caps; page numbers are 1-based.
 */
export function validateArtifactInput(body = {}) {
  const kind = String(body.kind || "");
  if (!ARTIFACT_KINDS.includes(kind)) return { error: `kind must be one of: ${ARTIFACT_KINDS.join(", ")}.` };
  const params = body.params === undefined ? {} : body.params;
  const content = body.content === undefined ? {} : body.content;
  if (!isPlainObject(params) || jsonSize(params) > ARTIFACT_LIMITS.MAX_PARAMS_BYTES) return { error: "params must be a small object." };
  if (!isPlainObject(content)) return { error: "content must be an object." };
  if (jsonSize(content) > ARTIFACT_LIMITS.MAX_CONTENT_BYTES) return { error: "This item is too large to save." };
  const pageNumber = body.pageNumber == null ? null : Number(body.pageNumber);
  if (pageNumber !== null && (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 10_000)) return { error: "pageNumber must be a positive integer." };
  return { row: { kind, params, content, page_number: pageNumber, open: body.open === false ? false : true } };
}

/** Validate an update (content / params / open) → { patch } | { error }. */
export function validateArtifactPatch(body = {}) {
  const patch = {};
  if (body.content !== undefined) {
    if (!isPlainObject(body.content)) return { error: "content must be an object." };
    if (jsonSize(body.content) > ARTIFACT_LIMITS.MAX_CONTENT_BYTES) return { error: "This item is too large to save." };
    patch.content = body.content;
  }
  if (body.params !== undefined) {
    if (!isPlainObject(body.params) || jsonSize(body.params) > ARTIFACT_LIMITS.MAX_PARAMS_BYTES) return { error: "params must be a small object." };
    patch.params = body.params;
  }
  if (body.open !== undefined) patch.open = body.open === true;
  if (!Object.keys(patch).length) return { error: "Nothing to update." };
  return { patch: { ...patch, updated_at: new Date().toISOString() } };
}

export const toApiArtifact = (r) => ({
  id: r.id, kind: r.kind, pageNumber: r.page_number ?? null,
  params: r.params || {}, content: r.content || {}, open: r.open !== false,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

/* ── db (lazy) ─────────────────────────────────────────────────────────── */
const dbLazy = async () => (await import("../../db.js")).default;
const table = async () => (await dbLazy()).schema("edu").from("record_artifacts");
const COLS = "id, kind, page_number, params, content, open, created_at, updated_at";

export async function listArtifacts({ userId, recordId, folderId = null, contentKey = null }) {
  let q = (await table()).select(COLS).eq("user_id", userId);
  q = folderId ? q.eq("folder_id", folderId)
    : contentKey ? q.eq("content_key", contentKey)
      : q.eq("record_id", recordId);
  const { data, error } = await q
    .order("created_at", { ascending: true }).limit(ARTIFACT_LIMITS.LIST_LIMIT);
  if (error) throw error;
  return (data || []).map(toApiArtifact);
}

export async function createArtifact({ userId, recordId, folderId = null, contentKey = null, row }) {
  let countQ = (await table()).select("id", { count: "exact", head: true }).eq("user_id", userId);
  countQ = folderId ? countQ.eq("folder_id", folderId)
    : contentKey ? countQ.eq("content_key", contentKey)
      : countQ.eq("record_id", recordId);
  const { count } = await countQ;
  if ((count || 0) >= ARTIFACT_LIMITS.MAX_PER_DOCUMENT) {
    return { error: `You've saved ${ARTIFACT_LIMITS.MAX_PER_DOCUMENT} items on this document — delete some to save more.` };
  }
  const { data, error } = await (await table())
    .insert({ user_id: userId, ...(folderId ? { folder_id: folderId } : contentKey ? { content_key: contentKey } : { record_id: recordId }), ...row }).select(COLS).single();
  if (error) throw error;
  return { artifact: toApiArtifact(data) };
}

/** Owner-only: the row must belong to the learner, or nothing changes. */
export async function updateArtifact({ userId, id, patch }) {
  const { data, error } = await (await table()).update(patch)
    .eq("id", id).eq("user_id", userId).select(COLS).maybeSingle();
  if (error) throw error;
  return data ? toApiArtifact(data) : null;
}

/** Owner-only read of one item (with its raw content — server use). */
export async function getArtifactRow({ userId, id }) {
  const { data, error } = await (await table()).select(`${COLS}, record_id`)
    .eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Delete → the deleted row (kind + content, so a podcast's audio can go too), or null. */
export async function deleteArtifact({ userId, id }) {
  const { data, error } = await (await table()).delete()
    .eq("id", id).eq("user_id", userId).select("id, kind, content");
  if (error) throw error;
  return (data || [])[0] || null;
}

/** Podcasts are made by the server; the learner may only open/close them. */
export const SERVER_MADE_KINDS = Object.freeze(["podcast"]);
