// The Agent Chat tool runtime: catalogues, side-effect policy, the read
// helpers, merged-domain plumbing and the dispatcher. Handler bodies live in
// handlers-instructor-learner.js, handlers-social.js, handlers-network-study.js
// and handlers-merged.js. The learner-built-tools branch and the unknown-tool
// result stay here, after every registered group, so the default is LAST.
//
// chat.js re-exports this module's public names, so every existing importer
// keeps using chat.js as the entry point.

import db from "../../../db.js";
import { isDryRun } from "../../../lib/dryRunContext.js";
import { CHAT_TOOLS_CORE } from "./tool-catalogue-core.js";
import { CHAT_TOOLS_REST, buildInstructorTools, peerConsultEnabled, blogResearchEnabled, agentNetworkEnabled } from "./tool-catalogue-rest.js";
import { learnerInsightsEnabled, conceptTrackerEnabled, examPrepConfidenceEnabled, studyPrepEnabled, durableAgentChatContextEnabled } from "./runtime-state.js";
import { TALK_AFTER_TOOLS } from "./chat-trace.js";
import { UPDATE_PLAN_TOOL } from "../../../lib/taskLedger.js";
import { subjectMastery } from "../agents/student/knowledge.js";
import { TOOLS as TEACHING_TOOLS, ToolError as TeachingToolError } from "../../teaching/index.js";
import { createToolDraft } from "../../self-study/index.js";
import { activityOutcomeSummary, listRecentActivities } from "../../self-study/index.js";
import { listRoutines, createRoutine, updateRoutine, deleteRoutine } from "../../self-study/index.js";
import { actionBasis, basisRefusal, currentActionBasis, withActionBasis } from "../../agent-runtime/index.js";
import { createTool, runLearnerTool, learnerToolDefs, learnerToolDefsWithAreas, forcedSelfTool, saveComputation, listMyTools, getLibraryToolState, runLibraryViewAction, getChatsToolState, runChatsViewAction, getMergedToolState, runMergedViewAction } from "../../self-tooling/index.js";
import { mergedLibraryEnabled, mergedLibraryDef, libraryDeltaActions, LIBRARY_BASE_ACTIONS, LIBRARY_MERGED_ACTIONS } from "../../self-tooling/index.js";
import { mergedChatsEnabled, mergedChatsDef, chatsDeltaActions, CHATS_BASE_ACTIONS, CHATS_MERGED_ACTIONS } from "../../self-tooling/index.js";
import { MERGED_DOMAINS, MERGED_DOMAIN_LIST } from "../../self-tooling/index.js";
import { selfToolingEnabled, selfToolingAllowedFor } from "../../self-tooling/index.js";
import { createActivityDraft, listActivityDrafts, getActivityDraft, discardActivityDraft, reviseDraftPayload, instructorClassrooms } from "../../self-study/index.js";
import { listGoals, createGoal, updateGoal } from "../../learner-goals/index.js";
import { searchRecordChunks } from "../../records/index.js";
import { createHandlers } from "./handlers-instructor-learner.js";
import { createHandlers as createSocialHandlers } from "./handlers-social.js";
import { createHandlers as createNetworkStudyHandlers } from "./handlers-network-study.js";
import { createHandlers as createMergedHandlers } from "./handlers-merged.js";
// The module functions chat.js (and the rest of the dispatcher below) still
// call are re-exported here so this file is the ONE importer of each target:
// splitting them across chat.js and this new file would add cross-module
// import edges without re-keying the old ones.
export {
  actionBasis, basisRefusal, currentActionBasis, withActionBasis, createTool, runLearnerTool, learnerToolDefs, learnerToolDefsWithAreas, forcedSelfTool, saveComputation, listMyTools, getLibraryToolState, runLibraryViewAction, getChatsToolState, runChatsViewAction, getMergedToolState, runMergedViewAction,
  mergedLibraryEnabled, mergedLibraryDef, libraryDeltaActions, LIBRARY_BASE_ACTIONS, LIBRARY_MERGED_ACTIONS, mergedChatsEnabled, mergedChatsDef, chatsDeltaActions, CHATS_BASE_ACTIONS, CHATS_MERGED_ACTIONS, MERGED_DOMAINS, MERGED_DOMAIN_LIST,
  selfToolingEnabled, selfToolingAllowedFor, createActivityDraft, listActivityDrafts, getActivityDraft, discardActivityDraft, reviseDraftPayload, instructorClassrooms, listGoals, createGoal, updateGoal, searchRecordChunks, agentNetworkEnabled,
};
// ─── Unified Agent Chat tools ────────────────────────────────────────────────
// These execute against the student's real data when the agent needs them.
// A recurring battle (battle/series.js): days of the week + a time, until an end date and time.
// REPEAT_SCHEMA lives in chat/tool-catalogue-core.js with the first half of the tools.
export const CHAT_TOOLS = [...CHAT_TOOLS_CORE, ...CHAT_TOOLS_REST];

