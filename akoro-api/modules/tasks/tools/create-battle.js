// modules/tasks/tools/create-battle.js
// Creates a battle/challenge by:
//   1. Reading OCR text from the teacher's uploaded photo (pre-extracted by ocr.ts)
//   2. Calling Claude to generate battle questions from that content
//   3. Calling the existing Battles API (POST /api/battles) to persist everything
//   4. Notifying enrolled students via the notifications lib
//
// The tool owns zero DB logic — all battle persistence goes through the
// existing battles API so there's one source of truth.

import { z }            from "zod";
import { TaskOutputDB } from "../lib/db.js";
import { sendBulkNotifications } from "../lib/notifications.js";
import { openai, OPENAI_MODEL } from "../../../lib/aiModel.js";



// Internal service URL — the battles API running in the same backend
const BATTLES_API = process.env.BATTLES_API_URL ?? "http://localhost:3000/api/battles";
const SERVICE_KEY = process.env.SERVICE_API_KEY ?? "";
// SERVICE_API_KEY is a shared secret for internal service-to-service calls,
// so the battles API trusts requests from the task worker without a teacher JWT.

// ─── Tool definition ──────────────────────────────────────────────────────────

export const createBattleDefinition = {
  name: "create_battle",
  description:
    "Create a student battle/challenge from teacher-provided content. " +
    "Content can come from an uploaded photo (whiteboard, notes, textbook page — " +
    "OCR text is pre-extracted and injected into context), a plain topic string, or both. " +
    "Generates battle questions then calls the Battles API to persist and activate the battle. " +
    "Use this when the teacher says 'create a battle', 'make a challenge', " +
    "'speed round', 'quiz game', 'competition from this', or similar.",
  input_schema: {
    type: "object",
    properties: {
      courseId: {
        type: "string",
        description: "The course this battle belongs to",
      },
      title: {
        type: "string",
        description:
          "Battle title. If not provided, one is derived from the source content.",
      },
      sourceContent: {
        type: "string",
        description:
          "The raw content to generate questions from. " +
          "Pass the OCR-extracted text from the uploaded photo here, " +
          "or a topic description if no file was attached.",
      },
      questionCount: {
        type: "number",
        description: "Number of battle questions to generate (default: 10, max: 20)",
      },
      difficulty: {
        type: "string",
        enum: ["easy", "medium", "hard", "mixed"],
        description: "Difficulty level (default: mixed)",
      },
      battleType: {
        type: "string",
        enum: ["speed_round", "survival", "team", "classic"],
        description:
          "speed_round = fastest correct answer wins · " +
          "survival = wrong answer eliminates you · " +
          "team = class split into teams · " +
          "classic = most correct answers wins. Default: classic",
      },
      timeLimitSeconds: {
        type: "number",
        description: "Seconds per question (default: 30)",
      },
      xpPool: {
        type: "number",
        description: "Total XP distributed to winners (default: 500)",
      },
      notifyStudents: {
        type: "boolean",
        description: "Push a notification to enrolled students when the battle goes live (default: true)",
      },
      scheduleAt: {
        type: "string",
        description:
          "ISO 8601 datetime to schedule the battle for. " +
          "Omit to make it live immediately.",
      },
    },
    required: ["courseId", "sourceContent"],
  },
};

// ─── Params ───────────────────────────────────────────────────────────────────

