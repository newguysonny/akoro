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
        { role: "system", content:
          `You are Sergeant, a strict but fair examiner. Generate exactly ${this.questionCount} ` +
          `open-ended assessment questions on "${this.topic}"${this.subject ? ` (${this.subject})` : ""} ` +
          `for a human candidate.\n` +
          `Rules:\n` +
          `- Progress from recall → application → analysis (increasing difficulty)\n` +
          `- Each question targets a specific learning objective\n` +
          `- No multiple choice. No yes/no. Require explanation.\n` +
          `- Concise, unambiguous wording.\n\n` +
          `Return JSON: { "opening": "one strict intro sentence", "questions": [ ` +
          `{ "q": "...", "objective": "...", "difficulty": "recall|application|analysis" } ] }` },
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

  /* ── Evaluate one human answer, decide next step ──────────── */
  async evaluateAnswer(answer, { cheatProbability = 0 } = {}) {
    const q = this.currentQuestion();
    if (!q) return { done: true };

    const res = await openai.chat.completions.create({
      model: MODEL, temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content:
          `You are Sergeant evaluating a human candidate's answer. Be strict but fair.\n` +
          `Difficulty: ${q.difficulty}. Objective: ${q.objective}.\n` +
          `Return JSON: { "score": 0-100, "correct": bool, ` +
          `"feedback": "one sentence — precise, what was right or missing", ` +
          `"needsHint": bool (true only if the answer shows partial understanding worth nudging), ` +
          `"misconception": "the specific wrong idea, or null" }` },
        { role: "user", content: JSON.stringify({ question: q.q, answer, objective: q.objective }) },
      ],
    });
    const ev = JSON.parse(res.choices[0].message.content);

    this.answers.push({ qIndex: this.index, answer, eval: ev, hinted: false });
    if (ev.score < 50) this.struggles++; else this.struggles = 0;

    // Offer a hint at most once per question, and only when it helps.
    const offerHint = ev.needsHint && ev.score < 70 && !this._alreadyHinted(this.index);

    let hint = null;
    if (offerHint) {
      hint = await this._generateHint(q, answer, ev);
      this.hintsUsed++;
      this.answers[this.answers.length - 1].hinted = true;
    } else {
      this.index++;   // move on only when not hinting
    }

    // Note when proctoring flags a high cheat score on a strong answer.
    const suspicious = cheatProbability >= 0.5 && ev.score >= 70;

    return {
      eval:        ev,
      hint,
      advanced:    !offerHint,
      done:        this.index >= this.questions.length,
      nextQuestion: !offerHint ? this.currentQuestion() : null,
      progress:    { index: this.index, total: this.questions.length },
      suspicious,
    };
  }

  _alreadyHinted(qIndex) {
    return this.answers.some(a => a.qIndex === qIndex && a.hinted);
  }

  async _generateHint(q, answer, ev) {
    const res = await openai.chat.completions.create({
      model: MODEL, temperature: 0.5,
      messages: [
        { role: "system", content:
          `You are Sergeant. The candidate's answer is partially right. Give ONE short ` +
          `Socratic hint that points toward the gap WITHOUT revealing the answer. ` +
          `One sentence. Strict tone.` },
        { role: "user", content: JSON.stringify({ question: q.q, answer, missing: ev.feedback }) },
      ],
    });
    return res.choices[0].message.content.trim();
  }

  /* ── Final verdict, cheat-probability aware ───────────────── */
  async finalVerdict({ cheatProbability = 0, cheatEvents = [] } = {}) {
    const scored = this.answers.filter(a => a.eval);
    const avg = scored.length
      ? Math.round(scored.reduce((s, a) => s + (a.eval.score || 0), 0) / scored.length)
      : 0;

    // Cheat probability gates the verdict regardless of academic score.
    let verdictLabel;
    if (cheatProbability >= 0.7)       verdictLabel = "terminated";
    else if (cheatProbability >= 0.4)  verdictLabel = "flagged";
    else if (avg >= 70)                verdictLabel = "pass";
    else                               verdictLabel = "fail";

    const res = await openai.chat.completions.create({
      model: MODEL, temperature: 0.3,
      messages: [
        { role: "system", content:
          `You are Sergeant delivering a final assessment verdict on the candidate's "${this.topic}" exam.\n` +
          `Academic score: ${avg}%. Cheat probability: ${(cheatProbability * 100).toFixed(0)}%. ` +
          `Verdict: ${verdictLabel}.\n` +
          `Write 2-3 sentences: acknowledge performance, name the strongest and weakest area, and ` +
          `${verdictLabel === "terminated" || verdictLabel === "flagged"
              ? "state plainly that proctoring flags require review before this result counts."
              : "give one concrete next step."}` },
        { role: "user", content: JSON.stringify({
            avg, verdictLabel, cheatProbability,
            cheatEvents: cheatEvents.slice(0, 8),
            evaluations: scored.map(a => ({ score: a.eval.score, feedback: a.eval.feedback })),
          }) },
      ],
    });

    return {
      assessmentScore: avg,
      cheatProbability,
      verdict:         verdictLabel,
      verdictDetail:   res.choices[0].message.content.trim(),
      hintsUsed:       this.hintsUsed,
      questionsAnswered: scored.length,
      totalQuestions:  this.questions.length,
    };
  }
}
