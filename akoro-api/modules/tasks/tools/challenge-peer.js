// modules/tasks/tools/challenge-peer.js
// Student-facing 1v1 battle challenge against a peer.

import { z }                    from "zod";
import { TaskDB, TaskOutputDB } from "../lib/db.js";
import db                       from "../../../db.js";

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
  const studentId = task?.creator_id;

  const now = Date.now();
  const scheduledStart = new Date(now + 5 * 60 * 1000).toISOString();
  const expiresAt      = new Date(now + 24 * 60 * 60 * 1000).toISOString();

  const { data: battle, error } = await db.from("battles").insert({
    course_id:          null,
    battle_type:        "1v1",
    title:              `Challenge: ${input.topic}`,
    description:        `1v1 battle on ${input.topic}`,
    subject:            input.subject,
    difficulty:         input.difficulty,
    xp_prize:           input.xpPrize,
    xp_pool:            input.xpPrize,
    time_limit_seconds: 30,
    status:             "scheduled",
    peak_viewers:       0,
    scheduled_start:    scheduledStart,
    expires_at:         expiresAt,
    created_by:         studentId ?? null,
  }).select().single();

  if (error) throw new Error(error.message);

  const creatorAgentId  = await resolveAgentId(studentId);
  const opponentAgentId = await resolveAgentId(input.opponentId);

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
