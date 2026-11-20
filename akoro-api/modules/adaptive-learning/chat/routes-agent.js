import express from "express";
import {
  CHAT_SESSION_ID, CHAT_TURN_ID,
  activeTurnStops, turnStopKey,
  activeSessionTurns, decisionContinuations,
} from "./runtime-state.js";
import { publicModelList, pickerInfo, pickerEnabled } from "../../../lib/modelCatalogue.js";
import { allowedModelsFor } from "../../../lib/modelTiers.js";
import { prepareTurn, modelPicks, supabaseThreads } from "./turn-prepare.js";
import { answerTurn, setDecisionContinuationScheduler } from "./turn-answer.js";
import { reportAgentActivity } from "../../../lib/agentActivity.js";
import db from "../../../db.js";

const router = express.Router();

// ■ Stop for a running Agent Chat turn — owner-scoped by the token identity.
router.post("/agent/stop", (req, res) => {
  const turnId = String(req.body?.turnId ?? "");
  if (!CHAT_TURN_ID.test(turnId)) return res.status(422).json({ error: "turnId is invalid" });
  const entry = activeTurnStops.get(turnStopKey(req.user.id, turnId));
  if (entry) entry.stop = true;
  return res.json({ success: true, stopping: Boolean(entry) });
});

// The one learner Agent Chat response authority. It owns direct tutoring,
// attachments/grounding/modes and the authorised tool loop; the browser never
// selects a response endpoint based on its own intent detection.
/**
 * GET /api/adaptive/chat/models — the model behind each chat mode, for the
 * Agent Chat's model switch. Read-only: the app still sends a MODE
 * ("default" | "think" | "research"), never a model id, so a browser can't
 * ask for a model this deployment doesn't route. Names come from this
 * server's own configuration (OPENAI_MODEL / _THINK_ / _RESEARCH_).
 */
// Modes run on the learner's chosen model now; no model is advertised per
// mode. `model` is kept null for older clients that still render it.
export const chatModelMenu = () => ([
  { id: "default",  model: null, kind: "Default",  description: "Quick, grounded answers for everyday study." },
  { id: "think",    model: null, kind: "Thinking", description: "Reasons step by step before answering — best for hard problems." },
  { id: "research", model: null, kind: "Research", description: "A deeper pass with more syllabus and past-question references." },
]);
router.get("/models", async (req, res) => {
  res.set("Cache-Control", "private, max-age=300");
  // modes: the chat's modes and their models; models: the catalogue a
  // learner may pick for the standard mode (Grand Plan §7.11) — each says
  // whether this server can use it, or why not ("coming soon"), and its cost
  // against the default; picker: whether the §7.11.5 picker is on here and,
  // when it is, the payer's tier (§7.11.5a) — a model outside its list is
  // listed as locked to a plan.
  const tier = pickerEnabled() && req.user?.id ? await allowedModelsFor(req.user.id).catch(() => null) : null;
  // saved: the learner's latest pick on any of their chats (Scenario K) — the
  // app opens on it on every device, so it is never cached when there is one.
  const saved = pickerEnabled() && req.user?.id ? await savedPickFor(req.user.id) : null;
  if (saved) res.set("Cache-Control", "private, no-cache");
  res.json({
    modes: chatModelMenu(),
    models: publicModelList(process.env, { allowedModels: tier?.allowedModels ?? null }),
    picker: { ...pickerInfo(), ...(tier ? { tier: tier.tier?.name || null, tierSource: tier.source, allowedModels: tier.allowedModels } : {}), ...(saved ? { saved } : {}) },
  });
});

/** The learner's latest saved pick → { modelId, label, conversationId, changedAt } | null. Never throws. */
async function savedPickFor(learnerId) {
  try {
    const pick = await (await modelPicks()).learnerPick(learnerId);
    return pick?.changedAt ? { modelId: pick.modelId ?? null, label: pick.label || null, conversationId: pick.conversationId || null, changedAt: pick.changedAt } : null;
  } catch { return null; }
}

