// =============================================================
// agents/trained/control.js
// DB-powered control agent for trained teachers.
// Boundary style, redirect tone all driven from DB config.
// =============================================================

import OpenAI from "openai";
import { buildControlPrompt } from "../../training/agentPromptBuilder.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export class TrainedControl {
  constructor(config, teacherProfile) {
    this.config         = config;
    this.teacherProfile = teacherProfile;
    this.name           = teacherProfile?.teacher_name
      ? `${teacherProfile.teacher_name}'s Focus Monitor`
      : "Focus Monitor";

    this.allowedTopics   = new Set();
    this.totalChecks     = 0;
    this.driftEventCount = 0;
  }

  async getTopicBoundary(topic) {
    const cc = this.config.control_config || {};

    // Use teacher's known concepts as allowed topics
    const taught = this.teacherProfile?.concepts_taught || [];

    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Define ON-topic and OFF-topic for this session.
This teacher has taught: ${taught.slice(0, 10).join(", ")}.
Return JSON:
{
  "allowed":  ["concept1", "concept2", "concept3", "concept4"],
  "offTopic": ["thing1", "thing2", "thing3", "thing4"],
  "boundaryStatement": "one sentence"
}`,
        },
        { role: "user", content: `Topic: ${topic}` },
      ],
    });

    const boundary = JSON.parse(res.choices[0].message.content);
    boundary.allowed.forEach(c => this.allowedTopics.add(c.toLowerCase()));
    return boundary;
  }

  async checkForDrift(recentHistory, intendedTopic) {
    this.totalChecks++;

    const systemPrompt = await buildControlPrompt({
      config:         this.config,
      intendedTopic,
      allowedTopics:  Array.from(this.allowedTopics),
    });

    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            recentHistory: recentHistory.slice(-4),
            intendedTopic,
          }),
        },
      ],
    });

    const result = JSON.parse(res.choices[0].message.content);
    const cc     = this.config.control_config || {};

    if (result.driftLevel === "edge" && cc.edgeTopicPolicy !== "block-all-edges") {
      result.isDrifting = false;
    }
    if (result.driftLevel === "drift") this.driftEventCount++;
    return result;
  }

  generateRedirectMessage(driftInfo, topic) {
    const cc       = this.config.control_config || {};
    const phrases  = cc.redirectPhrases || [];
    const baseMsg  = driftInfo.redirectMessage || `Let's stay focused on ${topic}.`;

    if (phrases.length > 0) {
      return `${this.name}: ${phrases[0]} — ${baseMsg}`;
    }
    return `${this.name}: ⚠️ Let's bring this back to ${topic}.\n\n${baseMsg}`;
  }

  getFinalReport() {
    const passed = this.totalChecks - this.driftEventCount;
    return {
      driftEvents: this.driftEventCount,
      totalChecks: this.totalChecks,
      passed,
      summary: this.driftEventCount === 0
        ? `🛡️ Zero drift detected. Perfect focus.\n   All topic checks passed: ${passed}/${this.totalChecks} ✅`
        : `🛡️ ${this.driftEventCount} drift event(s) caught.\n   Topic checks: ${passed}/${this.totalChecks} ✅`,
    };
  }
}
