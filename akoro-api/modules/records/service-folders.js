/**
 * modules/records/service-folders.js — the shelf's organization layer:
 * folders and the items "Add to folder" puts inside them.
 *
 * Every target folder is verified to be the learner's own before a write;
 * item adds are bulk over those verified ids and keep the per-folder cap.
 */
import { createPresignedDownload, removeRecordFile, ownsRecordFileKey } from "./lib/storage.js";
import {
  MAX_FOLDERS, MAX_FOLDER_NAME, MAX_FOLDER_DESC, MAX_FOLDER_ITEMS,
  pageParams, encodeCursor, normalizeItemPayload,
} from "./rules.js";
import { res200, res201, res400, res403, res404 } from "./http.js";
import * as store from "./store-folders.js";

const folderToApi = async (f, itemCount = 0) => ({
  id: f.id,
  name: f.name,
  description: f.description || "",
  visibility: f.visibility,
  itemCount,
  coverUrl: f.cover_key
    ? await createPresignedDownload(f.cover_key).catch(() => null)  // a storage hiccup degrades the cover, never the list
    : null,
  createdAt: f.created_at,
});

/* Item counts for a learner's folders in one query (the folder list
   renders them; a folder holds ≤ 200 items so this stays small). */
async function folderItemCounts(userId) {
  const { data } = await store.folderItemCounts(userId);
  const counts = new Map();
  for (const row of data || []) counts.set(row.folder_id, (counts.get(row.folder_id) || 0) + 1);
  return counts;
}

// ─── GET /api/records/folders — my folders, newest first ───────────────────
export async function listFolders(req, res) {
  const { paged, limit, cursor } = pageParams(req, 20, 100);
  const { data, error } = await store.listFolders({ userId: req.user.id, limit: paged ? limit : MAX_FOLDERS, cursor });
  if (error) throw error;
  const rows = data || [];
  const counts = await folderItemCounts(req.user.id).catch(() => new Map());
  const mapped = await Promise.all(rows.map((f) => folderToApi(f, counts.get(f.id) || 0)));
  if (!paged) return res200(res, mapped);
  const { count } = await store.countFolders(req.user.id);
  return res200(res, {
    folders: mapped,
    total: count ?? rows.length,
    nextCursor: rows.length === limit ? encodeCursor(rows[rows.length - 1]) : null,
  });
}

// ─── POST /api/records/folders — create one ────────────────────────────────
export async function createFolder(req, res) {
  const userId = req.user.id;
  const body = req.body || {};

  const name = String(body.name || "").trim();
  if (!name) return res400(res, "A folder name is required.");
  if (name.length > MAX_FOLDER_NAME) return res400(res, "Folder names are capped at 100 characters.");
  const description = String(body.description || "").trim();
  if (description.length > MAX_FOLDER_DESC) return res400(res, "Descriptions are capped at 500 characters.");
  const visibility = body.visibility === "public" ? "public" : "private";

  // A cover, when given, must be the learner's own freshly-uploaded image.
  let coverKey = String(body.coverKey || "").trim();
  if (coverKey) {
    if (!ownsRecordFileKey(coverKey, userId)) return res403(res, "That cover image does not belong to you.");
    coverKey = coverKey.slice(0, 500);
  } else {
    coverKey = null;
  }

  const { count } = await store.countFoldersForCreate(userId);
  if ((count || 0) >= MAX_FOLDERS) return res400(res, `You already have ${MAX_FOLDERS} folders — that's the cap.`);

  const { data, error } = await store.insertFolder({ user_id: userId, name, description: description || null, cover_key: coverKey, visibility });
  if (error) {
    if (/duplicate key|unique/i.test(String(error.message || ""))) {
      return res400(res, "You already have a folder with that name.");
    }
    throw error;
  }
  res201(res, await folderToApi(data));
}