/** Hide feature-gated tools from the model catalogue until the matching Akoro slice is enabled. */
export function getLearnerChatTools({ allowToolRequest = true, selfTooling = true } = {}) {
  const enabled = {
    // Off by default; the chat route also checks the learner allow-list
    // (selfTooling) so the tool is never offered to anyone not on it.
    self_tooling: selfToolingEnabled() && selfTooling,
    blog_research: blogResearchEnabled,
    peer_consult: peerConsultEnabled,
    agent_network: agentNetworkEnabled,
    concept_tracker: conceptTrackerEnabled,
    learning_insights: learnerInsightsEnabled,
    exam_prep_confidence: examPrepConfidenceEnabled,
    study_prep: studyPrepEnabled,
    durable_agent_chat_context: durableAgentChatContextEnabled,
  };
  return CHAT_TOOLS.filter((tool) => (!tool.featureGate || enabled[tool.featureGate] === true)
    && (tool.name !== "submit_tool_request" || allowToolRequest));
}
/**
 * Instructor chat tools — activity creation with human-in-the-loop.
 * The agent PREPARES a draft; assigning is a human action on the preview
 * (POST /api/self-study/drafts/:id/assign), never a tool. All six workbench
 * types are draftable; battles assign through their battle form.
 */
/* Every field any teaching tool accepts, taken from the tools' own definitions so
   the model is told about all of them (the vocabulary count, a lesson plan's duration…) and the two can't drift.
   Voices stay at their defaults. */
const TEACHING_FIELD_PROPS = (() => {
  const props = {};
  for (const t of TEACHING_TOOLS) {
    for (const f of t.fields) {
      if (f.name === "voiceA" || f.name === "voiceB") continue;
      const p = (props[f.name] ||= { label: f.label, options: f.options, tools: [], required: [] });
      p.tools.push(t.key);
      if (f.required) p.required.push(t.key);
    }
  }
  return Object.fromEntries(Object.entries(props).map(([name, p]) => [name, {
    type: "string",
    description: `${name === "topic" ? "The topic" : p.label}${p.options ? ` (one of: ${p.options.join(" | ")})` : ""} — used by ${p.tools.join(", ")}${p.required.length ? `; REQUIRED for ${p.required.join(", ")}` : ""}.`,
  }]));
})();
export const INSTRUCTOR_TOOLS = buildInstructorTools(TEACHING_TOOLS, TEACHING_FIELD_PROPS);
export function openAiInstructorTools() {
  // Kill-switch: AKORO_ACTIVITY_DRAFTS_ENABLED=false removes the draft tools
  // everywhere at once (chat loop and gateway catalogue) without a deploy.
  if (String(process.env.AKORO_ACTIVITY_DRAFTS_ENABLED || "").toLowerCase() === "false") return [];
  return INSTRUCTOR_TOOLS.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
  }));
}

/* ── Learner school context (P2b directory tools) ─────────────────────────
   The learner's school identity comes from two places: their school-management
   enrolment (mgmt.students — the school's own roster) or their classrooms
   (classrooms.school_id — standalone teachers have none). Read-only and
   public-directory bounded: this answers "which school / which subjects /
   who teaches me", never staff contact details or internal school records. */
export async function resolveLearnerSchoolContext(studentId) {
  const ctx = { schoolId: null, school: null, classId: null, className: null, sectionName: null, classrooms: [] };
  const { data: roster } = await db.schema("mgmt").from("students")
    .select("school_id, class_id, section_id").eq("user_id", studentId)
    // The school they're at NOW — not a past school (alumni / inactive).
    .eq("status", "active")
    .not("school_id", "is", null).limit(1).maybeSingle();
  if (roster?.school_id) {
    ctx.schoolId = roster.school_id;
    ctx.classId = roster.class_id || null;
    if (ctx.classId) {
      const { data: classRow } = await db.schema("mgmt").from("classes")
        .select("name").eq("id", ctx.classId).limit(1).maybeSingle();
      ctx.className = classRow?.name || null;
    }
    if (roster.section_id) {
      const { data: sectionRow } = await db.schema("mgmt").from("sections")
        .select("name").eq("id", roster.section_id).limit(1).maybeSingle();
      ctx.sectionName = sectionRow?.name || null;
    }
  }
  const { data: memberships } = await db.from("classroom_students")
    .select("classrooms(id, name, school_id, teacher_id)")
    .eq("user_id", studentId).eq("status", "active").limit(25);
  ctx.classrooms = (memberships ?? []).map((m) => m.classrooms).filter(Boolean);
  if (!ctx.schoolId) ctx.schoolId = ctx.classrooms.map((c) => c.school_id).find(Boolean) || null;
  if (ctx.schoolId) {
    // Public directory fields only — the school's published identity.
    const { data: school } = await db.from("school_profiles")
      .select("name, description, website, logo_url, address, is_active")
      .eq("id", ctx.schoolId).limit(1).maybeSingle();
    if (school) ctx.school = {
      name: school.name,
      description: school.description || null,
      website: school.website || null,
      logoUrl: school.logo_url || null,
      address: school.address || null,
      active: Boolean(school.is_active),
    };
  }
  return ctx;
}
/**
 * Tools that change something (create, send, challenge, publish…). Used to
 * flag the scratchpad, and by the agent console's DRY mode, which answers
 * these with what they WOULD do instead of doing it (lib/dryRunContext.js).
 */
