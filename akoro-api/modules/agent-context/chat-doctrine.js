/**
 * modules/agent-context/chat-doctrine.js — the Agent Chat prompt seam
 * (Context Layer Adoption P1). The STATIC doctrine of the /agent route and
 * the voice bootstrap — persona, formatting contract, role addenda, Think/
 * Research modes, agent-chat operating rules, tool-observation and HITL
 * guides — loads VERBATIM from the akoro-agent/ workspace, byte-identical to
 * the pre-migration chat.js literals (pinned by
 * agentContext.golden.chat.test.mjs).
 *
 * This module is deliberately side-effect-free (only the context manager):
 * tests import it directly, and chat.js/voice compose it with their dynamic
 * truth (current time, grounding, memory, scratchpad, attachments), which
 * never lives in files.
 */

import { loadDoctrine } from "./context-manager.js";
import { renderPersona } from "./template.js";
import { studentPersonality, personalityBand } from "./personas/student.js";

export async function tutorSystemPrompt({ agentName = "Akoro", role = "student" } = {}) {
  const base = (await loadDoctrine("channels/CHAT.md")).replaceAll("{{agentName}}", agentName);
  if (role === "instructor") return base + "\n" + (await loadDoctrine("channels/CHAT_INSTRUCTOR.md"));
  return base + "\n" + (await loadDoctrine("channels/CHAT_STUDENT.md"));
}

/**
 * assembleChatDoctrine — the STATIC part of the Agent Chat system prompt,
 * in the pre-migration concatenation order (the golden fixture pins the
 * bytes; the time context keeps its position right after the persona).
 * The durable-memory guide loads only when memory actually loaded — the
 * agent historically DENIED having memory because nothing in the prompt
 * owned the ability (see memory/DURABLE_MEMORY.md).
 */
/** identity/PROTEGE.md with the agent's own facts; defaults when the agent isn't known yet. */
export async function protegeIdentity({ agentName = "Akoro", learnerName = "the learner", level = 1, sessions = 0 } = {}) {
  const band = personalityBand({ level, sessions });
  // Each band's template takes exactly its own values (the renderer rejects extras).
  const values = { FRESH: {}, EARLY: { sessions }, SOLID: { level, sessions }, ADVANCED: { level, sessions } }[band];
  const personality = await studentPersonality(band, values);
  return renderPersona("identity/PROTEGE.md", { agentName, learnerName, level, sessions, personality: personality.trim() });
}

export async function assembleChatDoctrine({
  agentName = "Akoro", role = "student", think = false, research = false, durableMemory = false, currentTimeContext = "",
  protege = null,
} = {}) {
  let system = await tutorSystemPrompt({ agentName, role });
  // P2b deliberate adoption: the platform SOUL opens the student prompt —
  // identity before channel, "persona layers compose ON TOP of the shared
  // soul" — and the curated agent wisdom (memory/MEMORY.md) joins the memory
  // family. Instructor doctrine keeps its own voice.
  if (role === "student") {
    // The learner's chat speaks as THEIR protégé from the first lines — the
    // shared soul, then who this agent is (name, whose, level, personality
    // band) — not a tutor corrected by protégé rules at the end.
    system = (await loadDoctrine("identity/SOUL.md")) + "\n\n" + (await protegeIdentity({ agentName, ...(protege || {}) })) + "\n\n" + system;
    // Exam-prep adoption (Master Plan §4.8–4.9 + Akoro-Exam-Prep-Confidence-
    // Loop.md): test preparation is a study-prep session, never a chat
    // questionnaire. The live 2026-10-01 transcript had the model interview
    // the learner for topics/format/duration while start_study_prep_session
    // sat unused in the tool list.
    system += "\n\n" + (await loadDoctrine("channels/STUDY_PREP.md"));
  }
  system += currentTimeContext;
  if (think) system += "\n\n" + (await loadDoctrine("channels/MODE_THINK.md"));
  if (research) system += "\n\n" + (await loadDoctrine("channels/MODE_RESEARCH.md"));
  system += "\n\n" + (await loadDoctrine("policies/AGENT_CHAT.md"));
  system += "\n\n" + (await loadDoctrine(role === "student" ? "policies/TOOL_OBSERVATIONS.md" : "policies/HITL_DRAFTS.md"));
  if (role === "student") system += "\n\n" + (await loadDoctrine("memory/MEMORY.md"));
  if (durableMemory && role === "student") system += "\n\n" + (await loadDoctrine("memory/DURABLE_MEMORY.md"));
  return system;
}