const paramsSchema = z.object({
  courseId:         z.string(),
  title:            z.string().optional(),
  sourceContent:    z.string().min(5),
  questionCount:    z.number().int().min(3).max(20).default(10),
  difficulty:       z.enum(["easy", "medium", "hard", "mixed"]).default("mixed"),
  battleType:       z.enum(["speed_round", "survival", "team", "classic"]).default("classic"),
  timeLimitSeconds: z.number().int().min(10).max(120).default(30),
  xpPool:           z.number().int().min(100).max(5000).default(500),
  notifyStudents:   z.boolean().default(true),
  scheduleAt:       z.string().datetime({ offset: true }).optional(),
});

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeCreateBattle(rawInput, ctx) {
  const input = paramsSchema.parse(rawInput);

  // ── Step 1: Generate questions from source content ──────────────────────
  const { title, questions, extractedConcepts } = await generateBattleContent(input);

  // ── Step 2: Call the existing Battles API ────────────────────────────────
  const battleApiPayload = {
    courseId:         input.courseId,
    teacherId:        ctx.teacherId,
    title,
    battleType:       input.battleType,
    difficulty:       input.difficulty,
    timeLimitSeconds: input.timeLimitSeconds,
    xpPool:           input.xpPool,
    status:           input.scheduleAt ? "pending" : "live",
    scheduledAt:      input.scheduleAt ?? null,
    sourceType:       input.sourceContent.length > 200 ? "photo" : "topic",
    taskId:           ctx.taskId,
    questions:        questions.map((q, i) => ({ ...q, orderIndex: i })),
  };

  const battleResponse = await callBattlesApi(battleApiPayload);

  // ── Step 3: Notify enrolled students ────────────────────────────────────
  let notifiedCount = 0;

  if (input.notifyStudents && battleResponse.status === "live") {
    const students = await getEnrolledStudents(input.courseId);

    if (students.length > 0) {
      const results = await sendBulkNotifications(
        students.map((s) => ({
          studentId:   s.id,
          studentName: s.name,
          email:       s.email,
          message:
            `⚔️ New battle: "${title}" is live now! ` +
            `${questions.length} questions · ${input.xpPool} XP up for grabs. ` +
            (extractedConcepts.length > 0
              ? `Topics: ${extractedConcepts.slice(0, 3).join(", ")}.`
              : ""),
        })),
        "in_app",
        { courseId: input.courseId, subject: `Battle: ${title}` }
      );
      notifiedCount = results.filter((r) => r.inApp).length;
    }
  }

  // ── Step 4: Write task output ────────────────────────────────────────────
  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "battle",
    content: {
      type:              "battle",
      battleId:          battleResponse.id,
      title,
      battleType:        input.battleType,
      difficulty:        input.difficulty,
      status:            battleResponse.status,
      questionCount:     questions.length,
      xpPool:            input.xpPool,
      extractedConcepts,
      notifiedCount,
      scheduledAt:       input.scheduleAt ?? null,
      questions,           // full set for teacher preview in the UI
    },
    delivered: false,
  });

  return {
    success:           true,
    battleId:          battleResponse.id,
    title,
    questionCount:     questions.length,
    status:            battleResponse.status,
    notifiedCount,
    extractedConcepts,
  };
}

// ─── Question generation via Claude ──────────────────────────────────────────

async function generateBattleContent(input) {
  const difficultyGuide =
    input.difficulty === "mixed"
      ? "Mix difficulties: roughly 30% easy, 50% medium, 20% hard."
      : `All questions should be ${input.difficulty} difficulty.`;

  const typeGuide =
    input.battleType === "speed_round"
      ? "Prefer true/false and short MCQ options — students answer fast under time pressure."
      : input.battleType === "survival"
      ? "MCQ and true/false only. Every question must have a clearly correct answer — no ambiguity."
      : "Mix MCQ (70%) and true/false (30%). Include short_answer only if a concept strongly calls for it.";

  const prompt = `You are generating a student battle/challenge for an education platform.

Source content (from teacher's photo, notes, or topic description):
"""
${input.sourceContent.slice(0, 6000)}
"""

Instructions:
- Generate exactly ${input.questionCount} battle questions from this content.
- ${difficultyGuide}
- ${typeGuide}
- Distribute points so harder questions are worth more.
- Total points across all questions should sum to approximately ${input.xpPool}.
- Each question must test a specific, nameable concept from the source material.
- Derive a short, punchy battle title (max 8 words) if not already obvious.

Respond with JSON only — no markdown fences, no commentary:
{
  "title": "<battle title>",
  "extractedConcepts": ["<concept>", ...],
  "questions": [
    {
      "question":    "<question text>",
      "type":        "mcq" | "true_false" | "short_answer",
      "options":     ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer":      "<correct answer — for mcq use full option text>",
      "explanation": "<1-2 sentence explanation>",
      "difficulty":  "easy" | "medium" | "hard",
      "points":      <integer>,
      "concept":     "<concept being tested>"
    }
  ]
}

Note: "options" is only required for mcq type. Omit it for true_false and short_answer.`;

  const response = await openai.chat.completions.create({
    model:      OPENAI_MODEL,
    max_tokens: 4096,
    messages:   [{ role: "user", content: prompt }],
  });

  const raw = (response.choices?.[0]?.message?.content ?? "")
    .replace(/```json|```/g, "")
    .trim();

  const parsed = JSON.parse(raw);

  // Use teacher-provided title if given, otherwise use Claude's derived title
  const title = input.title?.trim() || parsed.title;

  return { title, questions: parsed.questions, extractedConcepts: parsed.extractedConcepts };
}

