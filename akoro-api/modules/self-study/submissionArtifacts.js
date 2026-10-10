/**
 * modules/self-study/submissionArtifacts.js — build, store and serve a
 * submission's PDF (for people) and markdown (for machines).
 *
 * Built right after the learner submits (POST /:id/complete), stored under
 * the learner's prefix in object storage, and recorded on the target as
 * submission_pdf { key, mdKey, size, pages, builtFor, builtAt, notes }.
 * builtFor is the submission's submittedAt: if the learner resubmits, the
 * stored copy no longer matches and the next read rebuilds it. Anyone
 * opening it before the build lands gets one built on the spot.
 */
import db from "../../db.js";
import { buildSubmissionPdf, submissionMarkdown } from "./submissionPdf.js";
import { readSubmissionFile, sniffSubmissionFile, removeSubmissionObject } from "./submissionFiles.js";
import { putRecordObject, createPresignedDownload } from "../records/lib/storage.js";
import { downloadCapped, docxToPages } from "../records/officeText.js";
import { pdfIsCurrent } from "./submissionView.js";

const edu = () => db.schema("edu");
const inFlight = new Map();   // targetId → Promise — one build at a time per submission

/** The text an attachment contributes to the markdown copy (or null). */
async function attachmentText(kind, bytes) {
  try {
    if (kind === "text") return Buffer.from(bytes).toString("utf8").replace(/^﻿/, "");
    if (kind === "docx") return docxToPages(bytes).map((p) => p.markdown).join("\n\n");
    if (kind === "pdf") {
      const { pdfTextPages } = await import("../records/storedText.js");
      const { pages, scanned } = await pdfTextPages(bytes);
      return scanned ? null : pages.map((p) => p.markdown).join("\n\n");
    }
  } catch { /* unreadable — the PDF still carries it */ }
  return null;
}

/** Load everything a build needs for one target. */
async function loadSubmission(targetId) {
  const { data: target } = await edu().from("self_study_targets")
    .select("id, assignment_id, student_id, status, submission, submission_pdf").eq("id", targetId).maybeSingle();
  if (!target) return null;
  const [{ data: assignment }, { data: learner }] = await Promise.all([
    edu().from("self_study_assignments").select("id, title, type, subject, topic, details, due_at").eq("id", target.assignment_id).maybeSingle(),
    db.from("users").select("full_name, username").eq("id", target.student_id).maybeSingle(),
  ]);
  const ids = (target.submission?.files || []).map((f) => f.id).filter(Boolean);
  const { data: rows } = ids.length
    ? await edu().from("self_study_files").select("id, name, size, mime, kind, storage_key, data").eq("target_id", target.id).in("id", ids)
    : { data: [] };
  const byId = new Map((rows || []).map((r) => [r.id, r]));
  return { target, assignment: assignment || {}, learner: { name: learner?.full_name, username: learner?.username }, fileRows: ids.map((id) => byId.get(id)).filter(Boolean) };
}


/**
 * Build both copies for a target and store them. → { bytes, markdown, meta }
 * Storage failing never fails the build: the bytes still come back (meta.key null).
 */
export function buildSubmissionArtifacts(targetId) {
  if (inFlight.has(targetId)) return inFlight.get(targetId);
  const job = (async () => {
    const loaded = await loadSubmission(targetId);
    if (!loaded) throw new Error("Submission not found.");
    const { target, assignment, learner, fileRows } = loaded;
    const files = [];
    for (const row of fileRows) {
      try {
        const bytes = await readSubmissionFile(row);
        const kind = row.kind || sniffSubmissionFile(bytes, row.name)?.kind || "other";
        files.push({ name: row.name, size: row.size || bytes.length, kind, bytes, text: await attachmentText(kind, bytes) });
      } catch (e) {
        files.push({ name: row.name, size: row.size || 0, kind: "missing", bytes: Buffer.alloc(0), text: null });
      }
    }
    const input = { assignment, learner, submission: target.submission || {}, files };
    const { bytes, pages, notes } = await buildSubmissionPdf(input);
    const markdown = submissionMarkdown(input);

    let key = null, mdKey = null;
    try {
      key = await putRecordObject({ userId: target.student_id, name: `submissions/${target.id}/submission.pdf`, body: Buffer.from(bytes), contentType: "application/pdf" });
      mdKey = await putRecordObject({ userId: target.student_id, name: `submissions/${target.id}/submission.md`, body: Buffer.from(markdown, "utf8"), contentType: "text/markdown; charset=utf-8" });
    } catch (e) {
      console.warn("[self-study/pdf] could not store the submission PDF:", String(e?.message || e).slice(0, 160));
    }
    const meta = {
      key, mdKey, size: bytes.length, pages, notes,
      builtFor: target.submission?.submittedAt || null, builtAt: new Date().toISOString(),
    };
    if (key) {
      await edu().from("self_study_targets").update({ submission_pdf: meta }).eq("id", target.id);
      // The previous copies (a resubmission) go once the new ones are recorded.
      const old = target.submission_pdf;
      if (old?.key && old.key !== key) void removeSubmissionObject(old.key, target.student_id);
      if (old?.mdKey && old.mdKey !== mdKey) void removeSubmissionObject(old.mdKey, target.student_id);
    }
    return { bytes, markdown, meta };
  })().finally(() => inFlight.delete(targetId));
  inFlight.set(targetId, job);
  return job;
}

/** Fire-and-forget build after a submit. */
export function buildSubmissionArtifactsLater(targetId) {
  buildSubmissionArtifacts(targetId).catch((e) =>
    console.warn("[self-study/pdf] build failed (it will be built on first open):", String(e?.message || e).slice(0, 160)));
}

/** The current PDF or markdown bytes for a target — stored copy, else built now. */
export async function readSubmissionArtifact(target, which = "pdf") {
  if (pdfIsCurrent(target)) {
    const key = which === "md" ? target.submission_pdf.mdKey : target.submission_pdf.key;
    if (key) {
      try { return await downloadCapped(await createPresignedDownload(key), { maxBytes: 200 * 1024 * 1024 }); }
      catch { /* gone from storage — rebuild below */ }
    }
  }
  const built = await buildSubmissionArtifacts(target.id);
  return which === "md" ? Buffer.from(built.markdown, "utf8") : Buffer.from(built.bytes);
}
