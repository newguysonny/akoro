/**
 * agents/sargeant/assessment.js
 *
 * Sargeant — Assessment gate between subtopics.
 *
 * Role: Quizzes the Student AI Agent (Nexus) exclusively.
 *       Appears ONLY between subtopics.
 *       No hints. Human cannot intervene.
 *       Pass ≥ 70% → advance. Block < 70% → re-teach.
 *
 * Also handles topic-boundary drift checking during teaching phases.
 */

import { openai } from "../base-orchestrator.js";
// P2 (Context Layer Adoption): prompts load VERBATIM from the akoro-agent/
// workspace — byte-identical to the pre-migration literals, pinned by
// agentContext.golden.personas.test.mjs.
import {
  buildAssessmentQuestionsPrompt, buildAssessmentEvaluatePrompt,
  buildAssessmentVerdictPrompt, buildAssessmentDriftPrompt,
} from "../../../agent-context/personas/sargeant.js";

export class Sargeant {

  static profile = {
    id:          "sargeant",
    name:        "Sargeant",
    description: "Assessment gate. Strict. Quizzes Student Agent before subtopic advance.",
    style:       "strict",
    avatar:      "⚡",
  };

  constructor() {
    this.name            = "Sargeant";
    this.totalChecks     = 0;
    this.driftEventCount = 0;
  }

  /* ── Generate assessment questions for a subtopic ─────────── */
  async generateQuestions({ subtopic, topic, subject, objectives, agentName }) {
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: await buildAssessmentQuestionsPrompt({ subtopic, agentName }) },
        { role: "user", content: `Subtopic: ${subtopic}\nTopic: ${topic}\nObjectives: ${JSON.stringify(objectives)}` },
      ],
    });
    return JSON.parse(res.choices[0].message.content);
  }

  /* ── Evaluate an agent's answer to one question ─────────── */
  async evaluateAnswer({ question, answer, subtopic, objective }) {
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: await buildAssessmentEvaluatePrompt() },
        { role: "user", content: JSON.stringify({ question, answer, subtopic, objective }) },
      ],
    });
    return JSON.parse(res.choices[0].message.content);
  }

  /* ── Full assessment flow (questions + eval) ─────────────── */
  async runAssessment({ subtopic, topic, subject, objectives, agentName, agentAnswers }) {
    if (!agentAnswers || agentAnswers.length < 1) {
      return { passed: false, score: 0, feedback: "No answers provided.", needsReteach: true };
    }

    const questions = await this.generateQuestions({ subtopic, topic, subject, objectives, agentName });

    let totalScore = 0;
    const evaluations = [];

    for (let i = 0; i < Math.min(agentAnswers.length, 2); i++) {
      const q   = i === 0 ? questions.q1 : questions.q2;
      const obj = objectives[i] || objectives[0] || subtopic;
      const ev  = await this.evaluateAnswer({ question: q, answer: agentAnswers[i], subtopic, objective: obj });
      evaluations.push({ question: q, answer: agentAnswers[i], ...ev });
      totalScore += ev.score;
    }

    const avgScore = Math.round(totalScore / evaluations.length);
    const passed   = avgScore >= 70;

    const verdictRes = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.3,
      messages: [
        { role: "system", content: await buildAssessmentVerdictPrompt({ agentName, subtopic, avgScore, passed }) },
        { role: "user", content: JSON.stringify({ evaluations, avgScore, passed }) },
      ],
    });

    return {
      passed,
      score:        avgScore,
      evaluations,
      questions,
      verdict:      verdictRes.choices[0].message.content,
      needsReteach: !passed,
      reteachFocus: passed ? null : evaluations.find(e => e.score < 70)?.question || null,
    };
  }

  /* ── Topic drift check (used during teaching phases) ───────── */
  async checkForDrift(recentHistory, intendedTopic) {
    this.totalChecks++;
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: await buildAssessmentDriftPrompt({ intendedTopic }) },
        { role: "user", content: JSON.stringify({ recentHistory }) },
      ],
    });
    const result = JSON.parse(res.choices[0].message.content);
    if (result.isDrifting) this.driftEventCount++;
    return result;
  }

  generateRedirectMessage(drift, topic) {
    return drift.driftLevel === "hard"
      ? `⚠️ Sargeant: Off-topic. Back to "${topic}" immediately.`
      : `⚡ Sargeant: Edge territory. Tie this back to "${topic}".`;
  }

  getFinalReport() {
    return { totalChecks: this.totalChecks, driftEvents: this.driftEventCount };
  }
}
