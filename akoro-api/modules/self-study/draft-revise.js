/**
 * modules/self-study/draft-revise.js — conversational revision of a PENDING
 * draft: the model supplies the new content, the server validates shape and
 * persists. A different topic is a different activity (discard and prepare
 * again), never a change made here.
 */

import db from "../../db.js";
import { withInstructionLine } from "./questionPaper.js";
import { invalid } from "./createAssignment.js";
import { normalizeStages } from "./journeyStages.js";
import { reviseToolDraft } from "./toolDrafts.js";
import { mergePlanItems, wantsPlanEdit } from "./planEdit.js";
import { asPlan, asText, withHistory } from "./draft-rules.js";
import { resolveAudience } from "./draft-audience.js";
import { draftBattleQuestions } from "./draft-questions.js";
import { autoRubric, questionChat } from "./draft-model.js";
import { getActivityDraft } from "./draft-records.js";
import {
  updateDraftPayload, newVersion, runVersionJob, versionAt, versionsOf, latestReady,
} from "./draftVersions.js";

/**
 * reviseDraftPayload — conversational revision of a PENDING draft.
 *
 * The model supplies the new content (it is the writer; the human saw the
 * preview and said what to change). The server only validates shape and
 * persists — the topic itself never changes here: a different topic is a
 * different activity (discard and prepare again). Returns the fresh draft.
 */
