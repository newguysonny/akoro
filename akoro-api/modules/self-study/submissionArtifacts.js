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

/* ── The marked copy (after grading) ──────────────────────────────────── */

const markedFor = (t) => `${t.graded_at || ""}|${t.markup?.updatedAt || ""}`;

/** Build the marked copy for a target; store it when the work is graded.
 *  → Uint8Array. A preview (not graded yet) is built but not stored. */
export async function buildMarkedCopy(targetId) {
  const { buildMarkedPdf } = await import("./submissionMarkup.js");
  const { data: t } = await edu().from("self_study_targets")
    .select("id, assignment_id, student_id, grade, feedback, graded_at, markup, marked_pdf, submission, submission_pdf").eq("id", targetId).maybeSingle();
  if (!t) throw new Error("Submission not found.");
  const [{ data: a }, { data: u }] = await Promise.all([
    edu().from("self_study_assignments").select("title").eq("id", t.assignment_id).maybeSingle(),
    db.from("users").select("full_name, username").eq("id", t.student_id).maybeSingle(),
  ]);
  const submissionPdf = await readSubmissionArtifact(t, "pdf");
  const bytes = await buildMarkedPdf({
    submissionPdf, marks: t.markup?.marks || [],
    grade: { score: t.grade, rubric: t.feedback?.rubric || [], feedback: t.feedback?.text || "", gradedAt: t.graded_at },
    title: a?.title || "Activity", learner: u?.full_name || u?.username || "Learner",
  });
  if (t.grade != null) {
    try {
      const key = await putRecordObject({ userId: t.student_id, name: `submissions/${t.id}/marked.pdf`, body: Buffer.from(bytes), contentType: "application/pdf" });
      await edu().from("self_study_targets").update({ marked_pdf: { key, builtFor: markedFor(t), builtAt: new Date().toISOString() } }).eq("id", t.id);
      if (t.marked_pdf?.key && t.marked_pdf.key !== key) void removeSubmissionObject(t.marked_pdf.key, t.student_id);
    } catch (e) {
      console.warn("[self-study/marked] could not store the marked copy:", String(e?.message || e).slice(0, 160));
    }
  }
  return bytes;
}

export function buildMarkedCopyLater(targetId) {
  buildMarkedCopy(targetId).catch((e) =>
    console.warn("[self-study/marked] build failed (built on first open):", String(e?.message || e).slice(0, 160)));
}

/** The marked copy's bytes — the stored one when it matches the grade and marks, else built now. */
export async function readMarkedCopy(target) {
  if (target.grade != null && target.marked_pdf?.key && target.marked_pdf.builtFor === markedFor(target)) {
    try { return await downloadCapped(await createPresignedDownload(target.marked_pdf.key), { maxBytes: 200 * 1024 * 1024 }); }
    catch { /* gone — rebuild */ }
  }
  return Buffer.from(await buildMarkedCopy(target.id));
}

/* ── AI auto-grade (drafts for the instructor) ────────────────────────── */

/** Draft marks for one submission, billed to the activity's owner. */
export async function aiGradeTarget(targetId) {
  const [{ runAiGrade }, { openai, OPENAI_MODEL }, { schoolBillTo }, { aiGradeSchema }] = await Promise.all([
    import("./aiGrade.js"), import("../../lib/aiModel.js"), import("../../lib/coins.js"), import("./aiGrade.js"),
  ]);
  let owner = null;
  return runAiGrade(targetId, {
    save: async (id, ai) => { await edu().from("self_study_targets").update({ ai_grade: ai }).eq("id", id); },
    load: async (id) => {
      const { data: t } = await edu().from("self_study_targets")
        .select("id, assignment_id, student_id, submission, submission_pdf").eq("id", id).maybeSingle();
      if (!t?.submission?.submittedAt) throw new Error("Nothing has been submitted yet.");
      const { data: assignment } = await edu().from("self_study_assignments")
        .select("id, title, subject, details, created_by").eq("id", t.assignment_id).maybeSingle();
      owner = assignment?.created_by || null;
      const markdown = (await readSubmissionArtifact(t, "md")).toString("utf8");
      const ids = (t.submission.files || []).map((f) => f.id);
      const { data: rows } = ids.length
        ? await edu().from("self_study_files").select("id, name, size, mime, kind, storage_key, data").in("id", ids)
        : { data: [] };
      const images = [];
      const notes = [];
      for (const r of rows || []) {
        if (r.kind !== "image") continue;
        if (images.length >= 4 || (r.size || 0) > 4 * 1024 * 1024) { notes.push(`${r.name}: not read by the AI — check it in the PDF.`); continue; }
        try { images.push({ mime: r.mime || "image/jpeg", bytes: await readSubmissionFile(r) }); }
        catch { notes.push(`${r.name}: couldn't be read — check it in the PDF.`); }
      }
      if (/No text could be read from this file/.test(markdown)) notes.push("A scanned or unreadable attachment wasn't read by the AI — check it in the PDF.");
      return { assignment: assignment || {}, submission: t.submission, markdown, images, notes };
    },
    chat: async (messages) => {
      const billTo = owner ? await schoolBillTo(owner).catch(() => null) : null;
      const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL, temperature: 0.2, max_tokens: 2500, messages,
        response_format: { type: "json_schema", json_schema: { name: "activity_ai_grade", strict: true, schema: aiGradeSchema() } },
        ...(owner ? { __userId: owner } : {}), ...(billTo ? { __billTo: billTo } : {}), __feature: "activity_ai_grade",
      });
      return completion.choices?.[0]?.message?.content || "{}";
    },
  });
}
