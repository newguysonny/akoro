// Instructor and learner tool handlers for the Agent Chat dispatcher.
//
// The case bodies of runChatTool for the instructor activity tools, the
// capability/context reads, the school directory, the learner's learning
// sessions and create_task live here. tool-runtime.js owns the dispatcher and
// builds this map, passing its own helpers in through createHandlers — this
// module never imports tool-runtime, so recursion goes through the per-call
// context's runChatTool / executeChatTool seams and there is no import cycle.

import db from "../../../db.js";
import { AREAS, toolArea } from "./toolSelection.js";
import { stickyAreasFor, durableAgentChatContextEnabled } from "./runtime-state.js";
import { agentNetworkEnabled } from "./tool-catalogue-rest.js";
import { getLearnerProfileContext } from "../learner/learner-profile-context.js";
import { validateLearnerTaskInput } from "../learner/learner-task-validation.js";
import { localiseInstant } from "../../../lib/learnerTime.js";
import { scheduleAutonomyReviewForTask } from "../learner/learner-autonomy.js";

/**
 * Build the tool-name → handler map. `deps` carries the dispatcher's helpers
 * and the module functions the instructor/learner bodies call:
 * createToolDraft, TeachingToolError, the self-study drafts/outcomes/routines,
 * the merged-domain assemblers, MERGED_DOMAINS, learnerToolDefsWithAreas,
 * resolveLearnerSchoolContext, getMyLearningSessionsTool, clarify, asToolError.
 */
