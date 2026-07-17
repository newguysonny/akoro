// modules/tasks/tools/challenge-peer.js
// Student-facing 1v1 battle challenge against a peer.

import { z }                    from "zod";
import { TaskDB, TaskOutputDB } from "../lib/db.js";
import db                       from "../../../db.js";
import { resolveMcq }           from "./create-battle.js";
import { openai, OPENAI_MODEL } from "../../../lib/aiModel.js";


// Generate a small set of gradable MCQs for a 1v1 topic battle.
async function generatePeerQuestions(topic, subject, difficulty, count = 8) {
  const prompt = `Generate exactly ${count} ${difficulty} multiple-choice questions on "${topic}" (${subject}) for a 1v1 student battle.
Respond with JSON only (no fences): {"questions":[{"question":"...","options":["A ...","B ...","C ...","D ..."],"answer":"<full text of correct option>","concept":"...","points":35}]}`;
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL, max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });
  const raw = (response.choices?.[0]?.message?.content ?? "").replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(raw);
  return (parsed.questions ?? [])
    .map((q) => { const m = resolveMcq(q); return m ? { ...q, ...m } : null; })
    .filter(Boolean);
}

export const challengePeerDefinition = {
  name: "challenge_peer",
  description:
    "Challenge another student to a 1v1 battle on a topic. " +
    "Use this when the student wants to challenge, battle, duel, or compete with a peer.",
  input_schema: {
    type: "object",
    properties: {
      opponentId: {
        type: "string",
        description: "The user ID of the peer to challenge",
      },
      topic: {
        type: "string",
        description: "The topic of the battle",
      },
      subject: {
        type: "string",
        description: "The subject (default: 'General')",
      },
      difficulty: {
        type: "string",
        description: "Difficulty level (default: 'medium')",
      },
      xpPrize: {
        type: "number",
        description: "XP prize for the winner (default: 100)",
      },
    },
    required: ["opponentId", "topic"],
  },
};

const paramsSchema = z.object({
  opponentId: z.string(),
  topic:      z.string(),
  subject:    z.string().default("General"),
  difficulty: z.string().default("medium"),
  xpPrize:    z.number().min(0).default(100),
});

export async function executeChallengePeer(rawInput, ctx) {
  const input = paramsSchema.parse(rawInput);

  const task = await TaskDB.findById(ctx.taskId);
  const studentId = task?.creator_id ?? ctx.teacherId;
  if (!studentId) throw new Error("challenge_peer: could not resolve the challenger");

  // Both sides need an active agent (battle_participants.agent_id is NOT NULL).
  const creatorAgentId  = await resolveAgentId(studentId);
  const opponentAgentId = await resolveAgentId(input.opponentId);
  if (!creatorAgentId)  throw new Error("challenge_peer: you need an active agent before challenging");
  if (!opponentAgentId) throw new Error("challenge_peer: that peer has no active agent yet");

  // Generate the questions up front so the battle can actually run once accepted.
  const graded = await generatePeerQuestions(input.topic, input.subject, input.difficulty);
  if (!graded.length) throw new Error("challenge_peer: could not generate battle questions");

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: battle, error } = await db.from("battles").insert({
    course_id:          ctx.courseId ?? null,
    battle_type:        "1v1",
    title:              `Challenge: ${input.topic}`,
    description:        `1v1 battle on ${input.topic}`,
    subject:            input.subject,
    difficulty:         input.difficulty,
    total_questions:    graded.length,
    xp_prize:           input.xpPrize,
    xp_pool:            input.xpPrize,
    time_limit_seconds: 30,
    status:             "lobby",
    peak_viewers:       0,
    scheduled_start:    null,
    expires_at:         expiresAt,
    created_by:         studentId,
  }).select().single();

  if (error) throw new Error(error.message);

  await db.from("battle_questions").insert(graded.map((q, i) => ({
    battle_id: battle.id, question_order: i + 1,
    question_text: q.question, options_json: JSON.stringify(q.options),
    correct_answer_index: q.correctIndex, topic: q.concept ?? input.topic,
    xp_value: q.points ?? 35, time_limit_seconds: 30,
  })));

  await db.from("battle_participants").insert([
    {
      battle_id: battle.id,
      user_id:   studentId ?? null,
      agent_id:  creatorAgentId,
      role:      "creator",
      score:     0,
      hp:        100,
    },
    {
      battle_id: battle.id,
      user_id:   input.opponentId,
      agent_id:  opponentAgentId,
      role:      "opponent",
      score:     0,
      hp:        100,
    },
  ]);

  if (global.io) {
    global.io.to("user:" + input.opponentId).emit("new_challenge", {
      battleId: battle.id,
      topic:    input.topic,
      from:     studentId,
    });
  }

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "battle",
    content: {
      type:     "battle",
      battleId: battle.id,
      topic:    input.topic,
    },
    delivered: false,
  });

  return { success: true, battleId: battle.id };
}

async function resolveAgentId(userId) {
  if (!userId) return null;
  const { data } = await db.from("user_agents")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return data?.id ?? null;
}
