// modules/battle/knowledge.js
//
// What a battle answer does to the learner's knowledge model.
//
// Lifted out of routes.js because the WORKER now needs it: agents answer
// battles, so the write that used to happen in the HTTP answer handler has to
// happen where the agent answers. Importing the router from the worker to get
// at it would couple the queue to the whole HTTP surface, and this codebase has
// already paid for one circular import (security → auth → security).
//
// This closes a loop rather than being a side effect: agentPlayer reads the
// same per-topic confidence to decide how likely an agent is to be right. If
// nothing wrote to it, every agent would be frozen at whatever its owner knew
// the day it shipped, and no battle would teach anyone anything.

import db from "../../db.js";

const now = () => new Date().toISOString();

/**
 * updateKnowledgeConfidence
 * Called after every battle answer submission.
 *
 * Correct answer  → confidence += 0.05 (capped at 1.0)
 * Wrong answer    → confidence -= 0.05 (floored at 0.0)
 * Topic unknown   → INSERT with confidence = -0.10 (negative = flagged for review)
 *
 * Updates edu.student_knowledge and edu.agent_knowledge in the edu schema.
 * Both tables have a 'confidence' column added in MIGRATIONS_v31.sql.
 */
export async function updateKnowledgeConfidence(userId, topic, subject, isCorrect, subtopic = "") {
  if (!topic) return;

  try {
    // Get student's agent
    const { data: agent } = await db
      .schema("edu").from("student_agents")
      .select("id").eq("student_id", userId).single();
    if (!agent) return;

    const delta = isCorrect ? 0.05 : -0.05;

    // Try to update existing student_knowledge record
    // Keyed on the pair now. A battle question on "Family Roles" inside a
    // battle on "Family" writes topic='Family', subtopic='Family Roles' — so
    // the six subtopics of one battle are siblings under a topic rather than
    // six unrelated top-level entries that nothing can roll up.
    const { data: existing } = await db
      .schema("edu").from("student_knowledge")
      .select("id, confidence, topic")
      .eq("agent_id", agent.id).eq("topic", topic).eq("subtopic", subtopic ?? "").maybeSingle();

    if (existing) {
      // Update confidence — clamp between 0.0 and 1.0
      const newConf = Math.min(1.0, Math.max(0.0, (existing.confidence ?? 0.5) + delta));
      await db.schema("edu").from("student_knowledge").update({
        confidence:      newConf,
        updated_at:      now(),
        next_review_due: isCorrect
          ? new Date(Date.now() + 7  * 86_400_000).toISOString()   // correct → review in 7 days
          : new Date(Date.now() + 1  * 86_400_000).toISOString(),  // wrong   → review in 1 day
      }).eq("id", existing.id);
    } else {
      // Topic not in student's knowledge base — insert with negative confidence
      // Negative score = "encountered but struggled" — triggers review priority
      // This insert had been failing on every battle since it was written, and
      // failing silently — student_id and content are both NOT NULL and neither
      // was supplied, so PostgREST rejected the row and the catch below turned
      // it into a warning nobody read. The effect: battles could only ever
      // adjust topics the learner had already been TAUGHT, and never recorded a
      // topic met for the first time. A battle on something new left no trace.
      const initialConf = isCorrect ? 0.40 : -0.10;
      await db.schema("edu").from("student_knowledge").insert({
        student_id:      userId,
        agent_id:        agent.id,
        topic,
        subtopic:        subtopic ?? "",
        subject:         subject ?? null,
        // A battle answer is not knowledge — it is the record of having met the
        // topic. Saying so plainly matters now that the agent ANSWERS from this
        // table: a placeholder that read like a note would be recalled as one,
        // and the agent would cite "got this wrong once" as its reasoning.
        content:         `Met "${subtopic || topic}" in a battle and answered ${isCorrect ? "correctly" : "incorrectly"}. No notes on this yet.`,
        source:          "session",
        // Tagged so recall SKIPS it. The agent now answers from this table, and
        // a placeholder handed to it as a note would have it reasoning from
        // "got this wrong once" — which is a fact about the learner, not
        // knowledge about the topic. It carries no embedding either, so vector
        // search cannot surface it; the tag stops the topic-match pass too.
        tags:            ["battle-encounter"],
        confidence:      initialConf,
        decay_rate:      0.10,
        next_review_due: new Date(Date.now() + (isCorrect ? 7 : 1) * 86_400_000).toISOString(),
        priority:        isCorrect ? "low" : "critical",
      });
      // NO review notification here. This runs once per QUESTION, and a
      // fifteen-question battle where each question carries its own topic
      // produced fifteen revision cards while the learner was still playing —
      // all stamped "0d ago", all reading "-10% (was 70%)". Revisions are
      // raised once, at the end, by flagBattleReviewTopics below, which can see
      // the whole battle and knows what was actually weak.
    }
    // The hierarchical model too.
    //
    // edu.knowledge_confidence is the table that has always modelled
    // subject -> topic -> subtopic properly, with assessment counts and
    // misconceptions — and battles never touched it, so a learner assessed
    // entirely through battles had a mastery record of nothing at all while
    // teaching sessions filled it in for everyone else.
    await recordAssessment({ userId, topic, subtopic, subject, isCorrect })
      .catch((e) => console.warn("[battle] mastery update failed:", e.message));
  } catch (e) {
    // Non-fatal — battle continues even if knowledge update fails
    console.warn("[battle] Knowledge confidence update failed:", e.message);
  }
}

