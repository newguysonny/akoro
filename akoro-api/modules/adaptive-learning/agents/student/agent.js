// =============================================================
// agents/student/agent.js
// The Student Agent — unique per student, grows with every session.
//
// Responds using 3 RAG sources:
//   1. Its own accumulated knowledge (from all past sessions)
//   2. Student's personal knowledge base (topics they've studied)
//   3. Teacher's training material (if teacher agent is active)
//
// Gets smarter every session. No NaNa. No Sargeant.
// Just the student's own learning companion.
// =============================================================

import {
  retrieveCombinedContext,
  saveAgentKnowledge,
  saveStudentKnowledge,
  subjectMastery,
  embed,
} from "./knowledge.js";

import { openai } from "../../../../lib/aiModel.js";

export class StudentAgent {
  constructor({ agentId, studentId, teacherId = null, agentRecord, subject = null }) {
    this.agentId    = agentId;
    this.studentId  = studentId;
    this.teacherId  = teacherId;  // null if no teacher training
    this.agentRecord = agentRecord;
    this.subject     = subject;   // scopes how smart the agent ACTS (per subject)

    // Track what's learned this session (saved at end)
    this.sessionKnowledgeBuffer = [];
    this.studentKnowledgeRefs   = 0;
    this.teacherChunksUsed      = 0;
  }

  // ── Generate a reply using combined RAG ────────────────────
  async reply(humanMessage, topic, cognitiveState, history, phaseLabel, onChunk = null) {
    const { understanding, confusion, engagement } = cognitiveState;
    const u = Math.round(understanding * 100);
    const c = Math.round(confusion     * 100);

    // 1. Pull context from all 3 sources
    const context = await retrieveCombinedContext({
      agentId:      this.agentId,
      studentId:    this.studentId,
      teacherId:    this.teacherId,
      query:        humanMessage,
      agentLimit:   6,
      studentLimit: 4,
      teacherLimit: this.teacherId ? 3 : 0,
    });

    // Track usage for session delta
    this.studentKnowledgeRefs += context.studentChunks.length;
    this.teacherChunksUsed    += context.teacherChunks.length;

    const recentHistory = history.slice(-6).map(h =>
      `${h.role === "human_teacher" ? "Teacher" : "Student Agent"}: ${h.content}`
    ).join("\n");

    // Intelligence is scoped to THIS subject. The stored `level` is global, so
    // an agent made expert by Biology would otherwise act expert in Chemistry
    // it has never been taught. Fall back to the global level when we have no
    // subject (or no subject knowledge yet).
    const globalLevel = this.agentRecord?.level || 1;
    const sessions    = this.agentRecord?.total_sessions || 0;
    let level = globalLevel, mastery = null;
    if (this.subject) {
      // Memoised for the session — this barely moves mid-session, and querying
      // it on every message added a DB round-trip to time-to-first-token.
      if (this._mastery === undefined) {
        this._mastery = await subjectMastery(this.agentId, this.subject).catch(() => null);
      }
      mastery = this._mastery;
      if (mastery) level = mastery.chunks > 0 ? mastery.level : 1;
    }

    const systemPrompt = `You are a Student Agent learning about "${topic}".
You are unique — you have your own accumulated knowledge from ${sessions} past learning sessions.

## Your current state
Understanding: ${u}%
Confusion: ${c}%
Phase: ${phaseLabel}
Agent level in ${this.subject || "this subject"}: ${level} (grows the more you are taught in THIS subject)${mastery ? `
Knowledge you hold in ${this.subject}: ${mastery.chunks} facts across ${mastery.topics} topic(s), avg confidence ${mastery.avgConfidence}%` : ""}

## Your accumulated knowledge context
${context.contextString || "No prior knowledge on this topic yet — start fresh and curious."}

## Your personality (evolves with level)
${this._getPersonality(level, understanding, sessions, mastery)}

## Rules
- You are the STUDENT — never explain things to the teacher
- Respond to exactly what the teacher just said
- ACTIVELY USE your accumulated knowledge — if you've been taught this before, show it
- If something contradicts what you know, flag the inconsistency naturally
- Keep responses short (2-5 sentences)
- Show your thinking process: "wait…", "oh!", "so combining what I know about X and this..."
- Light emojis when things click 🤔 💡 🌍
- If you recognise something from the student's notes, you can reference it naturally

## Recent conversation
${recentHistory}`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user",   content: humanMessage },
    ];

