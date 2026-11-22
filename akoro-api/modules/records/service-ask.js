/**
 * modules/records/service-ask.js — questions about ONE document (or a
 * folder), answered with citations and saved to the learner's private
 * thread. The router only authenticates; this file owns the flow.
 */
import { searchRecordChunks } from "./searchLib.js";
import {
  ASK_LIMITS, gatherPassages, gatherFolderPassages, buildAskMessages, extractCitations, citationCoverage, loadAskHistory,
  saveAskTurn, cleanModelOutput,
} from "./askLib.js";
import { openai } from "../../lib/aiModel.js";
import { modelRegistry } from "../../lib/modelRegistry.js";
import { resolveAskTargetFor, resolveFolderTargetFor } from "./access.js";
import { cleanSelection, anchorOf } from "./rules.js";
import { res400 } from "./http.js";
import { recordRetrieval } from "../../lib/retrievalTelemetry.js";

/*
 * recordId (the learner's own record — any kind) | contentKey (a shared
 * file, the same access rule extraction uses) → the record whose search
 * chunks answer: { recordId, ownerId, contentKey, name } or { status, message }.
 */
export async function resolveAskTarget(req, src) {
  // A folder target (the folder reader's tools + Ask) resolves to the
  // folder's documents; everything else is one document as before.
  if (src?.folderId) return resolveFolderTargetFor({ userId: req.user.id, folderId: src.folderId });
  return resolveAskTargetFor({ userId: req.user.id, recordId: src?.recordId, contentKey: src?.contentKey });
}

/*
 * POST /api/records/ask[?stream=1] { recordId | contentKey, question, selection? }
 * Streams the answer as `delta` events, then `done` with the citations the
 * answer used ([n] → page + bbox, or a recording moment). The turn is saved
 * to the learner's private thread for this document.
 */
export async function ask(req, res) {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) return res400(res, "Ask a question.");
  if (question.length > ASK_LIMITS.MAX_QUESTION_CHARS) return res400(res, `Keep the question under ${ASK_LIMITS.MAX_QUESTION_CHARS} characters.`);
  const selection = cleanSelection(req.body?.selection);
  const target = await resolveAskTarget(req, req.body);
  if (target.status) return res.status(target.status).json({ success: false, message: target.message });

  const wantsStream = req.query.stream === "1";
  const send = (event, data) => {
    if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  let heartbeat = null;
  if (wantsStream) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders?.();
    heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n"); }, 20_000);
    heartbeat.unref?.();
    res.on("close", () => clearInterval(heartbeat));
    send("status", { step: "search", label: "Searching this document…" });
  }
  const fail = (status, message) => {
    if (wantsStream) { send("error", { error: message }); clearInterval(heartbeat); return res.end(); }
    return res.status(status).json({ success: false, message });
  };

  try {
    const [history, { passages, indexed }] = await Promise.all([
      loadAskHistory({ userId: req.user.id, ...anchorOf(target), limit: ASK_LIMITS.HISTORY_TURNS * 2 }).catch(() => []),
      target.folderId
        ? gatherFolderPassages({ targets: target.folderTargets, question, search: searchRecordChunks })
        : gatherPassages({ target, question, selection, search: searchRecordChunks }),
    ]);
    if (!indexed && !selection) {
      return fail(409, "This document isn't searchable yet — extract its text (or transcribe the recording) first, then ask again.");
    }
    if (wantsStream) send("status", { step: "answer", label: "Writing the answer…", passages: passages.length });

    const messages = buildAskMessages({ docName: target.folderId ? `${target.name} (a folder — passages name their document)` : target.name, passages, question, history });
    let answer = "";
    if (wantsStream) {
      const stream = await openai.chat.completions.create({ model: modelRegistry.defaultId, temperature: 0.2, max_tokens: 900, messages, stream: true });
      for await (const chunk of stream) {
        if (res.destroyed) break;   // the learner left; usage so far is still metered
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) { answer += delta; send("delta", { text: delta }); }
      }
    } else {
      const completion = await openai.chat.completions.create({ model: modelRegistry.defaultId, temperature: 0.2, max_tokens: 900, messages });
      answer = completion.choices?.[0]?.message?.content?.trim() || "";
    }
    answer = cleanModelOutput(answer) || "I couldn't produce an answer from this document — try rephrasing the question.";
    const { citations } = extractCitations(answer, passages);
    const coverage = citationCoverage(answer, citations, passages.length);
    recordRetrieval({
      userId: req.user.id, surface: "ask", phase: "generation", query: question,
      zeroResult: passages.length === 0,
      passages: passages.length, citations: citations.length,
      coverage: coverage.coverage, unknownMarkers: coverage.unknown.length,
      answerChars: answer.length, model: modelRegistry.defaultId,
      meta: { claims: coverage.claims, cited: coverage.cited, streamed: !!wantsStream },
    });

    let messageId = null;
    try {
      ({ assistantMessageId: messageId } = await saveAskTurn({ userId: req.user.id, ...anchorOf(target), question, selection, answer, citations }));
    } catch (e) {
      console.warn("[records-ask] saving the turn failed:", String(e?.message || e).slice(0, 160));
    }
    const payload = { answer, citations, messageId, passages: passages.length, coverage: { score: coverage.coverage, claims: coverage.claims, cited: coverage.cited, unknown: coverage.unknown } };
    if (wantsStream) { send("done", payload); clearInterval(heartbeat); return res.end(); }
    return res.json({ success: true, data: payload });
  } catch (err) {
    console.warn("[records-ask] failed:", String(err?.message || err).slice(0, 200));
    if (err?.name === "InsufficientCoins") return fail(402, "You're out of AI credit — top up to keep asking.");
    return fail(502, "Couldn't answer right now — try again in a moment.");
  }
}

/* GET /api/records/ask/history?recordId=|contentKey= — the learner's thread. */
export async function askHistory(req, res) {
  const target = await resolveAskTarget(req, req.query);
  if (target.status) return res.status(target.status).json({ success: false, message: target.message });
  const messages = await loadAskHistory({ userId: req.user.id, ...anchorOf(target) });
  res.json({ success: true, data: { messages } });
}
