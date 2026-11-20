/**
 * modules/self-study/draft-create.js — the `prepare_activity` tool's engine:
 * a model-shaped input becomes a validated, plan-filled, audience-resolved
 * draft row. Nothing is assigned and nobody is notified here.
 */

import { normalizeStages } from "./journeyStages.js";
import { mySchool, invalid } from "./createAssignment.js";
import db from "../../db.js";
import { ANSWER_FORMATS } from "./answerFormat.js";
import { newVersion, paperRequestFrom, runVersionJob, versionsOf } from "./draftVersions.js";
import {
  DRAFT_TYPES, PREPARE_HOURLY_CAP, typeName,
} from "./draft-rules.js";
import { resolveAudience } from "./draft-audience.js";
import { enrichDraftPlan } from "./draft-plan.js";
import { autoRubric, questionChat } from "./draft-model.js";
import { draftBattleQuestions } from "./draft-questions.js";
import { enforceDraftCap } from "./draft-store.js";

/**
 * createActivityDraft — the `prepare_activity` tool's engine.
 * `input` (model-shaped) becomes a validated, plan-filled, audience-resolved
 * draft row. Returns { draft, audienceLabel, clarified }.
 */
export async function createActivityDraft({ instructor, input, sessionId = null, channel = "ai_chat" }) {
  const type = input?.type || "self_study";
  if (type === "teaching_tool") throw invalid("Teaching resources are drafted with run_teaching_tool, not prepare_activity.");
  if (!DRAFT_TYPES.includes(type)) throw invalid(`Unknown activity type: ${type}. Valid: ${DRAFT_TYPES.join(", ")}`);

  // Soft cost guard: each prepare runs the plan generator (several LLM calls).
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recent } = await db.from("activity_drafts")
    .select("id", { count: "exact", head: true })
    .eq("created_by", instructor.id).gte("created_at", hourAgo);
  if ((recent ?? 0) >= PREPARE_HOURLY_CAP) {
    throw invalid(`Prepare limit reached (${PREPARE_HOURLY_CAP}/hour). Review or assign your existing drafts, or try again later.`, 429);
  }

  const audience = await resolveAudience(instructor, input.audience);
  if (audience.notFound.length) {
    throw invalid(`No account found for: ${audience.notFound.join(", ")}`);
  }

  const topic   = String(input?.topic || "").trim();
  const subject = String(input?.subject || "").trim();
  // These read as QUESTIONS (clarify status), not "X is required" — a terse
  // validation string made the model report a "technical problem" and give
  // up instead of simply asking the instructor.
  if (!topic)   throw invalid("What exactly should the work cover — name the topic?", "clarify");
  if (!subject && type !== "battle") {
    throw invalid("Which subject is this for — e.g. Social Studies, Mathematics?", "clarify");
  }

  // A precise due time follows the create_task convention: ISO 8601 with an
  // offset, supplied only when the instructor actually stated one. Unresolvable
  // hints stay hints — never silently invented deadlines.
  let dueAt = null;
  let dueAtNotice = null;
  if (input?.due_at) {
    const parsed = new Date(input.due_at);
    // An unparseable or past instant degrades to the human hint (shown at
    // preview for the human to confirm) instead of failing the prepare —
    // a broken machine date must not destroy a valid request.
    if (Number.isNaN(parsed.getTime())) {
      dueAtNotice = "The exact due time could not be parsed — the draft carries it as a label for you to confirm at preview.";
    } else if (parsed.getTime() < Date.now() - 60 * 1000) {
      dueAtNotice = "The stated due time is already past — no due date was set; confirm the real one at preview.";
    } else {
      dueAt = parsed.toISOString();
    }
  }
  const payload = {
    type,
    title: String(input?.title || "").trim() || `${topic} — ${typeName(type)}`,
    subject: subject || "General",
    topic,
    instructions: String(input?.instructions || "").trim() || null,
    difficulty: ["easy", "intermediate", "hard"].includes(input?.difficulty) ? input.difficulty : "intermediate",
    due_at: dueAt,
    ...audience.body,
  };
  // classroom_id is scope AND the whole-class target — the self-study rule.
  if (audience.body.whole_class) payload.classroom_id = audience.body.classroom_id;
  else if (!audience.body.whole_class) payload.classroom_id = audience.body.classroom_id ?? null;

  let audienceLabel = audience.label;

  if (type === "live_course") {
    // The human picks the exact slot in preview; the agent's hint travels as text.
    const hint = String(input?.scheduled_hint || input?.due_hint || "").trim();
    payload.details = { scheduled_hint: hint || null };
    if (hint) audienceLabel += ` · ${hint}`;
  } else if (type === "battle") {
    // The battle form (human) completes questions/XP; the agent drafts intent.
    // What the instructor said about its shape and timing travels to the form,
    // which opens prefilled with it: a study review or a battle, when it
    // starts, whether it repeats, how many questions.
    const repeat = input?.repeat && typeof input.repeat === "object" ? input.repeat : null;
    const scheduledAt = input?.scheduled_at && !Number.isNaN(Date.parse(input.scheduled_at)) ? new Date(input.scheduled_at).toISOString() : null;
    const total = Math.round(Number(input?.total_questions));
    payload.details = {
      topic,
      difficulty: payload.difficulty,
      note: String(input?.instructions || "").trim() || null,
      mode: input?.battle_format === "review" ? "review" : "battle",
      scheduled_at: repeat ? null : scheduledAt,
      scheduled_hint: String(input?.scheduled_hint || "").trim() || null,
      repeat: repeat ? {
        days: (Array.isArray(repeat.days) ? repeat.days : []).map(Number).filter((d) => d >= 0 && d <= 6),
        time: String(repeat.time || "").slice(0, 5) || null,
        until: repeat.until && !Number.isNaN(Date.parse(repeat.until)) ? new Date(repeat.until).toISOString() : null,
      } : null,
      total_questions: Number.isFinite(total) && total >= 5 ? Math.min(30, total) : null,
    };
    // Its real questions, now: the preview shows the ones the battle (or the study review) asks.
    Object.assign(payload.details, await draftBattleQuestions(instructor, payload));
    if (repeat) audienceLabel += " · repeats";
    else if (scheduledAt || payload.details.scheduled_hint) audienceLabel += ` · ${payload.details.scheduled_hint || "scheduled"}`;
  } else if (type === "multi_stage") {
    const stages = normalizeStages(input?.stages, subject);
    if (!stages.length) throw invalid("A multi-stage journey needs at least one stage with a topic");
    payload.details = { stages };
    payload.topic = topic;
    audienceLabel += ` · ${stages.length} stages`;
  } else {
    // self_study | assignment | project. The plan generator is 1 + N LIVE
    // model calls (up to ~9 per prepare). Awaited inline it once hung the
    // whole chat turn — a stalled provider call sat on the SDK's 10-minute
    // default timeout while the browser/proxy gave up, and the instructor
    // just saw "trouble responding". So the draft carries the topic
    // instantly and the plan is filled in the background (enrichDraftPlan
    // below) — usually ready before the instructor opens the preview.
    // A prepare must never wait on content generation.
    payload.subtopics = [topic];
    payload.objectives = { [topic]: [`Study and complete the activities on ${topic}`] };
    payload.plan_status = "pending";
    // An assignment's questions come from the teacher's own words — V1,
    // built in the background like the plan (see draftVersions.js).
    if (type === "assignment") {
      const { request, plan } = paperRequestFrom(input);
      payload.paper_request = { request, plan };
      payload.versions = [newVersion(payload, { request: request || `Questions on ${topic}` })];
      // Only what the instructor said about grading and answers; the preview's Settings tab sets the rest.
      const grading = {};
      if (typeof input?.ai_auto_grade === "boolean") grading.ai_auto_grade = input.ai_auto_grade;
      if (input?.ai_release === "review") grading.ai_release = "review";
      if (ANSWER_FORMATS.includes(input?.answer_format)) grading.answer_format = input.answer_format;
      if (Object.keys(grading).length) payload.details = grading;
    }
  }

  if (input?.due_hint) payload.due_hint = String(input.due_hint).trim();
  if (dueAtNotice) payload.due_notice = dueAtNotice;
  await enforceDraftCap(instructor.id);

  const source = channel === "task_run" ? "task_run" : "ai_chat";
  const school = await mySchool(instructor.id);
  const { data: draft, error } = await db.from("activity_drafts").insert({
    created_by: instructor.id,
    school_id:  school?.id ?? null,
    type,
    title: payload.title,
    subject: payload.subject,
    topic: payload.topic,
    payload,
    audience: { label: audienceLabel, class_name: audience.className ?? null, resolved_count: audience.resolvedCount, names: audience.names ?? null, ...audience.body },
    source,
    session_id: sessionId,
  }).select().single();
  if (error) throw invalid(error.message, 500);

  // A draft prepared by a task run never appears in a live chat — without a
  // nudge the instructor would not know it exists. Chat drafts carry their own
  // Preview button, so they stay bell-free.
  if (source === "task_run") {
    try {
      const { error: nErr } = await db.from("notifications").insert({
        user_id: instructor.id,
        type: "activity_draft_prepared",
        title: `\u{1F916} Draft ready for review: ${draft.title}`,
        content: `${typeName(type)} prepared by your agent — preview and assign it from Activities.`,
        related_id: draft.id,
        link: "/activities",
      });
      if (nErr) console.warn("[drafts] instructor notify failed:", nErr.message);
    } catch (e) { console.warn("[drafts] instructor notify threw:", e.message); }
  }

  // Plan enrichment runs OUTSIDE the chat turn: fire-and-forget, so the
  // reply (and the Preview button) arrive instantly while the model fills
  // the plan. Its catch is internal — never an unhandled rejection.
  if (payload.plan_status === "pending") enrichDraftPlan(draft.id, topic, subject || "General");
  if (versionsOf(payload).length) void runVersionJob(draft.id, 1, { chat: questionChat(instructor.id), onReady: autoRubric(draft.id, instructor.id) });

  return { draft, audienceLabel, clarified: false };
}