export const SIDE_EFFECT_TOOLS = ["set_agent_auto_reply", "create_task", "suggest_help", "schedule_chat_follow_up", "post_to_chat", "send_email_to_me", "create_tool", "save_computation", "cancel_scheduled_chat_follow_up", "submit_tool_request", "submit_bug_report", "prepare_activity", "revise_activity_draft",
          "create_goal", "update_goal_progress", "save_blog_draft", "publish_blog", "update_agent_network_settings", "block_agent", "log_past_question_practice",
          "challenge_agent", "class_battle", "post_challenge_request", "accept_challenge_request", "cancel_challenge_request", "rematch_battle", "request_guide_review", "message_agent", "reply_to_agent", "start_study_prep_session", "cancel_study_prep_session",
          "run_mode_action",
          "consult_peer_agents", "discard_activity_draft", "schedule_activity_routine", "cancel_activity_routine", "run_teaching_tool"];
/** The multi-action tools change things only on their writing actions. */
export const isSideEffectingAction = (tool, input) =>
  ["study_buddy", "daily_challenge", "revision_circle"].includes(tool) && !["list", "status", "ranking", "search", undefined, null, ""].includes(input?.action);
export const isSideEffecting = (tool, input) => SIDE_EFFECT_TOOLS.includes(tool) || isSideEffectingAction(tool, input);

/** Parallel read batches in the chat loop (2026-11-17): a decision's
 *  independent READ calls may run together, but these must always run one at
 *  a time, in the order the model gave them — each either changes something,
 *  depends on an earlier call's result, or changes what the rest of the turn
 *  can do. Side-effecting calls (isSideEffecting above) and tools the learner
 *  built themselves (not in the built-in catalogue) are likewise never
 *  batched. Kill switch: AKORO_PARALLEL_READS=false restores one-at-a-time
 *  execution everywhere, prompt steer included. */
export const PARALLEL_CALL_BARRIERS = new Set([
  UPDATE_PLAN_TOOL.name, // the plan ledger applies against earlier steps, in order
  "await_decision", // waits on the learner's tap, then applies the frozen proposal (a change)
  "run_mode_action", // moves a session tool's state — later steps read the state it leaves
  "create_tool", // its result can add a tool for the rest of the turn (__newTool)
  "get_agent_capabilities", // its result can load an area's tools (__addTools)
  "make_study_material", // the source cascade is a dependent chain; the taught source writes a record
  "read_upload", "retry_extraction", "file_upload", // the upload pipeline is one stateful sequence
  ...TALK_AFTER_TOOLS, // the owed narration line belongs between steps, in order
]);
/** Widest batch the loop runs at once — the reads share the database pool with every other turn. */
export const PARALLEL_READ_BATCH = 4;
// Confirmation statuses that mean the learner has decided: such a card is
// never (re)written into the chat as a message artifact — its outcome is
// the agent's narration only (Matt, 2026-11-17).
export const DECIDED_CONFIRM_STATUSES = ["approved", "consumed", "rejected", "expired"];
export const BUILTIN_TOOL_NAMES = new Set([...CHAT_TOOLS, ...INSTRUCTOR_TOOLS].map((t) => t.name));
/** The batching steer: appended to the system prompt per turn (never part of
 *  the golden-pinned static doctrine) and dropped when the kill switch is
 *  off, so the prompt never promises what the loop won't do. */
export const PARALLEL_READS_NOTE = "\n\n## Gathering what you need\nWhen your answer needs several independent lookups (progress, goals, tasks, sessions, weak topics, the Library), ask for them all in ONE reply — put every independent read in the same response instead of one per turn. They run together, and you answer sooner with fewer steps. Call one at a time only when a later call needs an earlier call's result, or when a call changes something: changes always go one by one, in order.";
export const STEP_NARRATION_NOTE = "\n\n## Narrating your work\nKeep the learner informed while you work, in your own words. With every reply that calls tools, include one short sentence saying what you are doing and why — as you start the step, not after the whole job is done. When a step's results come back and you go on to another step, first say in one short sentence what that step found or changed. If a step fails, say that in one short sentence too, with what you are doing about it — never let a step pass in silence. These lines appear between your steps in the chat, so keep each to a single plain sentence, specific to what is actually happening (name the thing you are checking, drafting or changing). Do not narrate a step you are not taking, do not repeat a line you already said, and keep your final answer as the summary of the outcome — it does not need to repeat the step lines. The sentence must ride in the SAME reply as the tool call it describes: a reply with no tool call ends your turn, so never send the sentence on its own. The same goes for deferrals and admissions: do not end a reply by promising to check or run something next, or by reporting that the work was not done and asking to be asked again — if this turn's work can be done, do it in this turn.";

