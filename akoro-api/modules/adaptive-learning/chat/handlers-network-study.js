// Agent-network, battle, study-data and study-prep tool handlers for the
// Agent Chat dispatcher.
//
// The case bodies of runChatTool for other learners' agents and battles,
// the learner's learning data, Library/material/upload tools, the concept,
// insights, exam-prep, memory and preference reads, the study-prep and
// agent-check control, and the tool/admin requests live here. tool-runtime.js
// owns the dispatcher and builds this map, passing its own helpers in through
// createHandlers — this module never imports tool-runtime, so recursion goes
// through the per-call context's seams and there is no import cycle.

import db from "../../../db.js";
import { appLink } from "../../../lib/urls.js";
import { protegeDeps } from "./handlers-social.js";
import { consultPeerAgents, consultBreakthroughs, PEER_QUESTION_MIN, PEER_QUESTION_MAX } from "../social/peerConsult.js";
import { agentNetworkEnabled } from "./tool-catalogue-rest.js";
import { studyPrepEnabled } from "./runtime-state.js";
import { classForExam } from "../intent/agent-chat-intent.js";
import { searchAgents, saveSettings as saveAgentNetworkSettings, block as blockAgent, report as reportAgent, logPastQuestions, pastQuestionSummary } from "../../agent-network/network.js";
import { challengeAgents, postChallengeRequest, searchChallengeRequests, acceptChallengeRequest, cancelChallengeRequest, rematch } from "../../agent-network/challenges.js";
import { requestGuideReview } from "../../battle/guideReview.js";
import { classBattleFromChat } from "../../battle/chatBattle.js";
import { messageAgent, inbox as agentInbox, replyToAgent, consultOnlineAgents, inboxBrief } from "../../agent-network/messaging.js";
import {
  requestBuddy, respondBuddy, listBuddies, buddyCheckin, endBuddy, buddyBrief,
  joinDaily, skipDaily, dailyRanking, dailyStatus, createCircle, searchCircles, joinCircle, leaveCircle, weeklyLeague,
} from "../../agent-network/activities.js";
import { resolveMaterialsFolder } from "../../materials/studySource.js";
import { recurringTopics } from "../../materials/structureCore.js";
import { createLearnerToolRequest } from "../../agent-tool-requests/service.js";
import {
  getAgentPreferenceSummary,
  getAutonomyStatus,
  getChatMemory,
  getConceptTrackerSummary,
  getExamPrepStatus,
  getKnowledgeMap,
  getLearningInsightsSummary,
  getLearningOverview,
  searchMyStudyKnowledge,
} from "../learner/learner-chat-read-tools.js";

// chat.js re-exports these two from here, so the messaging module keeps one importer.
export { inboxBrief, buddyBrief };

/**
 * Build the tool-name → handler map. `deps` carries the dispatcher's helpers
 * (clarify, asToolError) and the read tools defined in tool-runtime.js.
 */
