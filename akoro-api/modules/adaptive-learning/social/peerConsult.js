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
import { isProtectedLearner } from "../../agent-network/autoReplyCore.js";
import db from "../../../db.js";
import { OPENAI_MODEL, openai } from "../../../lib/aiModel.js";

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

/* ── Peer agent help from breakthroughs (Grand Plan §7.13, D34, D36) ─────────
 * Not advice from strangers: what actually worked for other learners who had
 * the SAME struggle and got past it (edu.learning_struggles, resolved rows).
 * The asking agent sends only the struggle — a type from the closed list
 * (§7.15) and, for concept types, the concept. What comes back:
 *   stories  up to 3, each from a learner who turned on "Let my agent help
 *            other learners" (user_agents.help_others_opt_in), from records
 *            that are resolved, non-sensitive and not hidden — shown with the
 *            agent's name and emoji only, never a learner id, name or school
 *   pattern  which strategy most often worked, across ALL matching records
 *            (opted in or not — totals only), returned only when at least
 *            PATTERN_MIN_LEARNERS learners match, so no one can be singled out
 * Sensitive types never produce stories, only the pattern. Stories are never
 * evidence and never written to the learner's notes. A database search only:
 * no model call, nothing to meter. */

export const PATTERN_MIN_LEARNERS = 5;
export const MAX_STORIES = 3;
const BREAKTHROUGH_COLS = "learner_id, struggle_type, concept_id, class_level, struggle_summary, misconception_key, attempts_before, what_worked_strategy, what_worked, score_before, score_after, resolved_at, days_to_overcome, sensitive, hidden, expires_at";

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);

/**
 * PURE: matching resolved rows → { stories, pattern }. `agents` maps a
 * learner id to { name, emoji, optedIn }; the asker's own rows never count.
 */
export function breakthroughsFrom(rows, { askerId = null, agents = new Map(), sensitiveType = false, classLevel = null, now = Date.now() } = {}) {
  const live = (rows || []).filter((r) => r && r.learner_id !== askerId && (!r.expires_at || new Date(r.expires_at).getTime() > now));
  // Pattern (D36): every matching record, totals only — and only from 5 learners up.
  const byStrategy = new Map();
  const learners = new Set();
  for (const r of live) {
    learners.add(r.learner_id);
    if (!r.what_worked_strategy) continue;
    if (!byStrategy.has(r.what_worked_strategy)) byStrategy.set(r.what_worked_strategy, new Set());
    byStrategy.get(r.what_worked_strategy).add(r.learner_id);
  }
  let pattern = null;
  if (learners.size >= PATTERN_MIN_LEARNERS && byStrategy.size) {
    const [strategy, who] = [...byStrategy.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0];
    pattern = { learners: learners.size, mostEffective: strategy, share: Math.round((who.size / learners.size) * 100) / 100 };
  }
  if (sensitiveType) return { stories: [], pattern };
  // Stories: opted-in learners' resolved, non-sensitive, visible breakthroughs with words to share.
  const jump = (r) => (num(r.score_after) ?? 0) - (num(r.score_before) ?? 0);
  const candidates = live
    .filter((r) => !r.sensitive && !r.hidden && r.what_worked && agents.get(r.learner_id)?.optedIn)
    .sort((a, b) => Number(Boolean(classLevel) && b.class_level === classLevel) - Number(Boolean(classLevel) && a.class_level === classLevel)
      || jump(b) - jump(a) || String(b.resolved_at || "").localeCompare(String(a.resolved_at || "")));
  const stories = [];
  const used = new Set();
  for (const r of candidates) {
    if (used.has(r.learner_id)) continue;   // one story per learner
    used.add(r.learner_id);
    const agent = agents.get(r.learner_id);
    stories.push({
      agent: String(agent.name || "A study agent").slice(0, 60), emoji: agent.emoji || null,
      struggle: r.struggle_summary ? String(r.struggle_summary).slice(0, 200) : null,
      attemptsBefore: Number(r.attempts_before || 0), whatWorked: String(r.what_worked).slice(0, 300),
      strategy: r.what_worked_strategy || null, scoreBefore: num(r.score_before), scoreAfter: num(r.score_after),
      daysToOvercome: r.days_to_overcome ?? null,
    });
    if (stories.length >= MAX_STORIES) break;
  }
  return { stories, pattern };
}

/** The approved concept a topic name means (for an agent that knows the topic, not its id). */
export async function conceptIdFor(concept, subject = null) {
  const title = String(concept || "").replace(/[%_,()]/g, " ").trim().slice(0, 120);
  if (title.length < 3) return null;
  let q = db.schema("edu").from("concept_catalog").select("id").eq("status", "approved").ilike("title", title);
  if (subject) q = q.ilike("subject", `%${String(subject).replace(/[%_,()]/g, " ").trim().slice(0, 80)}%`);
  const { data } = await q.limit(1);
  return data?.[0]?.id || null;
}

