// =============================================================
// agents/student/opening.js — the session's opening prompt and the typed
// blocks the UI renders on the first turn.
//
// The must-know parts are this engine's "objectives" checklist; the first
// part is the opening subtopic. Built from real data — no fabricated content.
// The technical workflow phase, cognitive percentages, and private
// boundary/control instructions stay in server state.
// =============================================================

import { openingIdeas } from "../../teaching-session/guideIdeas.js";

/** The first turn's prompt text and blocks for a fresh or decay session. */
export function buildOpening({ topic, isDecaySession, mustKnow = [], index = 0, knowledgeMap = [], subject = "", guideName = "Guide", guideEmoji = "🧠" }) {
  // This remains as a textual fallback for older clients. Keep it learner
  // facing: the technical workflow phase, cognitive percentages, and private
  // boundary/control instructions are represented only in server state.
  const openingPrompt = isDecaySession
    ? `Let's reinforce ${topic}. Re-teach the current idea to your agent and build on what you already know.`
    : `Let's teach ${topic}. Start with the current idea and explain it in your own words.`;

  const openGuideText = isDecaySession
    ? `Let's reinforce ${topic}. Re-teach the current idea to your agent and I'll guide you one step at a time.`
    : `Let's teach ${topic} to your agent. Start by explaining the current idea in your own words.`;

  const openingBlocks = [
    {
      // The must-know parts ride ON the header now.
      //
      // They used to be rendered twice: once as the header's progress bar and
      // again, in full, as a separate "Objectives" checklist directly beneath
      // it. Same array, same order, same length — the checklist was the bar
      // spelled out. The header can page through them instead.
      type:     "subtopic-hdr",
      subtopic: mustKnow[index] || topic,
      items:    mustKnow,
      // Parallel to items — same order, same length. Empty for a
      // teacher-authored scheme of work, where the ordering is theirs and
      // needs no explanation from us.
      map:      knowledgeMap,
      idx:      index,
      total:    mustKnow.length || 1,
      topic,
      subject,
    },
    {
      // The guide opens with ideas for the learner's first message (pills), not a message of its own.
      type:             "guide-ideas",
      agent:            guideName,
      emoji:            guideEmoji,
      hint:             openGuideText,
      ideas:            openingIdeas(topic, { review: isDecaySession }),   // the topic reads naturally; an objective's label is a sentence
    },
  ];

  return { openingPrompt, openingBlocks };
}