/** A read helper that throws reaches the model as {error} naming what failed,
 *  not the loop's generic "could not be completed". */
export const asToolError = (what) => (e) => ({ error: `Couldn't load ${what} just now${e?.message ? ` (${String(e.message).slice(0, 120)})` : ""}.` });

/** What create_tool needs from the chat: built-in names (never shadowed) and a runner for capabilities. */
/** `role`: "student" (learner tools) or "instructor" (instructor tools, S7) — capabilities run as that role. */
export function selfToolDeps(userId, role = "student") {
  return {
    builtIn: new Set([...CHAT_TOOLS, ...INSTRUCTOR_TOOLS].map((t) => t.name)),
    callCapability: (tool, args) => executeChatTool(tool, args, userId, { role, channel: "self_tooling" }),
  };
}
/** Which tools a role's agent builds (S7): instructors build instructor tools; everyone else learner tools. */
export const toolAudience = (role) => (role === "instructor" ? "instructor" : "learner");
export const SELF_TOOLING_ROLES = new Set(["student", "instructor"]);

/**
 * Asked or inferred (Phase 18 item 6, agent-runtime/actionBasis.js). Every
 * caller of a chat tool acts for a person who asked: a chat message, an
 * Approve / Confirm tap, an admin's check, the agent console — so the default
 * is explicit. Work the agent started itself passes { basis: "inferred", rule };
 * a call made inside other work (a learner's own tool running a capability)
 * inherits that work's basis. An inferred change with no rule is refused.
 */
export function chatToolBasis({ basis = null, rule = null } = {}) {
  const given = basis == null ? null : typeof basis === "string" ? { basis, rule } : { ...basis, ...(rule ? { rule } : {}) };
  return actionBasis(given) || currentActionBasis() || { basis: "explicit", rule: null };
}

/** The library content search (the platform `search` action of the merged
 *  library tool, and the legacy search_my_library tool): the learner's own
 *  records only — chunk search plus a name match, reader-link shaped. */
