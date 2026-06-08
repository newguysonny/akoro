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
  async generateSubtopics(topic, subject) {
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.25,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `You are a curriculum expert.\nReturn 5-6 subtopics a student should understand for this topic in this subject.\nOrder them from foundational → advanced.\nJSON only: { "subtopics": ["subtopic1", "subtopic2", ...] }` },
        { role: "user",   content: `Topic: ${topic}\nSubject: ${subject}` },
      ],
    });
    return JSON.parse(res.choices[0].message.content).subtopics || [];
  }

  /* ── Generate learning objectives per subtopic ───────────── */
  async generateObjectives(subtopic, topic, subject) {
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `Return 3 clear, measurable learning objectives for this subtopic.\nJSON only: { "objectives": ["By the end, the student can...", "..."] }` },
        { role: "user",   content: `Subtopic: ${subtopic}\nTopic: ${topic}\nSubject: ${subject}` },
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
          `1. Brief warm welcome (1 sentence)\n` +
          `2. The learning objectives (list them)\n` +
          `3. Instruction to the human: "Start by sharing what you know about ${subtopic} with ${agentName}."\n\n` +
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
            understanding, confusion, history, mustKnowParts, mustKnowIndex } = params;

    const systemPrompt = `You are NaNa Esumai, a gentle and encouraging teaching coach.\nYou watch a human teach their Student Agent and give short practical tips.\n\nTopic: "${topic}"\nPhase: ${phase}\nMust-know parts: ${JSON.stringify(mustKnowParts)}\nCurrent subtopic: ${currentSubtopic || "none"}\nUnderstanding: ${understanding}%\nConfusion: ${confusion}%\n\nYour style:\n- Warm, encouraging, uses friendly analogies\n- Always finds something positive before redirecting\n- Tip length: 1-2 sentences max\n- NEVER say: scaffold, socratic, metacognitive\n- If confusion > 50% OR misconception → isUrgent: true\n\nDecide:\n- nextAction: DIG_DEEPER | CLEAR_MISTAKE | NAME_IT | NEXT_SUBTOPIC | ONE_MORE_PUSH | USE_ANALOGY | GAP_CLOSED | TRIGGER_RECALL | CHALLENGE | MASTERY\n- nextPhase: PHASE_1 | PHASE_2 | PHASE_3 | PHASE_4 | MASTERY | null\n- nextMustKnowIndex: ${mustKnowIndex}\n- isUrgent: boolean\n\nReturn JSON only:\n{ "tip": "...", "nextAction": "...", "nextPhase": null, "nextMustKnowIndex": ${mustKnowIndex}, "isUrgent": false, "detectedMisconception": null }`;

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
