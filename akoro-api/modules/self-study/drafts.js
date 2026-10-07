/**
 * modules/self-study/drafts.js — AI-prepared activity drafts (human-in-the-loop).
 *
 * The instructor's agent files drafts from chat via the `prepare_activity`
 * tool. A draft is a PRIVATE proposal: nothing is assigned, nobody is
 * notified. `payload` stores the exact bench-shaped create body so the
 * approval step can replay it through the one shared `createAssignment`
 * path — same insert, same targets, same notifications and ding as the
 * activities workbench.
 *
 * The human is the only actor who can cross the line: the draft endpoints
 * are plain HTTP, called by the preview UI's Assign button. No chat tool
 * reaches this module's assign.
 *
 * Audience rule: the instructor states the audience in their prompt. If the
 * agent cannot say who the work is for, it must ASK — `prepare_activity`
 * rejects a draft with `audience_required` and the model requests
 * clarification instead of guessing.
 */

import db from "../../db.js";
import {
  nana, edu, ACTIVITY_TYPES, announceFor, mySchool,
  resolveStudents, createAssignment, invalid,
} from "./createAssignment.js";

/** Battles ride the same drafting flow but assign through their battle form
 *  (the one shared BattleForm), so they are valid drafts, not bench assigns. */
export const DRAFT_TYPES = Object.freeze([...ACTIVITY_TYPES, "battle"]);

/** Pending drafts older than this are lazily expired on read (no cron). */
const DRAFT_TTL_DAYS = 7;
/** Prepare calls are LLM-backed (nana plan generation) — a soft hourly cap. */
const PREPARE_HOURLY_CAP = 10;

const TYPE_NAMES = {
  self_study: "self study", assignment: "assignment", project: "project",
  live_course: "live course", multi_stage: "multi-stage journey", battle: "battle",
};
const typeName = (t) => TYPE_NAMES[t] || t;

/** Find the instructor's classroom by loose name ("my jss2 class" → id). */
// Classrooms an instructor can assign to. Ownership is `teacher_id` (the
// seeded/bench path) OR `created_by` (rows created by other tools) — filtering
// by created_by alone made every seeded class invisible to the agent, which
// surfaced as "there are no classes listed in my system for you".
export async function instructorClassrooms(instructorId) {
  // created_by did not always exist on classrooms — if the combined filter
  // runs on a not-yet-migrated env it ERRORS, so fall back to teacher_id
  // instead of quietly answering "no classes".
  let data, error;
  ({ data, error } = await db.from("classrooms").select("id, name")
    .or(`teacher_id.eq.${instructorId},created_by.eq.${instructorId}`)
    .order("created_at", { ascending: true }).limit(50));
  if (error) {
    ({ data, error } = await db.from("classrooms").select("id, name")
      .eq("teacher_id", instructorId).order("created_at", { ascending: true }).limit(50));
  }
  if (error) throw invalid(error.message, 500);
  return data ?? [];
}

async function resolveClassroomByName(instructorId, name) {
  const q = String(name || "").trim();
  if (!q) return null;
  let data;
  try {
    // Supabase builders are thenables WITHOUT .catch — errors must be
    // handled by try/catch around the await (chaining .catch here threw
    // 'catch is not a function' and killed every prepare that named a class).
    ({ data } = await db.from("classrooms")
      .select("id, name").or(`teacher_id.eq.${instructorId},created_by.eq.${instructorId}`).ilike("name", `%${q}%`).limit(1));
  } catch {
    ({ data } = await db.from("classrooms")
      .select("id, name").eq("teacher_id", instructorId).ilike("name", `%${q}%`).limit(1));
  }
  if (!data) {
    ({ data } = await db.from("classrooms")
      .select("id, name").eq("teacher_id", instructorId).ilike("name", `%${q}%`).limit(1));
  }
  if (data?.length) return data[0];
  // School admins may not own classrooms directly — try their school scope.
  const { data: school } = await db.from("school_profiles")
    .select("id").eq("admin_user_id", instructorId).limit(1).maybeSingle();
  if (school?.id) {
    const { data: sc } = await db.from("classrooms")
      .select("id, name").eq("school_id", school.id).ilike("name", `%${q}%`).limit(1);
    if (sc?.length) return sc[0];
  }
  return null;
}

