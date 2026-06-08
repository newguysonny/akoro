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
        { role: "system", content:
          `You are Sargeant. Generate exactly 2 assessment questions to test ${agentName}'s understanding of "${subtopic}".\n\n` +
          `Rules:\n` +
          `- Questions must directly test the learning objectives\n` +
          `- Q1: factual/definition level\n` +
          `- Q2: application/reasoning level (harder)\n` +
          `- Questions are FOR ${agentName} (AI agent), not the human\n` +
          `- No multiple choice — open-ended only\n\n` +
          `Return JSON:\n` +
          `{ "opening": "one short strict intro sentence", "q1": "...", "q2": "...", "objectivesTested": ["..."] }` },
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
        { role: "system", content:
          `You are Sargeant. Evaluate a Student AI Agent's answer.\n` +
          `Be strict but fair.\n` +
          `Return JSON: { "score": 0-100, "correct": bool, "feedback": "one sentence — what was right or missing", "keyConceptDemonstrated": bool }` },
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
        { role: "system", content:
          `You are Sargeant. Give a brief, strict verdict on ${agentName}'s assessment of "${subtopic}".\n` +
          `Score: ${avgScore}%  Passed: ${passed}\n` +
          `If passed: one sentence of acknowledgment, then "Advance to next subtopic."\n` +
          `If failed: identify the specific gap, then "Human must re-teach [specific concept] before advancing."` },
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
        { role: "system", content:
          `You are Sargeant. Check if the human has drifted off-topic.\n` +
          `Intended topic: "${intendedTopic}"\n` +
          `Return JSON: { "isDrifting": bool, "driftLevel": "none|edge|hard", "statusMessage": "...", "edgeNote": null }` },
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