export async function getMyLearningSessionsTool(studentId) {
      try {
        // The learner's own learning agent (one per learner, edu.student_agents).
        const { data: agentRow } = await db.schema("edu").from("student_agents")
          .select("id, name, level, total_sessions, total_turns, knowledge_score, subjects_learned")
          .eq("student_id", studentId).limit(1).maybeSingle();
        if (!agentRow?.id) return {
          agent: null, subjects: [], recentSessions: [], recentLearning: [],
          note: "This learner has no learning agent yet — it grows when they teach it in a learning session. Say exactly that; never invent subjects or topics.",
        };
        // What the learner has actually taught their agent, grouped by subject.
        const { data: knowledge, error: kErr } = await db.schema("edu").from("agent_knowledge")
          .select("subject, topic, confidence").eq("agent_id", agentRow.id).limit(400);
        if (kErr) return { error: "Could not load your learning history: " + kErr.message };
        const rowsBySubject = new Map();
        for (const row of knowledge ?? []) {
          const subject = row.subject || "General";
          if (!rowsBySubject.has(subject)) rowsBySubject.set(subject, []);
          rowsBySubject.get(subject).push(row);
        }
        const subjects = [];
        for (const [subject, rows] of [...rowsBySubject.entries()].slice(0, 10)) {
          const avg = rows.length ? rows.reduce((s, r) => s + (Number(r.confidence) || 0), 0) / rows.length : 0;
          const mastery = await subjectMastery(agentRow.id, subject).catch(() => null);
          const topics = [...new Map(rows.map((r) => [(r.topic || "").toLowerCase().trim(), r])).values()]
            .slice(0, 6)
            .map((r) => ({ topic: r.topic, confidence: Math.round((Number(r.confidence) || 0) * 100) + "%" }));
          subjects.push({
            subject, level: mastery?.level ?? null,
            knowledgeItems: rows.length, avgConfidence: Math.round(avg * 100) + "%",
            topics,
          });
        }
        // The learning sessions themselves (the protégé teaching sessions).
        const { data: sessions, error: sErr } = await db.schema("edu").from("adaptive_sessions")
          .select("subject, topic, status, current_phase, started_at, completed_at")
          // Never-started sessions have no started_at — nulls last, or they
          // fill every "recent" slot ahead of the real ones.
          .eq("student_id", studentId).order("started_at", { ascending: false, nullsFirst: false }).limit(8);
        if (sErr) return { error: "Could not load your learning sessions: " + sErr.message };
        // What the most recent sessions actually achieved.
        const { data: deltas } = await db.schema("edu").from("session_knowledge_delta")
          .select("subject, topic, concepts_learned, xp_earned, started_at")
          .eq("agent_id", agentRow.id).order("started_at", { ascending: false }).limit(5);
        return {
          agent: {
            name: agentRow.name || "My Learning Agent",
            level: agentRow.level ?? 1,
            totalSessions: agentRow.total_sessions ?? 0,
            totalTurns: agentRow.total_turns ?? 0,
            knowledgeScore: Number(agentRow.knowledge_score) || 0,
            subjectsLearned: agentRow.subjects_learned ?? [],
          },
          subjects,
          recentSessions: (sessions ?? []).map((s) => ({
            subject: s.subject, topic: s.topic, status: s.status,
            phase: s.current_phase, startedAt: s.started_at, completedAt: s.completed_at,
          })),
          recentLearning: (deltas ?? []).map((d) => ({
            subject: d.subject, topic: d.topic,
            conceptsLearned: Array.isArray(d.concepts_learned) ? d.concepts_learned.length : 0,
            xpEarned: Number(d.xp_earned) || 0, at: d.started_at,
          })),
          note: "This is what the learner has actually learnt by teaching their agent — the school's subject CATALOGUE is a different question (list_school_subjects).",
        };
      } catch (error) { return { error: error.message || "Could not load your learning sessions right now" }; }
}
export async function getPastQuestionPracticeTool(studentId, input) {
      try {
        let q = db.schema("edu").from("past_question_attempts")
          .select("exam, subject, year, attempted, correct, created_at").eq("user_id", studentId)
          .order("created_at", { ascending: false }).limit(1000);
        if (input?.subject) q = q.ilike("subject", String(input.subject).trim());
        if (input?.exam) q = q.ilike("exam", String(input.exam).trim());
        const days = Number(input?.days);
        if (Number.isFinite(days) && days > 0) q = q.gte("created_at", new Date(Date.now() - days * 86_400_000).toISOString());
        const { data, error } = await q;
        if (error) return { error: "Couldn't load your past-question practice just now." };
        const groups = new Map();
        for (const r0 of data ?? []) {
          const k = `${r0.exam}|${r0.subject || "—"}`;
          const g = groups.get(k) || { exam: r0.exam, subject: r0.subject || null, attempted: 0, correct: 0, years: new Set(), lastPractised: r0.created_at };
          g.attempted += Number(r0.attempted) || 0; g.correct += Number(r0.correct) || 0;
          if (r0.year) g.years.add(r0.year);
          if (r0.created_at > g.lastPractised) g.lastPractised = r0.created_at;
          groups.set(k, g);
        }
        const bySubject = [...groups.values()].map((g) => ({
          exam: g.exam, subject: g.subject, attempted: g.attempted, correct: g.correct,
          accuracy: g.attempted ? `${Math.round((g.correct / g.attempted) * 100)}%` : null,
          years: [...g.years].sort(), lastPractised: g.lastPractised,
        })).sort((a, b) => b.attempted - a.attempted);
        const attempted = bySubject.reduce((n, g) => n + g.attempted, 0);
        const correct = bySubject.reduce((n, g) => n + g.correct, 0);
        return bySubject.length
          ? { bySubject, totals: { attempted, correct, accuracy: attempted ? `${Math.round((correct / attempted) * 100)}%` : null, sessions: (data ?? []).length } }
          : { bySubject: [], totals: { attempted: 0, correct: 0 }, message: "No past-question practice recorded yet." };
      } catch (error) { return asToolError("your past-question practice")(error); }
}
export async function getWeakTopicsTool(studentId, input) {
      const { data: agentRow } = await db.schema("edu").from("student_agents")
        .select("id").eq("student_id", studentId).single();
      if (!agentRow) return { weak_topics: [], message: "No knowledge profile yet — start a session!" };
      // What the learner has taught their agent (agent_knowledge — the same
      // store as the knowledge map and learning sessions), weakest first. It
      // read the learner's saved notes instead, where confidence defaults to
      // 60%, so "my weak topics" came back empty next to a map showing some.
      let q = db.schema("edu").from("agent_knowledge")
        .select("topic, subject, confidence")
        .eq("agent_id", agentRow.id).order("confidence", { ascending: true }).limit(60);
      if (input.subject) q = q.ilike("subject", String(input.subject).trim());
      const { data, error } = await q;
      if (error) return { error: "Couldn't load your topics just now." };
      const seen = new Set();
      const weak = (data ?? []).filter((t) => (Number(t.confidence) || 0) < 0.6)
        .filter((t) => { const k = `${t.subject}|${String(t.topic || "").toLowerCase().trim()}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, 8)
        .map((t) => ({ topic: t.topic, subject: t.subject, confidence: Math.round((Number(t.confidence) || 0) * 100) + "%" }));
      return weak.length ? { weak_topics: weak } : { weak_topics: [], message: (data ?? []).length ? "Nothing weak right now — every topic you've taught is above 60%." : "Nothing taught yet in that subject." };
}
export async function listMyGoalsTool(studentId) {
  try {
    const { goals, error } = await listGoals(studentId);
    if (error) return { error };
    return {
      count: (goals ?? []).length,
      goals: (goals ?? []).map((g) => ({
        goalId: g.id, title: g.title, status: g.status, category: g.category,
        metric: g.metric, exam: g.exam, targetDate: g.target_date,
        progressNote: g.progress_note, updatedAt: g.updated_at,
      })),
    };
  } catch (error) {
    return { error: error.message || "Could not load the goals" };
  }
}
export async function listTasksTool(studentId) {
  const { data, error } = await db.from("tasks")
    .select("id, title, priority, status, payload, due_at, created_at")
    .eq("creator_id", studentId).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(50);
  if (error) return { error: "Couldn't load your tasks just now." };
  // Sorted by priority (as described), then soonest due — over all pending
  // tasks, not just the 10 newest.
  const rank = { urgent: 0, high: 1, medium: 2, low: 3 };
  const tasks = (data ?? []).sort((a, b) => (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2)
    || String(a.due_at || "9999").localeCompare(String(b.due_at || "9999"))).slice(0, 10);
  return { tasks, count: data?.length ?? 0 };
}
export async function searchMyLibraryTool(studentId, input) {      // The learner's own records only (searchRecordChunks is user-scoped), plus a name match.
      const q = String(input?.query || "").trim().slice(0, 200);
      if (q.length < 3) return { records: [], note: "Give a topic or document name to look for." };
      try {
        const [hits, named] = await Promise.all([
          searchRecordChunks({ userId: studentId, q, limit: 12 }).catch(() => []),
          db.schema("edu").from("records").select("id, name").eq("user_id", studentId).is("deleted_at", null).ilike("name", `%${q.replace(/[%_]/g, "")}%`).limit(5)
            .then((r) => r.data || []).catch(() => []),
        ]);
        const byId = new Map();
        for (const n of named) byId.set(n.id, { recordId: n.id, name: n.name, snippet: null });
        // A passage for a document also found by name fills it in (it used to be dropped as a
        // duplicate, so "what do my Cell notes say about…" came back with no passage at all).
        for (const h of hits) {
          if (!h.recordId) continue;
          const known = byId.get(h.recordId);
          if (!known) byId.set(h.recordId, { recordId: h.recordId, name: h.name, snippet: h.snippet || null, page: h.pageNumber ?? null });
          else if (!known.snippet && h.snippet) Object.assign(known, { snippet: h.snippet, page: h.pageNumber ?? null });
        }
        // Found by name only: look inside it for the question (works without embeddings too — lexical).
        const words = q.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3).slice(0, 8).join(" ");
        await Promise.all([...byId.values()].filter((r) => !r.snippet && words).slice(0, 2).map(async (r) => {
          const inside = await searchRecordChunks({ userId: studentId, q: words, limit: 2, recordId: r.recordId }).catch(() => []);
          if (inside[0]?.snippet) Object.assign(r, { snippet: inside[0].snippet, page: inside[0].pageNumber ?? null });
        }));
        const tool = ["quiz", "flashcards", "summary", "notes", "podcast"].includes(input?.tool) ? input.tool : null;
        const records = [...byId.values()].slice(0, 5).map((r) => (tool ? { ...r, tool } : r));
        return records.length
          ? { records, ...(!tool && records.every((r) => !r.snippet) ? { note: "None of their passages matched the question — say that, and offer to open the document in the reader (it reads all of it). Never say you can't read or see inside their documents." } : {}),
            ...(tool ? { note: `Each link opens the document in the reader on its ${tool} tool, which builds it from the whole document — point them there in one line; don't write the ${tool} in chat, don't comment on the document's title or contents, and don't say what you can or can't see inside it (the reader reads all of it).` } : {}) }
          : { records: [], note: "Nothing in their Library matches — say so; don't invent a document." };
      } catch (error) { return { error: "Their Library is unavailable right now" }; }
}

export async function executeChatTool(name, input, studentId, options = {}) {
  const b = chatToolBasis(options);
  const refused = isSideEffecting(name, input) ? basisRefusal(b, { action: name }) : null;
  if (refused) return { success: false, code: refused.code, error: refused.message };
  // The writers below (the self-tooling audit, change cards) read it from the scope.
  return withActionBasis(b, () => runChatTool(name, input, callContext(studentId, options)));
}

function callContext(studentId, options = {}) {
  const ctx = {
    studentId,
    conversationId: options.conversationId ?? null,
    role: options.role ?? "student", channel: options.channel ?? "ai_chat",
  };
  ctx.executeChatTool = executeChatTool;
  // Bound recursion: same per-call scope, bypassing basis as the direct call did.
  ctx.runChatTool = (name, input) => runChatTool(name, input, ctx);
  return ctx;
}

let handlerMap = null;
function chatToolHandlers() {
  if (!handlerMap) {
    // Registered groups first (their tool names are disjoint, so order cannot
    // change a result); the learner-built tools branch and the unknown-tool
    // result follow in runChatTool, so the default stays LAST in dispatch order.
    handlerMap = {
      ...createHandlers({
        createToolDraft, TeachingToolError, createActivityDraft, listActivityDrafts, getActivityDraft, discardActivityDraft, reviseDraftPayload, instructorClassrooms,
        activityOutcomeSummary, listRecentActivities, listRoutines, createRoutine, updateRoutine, deleteRoutine,
        openAiChatTools, openAiInstructorTools, applyMergedDomain, applyChatsMerge, applyLibraryMerge,
        MERGED_DOMAINS, learnerToolDefsWithAreas, resolveLearnerSchoolContext, getMyLearningSessionsTool,
        clarify, asToolError,
      }),
      ...createSocialHandlers({ clarify, listMyGoalsTool, listMyTools, createGoal, updateGoal }),
      ...createNetworkStudyHandlers({ clarify, asToolError, getWeakTopicsTool, getPastQuestionPracticeTool, searchMyLibraryTool, listTasksTool }),
      ...createMergedHandlers({
        clarify, asToolError, executeChatTool, runLearnerTool, selfToolDeps, selfToolingAllowedFor, SELF_TOOLING_ROLES, toolAudience, isDryRun, createTool, saveComputation,
        MERGED_DOMAINS, dispatchMerged, mergedChatsEnabled, CHATS_BASE_ACTIONS, CHATS_MERGED_ACTIONS, runChatsViewAction,
        mergedLibraryEnabled, LIBRARY_BASE_ACTIONS, LIBRARY_MERGED_ACTIONS, runLibraryViewAction,
        getWeakTopicsTool, getPastQuestionPracticeTool, getMyLearningSessionsTool, listMyGoalsTool, listTasksTool, searchMyLibraryTool,
      }),
    };
  }
  return handlerMap;
}

export async function runChatTool(name, input, ctx) {
  const { studentId, conversationId = null, role = "student", channel = "ai_chat" } = ctx;
  // Agent console, DRY mode: anything that would change data is answered with
  // what it would have done — read-only tools still run for real.
  // create_tool handles dry mode itself: it builds and verifies, but doesn't save.
  if (isDryRun() && isSideEffecting(name, input) && name !== "create_tool") {
    return { dryRun: true, wouldDo: name, input, note: "DRY RUN — nothing was changed. Tell the learner exactly what you would have done." };
  }
  const handler = chatToolHandlers()[name];
  if (handler) return handler(input, ctx);
  // A tool the learner's agent built (self-tooling) — read-only, re-checked every call.
  if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
    const out = await runLearnerTool(name, input, studentId, {
      callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
      conversationId, dry: isDryRun(), audience: toolAudience(role),
    });
    if (out) return out;
  }
  return { error: `Unknown tool: ${name}` };
}

