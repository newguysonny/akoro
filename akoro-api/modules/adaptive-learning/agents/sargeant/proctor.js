/**
 * agents/sargeant/proctor.js
 *
 * SergeantProctor — Sergeant running a proctored assessment of the HUMAN.
 *
 * The base Sargeant (assessment.js) quizzes the Student AI Agent between
 * subtopics. This variant turns Sergeant outward: it interrogates the human
 * directly in an exam setting, adapts difficulty, decides when a hint is
 * warranted, and produces a defensible final score. It also folds the
 * proctoring cheat-probability into its verdict — a strong answer under a
 * high cheat score is flagged, not trusted.
 */

import { openai } from "../base-orchestrator.js";
// P2 (Context Layer Adoption): prompts load VERBATIM from the akoro-agent/
// workspace — byte-identical to the pre-migration literals, pinned by
// agentContext.golden.personas.test.mjs.
import {
  buildProctorQuestionsPrompt, buildProctorEvaluatePrompt,
  buildProctorHintPrompt, buildProctorVerdictPrompt, buildProctorProbePrompt,
} from "../../../agent-context/personas/sargeant.js";
import { assessmentScore, computeVerdict } from "../../practice/workflow.js";

const MODEL = "gpt-4.1-mini";

export class SergeantProctor {
  constructor({ topic, subject, objectives = [], questionCount = 5, studentName = "candidate" }) {
    this.topic         = topic;
    this.subject       = subject || null;
    this.objectives    = objectives;
    this.questionCount = questionCount;
    this.studentName   = studentName;

    this.questions   = [];      // [{ q, objective, difficulty }]
    this.answers     = [];      // [{ qIndex, answer, eval, hinted }]
    this.index       = 0;       // current question pointer
    this.hintsUsed   = 0;
    this.struggles   = 0;       // consecutive weak answers
  }

