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
 * Every tool returns the one result template (see template.js):
 *   { version:2, title, summary, meta, highlights[], entries[{title, sections[]}], content }
 * `output` names the legacy shape also included beside it (doc → cards, cards,
 * script → turns), for consumers not yet on the template. (Results saved by the retired essay
 * grader keep their `grades` shape and still open in the Library.)
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
import { closeJson } from "./jsonRepair.js";
import { TEMPLATE_RULE, normalizeResult, toMarkdown, toLegacy } from "./template.js";

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

/* Every tool answers in the one result template (template.js): a titled set of
   entries, each a few labelled sections. TEMPLATE_RULE is its shape card, so a
   tool's prompt only has to say WHICH entries and sections it wants. */
// The template spells out kind/label/tone on every section, so the JSON runs longer than the old
// card shape did: the token ceilings below leave room for it (a cut-off answer is unparseable).
const DOC_RULE = TEMPLATE_RULE;
const HOUSE = "You support Nigerian secondary school teachers. Be concrete and classroom-ready — real examples, real materials, nothing generic. Never invent exam results, statistics or citations.";

/* What makes the best results class-ready: they sound like a teacher who knows THIS class, say the
   actual words and moves, and give every entry a vivid name. The three recipes below follow the
   reference results (reference/instructor-tools): scripted hooks with timed steps, misconceptions
   with a real classroom moment, real-world connections that start from the students' own lives. */
const CRAFT = `Write like an experienced teacher talking to a colleague: concrete, vivid, warm, never generic. Pitch every sentence at the stated class level — if students could not say it aloud, simplify it. Give each entry a short, evocative name (a title a teacher would remember), never "Example 1". Wherever there is something to say, write the actual words in quotes. Use **bold** for the few key terms or moves, not for whole sentences. No two entries may open the same way or use the same device.`;
const DIRECTION = (i) => i.notes
  ? `The teacher's direction: "${i.notes}". Treat it as the brief for the whole set — it decides the theme, tone and style of EVERY entry (for example "a journey through time" makes each entry a stop on that journey; "exciting activities" means active, hands-on, a little noisy). Follow it closely and do not water it down.\n`
  : "";