/** The library merge at def-assembly time: drop the legacy search_my_library
 *  def and the learner's own library_documents def, and put ONE merged def in
 *  their place — base + platform actions, plus the learner's visible delta
 *  actions, minus any merged-set action they switched off. No-op when the
 *  kill switch is off. */
export async function applyMergedDomain(defs, learnerId, cfg, builtinNames, withDelta = true) {
  if (!cfg.enabled()) return defs;
  const st = withDelta ? await getMergedToolState(learnerId, cfg.name).catch(() => null) : null;
  const delta = st && st.status === "active" ? cfg.deltaActions(st) : [];
  const kept = (defs || []).filter((d) => ![...builtinNames, cfg.name].includes(d?.function?.name));
  kept.push(cfg.def({ delta }));
  return kept;
}
export async function dispatchMerged(cfg, input, { studentId, platform, runDelta }) {
  const action = String(input?.action || cfg.actionOrder[0]);
  if (platform && platform[action]) return platform[action]();
  if (cfg.baseActions.includes(action)) return runMergedViewAction(cfg.name, action, input, studentId);
  const out = await runDelta();
  if (out) return out;
  return { error: `Unknown action "${action}" for this tool. Available: ${cfg.mergedActions.join(", ")}.` };
}
export async function applyChatsMerge(defs, learnerId, withDelta = true) {
  if (!mergedChatsEnabled()) return defs;
  const st = withDelta ? await getChatsToolState(learnerId).catch(() => null) : null;
  const delta = st && st.status === "active" ? chatsDeltaActions(st) : [];
  const kept = (defs || []).filter((d) => !["list_chats", "search_chats", "my_chats"].includes(d?.function?.name));
  kept.push(mergedChatsDef({ delta }));
  return kept;
}
export async function applyLibraryMerge(defs, learnerId, withDelta = true) {
  if (!mergedLibraryEnabled()) return defs;
  const st = withDelta ? await getLibraryToolState(learnerId).catch(() => null) : null;
  const delta = st && st.status === "active" ? libraryDeltaActions(st) : [];
  const disabled = []; // base actions are platform-owned now (My tools shows delta only); stored base toggles no longer apply
  const kept = (defs || []).filter((d) => !["search_my_library", "library_documents"].includes(d?.function?.name));
  kept.push(mergedLibraryDef({ delta, disabled }));
  return kept;
}

