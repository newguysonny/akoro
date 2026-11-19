// The second half of a live Agent Chat turn: the tool list, the agent loop,
// the answer fallbacks and scrubs, the fast/durable saves and the per-turn
// continuation. It owns the single catch path (partial save + SSE error) and
// the finally that counts the live turn.

import db from "../../../db.js";
import { OPENAI_MODEL, openai } from "../../../lib/aiModel.js";
import { runtimeFeatureModel } from "../../../lib/modelRuntime.js";
import { ensureNotTaughtOpener, promisedTeachTopic, scrubInternalIds, stripDsmlMarkup, stripToolCallMarkup } from "./reply-scrub.js";
import { looksTruncated } from "./narration-stall.js";
import { akoroMaterialFor } from "./handlers-social.js";
import { teachRequest } from "../social/protege.js";
import { materialsFrom, collectMaterials } from "./chat-materials.js";
import { requestClaimCorrection } from "./requestClaims.js";
import { turnCorrections } from "./turnCheck.js";
import { nextLedger, renderDraftPlan } from "./taskLedger.js";
import { renderIntent } from "../intent/intentStep.js";
import { createEpisodeRecorder } from "../../agent-contract/episode.js";
import { recordsRealTraffic, saveEpisode } from "../../agent-contract/store.js";
import { labelKeyFor } from "../../agent-ratings/ratings.js";
import { noteChatTurn } from "../../agent-memory/quietLearning.js";
import {
  isSideEffecting, applyMergedDomain, applyChatsMerge, applyLibraryMerge,
  openAiChatTools, learnerToolDefsWithAreas, lastAgentText, shouldPlanFirst,
  mergedLibraryEnabled, mergedChatsEnabled,
  MERGED_DOMAINS, MERGED_DOMAIN_LIST,
} from "./tool-runtime.js";
import { hasExplicitToolRequestConsent } from "../intent/agent-tool-request-intent.js";
import { AREAS, areaSelectionEnabled, areasForMessage, filterDefsByAreas, namedLearnerTool, toolArea } from "./toolSelection.js";
import { savedTurnReplyId, persistLearnerAgentConversationTurn } from "./turn-prepare.js";
import {
  compactAgentSummary, safeMemoryUpdates, appendFastChatTurn, appendBasicChatTurn,
  previewMetaFrom, saveMessageTrace, suggestionsFor,
} from "./turn-store.js";
import {
  runAgentToolLoop, STOPPED_REPLY, THINK_MODEL,
  streamChat, streamThinkWithResponses, thinkChatOnce, streamThinkChat, thinkOnce,
} from "./agent-loop.js";
import {
  warnedUnsavedTurn, agentSessionId,
  stickyAreasFor, activeSessionTurns,
} from "./runtime-state.js";

// The tap continuation lives in chat.js (it calls the handler and emits the
// socket event after it); it registers itself here so the finally can start it
// without the answer module importing chat.js, which would be a cycle.
let scheduleContinuation = null;
export function setDecisionContinuationScheduler(fn) { scheduleContinuation = fn; }

const RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || "gpt-4o";