/**
 * Normalise the agent's audience input into { body, label }.
 * Throws `invalid("audience_required", "clarify")` when nothing usable was
 * given — the tool turns that into an observation the model must act on by
 * asking the instructor, never by guessing.
 */
async function resolveAudience(instructor, audience) {
  const a = audience && typeof audience === "object" ? audience : {};
  const usernames = (Array.isArray(a.usernames) ? a.usernames : []).map(u => String(u).trim()).filter(Boolean);
  const user_ids  = (Array.isArray(a.user_ids)  ? a.user_ids  : []).filter(Boolean);
  const whole_class = a.whole_class === true || a.everyone === true;
  let classroom_id = a.classroom_id || null;

  if (!whole_class && !usernames.length && !user_ids.length && !classroom_id) {
    if (a.classroom_name || a.class_name || a.text) {
      const room = await resolveClassroomByName(instructor.id, a.classroom_name || a.class_name || a.text);
      if (room) { classroom_id = room.id; a.classroom_name = room.name; }
    }
  }
  if (!whole_class && !usernames.length && !user_ids.length && !classroom_id) {
    throw invalid("audience_required", "clarify");
  }

  // "The entire class" without a class id: resolve it for real instead of
  // silently targeting nobody. One class → use it; several → ask which;
  // none → say plainly that a class must be created first.
  if (whole_class && !classroom_id) {
    if (!classroom_id && (a.classroom_name || a.class_name || a.text)) {
      const room = await resolveClassroomByName(instructor.id, a.classroom_name || a.class_name || a.text);
      if (room) { classroom_id = room.id; a.classroom_name = room.name; }
    }
    if (!classroom_id) {
      const rooms = await instructorClassrooms(instructor.id);
      if (rooms.length === 1) { classroom_id = rooms[0].id; a.classroom_name = rooms[0].name; }
      else if (rooms.length > 1) {
        throw invalid(`Which class? You have: ${rooms.map(r => r.name).join(", ")}`, "clarify");
      } else {
        throw invalid("You don't have a class yet — create one in Classes first, then I can prepare work for it");
      }
    }
  }

  // Resolve now so the preview shows the real count before anyone assigns.
  const { ids, notFound } = await resolveStudents({ usernames, user_ids, classroom_id, whole_class });

  // A few real names make the preview reviewable at a glance ("@amina, @musa
  // +3 more") — picked audiences only; whole-class shows the count.
  let names;
  if (!whole_class && ids.length) {
    try {
      const { data: people } = await db.from("users")
        .select("username").in("id", ids.slice(0, 8));
      names = (people ?? []).map(u => u.username).filter(Boolean);
    } catch { /* names are cosmetic — never block a draft on them */ }
  }

  const bits = [];
  if (whole_class) bits.push(a.classroom_name || "the whole class");
  if (usernames.length) bits.push(usernames.map(u => `@${String(u).replace(/^@/, "")}`).join(", "));
  if (user_ids.length && !usernames.length) bits.push(`${user_ids.length} learner${user_ids.length === 1 ? "" : "s"} by id`);
  return {
    body: { usernames, user_ids, whole_class, classroom_id: whole_class ? classroom_id : (classroom_id ?? null) },
    label: bits.join(" + ") || `${ids.length} learner${ids.length === 1 ? "" : "s"}`,
    resolvedCount: ids.length,
    names,
    notFound,
  };
}

/** The plan generator behind POST /plan — the same one the workbench uses. */
async function generatePlan(topic, subject) {
  const { subtopics } = await nana.generateSubtopics(topic, subject);
  const lists = await Promise.all(subtopics.map((st) => nana.generateObjectives(st, topic, subject)));
  const objectives = {};
  subtopics.forEach((st, i) => { objectives[st] = lists[i]; });
  return { subtopics, objectives };
}

// Ceiling for one background enrichment. The SDK calls are individually
// bounded (45s ×1 retry), so this mostly exists so that even a pathological
// run can't leave a draft stuck in `pending` forever.
const PLAN_ENRICH_TIMEOUT_MS = 150_000;

/**
 * Fill a draft's plan in the background — never inside the chat turn.
 * Read-modify-write so a teacher editing the preview while the model runs
 * never loses their changes, and a draft that left `draft` status
 * (assigned/discarded/expired) is left untouched. Never throws: the draft
 * already exists and is previewable; a failed enrichment just leaves the
 * editable topic-only plan and logs.
 */