export async function reviseDraftPayload(instructor, id, changes) {
  const draft = await getActivityDraft(instructor, id);
  if (draft.status !== "draft") throw invalid("Only pending drafts can be revised", 409);
  const c = changes && typeof changes === "object" ? changes : {};
  if (!Object.keys(c).length) throw invalid("Say what to change — e.g. which entry to make easier, add, or remove");

  if (draft.type === "teaching_tool") {
    // A resource changes by VERSION only: the follow-up builds the next one in the background.
    const { version } = await reviseToolDraft(draft, { request: c.change_request ?? c.question_request, baseVersion: c.base_version });
    const { data: fresh } = await db.from("activity_drafts").select().eq("id", draft.id).single();
    return { draft: fresh, applied: ["resource"], version };
  }

  const payload = { ...(draft.payload || {}) };
  const applied = [];
  let newVersionN = null;

  const title = asText(c.title, 200);
  if (title) { payload.title = title; applied.push("title"); }
  const instructions = asText(c.instructions, 2000);
  if (instructions !== undefined) { payload.instructions = instructions || null; applied.push("instructions"); }
  // "Add to the instructions: …" keeps what is there (an assignment's are its paper's) and adds the line.
  const addLine = asText(c.add_instructions, 600);
  if (addLine) {
    // An assignment's start from its paper's own ("Answer all questions.") plus any the draft carries.
    payload.instructions = withInstructionLine([latestReady(payload)?.paper?.instructions, payload.instructions], addLine);
    if (!applied.includes("instructions")) applied.push("instructions");
  }
  if (["easy", "intermediate", "hard"].includes(c.difficulty) && c.difficulty !== payload.difficulty) {
    payload.difficulty = c.difficulty; applied.push("difficulty");
  }

  // When it's due — an exact instant, or the words as said (pinned at preview).
  let audienceRow = null;
  if (c.due_at) {
    const d = new Date(c.due_at);
    if (Number.isNaN(d.getTime())) throw invalid("That due date couldn't be read — say the day and time again.", "clarify");
    if (d.getTime() < Date.now() - 60 * 1000) throw invalid("That due time is already past — when should it be due?", "clarify");
    payload.due_at = d.toISOString(); applied.push("due date");
  } else if (asText(c.due_hint, 120)) {
    payload.due_hint = asText(c.due_hint, 120); payload.due_at = null; applied.push("due date");
  }
  // Who it's for — resolved exactly like prepare.
  if (c.audience && typeof c.audience === "object") {
    const a = await resolveAudience(instructor, c.audience);
    if (a.notFound.length) throw invalid(`No account found for: ${a.notFound.join(", ")}`);
    Object.assign(payload, a.body);
    audienceRow = { label: a.label, class_name: a.className ?? null, resolved_count: a.resolvedCount, names: a.names ?? null, ...a.body };
    applied.push("audience");
  }

  const type = draft.type;
  if (type === "live_course") {
    const hint = asText(c.scheduled_hint, 120);
    if (hint !== undefined) { payload.details = { ...payload.details, scheduled_hint: hint || null }; applied.push("scheduled_hint"); }
  } else if (type === "battle") {
    const note = asText(c.note, 600);
    if (note !== undefined) { payload.details = { ...payload.details, note: note || null }; applied.push("note"); }
    const topic = asText(c.topic, 200);
    if (topic) { payload.topic = topic; payload.details = { ...payload.details, topic }; applied.push("topic"); }
    // A new topic or difficulty: new questions (the old ones were written for the old one).
    if (topic || applied.includes("difficulty")) {
      payload.details = { ...payload.details, ...(await draftBattleQuestions(instructor, payload)) };
      applied.push("questions");
    }
  } else if (type === "multi_stage") {
    if (Array.isArray(c.stages)) {
      const stages = normalizeStages(c.stages, payload.subject);
      if (!stages.length) throw invalid("A journey needs at least one stage with a topic");
      payload.details = { ...payload.details, stages };
      applied.push("stages");
    }
  } else {
    // An assignment's questions change by VERSION: the follow-up builds the
    // next one in the background from the latest (or the named) version.
    if (type === "assignment" && asText(c.question_request, 1500)) {
      const list = versionsOf(payload);
      const base = c.base_version ? versionAt(payload, c.base_version) : latestReady(payload);
      if (c.base_version && !base) throw invalid(`There is no version ${c.base_version} on this draft.`);
      if (list.length && (!base || base.status !== "ready")) {
        const last = list.at(-1);
        throw invalid(last.status === "failed"
          ? `Version ${last.n} couldn't be drafted — press Try again on it in the preview (or discard and start again).`
          : `Version ${last.n} is still being drafted — wait for it, then ask again.`, 409);
      }
      try {
        const v = newVersion(payload, { request: asText(c.question_request, 1500), basedOn: base?.n ?? null });
        payload.versions = [...list, v];
        newVersionN = v.n;
      } catch (e) { throw invalid(e.message, e.status || 409); }
      applied.push("questions");
    }
    // self_study | assignment | project: the plan (entries + their objectives).
    if (wantsPlanEdit(c)) {
      // add/remove act on the STORED list; a full `subtopics` is a deliberate rewrite.
      const items = mergePlanItems(payload.subtopics, { subtopics: c.subtopics, add: c.add_subtopics, remove: c.remove_subtopics });
      const plan = asPlan(items, c.objectives ?? {}, payload.objectives);
      payload.subtopics = plan.items;
      payload.objectives = plan.objectives;
      applied.push("plan");
    }
  }

  if (!applied.length) throw invalid("None of those fields apply to this draft type");

  if (c.changeNote) payload.last_change = { note: String(c.changeNote).slice(0, 200), at: new Date().toISOString() };

  // Written under the draft's lock so a version landing meanwhile isn't
  // lost: this round's fields go over whatever the payload holds by then.
  const CHANGED = ["title", "instructions", "difficulty", "details", "topic", "subtopics", "objectives", "last_change",
    "due_at", "due_hint", "usernames", "user_ids", "whole_class", "classroom_id"];
  await updateDraftPayload(draft.id, (p) => {
    const next = {
      ...p,
      ...Object.fromEntries(CHANGED.filter((k) => k in payload && payload[k] !== draft.payload?.[k]).map((k) => [k, payload[k]])),
      ...(newVersionN ? { versions: [...versionsOf(p), payload.versions.at(-1)] } : {}),
    };
    // An assignment's instructions are its paper's: every version shows (and assigns) the same ones.
    if (type === "assignment" && applied.includes("instructions")) {
      next.versions = versionsOf(next).map((v) => (v.paper ? { ...v, paper: { ...v.paper, instructions: payload.instructions || "" } } : v));
    }
    // Every other activity keeps its rounds too: what it was, and what each follow-up made it.
    return type === "assignment" ? next : withHistory(p, next, String(c.changeNote || applied.join(", ")));
  });
  if (audienceRow) await db.from("activity_drafts").update({ audience: audienceRow }).eq("id", draft.id);
  const { data, error } = await db.from("activity_drafts").select().eq("id", draft.id).single();
  if (error) throw invalid(error.message, 500);
  if (newVersionN) void runVersionJob(draft.id, newVersionN, { chat: questionChat(instructor.id), onReady: autoRubric(draft.id, instructor.id) });
  return { draft: data, applied, version: newVersionN };
}
