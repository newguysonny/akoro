/**
 * modules/agent-context/manifest.mjs — the registry of context-layer
 * selection sets (Context Layer Adoption mini-plan §3.3, P0).
 *
 * Every LLM-facing doctrine file the platform may load is declared here, in a
 * set, with its consumer. The manifest is data: wiring (which files an
 * operation loads) is behaviour, so changes here carry contract tests
 * (agentContext.manifest.contract.test.mjs) and the boot preflight.
 *
 * Modes:
 *   joined   — the manager assembles the set S3-style (headers + --- joins)
 *              via loadContext(setName). Study-prep agent-loop steps.
 *   verbatim — the surface loads each file with loadDoctrine(file) and
 *              concatenates in its own order (byte-identical migration gates,
 *              mini-plan D1). Agent chat + voice.
 *
 * Semantics (D6): files listed in a set are REQUIRED — a missing one fails
 * the boot preflight and throws at load time, because agent behaviour must
 * never silently change. `extra` files passed to loadContext remain optional.
 *
 * PENDING_ADOPTION (D13 orphan check): workspace files no set loads yet.
 * Every entry must name the phase that will adopt it; the contract test
 * pins this list EXACTLY so additions are conscious. Must be empty by P7.
 */

export const MANIFEST_VERSION = 1;

export const SETS = Object.freeze({
  // ── study-prep agent loop (joined — shipped, byte-pinned by study-prep tests)
  planning: Object.freeze({
    mode: "joined",
    consumer: "study-prep agent-loop — planning step",
    files: Object.freeze(["AGENT.md", "learning/LEARNING.md", "reasoning/PLANNING.md", "policies/EDUCATION_RULES.md"]),
  }),
  research: Object.freeze({
    mode: "joined",
    consumer: "study-prep agent-loop — research step",
    files: Object.freeze(["AGENT.md", "reasoning/RESEARCH.md", "reasoning/INSPECTION.md", "policies/EDUCATION_RULES.md"]),
  }),
  teaching: Object.freeze({
    mode: "joined",
    consumer: "study-prep agent-loop — teaching step",
    files: Object.freeze(["AGENT.md", "learning/LEARNING.md", "learning/TEACHING.md", "learning/MASTERY.md"]),
  }),
  reflection: Object.freeze({
    mode: "joined",
    consumer: "study-prep agent-loop — reflection step",
    files: Object.freeze(["AGENT.md", "learning/ASSESSMENT.md", "learning/MASTERY.md", "reasoning/REASONING.md"]),
  }),
  strategies: Object.freeze({
    mode: "joined",
    consumer: "study-prep agent-loop — strategy selection",
    files: Object.freeze(["AGENT.md", "strategies/STRATEGIES.md", "policies/TOOL_RULES.md"]),
  }),
  safety: Object.freeze({
    mode: "joined",
    consumer: "study-prep agent-loop — safety-critical steps",
    files: Object.freeze(["AGENT.md", "policies/SAFETY.md"]),
  }),

  // ── agent chat + voice (verbatim — P1, byte-identical to the pre-migration
  //    literals; pinned by agentContext.golden.chat.test.mjs)
  chat_student: Object.freeze({
    mode: "verbatim",
    consumer: "agent chat /agent route — student role",
    files: Object.freeze([
      "channels/CHAT.md", "channels/CHAT_STUDENT.md", "channels/MODE_THINK.md", "channels/MODE_RESEARCH.md",
      "policies/AGENT_CHAT.md", "policies/TOOL_OBSERVATIONS.md", "memory/DURABLE_MEMORY.md",
    ]),
  }),
  chat_instructor: Object.freeze({
    mode: "verbatim",
    consumer: "agent chat /agent route — instructor copilot",
    files: Object.freeze([
      "channels/CHAT.md", "channels/CHAT_INSTRUCTOR.md", "channels/MODE_THINK.md", "channels/MODE_RESEARCH.md",
      "policies/AGENT_CHAT.md", "policies/HITL_DRAFTS.md",
    ]),
  }),
  voice_session: Object.freeze({
    mode: "verbatim",
    consumer: "voice session bootstrap (both roles) — reuses the chat persona + speech channel",
    files: Object.freeze([
      "channels/CHAT.md", "channels/CHAT_STUDENT.md", "channels/CHAT_INSTRUCTOR.md", "channels/SPEECH.md",
    ]),
  }),
});

/** Workspace files no registered set loads yet — must be empty by P7 (D13). */
export const PENDING_ADOPTION = Object.freeze({
  "identity/SOUL.md": "P2 — persona agents compose the platform soul",
  "memory/MEMORY.md": "P2 — student-agent persona set (curated agent wisdom)",
});