async function enrichDraftPlan(draftId, topic, subject) {
  const withDeadline = Promise.race([
    generatePlan(topic, subject),
    new Promise((_, rej) => {
      const t = setTimeout(
        () => rej(new Error(`plan generation exceeded ${PLAN_ENRICH_TIMEOUT_MS / 1000}s`)),
        PLAN_ENRICH_TIMEOUT_MS,
      );
      t.unref?.(); // never hold process shutdown open for a plan
    }),
  ]);
  try {
    const { subtopics, objectives } = await withDeadline;
    const { data: row, error: readErr } = await db.from("activity_drafts")
      .select("status, payload").eq("id", draftId).maybeSingle();
    if (readErr || !row) throw new Error(readErr?.message || "draft no longer readable");
    if (row.status !== "draft") return; // assigned/discarded/expired — leave it be
    const { error: updErr } = await db.from("activity_drafts")
      .update({ payload: { ...row.payload, subtopics, objectives, plan_status: "ready" } })
      .eq("id", draftId);
    if (updErr) throw new Error(updErr.message);
  } catch (e) {
    console.error("[prepare_activity] plan generator failed:", e.message);
    try {
      const { data: row } = await db.from("activity_drafts")
        .select("status, payload").eq("id", draftId).maybeSingle();
      if (row?.status === "draft") {
        await db.from("activity_drafts")
          .update({ payload: { ...row.payload, plan_status: "fallback" } })
          .eq("id", draftId);
      }
    } catch (markErr) { console.error("[prepare_activity] plan fallback mark failed:", markErr.message); }
  }
}

/** Cap open drafts per instructor; the oldest quietly expires to make room. */
async function enforceDraftCap(instructorId, cap = 20) {
  const { data } = await db.from("activity_drafts")
    .select("id").eq("created_by", instructorId).eq("status", "draft")
    .order("created_at", { ascending: true });
  const rows = data ?? [];
  if (rows.length < cap) return;
  const excess = rows.slice(0, rows.length - cap + 1);
  await db.from("activity_drafts")
    .update({ status: "expired", resolved_at: new Date().toISOString() })
    .in("id", excess.map(r => r.id));
}

/**
 * createActivityDraft — the `prepare_activity` tool's engine.
 * `input` (model-shaped) becomes a validated, plan-filled, audience-resolved
 * draft row. Returns { draft, audienceLabel, clarified }.
 */
export async function createActivityDraft({ instructor, input, sessionId = null, channel = "ai_chat" }) {
  const type = input?.type || "self_study";
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
    payload.details = {
      topic,
      difficulty: payload.difficulty,
      note: String(input?.instructions || "").trim() || null,
    };
  } else if (type === "multi_stage") {
    const stages = (Array.isArray(input?.stages) ? input.stages : []).slice(0, 6)
      .map((st, i) => ({
        kind: ["self_study", "assignment", "project"].includes(st?.kind) ? st.kind : "self_study",
        title: String(st?.title || st?.topic || `Stage ${i + 1}`).trim(),
        topic: String(st?.topic || st?.title || "").trim(),
        subject: String(st?.subject || subject || "General").trim(),
      }))
      .filter(st => st.topic);
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
    audience: { label: audienceLabel, resolved_count: audience.resolvedCount, names: audience.names ?? null, ...audience.body },
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

  return { draft, audienceLabel, clarified: false };
}

/** Load one draft the caller owns (admin excepted). */
export async function getActivityDraft(instructor, id) {
  const { data } = await db.from("activity_drafts").select("*").eq("id", id).maybeSingle();
  if (!data) throw invalid("Draft not found", 404);
  if (data.created_by !== instructor.id && instructor.role !== "admin") throw invalid("Not your draft", 403);
  return data;
}

/**
 * expireStaleDrafts — lazy TTL sweep; a stale pending draft is never shown
 * and never assignable. Runs on read, so no worker is needed.
 */
