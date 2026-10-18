/**
 * agents/nana-esumai/guide.js
 *
 * NaNa Esumai — Learning guide for the "human teaches agent" flow.
 *
 * Role: Monitors the HUMAN's teaching quality.
 *       Never teaches directly — only coaches the human.
 *       Tells human what gap Nexus still has.
 *       Confirms knowledge delta after each successful explanation.
 *       Signals phase transitions (1 → 2 → 3 → 4 → assessment).
 */

import { guidePassagesBlock } from "../../documentGrounding.js";
import { openai } from "../base-orchestrator.js";
// P2 (Context Layer Adoption): every prompt below loads VERBATIM from the
// akoro-agent/ workspace via these builders — byte-identical to the
// pre-migration literals, pinned by agentContext.golden.personas.test.mjs.
import {
  buildKnowledgeMapPrompt, buildObjectivesPrompt, buildOpenSubtopicPrompt, buildCoachTurnPrompt,
  buildPushFurtherPrompt, buildEvaluateSubtopicPrompt, buildMustKnowPrompt, buildEvidenceInstruction,
  buildTipDecisionPrompt, buildClassAnalyticsPrompt, buildEvaluateSessionPrompt,
} from "../../../agent-context/personas/nana-esumai.js";

/**
 * Turn whatever the model returned into a ladder that holds its shape.
 *
 * Exported and pure so it can be tested without a model — this is the part that
 * can be wrong in a way nobody would notice, since a mis-ordered ladder still
 * renders perfectly.
 *
 * Guarantees, whatever arrives:
 *   · every entry has a non-empty title
 *   · the first depends on nothing
 *   · every other depends on an EARLIER step, never a later one — a forward
 *     dependency is a loop the learner cannot climb
 *   · kind is one of the four, defaulting to mechanism
 */
export function normaliseLadder(rawSteps) {
  const steps = (Array.isArray(rawSteps) ? rawSteps : [])
    .filter((s) => s && typeof s.title === "string" && s.title.trim());

  return {
    subtopics: steps.map((s) => s.title.trim()),
    map: steps.map((s, i) => ({
      title: s.title.trim(),
      kind: ["foundation", "mechanism", "application", "synthesis"].includes(s.kind) ? s.kind : "mechanism",
      // An INDEX, not the title the model gave. It returns the previous step's
      // wording, which drifts by a word and then matches nothing; and a
      // dependency pointing forwards is silently repaired to the step before,
      // because "builds on something you have not learned yet" is not a thing.
      buildsOn: i === 0 ? null : (() => {
        const named = steps.findIndex((x) => x.title?.trim() === String(s.buildsOn ?? "").trim());
        return named >= 0 && named < i ? named : i - 1;
      })(),
      whyNow: typeof s.whyNow === "string" ? s.whyNow.trim() : "",
    })),
  };
}

export class NaNaEsumai {

  static profile = {
    id:          "nana-esumai",
    name:        "NaNa Esumai",
    description: "Learning guide. Coaches human teaching quality. Never teaches directly.",
    style:       "encouraging-coach",
    avatar:      "🧠",
  };

  constructor() { this.name = "NaNa Esumai"; }

