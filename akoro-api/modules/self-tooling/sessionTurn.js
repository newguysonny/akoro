/**
 * modules/self-tooling/sessionTurn.js — one turn of a MODE (session) tool
 * inside its OWN UI (2026-11-27, Matt's direction: the learning happens in
 * the session's own screen, not in the main chat — and the session screen
 * is itself a CHAT: a real conversation with the tutor, per the approved
 * planning preview).
 *
 * The learner opens the session from their dashboard sessions list; the
 * screen renders the tool's presentation over its state (the overview:
 * hero, stepper, key points) plus a chat transcript and the app's
 * composer. Each learner message lands here: the model replies as the
 * tutor under the tool's steer, names at most one declared action (whose
 * declarative effects the server applies via modeSpec.applyModeAction),
 * and the exchange is appended to state.transcript so the conversation —
 * like the progress — persists and resumes from the dashboard.
 * state.ui carries the live step: { say (the tutor's latest message),
 * prompt (composer placeholder), bar (short phase/status line),
 * input: short | long | none, action, button }.
 *
 * No generated code runs; state moves only through declared effects, the
 * same guarantee as the chat path's run_mode_action.
 */
import db from "../../db.js";
import { openai } from "../../lib/aiModel.js";
import { applyModeAction } from "./modeSpec.js";
import { ensureToolState } from "./toolState.js";
import { parseBuilderJson } from "./builder.js";

const edu = () => db.schema("edu");
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

function sanitizeUi(raw, def, fallbackSay) {
  const ui = raw && typeof raw === "object" ? raw : {};
  const names = new Set((def.actions || []).map((a) => a.name));
  const input = ["short", "long", "none"].includes(ui.input) ? ui.input : "long";
  return {
    say: str(ui.say, 2000) || str(fallbackSay, 2000),
    prompt: str(ui.prompt, 400),
    bar: str(ui.bar, 90),
    input,
    action: names.has(ui.action) ? ui.action : null,
    button: str(ui.button, 40) || (input === "none" ? "" : "Send"),
  };
}

const TRANSCRIPT_CAP = 80;
function pushMsg(transcript, role, text) {
  const t = String(text || "").slice(0, 2000);
  if (!t) return transcript;
  const next = [...transcript, { role, text: t }];
  return next.length > TRANSCRIPT_CAP ? next.slice(next.length - TRANSCRIPT_CAP) : next;
}

/**
 * Run one UI turn of a session tool the learner owns (or a platform one).
 * → { state, say } | throws an Error with .status.
 */
export async function runSessionTurn({ learnerId, toolId, text = "", action = null }) {
  const { data: t } = await edu().from("agent_tools")
    .select("id, name, label, status, definition, usage_count")
    .eq("id", toolId).or(`owner_id.eq.${learnerId},scope.eq.platform`)
    .in("status", ["active", "disabled"]).maybeSingle();
  if (!t) throw Object.assign(new Error("Session not found"), { status: 404 });
  if (t.status !== "active") throw Object.assign(new Error("This session tool is turned off — turn it back on in Settings → Agent → My tools."), { status: 409 });
  const def = t.definition || {};
  if (def.kind !== "mode") throw Object.assign(new Error("That tool is not a session tool."), { status: 400 });

  const state = await ensureToolState(learnerId, t, {});
  const submission = { action: typeof action === "string" ? action : null, text: String(text || "").slice(0, 8000) };

  // The conversation so far. Tools built before the transcript existed
  // seed it from their current step's say, so their screen opens mid-
  // conversation instead of blank.
  let transcript = Array.isArray(state.transcript)
    ? state.transcript.filter((m) => m && (m.role === "agent" || m.role === "learner") && typeof m.text === "string")
    : (state.ui?.say ? [{ role: "agent", text: String(state.ui.say).slice(0, 2000) }] : []);
  transcript = pushMsg(transcript, "learner", submission.text);
  const { transcript: _omit, ...stateForModel } = state;

  const system = [
    "You are the tutor in a chat-based learning session that lives in its own screen in the Akoro app (not the main chat). The learner sees the session overview (the presentation over the state below) and a chat transcript with a composer; you are the voice in that transcript. Each learner message must advance the session by exactly ONE step, following the session's steer.",
    "",
    "THE STEER (the session's protocol — follow it exactly):",
    String(def.steer || ""),
    "",
    "RULES:",
    "- Reply like a tutor in a conversation: warm, direct, in your voice. Your message teaches or responds, then asks at most ONE question or gives one clear next task — never a wall of steps.",
    "- Evaluate the learner's message against the material in the state. Score or judge ONLY what they actually wrote.",
    "- Never invent the learner's side: no made-up answers, no recall text they didn't write.",
    "- Never reveal content whose state is \"hidden\" while the session is in a recall phase.",
    "- If a declared action fits this step, name ONE in \"action\" (with its args) — the server applies its effects to the state. If none fits, action is null.",
    "- ALWAYS return \"ui\": { \"say\": your chat message for this turn (feedback on their message and/or the next teaching), \"prompt\": a short composer placeholder for their reply (e.g. \"Recall from memory…\"; omit when input is \"none\"), \"bar\": a short status line for the session's phase (e.g. \"Book closed — recall from memory\", \"Learn — part 2 of 5\"), \"input\": \"short\" | \"long\" | \"none\", \"action\": the declared action that will handle the NEXT message (or null), \"button\": a short label }.",
    "- When the session is complete, return ui with input \"none\" and a closing \"say\".",
    "- Answer with ONE JSON object: { \"say\": string, \"action\": { \"name\": string, \"args\": object } | null, \"ui\": { ... } }. No other text.",
  ].join("\n");

  const resp = await openai.chat.completions.create({
    __role: "builder", temperature: 0.2, max_tokens: 1800,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify({ state: stateForModel, conversation: transcript.slice(-16), actions: (def.actions || []).map((a) => ({ name: a.name, description: a.description, params: a.params || {} })), submission }) },
    ],
    __feature: "self_tooling", __userId: learnerId,
  });
  const parsed = parseBuilderJson(resp.choices?.[0]?.message?.content || "");
  if (!parsed) throw Object.assign(new Error("The session couldn't take that step just now — try again."), { status: 502 });

  let next = state;
  const wanted = parsed.action && typeof parsed.action === "object" ? parsed.action : null;
  if (wanted && (def.actions || []).some((a) => a.name === wanted.name)) {
    const out = applyModeAction(def, state, wanted.name, wanted.args && typeof wanted.args === "object" ? wanted.args : {});
    if (out.ok) next = out.state;
  }
  const ui = sanitizeUi(parsed.ui, def, parsed.say);
  transcript = pushMsg(transcript, "agent", ui.say);
  next = { ...next, ui, transcript };

  const { error } = await edu().from("agent_tool_state")
    .update({ state: next, updated_at: new Date().toISOString() })
    .eq("tool_id", t.id).eq("owner_id", learnerId);
  if (error) throw Object.assign(new Error(`Couldn't save the session: ${error.message}`), { status: 500 });
  await edu().from("agent_tools")
    .update({ usage_count: (t.usage_count || 0) + 1, last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", t.id);
  return { state: next, say: ui.say };
}
