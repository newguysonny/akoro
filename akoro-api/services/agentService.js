/**
 * services/agentService.js  —  Piabam AI Agent Reply Generator
 *
 * Uses the shared Anthropic model (lib/aiModel.js) to generate short,
 * contextual replies from a student's AI agent in the live class chat feed.
 *
 * Called by:
 *   - chat.js     POST /api/courses/:courseId/messages/agent
 *   - agents.js   POST /api/user/agent/reply
 *
 * Environment variables:
 *   OPENAI_API_KEY
 */

import db        from "../db.js";
import { openai, OPENAI_MODEL } from "../lib/aiModel.js";

/**
 * generateAgentReply
 *
 * Fetches the last 10 messages from the course chat for context,
 * then asks Claude to reply as the named agent.
 *
 * @param {object} opts
 *   courseId       - UUID of the course
 *   triggerMessage - the message that triggered the agent
 *   agentName      - the agent's display name
 *   userId         - the owning student's ID
 *
 * @returns {string} the agent's reply text
 */
export const generateAgentReply = async ({ courseId, triggerMessage, agentName, userId }) => {
  // Fetch recent chat context
  const { data: recentMessages } = await db
    .from("class_messages")
    .select(`
      message, sender_type,
      users!class_messages_sender_id_fkey ( username ),
      user_agents ( agent_name )
    `)
    .eq("course_id", courseId)
    .order("created_at", { ascending: false })
    .limit(10);

  const context = (recentMessages ?? [])
    .reverse()
    .map((m) => {
      const name = m.sender_type === "agent"
        ? (m.user_agents?.agent_name ?? "Agent")
        : (m.users?.username ?? "Student");
      return `${name}: ${m.message}`;
    })
    .join("\n");

  // Fetch course subject for richer context
  const { data: course } = await db
    .from("courses")
    .select("title, subject")
    .eq("id", courseId)
    .single();

  const response = await openai.chat.completions.create({
    model:      OPENAI_MODEL,
    max_tokens: 150,
    messages: [
      {
        role: "system",
        content: `You are ${agentName}, a student's AI learning companion in a ${course?.title ?? "class"} course (subject: ${course?.subject ?? "general"}).
You are helpful, enthusiastic, and academically focused.
Rules:
- Keep replies to 1-3 sentences maximum
- Stay on topic to the course subject
- Be encouraging and supportive
- Use light emojis occasionally (max 1-2 per reply)
- Never be offensive or go off-topic
- If asked something outside the subject, politely redirect`,
      },
      {
        role:    "user",
        content: `Recent class chat:\n${context || "(no messages yet)"}\n\nA student triggered you with: "${triggerMessage}"\n\nReply as ${agentName}:`,
      },
    ],
  });

  return response.choices?.[0]?.message?.content ?? `${agentName} is thinking... 🤔`;
};
