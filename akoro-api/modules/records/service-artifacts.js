/**
 * modules/records/service-artifacts.js — saved reader items: generated
 * tabs, notes, annotations and two-voice study podcasts.
 *
 * A podcast is made in studyMaterial.js (shared with Agent Chat); this file
 * owns the HTTP orchestration and the owner-only checks around artifacts.
 */
import { speakBuffer } from "../voice/index.js";
import { createPresignedDownload, removeRecordFile, ownsRecordFileKey, putRecordObject } from "./lib/storage.js";
import { TOOL_LIMITS, parsePageSelection } from "./toolsLib.js";
import { startPodcast } from "./studyMaterial.js";
import {
  validateArtifactInput, validateArtifactPatch, listArtifacts as listArtifactRows,
  createArtifact as createArtifactRow, updateArtifact as updateArtifactRow,
  deleteArtifact as deleteArtifactRow, getArtifactRow, toApiArtifact, SERVER_MADE_KINDS,
} from "./artifactsLib.js";
import { podcastForClient } from "./podcastLib.js";
import { anchorOf } from "./rules.js";
import { res400 } from "./http.js";
import { resolveAskTarget } from "./service-ask.js";

// ─── Podcast: a two-voice study episode from the document ──────────────────
/*
 * A podcast item as the reader sees it: a lost job reads as failed, the
 * storage key stays here, and a ready episode gets a fresh audio URL (only
 * for a key under the learner's own prefix).
 */
export async function withPodcastAudio(a, userId) {
  if (a?.kind !== "podcast") return a;
  const raw = a.content?.podcast || {};
  const podcast = podcastForClient(a.content);
  if (podcast.status === "ready" && raw.audioKey && ownsRecordFileKey(raw.audioKey, userId)) {
    podcast.audioUrl = await createPresignedDownload(raw.audioKey).catch(() => null);
  }
  return { ...a, content: { ...a.content, podcast } };
}

/*
 * POST /api/records/podcast { recordId|contentKey, scope, pageNumber?, pageText?, values:{ focus, length } }
 * → 202 { artifact } — the item exists at once ("making"); the episode is
 * written, narrated and stored after the response, and the reader polls
 * GET /podcast/:id until it is ready (or failed).
 */
export async function createPodcast(req, res) {
  const target = await resolveAskTarget(req, req.body);
  if (target.status) return res.status(target.status).json({ success: false, message: target.message });

  const userId = req.user.id;
  const scope = ["document", "pages"].includes(req.body?.scope) ? req.body.scope : "page";
  const { pageNumbers, pageTexts } = parsePageSelection(req.body);
  if (scope === "pages" && !pageNumbers.length) return res400(res, "Choose at least one page.");
  const pageNumber = Number(req.body?.pageNumber);
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 ? pageNumber : null;
  const pageText = typeof req.body?.pageText === "string" ? req.body.pageText.slice(0, TOOL_LIMITS.MAX_PAGE_TEXT_CHARS) : "";
  const raw = req.body?.values && typeof req.body.values === "object" ? req.body.values : {};
  // The episode is written, narrated and stored after the response (studyMaterial.startPodcast).
  const out = await startPodcast({ userId, target, scope, pageNumber: page, pageNumbers, pageText, pageTexts, values: raw, deps: { speakBuffer, putRecordObject } });
  if (out.status) return res.status(out.status).json({ success: false, message: out.message, ...(out.code ? { code: out.code } : {}) });
  res.status(202).json({ success: true, data: { artifact: await withPodcastAudio(out.artifact, userId) } });
}

/* GET /api/records/podcast/:id — one podcast item (the reader polls it). */
export async function getPodcast(req, res) {
  const id = String(req.params.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res400(res, "A valid podcast id is required.");
  const row = await getArtifactRow({ userId: req.user.id, id });
  if (!row || row.kind !== "podcast") return res.status(404).json({ success: false, message: "Podcast not found." });
  res.json({ success: true, data: { artifact: await withPodcastAudio(toApiArtifact(row), req.user.id) } });
}

// ─── Saved reader items: generated tabs, notes, annotations ─────────────────
/* GET /api/records/artifacts?recordId=|contentKey= — the learner's items on this document. */
export async function listArtifacts(req, res) {
  const target = await resolveAskTarget(req, req.query);
  if (target.status) return res.status(target.status).json({ success: false, message: target.message });
  const list = await listArtifactRows({ userId: req.user.id, ...anchorOf(target) });
  res.json({ success: true, data: { artifacts: await Promise.all(list.map((a) => withPodcastAudio(a, req.user.id))) } });
}

/* POST /api/records/artifacts { recordId|contentKey, kind, pageNumber?, params?, content?, open? } */
export async function createArtifact(req, res) {
  const target = await resolveAskTarget(req, req.body);
  if (target.status) return res.status(target.status).json({ success: false, message: target.message });
  const v = validateArtifactInput(req.body);
  if (v.error) return res400(res, v.error);
  if (SERVER_MADE_KINDS.includes(v.row.kind)) return res400(res, "Podcasts are made with the Podcast tool.");
  const out = await createArtifactRow({ userId: req.user.id, ...anchorOf(target), row: v.row });
  if (out.error) return res.status(409).json({ success: false, message: out.error });
  res.status(201).json({ success: true, data: { artifact: out.artifact } });
}

/* PATCH /api/records/artifacts/:id { content?, params?, open? } — owner only. */
export async function patchArtifact(req, res) {
  const id = String(req.params.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res400(res, "A valid artifact id is required.");
  const v = validateArtifactPatch(req.body);
  if (v.error) return res400(res, v.error);
  // A server-made item (a podcast — its content names a stored file) can
  // only be opened or closed; its content is never the client's to write.
  if (v.patch.content !== undefined || v.patch.params !== undefined) {
    const row = await getArtifactRow({ userId: req.user.id, id });
    if (!row) return res.status(404).json({ success: false, message: "Item not found." });
    if (SERVER_MADE_KINDS.includes(row.kind)) return res400(res, "This item can only be opened or closed.");
  }
  const artifact = await updateArtifactRow({ userId: req.user.id, id, patch: v.patch });
  if (!artifact) return res.status(404).json({ success: false, message: "Item not found." });
  res.json({ success: true, data: { artifact: await withPodcastAudio(artifact, req.user.id) } });
}

/* DELETE /api/records/artifacts/:id — owner only. */
export async function deleteArtifact(req, res) {
  const id = String(req.params.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res400(res, "A valid artifact id is required.");
  const gone = await deleteArtifactRow({ userId: req.user.id, id });
  if (!gone) return res.status(404).json({ success: false, message: "Item not found." });
  const audioKey = gone.kind === "podcast" ? gone.content?.podcast?.audioKey : null;
  if (audioKey && ownsRecordFileKey(audioKey, req.user.id)) void removeRecordFile(audioKey);
  res.json({ success: true });
}
