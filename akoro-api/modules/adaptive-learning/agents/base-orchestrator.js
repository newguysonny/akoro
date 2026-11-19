/**
 * agents/base-orchestrator.js
 *
 * Shared OpenAI client + BaseOrchestrator base class.
 * All agent orchestrators extend this.
 * Missing from original commit — recreated from usage patterns.
 */

import db     from "../../../db.js";
// P2 (Context Layer Adoption): prompts load VERBATIM from the akoro-agent/
// workspace — byte-identical to the pre-migration literals, pinned by
// agentContext.golden.personas.test.mjs.
import { buildStudentCloneReplyPrompt, buildStudentCloneAnalyzePrompt } from "../../agent-context/index.js";

// Import AND re-export the coin-metered client: every orchestrator/agent
// that imports `openai` from here is billed automatically (see
// lib/aiModel.js). Imported locally too because the shared helpers below
// call it — `export { x } from` alone does not create a local binding.
import { openai } from "../../../lib/aiModel.js";
export { openai };

export class BaseOrchestrator {
  constructor() {
    this.session = {
      agentId:        null,
      studentId:      null,
      topic:          null,
      phase:          "PHASE_1",
      mustKnowParts:  [],
      mustKnowIndex:  0,
      history:        [],
      turnCount:      0,
    };
  }

  /* ── Shared helpers ─────────────────────────────────────── */

  async _loadStudentAgent(agentId) {
    // try/catch, NOT .catch() — a Supabase builder is a thenable with no
    // .catch method, so chaining one throws synchronously before the query is
    // sent. Same defect as the decay path; it just had not been reached yet.
    let data = null;
    try {
      ({ data } = await db.schema("edu")
        .from("student_agents")
        .select("id, name, level, total_sessions, knowledge_score, subjects_learned")
        .eq("id", agentId)
        .maybeSingle());
    } catch (e) {
      console.warn("[orchestrator] student agent lookup failed:", e.message);
    }
    return data || { id: agentId, name: "Student Agent", level: 1, total_sessions: 0, knowledge_score: 0 };
  }

  async _generateStudentReply({ humanMessage, topic, understanding, confusion, history, phaseLabel }, onChunk = null) {
    const systemPrompt = await buildStudentCloneReplyPrompt({ topic, phaseLabel, understanding, confusion });

    const messages = [
      { role: "system",    content: systemPrompt },
      ...history.slice(-6).map(h => ({ role: h.role === "human_teacher" ? "user" : "assistant", content: h.content })),
      { role: "user",      content: humanMessage },
    ];

    if (onChunk) {
      const stream = await openai.chat.completions.create({ model: "gpt-4.1-mini", temperature: 0.6, stream: true, messages });
      let full = "";
      for await (const chunk of stream) { const d = chunk.choices[0]?.delta?.content || ""; if (d) { full += d; onChunk(d); } }
      return full;
    }
    const res = await openai.chat.completions.create({ model: "gpt-4.1-mini", temperature: 0.6, messages });
    return res.choices[0].message.content;
  }

  async _analyzeUnderstanding(studentReply, topic, history) {
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: await buildStudentCloneAnalyzePrompt() },
        { role: "user",   content: JSON.stringify({ topic, studentReply, recentHistory: history.slice(-4) }) },
      ],
    });
    return JSON.parse(res.choices[0].message.content);
  }

  async _streamOrComplete(systemPrompt, userContent, temperature = 0.4, onChunk = null) {
    const messages = [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }];
    if (onChunk) {
      const stream = await openai.chat.completions.create({ model: "gpt-4.1-mini", temperature, stream: true, messages });
      let full = "";
      for await (const chunk of stream) { const d = chunk.choices[0]?.delta?.content || ""; if (d) { full += d; onChunk(d); } }
      return full;
    }
    const res = await openai.chat.completions.create({ model: "gpt-4.1-mini", temperature, messages });
    return res.choices[0].message.content;
  }

  _getCurrentPhaseLabel(phase) {
    const labels = {
      PHASE_1: "Phase 1 — What does the Student Agent already know?",
      PHASE_2: "Phase 2 — Must-know parts",
      PHASE_3: "Phase 3 — Student Agent teaches it back",
      PHASE_4: "Phase 4 — Push a little further",
      MASTERY: "Mastery",
    };
    return labels[phase] || phase;
  }

  _getInitialPhase() { return "PHASE_1"; }

  _friendlyAction(action, analysis) {
    const map = {
      DIG_DEEPER:     "Dig deeper",
      CLEAR_MISTAKE:  "Clear a misconception",
      NAME_IT:        "Name the concept",
      NEXT_SUBTOPIC:  "Move to next concept",
      ONE_MORE_PUSH:  "One more push",
      USE_ANALOGY:    "Use an analogy",
      GAP_CLOSED:     "Gap closed ✓",
      TRIGGER_RECALL: "Trigger recall",
      CHALLENGE:      "Challenge understanding",
      MASTERY:        "Mastery reached 🎉",
    };
    if (analysis?.misconceptionDetected && !analysis?.misconceptionCleared) return "Clear misconception ⚠️";
    return map[action] || action || "Continue";
  }
}