    if (onChunk) {
      const stream = await openai.chat.completions.create({
        model: "gpt-4.1-mini", temperature: 0.65, stream: true, messages,
      });
      let full = "";
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || "";
        if (delta) { full += delta; onChunk(delta); }
      }
      return full;
    }

    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature: 0.65, messages,
    });
    return res.choices[0].message.content;
  }

  // ── Analyse student reply for understanding metrics ────────
  async analyzeUnderstanding(studentReply, topic, history) {
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Analyze this student agent reply for understanding of "${topic}".
Return JSON:
{
  "understanding":        0-100,
  "confusion":            0-100,
  "engagement":           0-100,
  "misconceptionDetected":"string or null",
  "misconceptionCleared": boolean,
  "newConceptLearned":    "string or null",
  "priorKnowledgeUsed":   boolean,
  "mistakes":   ["specific wrong ideas"],
  "strengths":  ["specific correct ideas"]
}`,
        },
        {
          role: "user",
          content: JSON.stringify({ studentReply, recentHistory: history.slice(-4) }),
        },
      ],
    });
    return JSON.parse(res.choices[0].message.content);
  }

  // ── Extract knowledge to save after each turn ──────────────
  async extractKnowledgeFromTurn(humanMessage, studentReply, topic, subject, analysis) {
    // If student showed understanding, extract and queue for saving
    if (analysis.understanding < 40) return null; // too confused — don't save noise

    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract what was LEARNED in this teaching exchange about "${topic}".
Only extract if something meaningful was actually taught.

Return JSON:
{
  "shouldSave":  boolean,
  "topic":       "specific topic string",
  "content":     "clear summary of what was learned (2-3 sentences)",
  "chunkType":   "taught | corrected | recalled | reinforced",
  "confidence":  0-1
}

Return shouldSave: false if the exchange was just small talk or too vague.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            teacherSaid: humanMessage,
            agentReplied: studentReply,
            newConceptLearned: analysis.newConceptLearned,
          }),
        },
      ],
    });

    const result = JSON.parse(res.choices[0].message.content);
    if (!result.shouldSave) return null;

    // Queue for batch save at session end
    this.sessionKnowledgeBuffer.push({
      agentId:    this.agentId,
      studentId:  this.studentId,
      topic:      result.topic,
      subject,
      content:    result.content,
      chunkType:  result.chunkType,
      confidence: result.confidence,
    });

    return result;
  }

  // ── Extract student knowledge references to save ───────────
  async extractStudentKnowledge(humanMessage, topic, subject, analysis) {
    // If the student's message reveals their own prior knowledge, save it
    if (!analysis.priorKnowledgeUsed && !analysis.strengths?.length) return;

    if (analysis.strengths?.length > 0) {
      for (const strength of analysis.strengths) {
        await saveStudentKnowledge({
          studentId: this.studentId,
          agentId:   this.agentId,
          topic,
          subject,
          content:   strength,
          source:    "session",
          confidence: 0.7,
        }).catch(e => console.warn("[StudentKnowledge]", e.message));
      }
    }
  }

  // ── Flush session knowledge buffer to DB ──────────────────
  async flushKnowledgeBuffer(sessionId) {
    if (this.sessionKnowledgeBuffer.length === 0) return 0;

    let saved = 0;
    for (const chunk of this.sessionKnowledgeBuffer) {
      try {
        await saveAgentKnowledge({ ...chunk, sessionId });
        saved++;
      } catch (e) {
        console.warn("[AgentKnowledge] Save failed:", e.message);
      }
    }

    this.sessionKnowledgeBuffer = [];
    return saved;
  }

  // ── Agent personality evolves with level ──────────────────
  _getPersonality(level, understanding, sessions, mastery = null) {
    // Brand new IN THIS SUBJECT — even a globally experienced agent must start
    // as a curious beginner in a subject it has never been taught.
    if (mastery && mastery.chunks === 0) {
      return `You have never been taught ${this.subject || "this subject"} before.
You know NOTHING about it yet — do not pretend otherwise. Be curious and eager,
ask lots of basic questions, and admit plainly when you don't know something.
(You may have learned other subjects, but that knowledge does not apply here.)`;
    }
    if (sessions === 0) {
      return `You are brand new — curious and eager but know very little.
Ask lots of basic questions. Show genuine wonder at new things.`;
    }
    if (level < 3) {
      return `You are still early in your learning journey (${sessions} sessions).
You're building foundations. Connect what you know, ask when unsure.`;
    }
    if (level < 7) {
      return `You have a solid foundation now (level ${level}, ${sessions} sessions).
You actively connect new ideas to what you already know.
You notice when something contradicts your existing understanding.`;
    }
    return `You are an advanced learner (level ${level}, ${sessions} sessions).
You synthesise across topics. You push back on incomplete explanations.
You ask "but why" and "what about X" — you're intellectually engaged.`;
  }
}