async function expireStaleDrafts(instructorId) {
  const cutoff = new Date(Date.now() - DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.from("activity_drafts")
    .update({ status: "expired", resolved_at: new Date().toISOString() })
    .eq("created_by", instructorId).eq("status", "draft").lt("created_at", cutoff);
}

/** The instructor's pending drafts, newest first (stale ones swept first). */
export async function listActivityDrafts(instructor) {
  await expireStaleDrafts(instructor.id);
  const { data } = await db.from("activity_drafts")
    .select("*").eq("created_by", instructor.id).eq("status", "draft")
    .order("created_at", { ascending: false }).limit(50);
  return data ?? [];
}

/** Human edits before assign — the preview's Edit flow saves here. */
export async function updateActivityDraft(instructor, id, patch) {
  const draft = await getActivityDraft(instructor, id);
  if (draft.status !== "draft") throw invalid("Only pending drafts can be edited", 409);
  const updates = {};
  if (patch?.payload && typeof patch.payload === "object") updates.payload = patch.payload;
  if (patch?.audience && typeof patch.audience === "object") updates.audience = patch.audience;
  if (patch?.status === "assigned") {
    // Battle completion path: the shared BattleForm created the battle; the
    // draft just records provenance.
    updates.status = "assigned";
    updates.assignment_id = patch.assignment_id ?? null;
    updates.resolved_at = new Date().toISOString();
  }
  if (!Object.keys(updates).length) return draft;
  const { data, error } = await db.from("activity_drafts")
    .update(updates).eq("id", id).select().single();
  if (error) throw invalid(error.message, 500);
  return data;
}

/** Discard — always allowed while pending; never deletes the row. */
export async function discardActivityDraft(instructor, id) {
  const draft = await getActivityDraft(instructor, id);
  if (draft.status !== "draft") throw invalid("Only pending drafts can be discarded", 409);
  const { data, error } = await db.from("activity_drafts")
    .update({ status: "discarded", resolved_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) throw invalid(error.message, 500);
  return data;
}

const asText = (v, max) => {
  const t = String(v ?? "").trim();
  return t ? t.slice(0, max) : undefined;
};
const asPlan = (subtopics, objectives, existing) => {
  if (!Array.isArray(subtopics)) return undefined;
  const items = subtopics.map(st => String(st ?? "").trim()).filter(Boolean).slice(0, 12);
  if (!items.length) throw invalid("The plan needs at least one entry");
  const next = {};
  for (const st of items) {
    const source = (objectives && typeof objectives === "object" && Array.isArray(objectives[st]))
      ? objectives[st]
      : (Array.isArray(existing?.[st]) ? existing[st] : []);
    next[st] = source.map(o => String(o ?? "").trim()).filter(Boolean).slice(0, 8);
  }
  return { items, objectives: next };
};

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

  const payload = { ...(draft.payload || {}) };
  const applied = [];

  const title = asText(c.title, 200);
  if (title) { payload.title = title; applied.push("title"); }
  const instructions = asText(c.instructions, 2000);
  if (instructions !== undefined) { payload.instructions = instructions || null; applied.push("instructions"); }
  if (["easy", "intermediate", "hard"].includes(c.difficulty) && c.difficulty !== payload.difficulty) {
    payload.difficulty = c.difficulty; applied.push("difficulty");
  }

  const type = draft.type;
  if (type === "live_course") {
    const hint = asText(c.scheduled_hint, 120);
    if (hint !== undefined) { payload.details = { ...payload.details, scheduled_hint: hint || null }; applied.push("scheduled_hint"); }
  } else if (type === "battle") {
    const note = asText(c.note, 600);
    if (note !== undefined) { payload.details = { ...payload.details, note: note || null }; applied.push("note"); }
    const topic = asText(c.topic, 200);
    if (topic) { payload.topic = topic; applied.push("topic"); }
  } else if (type === "multi_stage") {
    if (Array.isArray(c.stages)) {
      const stages = c.stages.slice(0, 6).map((st, i) => ({
        kind: ["self_study", "assignment", "project"].includes(st?.kind) ? st.kind : "self_study",
        title: String(st?.title || st?.topic || `Stage ${i + 1}`).trim(),
        topic: String(st?.topic || st?.title || "").trim(),
        subject: String(st?.subject || payload.subject || "General").trim(),
      })).filter(st => st.topic);
      if (!stages.length) throw invalid("A journey needs at least one stage with a topic");
      payload.details = { ...payload.details, stages };
      applied.push("stages");
    }
  } else {
    // self_study | assignment | project: the plan (entries + their objectives).
    const wantsPlan = Array.isArray(c.subtopics) || (c.objectives && typeof c.objectives === "object");
    if (wantsPlan) {
      const plan = asPlan(c.subtopics ?? payload.subtopics, c.objectives ?? {}, payload.objectives);
      payload.subtopics = plan.items;
      payload.objectives = plan.objectives;
      applied.push("plan");
    }
  }

  if (!applied.length) throw invalid("None of those fields apply to this draft type");

  if (c.changeNote) payload.last_change = { note: String(c.changeNote).slice(0, 200), at: new Date().toISOString() };

  const { data, error } = await db.from("activity_drafts")
    .update({ payload })
    .eq("id", draft.id)
    .select().single();
  if (error) throw invalid(error.message, 500);
  return { draft: data, applied };
}

/**
 * assignActivityDraft — THE approval. Replays the stored bench payload
 * through the one shared create path. For journeys, each stage is created
 * first (same path) and the parent travels with the real stage refs.
 * `overrides` lets the preview hand back human-edited fields.
 */
export async function assignActivityDraft({ instructor, id, overrides = null }) {
  const draft = await getActivityDraft(instructor, id);

  // Claim-first: win the draft atomically BEFORE creating anything, so two
  // rapid taps (or chat + the workbench strip) can never assign twice. The
  // winner carries the claim; losers get a clean 409.
  const { data: claim, error: claimErr } = await db.from("activity_drafts")
    .update({ status: "assigned", resolved_at: new Date().toISOString() })
    .eq("id", draft.id).eq("status", "draft")
    .select();
  if (claimErr) throw invalid(claimErr.message, 500);
  if (!claim?.length) throw invalid("This draft was already resolved", 409);

  const payload = { ...(draft.payload || {}), ...(overrides && typeof overrides === "object" ? overrides : {}) };
  const type = payload.type || draft.type;

  // Battle drafts are completed through their battle form, not this path —
  // release the claim so the instructor can still finish it there.
  if (type === "battle") {
    await db.from("activity_drafts")
      .update({ status: "draft", resolved_at: null })
      .eq("id", draft.id).eq("status", "assigned");
    throw invalid("Battles are assigned from their battle form in the preview", 400);
  }

  let result;
  try {
    if (type === "multi_stage") {
    const stages = Array.isArray(payload.details?.stages) ? payload.details.stages.slice(0, 6) : [];
    if (!stages.length) throw invalid("The journey has no stages", 400);
    const refs = [];
    for (const st of stages) {
      if (st.refId) { refs.push(st); continue; }   // already-created stage ref
      const stageOut = await createAssignment(instructor, {
        type: st.kind || "self_study",
        title: st.title, subject: st.subject || "General", topic: st.topic || st.title,
        subtopics: st.subtopics ?? [], objectives: st.objectives ?? {},
        instructions: st.instructions ?? null, difficulty: payload.difficulty || "intermediate",
        due_at: payload.due_at ?? null,
        usernames: payload.usernames ?? [], user_ids: payload.user_ids ?? [],
        whole_class: payload.whole_class ?? false, classroom_id: payload.classroom_id ?? null,
      });
      refs.push({ kind: st.kind || "self_study", refId: stageOut.assignment.id, title: st.title });
    }
    result = await createAssignment(instructor, {
      type: "multi_stage",
      title: payload.title, subject: payload.subject, topic: payload.topic,
      instructions: payload.instructions || `A ${refs.length}-step journey: ${refs.map(r => r.title).join(" → ")}`,
      due_at: payload.due_at ?? null,
      details: { stages: refs },
      usernames: payload.usernames ?? [], user_ids: payload.user_ids ?? [],
      whole_class: payload.whole_class ?? false, classroom_id: payload.classroom_id ?? null,
    });
  } else {
    result = await createAssignment(instructor, payload);
  }
  } catch (e) {
    // Creation failed after the claim — release it so the human can fix the
    // draft (edit the audience, set the missing schedule) and try again. A
    // claim that 409s forever would be worse than the race it prevented.
    await db.from("activity_drafts")
      .update({ status: "draft", resolved_at: null })
      .eq("id", draft.id).eq("status", "assigned");
    throw e;
  }

  // Status was claimed up front; only the provenance link remains. If this
  // fails the assignment still stands (learners were notified) — it is a log.
  const { error } = await db.from("activity_drafts")
    .update({ assignment_id: result.assignment.id })
    .eq("id", draft.id);
  if (error) console.warn("[drafts] assign bookkeeping failed:", error.message);

  return { ...result, announce: announceFor(type) };
}
