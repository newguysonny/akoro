/**
 * teaching-session/guideIdeas.js — the teaching guide speaks in IDEAS, not
 * messages. A teaching session is the human and their protégé; the guide's
 * help is 2-3 tappable "say this next" pills under the protégé's latest reply
 * (a tap fills the message box), like the Ideas row in the instructor chat.
 *
 * The guide's tip model is asked for `suggestions` (TIP_DECISION.md /
 * GUIDE_TIP.md); when it sends none, or too few, the next move it chose fills
 * in so the learner is never left without a next step.
 */

const MAX = 3;

// By the guide's chosen next move: the human's next message, in their voice.
const BY_MOVE = {
  DIG_DEEPER:     ["Can you give me an example of {c}?", "Why do you think that happens?"],
  CLEAR_MISTAKE:  ["Let's check that — what does {c} really mean?", "Here's the right idea: let me explain it again."],
  NAME_IT:        ["The word for that is {c} — can you use it?", "Say it back to me using the right word."],
  NEXT_SUBTOPIC:  ["Great — now let's move on to the next idea.", "Sum up {c} in one sentence before we move on."],
  ONE_MORE_PUSH:  ["What would happen if we changed one thing?", "Can you explain {c} to a younger student?"],
  USE_ANALOGY:    ["Picture {c} like something at home — what's it like?", "Here's an everyday example of {c}."],
  GAP_CLOSED:     ["Nice! Explain {c} back to me in your own words.", "Quick check: what's the most important part of {c}?"],
  TRIGGER_RECALL: ["Do you remember what we said about {c}?", "Tell me {c} again without looking."],
  CHALLENGE:      ["Here's a challenge: where do you see {c} in real life?", "What if it were the other way round?"],
  MASTERY:        ["Teach {c} back to me like you're the teacher.", "What would you ask to test someone on {c}?"],
};
const DEFAULT = ["Explain {c} back to me in your own words.", "Can you give me an everyday example of {c}?", "What would happen if we changed one thing?"];

const fill = (s, concept) => s.replace(/\{c\}/g, concept || "this");
const clean = (s) => String(s || "").replace(/^[\s"'“”‘’\-•*\d.)]+|["'“”‘’\s]+$/g, "").replace(/\s+/g, " ").trim();

/** PURE: the guide's ideas for the learner's next message. → [string] (2-3) */
export function guideIdeas(suggestions, { nextAction = null, concept = "" } = {}) {
  const out = [];
  const seen = new Set();
  const add = (s) => {
    const t = clean(s);
    const key = t.toLowerCase();
    if (t.length < 3 || t.length > 140 || seen.has(key) || out.length >= MAX) return;
    seen.add(key); out.push(t);
  };
  for (const s of Array.isArray(suggestions) ? suggestions : []) add(s);
  if (out.length < 2) for (const s of [...(BY_MOVE[nextAction] || []), ...DEFAULT]) add(fill(s, concept));
  return out;
}

/** PURE: an objective's label as a phrase ("What a plant is made of: cells…" → "what a plant is made of"). */
export function shortConcept(label) {
  const t = String(label || "").split(":")[0].trim();
  return /^(what|how|why|where|when|which)\b/i.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

/** PURE: the ideas a session opens with — before the protégé has said anything. */
export function openingIdeas(concept, { review = false } = {}) {
  const c = concept || "this";
  return review
    ? [`Do you remember what ${c} is?`, `Let me explain ${c} again in my own words.`, `Tell me one thing you remember about ${c}.`]
    : [`What do you already know about ${c}?`, `Let me explain ${c} in my own words.`, `Can you guess what ${c} means?`];
}
