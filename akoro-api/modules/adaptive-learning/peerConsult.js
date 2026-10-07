/**
 * modules/adaptive-learning/peerConsult.js — agent ↔ agent consultation.
 *
 * The learner's agent can ask other learners' agents for ideas and
 * suggestions ("how do you keep your learner consistent before exams?").
 *
 * Privacy is the design, not a filter on the output: the peer agents NEVER
 * see any learner data. The only thing that travels is the asking agent's
 * question — sanitized (no emails, phone numbers, or invite links), length
 * capped — plus each peer's own persona (name/emoji). Peer replies are
 * ideas, not data. The requesting learner's budget meters every call
 * (their coins, their feature), and replies are tightly capped.
 */
import db from "../../db.js";
import { OPENAI_MODEL, openai } from "../../lib/aiModel.js";

export const PEER_QUESTION_MIN = 10;
export const PEER_QUESTION_MAX = 300;
export const PEER_REPLY_MAX_CHARS = 600;
export const MAX_PEERS_PER_CONSULT = 2;
export const PEER_CONSULT_FEATURE = "agent_peer_consult";

const EMAIL_LIKE = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/;
const PHONE_LIKE = /\+?\d[\d\s().-]{7,}\d/;           // ~8+ digit runs with separators
const INVITE_LIKE = /(t\.me|wa\.me|whatsapp|telegram|chat\.whatsapp|discord\.gg|bit\.ly)/i;

export const TOPICS = ["study_habits", "exam_prep", "streaks", "motivation", "goals", "subjects", "general"];

/** The question is the only payload that crosses the privacy boundary. */
export function sanitizePeerQuestion(raw) {
  const question = String(raw || "").replace(/\s+/g, " ").trim();
  if (question.length < PEER_QUESTION_MIN) return { ok: false, reason: "too_short" };
  if (question.length > PEER_QUESTION_MAX) return { ok: false, reason: "too_long" };
  if (EMAIL_LIKE.test(question) || PHONE_LIKE.test(question) || INVITE_LIKE.test(question)) {
    return { ok: false, reason: "contact_details" };
  }
  return { ok: true, question };
}

/** Peer personas only — never a peer learner's data. Excludes the asker. */
export async function pickPeerAgents(userId, count = MAX_PEERS_PER_CONSULT) {
  const { data, error } = await db.from("user_agents")
    .select("user_id, agent_name, agent_emoji, agent_color, updated_at")
    .neq("user_id", userId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(25);
  if (error) throw new Error("Could not reach the agent network");
  const pool = data ?? [];
  // shuffle then take — recent agents preferred only in expectation
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function peerSystemPrompt(peer) {
  return (
    `You are ${peer.agent_name} ${peer.agent_emoji}, the study agent of another learner on Akoro, ` +
    `an education platform. A fellow agent is asking you for ideas. Share ONE practical, kind, ` +
    `specific suggestion that has worked for learners like yours — grounded in real study habits ` +
    `(spaced practice, past questions, short daily sessions, teaching-back). Keep it under 80 words, ` +
    `warm and direct, no greetings, no lists of lists. Never invent personal details about anyone.`
  );
}

/**
 * Ask up to MAX_PEERS_PER_CONSULT peer agents. Each reply is one metered
 * model call billed to the ASKING learner. Failures skip a peer — a consult
 * is enrichment, never a dependency.
 */
export async function consultPeerAgents({ userId, question, topic = "general" }) {
  const sanitized = sanitizePeerQuestion(question);
  if (!sanitized.ok) return { consulted: 0, replies: [], note: sanitized.reason };

  const peers = await pickPeerAgents(userId);
  if (!peers.length) {
    return { consulted: 0, replies: [], note: "no_peers_yet" };
  }

  const asks = peers.map(async (peer) => {
    const res = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.8,
      max_tokens: 200,
      __userId: userId,                       // the asking learner's budget
      __feature: PEER_CONSULT_FEATURE,
      messages: [
        { role: "system", content: peerSystemPrompt(peer) },
        { role: "user", content: `[topic: ${TOPICS.includes(topic) ? topic : "general"}] ${sanitized.question}` },
      ],
    });
    const reply = String(res.choices?.[0]?.message?.content || "").trim()
      .slice(0, PEER_REPLY_MAX_CHARS);
    return {
      agent: peer.agent_name,
      emoji: peer.agent_emoji,
      reply,
    };
  });

  const settled = await Promise.allSettled(asks);
  const replies = settled.filter((s) => s.status === "fulfilled" && s.value?.reply)
    .map((s) => s.value);
  return { consulted: replies.length, replies, topic: TOPICS.includes(topic) ? topic : "general" };
}
