/**
 * modules/adaptive-learning/protege.js — the learner's Agent Chat speaks as
 * their PROTÉGÉ: it knows what the learner has taught it, and nothing more.
 *
 * Every learner turn:
 *   loadTaughtKnowledge()   what the protégé was taught that relates to this
 *                           message (edu.agent_knowledge, similarity-matched),
 *                           plus the topics it has been taught at all
 *   renderTaughtContext()   that, as plain truth for the system prompt —
 *                           "here is what you were taught" or "you were NEVER
 *                           taught this"
 *
 * When it hasn't been taught (policies/PROTEGE.md):
 *   ask_to_be_taught        points to sources and asks the learner to teach it
 *                           — the app shows a "Teach me" button
 *   consult_teaching_guide  only when the learner insists: asks NaNa Esumai,
 *                           the teaching guide, and the reply is marked as the
 *                           guide's, never passed off as taught knowledge
 */

/** How close a taught fact must be to the message to count as "about this". */
export const PROTEGE_LIMITS = Object.freeze({
  minSimilarity: Number(process.env.PROTEGE_MIN_SIMILARITY) || 0.32,
  chunks: 6,
  chunkChars: 700,
  topics: 30,
  guideWords: 220,
});

const fuzzy = (confidence) => Number(confidence) < 0.4;

/**
 * What the protégé was taught that bears on this message.
 * deps: { findAgent(studentId) → {id}|null, retrieve(agentId, query, limit) → chunks[], listTopics(agentId) → [{topic, subject}] }
 * → { agentId, chunks: [{topic, subject, content, confidence, similarity}], topics: ["Biology: Photosynthesis", …], taughtAnything }
 */
export async function loadTaughtKnowledge({ studentId, query, deps }) {
  const agent = await deps.findAgent(studentId).catch(() => null);
  if (!agent?.id) return { agentId: null, chunks: [], topics: [], taughtAnything: false };
  const [raw, topicRows] = await Promise.all([
    String(query || "").trim() ? deps.retrieve(agent.id, query, PROTEGE_LIMITS.chunks * 2).catch(() => []) : Promise.resolve([]),
    deps.listTopics(agent.id).catch(() => []),
  ]);
  const chunks = (raw || [])
    .filter((c) => Number(c.similarity) >= PROTEGE_LIMITS.minSimilarity)
    .slice(0, PROTEGE_LIMITS.chunks)
    .map((c) => ({ topic: c.topic, subject: c.subject, content: String(c.content || "").slice(0, PROTEGE_LIMITS.chunkChars), confidence: Number(c.confidence ?? 0.5), similarity: Number(c.similarity) }));
  const seen = new Set();
  const topics = [];
  for (const r of topicRows || []) {
    const label = [r.subject, r.topic].filter(Boolean).join(": ");
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    topics.push(label);
    if (topics.length >= PROTEGE_LIMITS.topics) break;
  }
  return { agentId: agent.id, chunks, topics, taughtAnything: topics.length > 0 || chunks.length > 0 };
}

/** The taught knowledge as the system prompt's dynamic truth for this turn. */
export function renderTaughtContext({ chunks = [], topics = [], taughtAnything = false } = {}) {
  const lines = ["\n\n## What the learner has taught you (your ONLY subject knowledge)"];
  if (chunks.length) {
    lines.push("Taught knowledge related to this message — explain, quiz and help ONLY from this:");
    chunks.forEach((c, i) => lines.push(
      `[T${i + 1}] ${[c.subject, c.topic].filter(Boolean).join(" — ")} (${Math.round(c.confidence * 100)}% sure${fuzzy(c.confidence) ? ", fading — you remember it only vaguely" : ""}): ${c.content}`));
  } else {
    lines.push(taughtAnything
      ? "NOTHING you were taught relates to this message. If it asks about subject content, you have NOT been taught it."
      : "The learner has not taught you anything yet. Any subject content is something you have NOT been taught.");
  }
  if (topics.length) lines.push(`Topics you have been taught at all: ${topics.join("; ")}.`);
  return lines.join("\n");
}

/** The teaching guide's instructions (NaNa Esumai). */
export function buildGuideMessages({ question, topic = "", subject = "", taught = [], syllabus = "" }) {
  const system = [
    "You are NaNa Esumai, the teaching guide who helps a learner's AI protégé. The protégé was asked about something the learner has not taught it, " +
      "and the learner asked for the answer anyway. Give the protégé a correct, clear explanation it can pass on.",
    `Keep it under ${PROTEGE_LIMITS.guideWords} words, at school level, in plain sentences with one everyday example. Unicode for maths, never LaTeX.`,
    "Stay on what was asked. If the protégé's taught notes below contradict the facts, say so in one sentence (\"Note: the learner taught X, but …\").",
    "End with one short line suggesting what the learner could teach the protégé next about this.",
    'Return JSON: { "explanation": string, "teach_next": string }',
  ].join("\n");
  const user = `Question: ${String(question).slice(0, 800)}` +
    (subject || topic ? `\nSubject / topic: ${[subject, topic].filter(Boolean).join(" — ")}` : "") +
    (taught.length ? `\nWhat the learner has taught the protégé on this:\n${taught.map((c) => `- ${c.content}`).join("\n").slice(0, 2000)}` : "\nThe learner has taught the protégé nothing on this.") +
    (syllabus ? `\nSyllabus reference:\n${String(syllabus).slice(0, 1500)}` : "");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

/** The guide's JSON → { explanation, teachNext } (empty explanation = no answer). */
export function shapeGuideAnswer(raw) {
  let j = {};
  try { j = typeof raw === "string" ? JSON.parse(raw) : raw || {}; } catch { j = {}; }
  return {
    explanation: String(j.explanation || "").trim().slice(0, 2500),
    teachNext: String(j.teach_next || j.teachNext || "").trim().slice(0, 200),
  };
}

/** A topic the protégé can be taught, cleaned for the app's "Teach me" button. */
export function teachRequest(input) {
  const topic = String(input?.topic || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const subject = String(input?.subject || "").replace(/\s+/g, " ").trim().slice(0, 60);
  return topic ? { topic, subject } : null;
}
