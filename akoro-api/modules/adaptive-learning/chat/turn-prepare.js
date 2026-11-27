// The first half of a live Agent Chat turn: the SSE shell, request validation,
// durable context, grounding, prompt assembly and the forced tool. It returns
// a turn context object; turn-answer.js runs the tool loop and writes a reply.
//
// The seam is immediately after forcedTool is computed: the tool list, the
// loop and the answer all depend on it, and nothing before it executes a tool.

import { chatEnvelope } from "../../workflows/index.js";
import { openai } from "../../../lib/aiModel.js";
import { MAX_FILES, processAttachments, safeHistory, runningWorkBrief, loadDoctrine } from "./turn-store.js";
import { resolveChatChoice, pickerEnabled } from "../../../lib/modelCatalogue.js";
import { modelRegistry } from "../../../lib/modelRegistry.js";
import { allowedModelsFor } from "../../../lib/modelTiers.js";
import { modelPicks, supabaseThreads } from "../../workflows/index.js";
import db from "../../../db.js";
import { renderRelevantMemory } from "./chat-memory.js";
import {
  durableAgentChatContextEnabled, CHAT_SESSION_ID, CHAT_TURN_ID, agentSessionId,
  activeTurnStops, turnStopKey, activeSessionTurns, studyPrepEnabled,
} from "./runtime-state.js";
import { protegeDeps } from "./handlers-social.js";
import { loadTaughtKnowledge, renderTaughtContext } from "../social/protege.js";
import { getSyllabusGrounding } from "../teaching/syllabus.js";
import { getPastQuestionGrounding } from "../../past-questions/index.js";
import { getCurriculumGrounding } from "../../curriculum/index.js";
import {
  completedLearnerAgentConversationTurn,
  loadLearnerAgentConversationContext,
  persistLearnerAgentConversationTurn,
  persistLearnerAgentUserTurnMessage,
  retrieveLearnerAgentMemory,
  savedTurnReplyId,
} from "../../../lib/conversationContextStore.js";
import { fitDialogue, summariseEarlier } from "../grounding/contextBudget.js";
import { runIntentStep } from "../intent/intentStep.js";
import { renderLedger, summaryMarkOf } from "../../../lib/taskLedger.js";
import { requiresAgentCapabilitiesTool, requiresActivityPreparation, isDraftFollowUp, isToolDraftFollowUp, requiredLearnerDataTool, requiredStudyPrepTool } from "../intent/agent-chat-intent.js";
import { createChatTrace } from "./chat-trace.js";
import { inboxBrief, buddyBrief } from "./handlers-network-study.js";
import { tutorSystemPrompt, assembleChatDoctrine } from "../../agent-context/index.js";
import {
  openAiInstructorTools, openAiChatTools, PARALLEL_READS_NOTE, STEP_NARRATION_NOTE,
  learnerToolDefs, learnerToolDefsWithAreas, forcedSelfTool,
  MERGED_DOMAINS, selfToolingAllowedFor, listActivityDrafts, agentNetworkEnabled,
} from "./tool-runtime.js";

export { tutorSystemPrompt, assembleChatDoctrine };
// Re-exported for turn-answer.js, so this file stays the ONE importer of these
// targets and the split does not add a cross-module import edge.
export { savedTurnReplyId, persistLearnerAgentConversationTurn };
export { modelPicks, supabaseThreads };