export async function answerTurn(ctx) {
  if (!ctx) return;
  const { req, res, t0, wantsStream } = ctx;
  const { send, status, mark, timed, timings } = ctx.sse;
  const {
    role, conversationId, userMessage, turnId, mode, modeNotice, isResearch, isThink,
    canThinkResponses, canThinkChat, chatModel, durable, conversation, retrieval,
    syllabusRefs, pastRefs, curriculumRefs, ingests, pendingDrafts, draftFollowUp,
    selfToolOn, instructorTools, learnerDefsP, summaryP, intentP, fit,
    systemStatic, systemDynamic, systemContent, promptTailOn, userText, userContent,
    forcedTool, trace, isAborted, isContinuation,
  } = ctx;
  const { turnCtx } = ctx;
  let summaryNow = ctx.summaryNow;
  let summaryMark = ctx.summaryMark;

  try {
    if (ctx.early) return;
    if (ctx.error) throw ctx.error;
    // Runtime area selection (toolSelection.js): the always-on core plus the
    // areas active for this conversation — the message's areas, areas loaded
    // earlier in the conversation, and the forced tool's area. Built-in and
    // learner-built tools are selected together, in one move. No active area
    // (a vague opener) → the full list: selection narrows only when
    // something points at an area.
    let turnTools = instructorTools;
    let selectionNote = "";
    if (role === "student") {
      const { defs: learnerDefs, areas: learnerAreas, labels: learnerLabels } = selfToolOn
        ? await learnerDefsP
        : { defs: [], areas: new Map(), labels: new Map() };
      // Named-tool force (2026-11-18): "run my Delete a chat by title
      // tool" names one of the learner's own tools with a run verb —
      // force that call. The tool was already being LOADED (its area
      // was active); the model still declined it and claimed it did
      // not exist. Forcing rides the existing required-tool machinery:
      // the area-add and the survival net below see it too. A write
      // still lands on its confirmation card, so a forced run cannot
      // change anything unconfirmed.
      if (!forcedTool && learnerLabels?.size) {
        const named = namedLearnerTool(userMessage, [...learnerLabels].map(([name, label]) => ({ name, label })));
        if (named) forcedTool = named;
      }
      let allTools = openAiChatTools({
        allowToolRequest: hasExplicitToolRequestConsent(userMessage, { previousAgentText: lastAgentText(fit.kept) }),
        selfTooling: selfToolOn,
      }).concat(learnerDefs);
      allTools = await applyLibraryMerge(allTools, req.user.id, selfToolOn);
      allTools = await applyChatsMerge(allTools, req.user.id, selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_tasks, ["list_tasks"], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_goals, ["list_my_goals"], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_study_notes, ["search_my_study_knowledge"], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_study_sessions, ["get_my_learning_sessions"], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_past_questions, ["get_past_question_practice"], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_weak_topics, ["get_weak_topics"], selfToolOn);
      turnTools = allTools;
      if (areaSelectionEnabled()) {
        const active = new Set([...stickyAreasFor(conversationId), ...areasForMessage(userMessage)]);
        if (forcedTool) active.add(toolArea(forcedTool));
        if (forcedTool === "my_study_sessions") active.add("teaching");
        if (active.size) {
          const sticky = stickyAreasFor(conversationId);
          for (const a of active) sticky.add(a);
          turnTools = filterDefsByAreas(allTools, active, (name) => learnerAreas.get(name) || (mergedLibraryEnabled() && name === "library_documents" ? "files" : undefined) || (mergedChatsEnabled() && name === "my_chats" ? "chats" : undefined) || (MERGED_DOMAINS.my_tasks.enabled() && name === "my_tasks" ? "plans" : undefined) || (MERGED_DOMAINS.my_goals.enabled() && name === "my_goals" ? "plans" : undefined) || (MERGED_DOMAINS.my_study_notes.enabled() && name === "my_study_notes" ? "teaching" : undefined) || (MERGED_DOMAINS.my_study_sessions.enabled() && name === "my_study_sessions" ? "teaching" : undefined) || (MERGED_DOMAINS.my_past_questions.enabled() && name === "my_past_questions" ? "progress" : undefined) || (MERGED_DOMAINS.my_weak_topics.enabled() && name === "my_weak_topics" ? "progress" : undefined) || toolArea(name));
          // A forced (required) tool must survive area selection — the loop
          // refuses a required tool it cannot see. A merged def can resolve
          // to the learner tool's own derived area instead of its built-in
          // area (sessions: progress, not teaching), so the forced area-add
          // alone does not guarantee it survives the filter.
          if (forcedTool && !turnTools.some((t) => t.function?.name === forcedTool)) {
            const needed = allTools.find((t) => t.function?.name === forcedTool);
            if (needed) turnTools = [...turnTools, needed];
          }
          selectionNote = `\n\n## Tools loaded for this conversation\nLoaded areas: ${[...active].join(", ")}, plus the always-on core. Your other tools exist but are not loaded in this conversation. If the learner's request needs a tool you do not have, call get_agent_capabilities with { area: "<area id>" } to load that area's tools, then continue the request. Area ids: ${Object.keys(AREAS).join(", ")}.`;
        }
      }
    }
    else if (role === "instructor") {
      // Instructor turns get the same treatment as learner turns (Matt's
      // order 2026-11-16): the merged instructor domains assemble over the
      // catalogue first, then runtime area selection narrows the turn to
      // the core + the active areas — built-in and instructor-built tools
      // filtered together. No active area → the full list, as for learners.
      let allTools = instructorTools;
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_classes, ["list_my_classrooms"], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_class_students, [], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_activities, [], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_activity_results, ["check_activity_outcomes"], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_activity_drafts, ["list_activity_drafts", "get_activity_draft"], selfToolOn);
      turnTools = allTools;
      if (areaSelectionEnabled()) {
        const { areas: ownAreas } = await learnerToolDefsWithAreas(req.user.id, "instructor").catch(() => ({ areas: new Map() }));
        const active = new Set([...stickyAreasFor(conversationId), ...areasForMessage(userMessage)]);
        if (forcedTool) active.add(toolArea(forcedTool));
        if (active.size) {
          const sticky = stickyAreasFor(conversationId);
          for (const a of active) sticky.add(a);
          const mergedAreaOf = (name) => MERGED_DOMAIN_LIST.find((c) => c.name === name && c.enabled())?.area;
          turnTools = filterDefsByAreas(allTools, active, (name) => ownAreas.get(name) || mergedAreaOf(name) || toolArea(name));
          // A forced (required) tool must survive area selection — the loop
          // refuses a required tool it cannot see (same net as learners).
          if (forcedTool && !turnTools.some((t) => t.function?.name === forcedTool)) {
            const needed = allTools.find((t) => t.function?.name === forcedTool);
            if (needed) turnTools = [...turnTools, needed];
          }
          selectionNote = `\n\n## Tools loaded for this conversation\nLoaded areas: ${[...active].join(", ")}, plus the always-on core. Your other tools exist but are not loaded in this conversation. If the instructor's request needs a tool you do not have, call get_agent_capabilities with { area: "<area id>" } to load that area's tools, then continue the request. Area ids: ${Object.keys(AREAS).join(", ")}.`;
        }
      }
    }
    // Prep overlap, awaited at first use (2026-11-17): the summary merge and
    // the intent step, launched above, ran during the tool assembly.
    if (summaryP) { const merged = await summaryP; if (merged) { summaryNow = merged.summary; summaryMark = merged.mark; } }
    const intent = await intentP;
    mark("intent");
    const turnSystem = systemContent
      + (summaryNow ? `\n\n## Earlier in this chat (summary)\n${summaryNow}` : "")
      + renderIntent(intent)
      // Phase 22 Part E: a multi-step request gets a starting plan to adopt (kept only if the agent adopts it).
      + (intent?.multiStep ? renderDraftPlan(intent.steps, conversation?.scratchpad || null) : "")
      + selectionNote;
    // The loop's volatile tail in the cache layout: the dynamic context plus
    // this turn's summary/intent/selection notes (turnSystem above keeps the
    // combined text for the episode record). Null when the layout is off —
    // the loop then receives turnSystem whole, exactly as before.
    const loopTail = promptTailOn
      ? systemDynamic
        + (summaryNow ? `\n\n## Earlier in this chat (summary)\n${summaryNow}` : "")
        + renderIntent(intent)
        + (intent?.multiStep ? renderDraftPlan(intent.steps, conversation?.scratchpad || null) : "")
        + selectionNote
      : null;
    const ledgerIn = conversation?.scratchpad ? { ...conversation.scratchpad, progressSummary: summaryNow, summaryMark } : (summaryNow ? { progressSummary: summaryNow, summaryMark } : null);
    const recorder = (await recordsRealTraffic(req.user.id).catch(() => false))
      ? createEpisodeRecorder({ surface: "agent_chat", role, system: turnSystem, source: "real",
        state: { ledger: ledgerIn, intent, summary: summaryNow || null }, messages: [...fit.kept, { role: "user", content: userText }] })
      : null;
    mark("recorder");
    const prepared = await runAgentToolLoop({
      recorder,
      ledger: ledgerIn,
      planFirst: shouldPlanFirst(intent),
      teacherWords: draftFollowUp ? userMessage.slice(0, 1500) : null,
      systemContent: promptTailOn ? systemStatic : turnSystem,
      tailContent: loopTail,
      messages: [...fit.kept, { role: "user", content: userContent }],
      studentId: req.user.id,
      conversationId,
      turnId,
      status: wantsStream ? status : null,
      tools: turnTools,
      // Learners: capability questions are answered from the live catalogue.
      // Instructors: an activity request (or a confirmation continuing one)
      // MUST produce a prepare_activity call — left on "auto" the model
      // detours into writing sample questions as prose or re-asking for
      // details the conversation already has. The force covers iteration 0
      // only; the tool's own clarify() handles anything genuinely missing.
      requiredTool: forcedTool,
      role,
      trace,
      isAborted,
      think: isThink && canThinkResponses,
      // A chat-reasoning Think turn answers in the reasoning pass below, so the
      // preflight decision must not stream (or become) the final answer.
      streamText: !isResearch && !(isThink && canThinkChat),
      // A mode with no learner pick uses its runtime feature override, then env.
      model: chatModel || (isThink ? runtimeFeatureModel("think_mode") : isResearch ? runtimeFeatureModel("research_mode") : null),
    });
    mark("agentLoop");
    const stopped = () => Boolean(prepared.aborted) || isAborted();
    // Post-loop calls (the fallback answer call, the think passes) keep the
    // SINGLE-system shape, deliberately: with the volatile context trailing
    // the transcript, the model tried to continue the tool pattern as DSML
    // text in the no-tools answer call and the reply scrubbed to empty —
    // live-verified 2026-11-17, 3 of 3 fallback turns ended on the
    // empty-reply line while the same layout answers fine inside the loop
    // (where tools are offered). The loop's decisions — the token volume —
    // keep the tail layout; these once-per-turn calls use the proven shape.
    const finalMessages = [{ role: "system", content: systemContent }, ...prepared.messages];
    // The closing instruction for an answer-call retry (below): a transcript
    // full of tool calls can pull the model into imitating another call as
    // DSML text (which the scrubber then removes, leaving an empty reply),
    // and on reasoning models the whole token budget can go to hidden
    // reasoning — both ended live turns on the empty-reply line (2026-11-17).
    const answerClosing = { role: "user", content: "Write your reply to the learner now, in plain words, from the results above. Do not call any tool and do not describe tools — just answer. This is the last call of the turn and nothing runs after you, so do not defer: no promising to check, look up or run something next, and no reporting that work was not done while asking to be asked again. Give the complete answer the conversation and the results support; if something the learner asked for could not be done, say so plainly, with the reason — do not offer a later turn as the remedy." };
    const tools = turnTools;   // declared (with tool_choice "none") so the answer call's history — assistant tool calls and their results — references tools the request actually defines; sending that history with NO tools declared made the default model return empty/markup answers (live, 2026-11-17). The preflight loop above remains the only executor: "none" forbids new calls.
    let reply = "";
    let thinking = "";
    let usedModel = OPENAI_MODEL;

    if (!wantsStream) {
      // A final function-disabled call makes the model explain completed tool
      // results in learner language, while the preflight loop above remains
      // the only authority that may invoke an Akoro tool.
      // Think mode: the reasoned last decision already is the answer; else
      // reason over the tool results (if any) for the answer.
      const thinkTarget = chatModel || runtimeFeatureModel("think_mode") || THINK_MODEL;
      if (prepared.finalText && !(isThink && canThinkChat)) { reply = prepared.finalText; usedModel = isThink ? (canThinkResponses ? thinkTarget : (chatModel || OPENAI_MODEL)) : (chatModel || OPENAI_MODEL); }
      else if (isThink && canThinkResponses) {
        try { ({ reply, thinking } = await thinkOnce({ messages: finalMessages, model: thinkTarget, trace })); usedModel = thinkTarget; } catch { /* fallback below */ }
      } else if (isThink && canThinkChat) {
        try { ({ reply, thinking } = await thinkChatOnce({ messages: finalMessages, model: chatModel || OPENAI_MODEL, trace })); usedModel = chatModel || OPENAI_MODEL; } catch { /* fallback below */ }
      }
      if (!reply) {
        usedModel = isResearch ? (chatModel || runtimeFeatureModel("research_mode") || RESEARCH_MODEL) : (chatModel || OPENAI_MODEL);
        const completion = await openai.chat.completions.create({
          model: usedModel,
          temperature: 0.6,
          max_tokens: isResearch ? 2200 : 900,
          messages: [...finalMessages, answerClosing],
          ...(tools ? { tools, tool_choice: "none" } : {}),
        });
        reply = completion.choices?.[0]?.message?.content?.trim() || "";
        if (!reply) {
          // Empty answer — one retry with the closing instruction and room
          // to answer (see answerClosing above).
          const retry = await openai.chat.completions.create({
            model: usedModel,
            temperature: 0.6,
            max_tokens: 2000,
            messages: [...finalMessages, answerClosing],
          }).catch(() => null);
          reply = retry?.choices?.[0]?.message?.content?.trim() || "";
        }
      }
    } else {
      if (!stopped() && prepared.finalText && !(isThink && canThinkChat)) {
        // Already on screen when it streamed as the last step's words.
        reply = prepared.finalText;
        usedModel = chatModel || (isThink ? runtimeFeatureModel("think_mode") : isResearch ? runtimeFeatureModel("research_mode") : null) || OPENAI_MODEL;
        if (!prepared.promoted) send("delta", { text: reply });
      } else if (!stopped() && isThink && canThinkResponses) {
        status("thinking", "Thinking…");
        try { ({ reply, thinking } = await streamThinkWithResponses({ send, messages: finalMessages, model: chatModel || THINK_MODEL, trace, isAborted })); usedModel = chatModel || THINK_MODEL; } catch { /* fall through */ }
      } else if (!stopped() && isThink && canThinkChat) {
        status("thinking", "Thinking…");
        try { ({ reply, thinking } = await streamThinkChat({ send, messages: finalMessages, model: chatModel || OPENAI_MODEL, trace, isAborted })); usedModel = chatModel || OPENAI_MODEL; } catch { /* fall through */ }
      }
      if (!reply && !stopped()) {
        if (isResearch) status("synthesis", "Writing it up…");
        usedModel = isResearch ? (chatModel || runtimeFeatureModel("research_mode") || RESEARCH_MODEL) : (chatModel || OPENAI_MODEL);
        try {
          reply = await streamChat({
            send,
            messages: [...finalMessages, answerClosing],
            model: usedModel,
            max_tokens: isResearch ? 2200 : 900,
            tools,
            toolChoice: "none",
            isAborted,
          });
        } catch (error) {
          if (!isResearch && !chatModel) throw error;
          usedModel = OPENAI_MODEL;   // the chosen / research model failed — the default answers
          reply = await streamChat({ send, messages: finalMessages, model: usedModel, max_tokens: 900, tools, toolChoice: "none", isAborted });
        }
        if (!reply.trim() && !stopped()) {
          // Empty answer — one retry with the closing instruction and room
          // to answer (see answerClosing above).
          reply = await streamChat({
            send,
            messages: [...finalMessages, answerClosing],
            model: usedModel,
            max_tokens: 2000,
            tools,
            toolChoice: "none",
            isAborted,
          }).catch(() => "");
        }
      }
    }
    // Fragment answer (2026-11-18): the answer call can end mid-sentence
    // ("Nothing was rebuilt and nothing was run — this turn produced") on
    // a turn where nothing ran, and the empty-reply retries above never
    // see it — the reply is not empty. One non-streamed retry with the
    // closing instruction; only when the turn did no work, since after
    // real executions the corrections below append rather than replace.
    if (!stopped() && reply.trim() && looksTruncated(reply) && !prepared.toolExecutions.length) {
      const retry = await openai.chat.completions.create({
        model: usedModel, temperature: 0.6, max_tokens: 2000,
        messages: [...finalMessages, answerClosing],
      }).catch(() => null);
      const retryText = retry?.choices?.[0]?.message?.content?.trim() || "";
      if (retryText) reply = retryText;
    }
    // A stopped turn keeps whatever streamed so far, marked as stopped, so the
    // saved transcript matches what the learner saw.
    if (stopped()) reply = reply.trim() ? `${reply.trim()}\n\n${STOPPED_REPLY}` : STOPPED_REPLY;
    // Internal ids the model saw in tool results never reach the learner (reply-scrub.js).
    reply = scrubInternalIds(stripToolCallMarkup(stripDsmlMarkup(reply)));
    if (!stopped()) reply = ensureNotTaughtOpener(reply, prepared.toolExecutions);
    // …and a reply that promises the Teach me button without having called the
    // tool gets the button it promised (the same topic, the same links).
    if (role === "student" && !stopped() && !prepared.toolExecutions.some((x) => x.tool === "ask_to_be_taught")) {
      const teach = teachRequest({ topic: promisedTeachTopic(reply) });
      if (teach) {
        const found = await akoroMaterialFor(teach.topic).catch(() => []);
        const mats = collectMaterials([materialsFrom("ask_to_be_taught", { materials: found })]);
        prepared.toolExecutions.push({ tool: "ask_to_be_taught", success: true, backfilled: true, input: { topic: teach.topic }, teach, ...(mats.length ? { materials: mats } : {}) });
      }
    }
    // A reply that says a request went to an admin when none did this turn is corrected, not left standing.
    if (!stopped()) {
      const fix = requestClaimCorrection(reply, prepared.toolExecutions);
      if (fix) { reply = `${reply.trim()}\n\n${fix}`; if (wantsStream) send("delta", { text: `\n\n${fix}` }); }
      // The end-of-turn check (turnCheck.js): claimed actions against real changes, "all done" against the ledger.
      for (const line of turnCorrections(reply, { executions: prepared.toolExecutions, ledger: prepared.ledger || ledgerIn })) {
        reply = `${reply.trim()}\n\n${line}`;
        if (wantsStream) send("delta", { text: `\n\n${line}` });
      }
    }
    if (!reply.trim()) reply = "I'm here to help with your studies — ask me anything about your subjects!";
    // The episode (per AGENT_EPISODES; never for an opted-out user): the reply as shown, code-computed checks,
    // stored anonymised; never holds up the reply.
    // Stored once the reply is saved, keyed to it (labelKeyFor) so a later rating joins it as a human label.
    let episode = null;
    if (recorder && !stopped()) {
      recorder.decision({ reply });
      episode = recorder.finish({ ledger: prepared.ledger || ledgerIn, sideEffecting: (t) => isSideEffecting(t, {}), capabilities: intent?.multiStep ? ["planning"] : [] });
    }
    const traceBlocks = trace.blocks();
    // The reply's trace and meta (previews, materials, the uploads' cards), and the uploads pointed at it.
    let savedReplyId = null;   // the stored reply's id: the episode's label key comes from it
    const saveTurn = async (messageId) => {
      savedReplyId = messageId || null;
      const meta = { ...(previewMetaFrom(prepared.toolExecutions) || {}),
        ...(ingests.length ? { ingest: { id: ingests[0].id }, ingests: ingests.map((r) => ({ id: r.id })) } : {}) };
      await saveMessageTrace({ messageId, userId: req.user.id, trace: traceBlocks, meta: Object.keys(meta).length ? meta : null });
      if (ingests.length && messageId) {
        try {
          await db.schema("edu").from("material_ingests").update({ chat_message_id: messageId, chat_session_id: conversationId, updated_at: new Date().toISOString() })
            .eq("user_id", req.user.id).in("id", ingests.map((r) => r.id));
        } catch { /* the cards still show; they won't reopen with the chat */ }
      }
    };

    // Persist EVERY completed turn. The previous gate — skip the save when
    // req/res looks destroyed ("client stream abandoned") — meant that behind
    // Cloudflare + Render, where the socket routinely reads destroyed the
    // instant the last delta flushes, NO turn ever persisted: every learner's
    // history was silently lost (observed live: 4/4 turns saved=false with the
    // turn line firing 2ms after the stream — no DB round-trip ever ran).
    // Saving is always correct here: the reply is fully generated by this
    // point, and the durable write is turn-keyed idempotent — an abandoned
    // stream that is retried with the same turnId resumes/dedupes by design.
    mark("answer");
    // The chips start now, beside the save, not after it (realtime, 2026-11-07).
    const suggestionsP = role === "student" && reply && wantsStream && req.body?.inlineSuggestions === true
      ? suggestionsFor({ user: req.user, body: { reply, ask: userMessage, role: "student", conversationId,
        tools: prepared.toolExecutions.map((x) => ({ tool: x?.tool, topic: x?.teach?.topic || x?.guide?.teach?.topic || null })) } }).catch(() => [])
      : null;
    // The reply is final: the learner gets "done" now (cards, chips, approvals settle) and
    // saving follows; the saved message's id comes after as "saved" (realtime, 2026-11-07:
    // the save took 3–35 s on the sandbox and held everything back).
    // The visible reply is persisted BEFORE the client is told it is done: a
    // refresh in the next seconds (or an instance crash) can no longer lose
    // what the learner just saw. The slow durable context work still follows.
    let fastSavedId = null;
    if (conversationId && turnId) {
      try {
        fastSavedId = await timed("fastSave", appendFastChatTurn({
          conversationId, userId: req.user.id, sessionId: agentSessionId(conversationId), turnId,
          userMessage, assistantMessage: reply, agentOnly: isContinuation,
        }));
      } catch (e) { console.warn("[/chat/agent] fast save failed:", e?.message || e); }
    }
    let doneSent = false;
    if (wantsStream) {
      timings.doneMs = Date.now() - t0;
      send("done", { reply, thinking, syllabus: syllabusRefs, pastQuestions: pastRefs, curriculum: curriculumRefs, mode,
        ...(fastSavedId ? { messageId: fastSavedId } : {}),
        metadata: { model: usedModel, responseTimeMs: Date.now() - t0, timings, retrieval, toolExecutions: prepared.toolExecutions, ...(durable ? { durableContext: true } : {}), ...(modeNotice ? { modeNotice } : {}) },
        toolExecutions: prepared.toolExecutions, trace: traceBlocks, stopped: stopped() });
      doneSent = true;
      if (suggestionsP && !stopped()) suggestionsP.then((suggestions) => send("suggestions", { suggestions }));
    }
    let turnSaved = false;   // one outcome line per turn — see the log below
    if (conversationId) {
      if (durable) {
        if (wantsStream) status("saving", "Saving this study context…");
        try {
          const persisted = await timed("persistTurn", persistLearnerAgentConversationTurn({
            conversationId,
            userId: req.user.id,
            sessionId: agentSessionId(conversationId),
            turnId,
            userMessage,
            assistantMessage: reply,
            agentOnly: isContinuation,
            summary: compactAgentSummary(conversation?.summary, isContinuation ? "The learner tapped Allow on the pending card." : userMessage, reply),
            scratchpad: nextLedger(ledgerIn, prepared.ledger || null, isContinuation ? "The learner tapped Allow on the pending card." : userMessage, prepared.toolExecutions),
            memories: isContinuation ? [] : safeMemoryUpdates(userMessage),
          }));
          turnSaved = true;
          await timed("saveTrace", saveTurn(persisted?.assistantMessageId || fastSavedId));
        } catch (persistError) {
          // The reply already happened — never lose the transcript to a
          // durable-write hiccup. Fall back to the plain two-row append.
          console.error("[/chat/agent] durable persist failed — appending basic transcript:", persistError.message);
          // Never write the turn twice: if its messages were saved before the
          // failure, keep those (a second append duplicated every turn).
          const already = await savedTurnReplyId({ conversationId, userId: req.user.id, turnId }).catch(() => null);
          if (already) { turnSaved = true; await saveTurn(already).catch(() => {}); }
          else if (fastSavedId) { turnSaved = true; savedReplyId = fastSavedId; await saveTurn(fastSavedId).catch(() => {}); }
          else if (turnId) {
            const retried = await appendFastChatTurn({ conversationId, userId: req.user.id,
              sessionId: agentSessionId(conversationId), turnId, userMessage, assistantMessage: reply, agentOnly: isContinuation }).catch(() => null);
            if (retried) { turnSaved = true; savedReplyId = retried; await saveTurn(retried).catch(() => {}); }
            else await appendBasicChatTurn({ conversationId, userId: req.user.id, userMessage, assistantMessage: reply, agentOnly: isContinuation })
              .then(async (saved) => { turnSaved = true; savedReplyId = saved?.assistantMessageId; await saveTurn(saved?.assistantMessageId); })
              .catch((e) => console.error("[/chat/agent] basic transcript append failed:", e.message));
          }
          else await appendBasicChatTurn({ conversationId, userId: req.user.id, userMessage, assistantMessage: reply, agentOnly: isContinuation })
            .then(async (saved) => { turnSaved = true; await saveTurn(saved?.assistantMessageId); })
            .catch((e) => console.error("[/chat/agent] basic transcript append failed:", e.message));
        }
      } else if (fastSavedId) {
        turnSaved = true;
        savedReplyId = fastSavedId;
        await saveTurn(fastSavedId).catch(() => {});
      } else if (turnId) {
        const retried = await appendFastChatTurn({ conversationId, userId: req.user.id,
          sessionId: agentSessionId(conversationId), turnId, userMessage, assistantMessage: reply, agentOnly: isContinuation }).catch(() => null);
        if (retried) { turnSaved = true; savedReplyId = retried; await saveTurn(retried).catch(() => {}); }
        else await appendBasicChatTurn({ conversationId, userId: req.user.id, userMessage, assistantMessage: reply, agentOnly: isContinuation })
          .then(async (saved) => { turnSaved = true; savedReplyId = saved?.assistantMessageId; await saveTurn(saved?.assistantMessageId); })
          .catch((e) => console.error("[/chat/agent] basic transcript append failed:", e.message));
      } else {
        await appendBasicChatTurn({ conversationId, userId: req.user.id, userMessage, assistantMessage: reply, agentOnly: isContinuation })
          .then(async (saved) => { turnSaved = true; savedReplyId = saved?.assistantMessageId; await saveTurn(saved?.assistantMessageId); })
          .catch((e) => console.error("[/chat/agent] basic transcript append failed:", e.message));
      }
    } else if (!warnedUnsavedTurn.warned) {
      warnedUnsavedTurn.warned = true;
      console.warn("[/chat/agent] a completed turn was NOT saved (client sent no conversationId) — that reply cannot be restored on reload");
    }
    if (episode) {
      void saveEpisode(episode, { names: [req.user.username, req.user.fullName, req.user.email].filter(Boolean),
        labelKey: labelKeyFor("agent_chat", savedReplyId) }).catch(() => {});
    }
    // One line per completed turn, success or failure: with this, "my history
    // is empty" is diagnosable from the logs alone — saved=false names the
    // failing write above, saved=true with an empty reload points at the read
    // side (GET /sessions, GET /sessions/:id/messages) or the client.
    console.log(`[agent-chat] turn user=${String(req.user.id).slice(0, 8)} conv=${conversationId ?? "-"} `
      + `turn=${turnId ?? "-"} durable=${durable} tools=${prepared.toolExecutions.length} stopped=${stopped()} `
      + `saved=${turnSaved} ${Date.now() - t0}ms`);
    // Quiet learning (§7.16.6): once this chat settles, one background pass
    // writes its summary and merges the learner's memories. Never blocks the reply.
    if (turnSaved && conversationId && role === "student") noteChatTurn({ userId: req.user.id, chatSessionId: conversationId }).catch(() => {});

    mark("save");
    timings.totalMs = Date.now() - t0;
    console.log(`[chat-timing] ${JSON.stringify(timings)}`);
    const metadata = {
      model: usedModel,
      responseTimeMs: Date.now() - t0,
      timings,
      retrieval,
      toolExecutions: prepared.toolExecutions,
      ...(durable ? { durableContext: true } : {}),
      ...(modeNotice ? { modeNotice } : {}),
    };
    if (!wantsStream) {
      return res.json({ success: true, reply, response: reply, thinking, syllabus: syllabusRefs, pastQuestions: pastRefs, curriculum: curriculumRefs, mode, metadata, toolExecutions: prepared.toolExecutions, trace: traceBlocks, messageId: savedReplyId });
    }
    if (!doneSent) send("done", { reply, thinking, syllabus: syllabusRefs, pastQuestions: pastRefs, curriculum: curriculumRefs, mode, metadata, toolExecutions: prepared.toolExecutions, trace: traceBlocks, stopped: stopped(), messageId: savedReplyId });
    // The stored reply's id (ratings attach to it), once the save is done — plus the turn's full timings.
    send("saved", { messageId: savedReplyId, saved: turnSaved, timings });
    // The chips (started with the answer) — wait for them before closing the stream.
    if (suggestionsP) await suggestionsP.catch(() => []);
    return res.end();
  } catch (error) {
    console.error("[/chat/agent]", error);
    if (wantsStream && ctx.sse.headersSent) {
      // Persist what the learner already saw (or an honest note when the
      // failure happened during tool work), so a refresh is never empty.
      const partial = ctx.sse.streamedAnswer.trim();
      if (turnCtx?.conversationId && turnCtx.turnId) {
        try {
          await appendFastChatTurn({
            conversationId: turnCtx.conversationId, userId: req.user.id,
            sessionId: agentSessionId(turnCtx.conversationId), turnId: turnCtx.turnId,
            userMessage: turnCtx.userMessage, agentOnly: isContinuation,
            assistantMessage: partial
              ? `${partial}\n\n_The connection dropped while the agent was working. Please try again._`
              : "_The connection dropped while the agent was working before it could answer. Please try again._",
          });
        } catch (e) { console.warn("[/chat/agent] could not save the interrupted turn:", e?.message || e); }
      }
      send("error", { error: "The connection dropped while the agent was working. Reopening this chat in a moment will show what was saved." });
      return res.end();
    }
    return res.status(error?.status || 500).json({ error: error?.message || "Agent Chat is unavailable" });
  } finally {
    if (ctx.sessionTrackId) {
      const left = (activeSessionTurns.get(ctx.sessionTrackId) || 1) - 1;
      if (left > 0) activeSessionTurns.set(ctx.sessionTrackId, left); else activeSessionTurns.delete(ctx.sessionTrackId);
      // A card tap that landed while this turn was running could not start
      // its own continuation then (a turn was live); if an approved decision
      // is still unapplied now this turn has ended, start it here.
      if (!req.internalContinuation) scheduleContinuation?.({ userId: req.user?.id, user: req.user, sessionId: ctx.sessionTrackId });
    }
  }
}

