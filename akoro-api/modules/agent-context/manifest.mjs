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
  // After the plan is approved: the agent's short turns (wakes, 2026-10-19).
  wake: Object.freeze({
    mode: "joined",
    consumer: "study-prep wake runner — the agent's turns after the plan is approved",
    files: Object.freeze(["AGENT.md", "reasoning/WAKES.md", "learning/TEACHING.md", "learning/ASSESSMENT.md", "policies/EDUCATION_RULES.md"]),
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
      "identity/SOUL.md", "channels/CHAT.md", "channels/CHAT_STUDENT.md", "channels/STUDY_PREP.md", "channels/MODE_THINK.md", "channels/MODE_RESEARCH.md",
      "policies/AGENT_CHAT.md", "policies/TOOL_OBSERVATIONS.md", "memory/MEMORY.md", "memory/DURABLE_MEMORY.md",
    ]),
  }),
  // The learner's Agent Chat speaks as their protégé (protege.js): appended
  // after the student doctrine with the taught knowledge for the turn.
  chat_protege: Object.freeze({
    mode: "verbatim",
    consumer: "agent chat /agent route — student role, protégé rules (taught knowledge, the teaching guide)",
    files: Object.freeze(["identity/PROTEGE.md", "policies/PROTEGE.md"]),
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

  // ── persona agents (verbatim — P2, byte-identical to the pre-migration
  //    literals; pinned by agentContext.golden.personas.test.mjs). One file
  //    per prompt role: personas are directories, not single files, because
  //    each agent has several operational prompts and the 8 KB file budget
  //    forbids gluing them together.
  persona_nana: Object.freeze({
    mode: "verbatim",
    consumer: "NaNa Esumai learning guide (agents/nana-esumai/guide.js)",
    files: Object.freeze([
      "agents/nana-esumai/KNOWLEDGE_MAP.md", "agents/nana-esumai/OBJECTIVES.md",
      "agents/nana-esumai/OPEN_SUBTOPIC.md", "agents/nana-esumai/COACH_TURN.md",
      "agents/nana-esumai/PUSH_FURTHER.md", "agents/nana-esumai/EVALUATE_SUBTOPIC.md",
      "agents/nana-esumai/MUST_KNOW.md", "agents/nana-esumai/TIP_DECISION.md",
      "agents/nana-esumai/EVIDENCE_INSTRUCTION.md", "agents/nana-esumai/CLASS_ANALYTICS.md",
      "agents/nana-esumai/EVALUATE_SESSION.md",
    ]),
  }),
  persona_sargeant: Object.freeze({
    mode: "verbatim",
    consumer: "Sargeant assessment gate + SergeantProctor (agents/sargeant/*.js)",
    files: Object.freeze([
      "agents/sargeant/ASSESSMENT_QUESTIONS.md", "agents/sargeant/ASSESSMENT_EVALUATE.md",
      "agents/sargeant/ASSESSMENT_VERDICT.md", "agents/sargeant/ASSESSMENT_DRIFT.md",
      "agents/sargeant/PROCTOR_QUESTIONS.md", "agents/sargeant/PROCTOR_EVALUATE.md",
      "agents/sargeant/PROCTOR_HINT.md", "agents/sargeant/PROCTOR_VERDICT.md",
    ]),
  }),
  persona_student: Object.freeze({
    mode: "verbatim",
    consumer: "shared Student-AI-clone reply + analysis (agents/base-orchestrator.js)",
    files: Object.freeze([
      "identity/SOUL.md", "agents/student-clone/REPLY.md", "agents/student-clone/ANALYZE.md",
    ]),
  }),

  // ── P2b flagship: the learner's own Student Agent (protégé). The templates
  //    own the persona voice; subject-scoped level, RAG context, teaching
  //    evidence and pace stay code-assembled dynamic truth.
  persona_student_agent: Object.freeze({
    mode: "verbatim",
    consumer: "Student Agent protégé (agents/student/agent.js) — P2b flagship persona",
    files: Object.freeze([
      "identity/SOUL.md", "agents/student/REPLY.md", "agents/student/EVIDENCE.md",
      "agents/student/ANALYZE.md", "agents/student/EXTRACT.md",
      "agents/student/DECAY_MUST_KNOW.md", "agents/student/MERGE_NOTES.md",
      "agents/student/personality/NEW_SUBJECT.md", "agents/student/personality/FRESH.md",
      "agents/student/personality/EARLY.md", "agents/student/personality/SOLID.md",
      "agents/student/personality/ADVANCED.md",
    ]),
  }),

  // ── P2b trained shell: platform doctrine composes FIRST around a teacher's
  //    own DB-configured style (D3 — the layer wraps it, never replaces it).
  //    The three auxiliary judges (must-know fallback, boundary, session
  //    evaluation) are cold JSON contracts and deliberately carry no shell.
  persona_trained: Object.freeze({
    mode: "verbatim",
    consumer: "Trained teacher agents (agents/trained/*, training/agentPromptBuilder.js) — P2b TRAINED_SHELL",
    files: Object.freeze([
      "identity/SOUL.md", "agents/trained/SHELL.md", "agents/trained/GUIDE_TIP.md", "agents/trained/CONTROL_DRIFT.md",
      "agents/trained/STUDENT_REPLY.md", "agents/trained/MUST_KNOW.md", "agents/trained/BOUNDARY.md",
      "agents/trained/EVALUATE_SESSION.md",
    ]),
  }),
});

/** Workspace files no registered set loads yet — must be empty by P7 (D13). */
export const PENDING_ADOPTION = Object.freeze({});
// Empty since P2b: identity/SOUL.md now opens the chat_student doctrine and
// the student-voice persona replies (clone, protégé, trained), and
// memory/MEMORY.md (curated agent wisdom) composes into chat_student — its
// content (tools, syllabus rows, retests) is the learner chat agent's world.
// NaNa and Sargeant keep their own contractual personas: Sargeant is strict
// by contract, NaNa carries a complete persona of her own, and JSON judges
// stay cold.