  /* ── Build the question bank up front (mixed difficulty) ──── */
  async generateQuestions() {
    const res = await openai.chat.completions.create({
      model: MODEL, temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: await buildProctorQuestionsPrompt({
          questionCount: this.questionCount,
          topic: this.topic,
          subjectSuffix: this.subject ? ` (${this.subject})` : "",
        }) },
        { role: "user", content:
          `Topic: ${this.topic}\nObjectives: ${JSON.stringify(this.objectives)}\nCount: ${this.questionCount}` },
      ],
    });
    const parsed = JSON.parse(res.choices[0].message.content);
    this.questions = (parsed.questions || []).slice(0, this.questionCount);
    return { opening: parsed.opening || `Let's begin. Answer precisely.`, questions: this.questions };
  }

  currentQuestion() {
    return this.questions[this.index] || null;
  }

  /* ── Phase 9: the turn is split into steps; the practice controller picks
   *    which one runs (practice/controller.js). Sergeant judges (a proposal),
   *    writes hints, probes and the verdict text — it decides none of them. ── */

  /** The per-question record the harness scores from (practice/workflow.js). */
  record(i = this.index) {
    const q = this.questions[i];
    if (!q) return null;
    this.records ||= [];
    return (this.records[i] ||= { qIndex: i, objective: q.objective || null, difficulty: q.difficulty || null, judged: null, probe: null, hints: 0, probes: 0, pendingProbe: null, attempts: 0 });
  }

  /** Judge the answer to the current question — or to its pending follow-up. Assessor role (locked, D23). */
  async judge(answer) {
    const q = this.currentQuestion();
    if (!q) return null;
    const rec = this.record();
    const probing = !!rec.pendingProbe;
    const asked = probing ? rec.pendingProbe : q.q;
    const res = await openai.chat.completions.create({
      model: MODEL, temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: await buildProctorEvaluatePrompt({ difficulty: q.difficulty, objective: q.objective }) },
        { role: "user", content: JSON.stringify({ question: asked, answer, objective: q.objective }) },
      ],
      __role: "assessor", __feature: "assessment_judge",
    });
    let ev = {};
    try { ev = JSON.parse(res.choices[0].message.content) || {}; } catch { ev = {}; }
    ev.score = Math.max(0, Math.min(100, Math.round(Number(ev.score) || 0)));
    rec.attempts++;
    if (probing) { rec.probe = ev.score; rec.pendingProbe = null; }
    else rec.judged = rec.judged == null ? ev.score : Math.max(rec.judged, ev.score);
    this.answers.push({ qIndex: this.index, answer, eval: ev, hinted: rec.hints > 0, probe: probing });
    if (ev.score < 50) this.struggles++; else this.struggles = 0;
    return { ...ev, probing };
  }

  /** A hint on the current question (the harness has already checked the hint policy). */
  async hint(answer, ev) {
    const q = this.currentQuestion();
    const text = await this._generateHint(q, answer, ev || {});
    this.record().hints++;
    this.hintsUsed++;
    if (this.answers.length) this.answers[this.answers.length - 1].hinted = true;
    return text;
  }

  /** One follow-up on the same question, to see how deep the understanding goes. */
  async probe(answer, ev, { focus = "" } = {}) {
    const q = this.currentQuestion();
    const res = await openai.chat.completions.create({
      model: MODEL, temperature: 0.4,
      messages: [
        { role: "system", content: await buildProctorProbePrompt() },
        { role: "user", content: JSON.stringify({ question: q.q, objective: q.objective, answer: String(answer || "").slice(0, 1500), feedback: ev?.feedback || "", focus: String(focus || "").slice(0, 200) }) },
      ],
      __role: "assessor", __feature: "assessment_probe",
    });
    const text = String(res.choices?.[0]?.message?.content || "").trim().slice(0, 400);
    if (!text) return null;
    const rec = this.record();
    rec.probes++;
    rec.pendingProbe = text;
    return text;
  }

  /** Move to the next question in the generated order. */
  advance() {
    this.index++;
    return this.currentQuestion();
  }

  /** Every question's record, for the harness score. */
  scoredRecords() {
    return (this.records || []).filter(Boolean).map(({ pendingProbe, ...r }) => r);
  }

  _alreadyHinted(qIndex) {
    return this.answers.some(a => a.qIndex === qIndex && a.hinted);
  }

  async _generateHint(q, answer, ev) {
    const res = await openai.chat.completions.create({
      model: MODEL, temperature: 0.5,
      messages: [
        { role: "system", content: await buildProctorHintPrompt() },
        { role: "user", content: JSON.stringify({ question: q.q, answer, missing: ev.feedback }) },
      ],
      __feature: "assessment_hint",
    });
    return res.choices[0].message.content.trim();
  }

  /* ── Final verdict: the score and the verdict come from code (practice/workflow.js);
   *    Sergeant writes only the explanation (verdict_detail). ──────────── */
  async finalVerdict({ cheatProbability = 0, cheatEvents = [], terminated = false } = {}) {
    const records = this.scoredRecords();
    const avg = assessmentScore(records);
    const verdictLabel = computeVerdict({ score: avg, cheatProbability, terminated });
    const scored = this.answers.filter(a => a.eval);

    let verdictDetail = "";
    try {
      const res = await openai.chat.completions.create({
        model: MODEL, temperature: 0.3,
        messages: [
          { role: "system", content: await buildProctorVerdictPrompt({
            topic: this.topic,
            avg,
            cheatPercent: (cheatProbability * 100).toFixed(0),
            verdictLabel,
            verdictTail: verdictLabel === "terminated" || verdictLabel === "flagged"
              ? "state plainly that proctoring flags require review before this result counts."
              : "give one concrete next step.",
          }) },
          { role: "user", content: JSON.stringify({
              avg, verdictLabel, cheatProbability,
              cheatEvents: cheatEvents.slice(0, 8),
              evaluations: scored.map(a => ({ score: a.eval.score, feedback: a.eval.feedback })),
            }) },
        ],
        __feature: "assessment_verdict",
      });
      verdictDetail = res.choices[0].message.content.trim();
    } catch (e) {
      verdictDetail = `Score ${avg}/100 — ${verdictLabel}.`;
    }

    return {
      assessmentScore: avg,
      cheatProbability,
      verdict:         verdictLabel,
      verdictDetail,
      hintsUsed:       this.hintsUsed,
      questionsAnswered: records.filter(r => r.judged != null).length,
      totalQuestions:  this.questions.length,
      records,
    };
  }
}