  /* ── Generate subtopics for a topic ──────────────────────── */
  /**
   * Build the lesson ladder — an ORDERED knowledge map, not a list of parts.
   *
   * The previous prompt asked for a progression and mostly got a table of
   * contents. On "The water cycle" it opened with "States of Water: Solid,
   * Liquid, and Gas" — which is not the beginning. A learner who does not yet
   * know what water IS, or that it is made of something, cannot be taught that
   * it has three states; the ladder started on the second rung and left the
   * first one missing.
   *
   * So each rung is now asked for explicitly, with what it BUILDS ON and why it
   * comes where it does. Making the model state the dependency is what forces
   * the order to be real: it cannot claim rung 4 builds on rung 3 if it does
   * not, and writing the reason down is what surfaces a missing foundation.
   *
   * Returns { subtopics, map } — subtopics stays a plain array of strings
   * because everything downstream indexes it that way, and the map rides
   * alongside for anything that wants the structure.
   */
  async generateSubtopics(topic, subject, groundingContext = "", opts = {}) {
    const res = await openai.chat.completions.create({
      // The eval suite points this same path at a different tier — comparing
      // models on "does the ladder start at the beginning" is the only way that
      // property is more than an assertion.
      model: opts.model || "gpt-4.1-mini", temperature: 0.25,
      __feature: opts.feature || undefined, __userId: opts.userId || undefined,
      // Bounded: the SDK defaults (10-min timeout, 2 retries) once let one
      // stalled call hang a whole chat turn past the browser's patience.
      __timeoutMs: 45_000, __maxRetries: 1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: await buildKnowledgeMapPrompt() },
        { role: "user",   content:
          (groundingContext
            ? `${groundingContext}\n\nBuild the map STRICTLY from the syllabus references above — use their wording and scope. Do not introduce material they don't cover.\n\n`
            : "") +
          `Topic: ${topic}\nSubject: ${subject}` },
      ],
    });

    let steps = [];
    try { steps = JSON.parse(res.choices[0].message.content).steps || []; } catch { steps = []; }
    return normaliseLadder(steps);
  }

  /* ── Generate learning objectives per subtopic ───────────── */
  async generateObjectives(subtopic, topic, subject, groundingContext = "") {
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.2,
      __timeoutMs: 45_000, __maxRetries: 1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: await buildObjectivesPrompt() },
        { role: "user",   content:
          (groundingContext ? `${groundingContext}\n\nKeep the objectives within the scope of the syllabus references above.\n\n` : "") +
          `Subtopic: ${subtopic}\nTopic: ${topic}\nSubject: ${subject}` },
      ],
    });
    return JSON.parse(res.choices[0].message.content).objectives || [];
  }

  /* ── Assignment workbench: draft graded questions ────────── */
  /**
   * One bounded JSON call for an assignment's questions. The messages are
   * built by modules/self-study/questionPaper.js from the teacher's own
   * request ("5 questions, 3 MCQ, 2 theory") — first drafts and follow-up
   * versions alike — which also checks the result against the request and
   * retries once. `response_format` is the paper's strict JSON schema
   * (self-study/paperSchema.js); a model that refuses the schema falls
   * back to plain JSON mode once. → the model's JSON string.
   */
  async generateAssignmentQuestions({ messages, billing = {}, response_format = null }) {
    const call = (format) => openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.3, max_tokens: 6000,
      __timeoutMs: 45_000, __maxRetries: 1,
      response_format: format,
      messages,
      ...billing,
    });
    let res;
    try {
      res = await call(response_format || { type: "json_object" });
    } catch (e) {
      if (!response_format || e?.status !== 400) throw e;
      res = await call({ type: "json_object" });
    }
    return res.choices?.[0]?.message?.content || "{}";
  }

  /* ── Assignment workbench: draft the marking rubric ──────── */
  /**
   * Draft a rubric — criteria with points — for the same brief. When the
   * total is known the criteria points sum to it; without one the model
   * returns percentage weights, which the workbench shows as-is until the
   * instructor sets a total.
   */
  async generateAssignmentRubric({ topic, subject, totalPoints, questionTypes }) {
    const types = (Array.isArray(questionTypes) && questionTypes.length) ? questionTypes.join(", ") : null;
    const total = Number(totalPoints) || null;
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.25,
      __timeoutMs: 45_000, __maxRetries: 1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content:
          "You write marking rubrics for school assignments. 3 to 6 criteria, each a short noun phrase a teacher can grade against. " +
          (total
            ? `The criteria points must sum EXACTLY to ${total}.`
            : "Return percentage weights that sum to 100.") +
          ' Return JSON: { "rubric": [ { "criterion": string, "points": number } ] }' },
        { role: "user", content:
          `Topic: ${topic}\nSubject: ${subject}` +
          (total ? `\nTotal points: ${total}` : "") +
          (types ? `\nQuestion types in the assignment: ${types}` : "") },
      ],
    });
    let rubric = [];
    try { rubric = JSON.parse(res.choices[0].message.content).rubric || []; } catch { rubric = []; }
    return rubric
      .filter(r => r && typeof r.criterion === "string" && r.criterion.trim())
      .map(r => ({ criterion: r.criterion.trim(), points: Number(r.points) || 0 }));
  }

  /* ── Opening message when subtopic begins ────────────────── */
  async openSubtopic({ subtopic, topic, subject, agentName, agentEmoji, phase, objectives, subtopicIdx, totalSubtopics }) {
    const objList = objectives.map((o, i) => `  ${i + 1}. ${o}`).join("\n");
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.4,
      messages: [
        { role: "system", content: await buildOpenSubtopicPrompt({
          subtopic, topic, subject, agentName, agentEmoji,
          subtopicNumber: subtopicIdx + 1, totalSubtopics,
        }) },
        { role: "user", content: `Objectives:\n${objList}` },
      ],
    });
    return res.choices[0].message.content;
  }

  /* ── Coaching tip after each human message ───────────────── */
  async coachHuman({
    subtopic, topic, agentName, phase,
    humanMessage, agentResponse, agentConfidence,
    objectives, objectivesCovered,
    history,
  }) {
    const remaining = objectives.filter(o => !objectivesCovered.includes(o));
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: await buildCoachTurnPrompt({
          subtopic, phase, agentName, agentConfidence, remaining: JSON.stringify(remaining),
        }) },
        { role: "user", content: JSON.stringify({ humanMessage, agentResponse, recentHistory: history.slice(-4) }) },
      ],
    });
    return JSON.parse(res.choices[0].message.content);
  }

  /* ── Phase 3 prompt: ask Nexus to teach it back ──────────── */
  async promptTeachBack({ subtopic, agentName }) {
    return `${agentName}, let's see what you've learned. Explain "${subtopic}" back to your human — in your own words, as if they've never heard of it.`;
  }

  /* ── Phase 4 prompt: push further ───────────────────────── */
  async pushFurther({ subtopic, topic, agentName, humanMessage, agentResponse }) {
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.4,
      messages: [
        { role: "system", content: await buildPushFurtherPrompt({ subtopic, topic, agentName }) },
        { role: "user", content: JSON.stringify({ humanMessage, agentResponse }) },
      ],
    });
    return res.choices[0].message.content;
  }

  /* ── Session/subtopic evaluation ────────────────────────── */
  async evaluateSubtopic({ subtopic, agentName, finalConfidence, objectivesCovered, history }) {
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: await buildEvaluateSubtopicPrompt({ subtopic, agentName }) },
        { role: "user", content: JSON.stringify({ finalConfidence, objectivesCovered, recentHistory: history.slice(-8) }) },
      ],
    });
    return JSON.parse(res.choices[0].message.content);
  }

  /* ═══ OLD interface — needed by StudentSessionOrchestrator (decay flow) ══════
     These methods match the nana-sargeant/guide.js interface exactly.
     Used when NaNaEsumaiOrchestrator is the guideOrchestrator for decay sessions.
  ══════════════════════════════════════════════════════════════════════════════*/

  async detectMustKnowParts(topic) {
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: await buildMustKnowPrompt() },
        { role: "user",   content: `Topic: ${topic}` },
      ],
    });
    return JSON.parse(res.choices[0].message.content).mustKnow || [];
  }

  buildTeachingPlan(topic, mustKnowParts) {
    const parts = mustKnowParts.length > 0
      ? mustKnowParts.map(p => `    • ${p}`).join("\n")
      : "    • (detecting from topic...)";
    return [
      `🧠 NaNa Esumai — Teaching Plan:`,
      `• Phase 1 — Find out what Student Agent already knows`,
      `• Phase 2 — Must-know parts:\n${parts}`,
      `• Phase 3 — Student Agent teaches it back`,
      `• Phase 4 — Push a little further`,
    ].join("\n");
  }

  async getTip(params, onChunk = null) {
    const { topic, phase, currentSubtopic, humanMessage, studentResponse,
            understanding, confusion, history, mustKnowParts, mustKnowIndex,
            teachingEvidence = {}, dialogue = {}, reference = null } = params;
    const evidenceInstruction = await buildEvidenceInstruction({ teachingEvidence, dialogue });

    const systemPrompt = await buildTipDecisionPrompt({
      topic, phase,
      mustKnowParts: JSON.stringify(mustKnowParts),
      currentSubtopic: currentSubtopic || "none",
      understanding, confusion,
      evidenceInstruction, mustKnowIndex,
    });

    const messages = [
      { role: "system", content: systemPrompt + guidePassagesBlock(reference) },
      { role: "user",   content: JSON.stringify({ humanMessage, studentResponse, recentHistory: history.slice(-4) }) },
    ];

    if (onChunk) {
      const stream = await openai.chat.completions.create({ model: "gpt-4.1-mini", temperature: 0.3, stream: true, messages });
      let full = "";
      for await (const chunk of stream) { const d = chunk.choices[0]?.delta?.content || ""; if (d) { full += d; onChunk(d); } }
      return JSON.parse(full);
    }
    const res = await openai.chat.completions.create({ model: "gpt-4.1-mini", temperature: 0.3, response_format: { type: "json_object" }, messages });
    return JSON.parse(res.choices[0].message.content);
  }

  /**
   * classAnalytics — an AI read of one assigned activity's class results.
   *
   * Consumes only aggregate teaching signals (status, understanding,
   * confusion, engagement, knowledge score — first names, no transcripts),
   * so the report explains the class rather than quoting it.
   */
  async classAnalytics(brief, learners) {
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.25,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: await buildClassAnalyticsPrompt() },
        { role: "user", content: JSON.stringify({ brief, learners }) },
      ],
    });
    return JSON.parse(res.choices[0].message.content);
  }

  async evaluateSession(topic, history, finalUnderstanding) {
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: await buildEvaluateSessionPrompt() },
        { role: "user",   content: JSON.stringify({ topic, history: history.slice(-20), finalUnderstanding }) },
      ],
    });
    return JSON.parse(res.choices[0].message.content);
  }
}
