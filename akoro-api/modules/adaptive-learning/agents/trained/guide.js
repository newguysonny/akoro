// =============================================================
// agents/trained/guide.js
// DB-powered guide agent for trained teachers.
// All personality, phases, and tips driven from DB config.
// =============================================================

import { buildGuidePrompt } from "../../training/agentPromptBuilder.js";
import { buildTrainedMustKnowPrompt, buildTrainedEvaluateSessionPrompt } from "../../../agent-context/personas/trained.js";

import { openai } from "../../../../lib/aiModel.js";

export class TrainedGuide {
  constructor(config, teacherProfile) {
    this.config         = config;
    this.teacherProfile = teacherProfile;
    this.name           = teacherProfile?.teacher_name
      ? `${teacherProfile.teacher_name}'s Guide`
      : "Teaching Guide";
  }

  async detectMustKnowParts(topic) {
    // Use teacher's key concepts if available
    const taught = this.teacherProfile?.concepts_taught || [];
    if (taught.length > 0) {
      // Filter relevant to topic
      const relevant = taught.filter(c =>
        c.toLowerCase().includes(topic.toLowerCase()) ||
        topic.toLowerCase().includes(c.toLowerCase())
      );
      if (relevant.length > 0) return relevant.slice(0, 5);
    }

    // Fallback: GPT derive
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: await buildTrainedMustKnowPrompt(),
        },
        { role: "user", content: `Topic: ${topic}` },
      ],
    });
    return JSON.parse(res.choices[0].message.content).mustKnow || [];
  }

  buildTeachingPlan(topic, mustKnowParts) {
    const phases = this.config.phase_definitions?.phases || [];
    const gc     = this.config.guide_config || {};

    const phaseList = phases.length > 0
      ? phases.map((p, i) => `• ${p.label}`).join("\n")
      : mustKnowParts.map((p, i) => `• Part ${i + 1}: ${p}`).join("\n");

    return [
      `📚 ${this.name} — Teaching Plan:`,
      phaseList,
      gc.masteryDefinition ? `\n✅ Mastery: ${gc.masteryDefinition}` : "",
    ].filter(Boolean).join("\n");
  }

  async getTip(params, onChunk = null) {
    const systemPrompt = await buildGuidePrompt({
      config:          this.config,
      topic:           params.topic,
      phase:           params.phase,
      currentSubtopic: params.currentSubtopic,
      understanding:   params.understanding,
      confusion:       params.confusion,
      mustKnowParts:   params.mustKnowParts,
      mustKnowIndex:   params.mustKnowIndex,
    });

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          humanMessage:   params.humanMessage,
          studentResponse: params.studentResponse,
          recentHistory:  params.history.slice(-4),
        }),
      },
    ];

    if (onChunk) {
      const stream = await openai.chat.completions.create({
        model: "gpt-4.1-mini", temperature: 0.3, stream: true, messages,
      });
      let full = "";
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || "";
        if (delta) { full += delta; onChunk(delta); }
      }
      return JSON.parse(full);
    }

    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.3,
      response_format: { type: "json_object" }, messages,
    });
    return JSON.parse(res.choices[0].message.content);
  }

  async evaluateSession(topic, history, finalUnderstanding) {
    const gc = this.config.guide_config || {};
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: await buildTrainedEvaluateSessionPrompt({ name: this.name, tone: gc.tone || "encouraging" }),
        },
        {
          role: "user",
          content: JSON.stringify({ topic, history: history.slice(-20), finalUnderstanding }),
        },
      ],
    });
    return JSON.parse(res.choices[0].message.content);
  }
}