/**
 * One assessment against edu.knowledge_confidence.
 *
 * NOTE THE SCALE. confidence here is a PERCENTAGE, 0..100 — it is not the same
 * column as edu.student_knowledge.confidence, which is a fraction 0..1. They
 * measure different things (mastery of a subtopic vs how much to weight a note
 * in retrieval) and mixing them silently produces a learner who is either
 * 100x confident or 1% confident.
 */
async function recordAssessment({ userId, topic, subtopic, subject, isCorrect }) {
  const sid = String(userId);
  const sub = subtopic || topic;

  const { data: row } = await db.schema("edu").from("knowledge_confidence")
    .select("id, confidence, assess_count, passed_count")
    .eq("student_id", sid).eq("topic", topic).eq("subtopic", sub).maybeSingle();

  if (!row) {
    // A first sighting starts from the observation rather than from a default:
    // one correct answer is weak evidence of mastery, one wrong answer is weak
    // evidence of its absence, and both beat pretending to know nothing.
    await db.schema("edu").from("knowledge_confidence").insert({
      student_id: sid, topic, subtopic: sub, subject: subject ?? "General",
      confidence: isCorrect ? 45 : 15, prev_confidence: 20,
      assess_count: 1, passed_count: isCorrect ? 1 : 0,
      last_assessed: now(),
      next_review_due: new Date(Date.now() + (isCorrect ? 7 : 1) * 86_400_000).toISOString(),
    });
    return;
  }

  // Moves proportionally to how far there is left to go, so mastery approaches
  // its ceiling instead of hitting it after a lucky run of four.
  const prev = Number(row.confidence ?? 20);
  const next = isCorrect ? prev + (100 - prev) * 0.25 : prev * 0.75;
  await db.schema("edu").from("knowledge_confidence").update({
    prev_confidence: prev,
    confidence: Math.max(0, Math.min(100, Number(next.toFixed(2)))),
    assess_count: (row.assess_count ?? 0) + 1,
    passed_count: (row.passed_count ?? 0) + (isCorrect ? 1 : 0),
    last_assessed: now(), updated_at: now(),
    next_review_due: new Date(Date.now() + (isCorrect ? 7 : 1) * 86_400_000).toISOString(),
  }).eq("id", row.id);
}

/**
 * flagBattleReviewTopics — raise revisions ONCE, when the battle is over.
 *
 * The old behaviour wrote a review notification from inside the per-answer
 * confidence update. That runs once per question, so a fifteen-question battle
 * whose questions each carried their own topic produced up to fifteen revision
 * cards, appearing one at a time while the learner was still playing. It also
 * recorded the -0.10 "encountered but struggled" sentinel as the confidence and
 * never set prev_confidence at all — and the alerts endpoint defaults that to
 * 0.7, so every card claimed a drop from 70% that had never happened.
 *
 * A battle is one event and should leave one revision. So this waits for the
 * end, groups the learner's answers by the topic of each question, and raises a
 * single review for the battle's subject-topic, naming the sub-topics they
 * were actually weak on. What is recorded is the real confidence, before and
 * after, taken from student_knowledge — the same numbers the agent plays from.
 *
 * Called from endBattle. Never throws: a battle result must not depend on it.
 */