// GET /sessions/:id/model — the pick saved on this chat ({} when never set).
router.get("/sessions/:id/model", async (req, res) => {
  try {
    if (!CHAT_SESSION_ID.test(String(req.params.id))) return res.status(422).json({ error: "id is invalid" });
    const thread = await supabaseThreads(db).get(req.params.id, req.user.id);
    if (!thread) return res.status(404).json({ error: "Session not found" });
    res.set("Cache-Control", "no-store");
    res.json({ success: true, modelSelection: thread.selection || {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /sessions/:id/model { modelId } — save the chat's pick (null = the
// default). It applies from the next message and also reaches the learner's
// open Study Prep / Teaching workflows (a model.changed event on each).
router.put("/sessions/:id/model", async (req, res) => {
  try {
    if (!CHAT_SESSION_ID.test(String(req.params.id))) return res.status(422).json({ error: "id is invalid" });
    if (!pickerEnabled()) return res.status(409).json({ code: "picker_off", error: "Model choice is off on this server" });
    const result = await (await modelPicks()).saveThreadPick({ learnerId: req.user.id, conversationId: req.params.id, modelId: req.body?.modelId ?? null });
    res.json({ success: true, ...result });
  } catch (err) {
    if (err?.code && err.status) return res.status(err.status).json({ code: err.code, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// The /agent turn is two halves: prepareTurn validates the request, loads the
// context and assembles the prompt; answerTurn runs the tool loop and writes
// the reply. chat.js keeps the route registration and the tap continuation.
async function agentChatHandler(req, res) {
  const ctx = await prepareTurn(req, res);
  await answerTurn(ctx);
}

router.post("/agent", agentChatHandler);
setDecisionContinuationScheduler(scheduleDecisionContinuation);

// ── Tap-triggered continuation (Option A — Matt, 2026-11-17) ───────────────
// A card tap records the decision only. When no turn is live in that chat,
// the tap itself resumes the SAME flow (headless, below): the turn opens
// with the decision already injected, the agent applies it with
// await_decision and narrates the outcome. The cue is an internal event for
// the model only — no user message is created or saved for the tap, so the
// chat gains only the agent's narration, appended under the card (Matt,
// 2026-11-17: "the tap should not send a new prompt"). The learner sends
// nothing, and the server posts nothing of its own into the chat. A tap that lands
// mid-turn is caught by the live turn's await_decision poll, or by the
// end-of-turn recheck in the handler's finally above.
// Kill switch: AKORO_TAP_CONTINUATION=false restores the old behaviour
// (a late tap waits for the learner's next message in that chat).

/** A sink response for a headless turn: the handler runs in full (prompt,
 * tools, persist) and its stream events go nowhere; the saved reply — the
 * agent's own narration — is the outcome the learner reads. */
function headlessRes() {
  const res = { statusCode: 200, destroyed: false, writableEnded: false, body: null,
    on: () => res, once: () => res, writeHead: () => res, write: () => true,
    end: () => { res.writableEnded = true; return res; },
    status: (code) => { res.statusCode = code; return res; },
    json: (payload) => { res.body = payload; res.writableEnded = true; return res; } };
  return res;
}

export function scheduleDecisionContinuation({ userId, user = null, sessionId } = {}) {
  if (process.env.AKORO_TAP_CONTINUATION === "false") return;
  if (!userId || !sessionId || !CHAT_SESSION_ID.test(sessionId)) return;
  if (decisionContinuations.has(sessionId) || activeSessionTurns.get(sessionId)) return;
  const run = (async () => {
    try {
      const { listConfirmedDecisions } = await import("./handlers-merged.js");
      const waiting = await listConfirmedDecisions(userId, sessionId).catch(() => []);
      if (!waiting.length) return;
      reportAgentActivity(userId, "Finishing what you approved…");
      const req = {
        user: user || { id: userId, role: "student" },
        body: { message: "[Card tap] The learner tapped Allow on the pending card in this chat — the decision is already recorded. Apply it now and narrate the outcome.", conversationId: sessionId, turnId: `tap${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}` },
        query: {}, headers: {}, internalContinuation: true,
      };
      await agentChatHandler(req, headlessRes());
      // Nudge the app: the outcome message is saved — show it now.
      try { global.io?.to(`user:${userId}`).emit("agent_chat_updated", { sessionId }); } catch { /* saved either way */ }
    } catch (e) {
      console.warn("[decision-continuation] failed:", e?.message || e);
    } finally {
      reportAgentActivity(userId, null);
      decisionContinuations.delete(sessionId);
    }
  })();
  decisionContinuations.set(sessionId, run);
}

export default router;