export function openAiChatTools({ allowToolRequest = true, selfTooling = true } = {}) {
  return getLearnerChatTools({ allowToolRequest, selfTooling }).map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
  }));
}

// Every tool message the model sees is a structured observation
// (utils/toolObservation.js): REASON → ACT → OBSERVE → LLM. The guide that
// keeps confirmations grounded lives in policies/TOOL_OBSERVATIONS.md
// (student) / policies/HITL_DRAFTS.md (instructor) — loaded by
// assembleChatDoctrine.

/**
 * clarify — the ONE no-guess shape every tool returns when a required input
 * was never stated by the user. The model must ask the question and wait,
 * not call the tool again with an invented value. Used across every tool
 * and workflow, both roles.
 */
/** A tool result, size-capped, for an inspected (gate/console) request. */
export function inspectResult(value) {
  try {
    const text = JSON.stringify(value ?? null);
    return text.length <= 4000 ? JSON.parse(text) : { truncated: true, preview: text.slice(0, 4000) };
  } catch { return { unserializable: true }; }
}

/** Before an activity tool runs from the instructor's chat: what the teacher never said → a clarify result, else null. */
/** The learner's latest message in this turn's transcript (text parts only). */
/** The agent's last reply in the kept dialogue ("" if none). */
export function lastAgentText(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "assistant") continue;
    return typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.filter((x) => x?.type === "text").map((x) => x.text).join(" ") : "";
  }
  return "";
}

