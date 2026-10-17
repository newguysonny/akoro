/**
 * modules/self-study/paperRender.js — what the paper template needs from the
 * database: the header's school line, the learner's class, the drawings and
 * photos as images in the page. The rendering itself is paperTemplate.js.
 */
import db from "../../db.js";
import { edu } from "./createAssignment.js";
import { paperOrg, renderAssignmentHtml, renderSubmissionHtml } from "./paperTemplate.js";
import { loadSubmissionDocument } from "./submissionArtifacts.js";
import { readSubmissionFile } from "./submissionFiles.js";

const SCHOOL_COLS = "id, name, city, lga, state";

/** "School Name, Town, Nigeria" for an activity: its school, else its teacher's. */
export async function orgFor(assignment) {
  try {
    if (assignment?.school_id) {
      const { data } = await db.from("school_profiles").select(SCHOOL_COLS).eq("id", assignment.school_id).maybeSingle();
      if (data) return paperOrg(data);
    }
    const teacher = assignment?.created_by;
    if (!teacher) return null;
    const { data: own } = await db.from("school_profiles").select(SCHOOL_COLS).eq("admin_user_id", teacher).limit(1).maybeSingle();
    if (own) return paperOrg(own);
    const { data: link } = await db.from("school_teachers").select("school_id").eq("teacher_id", teacher).limit(1).maybeSingle();
    if (link?.school_id) {
      const { data } = await db.from("school_profiles").select(SCHOOL_COLS).eq("id", link.school_id).maybeSingle();
      if (data) return paperOrg(data);
    }
    const { data: u } = await db.from("users").select("school_name").eq("id", teacher).maybeSingle();
    return u?.school_name ? paperOrg({ name: u.school_name }) : null;
  } catch {
    return null;
  }
}

/** The learner's class for the paper: the activity's class, else their class with this teacher. */
export async function classNameFor(assignment, learnerId) {
  try {
    if (assignment?.classroom_id) {
      const { data } = await db.from("classrooms").select("name").eq("id", assignment.classroom_id).maybeSingle();
      if (data?.name) return data.name;
    }
    const { data: rooms } = await db.from("classroom_students").select("classroom_id, classrooms(name, teacher_id)").eq("user_id", learnerId).eq("status", "active").limit(20);
    const mine = (rooms || []).find((r) => r.classrooms?.teacher_id === assignment?.created_by) || (rooms || [])[0];
    return mine?.classrooms?.name || null;
  } catch {
    return null;
  }
}

/** An image file → a data URL small enough for the page (photos are scaled down). */
async function imageDataUrl(bytes, mime) {
  if (bytes.length <= 400 * 1024) return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  try {
    const { loadImage, createCanvas } = await import("@napi-rs/canvas");
    const img = await loadImage(bytes);
    const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
    const c = createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return `data:image/jpeg;base64,${c.toBuffer("image/jpeg", 82).toString("base64")}`;
  } catch {
    return null;
  }
}

/** The assignment paper, for an activity row. */
export async function assignmentPaperHtml(assignment, { copy = "student", showKey = false, embed = false, changes = null, versionLabel = "" } = {}) {
  return renderAssignmentHtml({ assignment, org: await orgFor(assignment), copy, showKey, changes, versionLabel, embed });
}

/** A target's submission paper, with its drawings and photos in the page. */
export async function submissionPaperHtml(targetId, { only = null, embed = false } = {}) {
  const doc = await loadSubmissionDocument(targetId);
  if (!doc) return null;
  const { data: target } = await edu().from("self_study_targets").select("assignment_id, student_id").eq("id", targetId).maybeSingle();
  const { data: assignment } = await edu().from("self_study_assignments").select("id, school_id, created_by, classroom_id").eq("id", target?.assignment_id).maybeSingle();
  const [org, className] = await Promise.all([orgFor(assignment), classNameFor(assignment, target?.student_id)]);
  doc.header.org = org;
  if (className) doc.learner.className = className;
  // Every image answer sits in the page: whiteboard drawings and photos.
  const wanted = (doc.parts || []).flatMap((p) => p.questions || [])
    .filter((q) => only == null || q.index === only)
    .flatMap((q) => [...(q.answer?.drawings || []), ...(q.answer?.files || []).filter((f) => f.kind === "image")]);
  const images = new Map();
  if (wanted.length) {
    const { data: rows } = await edu().from("self_study_files").select("id, mime, storage_key, data").in("id", wanted.map((f) => f.id).filter(Boolean));
    await Promise.all((rows || []).map(async (r) => {
      try { const url = await imageDataUrl(await readSubmissionFile(r), r.mime || "image/png"); if (url) images.set(r.id, url); } catch { /* shown as its name */ }
    }));
  }
  return renderSubmissionHtml({ doc, images, only, embed });
}