// ─── PATCH /api/records/folders/:id — rename (and re-describe/re-visibility) ─
export async function updateFolder(req, res) {
  const userId = req.user.id;
  const { data: existing } = await store.getFolderOwner(req.params.id);
  if (!existing) return res404(res, "Folder not found.");
  if (existing.user_id !== userId) return res403(res, "Not your folder.");

  const patch = { updated_at: new Date().toISOString() };
  if (req.body?.name !== undefined) {
    const name = String(req.body.name || "").trim();
    if (!name) return res400(res, "A folder name is required.");
    if (name.length > MAX_FOLDER_NAME) return res400(res, "Folder names are capped at 100 characters.");
    patch.name = name;
  }
  if (req.body?.description !== undefined) {
    const description = String(req.body.description || "").trim();
    if (description.length > MAX_FOLDER_DESC) return res400(res, "Descriptions are capped at 500 characters.");
    patch.description = description || null;
  }
  if (req.body?.visibility !== undefined) {
    patch.visibility = req.body.visibility === "public" ? "public" : "private";
  }

  const { data, error } = await store.updateFolder(req.params.id, patch);
  if (error) {
    if (/duplicate key|unique/i.test(String(error.message || ""))) {
      return res400(res, "You already have a folder with that name.");
    }
    throw error;
  }
  res200(res, await folderToApi(data));
}

// ─── DELETE /api/records/folders/:id — row + best-effort cover object ───────
export async function deleteFolder(req, res) {
  const { data: existing } = await store.getFolderForDelete(req.params.id);
  if (!existing) return res404(res, "Folder not found.");
  if (existing.user_id !== req.user.id) return res403(res, "Not your folder.");

  const { error } = await store.deleteFolder(req.params.id);
  if (error) throw error;
  void removeRecordFile(existing.cover_key);  // best-effort — the row is gone either way
  res.status(200).json({ success: true, data: { id: req.params.id } });
}

/* ── Folder items ──────────────────────────────────────────────────────────
   Anything can land in a folder: a record, a Pharm.D topic, a course
   lesson, a library shelf item. The display snapshot (title, sub,
   kind, link) is stored at ADD time — the folder page renders without
   re-querying every surface, and an item keeps its shape even if the
   source row later changes. */

// ─── GET /api/records/folders/:id/items — the folder's contents ────────────
export async function listFolderItems(req, res) {
  const { data: existing } = await store.getFolderOwner(req.params.id);
  if (!existing) return res404(res, "Folder not found.");
  if (existing.user_id !== req.user.id) return res403(res, "Not your folder.");

  const { paged, limit, cursor } = pageParams(req, 20, 100);
  const { data, error } = await store.listFolderItems({ folderId: req.params.id, limit: paged ? limit : MAX_FOLDER_ITEMS, cursor });
  if (error) throw error;
  const rows = (data || []).map((it) => ({
    id: it.id, itemType: it.item_type, itemRef: it.item_ref,
    title: it.title, sub: it.sub || "", kind: it.kind || "topic",
    link: it.link || null, createdAt: it.created_at,
  }));
  if (!paged) return res200(res, rows);
  const { count } = await store.countFolderItems(req.params.id);
  return res200(res, {
    items: rows,
    total: count ?? rows.length,
    nextCursor: rows.length === limit ? encodeCursor(data[data.length - 1]) : null,
  });
}

// ─── POST /api/records/folders/items — add one thing to N folders ──────────
// The Add-to-folder page multi-selects folders for a single item, so the
// write is bulk over the learner's own folder ids. Idempotent per folder
// (UNIQUE (folder_id, item_type, item_ref) + upsert-on-conflict).
export async function addFolderItems(req, res) {
  const userId = req.user.id;
  const body = req.body || {};

  const folderIds = [...new Set(Array.isArray(body.folderIds) ? body.folderIds.map(String) : [])];
  if (!folderIds.length) return res400(res, "Pick at least one folder.");
  if (folderIds.length > MAX_FOLDERS) return res400(res, "Too many folders selected.");

  const { error: itemErr, row } = normalizeItemPayload(body);
  if (itemErr) return res400(res, itemErr);

  // Every target folder must be the learner's own.
  const { data: owned } = await store.listOwnedFolders({ userId, folderIds });
  const ownedIds = new Set((owned || []).map((f) => f.id));
  if (ownedIds.size !== folderIds.length) return res403(res, "One of those folders isn't yours.");

  for (const folderId of folderIds) {
    // Respect the per-folder cap on every target.
    const { count } = await store.countItemsInFolder(folderId);
    if ((count || 0) >= MAX_FOLDER_ITEMS) {
      return res400(res, `A folder is full (${MAX_FOLDER_ITEMS} items) — remove one first.`);
    }
    const { error } = await store.upsertFolderItem({ folder_id: folderId, user_id: userId, ...row });
    if (error) throw error;
  }
  const names = (owned || []).map((f) => f.name);
  res201(res, { added: folderIds.length, folders: names });
}