export function createHandlers(deps) {
  const {
    clarify, asToolError, getWeakTopicsTool, getPastQuestionPracticeTool,
    searchMyLibraryTool, listTasksTool,
  } = deps;

  return {
    async consult_peer_agents(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      const question = String(input?.question || "").trim();
      if (question.length < PEER_QUESTION_MIN || question.length > PEER_QUESTION_MAX) {
        return clarify("question", `Keep the peer question between ${PEER_QUESTION_MIN} and ${PEER_QUESTION_MAX} characters — one focused, general ask.`, { action: "consult_peer_agents" });
      }
      if (/[\w.+-]+@[\w-]+\.[\w.-]{2,}/.test(question) || /\+?\d[\d\s().-]{7,}\d/.test(question)) {
        return clarify("question", "Keep peer questions general — no contact details (emails, phone numbers or invite links) travel to other agents.", { action: "consult_peer_agents" });
      }
      try {
        // §7.13: a named struggle first asks what worked for learners who got past the
        // same one (their breakthroughs, opt-in stories + anonymous totals) — no model call.
        if (input?.struggleType) {
          const help = await consultBreakthroughs({ userId: studentId, struggleType: String(input.struggleType).slice(0, 60),
            concept: input?.concept ? String(input.concept).slice(0, 120) : null, subject: input?.subject ? String(input.subject).slice(0, 80) : null });
          if (help?.stories?.length || help?.pattern) {
            return { ...help, note: "These are real breakthroughs from other learners who had the same struggle. Share one story's what-worked move, naming the agent (never a learner), and offer to try it; a pattern is totals only. Never treat them as evidence." };
          }
        }
        // Real agents first: up to two ONLINE agents answer from what their
        // own learners taught them (the asker pays). Nobody online → the
        // simulated peer ideas, as before.
        if (agentNetworkEnabled) {
          const live = await consultOnlineAgents(studentId, question, { topic: input?.topic || null, deps: protegeDeps }).catch(() => null);
          if (live?.consulted) return { ...live, note: "These are real learners' agents online now — say each reply comes from that learner's agent, by name." };
        }
        const consult = await consultPeerAgents({
          userId: studentId, question,
          topic: input?.topic,
        });
        if (!consult.consulted) {
          return {
            consulted: 0, replies: [],
            note: consult.note === "no_peers_yet"
              ? "No other agents are active on the network yet — answer from your own knowledge instead."
              : consult.note === "contact_details"
              ? "The question was rejected by the privacy guard — rephrase it generally."
              : "No peer agent could answer just now — answer from your own knowledge instead.",
          };
        }
        return consult; // { consulted, replies: [{agent, emoji, reply}], topic }
      } catch (error) {
        return { error: error.message || "The agent network is unavailable right now" };
      }
    },
    async list_tasks(input, ctx) { return listTasksTool(ctx.studentId); },
    async search_agents(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (role === "instructor") return { error: "The agent network is for learners." };
      const r = await searchAgents(studentId, input || {});
      return {
        agents: r.agents.map((a) => ({
          userId: a.userId, name: a.name, username: `@${a.username}`, agent: `${a.agentEmoji} ${a.agentName}`, level: a.level, xp: a.xp,
          rank: a.rank, winRate: a.winRate, presence: a.presence, available: a.available, school: a.school, yearGroup: a.yearGroup,
          exam: a.exam, subjects: a.subjects, shared: a.shared, matches: a.matches, openToChallenges: a.openToChallenges, battleTimes: a.battleTimes,
        })),
        total: r.total, page: r.page,
        note: r.total ? "Use the names exactly as given. Offer to message, consult or challenge one of them." : "No agents match — try fewer filters or a wider scope.",
      };
    },
    async update_agent_network_settings(input, ctx) { if (ctx.role === "instructor") return { error: "The agent network is for learners." }; try { return { saved: true, settings: await saveAgentNetworkSettings(ctx.studentId, input || {}) }; } catch (e) { return { saved: false, error: e.message }; } },
    async block_agent(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (role === "instructor") return { error: "The agent network is for learners." };
      if (!input?.userId) return clarify("userId", "Which agent should I block? Find them with search_agents first.");
      try {
        if (input.report_reason) await reportAgent(studentId, input.userId, input.report_reason, { via: "agent_chat" });
        else await blockAgent(studentId, input.userId);
        return { blocked: true, reported: !!input.report_reason };
      } catch (e) { return { blocked: false, error: e.message }; }
    },
    async log_past_question_practice(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (role === "instructor") return { error: "The agent network is for learners." };
      try {
        const logged = await logPastQuestions(studentId, { ...input, source: "agent" });
        return { logged: true, entry: logged, summary: await pastQuestionSummary(studentId) };
      } catch (e) { return { logged: false, error: e.message }; }
    },
    async find_competitors(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (role === "instructor") return { error: "The agent network is for learners." };
      const { source, ...rest } = input || {};
      const r = await searchAgents(studentId, { ...rest, scope: source || "everyone", open_to_challenges: true, fair_match: rest.fair_match ?? (rest.min_xp == null && rest.max_xp == null && rest.rank_max == null), sort: "relevance" });
      return {
        agents: r.agents.map((a) => ({
          userId: a.userId, name: a.name, username: `@${a.username}`, agent: `${a.agentEmoji} ${a.agentName}`, level: a.level, xp: a.xp, rank: a.rank,
          winRate: a.winRate, presence: a.presence, available: a.available, shared: a.shared, battleTimes: a.battleTimes, openToChallenges: true, matches: a.matches,
        })),
        total: r.total,
        note: r.total ? "Offer to challenge one (challenge_agent), or post a challenge request so others can take it." : "Nobody matches — offer to post a challenge request instead.",
      };
    },
    async challenge_agent(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (role === "instructor") return { error: "The agent network is for learners." };
      if (!Array.isArray(input?.opponents) || !input.opponents.length) return clarify("opponents", "Who should I challenge? I can find opponents first.");
      if (!input?.subject) return clarify("subject", "Which subject should the battle be on?");
      try {
        const b = await challengeAgents(studentId, input);
        if (b.seriesId) return { challenged: true, recurring: true, seriesId: b.seriesId, kind: b.kind, invited: b.invited.length, nextAt: b.nextAt, repeats: b.repeats,
          note: "A recurring battle: they're in every one automatically (they can skip one or opt out). Each one appears in the Battles tab an hour before it starts; the series is on the Challenges tab." };
        return { challenged: true, battleId: b.battleId, kind: b.kind, invited: b.invited.length, questions: b.placed, status: b.status,
          note: b.status === "invited" ? "They've been sent the challenge — it starts when they accept (or at the scheduled time). It's in the Battles tab." : "Starting soon." };
      } catch (e) { return { challenged: false, error: e.message }; }
    },
    async class_battle(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (role === "instructor") return { error: "Teachers set class battles from the battle form (prepare_activity type battle)." };
      try {
        const r = await classBattleFromChat(studentId, input || {});
        if (r.series_id) return { created: true, recurring: true, seriesId: r.series_id, nextAt: r.next_at, invited: r.invited, where: r.place, repeats: r.repeats,
          note: "A recurring battle: they're in every one automatically (they can skip one or opt out). The series is on the Challenges tab." };
        return { created: true, battleId: r.battle_id, battleType: r.battle_type, status: r.status, invited: r.invited, questions: r.questions, where: r.place,
          skipped: r.skipped, note: "They've been invited; it's in the Battles tab." };
      } catch (e) { return { created: false, error: e.message }; }
    },
    async post_challenge_request(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (role === "instructor") return { error: "The agent network is for learners." };
      if (!input?.subject) return clarify("subject", "Which subject should the challenge be on?");
      try {
        const r = await postChallengeRequest(studentId, input);
        if (r.series) return { posted: true, recurring: true, seriesId: r.seriesId, nextAt: r.nextAt, scope: r.scope, repeats: r.repeats,
          note: "A recurring post: a fresh one goes up 12 hours before each start for others to take. The series is on the Challenges tab." };
        return { posted: true, requestId: r.id, title: r.title, scope: r.scope, expiresAt: r.expires_at, scheduledFor: r.scheduled_for, seats: `1/${r.max_players}` };
      } catch (e) { return { posted: false, error: e.message }; }
    },
    async search_challenge_requests(input, ctx) { if (ctx.role === "instructor") return { error: "The agent network is for learners." }; return await searchChallengeRequests(ctx.studentId, input || {}); },
    async accept_challenge_request(input, ctx) { if (ctx.role === "instructor") return { error: "The agent network is for learners." }; if (!input?.requestId) return clarify("requestId", "Which request should I accept? I can search the open ones."); try { return { accepted: true, ...(await acceptChallengeRequest(ctx.studentId, input.requestId)) }; } catch (e) { return { accepted: false, error: e.message }; } },
    async cancel_challenge_request(input, ctx) { if (ctx.role === "instructor") return { error: "The agent network is for learners." }; if (!input?.requestId) return clarify("requestId", "Which of your requests should I cancel?"); try { return await cancelChallengeRequest(ctx.studentId, input.requestId); } catch (e) { return { cancelled: false, error: e.message }; } },
    async rematch_battle(input, ctx) { if (ctx.role === "instructor") return { error: "The agent network is for learners." }; if (!input?.battleId) return clarify("battleId", "Which battle should I rematch?"); try { const b = await rematch(ctx.studentId, input.battleId); return { rematch: true, battleId: b.battleId, invited: b.invited.length }; } catch (e) { return { rematch: false, error: e.message }; } },
    async request_guide_review(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (role === "instructor") return { error: "A guide review is for learners." };
      if (!input?.sessionId && !input?.topic) return clarify("topic", "Which topic should the guide review? Or pick one of your teaching sessions.");
      try {
        const r = await requestGuideReview({ learnerId: studentId, sessionId: input.sessionId || null, subject: input.subject || null, topic: input.topic || null });
        return { started: true, battleId: r.battleId, title: r.title, questions: r.questions, reviewsLeftToday: r.left, link: appLink(`tab=battles&battle=${r.battleId}`) };
      } catch (e) { return { started: false, error: e.message }; }
    },
    async set_agent_auto_reply(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (!["off", "study", "study_chat"].includes(input?.mode)) return clarify("mode", "Should I ask you every time, answer study questions on my own, or also reply to friendly chat?", { action: "set_agent_auto_reply" });
      try {
        const { saveSettings } = await import("../../agent-network/network.js");
        const saved = await saveSettings(studentId, { auto_reply: input.mode });
        return { saved: true, mode: saved.auto_reply, means: { off: "I'll ask you before answering any agent.", study: "I'll answer study questions on my own (from what you taught me) and ask you about everything else.", study_chat: "I'll answer study questions and reply to friendly chat on my own; friend requests and anything about you still come to you." }[saved.auto_reply] };
      } catch (error) { return { error: error.message || "Could not save that setting" }; }
    },
    async message_agent(input, ctx) { if (ctx.role === "instructor") return { error: "The agent network is for learners." }; if (!input?.to) return clarify("to", "Which agent should I message? I can find them first."); try { return { sent: true, ...(await messageAgent(ctx.studentId, input, { deps: protegeDeps })) }; } catch (e) { return { sent: false, error: e.message }; } },
    async check_agent_inbox(input, ctx) { if (ctx.role === "instructor") return { error: "The agent network is for learners." }; return await agentInbox(ctx.studentId); },
    async reply_to_agent(input, ctx) { if (ctx.role === "instructor") return { error: "The agent network is for learners." }; if (!input?.messageId) return clarify("messageId", "Which message should I answer? I'll open the inbox first."); try { return await replyToAgent(ctx.studentId, input.messageId, input.reply); } catch (e) { return { replied: false, error: e.message }; } },
    async study_buddy(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (role === "instructor") return { error: "The agent network is for learners." };
      const a = input?.action || "list";
      try {
        if (a === "list") return await listBuddies(studentId);
        if (a === "request") { if (!input?.to) return clarify("to", "Who should be the study buddy? I can find them first."); return await requestBuddy(studentId, input); }
        if (!input?.id) return clarify("id", "Which buddy? I'll list them first.");
        if (a === "respond") return await respondBuddy(studentId, input.id, input.accept !== false);
        if (a === "checkin") return await buddyCheckin(studentId, input.id, input.note || "");
        if (a === "end") return await endBuddy(studentId, input.id);
        return { error: "Unknown action." };
      } catch (e) { return { error: e.message }; }
    },
    async daily_challenge(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (role === "instructor") return { error: "The agent network is for learners." };
      const a = input?.action || "status";
      try {
        if (a === "status") return await dailyStatus(studentId);
        if (a === "join") return await joinDaily(studentId, { subject: input?.subject || null });
        if (a === "skip") return await skipDaily(studentId);
        if (a === "ranking") return await dailyRanking(studentId, input?.subject || "");
        return { error: "Unknown action." };
      } catch (e) { return { error: e.message }; }
    },
    async revision_circle(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (role === "instructor") return { error: "The agent network is for learners." };
      const a = input?.action || "search";
      try {
        if (a === "search") return await searchCircles(studentId, input || {});
        if (a === "create") { if (!input?.subject) return clarify("subject", "Which subject should the circle revise?"); return await createCircle(studentId, input); }
        if (!input?.id) return clarify("id", "Which circle? I'll search first.");
        if (a === "join") return await joinCircle(studentId, input.id);
        if (a === "leave") return await leaveCircle(studentId, input.id);
        return { error: "Unknown action." };
      } catch (e) { return { error: e.message }; }
    },
    async get_weekly_league(input, ctx) { if (ctx.role === "instructor") return { error: "The agent network is for learners." }; try { return await weeklyLeague(ctx.studentId, input || {}); } catch (e) { return { error: e.message }; } },
    async find_battles(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      // Every battle the learner could be in: ones they hold a seat in (incl.
      // network and daily battles), their courses' and classes' battles, and
      // the next daily battle. It used to look only at course battles, so a
      // learner with no course enrolment always heard "no battles".
      const OPEN = ["live", "scheduled", "lobby"];
      const COLS = "id, title, status, battle_type, subject, topic, scheduled_start, xp_prize, xp_pool, hp_per_miss, min_xp, recurring_key, course_id, classroom_id, courses(title)";
      const [{ data: enrolled }, { data: classes }, { data: seats }] = await Promise.all([
        db.from("enrollments").select("course_id").eq("user_id", studentId).eq("status", "active"),
        db.from("classroom_students").select("classroom_id").eq("user_id", studentId).eq("status", "active"),
        db.from("battle_participants").select("battle_id, joined_at, declined_at").eq("user_id", studentId).limit(200),
      ]);
      const courseIds = (enrolled ?? []).map((e) => e.course_id);
      const classIds = (classes ?? []).map((c) => c.classroom_id);
      const seatOf = new Map((seats ?? []).map((s) => [s.battle_id, s]));
      const { upcomingDay } = await import("../../agent-network/activities.js");
      const lists = await Promise.all([
        seatOf.size ? db.from("battles").select(COLS).in("id", [...seatOf.keys()].slice(0, 200)).in("status", OPEN) : { data: [] },
        courseIds.length ? db.from("battles").select(COLS).in("course_id", courseIds).in("status", OPEN).limit(10) : { data: [] },
        classIds.length ? db.from("battles").select(COLS).in("classroom_id", classIds).in("status", OPEN).limit(10) : { data: [] },
        db.from("battles").select(COLS).like("recurring_key", `daily:${upcomingDay()}:%`).in("status", OPEN).limit(5),
      ]);
      const byId = new Map();
      for (const l of lists) for (const b of (l.data ?? [])) byId.set(b.id, b);
      const battles = [...byId.values()]
        .sort((a, b) => (a.status === "live" ? -1 : 0) - (b.status === "live" ? -1 : 0) || String(a.scheduled_start || "").localeCompare(String(b.scheduled_start || "")))
        .slice(0, 10)
        .map((b) => {
          const seat = seatOf.get(b.id);
          return {
            id: b.id, title: b.title, status: b.status, subject: b.subject, topic: b.topic,
            kind: String(b.recurring_key || "").startsWith("daily:") ? "daily" : b.battle_type,
            startsAt: b.scheduled_start, course: b.courses?.title ?? null,
            xpPrize: b.xp_prize ?? b.xp_pool, hpPerMiss: b.hp_per_miss ?? 10, minXp: b.min_xp ?? 0,
            me: !seat ? "not invited" : seat.declined_at ? "declined" : seat.joined_at ? "in" : "invited — answer it in the Challenges tab",
          };
        });
      return battles.length ? { battles } : { battles: [], note: "No open battles right now. The daily battle is scheduled each evening — opening the Battles tab takes a seat." };
    },
    async get_ranking(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      const { data, error } = await db.from("xp_leaderboard")
        .select("total_xp, rank, scope, course_id, battles_won, win_rate")
        .eq("user_id", studentId).limit(20);
      if (error) return { error: "Couldn't load your ranking just now." };
      const rows = data ?? [];
      const overall = rows.find((r) => r.scope === "global") ?? null;
      if (!rows.length) return { totalXp: 0, rank: null, note: "No XP yet — finish a session or a battle to get on the leaderboard." };
      // Name each scoped ranking — without it the model wrote "Subject 1, Subject 2".
      const courseIds = [...new Set(rows.map((r) => r.course_id).filter(Boolean))];
      const { data: courses } = courseIds.length ? await db.from("courses").select("id, title, subject").in("id", courseIds) : { data: [] };
      const course = new Map((courses ?? []).map((c) => [c.id, c]));
      return {
        totalXp: overall?.total_xp ?? Math.max(...rows.map((r) => r.total_xp ?? 0)),
        rank: overall?.rank ?? null,
        battlesWon: overall?.battles_won ?? null,
        // All of these are the LEARNER's own positions — named so a model can't
        // read them as other players' scores (it did).
        yourRankElsewhere: rows.filter((r) => r.scope !== "global").map((r) => ({
          leaderboard: course.get(r.course_id)?.title ?? course.get(r.course_id)?.subject ?? `${r.scope} leaderboard`,
          yourRank: r.rank, yourXp: r.total_xp,
        })),
        note: "These are the learner's OWN leaderboard positions only — nothing here is about other players or particular battles.",
      };
    },
    async get_past_question_practice(input, ctx) { return getPastQuestionPracticeTool(ctx.studentId, input); },
    async get_weak_topics(input, ctx) { return getWeakTopicsTool(ctx.studentId, input); },
    async get_learning_overview(input, ctx) { return getLearningOverview(ctx.studentId).catch(asToolError("your learning overview")); },
    async get_knowledge_map(input, ctx) { return getKnowledgeMap(ctx.studentId, input).catch(asToolError("your knowledge map")); },
    async search_my_study_knowledge(input, ctx) { return searchMyStudyKnowledge(ctx.studentId, input).catch(asToolError("your saved study knowledge")); },
    async search_my_library(input, ctx) { return searchMyLibraryTool(ctx.studentId, input); },
    async make_study_material(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      // The learner's own records only; the result is a saved reader tab (edu.record_artifacts).
      const { makeStudyMaterial } = await import("../../records/studyMaterial.js");
      return makeStudyMaterial({ userId: studentId, tool: input?.tool, query: input?.query, folder: input?.folder,
        focus: input?.focus || "", count: input?.count || "", difficulty: input?.difficulty || "", length: input?.length || "",
        scope: input?.scope === "page" ? "page" : "document", pageNumber: input?.pageNumber ?? null,
        conversationId, fromChatFile: !!input?.from_chat_file, source: input?.source || null });
    },
    async read_upload(input, ctx) { const { readUploadTool } = await import("../../materials/uploadTools.js"); return readUploadTool({ userId: ctx.studentId, ingestId: String(input?.ingest_id || "") }); },
    async retry_extraction(input, ctx) { const { retryExtractionTool } = await import("../../materials/uploadTools.js"); return retryExtractionTool({ userId: ctx.studentId, ingestId: String(input?.ingest_id || "") }); },
    async list_folders(input, ctx) { const { listFoldersTool } = await import("../../materials/uploadTools.js"); return listFoldersTool({ userId: ctx.studentId }); },
    async file_upload(input, ctx) { const { fileUploadTool } = await import("../../materials/uploadTools.js"); return fileUploadTool({ userId: ctx.studentId, ingestId: String(input?.ingest_id || ""), title: input?.title || null, subject: input?.subject || null, kind: input?.kind || null, folderId: input?.folder_id || null, topics: input?.topics || [] }); },
    async analyse_past_papers(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      // The learner's own parsed past papers only (D53).
      try {
        let q = db.schema("edu").from("material_questions").select("ingest_id, record_id, exam, subject, year, number, marks, topic")
          .eq("user_id", studentId).limit(2000);
        const subject = String(input?.subject || "").trim().slice(0, 50);
        if (subject) q = q.ilike("subject", `%${subject.replace(/[%_]/g, "")}%`);
        const { data, error } = await q;
        if (error) throw error;
        // A paper the learner undid (Recently deleted) doesn't count.
        const { data: gone } = await db.schema("edu").from("material_ingests").select("id").eq("user_id", studentId).eq("state", "undone").limit(500);
        const goneIds = new Set((gone || []).map((g) => g.id));
        const rows = (data || []).filter((r) => !goneIds.has(r.ingest_id));
        if (!rows.length) return { papers: 0, topics: [], note: "No past papers read yet — ask them to upload one (a photo or PDF) in this chat." };
        const { papers, topics } = recurringTopics(rows);
        const recordIds = [...new Set(rows.map((r) => r.record_id).filter(Boolean))].slice(0, 6);
        const { data: recs } = await db.schema("edu").from("records").select("id, name").eq("user_id", studentId).is("deleted_at", null).in("id", recordIds);
        return { papers, topics, records: (recs || []).map((r) => ({ recordId: r.id, name: r.name })),
          ...(papers < 2 ? { note: "Only one paper so far — the pattern needs more years." } : {}) };
      } catch (error) { return { error: "Their past papers are unavailable right now" }; }
    },
    async get_concept_tracker_summary(input, ctx) { return getConceptTrackerSummary(ctx.studentId, input).catch(asToolError("the concept tracker")); },
    async get_learning_insights_summary(input, ctx) { return getLearningInsightsSummary(ctx.studentId).catch(asToolError("your learning insights")); },
    async get_exam_prep_status(input, ctx) { return getExamPrepStatus(ctx.studentId); },
    async get_chat_memory(input, ctx) { return getChatMemory(ctx.studentId, { conversationId: ctx.conversationId }); },
    async get_agent_preferences(input, ctx) { return getAgentPreferenceSummary(ctx.studentId); },
    async get_autonomy_status(input, ctx) { return getAutonomyStatus(ctx.studentId); },
    async start_study_prep_session(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      const { startStudyPrepSession } = await import("../study-prep/wiring.js");
      if (!studyPrepEnabled) return { enabled: false, message: "Study-prep sessions are not enabled for this learner." };
      // The iteration-0 force makes "let's plan for a test" deterministic, so
      // repeated asks must never stack sessions: an unconfirmed plan is
      // returned as-is and the plan card stays the single source of truth.
      const { getStudyPrepSessionSummary } = await import("../study-prep/chat-tool-handlers.js");
      const summary = await getStudyPrepSessionSummary(studentId);
      // A plan must actually exist for the "return as-is" rule to apply. A
      // "planning" session with no plan is a zombie from a failed planning
      // step (the row was created, then the LLM/syllabus step faulted):
      // echoing it mounts a plan-less card the learner can never confirm —
      // the 2026-10-03 "study session could not be loaded" dead end.
      const hasPlan = (session) => Array.isArray(session?.plan) && session.plan.length > 0;
      let unconfirmed = (summary.sessions || [])
        .find((session) => session.status === "awaiting_confirmation" || (session.status === "planning" && hasPlan(session)));
      // A plan for ANOTHER subject, never approved (nothing charged), is not what they asked for:
      // it is set aside and the new one starts (2026-10-19: a Biology request kept getting an old Maths card).
      const asked = String(input?.subject || "").trim().toLowerCase();
      let replaced = null;
      if (unconfirmed && asked && unconfirmed.subject && unconfirmed.subject.trim().toLowerCase() !== asked) {
        const { getHarness } = await import("../study-prep/wiring.js");
        const cancelled = await getHarness().cancelSession({ sessionId: unconfirmed.sessionId, learnerId: studentId }).catch(() => null);
        if (cancelled) { replaced = unconfirmed.subject; unconfirmed = null; summary.sessions = (summary.sessions || []).filter((s) => s.sessionId !== cancelled.session.id); }
      }
      if (unconfirmed) {
        return {
          enabled: true, sessionId: unconfirmed.sessionId, status: unconfirmed.status,
          plan: unconfirmed.plan, estimate: unconfirmed.estimate,
          subject: unconfirmed.subject || null,
          note: `An unconfirmed ${unconfirmed.subject || ""} study-prep plan already exists — present its plan card; nothing is charged until the learner approves it. If they want a different plan, they can cancel this one (cancel_study_prep_session).`,
        };
      }
      // Zombie self-heal: re-run the planning step for the stalled session
      // instead of creating a second one. If planning faults again the tool
      // call fails honestly and no dead session card is echoed to the chat.
      const stalled = (summary.sessions || [])
        .find((session) => session.status === "planning" && !hasPlan(session) && (!asked || !session.subject || session.subject.trim().toLowerCase() === asked));
      if (stalled) {
        // Re-run its planning in the background (or leave the run already going); the card streams it.
        const { planInBackground } = await import("../study-prep/wiring.js");
        planInBackground({ sessionId: stalled.sessionId, learnerId: studentId, conversationId });
        return {
          enabled: true, sessionId: stalled.sessionId, status: "planning", planning: true, subject: stalled.subject || null,
          note: "Planning is running now — the card shows each step live, and you'll post the plan in this chat when it's ready. Say so briefly; don't describe a plan (there isn't one yet).",
        };
      }
      // A session already under way (studying, replanning, paused): one at a
      // time. Starting another was refused deep in the harness and reached the
      // learner as a generic failure.
      const running = (summary.sessions || []).find((session) => ["topic_active", "replanning", "paused"].includes(session.status));
      if (running) {
        return {
          enabled: true, sessionId: running.sessionId, status: running.status, plan: running.plan, subject: running.subject || null,
          note: `A study-prep session is already ${running.status === "paused" ? "paused" : "under way"}${running.subject ? ` (${running.subject})` : ""} — offer to continue it, or to end it (cancel_study_prep_session, after they say yes) so a new one can start.`,
        };
      }
      // A planning leftover for another subject (no plan yet, nothing charged) is set aside too.
      const leftover = (summary.sessions || []).find((session) => session.status === "planning");
      if (leftover) {
        const { getHarness } = await import("../study-prep/wiring.js");
        if (await getHarness().cancelSession({ sessionId: leftover.sessionId, learnerId: studentId }).catch(() => null)) replaced ||= leftover.subject || "another subject";
      }
      const goal = String(input?.goal || "").trim();
      // From their own materials (§7.17.3): the folder of the paper they uploaded here, or one they named.
      const materials = input?.from_materials === true || input?.folder
        ? await resolveMaterialsFolder({ learnerId: studentId, folder: input?.folder, conversationId }).catch(() => null)
        : null;
      if ((input?.from_materials === true || input?.folder) && !materials) {
        return { enabled: true, started: false, note: "No read material to plan from yet — their upload may still be being read. Say so, or offer a plan from the syllabus." };
      }
      const subject = String(input?.subject || materials?.subject || "").trim();
      if (goal.length < 3) return clarify("goal", "What's the goal — which test or exam, and when?", { action: "start_study_prep_session" });
      if (!subject) return clarify("subject", "Which subject is the test in?", { action: "start_study_prep_session" });
      const view = await startStudyPrepSession({
        learnerId: studentId,
        goal: goal.slice(0, 300),
        subject: subject.slice(0, 180),
        // No class given: the exam says it (WAEC/NECO/JAMB are taken in SS3, BECE in JSS3).
        classLevel: String(input?.classLevel || classForExam(input?.examBoard) || "JSS1").slice(0, 40),
        examBoard: String(input?.examBoard || "WAEC").slice(0, 80),
        ...(materials ? { materials: { folderId: materials.folderId, name: materials.name } } : {}),
        // The planner researches for up to 10 decisions: it runs after this turn,
        // streamed on the card; the plan-ready message lands in this chat.
        background: true, conversationId,
      });
      return {
        enabled: true, sessionId: view.session.id, status: view.session.status, planning: true,
        ...(materials ? { from: materials.name } : {}),
        ...(replaced ? { replaced } : {}),
        note: `${replaced ? `Their earlier ${replaced} plan was never approved, so it was set aside (nothing was charged) — say so in one line. ` : ""}Study Prep has started${materials ? ` from their materials in "${materials.name}"` : ""} and is planning now — the card shows each step live, and the plan will be posted in this chat when it's ready. Say that briefly; don't describe or guess a plan (there isn't one yet). Nothing is charged until they approve it on the card.`,
      };
    },
    async get_study_prep_session(input, ctx) { const { getStudyPrepSessionSummary } = await import("../study-prep/chat-tool-handlers.js"); return getStudyPrepSessionSummary(ctx.studentId); },
    async get_running_work(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (!studyPrepEnabled) return { enabled: false, message: "Study-prep sessions are not enabled for this learner." };
      const { runningWork } = await import("../study-prep/wiring.js");
      const work = await runningWork(studentId);
      const nothing = !work.studyPlan && !work.agentChecks.length && !work.teachingSessions.length;
      return { ...work, ...(nothing ? { note: "Nothing is running for them right now — say so." } : {}) };
    },
    async stop_agent_check(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (!studyPrepEnabled) return { enabled: false, message: "Study-prep sessions are not enabled for this learner." };
      const { runningWork, stopAgentCheck } = await import("../study-prep/wiring.js");
      const restart = input?.restart === true;
      if (input?.confirm !== true) {
        const check = (await runningWork(studentId)).agentChecks[0] || null;
        if (!check) return { stopped: false, note: "No Agent Check is running for them — say so." };
        return {
          stopped: false, needsConfirmation: true, check,
          note: `Their Agent Check on ${check.topic} is running (${check.answered} of ${check.total ?? "?"} answered). Stopping cancels the battle, refunds its coins and doesn't count the try; it won't start again by itself.${restart ? " A new check would start right away — a new battle, 2 coins from the plan's approved coins." : ""} Ask, and call again with confirm: true only after they say yes.`,
        };
      }
      const done = await stopAgentCheck({ learnerId: studentId, restart });
      if (!done.stopped) return { ...done, note: done.reason === "already_finished" ? "That check had already finished — read the result instead." : "No Agent Check is running for them — say so." };
      return {
        ...done,
        note: `Stopped the Agent Check on ${done.topic}${done.refunded ? `; ${done.refunded} coins refunded` : ""}.${done.restarted?.battleId ? " A new check started — its card is in the chat, the battle is in Battles." : done.restarted ? ` A new check could not start: ${done.restarted.error || "it was skipped"}.` : " It won't start again by itself — they can start it from the card or ask you."}`,
      };
    },
    async cancel_teaching_session(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (!studyPrepEnabled) return { enabled: false, message: "Study-prep sessions are not enabled for this learner." };
      const { runningWork, teachingHandoff, teachingForTopic, getHarness } = await import("../study-prep/wiring.js");
      const work = await runningWork(studentId);
      if (!work.studyPlan) return { cancelled: false, note: "No teaching session is open for them — say so." };
      const view = await getHarness().getSessionView({ sessionId: work.studyPlan.sessionId, learnerId: studentId, eventLimit: 1 });
      const topic = view.topics.find((t) => t.status === "active");
      // Offered on the card, waiting on the dashboard, or under way.
      const session = topic ? await teachingForTopic(view.session.workflowId, topic.id) : null;
      if (!session) return { cancelled: false, note: "No teaching session is open for them — say so." };
      const where = session.state === "proposed" ? "offered on the card" : session.state === "scheduled" ? "waiting on their dashboard" : "under way";
      if (input?.confirm !== true) return { cancelled: false, needsConfirmation: true, session: { topic: session.topic, state: session.state, focus: session.focus }, note: `Their teaching session on ${session.topic} is ${where}. Ask whether to close it; call again with confirm: true after they say yes.` };
      const closed = await teachingHandoff().cancelFor({ parentId: view.session.workflowId, topicId: topic.id, reason: "cancelled_by_learner" });
      return closed
        ? { cancelled: true, topic: session.topic, note: `Closed the teaching session on ${session.topic}. The retest unlocks when they teach it (or tap "I taught it elsewhere" on the card).` }
        : { cancelled: false, note: "It was already closed." };
    },
    async cancel_study_prep_session(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (!studyPrepEnabled) return { enabled: false, message: "Study-prep sessions are not enabled for this learner." };
      const { getStudyPrepSessionSummary } = await import("../study-prep/chat-tool-handlers.js");
      const summary = await getStudyPrepSessionSummary(studentId);
      const session = (summary.sessions || [])[0];
      if (!session) return { cancelled: false, note: "They have no study-prep session to cancel — say so." };
      const underWay = ["topic_active", "replanning", "paused"].includes(session.status);
      const understood = (session.topics || []).filter((t) => t.status === "understood").length;
      if (underWay && input?.confirm !== true) {
        return {
          cancelled: false, needsConfirmation: true, sessionId: session.sessionId, subject: session.subject, status: session.status,
          understood, topics: (session.topics || []).length,
          note: `Their ${session.subject} plan is under way (${understood} of ${(session.topics || []).length} topics understood). Ask whether to end it: what they learnt stays recorded, but the plan stops and the coins already spent aren't returned. Call again with confirm: true only after they say yes.`,
        };
      }
      const { getHarness } = await import("../study-prep/wiring.js");
      const done = await getHarness().cancelSession({ sessionId: session.sessionId, learnerId: studentId });
      return {
        cancelled: true, sessionId: done.session.id, subject: session.subject, wasApproved: underWay,
        note: underWay
          ? `Their ${session.subject} plan is ended. What they learnt stays recorded. A new plan can start whenever they like.`
          : `Their ${session.subject} plan was never approved, so it is cancelled and nothing was charged. A new plan can start whenever they like.`,
      };
    },
    async submit_tool_request(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      let request;
      // Say WHY it was refused (too short, contact details…) so the agent can
      // fix it and retry, instead of the generic "could not be completed".
      try { request = await createLearnerToolRequest({ learnerId: studentId, body: input }); }
      catch (e) { return { submitted: false, error: e?.message || "Could not send the request." }; }
      const when = request.created ? new Date(request.created).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;
      return {
        submitted: request.createdNew || !!request.reopened,
        duplicate: !request.createdNew,
        reopened: !!request.reopened,
        // No id: it means nothing to the learner (the reply scrub removed it, leaving "Reference:").
        status: request.status,
        title: request.title,
        category: request.category,
        // Say exactly this much — never more (a duplicate is NOT a new request).
        tell: request.createdNew ? "Sent: it is on the admins' Agent requests page now, waiting for a decision."
          : request.reopened ? `You had asked for this before (${request.previousStatus}); it is re-opened and back on the admins' Agent requests page.`
          : `You already asked for this${when ? ` on ${when}` : ""}; that request is still ${String(request.status).replace(/_/g, " ")}. Say it is the same request, still waiting — not a new one.`,
      };
    },
    async check_my_requests(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      const { data } = await db.schema("edu").from("agent_tool_requests")
        .select("title, kind, status, admin_note, updated_at")
        .eq("requester_id", studentId)
        .order("updated_at", { ascending: false })
        .limit(10);
      const requests = (data || []).map((r) => ({
        title: r.title,
        kind: r.kind,
        status: r.status,
        ready: r.status === "implemented",
        note: r.admin_note || null,
      }));
      return { requests, count: requests.length };
    },
    async submit_bug_report(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      let request;
      try {
        request = await createLearnerToolRequest({
          learnerId: studentId,
          body: { title: input?.title, description: input?.description, category: input?.category || "other", kind: "bug" },
        });
      } catch (e) { return { submitted: false, error: e?.message || "Could not send the bug report." }; }
      const when = request.created ? new Date(request.created).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;
      return {
        submitted: request.createdNew || !!request.reopened,
        duplicate: !request.createdNew,
        status: request.status,
        title: request.title,
        tell: request.createdNew ? "Sent: your bug report is on the Akoro team's list now."
          : request.reopened ? "You had reported this before; it is re-opened and back with the Akoro team."
          : `You already reported this${when ? ` on ${when}` : ""}; it is still ${String(request.status).replace(/_/g, " ")}.`,
      };
    },
  };
}