const BRIEF = (i) => `Topic: "${i.topic}"${i.subject ? ` · Subject: ${i.subject}` : ""}${i.class ? ` · Class: ${i.class}` : ""}.`;

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
    maxTokens: 4500,
    system: `${HOUSE} You write podcast scripts for students: warm, curious, and genuinely entertaining — banter, questions, analogies, a moment of surprise. No filler. ${DOC_RULE}`,
    prompt: (i) => `Write a ${i.minutes || 5}-minute ${String(i.hosts || "Two hosts").toLowerCase()} podcast episode for ${i.class || "secondary"} students on "${i.topic}"${i.subject ? ` (${i.subject})` : ""}.
${i.notes ? `Extra direction: ${i.notes}\n` : ""}
Produce ONE entry titled "Episode" with ONE "script" section holding the turns. Put the episode\'s length and format in "highlights".
Use at most two distinct speaker names. Keep each turn under 60 words so it narrates naturally.`,
  },
  {
    key: "misconceptions", name: "Common Misconceptions", emoji: "🧠", output: "doc",
    blurb: "The wrong ideas students arrive with, where they'll struggle, and how to fix each one.",
    fields: [F.topic, F.subject, F.klass, F.notes], maxTokens: 4500,
    system: `${HOUSE} ${CRAFT} You know the research on student misconceptions in every school subject. A misconception is a wrong idea students genuinely hold, written the way a student would say it — one plain sentence ("Plants get their food from the soil"), never a vague topic. The five must differ in kind: an overgeneralised rule, an everyday word that means something else in this subject, a rule used outside where it holds, cause and effect reversed, a half-truth that sounds complete. ${DOC_RULE}`,
    prompt: (i) => `${BRIEF(i)}
${DIRECTION(i)}
Produce 5 entries, one per misconception. The entry title is the misconception in the student's own words. Sections in order:
- text "Common Misconception" (tone danger) — the wrong belief, one sentence.
- text "Clarification" (tone success) — what is actually true, in 2-3 plain sentences, bolding the key terms.
- text "Why This Misconception Occurs" (tone info) — the real source: an everyday meaning of a word, an earlier lesson stretched too far, intuition, a shortcut that works in exams but not here. Name it.
- list "Fix Strategies" (tone idea) — 3 concrete teaching moves, each starting with a verb and naming the activity, object or question (e.g. "**Weigh** a pot of soil before and after a bean grows in it"). No general advice such as "explain it again".
- text "Real Classroom Example" (tone warn) — 1-2 sentences: what a student says or does in class that reveals this misconception, in a setting a Nigerian class would recognise.
Then one final entry "Quick Checks" with a list "Questions" of 5 short questions that make the misconception show itself.`,
  },
  {
    key: "real-world", name: "Real-World Connections", emoji: "🌍", output: "doc",
    blurb: "Why this topic matters — everyday contexts, local examples, and the careers built on it.",
    fields: [F.topic, F.subject, F.klass, F.notes], maxTokens: 4500,
    system: `${HOUSE} ${CRAFT} You write for students, not teachers: warm, second person ("your", "you"), starting from something the student already does or has seen — a meal, a game, a phone, a market stall, the walk to school — and only then connecting it to the idea. Ground the connections in Nigerian and West African daily life where it is natural (markets, farming, transport, weather, mobile money, football, local industry, family occasions), and never force it. ${DOC_RULE}`,
    prompt: (i) => `${BRIEF(i)}
${DIRECTION(i)}
Produce 5 entries, each a different real-world connection, drawn from different parts of life (home, school or sport, money or market, technology, work or community). Use layout "split". The entry title is a short, vivid, human name (for example "Our Shared Recipes", "Team Traditions"). Sections in order:
- text "Context" (tone info) — 3-4 sentences. Start from the everyday situation, make the comparison to the topic obvious, **bold** the key terms, and close with one sentence on why this matters to the student — worded differently in every entry (never the same stock phrase twice). Keep it to about 60 words.
- chips "Professions" (tone accent) — exactly 3 real, specific job titles whose daily work depends on this (not just "Teacher").
Then two final entries (layout "stack"): "Talk About It" with a list "Discussion" of 5 open questions linking the topic to students' own lives, and "Try This" with a text "Activity" describing one thing they can do or observe outside class this week, with what to bring back.`,
  },
  {
    key: "lesson-hooks", name: "Lesson Hooks", emoji: "🪝", output: "doc",
    blurb: "Openings that grab the class in the first two minutes — with materials and outcomes.",
    fields: [F.topic, F.subject, F.klass, F.notes], maxTokens: 6000,
    system: `${HOUSE} ${CRAFT} A lesson hook is something the teacher DOES or SAYS in the first minutes of a lesson that makes students lean in: a story, a mystery, a role-play or game, a prediction, a challenge, a vote on their feet. It never explains the topic — it makes them need to know. Every hook must run with what a Nigerian classroom actually has (chalkboard, exercise books, bottle caps, a phone torch, or nothing at all) and work with 40-70 students. Vary the five: no two with the same format. ${DOC_RULE}`,
    prompt: (i) => `${BRIEF(i)}
${DIRECTION(i)}
Produce 5 entries, one per hook. The entry title is the hook's name (for example "The Time Traveler's Dilemma", "Stone Age Survivor"). Sections in order:
- text (no label) — one paragraph: what the hook is, and the learning idea behind it (the curiosity, prediction, role or puzzle that makes students need the topic). Do NOT begin two descriptions with the same words, and do not use a stock opening such as "This hook uses…" more than once. If it is a game or role-play, start with the line the teacher says to launch it ("Let's play '…'! You are …").
- list "Implementation Steps" (ordered true, tone accent) — 4-5 steps for the teacher. Give the teacher's exact words in quotes where they speak, say what students do, and end every step with its minutes in brackets, e.g. "Pose the challenge: '…' (2 min)". The LAST step is always a transition into the lesson ("Transition: 'Today we …'"). Total time 5-10 minutes.
- fields — "Expected Outcome" (what students will feel, notice or be able to say, and how that leads into the topic) and "Materials Needed" (specific items, or "None").`,
  },
  {
    key: "vocabulary", name: "Vocabulary Builder", emoji: "🔤", output: "cards",
    blurb: "Key terms as flashcards you can flip, print, or hand out as a study list.",
    fields: [F.topic, F.subject, F.klass,
      { name: "count", label: "How many terms", type: "select", options: ["10", "15", "20", "30"], default: "15" },
      F.notes],
    maxTokens: 4500,
    system: `${HOUSE} Definitions must be in language the stated class level can read unaided. ${DOC_RULE}`,
    prompt: (i) => `Build a vocabulary set of ${i.count || 15} terms for "${i.topic}"${i.subject ? ` (${i.subject})` : ""}${i.class ? `, ${i.class} level` : ""}.
${i.notes ? `Context: ${i.notes}\n` : ""}
Produce one entry per term (layout "compact"): the title is the term, then sections text "Definition", text "Example" (a sentence using the term in context) and text "Memory tip" (tone idea; leave this section out if there isn't a genuine one). Put the term count in "highlights".`,
  },
  {
    key: "lesson-plan", name: "Lesson Plan", emoji: "📋", output: "doc",
    blurb: "A full period plan — objectives, timings, activities, differentiation and assessment.",
    fields: [F.topic, F.subject, F.klass,
      { name: "duration", label: "Period length", type: "select", options: ["35 minutes", "40 minutes", "45 minutes", "60 minutes", "Double period"], default: "40 minutes" },
      { name: "objectives", label: "Your objectives", placeholder: "Optional — leave blank and I'll write them", long: true },
      F.notes],
    maxTokens: 4500,
    system: `${HOUSE} Every activity states what the TEACHER does and what the STUDENTS do. ${DOC_RULE}`,
    prompt: (i) => `Write a ${i.duration || "40 minute"} lesson plan.
Topic: "${i.topic}"${i.subject ? ` · Subject: ${i.subject}` : ""}${i.class ? ` · Class: ${i.class}` : ""}
${i.objectives ? `Objectives to cover:\n${i.objectives}\n` : ""}${i.notes ? `Context: ${i.notes}\n` : ""}
Put the period length in "highlights". Produce these entries in order:
1. "Overview" — list "Objectives" (tone teal), text "Prior Knowledge", chips "Materials".
2. One entry per phase — "Introduction", "Development", "Guided Practice", "Close" — each with fields {"Timing"}, list "Teacher Does" (tone accent) and list "Students Do" (tone success).
3. "Differentiation" — list "Support" and list "Extension".
4. "Assessment & Homework" — list "Check For Understanding", text "Homework", text "Board Plan".
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
    maxTokens: 4000,
    // The materials constraint is the whole point of asking for it. A plan that
    // needs printouts and tablets is not an activity for a class that has a
    // board and exercise books, and it is worse than no plan because the
    // teacher finds out at the front of the room.
    system: `${HOUSE} The activity must be runnable with the materials the teacher says they have; if they name none, assume only a board, chalk or markers, and exercise books. Every step says what the TEACHER does and what the STUDENTS do. ${DOC_RULE}`,
    prompt: (i) => `Design one ${String(i.format || "group work").toLowerCase()} activity lasting ${i.duration || "20 minutes"}.
Topic: "${i.topic}"${i.subject ? ` · Subject: ${i.subject}` : ""}${i.class ? ` · Class: ${i.class}` : ""}
${i.materials ? `Available materials: ${i.materials}\n` : "Assume no printing and no devices.\n"}${i.notes ? `Context: ${i.notes}\n` : ""}
Put the format and length in "highlights". Produce these entries in order:
1. "The Activity" — text "Objective" (tone teal), chips "Materials", text "Setup".
2. "Run It" — fields {"Timing"}, list "Teacher Does" (tone accent) and list "Students Do" (tone success).
3. "Differentiation" — list "If they struggle" and list "If they finish early".
4. "Assessment" — list "What Good Looks Like" (tone success) and text "Quick Check".
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
    maxTokens: 5000,
    system: `${HOUSE} Questions are unambiguous and answerable from what was taught. The marking scheme is a separate entry so the teacher can hand out the questions alone. ${DOC_RULE}`,
    prompt: (i) => `Create a ${String(i.type || "homework").toLowerCase()} of ${i.count || 10} questions on "${i.topic}"${i.subject ? ` (${i.subject})` : ""}${i.class ? `, ${i.class}` : ""}. Difficulty: ${i.difficulty || "Mixed"}.
${i.notes ? `Context: ${i.notes}\n` : ""}
Put the question count and total marks in "highlights". Produce these entries in order:
1. "Instructions" — text "For Students", fields {"Time Needed", "Total Marks"}.
2. "Questions" — an ordered list "Questions", each line ending with its marks in brackets.
3. "Marking Scheme" — an ordered list "Answers" matching the question numbers, showing where marks are awarded.`,
  },
];