export async function flagBattleReviewTopics(battleId) {
  try {
    const { data: battle } = await db.from("battles")
      .select("id, title, topic, subject").eq("id", battleId).single();
    if (!battle) return;

    const [{ data: questions }, { data: answers }, { data: seats }] = await Promise.all([
      db.from("battle_questions").select("id, topic, subject").eq("battle_id", battleId),
      db.from("battle_answers").select("participant_id, question_id, is_correct").eq("battle_id", battleId),
      db.from("battle_participants").select("id, user_id, role").eq("battle_id", battleId),
    ]);
    if (!questions?.length || !seats?.length) return;

    const qById  = new Map(questions.map((q) => [q.id, q]));
    // A teacher running a review is not a learner who needs revising.
    const player = new Map(seats.filter((s) => s.role !== "teacher" && s.user_id).map((s) => [s.id, s.user_id]));

    // participant -> subtopic -> { right, total }
    const byLearner = new Map();
    for (const a of (answers ?? [])) {
      if (!player.has(a.participant_id)) continue;
      const sub = qById.get(a.question_id)?.topic;
      if (!sub) continue;
      const forLearner = byLearner.get(a.participant_id) ?? new Map();
      const cell = forLearner.get(sub) ?? { right: 0, total: 0 };
      cell.total++; if (a.is_correct) cell.right++;
      forLearner.set(sub, cell);
      byLearner.set(a.participant_id, forLearner);
    }

    // What the battle was ABOUT — the card is titled with this, so it has to be
    // the thing a learner would recognise, not the first question's sub-topic.
    const headline = battle.topic || battle.title || battle.subject || "General";
    const subject  = battle.subject || questions.find((q) => q.subject)?.subject || "General";

    for (const [participantId, subtopics] of byLearner) {
      const userId = player.get(participantId);

      // Weak means: got it wrong more often than right. A learner who took one
      // question on a sub-topic and missed it is weak on it; one who went 3/4 is
      // not, and flagging them would make revisions meaningless.
      const weak = [...subtopics.entries()]
        .filter(([, c]) => c.right / c.total < 0.5)
        .sort((a, b) => (a[1].right / a[1].total) - (b[1].right / b[1].total))
        .map(([sub]) => sub);

      const answered = [...subtopics.values()].reduce((n, c) => n + c.total, 0);
      const right    = [...subtopics.values()].reduce((n, c) => n + c.right, 0);
      // Nothing to revise. Saying so is the point: a battle the learner did well
      // in should leave no homework.
      if (!weak.length) continue;

      const { data: agent } = await db.schema("edu").from("student_agents")
        .select("id").eq("student_id", userId).single();
      if (!agent) continue;

      // The real numbers, not the sentinel. Confidence is read AFTER the battle
      // wrote its per-answer updates, and the before is reconstructed from what
      // the battle did to it, so the card's "x% (was y%)" is true.
      // Read by SUBTOPIC now — the weak items are question topics, and those
      // are stored as subtopics under the battle's topic since
      // 2026-knowledge-hierarchy.sql. Reading them as topics found nothing and
      // silently fell back to the 0.3 default, so every card said the same
      // number regardless of how the learner had actually done.
      const { data: known } = await db.schema("edu").from("student_knowledge")
        .select("topic, subtopic, confidence").eq("agent_id", agent.id).in("subtopic", weak);
      const confs = (known ?? []).map((k) => Number(k.confidence)).filter(Number.isFinite);
      const after = confs.length ? Math.max(0, confs.reduce((a, b) => a + b, 0) / confs.length) : 0.3;
      // Each wrong answer moved confidence by 0.05, so undoing that many steps
      // gives where it stood before the battle.
      const before = Math.min(1, after + 0.05 * (answered - right));

      // One per topic while it is still outstanding. Playing three battles on
      // Family before opening any of them should leave one card to act on, not
      // three identical ones.
      const { data: open } = await db.schema("edu").from("decay_notifications")
        .select("id").eq("student_id", userId).eq("topic", headline)
        .eq("is_actioned", false).limit(1);
      if (open?.length) {
        await db.schema("edu").from("decay_notifications").update({
          confidence: after, prev_confidence: before, misconceptions: weak,
          priority: after < 0.3 ? "critical" : "high", is_read: false, created_at: now(),
          message: reviewMessage(headline, weak, right, answered),
        }).eq("id", open[0].id);
        continue;
      }

      await db.schema("edu").from("decay_notifications").insert({
        student_id:      userId,
        agent_id:        agent.id,
        subject,
        topic:           headline,
        subtopic:        weak.length === 1 ? weak[0] : null,
        confidence:      after,
        prev_confidence: before,
        misconceptions:  weak,
        priority:        after < 0.3 ? "critical" : "high",
        message:         reviewMessage(headline, weak, right, answered),
      });
    }
  } catch (e) {
    // A battle result must never depend on the revision write.
    console.warn("[battle] review flagging failed:", e.message);
  }
}

/** What the learner reads. Names the sub-topics, because "revise Family" is not actionable. */
function reviewMessage(headline, weak, right, answered) {
  const list = weak.length === 1 ? weak[0]
    : weak.length === 2 ? `${weak[0]} and ${weak[1]}`
    : `${weak.slice(0, 2).join(", ")} and ${weak.length - 2} more`;
  return `You scored ${right}/${answered} on ${headline} in a battle. Worth another look: ${list}.`;
}
