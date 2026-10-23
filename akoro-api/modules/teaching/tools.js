/**
 * teaching/tools.js — the teaching tool suite shared by every teacher surface.
 *
 * One catalog, one generation endpoint. The instructor app, the school portal
 * and the AI chat on a school website all call the SAME routes, so a tool is
 * defined once here and appears everywhere — there is no per-app copy of a
 * prompt to drift.
 *
 * Routes:
 *   GET  /api/teaching/tools                 — catalog (fields + output shape)
 *   POST /api/teaching/tools/:key            — run one tool
 *   POST /api/teaching/tools/podcast/audio   — narrate a podcast script (TTS)
 *
 * Output shape is per tool:
 *   'markdown' → { content }            rendered, printable to PDF client-side
 *   'cards'    → { content, cards[] }   vocabulary flashcards
 *   'script'   → { content, script[] }  podcast turns, ready to narrate
 *   'grades'   → { content, grades[] }  one entry per essay
 *
 * Billing: metered on real usage via chargeForAI, charged to the school when
 * the caller belongs to one, otherwise to the teacher — the same rule as every
 * other AI feature.
 */
import { speakBuffer } from "../voice/tts.js";
import { Router } from "express";
import db from "../../db.js";
import { openai, OPENAI_MODEL } from "../../lib/aiModel.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { chargeForAI, schoolBillTo, debitCoins, coinsAvailable, InsufficientCoins } from "../../lib/coins.js";
import { serverError } from "../../lib/httpError.js";

const router = Router();
const TEACHER_ROLES = ["instructor", "teacher", "school", "school_admin", "admin"];
const teacherOnly = [authenticateToken, requireRole(TEACHER_ROLES)];

/* ── Shared field definitions ───────────────────────────────────────────────
   The UI renders forms straight from these, so a new tool needs no frontend
   change beyond appearing in the list. */
const F = {
  topic:   { name: "topic",   label: "Topic",        placeholder: "Photosynthesis", required: true },
  subject: { name: "subject", label: "Subject",      placeholder: "Basic Science" },
  klass:   { name: "class",   label: "Class / year",  placeholder: "JSS2" },
  notes:   { name: "notes",   label: "Anything else?", placeholder: "Optional — context, focus, constraints", long: true },
};

const JSON_RULE = "Return ONLY valid JSON matching the requested shape. No markdown fences, no commentary.";

/* The TTS voices, named so a teacher picks a person rather than a codename.
   Order matters only in that the first two are the defaults for two hosts. */
const VOICE_CATALOG = [
  { label: "Ade — warm, steady",     voice: "onyx"    },
  { label: "Ngozi — bright, lively", voice: "nova"    },
  { label: "Tunde — calm, low",      voice: "echo"    },
  { label: "Amina — soft, clear",    voice: "shimmer" },
  { label: "Kunle — storyteller",    voice: "fable"   },
  { label: "Zainab — neutral",       voice: "alloy"   },
];
const VOICE_LABELS = VOICE_CATALOG.map((v) => v.label);
const voiceFromLabel = (label, fallback) =>
  VOICE_CATALOG.find((v) => v.label === label)?.voice
  || (VOICE_CATALOG.some((v) => v.voice === label) ? label : fallback);

/* A 'doc' is the structured shape every prose tool returns instead of a wall of
   Markdown: a titled set of cards, each card a few labelled blocks. The client
   renders labels as coloured, icon'd headings, so output is scannable and
   prints as a proper handout.

   {"title":string,"subtitle":string,
    "cards":[{"heading":string,
              "blocks":[{"label":string,"text":string}
                       |{"label":string,"bullets":[string]}
                       |{"label":string,"chips":[string]}]}]}

   Block labels are free text — the client maps known ones to icons and falls
   back to a neutral style — so a tool can name its own sections. */
