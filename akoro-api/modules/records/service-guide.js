/**
 * modules/records/service-guide.js — "Learning with Guide": the guide
 * teacher's reply, grounded in the document like Ask, saved to the
 * learner's guide thread (or a document-free topic session).
 */
import { searchRecordChunks } from "./searchLib.js";
import { gatherPassages, extractCitations, loadAskHistory, saveAskTurn, cleanModelOutput } from "./askLib.js";
import { openai } from "../../lib/aiModel.js";
import { modelRegistry } from "../../lib/modelRegistry.js";
import { buildGuideMessages, cleanGuideHistory, GUIDE_LIMITS } from "./guideLib.js";
import { cleanSelection } from "./rules.js";
import { res400 } from "./http.js";
import { resolveAskTarget } from "./service-ask.js";

/*
 * POST /api/records/guide[?stream=1]
 *   { recordId | contentKey, message, selection?, guideName?, topic?, subject? }
 *   — or, a session without a document: { topic, subject?, message, history? }
 * "Learning with Guide": the guide teacher's reply, grounded in the document
 * like Ask (passages, [n] citations that jump the reader), saved to the
 * learner's guide thread for this document. Streams like /ask.
 */
export async function guide(req, res) {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) return res400(res, "Write a message for your guide.");
  if (message.length > GUIDE_LIMITS.MAX_MESSAGE_CHARS) return res400(res, `Keep the message under ${GUIDE_LIMITS.MAX_MESSAGE_CHARS} characters.`);
  const selection = cleanSelection(req.body?.selection);
  const hasDocument = !!(req.body?.recordId || req.body?.contentKey);
  const target = hasDocument ? await resolveAskTarget(req, req.body) : null;
  if (target?.status) return res.status(target.status).json({ success: false, message: target.message });
  const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : null);

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
    send("status", { step: hasDocument ? "search" : "answer", label: hasDocument ? "Looking in your document…" : "Thinking…" });
  }
  const fail = (status, msg) => {
    if (wantsStream) { send("error", { error: msg }); clearInterval(heartbeat); return res.end(); }
    return res.status(status).json({ success: false, message: msg });
  };

  try {
    let history = [];
    let passages = [];
    if (target) {
      const [h, found] = await Promise.all([
        loadAskHistory({ userId: req.user.id, recordId: target.recordId, limit: GUIDE_LIMITS.HISTORY_TURNS * 2, channel: "guide" }).catch(() => []),
        gatherPassages({ target, question: message, selection, search: searchRecordChunks }).catch(() => ({ passages: [] })),
      ]);
      history = h;
      passages = found.passages || [];
    } else {
      history = cleanGuideHistory(req.body?.history);
    }
    if (wantsStream) send("status", { step: "answer", label: "Your guide is writing…", passages: passages.length });

    const messages = buildGuideMessages({
      guideName: str(req.body?.guideName, 60), docName: target?.name || null,
      topic: str(req.body?.topic, 160), subject: str(req.body?.subject, 80), classLevel: str(req.body?.classLevel, 40),
      passages, message: selection?.text ? `"${selection.text}"\n\n${message}` : message, history, hasDocument: !!target,
    });
    let answer = "";
    if (wantsStream) {
      const stream = await openai.chat.completions.create({ model: modelRegistry.defaultId, temperature: 0.4, max_tokens: GUIDE_LIMITS.MAX_TOKENS, messages, stream: true });
      for await (const chunk of stream) {
        if (res.destroyed) break;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) { answer += delta; send("delta", { text: delta }); }
      }
    } else {
      const completion = await openai.chat.completions.create({ model: modelRegistry.defaultId, temperature: 0.4, max_tokens: GUIDE_LIMITS.MAX_TOKENS, messages });
      answer = completion.choices?.[0]?.message?.content?.trim() || "";
    }
    answer = cleanModelOutput(answer) || "Sorry — I couldn't put a reply together. Could you say that another way?";
    const { citations } = target ? extractCitations(answer, passages) : { citations: [] };

    let messageId = null;
    let saveError = null;
    if (target) {
      try {
        ({ assistantMessageId: messageId } = await saveAskTurn({ userId: req.user.id, recordId: target.recordId, question: message, selection, answer, citations, channel: "guide" }));
      } catch (e) {
        saveError = String(e?.message || e).slice(0, 200);
        console.warn("[records-guide] saving the turn failed:", saveError);
      }
    }
    // The lesson still shows; saved:false (and why) says it won't be there next time.
    const payload = { answer, citations, messageId, passages: passages.length, saved: !!messageId, ...(saveError ? { saveError } : {}) };
    if (wantsStream) { send("done", payload); clearInterval(heartbeat); return res.end(); }
    return res.json({ success: true, data: payload });
  } catch (err) {
    console.warn("[records-guide] failed:", String(err?.message || err).slice(0, 200));
    if (err?.name === "InsufficientCoins") return fail(402, "You're out of AI credit — top up to keep learning with your guide.");
    return fail(502, "Your guide couldn't reply right now — try again in a moment.");
  }
}

/** GET /api/records/guide/history?recordId|contentKey — the learner's guide thread for this document. */
export async function guideHistory(req, res) {
  const target = await resolveAskTarget(req, req.query);
  if (target.status) return res.status(target.status).json({ success: false, message: target.message });
  const messages = await loadAskHistory({ userId: req.user.id, recordId: target.recordId, channel: "guide" });
  res.json({ success: true, data: { messages } });
}
