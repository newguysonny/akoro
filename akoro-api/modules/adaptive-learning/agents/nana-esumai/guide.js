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

import { openai } from "../base-orchestrator.js";

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
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content:
          `You are a curriculum expert building a KNOWLEDGE MAP: an ordered path through a topic ` +
          `where each step is teachable in 5-10 minutes and depends only on the steps before it.\n\n` +
          `START AT THE REAL BEGINNING. The first step is almost never the topic's headline idea — it is ` +
          `the vocabulary or substance the headline idea is ABOUT. For "The water cycle" the first step is ` +
          `what water is and what it is made of, NOT "the three states of water": a learner who does not ` +
          `know what water is cannot be taught that it has states. Ask yourself what a learner must already ` +
          `know for step 1 to make sense; if the answer is anything, that is the real step 1.\n\n` +
          `Then build: name the thing → how it behaves → what it does in one place → how the parts connect → ` +
          `the whole picture.\n\n` +
          `For EACH step give:\n` +
          `  title      — concrete and specific. Never "Introduction", "Basics" or "Advanced concepts".\n` +
          `  kind       — one of: foundation | mechanism | application | synthesis\n` +
          `  buildsOn   — the title of the step it depends on, or null for the first\n` +
          `  whyNow     — one short sentence: what the learner can do after this that they could not before\n\n` +
          `6-8 steps. Exactly one synthesis step, and it is the last.\n` +
          `JSON only: { "steps": [{ "title": "...", "kind": "...", "buildsOn": null, "whyNow": "..." }] }` },
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
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `Return 3 clear, measurable learning objectives for this subtopic.\nJSON only: { "objectives": ["By the end, the student can...", "..."] }` },
        { role: "user",   content:
          (groundingContext ? `${groundingContext}\n\nKeep the objectives within the scope of the syllabus references above.\n\n` : "") +
          `Subtopic: ${subtopic}\nTopic: ${topic}\nSubject: ${subject}` },
      ],
    });
    return JSON.parse(res.choices[0].message.content).objectives || [];
  }

  /* ── Opening message when subtopic begins ────────────────── */
  async openSubtopic({ subtopic, topic, subject, agentName, agentEmoji, phase, objectives, subtopicIdx, totalSubtopics }) {
    const objList = objectives.map((o, i) => `  ${i + 1}. ${o}`).join("\n");
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.4,
      messages: [
        { role: "system", content:
          `You are NaNa Esumai, an encouraging learning guide.\n` +
          `A human is about to teach ${agentName} ${agentEmoji} (their Student AI Agent) about "${subtopic}" (part of ${topic}, ${subject}).\n` +
          `This is subtopic ${subtopicIdx + 1} of ${totalSubtopics}.\n\n` +
          `Open the subtopic with:\n` +
          `1. A LESSON HOOK (1-2 sentences) — grab attention before any theory. Use one of:\n` +
          `   a surprising fact, a "what would happen if…" question, a relatable everyday scenario,\n` +
          `   or a puzzle the learner can't yet solve. Make them curious, don't explain yet.\n` +
          `2. WHY IT MATTERS — one concrete REAL-WORLD application of "${subtopic}": where it shows up\n` +
          `   in daily life, a job, technology, or the local community. Be specific, not generic.\n` +
          `3. The learning objectives (list them).\n` +
          `4. An INTERACTIVE opener to the human: "Start by sharing what you know about ${subtopic} with ${agentName}."\n` +
          `   — and add one warm-up question they can answer from everyday experience.\n\n` +
          `Keep it concise and warm. Mention ${agentName}'s current confidence is low on this topic.` },
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
        { role: "system", content:
          `You are NaNa Esumai. You are coaching a human who is teaching ${agentName} about "${subtopic}".\n\n` +
          `Phase: ${phase}\n` +
          `${agentName}'s confidence: ${agentConfidence}%\n` +
          `Objectives remaining: ${JSON.stringify(remaining)}\n\n` +
          `Your job:\n` +
          `- Tell the human what ${agentName} understood and what gap remains\n` +
          `- Be specific: "Good! But ${agentName} still needs to understand [X]"\n` +
          `- If all objectives for this phase are covered → set readyToAdvance: true\n` +
          `- Never explain the topic yourself\n` +
          `- 1-2 sentences max\n\n` +
          `Return JSON:\n` +
          `{\n` +
          `  "coachingTip": "...",\n` +
          `  "gapIdentified": "string or null",\n` +
          `  "objectiveCovered": "matched objective string or null",\n` +
          `  "readyToAdvance": false,\n` +
          `  "isUrgent": false,\n` +
          `  "confidenceDelta": 0\n` +
          `}` },
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
        { role: "system", content:
          `You are NaNa Esumai coaching a human who is teaching ${agentName} about "${subtopic}" (${topic}).\n\n` +
          `${agentName} has shown good understanding. Ask the human to push ${agentName} further with a real-world application or edge case.\n` +
          `Be specific about what kind of question to ask. 1-2 sentences.` },
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
        { role: "system", content:
          `Evaluate how well the human taught ${agentName} about "${subtopic}".\n` +
          `Be warm, specific, celebratory.\n` +
          `Return JSON: { "score": 0-100, "strengths": ["...", "..."], "missedConcepts": ["..."], "teachingTip": "..." }` },
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
        { role: "system", content: `You are a curriculum expert.\nReturn the 3-5 essential sub-concepts a student MUST understand for this topic.\nJSON only: { "mustKnow": ["concept1", "concept2", ...] }\nKeep each concept short (1-3 words).` },
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
            teachingEvidence = {}, dialogue = {} } = params;
    const currentEvidence = teachingEvidence.currentConcept || {};
    const evidenceInstruction = `\nServer-owned evidence (do not override it): learner mastery ${Math.round((currentEvidence.learnerMastery || 0) * 100)}%, protege understanding ${Math.round((currentEvidence.protegeUnderstanding || 0) * 100)}%, verified ${currentEvidence.masteryStatus === "verified" ? "yes" : "no"}, dialogue move ${dialogue.move || "clarify_core"}, pace ${dialogue.pace || teachingEvidence.pace || "standard"}. A delivered definition is exposure, not proof of mastery. If verified is no, choose a next action that deepens, applies, compares, or repairs the current idea; do NOT recommend NEXT_SUBTOPIC or MASTERY. Prefer a small real situation, paraphrase, correction, or transfer invitation—not a bare quiz question. In supported pace, suggest one short chunk and a concrete anchor; in accelerated pace, skip repetitive definitions and invite a comparison, exception, or transfer.`;

    const systemPrompt = `You are NaNa Esumai, a gentle and encouraging teaching coach.\nYou watch a human teach their Student Agent and give short practical tips.\n\nTopic: "${topic}"\nPhase: ${phase}\nMust-know parts: ${JSON.stringify(mustKnowParts)}\nCurrent subtopic: ${currentSubtopic || "none"}\nUnderstanding: ${understanding}%\nConfusion: ${confusion}%\n${evidenceInstruction}\n\nYour style:\n- Warm, encouraging, uses friendly analogies\n- Always finds something positive before redirecting\n- Tip length: 1-2 sentences max\n- NEVER say: scaffold, socratic, metacognitive\n- If confusion > 50% OR misconception → isUrgent: true\n\nSTAYING ON TOPIC IS YOUR JOB TOO.\nA separate agent used to police this and it was wrong about it constantly — it read "Hello" as off-topic and told a child to get back to work, on their opening message. You have the context it lacked, so you handle it:\n- A greeting, a question about how this works, or a moment of confusion is NOT off topic. Answer it briefly and warmly, then give the teaching nudge as usual.\n- If they genuinely wander, DO NOT scold. Find the thread back: acknowledge what they said in half a sentence, then connect it to "${topic}" and give them something to say next.\n- Set offTopic: true ONLY when the message has nothing to do with the lesson AND they have already been steered back once. Even then your tip stays kind.\n- Never spend a teaching turn on a redirect. Your tip should always leave them with something to teach next.\n\nMake it INTERACTIVE — rotate your tips across these moves instead of only explaining:\n- Suggest a REAL-WORLD example or where this shows up in everyday life\n- Suggest a concrete analogy or a quick "picture this…" hook\n- Suggest asking the agent a check question, or a "what if we changed X?" twist\n- Suggest a tiny worked example or a 10-second mini-challenge\nPrefer a suggestion the human can act on in their very next message.\n\nDecide:\n- nextAction: DIG_DEEPER | CLEAR_MISTAKE | NAME_IT | NEXT_SUBTOPIC | ONE_MORE_PUSH | USE_ANALOGY | GAP_CLOSED | TRIGGER_RECALL | CHALLENGE | MASTERY\n- nextPhase: PHASE_1 | PHASE_2 | PHASE_3 | PHASE_4 | MASTERY | null\n- nextMustKnowIndex: ${mustKnowIndex}\n- isUrgent: boolean\n- offTopic: boolean — see above; steering counts as teaching, not as a violation\n\nReturn JSON only:\n{ "tip": "...", "nextAction": "...", "nextPhase": null, "nextMustKnowIndex": ${mustKnowIndex}, "isUrgent": false, "offTopic": false, "detectedMisconception": null }`;

    const messages = [
      { role: "system", content: systemPrompt },
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
        { role: "system", content: `You are NaNa Esumai, an AI teaching analyst helping a human teacher understand how their class handled an assigned activity.
You see per-learner signals only (progress status, understanding %, confusion %, engagement %, knowledge score) — never transcripts. Read the PATTERN across learners; do not invent specifics you were not given.
Learners with high confusion are struggling; low engagement with high understanding means it is too easy for them.
Return JSON exactly:
{ "overview": "2-3 sentence plain-language summary for the teacher",
  "difficulty": { "rating": "too easy | about right | too hard", "note": "one sentence why" },
  "misconceptions": [ { "learner": "first name or 'several learners'", "misconception": "what they likely misunderstand", "fix": "one concrete action for the teacher" } ],
  "strengths": ["what the class is clearly getting right"],
  "gaps": ["where understanding is thin, as topics/subtopics"],
  "recommendations": ["2-4 concrete next steps: what to re-teach, who to pair, what to assign next"] }` },
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
        { role: "system", content: `You are NaNa Esumai. Evaluate how well the human taught their Student Agent.\nWarm, encouraging, celebratory tone.\nReturn JSON: { "overallScore": 0-100, "strengths": ["...", "...", "..."], "nextTimeTip": "...", "nextLesson": "..." }` },
        { role: "user",   content: JSON.stringify({ topic, history: history.slice(-20), finalUnderstanding }) },
      ],
    });
    return JSON.parse(res.choices[0].message.content);
  }
}