export function createHandlers(deps) {
  const {
    createToolDraft, TeachingToolError,
    createActivityDraft, listActivityDrafts, getActivityDraft, discardActivityDraft, reviseDraftPayload, instructorClassrooms,
    activityOutcomeSummary, listRecentActivities,
    listRoutines, createRoutine, updateRoutine, deleteRoutine,
    openAiChatTools, openAiInstructorTools, applyMergedDomain, applyChatsMerge, applyLibraryMerge,
    MERGED_DOMAINS, learnerToolDefsWithAreas,
    resolveLearnerSchoolContext, getMyLearningSessionsTool,
    clarify, asToolError,
  } = deps;

  return {
    // ── Instructor: activity creation, human-in-the-loop ──────────────────
    // These prepare drafts only. Assigning is the instructor's tap on the
    // preview (POST /api/self-study/drafts/:id/assign) — no tool reaches it.
    async run_teaching_tool(input, ctx) {
      const { studentId, conversationId, role, channel } = ctx;
      if (role !== "instructor") return { error: "Teaching tools are only available to instructor accounts" };
      const { tool, ...body } = input || {};
      try {
        // A draft first: the instructor previews it, asks for changes (each becomes the next
        // version) and saves it to the Library when they are happy — see self-study/toolDrafts.js.
        const { draft, tool: def } = await createToolDraft({ instructor: { id: studentId, role }, key: tool, body, sessionId: conversationId, channel });
        return {
          prepared: true, draftId: draft.id, title: draft.title, type: "teaching_tool", tool: def.key, name: def.name,
          audience: "Saved to your Library when you approve it", version: 1,
          previewHint: "Awaiting the instructor's preview — it is NOT in the Library yet. Never say it is saved or share a link.",
          questionsNote: "Version 1 is being written now — it appears on the Preview card in a minute. Reply with one short line saying what you are making; don't write the resource out or invent its content.",
        };
      } catch (e) {
        if (e?.status === "clarify") {
          return clarify("details", e.message, { prepared: false, error: "details_required",
            message: "Ask the instructor the question in `question`, then call run_teaching_tool again with their answer." });
        }
        if (e instanceof TeachingToolError) {
          return { prepared: false, error: e.message, code: e.code,
            guidance: e.code === "INSUFFICIENT_COINS" ? "Tell the instructor they need to top up coins."
              : "Tell the instructor exactly what is missing and ask for it." };
        }
        console.error("[run_teaching_tool] failed:", e.message);
        return { prepared: false, error: e.message || "Could not start that just now", guidance: "Say it did not work and offer to try again." };
      }
    },
    async prepare_activity(input, ctx) {
      const { studentId, conversationId, role, channel } = ctx;
      if (role !== "instructor") return { error: "Activity preparation is only available to instructor accounts" };
      try {
        const { draft, audienceLabel } = await createActivityDraft({
          instructor: { id: studentId, role }, input, sessionId: conversationId, channel,
        });
        const result = {
          prepared: true, draftId: draft.id, title: draft.title, type: draft.type,
          audience: audienceLabel, status: draft.status,
          previewHint: "Awaiting the instructor's preview — do not claim it was assigned.",
        };
        if (Array.isArray(draft.payload?.versions) && draft.payload.versions.length) {
          result.version = 1;
          result.questionsNote = "Version 1 of the questions is being written now — it appears on the Preview card in a minute. Reply with one short line; don't list or invent the questions.";
        }
        if (draft.payload?.plan_status === "pending") result.planNote = "The full study plan is being generated right now — it lands in the preview moments after this reply; the objectives stay editable there.";
        if (draft.payload?.due_notice) result.dueNote = draft.payload.due_notice;
        return result;
      } catch (error) {
        if (error.status === "clarify") {
          // The message carries a SPECIFIC question (missing audience,
          // subject, topic, or an ambiguous class) — relay it verbatim and
          // wait for the instructor's answer, never retry blind.
          return clarify("details", error.message,
            { prepared: false, error: "details_required",
              message: "Ask the instructor the question in `question`, then call prepare_activity again with their answer." });
        }
        console.error("[prepare_activity] failed:", error.status || "", error.message);
        return { prepared: false, error: error.message || "Could not prepare the draft",
          guidance: "Tell the instructor exactly what the error says and ask for that missing detail. Never call it a technical problem and never retry unchanged." };
      }
    },
    async list_activity_drafts(input, ctx) {
      const { studentId, role } = ctx;
      if (role !== "instructor") return { error: "Activity drafts are only available to instructor accounts" };
      try {
        const drafts = await listActivityDrafts({ id: studentId, role });
        return { drafts: drafts.map((d) => ({ draftId: d.id, title: d.title, type: d.type, preparedAt: d.created_at })) };
      } catch (error) { return { error: error.message || "Could not list drafts" }; }
    },
    async discard_activity_draft(input, ctx) {
      const { studentId, role } = ctx;
      if (role !== "instructor") return { error: "Activity drafts are only available to instructor accounts" };
      try {
        const draft = await discardActivityDraft({ id: studentId, role }, String(input?.draftId || ""));
        return { discarded: true, draftId: draft.id, title: draft.title };
      } catch (error) { return { discarded: false, error: error.message || "Could not discard the draft" }; }
    },
    async list_my_classrooms(input, ctx) {
      const { studentId, role } = ctx;
      if (role !== "instructor") return { error: "Class lists are only available to instructor accounts" };
      try {
        // Ownership is teacher_id (bench + seeds) or created_by. On an env
        // where the created_by column has not migrated in yet, the combined
        // filter would ERROR — fall back to teacher_id rather than reporting
        // an empty list (that fallback bug is exactly what once told an
        // instructor with six seeded classes they had none).
        let owned, ownedErr;
        ({ data: owned, error: ownedErr } = await db.from("classrooms")
          .select("id, name, description, student_limit, classroom_students(status, users ( full_name, username ))")
          .or(`teacher_id.eq.${studentId},created_by.eq.${studentId}`).order("created_at", { ascending: true }).limit(25));
        if (ownedErr) {
          ({ data: owned, error: ownedErr } = await db.from("classrooms")
            .select("id, name, description, student_limit, classroom_students(status, users ( full_name, username ))")
            .eq("teacher_id", studentId).order("created_at", { ascending: true }).limit(25));
        }
        if (ownedErr) return { error: "Could not read your classes: " + ownedErr.message };
        const shape = (c) => {
          const active = (c.classroom_students ?? []).filter((r) => r.status === "active");
          return {
            id: c.id, name: c.name,
            description: c.description || null,
            studentLimit: c.student_limit ?? null,
            learners: active.length,
            students: active.slice(0, 40).map((r) => ({ fullName: r.users?.full_name || null, username: r.users?.username || null })),
          };
        };
        if ((owned ?? []).length) return { classrooms: owned.map(shape) };
        // School admins may not own classrooms directly — try the school scope.
        const { data: school } = await db.from("school_profiles")
          .select("id").eq("admin_user_id", studentId).limit(1).maybeSingle();
        if (school?.id) {
          const { data: scoped, error: scopedErr } = await db.from("classrooms")
            .select("id, name, description, student_limit, classroom_students(status, users ( full_name, username ))")
            .eq("school_id", school.id).order("created_at", { ascending: true }).limit(25);
          if (scopedErr) return { error: "Could not read your school's classes: " + scopedErr.message };
          return { classrooms: (scoped ?? []).map(shape) };
        }
        return { classrooms: [] };
      } catch (error) { return { error: error.message || "Could not list the classes" }; }
    },
    async get_my_profile(input, ctx) {
      const { studentId, role } = ctx;
      if (role !== "instructor") return { error: "Your profile is only available to instructor accounts" };
      try {
        const { data: me, error: meErr } = await db.from("users")
          .select("full_name, email, username, role").eq("id", studentId).maybeSingle();
        if (meErr) return { error: "Could not load your profile: " + meErr.message };
        let classes = null;
        try {
          const rooms = await instructorClassrooms(studentId);
          classes = rooms.length;
        } catch { /* the count is cosmetic — never fail the profile on it */ }
        const { data: schoolRow } = await db.from("school_teachers")
          .select("school_profiles ( name )").eq("teacher_id", studentId).limit(1).maybeSingle();
        return {
          profile: {
            fullName: me?.full_name || null, email: me?.email || null,
            username: me?.username || null, role: me?.role || null,
            school: schoolRow?.school_profiles?.name || null,
            classes,
          },
        };
      } catch (error) { return { error: error.message || "Could not load your profile" }; }
    },
    async check_activity_outcomes(input, ctx) {
      const { studentId, role } = ctx;
      if (role !== "instructor") return { error: "Activity outcomes are only available to instructor accounts" };
      try {
        if (input?.assignmentId) {
          const summary = await activityOutcomeSummary({ id: studentId, role }, String(input.assignmentId));
          if (!summary) return { error: "Activity not found among your activities" };
          return summary;
        }
        const recent = await listRecentActivities({ id: studentId, role }, 5);
        return { pickOne: true, recent: recent.map((a) => ({ assignmentId: a.id, title: a.title, type: a.type, createdAt: a.created_at })),
          hint: "Ask the instructor which one to look at, then call again with its assignmentId." };
      } catch (error) { return { error: error.message || "Could not read the outcomes" }; }
    },
    async schedule_activity_routine(input, ctx) {
      const { studentId, role } = ctx;
      if (role !== "instructor") return { error: "Routines are only available to instructor accounts" };
      try {
        const routine = await createRoutine({ id: studentId, role }, input);
        return { scheduled: true, routineId: routine.id, title: routine.title, day: input?.day, hourUtc: routine.hour,
          note: "Each occurrence prepares a DRAFT for review - never an automatic assignment." };
      } catch (error) {
        if (error.message === "audience_required") {
          return clarify("audience", "Who is this weekly activity for - the whole class, or specific learners?",
            { scheduled: false, error: "audience_required",
              message: "Ask the instructor who each occurrence is for, then schedule with their answer." });
        }
        return { scheduled: false, error: error.message || "Could not schedule the routine" };
      }
    },
    async list_activity_routines(input, ctx) {
      const { studentId, role } = ctx;
      if (role !== "instructor") return { error: "Routines are only available to instructor accounts" };
      try {
        const routines = await listRoutines({ id: studentId, role });
        return { routines: routines.map((r) => ({ routineId: r.id, title: r.title, day: r.day_of_week, hourUtc: r.hour, status: r.status, briefType: r.brief?.type })) };
      } catch (error) { return { error: error.message || "Could not list routines" }; }
    },
    async cancel_activity_routine(input, ctx) {
      const { studentId, role } = ctx;
      if (role !== "instructor") return { error: "Routines are only available to instructor accounts" };
      try {
        const out = await deleteRoutine({ id: studentId, role }, String(input?.routineId || ""));
        return { cancelled: true, routineId: out.id };
      } catch (error) { return { cancelled: false, error: error.message || "Could not cancel the routine" }; }
    },
    async get_activity_draft(input, ctx) {
      const { studentId, role } = ctx;
      if (role !== "instructor") return { error: "Activity drafts are only available to instructor accounts" };
      try {
        const draft = await getActivityDraft({ id: studentId, role }, String(input?.draftId || ""));
        return {
          draftId: draft.id, status: draft.status, title: draft.title, type: draft.type,
          subject: draft.subject, topic: draft.topic,
          instructions: draft.payload?.instructions ?? null,
          difficulty: draft.payload?.difficulty ?? null,
          subtopics: draft.payload?.subtopics ?? null,
          objectives: draft.payload?.objectives ?? null,
          stages: draft.payload?.details?.stages ?? null,
          scheduledHint: draft.payload?.details?.scheduled_hint ?? null,
          // An assignment's question versions: what each is, and the newest's questions.
          versions: Array.isArray(draft.payload?.versions) ? draft.payload.versions.map((v) => ({
            version: v.n, status: v.status, note: v.note ?? null, edited: !!v.edited, summary: v.summary?.line ?? null,
          })) : null,
          latestQuestions: (() => {
            const v = [...(draft.payload?.versions || [])].reverse().find((x) => x.status === "ready");
            return v ? (v.paper?.questions || []).map((q, i) => `Q${i + 1} [${q.type || (q.options ? "MCQ" : "open")}${q.figure ? ", diagram" : ""}] ${String(q.q).slice(0, 140)}`) : null;
          })(),
          audience: draft.audience ?? null,
          ...(draft.type === "teaching_tool" ? {
            tool: draft.payload?.tool ?? null,
            latestResult: (() => {
              const v = [...(draft.payload?.versions || [])].reverse().find((x) => x.status === "ready");
              return v?.result ? v.result.entries.map((e) => e.title).filter(Boolean).slice(0, 12) : null;
            })(),
          } : {}),
        };
      } catch (error) { return { error: error.message || "Could not read the draft" }; }
    },
    async revise_activity_draft(input, ctx) {
      const { studentId, role } = ctx;
      if (role !== "instructor") return { error: "Activity drafts are only available to instructor accounts" };
      try {
        const { draft, applied, version } = await reviseDraftPayload({ id: studentId, role }, String(input?.draftId || ""), input);
        return {
          revised: true, draftId: draft.id, title: draft.title, type: draft.type,
          audience: draft.audience?.label ?? null, applied,
          ...(version ? { version, questionsNote: `Version ${version} is being written now from the instructor's follow-up — it appears as a new tab in the preview. Reply with one short line.` } : {}),
          changeNote: String(input?.changeNote || "").slice(0, 200) || null,
          previewHint: "The updated draft is awaiting the instructor's preview again — still not assigned.",
        };
      } catch (error) { return { revised: false, error: error.message || "Could not revise the draft" }; }
    },
    async get_agent_capabilities(input, ctx) {
      const { studentId, conversationId, role } = ctx;
      // Area loading (runtime selection): with { area }, load that area's
      // tools into this conversation and hand their defs back (__addTools)
      // so this same turn can use them.
      const wantArea = String(input?.area || "").trim().toLowerCase();
      if (wantArea) {
        if (!AREAS[wantArea]) return { error: `Unknown area "${wantArea}". Areas: ${Object.keys(AREAS).join(", ")}.` };
        stickyAreasFor(conversationId).add(wantArea);
        const builtIns = openAiChatTools().filter((t) => toolArea(t.function.name) === wantArea);
        const { defs: ownDefs, areas: ownAreas } = await learnerToolDefsWithAreas(studentId, role === "instructor" ? "instructor" : "learner").catch(() => ({ defs: [], areas: new Map() }));
        let adds = [...builtIns, ...ownDefs.filter((d) => ownAreas.get(d.function.name) === wantArea)];
        if (role === "instructor") {
          // Instructor catalogue: their built-ins in the area (the learner
          // builtIns above are not theirs), plus their own tools, with the
          // merged instructor domains assembled when activities load.
          adds = [...openAiInstructorTools().filter((t) => toolArea(t.function.name) === wantArea),
            ...ownDefs.filter((d) => ownAreas.get(d.function.name) === wantArea)];
          if (wantArea === "activities") {
            adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_classes, ["list_my_classrooms"], true);
            adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_class_students, [], true);
            adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_activities, [], true);
            adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_activity_results, ["check_activity_outcomes"], true);
            adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_activity_drafts, ["list_activity_drafts", "get_activity_draft"], true);
          }
        }
        else if (wantArea === "files" && role !== "instructor") adds = await applyLibraryMerge(adds, studentId, true);
        else if (wantArea === "chats" && role !== "instructor") adds = await applyChatsMerge(adds, studentId, true);
        else if (wantArea === "plans" && role !== "instructor") { adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_tasks, ["list_tasks"], true); adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_goals, ["list_my_goals"], true); }
        else if (wantArea === "teaching" && role !== "instructor") { adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_study_notes, ["search_my_study_knowledge"], true); adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_study_sessions, ["get_my_learning_sessions"], true); }
        else if (wantArea === "progress" && role !== "instructor") { adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_past_questions, ["get_past_question_practice"], true); adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_weak_topics, ["get_weak_topics"], true); }
        return { loaded: wantArea, areaLabel: AREAS[wantArea], tools: adds.map((d) => d.function.name),
          note: `The ${AREAS[wantArea]} tools are loaded for this conversation now — continue the learner's request with them.`,
          __addTools: adds };
      }
      // Default-on keys consult the kill-switch semantics, not strict equality,
      // so the card must never deny an ability the runtime has.
      const enabled = (key) => ["AKORO_EXAM_PREP_CONFIDENCE_ENABLED", "AKORO_ADAPTIVE_WORKFLOWS_ENABLED", "AKORO_STUDY_PREP_ENABLED"].includes(key)
        ? String(process.env[key] ?? "true").toLowerCase() !== "false"
        : String(process.env[key] || "").toLowerCase() === "true";
      return {
        areas: Object.entries(AREAS).map(([id, label]) => ({ id, label })),
        sections: [
          { title: "Study support", items: ["Explain and quiz you on what you have taught it — it is your protégé", "Tell you honestly what you haven\u2019t taught it yet, point you to sources and ask you to teach it", "Ask NaNa, its teaching guide, when you insist on something it wasn\u2019t taught (and say so)", "Help draft and improve study notes, essays, and revision plans", "Show safe study profile, learning overview, knowledge-map, saved-study-knowledge, guide-preference, and Online/Offline status when asked",
            // same default-on semantics as the tool's featureGate
            ...(String(process.env.AKORO_AGENT_PEER_CONSULT_ENABLED ?? "true").toLowerCase() !== "false"
              ? ["Ask other learners\u2019 study agents for fresh ideas when you\u2019re stuck \u2014 only your question travels, never your data"] : [])] },
          { title: "School", items: ["Show your school and class, its subjects, and your teachers — and find a teacher by name or subject"] },
          ...(agentNetworkEnabled ? [{ title: "Battles and other agents", items: [
            "Find your battles and the daily battle, and show your XP and rank",
            "Search for other learners' agents (online now, by subject, school, exam…) and their challenge requests",
            "Challenge agents, post or accept a challenge request, rematch — only when you ask",
            "Message or consult other agents, check your agent's inbox, and reply — only when you ask",
            "Study buddies, the daily battle, revision circles and the weekly league",
          ] }] : []),
          { title: "Organisation", items: ["Create learner-owned study tasks when explicitly asked", "Schedule a future chat message when explicitly asked", "Show due tasks and recorded learning progress", "Save, update and track study goals when explicitly asked", "Show the suggestions from its background reviews waiting in the inbox", "Draft, save and publish the learner\u2019s blog posts when explicitly asked"] },
          { title: "Learning tools", items: [
            ...(enabled("AKORO_STUDY_PREP_ENABLED") ? ["Plan a study-prep session for a test or exam — a plan card you approve before anything starts"] : []),
            "Show your past and recent learning sessions",
            ...(enabled("AKORO_EXAM_PREP_CONFIDENCE_ENABLED") ? ["Show generated exam-style practice and workflow status; these are not historical past papers"] : []),
            ...(enabled("AKORO_CONCEPT_TRACKER_ENABLED") ? ["Show approved-concept progress, resume points, and clearable confusion notes"] : []),
            ...(enabled("AKORO_LEARNER_INSIGHTS_ENABLED") ? ["Explain a bounded, expiry-aware learning-insights summary"] : []),
            // Consult the REAL gate (default-on), not a strict env-equality
            // check — the card must never deny an ability the runtime has.
            ...(durableAgentChatContextEnabled ? ["Remember across chats — this conversation and the learner\u2019s saved study context are available to you (they can clear it any time)"] : []),
          ] },
          { title: "Limits", items: ["Asks a clarifying question when a tool needs a detail you did not give — it never guesses values", "Read supported files attached to this chat", "Generated questions are not historical past papers", "Can submit an admin feature request only after you explicitly ask", "Research from Akoro\u2019s own blog (search_blog_posts / read_blog_post) \u2014 do not browse the live web, access private account secrets, or take unrequested actions"] },
        ].filter((section) => section.items.length),
      };
    },
    async get_learner_context(input, ctx) {
      return getLearnerProfileContext(ctx.studentId).catch(asToolError("your profile"));
    },
    async check_progress(input, ctx) {
      const { studentId } = ctx;
      const { data: enrollments } = await db.from("enrollments")
        .select("course_id, progress, courses!inner(title, subject, slug)")
        .eq("user_id", studentId).eq("status", "active");
      // The OVERALL row — the table has one per scope (global/course/classroom).
      const { data: xpRow } = await db.from("xp_leaderboard")
        .select("total_xp, rank").eq("user_id", studentId).eq("scope", "global").limit(1);
      return {
        courses:  (enrollments ?? []).map(e => ({ title: e.courses?.title, subject: e.courses?.subject, progress: e.progress ?? 0, slug: e.courses?.slug || null })),
        total_xp: xpRow?.[0]?.total_xp ?? 0,
        rank:     xpRow?.[0]?.rank ?? "—",
      };
    },
    async get_progress_overview(input, ctx) {
      // The progress bundle in ONE call (2026-11-17): the four reads a
      // "how am I doing?" answer needs, run together server-side. Each part
      // keeps the shape its own tool returns; a part that fails carries its
      // error in place so the rest still answer.
      const part = async (tool) => {
        try { return await ctx.runChatTool(tool, {}); }
        catch { return { error: "Couldn't load this part just now." }; }
      };
      const [progress, overview, ranking, knowledgeMap] = await Promise.all([
        part("check_progress"), part("get_learning_overview"), part("get_ranking"), part("get_knowledge_map"),
      ]);
      return { progress, overview, ranking, knowledgeMap };
    },
    async get_my_school(input, ctx) {
      const { studentId } = ctx;
      try {
        const schoolCtx = await resolveLearnerSchoolContext(studentId);
        // No school anywhere: the honest answer is "none is linked" — the
        // agent says exactly that instead of inventing a school.
        return {
          school: schoolCtx.school,
          className: schoolCtx.className,
          sectionName: schoolCtx.sectionName,
          classrooms: schoolCtx.classrooms.map((c) => c.name),
        };
      } catch (error) { return { error: error.message || "Could not load your school right now" }; }
    },
    async list_school_subjects(input, ctx) {
      const { studentId } = ctx;
      try {
        const schoolCtx = await resolveLearnerSchoolContext(studentId);
        if (!schoolCtx.schoolId) {
          // No school link: the only honest subject signal is what the
          // learner's own classroom teachers declare.
          const subjects = [];
          const teacherIds = [...new Set(schoolCtx.classrooms.map((c) => c.teacher_id).filter(Boolean))];
          if (teacherIds.length) {
            const { data: profiles } = await db.schema("edu").from("teacher_profiles")
              .select("teacher_id, teacher_name, subject").in("teacher_id", teacherIds);
            const byTeacher = new Map((profiles ?? []).map((p) => [p.teacher_id, p]));
            for (const room of schoolCtx.classrooms) {
              const profile = room.teacher_id ? byTeacher.get(room.teacher_id) : null;
              if (profile?.subject) subjects.push({ name: profile.subject, teacher: profile.teacher_name || null, class: room.name });
            }
          }
          return { subjects, source: "classroom teachers",
            note: "No school is linked to this learner, so this list comes from their classroom teachers only — say that when you use it." };
        }
        const { data: schoolSubjects, error: subjErr } = await db.schema("mgmt").from("subjects")
          .select("id, name, code, subject_type").eq("school_id", schoolCtx.schoolId).order("name").limit(60);
        if (subjErr) return { error: "Could not load the school's subjects: " + subjErr.message };
        let classSubjects = null;
        if (schoolCtx.classId) {
          const { data: assigned, error: assignedErr } = await db.schema("mgmt").from("class_subjects")
            .select("subject_id, teacher_id, is_elective").eq("class_id", schoolCtx.classId).limit(60);
          if (!assignedErr && (assigned ?? []).length) {
            const subjById = new Map((schoolSubjects ?? []).map((s) => [s.id, s]));
            const teacherIds = [...new Set(assigned.map((r) => r.teacher_id).filter(Boolean))];
            // An empty .in() is not a valid PostgREST filter — guard it.
            const teacherRows = teacherIds.length
              ? (await db.from("users").select("id, full_name").in("id", teacherIds)).data
              : [];
            const nameById = new Map((teacherRows ?? []).map((u) => [u.id, u.full_name]));
            classSubjects = assigned
              .map((r) => ({
                subject: subjById.get(r.subject_id)?.name || null,
                elective: Boolean(r.is_elective),
                teacher: r.teacher_id ? (nameById.get(r.teacher_id) || null) : null,
              }))
              .filter((s) => s.subject);
          }
        }
        return {
          school: schoolCtx.school?.name || null,
          class: schoolCtx.className ? (schoolCtx.sectionName ? `${schoolCtx.className} ${schoolCtx.sectionName}` : schoolCtx.className) : null,
          subjects: (schoolSubjects ?? []).map((s) => ({ name: s.name, code: s.code || null, type: s.subject_type || "core" })),
          classSubjects,
          note: classSubjects ? "subjects = the whole school; classSubjects = the learner's own class." : null,
        };
      } catch (error) { return { error: error.message || "Could not load the school's subjects right now" }; }
    },
    async list_my_teachers(input, ctx) {
      const { studentId } = ctx;
      try {
        const schoolCtx = await resolveLearnerSchoolContext(studentId);
        const teachers = [];
        const seen = new Set();
        const push = (fullName, subject, teaches) => {
          if (!fullName) return;
          const key = `${fullName}|${subject || ""}`;
          if (seen.has(key)) return;
          seen.add(key);
          teachers.push({ fullName, subject: subject || null, teaches: teaches || null });
        };
        const classroomTeacherIds = [...new Set(schoolCtx.classrooms.map((c) => c.teacher_id).filter(Boolean))];
        if (classroomTeacherIds.length) {
          const { data: rows } = await db.from("users").select("id, full_name").in("id", classroomTeacherIds);
          const { data: profiles } = await db.schema("edu").from("teacher_profiles")
            .select("teacher_id, teacher_name, subject").in("teacher_id", classroomTeacherIds);
          const profileBy = new Map((profiles ?? []).map((p) => [p.teacher_id, p]));
          const nameBy = new Map((rows ?? []).map((u) => [u.id, u.full_name]));
          for (const room of schoolCtx.classrooms) {
            const profile = room.teacher_id ? profileBy.get(room.teacher_id) : null;
            push(nameBy.get(room.teacher_id) || profile?.teacher_name || null, profile?.subject || null, room.name);
          }
        }
        if (schoolCtx.classId && schoolCtx.schoolId) {
          const { data: assigned } = await db.schema("mgmt").from("class_subjects")
            .select("subject_id, teacher_id").eq("class_id", schoolCtx.classId).limit(60);
          const rows = (assigned ?? []).filter((r) => r.teacher_id);
          if (rows.length) {
            const { data: subjRows } = await db.schema("mgmt").from("subjects")
              .select("id, name").eq("school_id", schoolCtx.schoolId).limit(100);
            const subjBy = new Map((subjRows ?? []).map((s) => [s.id, s.name]));
            const { data: users } = await db.from("users")
              .select("id, full_name").in("id", [...new Set(rows.map((r) => r.teacher_id))]);
            const nameBy = new Map((users ?? []).map((u) => [u.id, u.full_name]));
            const classLabel = schoolCtx.className ? (schoolCtx.sectionName ? `${schoolCtx.className} ${schoolCtx.sectionName}` : schoolCtx.className) : null;
            for (const r of rows) push(nameBy.get(r.teacher_id), subjBy.get(r.subject_id) || null, classLabel);
          }
        }
        return { teachers };
      } catch (error) { return { error: error.message || "Could not load your teachers right now" }; }
    },
    async find_teacher(input, ctx) {
      const { studentId } = ctx;
      try {
        const name = String(input?.name || "").trim().replace(/[%_\\]/g, " ");
        if (name.length < 2) {
          return clarify("name", "Which teacher would you like me to find? Tell me their name — for example 'Mrs Adeyemi'.", { action: "find_teacher" });
        }
        const schoolCtx = await resolveLearnerSchoolContext(studentId);
        // Scope: the learner's school staff plus their own classroom teachers.
        const ids = new Set(schoolCtx.classrooms.map((c) => c.teacher_id).filter(Boolean));
        if (schoolCtx.schoolId) {
          const { data: staff } = await db.from("school_teachers")
            .select("teacher_id").eq("school_id", schoolCtx.schoolId).limit(200);
          for (const r of staff ?? []) if (r.teacher_id) ids.add(r.teacher_id);
        }
        if (!ids.size) return { matches: [], searchedFor: name,
          note: "No teachers are linked to this learner's school or classrooms yet." };
        const { data: users, error: usersErr } = await db.from("users")
          .select("id, full_name").eq("role", "instructor")
          .in("id", [...ids]).ilike("full_name", `%${name}%`).limit(5);
        if (usersErr) return { error: "Could not search for that teacher: " + usersErr.message };
        const matches = [];
        for (const u of users ?? []) {
          const { data: profile } = await db.schema("edu").from("teacher_profiles")
            .select("teacher_name, subject").eq("teacher_id", u.id).limit(1).maybeSingle();
          const { data: rooms } = await db.from("classrooms")
            .select("name").eq("teacher_id", u.id).limit(10);
          matches.push({
            fullName: u.full_name || profile?.teacher_name || null,
            subject: profile?.subject || null,
            classes: (rooms ?? []).map((r) => r.name),
            school: schoolCtx.school?.name || null,
          });
        }
        return { matches: matches.filter((m) => m.fullName), searchedFor: name };
      } catch (error) { return { error: error.message || "Could not look up that teacher right now" }; }
    },
    async get_my_learning_sessions(input, ctx) {
      return getMyLearningSessionsTool(ctx.studentId);
    },
    async create_task(input, ctx) {
      const { studentId } = ctx;
      if (!input?.title || !String(input.title).trim()) {
        return clarify("title", "What should the task be called?", { action: "create_task" });
      }
      try {
        const context = await getLearnerProfileContext(studentId);
        const taskInput = validateLearnerTaskInput(input, { defaultTimezone: context.timeZone });
        if (taskInput.recurrenceEverySeconds && !taskInput.dueAt) {
          return clarify("dueAt", "A repeating task needs a due time to anchor it — when should the first one be due (a date/time, or 'in 2 hours')?", { action: "create_task" });
        }
        const { data: agentRow } = await db.from("user_agents").select("id").eq("user_id", studentId).maybeSingle();
        // tasks.agent_id is required — a learner who hasn't made their agent yet
        // got a raw database error here.
        if (!agentRow?.id) return { error: "Create your agent first (Agent tab) — tasks are kept by your agent." };
        const { data: task, error } = await db.from("tasks").insert({
          creator_id: studentId, agent_id: agentRow?.id,
          title: taskInput.title, description: taskInput.description, priority: taskInput.priority,
          status: "pending", task_type: "general",
          payload: {
            due: taskInput.due,
            course: taskInput.course,
            ...(taskInput.recurrenceEverySeconds ? { recurrence: { everySeconds: taskInput.recurrenceEverySeconds } } : {}),
          },
          due_at: taskInput.dueAt,
          timezone: taskInput.timezone,
        }).select().single();
        if (error) return { error: error.message };
        // This is intentionally best-effort: creating a learner-requested task
        // never depends on Redis, and the worker re-checks the persisted opt-in.
        try { await scheduleAutonomyReviewForTask(task); }
        catch (autonomyError) { console.warn("[chat/create-task] autonomy schedule skipped:", autonomyError.message); }
        global.io?.to(`user:${studentId}`).emit("task:created", task);
        return {
          created: true, taskId: task.id, title: task.title, description: task.description,
          priority: task.priority, dueAt: task.due_at ?? null, timezone: task.timezone,
          dueLocal: task.due_at ? localiseInstant(task.due_at, taskInput.timezone) : null,
          repeatsEveryDays: taskInput.recurrenceEveryDays || null,
          repeatsEverySeconds: taskInput.recurrenceEverySeconds || null,
          autonomyEligible: Boolean(task.due_at && !task.is_recurring),
        };
      } catch (error) {
        return { error: error.message || "Could not create the task" };
      }
    },
  };
}