export function latestUserText(transcript = []) {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    if (m?.role !== "user") continue;
    return typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.filter((x) => x?.type === "text").map((x) => x.text).join(" ") : "";
  }
  return "";
}

export async function unsaidActivityFields(tool, input, transcript) {
  const { unnamedFields, askFor, teacherTextOf, knownNames, currentRequest, TYPE_LABEL } = await import("../assessment/activityFields.js");
  let fields = null, check;
  if (tool === "prepare_activity") { fields = input; check = ["topic", "subject", "audience"]; }
  else if (tool === "schedule_activity_routine" && input?.brief) { fields = input.brief; check = ["topic", "subject", "audience"]; }
  else if (tool === "revise_activity_draft" && input?.audience) { fields = { audience: input.audience }; check = ["audience"]; }
  if (!fields) return null;
  // The activity asked for NOW, and only what was said since asking for it: a battle's
  // topic and class don't silently become the new assignment's (unless they say "the same").
  const req = tool === "prepare_activity" ? currentRequest(transcript) : { type: null, text: teacherTextOf(transcript), earlier: "" };
  if (req.type && input?.type && req.type !== input.type && !(req.type === "self_study" && input.type === "project")) {
    return { prepared: false, error: "wrong_type", asked: req.type,
      message: `The instructor asked for a ${TYPE_LABEL[req.type] || req.type}, not a ${TYPE_LABEL[input.type] || input.type}. Call prepare_activity with type "${req.type}" (asking first for anything they haven't said for it). Don't re-send or mention the earlier draft.` };
  }
  const missing = unnamedFields(fields, req.text, { known: await knownNames(db, fields), check });
  if (!missing.length) return null;
  // Said for an earlier activity: ask whether it's the same, rather than reuse it silently.
  const earlier = req.earlier ? unnamedFields(fields, req.earlier, { known: await knownNames(db, fields), check: missing.map((m) => m.field) }) : missing;
  const fromBefore = missing.filter((m) => !earlier.some((e) => e.field === m.field));
  const value = { topic: fields.topic, subject: fields.subject, audience: fields.audience?.classroom_name || (fields.audience?.whole_class ? "the whole class" : null) };
  const asks = missing.map((m) => (fromBefore.includes(m) && value[m.field]
    ? { ...m, question: `Same ${m.field === "audience" ? "class" : m.field} as before (${value[m.field]}), or a different one?` } : m));
  return clarify(missing.map((m) => m.field).join(","), askFor(asks), {
    prepared: false, error: "details_required", unsaid: missing.map((m) => m.field),
    message: "The instructor didn't say this. Ask them the question in `question` (in your own short words) and wait for their answer — never fill it in yourself, even when it seems obvious. Then call the tool again with what they said.",
  });
}

export function clarify(field, question, extra = {}) {
  return { needsClarification: true, missing: field, question, ...extra };
}

/** Phase 22 Part E: plan first when the request takes several steps and the agent is to act now (not ask, not stop). */
export const shouldPlanFirst = (intent) => !!(intent?.multiStep && intent.next === "proceed" && ["action", "change"].includes(intent.kind));