const byKey = Object.fromEntries(TOOLS.map((t) => [t.key, t]));

// Models wrap JSON in fences often enough that stripping is cheaper than retrying.
export function parseJson(text) {
  const clean = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(clean); } catch { /* fall through */ }
  const m = clean.match(/[{[][\s\S]*[}\]]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  const closed = closeJson(clean.replace(/^[^{[]*/, ""));
  if (closed) { try { return JSON.parse(closed); } catch { /* ignore */ } }
  return null;
}

/* A saved output from before the template has the old per-tool shape. Lift it
   into the template on the way out so the Library draws old and new alike. */
export function upgradeSaved(row) {
  const tool = byKey[row?.kind];
  const c = row?.content;
  if (!tool || !c || typeof c !== "object" || Array.isArray(c.entries)) return row;
  const result = normalizeResult(c, { tool, input: { subject: row.subject, topic: row.title } });
  return result.entries.length ? { ...row, content: { ...c, ...result } } : row;
}

/* Every teaching tool is open to every instructor — none is locked or priced.
   (They used to lock when a same-key platform_tools row had a price and the
   instructor hadn't bought it; that gate is gone. The response keeps its
   locked / priceKobo / toolId fields, always open, so existing clients read it
   unchanged.) */

// ── GET /api/teaching/tools ──────────────────────────────────────────────────
router.get("/", teacherOnly, async (req, res) => {
  try {
    res.json({
      success: true,
      data: TOOLS.map(({ key, name, emoji, blurb, output, fields }) => {
        return { key, name, emoji, blurb, output, fields, locked: false, priceKobo: 0, toolId: null };
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
    res.json({ success: true, data: upgradeSaved(data) });
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

/** The tool's form fields, trimmed and defaulted from whatever the caller sent. */
export function cleanToolInput(tool, body = {}) {
  const input = {};
  for (const f of tool.fields) {
    const v = body?.[f.name];
    input[f.name] = v === undefined || v === null ? "" : String(v).trim();
    if (f.required && !input[f.name]) throw new ToolError(`${f.label} is required`, "MISSING_FIELD");
    if (!input[f.name] && f.default) input[f.name] = f.default;
  }
  return input;
}

export const toolByKey = (key) => byKey[key] || null;

/** What is stored and returned for a result: the template, plus the legacy keys and readable text. */
export const toolPayload = (tool, result) => ({ ...toLegacy(result, tool.output), ...result, content: toMarkdown(result) });

/**
 * One model round: the tool's prompt (or, for a revision, that prompt plus the version being
 * changed and the teacher's request) → a usable template result, billed to the user.
 * Throws ToolError with a code. Nothing is saved here.
 */
export async function generateToolResult({ tool, input, userId, base = null, request = null }) {
  // One retry when the model's answer can't be used (empty, unparseable JSON, a doc with no
  // sections): these are intermittent, and a failed run is free (charged after the call). Token
  // use is summed across the attempts so the charge stays honest.
  // A usable answer parses AND leaves at least one entry once normalized.
  const resultOf = (r) => {
    const data = parseJson(r);
    if (!data) return null;
    const result = normalizeResult(data, { tool, input });
    return result.entries.length ? result : null;
  };
  const unusable = (raw) => {
    return !resultOf(raw);
  };
  const ask = base && request
    ? `${tool.prompt(input)}\n\nCURRENT VERSION (the same template, as JSON):\n${JSON.stringify({ title: base.title, summary: base.summary, highlights: base.highlights, entries: base.entries })}\n\nThe teacher asks for this change: ${request}\nReturn the COMPLETE revised result in the same JSON template. Change only what they asked and keep everything else as it is.`
    : tool.prompt(input);
  let resp, raw = "";
  const usage = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    resp = await openai.chat.completions.create({
      model: OPENAI_MODEL, max_tokens: tool.maxTokens, temperature: 0.6,
      messages: [{ role: "system", content: tool.system }, { role: "user", content: ask }],
    });
    for (const [k, v] of Object.entries(resp.usage || {})) if (typeof v === "number") usage[k] = (usage[k] || 0) + v;
    raw = resp.choices?.[0]?.message?.content?.trim() || "";
    if (!unusable(raw)) break;
  }

  const result = resultOf(raw);
  if (!result) console.warn(`[teaching/tools] ${tool.key} unusable (finish=${resp?.choices?.[0]?.finish_reason}, ${raw.length} chars): ${raw.slice(-160).replace(/\s+/g, " ")}`);
  if (!raw) throw new ToolError("Nothing came back — try again.", "EMPTY");
  if (!result) {
    // `detail` rides to the failed version (and the gate's evidence) so a bad answer can be diagnosed.
    throw new ToolError(parseJson(raw) ? "That came back without any sections — try again." : "That came back in an unusable shape — try again.",
      parseJson(raw) ? "NO_SECTIONS" : "UNPARSEABLE",
      { detail: `finish=${resp?.choices?.[0]?.finish_reason} chars=${raw.length} head=${raw.slice(0, 80).replace(/\s+/g, " ")} tail=${raw.slice(-160).replace(/\s+/g, " ")}` });
  }

  // Charged AFTER the call, so a failed generation is free.
  let charged = 0;
  try {
    const billTo = await schoolBillTo(userId);
    const r = await chargeForAI({
      userId, feature: `tool_${tool.key}`, model: OPENAI_MODEL,
      usage: Object.keys(usage).length ? usage : (resp.usage || {}), ref: tool.key, billTo,
    });
    charged = r?.charged || 0;
  } catch (e) {
    if (e instanceof InsufficientCoins) {
      throw new ToolError("Not enough coins to run this tool.", "INSUFFICIENT_COINS",
        { needed: e.needed, balance: e.balance });
    }
    console.error("[teaching/tools] charge failed:", e.message);
  }
  return { result, coinsCharged: charged };
}

/** Keep it in the teacher's Library. → the saved row's id (null if the save failed). */
export async function saveToolOutput({ userId, tool, input, payload }) {
  const { data, error } = await db.schema("edu").from("tool_outputs").insert({
    instructor_id: userId, tool: `teaching_${tool.key}`, kind: tool.key,
    title: input.topic || payload.title || tool.name, subject: input.subject || null,
    content: payload,
  }).select("id").maybeSingle();
  if (error) console.warn("[teaching/tools] save failed:", error.message);
  return data?.id ?? null;
}

/** What a run returns to its caller (the workbench, the task worker). */
const runResponse = (tool, input, payload, coinsCharged, outputId = null) => ({
  key: tool.key, name: tool.name, output: tool.output, ...payload,
  topic: input.topic || null, subject: input.subject || null, class: input.class || null,
  ...(tool.key === "podcast" ? { voiceA: input.voiceA, voiceB: input.voiceB } : {}),
  coinsCharged, ...(outputId ? { outputId } : {}),
});

export async function runTeachingTool({ key, body = {}, userId }) {
  const tool = byKey[key];
  if (!tool) throw new ToolError("Unknown tool", "UNKNOWN_TOOL");
  const input = cleanToolInput(tool, body);
  const { result, coinsCharged } = await generateToolResult({ tool, input, userId });
  // The template is the result. The per-tool legacy keys ride along (cards / turns /
  // grades) so the podcast narrator, the school portal and saved-output readers
  // keep working while they move over.
  const payload = toolPayload(tool, result);
  // Keep it: teachers reuse what they generated, and the tool library is where
  // they look for it — including for work a scheduled task produced overnight.
  const outputId = await saveToolOutput({ userId, tool, input, payload });
  return runResponse(tool, input, payload, coinsCharged, outputId);
}

// ── POST /api/teaching/tools/:key ────────────────────────────────────────────
router.post("/:key", teacherOnly, async (req, res) => {
  try {
    const data = await runTeachingTool({ key: req.params.key, body: req.body, userId: req.user.id });
    res.json({ success: true, data });
  } catch (e) {
    // The runner speaks in codes so both callers — this route and the task
    // worker — can react without parsing prose.
    const map = { UNKNOWN_TOOL: 404, MISSING_FIELD: 400,
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