const DOC_RULE = `Return ONLY valid JSON in this shape, no markdown fences and no commentary:
{"title":string,"subtitle":string,"cards":[{"heading":string,"blocks":[{"label":string,"text":string}]}]}
Each block carries exactly ONE of: "text" (a paragraph), "bullets" (array of short lines) or "chips" (array of 1-3 word labels).
Write **bold** around key terms inside text and bullets. Keep every paragraph under 60 words — cards are read at a glance, not studied.`;
const HOUSE = "You support Nigerian secondary school teachers. Be concrete and classroom-ready — real examples, real materials, nothing generic. Never invent exam results, statistics or citations.";

export const TOOLS = [
  {
    key: "podcast", name: "Podcast Generator", emoji: "🎧", output: "script",
    blurb: "Turn a topic into an engaging two-host audio episode, with a transcript you can read along.",
    fields: [F.topic, F.subject, F.klass,
      { name: "minutes", label: "Length", type: "select", options: ["3", "5", "10"], default: "5" },
      { name: "hosts", label: "Format", type: "select", options: ["Two hosts", "Single narrator"], default: "Two hosts" },
      { name: "voiceA", label: "First voice", type: "select", options: VOICE_LABELS, default: "Ade — warm, steady" },
      { name: "voiceB", label: "Second voice", type: "select", options: VOICE_LABELS, default: "Ngozi — bright, lively" },
      F.notes],
    maxTokens: 3000,
    system: `${HOUSE} You write podcast scripts for students: warm, curious, and genuinely entertaining — banter, questions, analogies, a moment of surprise. No filler. ${JSON_RULE}`,
    prompt: (i) => `Write a ${i.minutes || 5}-minute ${String(i.hosts || "Two hosts").toLowerCase()} podcast episode for ${i.class || "secondary"} students on "${i.topic}"${i.subject ? ` (${i.subject})` : ""}.
${i.notes ? `Extra direction: ${i.notes}\n` : ""}
JSON shape:
{"title":string,"summary":string,"turns":[{"speaker":string,"text":string}]}
Use at most two distinct speaker names. Keep each turn under 60 words so it narrates naturally.`,
  },
  {
    key: "misconceptions", name: "Common Misconceptions", emoji: "🧠", output: "doc",
    blurb: "The wrong ideas students arrive with, where they'll struggle, and how to fix each one.",
    fields: [F.topic, F.subject, F.klass, F.notes], maxTokens: 2600,
    system: `${HOUSE} ${DOC_RULE}`,
    prompt: (i) => `Topic: "${i.topic}"${i.subject ? ` · Subject: ${i.subject}` : ""}${i.class ? ` · Class: ${i.class}` : ""}.
${i.notes ? `Context: ${i.notes}\n` : ""}
Produce 5 cards, one per misconception. Each card's heading is the misconception stated plainly, with these blocks in order:
- "Common Misconception" (text) — what students believe.
- "Clarification" (text) — what is actually true.
- "Why This Happens" (text) — why the wrong idea feels right to them.
- "Fix Strategies" (bullets) — 3 specific teaching moves, not general advice.
Then add two final cards: "Where Students Struggle" (a "Watch For" bullets block) and "Quick Checks" (a "Questions" bullets block of 5 questions that expose the misconception).`,
  },
  {
    key: "real-world", name: "Real-World Connections", emoji: "🌍", output: "doc",
    blurb: "Why this topic matters — everyday contexts, local examples, and the careers built on it.",
    fields: [F.topic, F.subject, F.klass, F.notes], maxTokens: 2600,
    system: `${HOUSE} Ground examples in Nigerian and West African daily life where it fits naturally — markets, farming, transport, weather, mobile money, local industry — without forcing it. ${DOC_RULE}`,
    prompt: (i) => `Topic: "${i.topic}"${i.subject ? ` · Subject: ${i.subject}` : ""}${i.class ? ` · Class: ${i.class}` : ""}.
${i.notes ? `Context: ${i.notes}\n` : ""}
Produce 5 cards, each a different real-world connection. The heading is a short, vivid name for the connection (e.g. "Our Shared Recipes"). Blocks in order:
- "Context" (text) — the everyday situation, in language a student recognises.
- "Application" (text) — how the topic actually shows up there.
- "Professions" (chips) — 3 job titles that depend on this.
Then two final cards: "Talk About It" (a "Discussion" bullets block of 5 questions linking the topic to students' own lives) and "Try This" (an "Activity" text block describing one thing they can do or observe outside class).`,
  },
  {
    key: "lesson-hooks", name: "Lesson Hooks", emoji: "🪝", output: "doc",
    blurb: "Openings that grab the class in the first two minutes — with materials and outcomes.",
    fields: [F.topic, F.subject, F.klass, F.notes], maxTokens: 2400,
    system: `${HOUSE} A hook is something the teacher DOES in the first 2 minutes — a demonstration, a question with a surprising answer, a story, a challenge. Every hook must be runnable with materials a Nigerian classroom actually has. ${DOC_RULE}`,
    prompt: (i) => `Topic: "${i.topic}"${i.subject ? ` · Subject: ${i.subject}` : ""}${i.class ? ` · Class: ${i.class}` : ""}.
${i.notes ? `Context: ${i.notes}\n` : ""}
Produce 5 cards, one per hook. The heading names the hook. Blocks in order:
- "The Hook" (text) — what the teacher says or does, word for word where it helps.
- "Materials" (chips) — what's needed; use "None" if nothing.
- "Timing" (text) — how long it takes.
- "Bridge Into The Lesson" (text) — the sentence that moves the class from hook to content.
Then a final card "Expected Outcomes" with an "By The End" bullets block of what students should be able to do.`,
  },
  {
    key: "vocabulary", name: "Vocabulary Builder", emoji: "🔤", output: "cards",
    blurb: "Key terms as flashcards you can flip, print, or hand out as a study list.",
    fields: [F.topic, F.subject, F.klass,
      { name: "count", label: "How many terms", type: "select", options: ["10", "15", "20", "30"], default: "15" },
      F.notes],
    maxTokens: 2600,
    system: `${HOUSE} Definitions must be in language the stated class level can read unaided. ${JSON_RULE}`,
    prompt: (i) => `Build a vocabulary set of ${i.count || 15} terms for "${i.topic}"${i.subject ? ` (${i.subject})` : ""}${i.class ? `, ${i.class} level` : ""}.
${i.notes ? `Context: ${i.notes}\n` : ""}
JSON shape:
{"title":string,"cards":[{"term":string,"definition":string,"example":string,"tip":string}]}
"example" is a sentence using the term in context. "tip" is a short memory aid — leave it as "" if there isn't a genuine one.`,
  },
  {
    key: "essay-grader", name: "Essay Grader", emoji: "📊", output: "grades",
    blurb: "Grade essays against your own rubric, with a score breakdown and feedback for each student.",
    fields: [
      { name: "rubric", label: "Your rubric", placeholder: "Paste the marking scheme — criteria and marks", long: true, required: true },
      { name: "essays", label: "Essays", placeholder: "Paste the essays. Separate each with a line containing only ---", long: true, required: true, rows: 10 },
      F.subject, F.klass,
    ],
    maxTokens: 4000,
    system: `${HOUSE} You mark to the rubric GIVEN — never your own criteria, never a curve. Be specific about where marks were lost. Feedback is addressed to the student, encouraging but honest. ${JSON_RULE}`,
    prompt: (i) => `Mark these essays${i.subject ? ` (${i.subject}` : ""}${i.class ? `${i.subject ? ", " : " ("}${i.class}` : ""}${i.subject || i.class ? ")" : ""} strictly against the rubric.

RUBRIC:
${i.rubric}

ESSAYS (separated by ---):
${i.essays}

JSON shape:
{"grades":[{"label":string,"score":number,"outOf":number,"breakdown":[{"criterion":string,"score":number,"outOf":number,"comment":string}],"strengths":[string],"improvements":[string],"feedback":string}]}
One entry per essay, in the order given. "label" is the student's name if the essay states one, otherwise "Essay 1", "Essay 2"…`,
  },
  {
    key: "lesson-plan", name: "Lesson Plan", emoji: "📋", output: "doc",
    blurb: "A full period plan — objectives, timings, activities, differentiation and assessment.",
    fields: [F.topic, F.subject, F.klass,
      { name: "duration", label: "Period length", type: "select", options: ["35 minutes", "40 minutes", "45 minutes", "60 minutes", "Double period"], default: "40 minutes" },
      { name: "objectives", label: "Your objectives", placeholder: "Optional — leave blank and I'll write them", long: true },
      F.notes],
    maxTokens: 3000,
    system: `${HOUSE} Every activity states what the TEACHER does and what the STUDENTS do. ${DOC_RULE}`,
    prompt: (i) => `Write a ${i.duration || "40 minute"} lesson plan.
Topic: "${i.topic}"${i.subject ? ` · Subject: ${i.subject}` : ""}${i.class ? ` · Class: ${i.class}` : ""}
${i.objectives ? `Objectives to cover:\n${i.objectives}\n` : ""}${i.notes ? `Context: ${i.notes}\n` : ""}
Produce these cards in order:
1. "Overview" — blocks: "Objectives" (bullets), "Prior Knowledge" (text), "Materials" (chips).
2. One card per phase — "Introduction", "Development", "Guided Practice", "Close" — each with "Timing" (text), "Teacher Does" (bullets), "Students Do" (bullets).
3. "Differentiation" — blocks: "Support" (bullets) and "Extension" (bullets).
4. "Assessment & Homework" — blocks: "Check For Understanding" (bullets), "Homework" (text), "Board Plan" (text).
Timings must add up to the period length.`,
  },
  {
    // The ninth tool. The school portal has had an Activities Creator in its
    // content hub for a while, but that endpoint is gated to school roles and
    // grounds every generation in the school's name and brand voice — an
    // instructor has no school to ground it in, so they could not use it at
    // all. This is the same idea, scoped to a teacher: one activity, not a
    // whole period, and it inherits the purchase/lock state the other eight
    // already have.
    key: "activity", name: "Activities Creator", emoji: "✨", output: "doc",
    blurb: "One classroom activity — objective, materials, steps, differentiation and how to assess it.",
    fields: [F.topic, F.subject, F.klass,
      { name: "format", label: "Format", type: "select", options: ["Group work", "Pair work", "Individual", "Whole class", "Practical / experiment", "Game"], default: "Group work" },
      { name: "duration", label: "How long", type: "select", options: ["10 minutes", "15 minutes", "20 minutes", "30 minutes", "Full period"], default: "20 minutes" },
      { name: "materials", label: "What you have", placeholder: "Optional — e.g. only a board and exercise books", long: true },
      F.notes],
    maxTokens: 2400,
    // The materials constraint is the whole point of asking for it. A plan that
    // needs printouts and tablets is not an activity for a class that has a
    // board and exercise books, and it is worse than no plan because the
    // teacher finds out at the front of the room.
    system: `${HOUSE} The activity must be runnable with the materials the teacher says they have; if they name none, assume only a board, chalk or markers, and exercise books. Every step says what the TEACHER does and what the STUDENTS do. ${DOC_RULE}`,
    prompt: (i) => `Design one ${String(i.format || "group work").toLowerCase()} activity lasting ${i.duration || "20 minutes"}.
Topic: "${i.topic}"${i.subject ? ` · Subject: ${i.subject}` : ""}${i.class ? ` · Class: ${i.class}` : ""}
${i.materials ? `Available materials: ${i.materials}\n` : "Assume no printing and no devices.\n"}${i.notes ? `Context: ${i.notes}\n` : ""}
Produce these cards in order:
1. "The Activity" — blocks: "Objective" (text), "Materials" (chips), "Setup" (text).
2. "Run It" — blocks: "Timing" (text), "Teacher Does" (bullets), "Students Do" (bullets).
3. "Differentiation" — blocks: "If they struggle" (bullets), "If they finish early" (bullets).
4. "Assessment" — blocks: "What Good Looks Like" (bullets), "Quick Check" (text).
Timings must add up to the stated length.`,
  },
  {
    key: "assignment", name: "Assignment Creator", emoji: "✍️", output: "doc",
    blurb: "Homework or classwork with a marking scheme, at the difficulty you choose.",
    fields: [F.topic, F.subject, F.klass,
      { name: "type", label: "Type", type: "select", options: ["Homework", "Classwork", "Project", "Practice questions", "Group task"], default: "Homework" },
      { name: "count", label: "How many questions", type: "select", options: ["5", "10", "15", "20"], default: "10" },
      { name: "difficulty", label: "Difficulty", type: "select", options: ["Mixed", "Foundation", "Standard", "Challenge"], default: "Mixed" },
      F.notes],
    maxTokens: 3200,
    system: `${HOUSE} Questions are unambiguous and answerable from what was taught. The marking scheme is a separate card so the teacher can hand out the questions alone. ${DOC_RULE}`,
    prompt: (i) => `Create a ${String(i.type || "homework").toLowerCase()} of ${i.count || 10} questions on "${i.topic}"${i.subject ? ` (${i.subject})` : ""}${i.class ? `, ${i.class}` : ""}. Difficulty: ${i.difficulty || "Mixed"}.
${i.notes ? `Context: ${i.notes}\n` : ""}
Produce these cards in order:
1. "Instructions" — blocks: "For Students" (text), "Time Needed" (text), "Total Marks" (text).
2. "Questions" — a "Questions" bullets block, each line starting with the number and ending with the marks in brackets.
3. "Marking Scheme" — an "Answers" bullets block matching the question numbers, showing where marks are awarded.`,
  },
];

const byKey = Object.fromEntries(TOOLS.map((t) => [t.key, t]));

// Models wrap JSON in fences often enough that stripping is cheaper than retrying.
function parseJson(text) {
  const clean = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(clean); } catch { /* fall through */ }
  const m = clean.match(/[{[][\s\S]*[}\]]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

// Turn structured output back into readable text so copy / print / "send to
// chat" work identically for every tool.
function asMarkdown(tool, data) {
  if (tool.output === "doc") {
    const block = (b) => {
      if (b.bullets?.length) return `**${b.label}**\n${b.bullets.map((x) => `- ${x}`).join("\n")}`;
      if (b.chips?.length)   return `**${b.label}:** ${b.chips.join(" · ")}`;
      return `**${b.label}**\n${b.text || ""}`;
    };
    return [`# ${data.title || tool.name}`, data.subtitle || "", "",
      ...(data.cards || []).map((c) => [`## ${c.heading}`, ...(c.blocks || []).map(block)].join("\n\n")),
    ].filter(Boolean).join("\n\n");
  }
  if (tool.output === "cards") {
    return [`# ${data.title || "Vocabulary"}`, "",
      ...(data.cards || []).map((c, n) => `**${n + 1}. ${c.term}**\n\n${c.definition}${c.example ? `\n\n_${c.example}_` : ""}${c.tip ? `\n\n💡 ${c.tip}` : ""}`)].join("\n\n");
  }
  if (tool.output === "script") {
    return [`# ${data.title || "Podcast"}`, data.summary || "", "",
      ...(data.turns || []).map((t) => `**${t.speaker}:** ${t.text}`)].join("\n\n");
  }
  if (tool.output === "grades") {
    return (data.grades || []).map((g) => [
      `## ${g.label} — ${g.score}/${g.outOf}`,
      ...(g.breakdown || []).map((b) => `- **${b.criterion}**: ${b.score}/${b.outOf} — ${b.comment}`),
      g.strengths?.length ? `\n**Strengths:** ${g.strengths.join("; ")}` : "",
      g.improvements?.length ? `**To improve:** ${g.improvements.join("; ")}` : "",
      g.feedback ? `\n${g.feedback}` : "",
    ].filter(Boolean).join("\n")).join("\n\n---\n\n");
  }
  return "";
}

/* Some tools are also sold in the App Center (edu.platform_tools). Where a
   catalog key matches a PAID platform tool, the teaching tool is locked until
   the teacher has bought it — otherwise the purchase would be meaningless.
   Tools with no matching paid row are free to everyone. */
async function lockState(userId) {
  const { data: paid } = await db.schema("edu").from("platform_tools")
    .select("id, key, name, price_kobo, is_active")
    .in("key", TOOLS.map((t) => t.key));
  const priced = (paid || []).filter((p) => p.is_active && (p.price_kobo || 0) > 0);
  if (!priced.length) return {};

  const { data: access } = await db.schema("edu").from("instructor_tool_access")
    .select("tool_id, access_granted").eq("instructor_id", userId);
  const ownedIds = new Set((access || []).filter((a) => a.access_granted).map((a) => a.tool_id));

  return Object.fromEntries(priced.map((p) => [p.key, {
    locked: !ownedIds.has(p.id), priceKobo: p.price_kobo, toolId: p.id,
  }]));
}

// ── GET /api/teaching/tools ──────────────────────────────────────────────────
router.get("/", teacherOnly, async (req, res) => {
  try {
    const locks = await lockState(req.user.id);
    res.json({
      success: true,
      data: TOOLS.map(({ key, name, emoji, blurb, output, fields }) => {
        const l = locks[key];
        return {
          key, name, emoji, blurb, output, fields,
          locked: !!l?.locked,
          priceKobo: l?.priceKobo || 0,
          toolId: l?.toolId || null,
        };
      }),
    });
  } catch (e) { serverError(res, e, req); }
});

// ── GET /api/teaching/tools/outputs?key= ─────────────────────────────────────
// Past generations, so the workbench can list them the way the content hub
// lists past creations.
router.get("/outputs", teacherOnly, async (req, res) => {
  try {
    let q = db.schema("edu").from("tool_outputs")
      .select("id, tool, kind, title, subject, created_at")
      .eq("instructor_id", req.user.id).like("tool", "teaching_%")
      .order("created_at", { ascending: false }).limit(50);
    if (req.query.key && byKey[req.query.key]) q = q.eq("kind", req.query.key);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (e) { serverError(res, e, req); }
});

router.get("/outputs/:id", teacherOnly, async (req, res) => {
  try {
    const { data } = await db.schema("edu").from("tool_outputs")
      .select("*").eq("id", req.params.id).eq("instructor_id", req.user.id).maybeSingle();
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json({ success: true, data });
  } catch (e) { serverError(res, e, req); }
});

router.delete("/outputs/:id", teacherOnly, async (req, res) => {
  try {
    const { error } = await db.schema("edu").from("tool_outputs")
      .delete().eq("id", req.params.id).eq("instructor_id", req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { serverError(res, e, req); }
});


/**
 * runTeachingTool — the one place a teaching tool actually runs.
 *
 * Extracted from the HTTP route so a scheduled task can run the same eight
 * tools the workbench does, with the same lock check, the same charge-after
 * billing and the same saved output. Duplicating any of that in the task
 * worker would guarantee the two drift: a tool unlocked in one place and not
 * the other, or work that never reaches the teacher's library.
 *
 * Throws ToolError with a `code` the caller maps to a status or a task failure.
 */
export class ToolError extends Error {
  constructor(message, code, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

export async function runTeachingTool({ key, body = {}, userId }) {
  const tool = byKey[key];
  if (!tool) throw new ToolError("Unknown tool", "UNKNOWN_TOOL");

  const locks = await lockState(userId);
  if (locks[tool.key]?.locked) {
    throw new ToolError(`${tool.name} is locked. Unlock it in the App Center to use it.`,
      "TOOL_LOCKED", { toolId: locks[tool.key].toolId });
  }

  const input = {};
  for (const f of tool.fields) {
    const v = body?.[f.name];
    input[f.name] = v === undefined || v === null ? "" : String(v).trim();
    if (f.required && !input[f.name]) throw new ToolError(`${f.label} is required`, "MISSING_FIELD");
    if (!input[f.name] && f.default) input[f.name] = f.default;
  }

  const resp = await openai.chat.completions.create({
    model: OPENAI_MODEL, max_tokens: tool.maxTokens, temperature: 0.6,
    messages: [{ role: "system", content: tool.system }, { role: "user", content: tool.prompt(input) }],
  });
  const raw = resp.choices?.[0]?.message?.content?.trim() || "";

  let payload;
  if (tool.output === "markdown") {
    if (!raw) throw new ToolError("Nothing came back — try again.", "EMPTY");
    payload = { content: raw.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "") };
  } else {
    const data = parseJson(raw);
    if (!data) throw new ToolError("That came back in an unusable shape — try again.", "UNPARSEABLE");
    // A doc with no cards renders as an empty page — better to say so than to
    // hand back a blank result that looks like a bug.
    if (tool.output === "doc" && !Array.isArray(data.cards)) {
      throw new ToolError("That came back without any sections — try again.", "NO_SECTIONS");
    }
    payload = { ...data, content: asMarkdown(tool, data) };
  }

  // Charged AFTER the call, so a failed generation is free.
  let charged = 0;
  try {
    const billTo = await schoolBillTo(userId);
    const r = await chargeForAI({
      userId, feature: `tool_${tool.key}`, model: OPENAI_MODEL,
      usage: resp.usage || {}, ref: tool.key, billTo,
    });
    charged = r?.charged || 0;
  } catch (e) {
    if (e instanceof InsufficientCoins) {
      throw new ToolError("Not enough coins to run this tool.", "INSUFFICIENT_COINS",
        { needed: e.needed, balance: e.balance });
    }
    console.error("[teaching/tools] charge failed:", e.message);
  }

  // Keep it: teachers reuse what they generated, and the tool library is where
  // they look for it — including for work a scheduled task produced overnight.
  db.schema("edu").from("tool_outputs").insert({
    instructor_id: userId, tool: `teaching_${tool.key}`, kind: tool.key,
    title: input.topic || payload.title || tool.name, subject: input.subject || null,
    content: payload,
  }).then(({ error }) => { if (error) console.warn("[teaching/tools] save failed:", error.message); });

  return {
    key: tool.key, name: tool.name, output: tool.output, ...payload,
    topic: input.topic || null, subject: input.subject || null, class: input.class || null,
    ...(tool.key === "podcast" ? { voiceA: input.voiceA, voiceB: input.voiceB } : {}),
    coinsCharged: charged,
  };
}

// ── POST /api/teaching/tools/:key ────────────────────────────────────────────
router.post("/:key", teacherOnly, async (req, res) => {
  try {
    const data = await runTeachingTool({ key: req.params.key, body: req.body, userId: req.user.id });
    res.json({ success: true, data });
  } catch (e) {
    // The runner speaks in codes so both callers — this route and the task
    // worker — can react without parsing prose.
    const map = { UNKNOWN_TOOL: 404, TOOL_LOCKED: 403, MISSING_FIELD: 400,
                  EMPTY: 422, UNPARSEABLE: 422, NO_SECTIONS: 422, INSUFFICIENT_COINS: 402 };
    if (e.code && map[e.code]) {
      const body = { error: e.message, code: e.code };
      if (e.toolId  !== undefined) body.toolId  = e.toolId;
      if (e.needed  !== undefined) { body.needed = e.needed; body.balance = e.balance; }
      return res.status(map[e.code]).json(body);
    }
    serverError(res, e, req);
  }
});

// ── POST /api/teaching/tools/podcast/audio ───────────────────────────────────
// Narrate a script produced by the podcast tool. Two hosts get two voices, so
// the episode sounds like a conversation rather than one person reading.
const TTS_LIMIT = 12000;  // characters — roughly a 12-minute episode

router.post("/podcast/audio", teacherOnly, async (req, res) => {
  try {
    const turns = Array.isArray(req.body?.turns) ? req.body.turns : null;
    if (!turns?.length) return res.status(400).json({ error: "Nothing to narrate" });

    // Speakers keep a consistent voice across the episode, and the teacher's
    // two picks map onto them in the order they first speak.
    const speakers = [...new Set(turns.map((t) => String(t.speaker || "Host")))].slice(0, 2);
    const picked = [
      voiceFromLabel(req.body?.voiceA, "onyx"),
      voiceFromLabel(req.body?.voiceB, "nova"),
    ];
    // Two hosts with the same voice is indistinguishable from one — nudge the
    // second onto a different voice rather than shipping a confusing episode.
    if (speakers.length > 1 && picked[0] === picked[1]) {
      picked[1] = VOICE_CATALOG.find((v) => v.voice !== picked[0]).voice;
    }
    const voiceOf = Object.fromEntries(speakers.map((s, i) => [s, picked[i] || picked[0]]));

    const total = turns.reduce((n, t) => n + String(t.text || "").length, 0);
    if (total > TTS_LIMIT) return res.status(413).json({ error: "That episode is too long to narrate in one go. Shorten it and try again." });

    const billTo = await schoolBillTo(req.user.id);
    const { ok } = await coinsAvailable({ userId: req.user.id, billTo, min: 1 });
    if (!ok) return res.status(402).json({ error: "Not enough coins to narrate this episode.", code: "INSUFFICIENT_COINS" });

    // One request per turn, concatenated. MP3 frames are self-contained, so
    // joining the buffers plays as a single continuous episode.
    //
    // Each part's byte length is reported back as a segment. The client uses
    // the running byte fraction to work out which turn is playing and to jump
    // to one: OpenAI's mp3 is constant bit-rate, so bytes are proportional to
    // time. It is a proxy, not a timestamp — near-exact here, and it costs
    // nothing, where real timings would mean decoding every clip.
    const parts = [];
    const segments = [];
    let bytes = 0;
    let spokeWith = "tts-1";
    for (const t of turns) {
      const text = String(t.text || "").trim();
      if (!text) continue;
      // Deepgram Aura first; OpenAI tts-1 only as the fallback (voice/tts.js).
      const { model, buffer: buf } = await speakBuffer({ text: text.slice(0, 4000), voice: voiceOf[String(t.speaker || "Host")] || "alloy", openai });
      spokeWith = model;
      parts.push(buf);
      segments.push({ speaker: String(t.speaker || "Host"), byteStart: bytes, byteEnd: bytes + buf.length });
      bytes += buf.length;
    }
    if (!parts.length) return res.status(422).json({ error: "Nothing to narrate" });

    // Charged on the characters actually sent — same rate as voice TTS.
    let charged = 0;
    try {
      const r = await debitCoins({
        userId: req.user.id, coins: Math.max(1, Math.ceil(total / 1000)),
        feature: "tool_podcast_tts", model: spokeWith, ref: "podcast", billTo,
      });
      charged = r?.charged ?? r?.coins ?? 0;
    } catch (e) {
      if (e instanceof InsufficientCoins) return res.status(402).json({ error: "Not enough coins to narrate this episode.", code: "INSUFFICIENT_COINS" });
      console.error("[teaching/tools] tts charge failed:", e.message);
    }

    const audio = Buffer.concat(parts);
    res.json({
      success: true,
      data: {
        audio: `data:audio/mpeg;base64,${audio.toString("base64")}`,
        voices: voiceOf, segments, totalBytes: audio.length, coinsCharged: charged,
      },
    });
  } catch (e) { serverError(res, e, req); }
});

export default router;