// The SSE shell: headers are written once, the heartbeat keeps Cloudflare's
// idle proxy from dropping a long tool loop, and `send` is a no-op once the
// response is gone. It owns the per-turn envelope id and the timings marks.
export function createSse(res, wantsStream, t0) {
  let headersSent = false;
  // Heartbeat: a long tool loop (blog research, multi-turn tool calls) can run
  // silent for minutes. Cloudflare's proxy drops connections idle ~100s, the
  // client then falls back to a NON-STREAMING retry — and the whole agent
  // loop, every prompt and tool call, is billed to the outbound budget a
  // second time. A 20s comment frame costs nothing and keeps the pipe open.
  // SSE comments (": ping") are ignored by every EventSource parser — and by
  // this API's own client, which skips blocks without a data line.
  let heartbeat = null;
  let streamedAnswer = "";     // deltas of the final answer, for a partial save
  const stopHeartbeat = () => { if (heartbeat) { clearInterval(heartbeat); heartbeat = null; } };
  res.on("close", stopHeartbeat);
  const beginStream = () => {
    if (headersSent) return;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    headersSent = true;
    heartbeat = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n");
    }, 20_000);
    heartbeat.unref?.();
  };
  // Every live event also carries the v3 envelope (§7.9.7) under `envelope`;
  // the event names and fields stay exactly as they were.
  const turnId = `turn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let liveSequence = 0;
  // Timings (realtime work, 2026-11-07): each preparation step and the first thing the
  // learner sees, returned in metadata.timings and logged once per turn.
  const timings = {};
  let lastMark = t0;
  const mark = (name) => { const now = Date.now(); timings[name] = (timings[name] || 0) + (now - lastMark); lastMark = now; };
  // One lookup's own time (they overlap; the slowest is what the turn waits for).
  const timed = (name, promise) => { const s0 = Date.now(); return Promise.resolve(promise).finally(() => { (timings.parts ||= {})[name] = Date.now() - s0; }); };
  const send = (event, data) => {
    if (event === "delta" && data?.text) streamedAnswer += data.text;
    if (timings.firstVisibleMs == null && event !== "status") timings.firstVisibleMs = Date.now() - t0;
    if (res.destroyed || res.writableEnded) return;
    const envelope = data && typeof data === "object" ? chatEnvelope(event, data, { turnId, sequence: liveSequence++ }) : null;
    res.write(`event: ${event}\ndata: ${JSON.stringify(envelope ? { ...data, envelope } : data)}\n\n`);
  };
  const status = (step, label) => send("status", { step, label });
  return {
    beginStream, stopHeartbeat, send, status, mark, timed, timings, turnId,
    get headersSent() { return headersSent; },
    get streamedAnswer() { return streamedAnswer; },
  };
}

export async function prepareTurn(req, res) {
  const t0 = Date.now();
  const wantsStream = req.query.stream === "1" || req.query.stream === "true"
    || (req.headers.accept || "").includes("text/event-stream");
  const sse = createSse(res, wantsStream, t0);
  const { beginStream, send, status, mark, timed, timings } = sse;
  // Stop (■): set by POST /agent/stop for this learner's turn; checked
  // between tool-loop steps and while the answer streams.
  let stopEntry = null;
  const isAborted = () => Boolean(stopEntry?.stop);
  // Developer view (opt-in from the app): raw tool I/O on the live stream only.
  const trace = createChatTrace({ send: wantsStream ? send : null, developer: req.body?.developer === true });
  // A tap continuation resumes the SAME flow (scheduleDecisionContinuation):
  // its body text is an internal event cue for the model only — no user
  // message is saved for it, so the chat gains only the agent's outcome
  // narration under the card (Matt, 2026-11-17).
  const isContinuation = req.internalContinuation === true;
  // The context the answer half reads. The catch path in turn-answer.js owns
  // the partial save, so the mutable bits (turn, session, streamed text) stay
  // on this object and on the SSE shell.
  const ctx = {
    req, res, t0, wantsStream, sse, isAborted, trace, isContinuation,
    turnCtx: null, sessionTrackId: null, early: false, error: null,
  };
  // A response has already gone out (validation or a replay): skip the answer
  // half, but still run its finally (turn counting + continuation).
  const halt = (statusCode, body) => { res.status(statusCode).json(body); ctx.early = true; return ctx; };

  try {
    const {
      message, history = [], agentName, mode: rawMode, attachments: rawAttachments,
      conversationId: rawConversationId, turnId: rawTurnId,
    } = req.body || {};
    const userMessage = typeof message === "string" ? message.trim() : "";
    if (!userMessage) return halt(400, { error: "message is required" });
    if (userMessage.length > 12_000) return halt(400, { error: "message is too long" });
    if (Array.isArray(rawAttachments) && rawAttachments.length > MAX_FILES) {
      return halt(400, { error: `Too many attachments (max ${MAX_FILES}).` });
    }
    const conversationId = rawConversationId == null ? null : String(rawConversationId);
    ctx.turnCtx = { conversationId, turnId: rawTurnId == null ? null : String(rawTurnId), userMessage };
    if (conversationId && !CHAT_SESSION_ID.test(conversationId)) {
      return halt(422, { error: "conversationId is invalid" });
    }
    const turnId = rawTurnId == null ? null : String(rawTurnId);
    if (conversationId && durableAgentChatContextEnabled && !CHAT_TURN_ID.test(turnId || "")) {
      return halt(422, { error: "turnId is required for durable Agent Chat" });
    }
    if (turnId && !CHAT_TURN_ID.test(turnId)) return halt(422, { error: "turnId is invalid" });
    if (turnId) {
      const key = turnStopKey(req.user.id, turnId);
      stopEntry = { stop: false };
      activeTurnStops.set(key, stopEntry);
      res.on("close", () => { if (activeTurnStops.get(key) === stopEntry) activeTurnStops.delete(key); });
    }

    let mode = ["think", "research"].includes(rawMode) ? rawMode : "default";
    const isResearch = mode === "research";
    // The learner's model pick applies to EVERY mode now. An unknown or
    // unavailable pick is ignored — the default answers. With the §7.11.5
    // picker on, the pick must also be in the payer's tier list.
    const picked = typeof req.body?.model === "string" && req.body.model ? req.body.model : null;
    const tierModels = picked && pickerEnabled() ? await allowedModelsFor(req.user.id).catch(() => null) : null;
    const { apiModel: chatModel, notice: pickedNotice } = picked
      ? resolveChatChoice(picked, process.env, { allowedModels: tierModels?.allowedModels ?? null })
      : { apiModel: null, notice: null };
    const pickedEntry = (picked && modelRegistry.get(picked))
      || (chatModel && modelRegistry.catalogue.find((e) => e.apiModel === chatModel))
      || null;
    const selectedEntry = pickedEntry || modelRegistry.get(modelRegistry.defaultId) || null;
    const canThinkResponses = !!selectedEntry?.caps?.responses;
    const canThinkChat = !!selectedEntry?.caps?.reasoning;
    const canResearch = !!selectedEntry?.caps?.tools;
    // The browser disables unavailable modes; the server enforces it anyway.
    let modeNotice = pickedNotice;
    if (mode === "think" && !canThinkResponses && !canThinkChat) {
      mode = "default";
      modeNotice = `Thinking isn't available for ${selectedEntry?.label || "this model"} — answering normally.`;
    }
    if (mode === "research" && !canResearch) {
      mode = "default";
      modeNotice = `Research isn't available for ${selectedEntry?.label || "this model"} — answering normally.`;
    }
    const isThink = mode === "think";
    const role = ["instructor", "teacher", "school", "school_admin", "admin"].includes(req.user?.role)
      ? "instructor" : "student";
    if (role === "student" && conversationId) {
      ctx.sessionTrackId = conversationId;
      activeSessionTurns.set(conversationId, (activeSessionTurns.get(conversationId) || 0) + 1);
    }
    // The instructor app asked, but the session is a learner's: a request that
    // reached the server without the instructor portal header reads the
    // learner cookie. Refuse it loudly rather than run learner tools for a
    // teacher (it drafted a study plan for "prepare an assignment").
    if (req.body?.role === "instructor" && role !== "instructor") {
      return halt(409, { code: "portal_mismatch",
        error: "You're signed in as a learner here. Sign in to the instructor app again to use your teaching tools." });
    }
    const safeAgentName = typeof agentName === "string" ? agentName.replace(/[\r\n]+/g, " ").trim().slice(0, 80) : "Akoro";
    const durableRequested = Boolean(conversationId && durableAgentChatContextEnabled);
    let durable = durableRequested;
    let conversation = null;
    let relevantMemories = [];
    let retrieval = "skipped";
    let dialogue = safeHistory(history);

    if (wantsStream) beginStream();
    if (modeNotice && wantsStream) status("model", modeNotice);
    // The pick is remembered on the chat (Scenario K): a send that names its
    // model — a catalogue id, or null for the default — saves it on the thread
    // and the learner's open workflows; a change is a model_changed event.
    if (conversationId && mode === "default" && Object.prototype.hasOwnProperty.call(req.body || {}, "model") && pickerEnabled()) {
      const remembered = await (await modelPicks()).saveThreadPick({ learnerId: req.user.id, conversationId, modelId: typeof req.body.model === "string" && req.body.model ? req.body.model : null })
        .catch((e) => { if (!/not found|isn't a model/i.test(String(e?.message))) console.warn("[/chat/agent] model pick not saved:", e?.message || e); return null; });
      if (remembered?.changed && wantsStream) send("model_changed", { modelId: remembered.selection.modelId, label: remembered.selection.label, previous: remembered.previous, workflows: remembered.workflows.length });
    }
    if (durable) {
      // A durable-context failure (pending migration, transient DB error)
      // must never take the chat down: degrade to the plain-transcript path,
      // which still saves every turn to the session.
      try {
        if (wantsStream) status("memory", "Loading your saved study context…");
        // The transcript, the memories and the retry check are independent: one wait, not three
        // (realtime, 2026-11-07). A completed retry must return the original durable answer
        // without re-running an action tool — the session-bound turn key covers the visible
        // response as well as transcript persistence.
        const [loaded, retrieved, completedReply] = await Promise.all([
          timed("transcript", loadLearnerAgentConversationContext({ conversationId, userId: req.user.id })),
          timed("memories", retrieveLearnerAgentMemory({ query: userMessage, userId: req.user.id })),
          timed("retryCheck", completedLearnerAgentConversationTurn({ conversationId, userId: req.user.id, sessionId: agentSessionId(conversationId), turnId })),
        ]);
        conversation = loaded;
        // The server-owned exact transcript is authoritative for durable Agent
        // Chat. Browser history is only a compatibility fallback for callers
        // without a session (for example, the instructor assistant).
        dialogue = conversation.messages;
        retrieval = retrieved.mode;
        relevantMemories = retrieved.memories;
        if (completedReply) {
          const metadata = { responseTimeMs: Date.now() - t0, retrieval, durableContext: true, replayed: true, toolExecutions: [] };
          if (!wantsStream) return halt(200, { success: true, reply: completedReply, response: completedReply, thinking: "", syllabus: [], pastQuestions: [], curriculum: [], mode, metadata, toolExecutions: [] });
          send("done", { reply: completedReply, thinking: "", syllabus: [], pastQuestions: [], curriculum: [], mode, metadata, toolExecutions: [] });
          res.end();
          ctx.early = true;
          return ctx;
        }
        // Phase 22: keep the learner's message even if the turn crashes below.
        // Idempotent per turnId — the end-of-turn persist reuses this row.
        // A tap continuation has no learner message to keep (its cue is an
        // internal event) — saving it would write a prompt the learner
        // never sent into their chat (Matt, 2026-11-17).
        if (!isContinuation) await persistLearnerAgentUserTurnMessage({ conversationId, userId: req.user.id, sessionId: agentSessionId(conversationId), turnId, userMessage }).catch(() => {});
      } catch (durableError) {
        console.error("[/chat/agent] durable context unavailable — continuing with basic transcript:", durableError.message);
        durable = false;
        conversation = null;
        relevantMemories = [];
        retrieval = "skipped";
        dialogue = safeHistory(history);
      }
    }

    const wantsCurriculum = role === "instructor";
    const sylLimit = isResearch ? 8 : 5;
    const pastLimit = isResearch ? 5 : 3;
    mark("contextAndMemory");
    if (isResearch && wantsStream) status("grounding", "Searching the syllabus and practice sources…");

    // The learner's active goals steer everything the agent says and (once
    // Full Autonomy ships) everything it proposes. Cheap indexed read, best
    // effort — a goals hiccup must never dim the chat.
    // Realtime (2026-11-07): every lookup below is independent — they all start now and the
    // turn waits once, for the slowest, instead of one after another (3–5 s on the sandbox).
    const goalsP = role === "student" ? (async () => {
      try {
        const { data: goalRows } = await db.schema("edu").from("learner_goals")
          .select("title, category, exam, target_date, metric")
          .eq("user_id", req.user.id).eq("status", "active")
          .order("updated_at", { ascending: false }).limit(5);
        if (!goalRows?.length) return "";
        return "\n\n## The learner's active goals (align advice and suggestions with these)\n" +
          goalRows.map((g) => {
            const bits = [g.category, g.exam, g.target_date ? `by ${g.target_date}` : g.metric].filter(Boolean).join(" · ");
            return `- ${g.title}${bits ? ` (${bits})` : ""}`;
          }).join("\n");
      } catch { return ""; /* table not migrated yet — the chat works without goals */ }
    })() : Promise.resolve("");
    const groundingP = Promise.all([
      timed("syllabus", getSyllabusGrounding(userMessage, { limit: sylLimit }).catch(() => ({ context: "", refs: [] }))),
      timed("pastQuestions", getPastQuestionGrounding(userMessage, { limit: pastLimit }).catch(() => ({ context: "", refs: [] }))),
      wantsCurriculum
        ? getCurriculumGrounding(userMessage, { limit: 3 }).catch(() => ({ context: "", refs: [] }))
        : Promise.resolve({ context: "", refs: [] }),
      // The learner's agent is their protégé: what they taught it is all it
      // knows of the subject (protege.js). A lookup failure must not dim the
      // chat — it reads as "nothing taught on this".
      role === "student"
        ? timed("taught", loadTaughtKnowledge({ studentId: req.user.id, query: userMessage, deps: protegeDeps })
          .catch((e) => { console.warn("[/chat/agent] taught knowledge unavailable:", e.message); return { chunks: [], topics: [], taughtAnything: false }; }))
        : Promise.resolve(null),
    ]);
    // Messages from other learners' agents waiting for this one.
    // Files this turn is saving to the Library (§7.17, D51): the reply says so, in one clause — never where (Stage 4: the read decides that later).
    // (A query builder is a thenable, not a promise: no .catch on it — await it inside try.)
    // One message's files can be sorted into several uploads (one per folder): ingestIds, or the older ingestId.
    const ingestIds = [...new Set([...(Array.isArray(req.body?.ingestIds) ? req.body.ingestIds : []), req.body?.ingestId].map(String))]
      .filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 5);
    const ingestsP = role === "student" && ingestIds.length ? (async () => {
      try {
        const { data } = await db.schema("edu").from("material_ingests").select("id, state")
          .eq("user_id", req.user.id).in("id", ingestIds);
        return ingestIds.map((id) => (data || []).find((r) => r.id === id)).filter(Boolean);
      } catch { return []; }
    })() : Promise.resolve([]);
    // Uploads waiting on the agent (Matt, 2026-11-16): this turn's payload
    // ingests plus the session's unfiled ones — the agent reads and files
    // them with its upload tools; the server posts nothing.
    const pendingUploadsP = role === "student" ? (async () => {
      try {
        const byId = new Map();
        if (conversationId) {
          const { data } = await db.schema("edu").from("material_ingests")
            .select("id, names, state, folder_id, structure")
            .eq("user_id", req.user.id).eq("chat_session_id", conversationId)
            .neq("state", "undone").order("created_at", { ascending: true }).limit(10);
          for (const r of data || []) byId.set(r.id, r);
        }
        if (ingestIds.length) {
          const { data } = await db.schema("edu").from("material_ingests")
            .select("id, names, state, folder_id, structure")
            .eq("user_id", req.user.id).in("id", ingestIds);
          for (const r of data || []) byId.set(r.id, r);
        }
        return [...byId.values()].filter((r) => !(r.structure && r.folder_id)).slice(0, 5);
      } catch { return []; }
    })() : Promise.resolve([]);
    // Card decisions the learner made after an earlier turn ended: approved
    // but not yet applied. This turn finishes them — the model calls
    // await_decision itself (nothing is applied or posted by the server).
    const decisionsP = role === "student" && conversationId ? (async () => {
      try {
        const { listConfirmedDecisions } = await import("./handlers-merged.js");
        return await listConfirmedDecisions(req.user.id, conversationId);
      } catch { return []; }
    })() : Promise.resolve([]);
    const chatFilesP = role === "student" && conversationId ? (async () => {
      try {
        const { data } = await db.schema("edu").from("material_ingests").select("names, state, structure")
          .eq("user_id", req.user.id).eq("chat_session_id", conversationId).neq("state", "undone").order("created_at", { ascending: true }).limit(10);
        const { chatFilesBrief } = await import("../../materials/index.js");
        return chatFilesBrief(data || []);
      } catch { return ""; }
    })() : Promise.resolve("");
    const inboxP = role === "student" && agentNetworkEnabled
      ? Promise.all([inboxBrief(req.user.id).catch(() => ""), buddyBrief(req.user.id).catch(() => "")]).then(([a, b]) => a + b)
      : Promise.resolve("");
    // Something is running outside the chat (an Agent Check battle, a teaching session): the
    // rules for talking about it and changing it (akoro-agent/reasoning/RUNNING_WORK.md), and what it is.
    const runningP = role === "student" && studyPrepEnabled ? runningWorkBrief(req.user.id).catch(() => "") : Promise.resolve("");
    const hasAttachments = Array.isArray(rawAttachments) && rawAttachments.length > 0;
    if ((hasAttachments || ingestIds.length) && wantsStream) status("attachments", "Reading your files…");
    const attP = (async () => {
      // Uploads sent as ingest references no longer inject their text here:
      // the agent reads them itself with read_upload (Matt, 2026-11-16).
      return hasAttachments ? await processAttachments(rawAttachments) : { visionParts: [], docContext: "", notes: [] };
    })();
    // Self-tooling: without this the model tours unrelated tools and says
    // "I don't have that data" instead of building the tool (verify run
    // 1a8cb552, 2 of 3 repeats).
    const selfToolP = (async () => {
      const on = (role === "student" || role === "instructor") && await selfToolingAllowedFor(req.user.id);
      const forced = on && role === "student" ? await forcedSelfTool(req.user.id, userMessage).catch(() => null) : null;
      return { on, forced };
    })();
    // Who this learner's agent is (their protégé): its name, level and
    // sessions from edu.student_agents, and the learner's first name.
    const protegeP = role === "student" ? (async () => {
      const [{ data: a }, { data: u }] = await Promise.all([
        db.schema("edu").from("student_agents").select("name, level, total_sessions").eq("student_id", req.user.id).limit(1).maybeSingle(),
        db.from("users").select("full_name, username").eq("id", req.user.id).maybeSingle(),
      ]);
      return {
        agentName: (a?.name || safeAgentName || "Akoro").replace(/[\r\n]+/g, " ").slice(0, 80),
        learnerName: String(u?.full_name || u?.username || "your learner").split(" ")[0].slice(0, 40),
        level: Number(a?.level) || 1, sessions: Number(a?.total_sessions) || 0,
      };
    })().catch(() => null) : Promise.resolve(null);
    // The instructor's pending drafts: follow-ups ("add a part", "make Q2
    // harder", "go back to version 1") revise the newest one — without its id
    // here the model could only start another draft.
    const draftsP = role === "instructor" && openAiInstructorTools().length
      ? listActivityDrafts({ id: req.user.id, role }).then((d) => d.slice(0, 3)).catch(() => []) : Promise.resolve([]);
    const [
      goalsCtx,
      [{ context: syllabusCtx, refs: syllabusRefs }, { context: pastCtx, refs: pastRefs }, { context: curriculumCtx, refs: curriculumRefs }, taught],
      ingests, pendingUploads, chatFilesCtx, inboxCtx, runningCtx, att, { on: selfToolOn, forced: forceSelfTool }, protege, pendingDrafts, approvedDecisions,
    ] = await Promise.all([goalsP, groundingP, ingestsP, pendingUploadsP, chatFilesP, inboxP, runningP, attP, selfToolP, protegeP, draftsP, decisionsP]
      .map((pr, i) => timed(["goals", "grounding", "ingests", "pendingUploads", "chatFiles", "inbox", "running", "attachments", "selfTool", "protege", "drafts", "decisions"][i], pr)));
    // The learner's own tool defs (turnTools assembly, far below) depend on
    // nothing between here and there — launch now, await there, so their
    // database time overlaps the prompt assembly and the intent step
    // (turn-prep overlap, 2026-11-17).
    const learnerDefsP = role === "student" && selfToolOn
      ? learnerToolDefsWithAreas(req.user.id).catch(() => ({ defs: [], areas: new Map(), labels: new Map(), modes: new Set() }))
      : null;
    const protegeCtx = taught ? `\n\n${await loadDoctrine("policies/PROTEGE.md")}${renderTaughtContext(taught)}` : "";
    // Agent-driven uploads (Matt, 2026-11-16; supersedes the Stage 4 server
    // post): the agent reads and files waiting uploads with its own tools
    // and narrates the filing itself — the server posts nothing.
    const decisionsCtx = approvedDecisions.length
      ? `\n\n## A decision is waiting for you to finish\nBefore this turn, the learner tapped a card in this chat and approved it. Their tap only recorded the decision — nothing has been applied yet, and they have not been told the outcome. FIRST, before answering anything else, call await_decision for each of these and report its outcome in your own words:\n` +
        approvedDecisions.map((c) => `- confirmationId ${c.confirmationId} · ${c.kind} · "${c.title || "Your tool"}"${(c.items || []).length ? ` · would change: ${c.items.slice(0, 5).join("; ")}` : ""}`).join("\n")
      : "";
    const ingestCtx = pendingUploads.length
      ? `\n\n## Uploads waiting on you\nThe learner sent file(s) that are saved in their Library but not read or filed yet. YOU drive that in this turn, with your upload tools — no one else files them:\n` +
        pendingUploads.map((r) => `- upload id ${r.id} · ${(Array.isArray(r.names) ? r.names : []).join(", ") || "a file"} · state: ${r.state}`).join("\n") +
        `\nFor each one: call read_upload (your first call is forced to it). If it says extracting, tell them briefly it's still being read and don't guess at its content. If it says failed, call retry_extraction, then read_upload again. When you have the content, decide a short title, the subject, the kind and up to 6 topics from the content and this conversation, then call file_upload with your decision. Say briefly what each file is and where you filed it — never name a folder before file_upload returns it, and don't repeat the card's details or any ids. If they asked to make something from the file (a quiz, flashcards, a summary), file it first, then make it with make_study_material (source 'upload').`
      : "";
    // The files already in this chat and what their reads found: chatFilesCtx (above).

    // The model cannot resolve "due tomorrow at 8pm" without knowing today.
    // Compute at request time; Africa/Lagos is the platform timezone.
    const nowLagos = new Date().toLocaleString("en-NG", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos",
    });
    const CURRENT_TIME_CONTEXT =
      `\n\nCurrent date and time: ${nowLagos} (Africa/Lagos). ` +
      `Use it to resolve relative dates — "tomorrow at 8pm" becomes an exact due_at ISO instant in +01:00. Never state a due date you could not compute from this.` +
      `\n\nReminders / scheduled messages — verify from the tool result, never assume. When you schedule, cancel or list one, call the tool and report exactly what its RESULT says: where it will send (deliversTo — "this chat", "the chosen chat" or "a new chat") and when (localScheduledAt). A reminder with no stated destination belongs in THIS chat (where='here', the default); use where='new' only if the learner explicitly asks for a separate chat. Never say a reminder is set unless the tool returned success this turn; if it returned an error, say the actual error. When asked whether a reminder sent, read it back with list_scheduled_chat_follow_ups (status / deliveredAt / missed) and answer from that, not from memory.`;
    const selfToolCtx = selfToolOn && role === "instructor"
      ? "\n\n## Building tools (preview)\nWhen the instructor asks for something none of your tools gives directly — a total, average, count, ranking or breakdown over THEIR OWN classes and activities (average grade per activity, who hasn't started, completion by class, students below a mark) — call create_tool (schema_lookup first if unsure what it can use) and answer from its result; don't say you don't have the data. check_activity_outcomes is for ONE activity's summary — a question across several activities (each activity's average, who hasn't started anything) is a create_tool question. Tools only ever see this instructor's own classes and the work set in them — students by name only, never another teacher's class or a learner's private chats or notes. Only say it can't be done after create_tool is rejected, and say why."
      : selfToolOn
      ? "\n\n## Building tools (preview)\nWhen the learner asks for something none of your tools gives directly — a total, average, count or breakdown over their own data (hours of sessions per month, tasks finished per week, accuracy by year) — don't say you don't have the data and don't piece it together from unrelated tools. Call create_tool (schema_lookup first if unsure what it can use), then answer from its result. The same goes for comparisons with other learners (how others scored in battles they played together): create_tool either builds it or, if it needs a permission, asks an admin and the answer comes back in this chat — tell the learner that plainly. Only say it can't be done after create_tool is rejected, and say why.\nWhen the learner asks you to CHANGE their own things and no tool does it (delete or complete their tasks, end a study buddy) — don't just say you can't. Call schema_lookup: if it lists that change as needs_your_ok, call create_tool with it in hint.capabilities in this same turn — don't ask 'shall I build it?' first. The tool is drafted (off) and they get a card showing what it would change; Allow on the card is their yes. Say briefly that you've drafted it and they can tap Allow on the card. Never file submit_tool_request for these.\nWhen their message says they approved a tool, or asks you to run one of your tools by name (after the Akoro team approved it), run that tool now — a read: explain what it found in plain words; a change: it finds what to change and shows the Allow card — say what it would change (the app tells you when they confirm; don't ask them to tell you). When their message says they confirmed a change, look again (run the same tool, or list the items) to check it went through: say what changed and whether anything is still left. Nothing is done until you've checked.\nSession tools: when the learner asks for an interactive session or protocol \u2014 they teach you a topic as their prot\u00e9g\u00e9 while progress is tracked and questions are asked; you teach them a topic, then close the book and have them recall it from memory; any phased partner with progress to keep \u2014 build it as a session tool: create_tool with hint.mode \"mode\" (akoro_inspect with provider \"ui\" first if you want the screen components). It is drafted OFF and the Keep card previews it; when they keep it, the session appears in their sessions list on the dashboard with its OWN UI, and the learning happens there \u2014 never in this chat. Your role in chat is only to build it and, once kept, to say it's ready and where to open it. Never run a session in chat: don't teach its material here, don't take its answers or recall here, don't score anything here. If the learner pastes session work into the chat (an answer, a block of recall, an explanation), tell them it belongs in the session \u2014 open it from their sessions list and it picks up where they left off. To answer questions about a session tool (how far has it got?), call it by name \u2014 it returns its phase and progress; report that, and never invent progress. A session tool is NOT the built-in teach-me feature: its progress lives only in the tool's state, so never check your prot\u00e9g\u00e9 notes for it or tell the learner nothing was recorded. The reverse also holds: when the learner asks YOU to teach THEM a topic and then test their recall (close the book, hide the material, answer from memory), that is a session-tool request, not the teach-me feature \u2014 even for a topic they never taught you. A session tool's material is authored into the tool when it is built, so 'you haven't taught me this yet' is never a reason to refuse it, deflect to the Teach me button, or ask them to teach it first. If the topic is unstated, ask which topic \u2014 then build the session for the topic they name, in that same conversation, without switching to teach-me."
      : "";
    const draftsCtx = pendingDrafts.length
      ? "\n\n## Pending drafts (newest first)\n" + pendingDrafts.map((d) => {
        const vs = Array.isArray(d.payload?.versions) ? d.payload.versions : [];
        const topic = String(d.payload?.topic || d.topic || "").replace(/[\r\n]+/g, " ").slice(0, 80);
        return `- draftId ${d.id} · ${String(d.title || "").replace(/[\r\n]+/g, " ").slice(0, 80)} · ${d.type}${topic ? ` · ${topic}` : ""}${vs.length ? ` · latest Version ${vs.at(-1).n}` : ""}`;
      }).join("\n") + "\nThe instructor's follow-ups about a draft — questions, parts, diagrams, marks, types, versions, title, instructions — change the NEWEST draft: call revise_activity_draft with its draftId (their words about the questions verbatim in question_request, or about a teaching resource verbatim in change_request; base_version when they name a version). Call prepare_activity only for a new activity, run_teaching_tool only for a new resource."
      : "";
    mark("prework");
    // Prompt-cache layout (2026-11-17): providers cache the longest matching
    // token PREFIX of a request, so anything volatile inside the system
    // message poisons the match for the whole conversation history behind
    // it. With the tail layout on (default), the prompt splits: systemStatic
    // (the doctrine with NO clock in it, plus the parallel-reads note —
    // byte-stable across turns) leads, the transcript follows, and
    // systemDynamic (the clock + every per-turn context) rides as a trailing
    // message the loop appends after the transcript. systemContent keeps the
    // combined text for the consumers that want it whole (the budget count,
    // the episode record, the flag-off path). AKORO_PROMPT_TAIL=false
    // restores the single combined system message, byte-identical to before.
    const promptTailOn = process.env.AKORO_PROMPT_TAIL !== "false";
    const systemStatic = (await assembleChatDoctrine({
      agentName: safeAgentName || "Akoro",
      protege,
      role,
      think: isThink,
      research: isResearch,
      durableMemory: durable,
      currentTimeContext: promptTailOn ? "" : CURRENT_TIME_CONTEXT,
    })) +
      (process.env.AKORO_PARALLEL_READS !== "false" ? PARALLEL_READS_NOTE : "")
      + (process.env.AKORO_STEP_NARRATION !== "false" ? STEP_NARRATION_NOTE : "");
    const systemDynamic = (promptTailOn ? CURRENT_TIME_CONTEXT : "") +
      (conversation?.summary ? `\n\n## Compact conversation summary\n${conversation.summary}` : "") +
      renderRelevantMemory(relevantMemories) +
      renderLedger(conversation?.scratchpad ? { ...conversation.scratchpad, progressSummary: "" } : null) +
      (goalsCtx || "") +
      protegeCtx + inboxCtx + runningCtx + ingestCtx + decisionsCtx + chatFilesCtx + selfToolCtx + draftsCtx +
      (syllabusCtx ? `\n\n${syllabusCtx}` : "") +
      (pastCtx ? `\n\n${pastCtx}` : "") +
      (curriculumCtx ? `\n\n${curriculumCtx}` : "") +
      (att.docContext ? `\n\n${att.docContext}` : "");
    const systemContent = systemStatic + systemDynamic;

    const userText = userMessage + (att.notes.length ? `\n\n(Attachments: ${att.notes.join(" ")})` : "");
    const userContent = att.visionParts.length
      ? [{ type: "text", text: userText }, ...att.visionParts]
      : userText;
    // Draft tools can be kill-switched off entirely; a required tool that
    // isn't in the catalogue would throw inside the loop — so the prepare
    // force below only arms when the instructor catalogue is non-empty.
    // Instructors' agents build tools too (S7): their two self-tooling tools and their saved tools join the list.
    const instructorTools = role === "student" ? [] : openAiInstructorTools().concat(role === "instructor" && selfToolOn
      ? [...openAiChatTools({ allowToolRequest: false, selfTooling: true }).filter((t) => t.function.name === "schema_lookup" || t.function.name === "create_tool" || t.function.name === "get_agent_capabilities"),
        ...await learnerToolDefs(req.user.id, "instructor").catch(() => [])]
      : []);
    const draftFollowUp = instructorTools.length > 0 && pendingDrafts.length > 0
      && (isDraftFollowUp(userMessage) || (pendingDrafts[0]?.type === "teaching_tool" && isToolDraftFollowUp(userMessage)));
    // Context budget (contextBudget.js): the whole prompt is counted; what falls out is summarised once.
    mark("doctrine");
    const fit = fitDialogue(dialogue, { systemText: systemContent, current: { role: "user", content: userText } });
    let summaryNow = conversation?.scratchpad?.progressSummary || "";
    let summaryMark = summaryMarkOf(conversation?.scratchpad);
    // Launched, not awaited (turn-prep overlap, 2026-11-17): the merge runs
    // during the tool assembly below and is awaited at first use, just
    // before turnSystem is built. Same inputs, same result.
    const summaryP = durable && fit.dropped.length ? summariseEarlier({
      previous: summaryNow, mark: summaryMark, dropped: fit.dropped,
      create: (body) => openai.chat.completions.create({ ...body, __role: "background", __payer: "platform", __feature: "chat_summary", __userId: req.user.id, __timeoutMs: 45_000, __maxRetries: 0 }),   // the turn waits 8 s (contextBudget.js); a slow answer is ignored, never counted against the shared breaker
    }).catch(() => null) : null;
    mark("summary");
    // The intent step (intentStep.js): what the learner wants, read before tool choice. Fail-open.
    // Launched, not awaited (turn-prep overlap, 2026-11-17): it runs during
    // the forced-tool and tool-list assembly below and is awaited at first
    // use, just before turnSystem is built. The catch guard keeps a
    // rejection from surfacing unhandled if the turn fails before the await.
    const intentP = process.env.AGENT_INTENT_STEP === "off" ? Promise.resolve(null) : runIntentStep({
      message: userMessage, recent: fit.kept,
      create: (body) => openai.chat.completions.create({ ...body, __role: "background", __payer: "platform", __feature: "chat_intent", __userId: req.user.id, __timeoutMs: 45_000, __maxRetries: 0 }),   // the turn waits 4 s (intentStep.js); a slow answer is ignored, never counted against the shared breaker
    }).catch(() => null);
    // The turn's forced tool, computed before the tool list: runtime area
    // selection must include the forced tool's area (the loop refuses a
    // required tool it cannot see). Learners: capability questions are
    // answered from the live catalogue. Instructors: an activity request (or
    // a confirmation continuing one) MUST produce a prepare_activity call —
    // left on "auto" the model detours into writing sample questions as
    // prose or re-asking for details the conversation already has. The force
    // covers iteration 0 only; the tool's own clarify() handles anything
    // genuinely missing.
    let forcedTool = role === "student"
      ? (pendingUploads.length ? "read_upload"
        : approvedDecisions.length ? "await_decision"
        : requiresAgentCapabilitiesTool(userMessage) ? "get_agent_capabilities"
        // Other players' results in the learner's battles: go through
        // create_tool (it builds, or asks an admin for the permission) —
        // left on auto the model sometimes said "I can't see that" instead.
        // A change to their own tasks: schema_lookup first, so the agent offers to build it.
        : forceSelfTool ? forceSelfTool
        // Identity questions about the learner's OWN school/class/subjects/
        // teachers/progress are fact questions about data the model cannot
        // see — the live 2026-10-01 transcript had tools=0 and an invented
        // subject list. Force the matching read tool on iteration 0.
        : (requiredLearnerDataTool(userMessage)
          // Test/exam preparation is the study-prep session workflow; left
          // on auto the model interviews the learner for topics/format/
          // duration instead of starting it (live 2026-10-01 transcript:
          // "let's plan for a test" twice, tools=0 both times). Only while
          // the feature gate keeps the study-prep tools in the list.
          ?? (studyPrepEnabled ? requiredStudyPrepTool(userMessage, dialogue) : null)))
      : draftFollowUp ? "revise_activity_draft"
      : ((instructorTools.length && requiresActivityPreparation(userMessage, dialogue))
        ? "prepare_activity" : null);
    // Sessions merge: the learning-history force names the retired built-in.
    // Point it at the merged tool — the loop refuses a required tool it
    // cannot see (live battery 2026-11-15: "my learning sessions" asks
    // errored with "The required Agent Chat tool is unavailable").
    if (forcedTool === "get_my_learning_sessions" && MERGED_DOMAINS.my_study_sessions.enabled()) forcedTool = "my_study_sessions";

    return Object.assign(ctx, {
      role, conversationId, userMessage, turnId, mode, modeNotice, isResearch, isThink,
      canThinkResponses, canThinkChat, chatModel, durable, conversation, retrieval,
      syllabusRefs, pastRefs, curriculumRefs, ingests, pendingDrafts, draftFollowUp,
      selfToolOn, instructorTools, learnerDefsP, summaryP, summaryNow, summaryMark,
      intentP, fit, systemStatic, systemDynamic, systemContent, promptTailOn,
      userText, userContent, forcedTool,
    });
  } catch (error) {
    // The answer half owns the single catch path (partial save + SSE error);
    // it also owns the finally that counts the live turn.
    ctx.error = error;
    return ctx;
  }
}