// ─── Enrolled students ────────────────────────────────────────────────────────
// Calls the main platform's enrollment API or DB.
// Replace with a direct DB query once enrollments are in schema.ts.

async function getEnrolledStudents(courseId) {
  const ENROLLMENTS_API =
    process.env.ENROLLMENTS_API_URL ??
    `http://localhost:3000/api/courses/${courseId}/students`;

  try {
    const res = await fetch(ENROLLMENTS_API, {
      headers: { Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.students ?? [];
  } catch {
    console.warn(`[create-battle] Could not fetch enrolled students for course ${courseId}`);
    return [];
  }
}

// Normalise a Claude-generated question into a gradable MCQ:
// returns { options: string[], correctIndex } or null if it can't be graded.
export function resolveMcq(q) {
  let options = Array.isArray(q.options) ? q.options.map((o) => String(o)) : [];
  const answer = String(q.answer ?? "").trim();
  if (!options.length) {
    if (q.type === "true_false" || /^(true|false)$/i.test(answer)) options = ["True", "False"];
    else return null; // short_answer — not representable as an MCQ battle question
  }
  const norm = (s) => String(s).trim().replace(/^[A-E][.)]\s*/i, "").toLowerCase();
  let idx = options.findIndex((o) => norm(o) === norm(answer));
  if (idx < 0) idx = options.findIndex((o) => norm(o).includes(norm(answer)) || (norm(answer) && norm(answer).includes(norm(o))));
  if (idx < 0) idx = 0;
  return { options, correctIndex: idx };
}

// ─── Direct battle creation (no HTTP — same process) ─────────────────────────
async function callBattlesApi(payload) {
  const db = (await import("../../../db.js")).default;
  if (!payload.teacherId) throw new Error("create_battle: missing creator (teacherId) — cannot create battle");

  // Grade + normalise questions BEFORE inserting so total_questions is accurate.
  const graded = (payload.questions ?? [])
    .map((q) => { const m = resolveMcq(q); return m ? { ...q, ...m } : null; })
    .filter(Boolean);
  if (!graded.length) throw new Error("create_battle: no gradable multiple-choice questions were generated");

  const { data, error } = await db.from("battles").insert({
    course_id:        payload.courseId,
    battle_type:      payload.battleType === "classroom" ? "classroom" : "open",
    title:            payload.title,
    description:      payload.description ?? null,
    subject:          payload.subject ?? "General",
    difficulty:       payload.difficulty ?? "medium",
    total_questions:  graded.length,
    xp_prize:         payload.xpPool ?? 500,
    xp_pool:          payload.xpPool ?? 500,
    time_limit_seconds: payload.timeLimitSeconds ?? 30,
    status:           payload.status === "pending" ? "scheduled" : "lobby",
    peak_viewers:     0,
    scheduled_start:  payload.scheduledAt ?? null,
    // A scheduled battle's deadline is its start; anything else has none.
    // This was a flat 24 hours, which quietly killed invitations a teacher had
    // set further out than a day.
    expires_at:       payload.scheduledAt ?? null,
    created_by:       payload.teacherId,
  }).select().single();
  if (error) throw new Error(error.message);

  await db.from("battle_questions").insert(graded.map((q, i) => ({
    battle_id: data.id, question_order: i + 1,
    question_text: q.question, options_json: JSON.stringify(q.options),
    correct_answer_index: q.correctIndex, topic: q.concept ?? "general",
    xp_value: q.points ?? 35, time_limit_seconds: payload.timeLimitSeconds ?? 30,
  })));

  // Enqueue lifecycle so the open lobby cleans itself up (students join → it
  // auto-starts when full, or the teacher starts it manually).
  try {
    if (data.expires_at) {
      const { battleQueue } = await import("../../battle/worker.js");
      await battleQueue.add("expire-battle", { action: "expire-battle", battleId: data.id },
        { delay: Math.max(0, new Date(data.expires_at).getTime() - Date.now()) });
    }
  } catch (e) { console.warn("[create-battle] could not enqueue expire job:", e.message); }

  return { id: data.id, status: data.status, title: data.title };
}
