// modules/tasks/tools/challenge-peer.js
// Student-facing 1v1 battle challenge against a peer.

import { z }                    from "zod";
import { TaskDB, TaskOutputDB } from "../lib/db.js";
import { createNetworkBattle } from "../../battle/networkBattle.js";


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
      totalQuestions: { type: "number", description: "5–30 questions (default 10)" },
      hpPerMiss: { type: "number", description: "HP lost per missed question, 0–50 (default 10)" },
      minXp: { type: "number", description: "Minimum XP the opponent needs to accept (default 0)" },
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
  totalQuestions: z.number().int().min(5).max(30).optional(),
  hpPerMiss:  z.number().int().min(0).max(50).optional(),
  minXp:      z.number().int().min(0).optional(),
});

export async function executeChallengePeer(rawInput, ctx) {
  const input = paramsSchema.parse(rawInput);

  const task = await TaskDB.findById(ctx.taskId);
  const studentId = task?.creator_id ?? ctx.teacherId;
  if (!studentId) throw new Error("challenge_peer: could not resolve the challenger");

  // The same path as every other learner battle: the creator pays for the
  // questions (past papers first), both seats are set up properly, the
  // opponent is notified and sees the challenge card, the entry gate and the
  // creator's HP/XP rules apply. This tool used to write its own battle —
  // unpaid AI questions, a creator seat nobody had joined, no notification —
  // and an accepted duel never started.
  const difficulty = { easy: "easy", medium: "intermediate", intermediate: "intermediate", hard: "hard" }[String(input.difficulty).toLowerCase()] || "intermediate";
  const result = await createNetworkBattle({
    creatorId: studentId, opponents: [input.opponentId], source: "challenge",
    options: {
      kind: "1v1", subject: input.subject, topic: input.topic, difficulty,
      total_questions: input.totalQuestions, xp_prize: input.xpPrize,
      hp_per_miss: input.hpPerMiss, min_xp: input.minXp,
      title: `Challenge: ${input.topic}`.slice(0, 120),
    },
  });
  const battle = { id: result.battleId };

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