/**
 * peers.consult — what worked for other learners with this struggle.
 * → { struggleType, consulted, stories, pattern } | { error }
 */
export async function consultBreakthroughs({ userId, struggleType: type, conceptId = null, concept = null, subject = null, misconception = null, classLevel = null }) {
  const { struggleType: typeOf } = await import("../../../lib/struggleTypes.js");
  const def = typeOf(type);
  if (!def) return { error: "Name the struggle with a type from the struggle list (e.g. misconception, procrastination, overload)." };
  let concept_id = def.concept ? (conceptId || (concept ? await conceptIdFor(concept, subject) : null)) : null;
  if (concept_id && !/^[0-9a-f-]{36}$/i.test(String(concept_id))) concept_id = null;
  let q = db.schema("edu").from("learning_struggles").select(BREAKTHROUGH_COLS)
    .eq("struggle_type", def.id).eq("status", "resolved");
  if (userId) q = q.neq("learner_id", userId);
  if (concept_id) q = q.eq("concept_id", concept_id);
  else if (def.concept && misconception) q = q.ilike("misconception_key", `%${String(misconception).toLowerCase().replace(/[%_,()]/g, " ").trim().slice(0, 80)}%`);
  else if (def.concept) return { struggleType: def.id, consulted: 0, stories: [], pattern: null, note: "Name the concept (or the misconception) so the match is the same struggle." };
  const { data: rows, error } = await q.order("resolved_at", { ascending: false }).limit(300);
  if (error) return { error: "Other learners' breakthroughs are unavailable right now." };
  const ids = [...new Set((rows || []).filter((r) => !r.sensitive && !r.hidden && r.what_worked).map((r) => r.learner_id))].slice(0, 100);
  const agents = new Map();
  if (ids.length && !def.sensitive) {
    // Fails closed: if the opt-in can't be read, nobody's story is shown.
    const { data: people, error: agentError } = await db.from("user_agents").select("user_id, agent_name, agent_emoji, help_others_opt_in, help_others_chosen_at").in("user_id", ids);
    // A primary / JSS learner who never chose starts OFF (decided 2026-11-07): their level decides the default.
    const { data: levels, error: levelError } = await db.from("users").select("id, study_level, year_group").in("id", ids);
    const young = new Set(levelError ? ids : (levels || []).filter((u) => isProtectedLearner({ studyLevel: u.study_level, yearGroup: u.year_group })).map((u) => u.id));
    if (!agentError) for (const a of people || []) agents.set(a.user_id, { name: a.agent_name, emoji: a.agent_emoji, optedIn: helpsOthers(a, { young: young.has(a.user_id) }) });
  }
  const { stories, pattern } = breakthroughsFrom(rows || [], { askerId: userId, agents, sensitiveType: def.sensitive, classLevel });
  return { struggleType: def.id, consulted: new Set((rows || []).map((r) => r.learner_id)).size, stories, pattern };
}

/**
 * "Let my agent help other learners" — ON by default (2026-11-07), OFF by
 * default for primary / JSS learners. A learner who never chose follows that default; once they choose (help_others_chosen_at), their
 * choice stands. PURE.
 */
export const helpsOthers = (row, { young = false } = {}) => (row?.help_others_chosen_at ? row.help_others_opt_in === true : !young);

/** The learner's own setting, as Settings shows it (on until they turn it off). */
export async function readHelpOthersOptIn(userId) {
  const [{ data, error }, { data: u }] = await Promise.all([
    db.from("user_agents").select("help_others_opt_in, help_others_chosen_at").eq("user_id", userId).maybeSingle(),
    db.from("users").select("study_level, year_group").eq("id", userId).maybeSingle(),
  ]);
  const young = isProtectedLearner({ studyLevel: u?.study_level, yearGroup: u?.year_group });
  return error ? !young : helpsOthers(data, { young });
}

/**
 * Turning "Let my agent help other learners" on or off (§7.13.1a): the choice
 * is recorded with its time, and the learner's non-sensitive records become
 * shareable as stories, or stop being.
 */
export async function setHelpOthersOptIn(userId, on) {
  const { error } = await db.from("user_agents").update({ help_others_opt_in: on === true, help_others_chosen_at: new Date().toISOString() }).eq("user_id", userId);
  if (error) throw new Error(error.message);
  await db.schema("edu").from("learning_struggles").update({ shareable: on === true }).eq("learner_id", userId).eq("sensitive", false);
  return { helpOthersOptIn: on === true };
}
