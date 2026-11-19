/**
 * teaching-session/guideTeacher.js — NaNa as the teacher (learn_with_guide,
 * D24): the `guide.teach` persona tool of the agent-driven turn. The protégé
 * is never called in this mode; NaNa teaches the learner directly, in the move
 * the teaching agent chose (or the fallback's), and the learner's answers are
 * the evidence the gate reads.
 */
import { openai } from "../../../lib/aiModel.js";
import { getStrategy } from "../strategies/library.js";
import { guideTeachPrompt } from "./guideTeacherPrompt.js";

export { guideTeachPrompt };

/**
 * The chosen strategy's guide (akoro-agent/strategies/<id>.md, §7.7.1 step 5)
 * — only for a library strategy a Teaching session runs. Never fatal: no
 * guide means the prompt is exactly as before.
 */
export async function strategyGuideFor(strategy) {
  const s = getStrategy(strategy);
  if (!s || s.runsAs.executor !== "teaching") return null;
  try { return await (await import("../../agent-context/index.js")).loadDoctrine(s.guide); }
  catch (e) { console.warn("[guide teach] strategy guide:", e?.message || e); return null; }
}

/** NaNa's reply, streamed to onChunk when given. → text */
export async function guideTeach({ orchestrator, humanMessage, topic, part, move, focusConcept, phaseLabel, evidence, history, onChunk = null, modelPick = null }) {
  const system = guideTeachPrompt({
    guideName: orchestrator?.guideOrchestrator?.guide?.name || "NaNa Esumai",
    topic, part, move, focusConcept, phaseLabel, evidence, history,
    reference: orchestrator?.studentAgent?.referenceMaterial || null,
    strategy: orchestrator?.session?.strategy || null,
    strategyGuide: await strategyGuideFor(orchestrator?.session?.strategy),
    notes: orchestrator?.learnerNotes || [],
  });
  const messages = [{ role: "system", content: system }, { role: "user", content: humanMessage }];
  // NaNa is a persona: the learner's model pick (Scenario K) applies, billed at its price.
  const meta = { __role: "persona", ...(modelPick || {}), __feature: "teaching_guide", __userId: orchestrator?.studentId || null };
  if (onChunk) {
    const stream = await openai.chat.completions.create({ model: "gpt-4.1-mini", temperature: 0.5, stream: true, messages, ...meta });
    let full = "";
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || "";
      if (delta) { full += delta; onChunk(delta); }
    }
    return full.trim();
  }
  const res = await openai.chat.completions.create({ model: "gpt-4.1-mini", temperature: 0.5, messages, ...meta });
  return String(res.choices?.[0]?.message?.content || "").trim();
}
