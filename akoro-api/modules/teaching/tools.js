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
const HOUSE = "You support Nigerian secondary school teachers. Be concrete and classroom-ready — real examples, real materials, nothing generic. Never invent exam results, statistics or citations.";

export const TOOLS = [
  {
    key: "podcast", name: "Podcast Generator", emoji: "🎧", output: "script",
    blurb: "Turn a topic into an engaging two-host audio episode, with a transcript you can read along.",
    fields: [F.topic, F.subject, F.klass,
      { name: "minutes", label: "Length", type: "select", options: ["3", "5", "10"], default: "5" },
      { name: "hosts", label: "Format", type: "select", options: ["Two hosts", "Single narrator"], default: "Two hosts" },
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
    key: "misconceptions", name: "Common Misconceptions", emoji: "🧠", output: "markdown",
    blurb: "The wrong ideas students arrive with, where they'll struggle, and how to fix each one.",
    fields: [F.topic, F.subject, F.klass, F.notes], maxTokens: 1800,
    system: `${HOUSE} You write in Markdown with clear headings. For each misconception give: what students believe, WHY it feels right to them, what actually happens, and a specific teaching move that corrects it.`,
    prompt: (i) => `Topic: "${i.topic}"${i.subject ? ` · Subject: ${i.subject}` : ""}${i.class ? ` · Class: ${i.class}` : ""}.
${i.notes ? `Context: ${i.notes}\n` : ""}
Write:
1. **Common misconceptions** — 5–7, each with belief / why it feels right / the correction / a teaching move.
2. **Where students struggle** — the specific steps or ideas that trip them up.
3. **Strategies that work** — concrete classroom tactics, not general advice.
4. **Quick check questions** — 5 questions that expose whether a student still holds a misconception.`,
  },
  {
    key: "real-world", name: "Real-World Connections", emoji: "🌍", output: "markdown",
    blurb: "Why this topic matters — everyday contexts, local examples, and the careers built on it.",
    fields: [F.topic, F.subject, F.klass, F.notes], maxTokens: 1800,
    system: `${HOUSE} You write in Markdown. Ground examples in Nigerian and West African daily life where it fits naturally — markets, farming, transport, weather, mobile money, local industry — without forcing it.`,
    prompt: (i) => `Topic: "${i.topic}"${i.subject ? ` · Subject: ${i.subject}` : ""}${i.class ? ` · Class: ${i.class}` : ""}.
${i.notes ? `Context: ${i.notes}\n` : ""}
Write:
1. **Where students already meet this** — everyday situations they'd recognise.
2. **Real-world applications** — how it's actually used, with specifics.
3. **Careers & professions** — roles that depend on this, what the work involves, what to study.
4. **Discussion prompts** — 5 questions that connect the lesson to students' own lives.
5. **A class activity** — one thing they can do or observe outside the classroom.`,
  },
  {
    key: "lesson-hooks", name: "Lesson Hooks", emoji: "🪝", output: "markdown",
    blurb: "Openings that grab the class in the first two minutes — with materials and outcomes.",
    fields: [F.topic, F.subject, F.klass, F.notes], maxTokens: 1600,
    system: `${HOUSE} You write in Markdown. A hook is something the teacher DOES in the first 2 minutes — a demonstration, a question with a surprising answer, a story, a challenge. Every hook must be runnable with materials a Nigerian classroom actually has.`,
    prompt: (i) => `Topic: "${i.topic}"${i.subject ? ` · Subject: ${i.subject}` : ""}${i.class ? ` · Class: ${i.class}` : ""}.
${i.notes ? `Context: ${i.notes}\n` : ""}
Give 5 different hooks. For each: **Name**, what the teacher says or does (word for word where it helps), materials needed, how long it takes, and the bridge sentence into the lesson.
Then close with:
- **Expected outcomes** — what students should be able to do by the end.
- **Materials checklist** — everything needed, combined.`,
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
    key: "lesson-plan", name: "Lesson Plan", emoji: "📋", output: "markdown",
    blurb: "A full period plan — objectives, timings, activities, differentiation and assessment.",
    fields: [F.topic, F.subject, F.klass,
      { name: "duration", label: "Period length", type: "select", options: ["35 minutes", "40 minutes", "45 minutes", "60 minutes", "Double period"], default: "40 minutes" },
      { name: "objectives", label: "Your objectives", placeholder: "Optional — leave blank and I'll write them", long: true },
      F.notes],
    maxTokens: 2200,
    system: `${HOUSE} You write lesson plans in Markdown that a teacher can follow minute by minute. Every activity states what the TEACHER does and what the STUDENTS do.`,
    prompt: (i) => `Write a ${i.duration || "40 minute"} lesson plan.
Topic: "${i.topic}"${i.subject ? ` · Subject: ${i.subject}` : ""}${i.class ? ` · Class: ${i.class}` : ""}
${i.objectives ? `Objectives to cover:\n${i.objectives}\n` : ""}${i.notes ? `Context: ${i.notes}\n` : ""}
Include: learning objectives, prior knowledge assumed, materials, a timed breakdown (introduction / development / practice / close) with teacher and student actions, differentiation for strugglers and fast finishers, assessment for learning, homework, and the board plan.`,
  },
  {
    key: "assignment", name: "Assignment Creator", emoji: "✍️", output: "markdown",
    blurb: "Homework or classwork with a marking scheme, at the difficulty you choose.",
    fields: [F.topic, F.subject, F.klass,
      { name: "type", label: "Type", type: "select", options: ["Homework", "Classwork", "Project", "Practice questions", "Group task"], default: "Homework" },
      { name: "count", label: "How many questions", type: "select", options: ["5", "10", "15", "20"], default: "10" },
      { name: "difficulty", label: "Difficulty", type: "select", options: ["Mixed", "Foundation", "Standard", "Challenge"], default: "Mixed" },
      F.notes],
    maxTokens: 2400,
    system: `${HOUSE} You write assignments in Markdown. Questions are unambiguous and answerable from what was taught. The marking scheme is separated clearly so the teacher can hand out the questions alone.`,
    prompt: (i) => `Create a ${String(i.type || "homework").toLowerCase()} of ${i.count || 10} questions on "${i.topic}"${i.subject ? ` (${i.subject})` : ""}${i.class ? `, ${i.class}` : ""}. Difficulty: ${i.difficulty || "Mixed"}.
${i.notes ? `Context: ${i.notes}\n` : ""}
Include: instructions for students, mark allocation per question, the questions themselves, then a clearly separated **Marking scheme** with answers and where marks are awarded.
Finish with an estimate of how long it should take a student.`,
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

// ── GET /api/teaching/tools ──────────────────────────────────────────────────
router.get("/", teacherOnly, (req, res) => {
  res.json({
    success: true,
    data: TOOLS.map(({ key, name, emoji, blurb, output, fields }) => ({ key, name, emoji, blurb, output, fields })),
  });
});

// ── POST /api/teaching/tools/:key ────────────────────────────────────────────
router.post("/:key", teacherOnly, async (req, res) => {
  try {
    const tool = byKey[req.params.key];
    if (!tool) return res.status(404).json({ error: "Unknown tool" });

    const input = {};
    for (const f of tool.fields) {
      const v = req.body?.[f.name];
      input[f.name] = v === undefined || v === null ? "" : String(v).trim();
      if (f.required && !input[f.name]) return res.status(400).json({ error: `${f.label} is required` });
      if (!input[f.name] && f.default) input[f.name] = f.default;
    }

    const resp = await openai.chat.completions.create({
      model: OPENAI_MODEL, max_tokens: tool.maxTokens, temperature: 0.6,
      messages: [{ role: "system", content: tool.system }, { role: "user", content: tool.prompt(input) }],
    });
    const raw = resp.choices?.[0]?.message?.content?.trim() || "";

    let payload;
    if (tool.output === "markdown") {
      if (!raw) return res.status(422).json({ error: "Nothing came back — try again." });
      payload = { content: raw.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "") };
    } else {
      const data = parseJson(raw);
      if (!data) return res.status(422).json({ error: "That came back in an unusable shape — try again." });
      payload = { ...data, content: asMarkdown(tool, data) };
    }

    // Charged AFTER the call, so a failed generation is free.
    let charged = 0;
    try {
      const billTo = await schoolBillTo(req.user.id);
      const r = await chargeForAI({
        userId: req.user.id, feature: `tool_${tool.key}`, model: OPENAI_MODEL,
        usage: resp.usage || {}, ref: tool.key, billTo,
      });
      charged = r?.charged || 0;
    } catch (e) {
      if (e instanceof InsufficientCoins) {
        return res.status(402).json({ error: "Not enough coins to run this tool.", code: "INSUFFICIENT_COINS", needed: e.needed, balance: e.balance });
      }
      console.error("[teaching/tools] charge failed:", e.message);
    }

    // Keep it: teachers reuse what they generated, and the tool library is
    // where they look for it.
    db.schema("edu").from("tool_outputs").insert({
      instructor_id: req.user.id, tool: `teaching_${tool.key}`, kind: tool.key,
      title: input.topic || payload.title || tool.name, subject: input.subject || null,
      content: payload,
    }).then(({ error }) => { if (error) console.warn("[teaching/tools] save failed:", error.message); });

    res.json({ success: true, data: { key: tool.key, output: tool.output, ...payload, coinsCharged: charged } });
  } catch (e) { serverError(res, e, req); }
});

// ── POST /api/teaching/tools/podcast/audio ───────────────────────────────────
// Narrate a script produced by the podcast tool. Two hosts get two voices, so
// the episode sounds like a conversation rather than one person reading.
const VOICES = ["alloy", "nova", "echo", "shimmer", "fable", "onyx"];
const TTS_LIMIT = 12000;  // characters — roughly a 12-minute episode

router.post("/podcast/audio", teacherOnly, async (req, res) => {
  try {
    const turns = Array.isArray(req.body?.turns) ? req.body.turns : null;
    if (!turns?.length) return res.status(400).json({ error: "Nothing to narrate" });

    const speakers = [...new Set(turns.map((t) => String(t.speaker || "Host")))].slice(0, 2);
    const voiceOf = Object.fromEntries(speakers.map((s, i) => [s, VOICES[i] || "alloy"]));

    const total = turns.reduce((n, t) => n + String(t.text || "").length, 0);
    if (total > TTS_LIMIT) return res.status(413).json({ error: "That episode is too long to narrate in one go. Shorten it and try again." });

    const billTo = await schoolBillTo(req.user.id);
    const { ok } = await coinsAvailable({ userId: req.user.id, billTo, min: 1 });
    if (!ok) return res.status(402).json({ error: "Not enough coins to narrate this episode.", code: "INSUFFICIENT_COINS" });

    // One request per turn, concatenated. MP3 frames are self-contained, so
    // joining the buffers plays as a single continuous episode.
    const parts = [];
    for (const t of turns) {
      const text = String(t.text || "").trim();
      if (!text) continue;
      const speech = await openai.audio.speech.create({
        model: "tts-1", voice: voiceOf[String(t.speaker || "Host")] || "alloy",
        input: text.slice(0, 4000), response_format: "mp3",
      });
      parts.push(Buffer.from(await speech.arrayBuffer()));
    }
    if (!parts.length) return res.status(422).json({ error: "Nothing to narrate" });

    // Charged on the characters actually sent — same rate as voice TTS.
    let charged = 0;
    try {
      const r = await debitCoins({
        userId: req.user.id, coins: Math.max(1, Math.ceil(total / 1000)),
        feature: "tool_podcast_tts", model: "tts-1", ref: "podcast", billTo,
      });
      charged = r?.charged ?? r?.coins ?? 0;
    } catch (e) {
      if (e instanceof InsufficientCoins) return res.status(402).json({ error: "Not enough coins to narrate this episode.", code: "INSUFFICIENT_COINS" });
      console.error("[teaching/tools] tts charge failed:", e.message);
    }

    const audio = Buffer.concat(parts);
    res.json({
      success: true,
      data: { audio: `data:audio/mpeg;base64,${audio.toString("base64")}`, voices: voiceOf, coinsCharged: charged },
    });
  } catch (e) { serverError(res, e, req); }
});

export default router;
