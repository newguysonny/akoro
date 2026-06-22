// =============================================================
// agents/student/orchestrator.js  v3.1
// Student session orchestrator.
// Supports two session types:
//   TYPE 1 — free_teaching: student picks any topic freely
//   TYPE 2 — decay_review:  system pre-loads subject+topic
//            triggered by DecayEngine when confidence drops
// =============================================================

import { BaseOrchestrator, openai } from "../base-orchestrator.js";
import { StudentAgent } from "./agent.js";
import {
  getOrCreateStudentAgent,
  incrementAgentStats,
  createSessionDelta,
  finalizeSessionDelta,
  retrieveAgentKnowledgeByTopic,
} from "./knowledge.js";
import { decayEngine, getPriority } from "./decayEngine.js";
import { getStudentState, updateStudentState } from "../../student-state.js";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const STUDENT_PHASES = {
  PHASE_1: "Phase 1 — What does Student Agent already know?",
  PHASE_2: "Phase 2 — Must-know parts",
  PHASE_3: "Phase 3 — Student Agent teaches it back",
  PHASE_4: "Phase 4 — Push a little further!",
  MASTERY: "Mastery",
};

export class StudentSessionOrchestrator extends BaseOrchestrator {

  static profile = {
    id:           "student-session",
    name:         "Student Session",
    description:  "Student teaches their personal agent. Agent grows smarter every session.",
    style:        "adaptive",
    bestFor:      ["personal learning", "knowledge building", "exam prep"],
    avatar:       "🧠",
    guideAgent:   "Dynamic (trained teacher or NaNa)",
    controlAgent: "Dynamic (trained teacher or Sargeant)",
  };

  constructor({ studentId, teacherAgentId = null, guideOrchestrator,
                sessionType = "free_teaching",   // "free_teaching" | "decay_review"
                subject = null,                  // free-teaching subject (decay carries its own)
                decayPayload = null }) {          // pre-loaded subject+topic for decay sessions
    super();
    this.studentId          = studentId;
    this.teacherAgentId     = teacherAgentId;
    this.guideOrchestrator  = guideOrchestrator;
    this.sessionType        = sessionType;
    this.decayPayload       = decayPayload;       // { subject, topic, confidence, priority, ... }
    this.subject            = subject || decayPayload?.subject || null;
    this.studentAgentRecord = null;
    this.studentAgent       = null;
    this.sessionDeltaId     = null;
    this.sessionStartTime   = Date.now();
    this.notificationId     = decayPayload?.notificationId || null;

    this.stats = {
      turnsCompleted:        0,
      agentKnowledgeAdded:   0,
      studentKnowledgeRefs:  0,
      teacherChunksUsed:     0,
      conceptsLearned:       [],
      misconceptionsCleared: [],
      xpEarned:              0,
    };

    this.session.phase = "PHASE_1";
  }

  // ── INIT ─────────────────────────────────────────────────────
  async initialize(studentId, topic) {
    this.session.agentId = studentId;
    this.session.topic   = topic;

    this.studentAgentRecord = await getOrCreateStudentAgent(studentId);
    const agentRecord       = this.studentAgentRecord;

    // Resolve teacherId from teacher agent config if linked
    let teacherId = null;
    if (this.teacherAgentId) {
      const { data: tc } = await supabase
        .schema("edu").from("agent_orchestration_config")
        .select("teacher_id")
        .eq("agent_id", this.teacherAgentId)
        .single();
      teacherId = tc?.teacher_id || null;
    }

    // Create student agent with RAG
    this.studentAgent = new StudentAgent({
      agentId:     agentRecord.id,
      studentId,
      teacherId,
      agentRecord,
    });

    // Load initial state
    const state = await getStudentState(agentRecord.id);
    const u = Math.round(state.cognitive.understanding * 100);

    // Create session delta record
    const sessionId = `${this.sessionType}_${agentRecord.id}_${Date.now()}`;
    this.session.sessionId = sessionId;

    this.sessionDeltaId = await createSessionDelta({
      sessionId,
      agentId:           agentRecord.id,
      studentId,
      teacherAgentId:    this.teacherAgentId,
      topic,
      subject:           this.decayPayload?.subject || null,
      understandingStart: u,
    }).catch(() => null);

    // Build must-know parts
    let mustKnow = [];
    if (this.sessionType === "decay_review" && this.decayPayload?.mustKnowParts?.length) {
      mustKnow = this.decayPayload.mustKnowParts;
    } else if (this.guideOrchestrator.guide?.detectMustKnowParts) {
      mustKnow = await this.guideOrchestrator.guide.detectMustKnowParts(topic);
    }
    this.session.mustKnowParts = mustKnow;

    // Topic boundary
    const boundary = this.guideOrchestrator.control?.getTopicBoundary
      ? await this.guideOrchestrator.control.getTopicBoundary(topic)
      : { allowed: [], offTopic: [], boundaryStatement: topic };

    // Teaching plan
    const plan = this.guideOrchestrator.guide?.buildTeachingPlan
      ? this.guideOrchestrator.guide.buildTeachingPlan(topic, mustKnow)
      : `📚 Teaching Plan:\n• Build the agent's knowledge on ${topic}`;

    const guideName   = this.guideOrchestrator.guide?.name   || "Guide";
    const controlName = this.guideOrchestrator.control?.name || "Control";

    // Load prior topic knowledge for decay sessions
    let priorKnowledgeSummary = "";
    if (this.sessionType === "decay_review" && this.decayPayload) {
      const { subject, topic: decayTopic, confidence, daysSinceReview } = this.decayPayload;
      const priorChunks = await retrieveAgentKnowledgeByTopic(agentRecord.id, subject, decayTopic, 3);

      priorKnowledgeSummary = [
        ``,
        `📊 Agent's Current Knowledge on ${subject} — ${decayTopic}:`,
        `  Confidence: ${Math.round(confidence * 100)}% | Days since last taught: ${daysSinceReview || 0}`,
        priorChunks.length > 0
          ? `  Prior knowledge:\n${priorChunks.map(c => `    • ${c.content?.substring(0, 100)}...`).join("\n")}`
          : `  No prior knowledge found — start from scratch.`,
      ].join("\n");
    }

    const allowedList = boundary.allowed?.map(a  => `    ${a}`).join("\n") || "";
    const offList     = boundary.offTopic?.map(o => `    ${o}`).join("\n") || "";

    // ── Build opening prompt ──────────────────────────────────
    const isDecaySession = this.sessionType === "decay_review";

    const openingPrompt = [
      `═══════════════════════════════════════════════════════════════`,
      isDecaySession
        ? `DECAY REVIEW SESSION: Teach "${topic}" to your Student Agent`
        : `SESSION START: Teaching "${topic}" to Student Agent`,
      `Engine: Real-Time Adaptive Learning System`,
      `Agent Level: ${agentRecord.level} | Sessions: ${agentRecord.total_sessions} | Score: ${Math.round(agentRecord.knowledge_score)}`,
      isDecaySession
        ? `⚠️  Session Type: Knowledge Reinforcement — ${this.decayPayload?.subject?.toUpperCase()} / ${topic}`
        : `📚 Session Type: Free Teaching`,
      `═══════════════════════════════════════════════════════════════`,
      ``,
      `🧠 INITIAL STATE`,
      `Understanding: ${u}% | Mode: PHASE 1`,
      ``,
      `${guideName}:`,
      plan,
      ``,
      `${controlName} (Focus Monitor):`,
      `🎯 Topic boundary: ${topic} ONLY`,
      allowedList ? `  ✅ Allowed:\n${allowedList}` : "",
      offList     ? `  ❌ Off-topic:\n${offList}`   : "",
      priorKnowledgeSummary,
      ``,
      `🤖 About Your Student Agent:`,
      agentRecord.total_sessions === 0
        ? `  This is your agent's FIRST session — it knows nothing yet. Teach it well!`
        : `  Your agent has had ${agentRecord.total_sessions} session(s) and knows ${Math.round(agentRecord.knowledge_score)} knowledge points.`,
      isDecaySession
        ? `  🔄 This is a REINFORCEMENT session. The agent's confidence on this topic has dropped.`
        : "",
      ``,
      `═══════════════════════════════════════════════════════════════`,
      STUDENT_PHASES.PHASE_1,
      `═══════════════════════════════════════════════════════════════`,
      ``,
      isDecaySession
        ? `Ready — teach ${topic} to reinforce your agent's knowledge! 🔄`
        : `Ready — start teaching! 🚀`,
    ].filter(l => l !== "").join("\n");

    // ── Structured opening blocks (same typed shape the UI renders per turn) ──
    // The must-know parts are this engine's "objectives" checklist; the first
    // part is the opening subtopic. Built from real data — no fabricated content.
    const guideEmoji = this.guideOrchestrator.guide?.emoji || "🧠";
    const openGuideText = isDecaySession
      ? `Let's reinforce ${topic}. Re-teach it to your agent and I'll guide you through the phases.`
      : `Let's teach ${topic} to your agent. I'll guide you through 4 phases — start by explaining the basics in your own words.`;

    const openingBlocks = [
      {
        type:     "subtopic-hdr",
        subtopic: mustKnow[0] || topic,
        idx:      0,
        total:    mustKnow.length || 1,
        topic,
        subject:  this.subject || "",
      },
      { type: "plan", phases: [
        "Phase 1 → what do they know",
        "Phase 2 → must-know parts",
        "Phase 3 → teach it back",
        "Phase 4 → push further",
      ] },
      ...(mustKnow.length
        ? [{ type: "objectives", subtopic: mustKnow[0] || topic, items: mustKnow }]
        : []),
      {
        type:  "guide",
        agent: guideName,
        emoji: guideEmoji,
        phase: STUDENT_PHASES.PHASE_1,
        text:  openGuideText,
      },
    ];

    return {
      openingPrompt,
      openingBlocks,
      topicBoundary:    boundary,
      mustKnowParts:    mustKnow,
      studentAgentName: agentRecord.name,
      agentLevel:       agentRecord.level,
      totalSessions:    agentRecord.total_sessions,
      knowledgeScore:   Math.round(agentRecord.knowledge_score),
      initialState:     { understanding: u, confusion: 30 },
      agentPairId:      "student-session",
      sessionType:      this.sessionType,
      decayPayload:     this.decayPayload || null,
    };
  }

  // ── PROCESS ONE TURN ─────────────────────────────────────────
  async processTeachingMessage(humanMessage, callbacks = {}) {
    const { onStudentChunk, onGuideChunk, onStateUpdate } = callbacks;
    const { topic, phase, mustKnowParts, mustKnowIndex, history } = this.session;

    // Resolve subject — from decay payload or infer from topic
    const subject = this.decayPayload?.subject || null;

    this.session.turnCount++;
    this.stats.turnsCompleted++;

    const agentId   = this.studentAgentRecord.id;
    const studentId = this.studentId;
    const state     = await getStudentState(agentId);

    // 1. Control drift check + Student Agent reply IN PARALLEL
    const [drift, studentReply] = await Promise.all([
      this.guideOrchestrator.control?.checkForDrift
        ? this.guideOrchestrator.control.checkForDrift(
            [...history.slice(-4), { role: "human_teacher", content: humanMessage }],
            topic
          )
        : Promise.resolve({ isDrifting: false, driftLevel: "none", statusMessage: "On topic." }),

      this.studentAgent.reply(
        humanMessage, topic,
        state.cognitive,
        history,
        STUDENT_PHASES[phase],
        onStudentChunk || null
      ),
    ]);

    // Hard drift — redirect
    if (drift.isDrifting) {
      const redirectMsg = this.guideOrchestrator.control?.generateRedirectMessage
        ? this.guideOrchestrator.control.generateRedirectMessage(drift, topic)
        : `⚠️ Let's stay focused on ${topic}.`;
      return {
        type:                 "drift_warning",
        sargeantMessage:      redirectMsg,
        studentAgentResponse: null,
        guideMessage:         null,
        adaptiveEngine:       null,
        driftInfo:            drift,
      };
    }

    // 2. Analyze understanding
    const analysis = await this.studentAgent.analyzeUnderstanding(studentReply, topic, history);

    // 3. Persist state
    const updatedState = await updateStudentState(
      agentId, topic, analysis,
      { phase, mustKnowIndex, lastAction: null }
    );

    if (onStateUpdate) {
      onStateUpdate({
        understanding: Math.round(updatedState.cognitive.understanding * 100),
        confusion:     Math.round(updatedState.cognitive.confusion     * 100),
        engagement:    Math.round(updatedState.cognitive.engagement    * 100),
      });
    }

    // 4. Extract and queue knowledge — now with subject
    const extracted = await this.studentAgent.extractKnowledgeFromTurn(
      humanMessage, studentReply, topic, subject, analysis
    );
    if (extracted) this.stats.agentKnowledgeAdded++;

    // 5. Save student knowledge references
    await this.studentAgent.extractStudentKnowledge(humanMessage, topic, subject, analysis);
    this.stats.studentKnowledgeRefs = this.studentAgent.studentKnowledgeRefs;
    this.stats.teacherChunksUsed    = this.studentAgent.teacherChunksUsed;

    if (analysis.newConceptLearned)    this.stats.conceptsLearned.push(analysis.newConceptLearned);
    if (analysis.misconceptionCleared) {
      this.stats.misconceptionsCleared.push(analysis.misconceptionDetected || "concept");
    }

    // 6. Guide tip
    const guideResult = this.guideOrchestrator.guide?.getTip
      ? await this.guideOrchestrator.guide.getTip(
          {
            topic, phase: STUDENT_PHASES[phase],
            currentSubtopic: mustKnowParts[mustKnowIndex] || null,
            humanMessage, studentResponse: studentReply,
            understanding: Math.round(updatedState.cognitive.understanding * 100),
            confusion:     Math.round(updatedState.cognitive.confusion     * 100),
            history, mustKnowParts, mustKnowIndex,
          },
          onGuideChunk || null
        )
      : { tip: null, nextAction: "NEXT_SUBTOPIC", nextPhase: null,
          nextMustKnowIndex: mustKnowIndex, isUrgent: false };

    // 7. Advance phase / subtopic
    let phaseChanged = false, phaseLabel = null, subtopicAdvanced = false;
    if (guideResult.nextPhase && guideResult.nextPhase !== phase) {
      this.session.phase = guideResult.nextPhase;
      phaseChanged       = true;
      phaseLabel         = STUDENT_PHASES[guideResult.nextPhase];
    }
    if (guideResult.nextMustKnowIndex > mustKnowIndex) {
      this.session.mustKnowIndex = guideResult.nextMustKnowIndex;
      subtopicAdvanced           = true;
    }

    // 8. Persist final state
    await updateStudentState(agentId, topic, analysis, {
      phase: this.session.phase, mustKnowIndex: this.session.mustKnowIndex,
      lastAction: guideResult.nextAction,
    });

    // 9. Control status line
    const guideName   = this.guideOrchestrator.guide?.name   || "Guide";
    const controlName = this.guideOrchestrator.control?.name || "Control";
    const controlStatusLine =
      drift.driftLevel === "edge" ? `⚠️ ${drift.edgeNote || "Edge expansion."}` :
      drift.driftLevel === "none" ? `✅ ${drift.statusMessage || "On topic."}` : null;

    // 10. History
    history.push({ role: "human_teacher", content: humanMessage, timestamp: new Date() });
    history.push({ role: "student_agent", content: studentReply,  timestamp: new Date() });

    // XP calculation — decay sessions earn bonus XP
    const baseXP  = 5 +
      (analysis.newConceptLearned    ? 20 : 0) +
      (analysis.misconceptionCleared ? 15 : 0);
    const turnXP  = this.sessionType === "decay_review" ? Math.round(baseXP * 1.5) : baseXP;
    this.stats.xpEarned += turnXP;

    return {
      type:                 "teaching_response",
      studentAgentResponse: studentReply,
      guideMessage:         guideResult.tip,
      guideIsUrgent:        guideResult.isUrgent || false,
      guideName,
      controlStatusLine,
      controlName,
      adaptiveEngine: {
        understanding:        Math.round(updatedState.cognitive.understanding * 100),
        confusion:            Math.round(updatedState.cognitive.confusion     * 100),
        actionLabel:          this._friendlyAction(guideResult.nextAction, analysis),
        misconception:        analysis.misconceptionDetected  || null,
        misconceptionCleared: analysis.misconceptionCleared   || false,
        newConceptLearned:    analysis.newConceptLearned      || null,
        agentKnowledgeAdded:  this.stats.agentKnowledgeAdded,
        knowledgeScore:       Math.round(this.studentAgentRecord.knowledge_score),
        agentLevel:           this.studentAgentRecord.level,
      },
      phaseChanged, phaseLabel, subtopicAdvanced,
      currentSubtopic: mustKnowParts[this.session.mustKnowIndex] || null,
      currentPhase:    this.session.phase,
      // Structured-block context — lets the UI render the subtopic header,
      // phase plan and objectives checklist on each advance (real data).
      topic,
      subject:            this.subject || "",
      subtopicIdx:        this.session.mustKnowIndex,
      totalSubtopics:     (mustKnowParts || []).length || 1,
      subtopicObjectives: subtopicAdvanced ? (mustKnowParts || []) : [],
      driftInfo:       drift,
      agentPairId:     "student-session",
      sessionType:     this.sessionType,
      turnXP,
    };
  }

  // ── END SESSION ──────────────────────────────────────────────
  // Read-only session summary — does NOT end or mutate the session, so the
  // user can keep teaching after viewing it. Returns the shape the client
  // summary view expects. Used by the `request_summary` WebSocket event.
  async generateSummary() {
    const { topic, history } = this.session;
    const agentId = this.studentAgentRecord.id;

    const state = await getStudentState(agentId);
    const u = Math.round(state.cognitive.understanding * 100);

    const evaluation = this.guideOrchestrator.guide?.evaluateSession
      ? await this.guideOrchestrator.guide.evaluateSession(topic, history, u)
      : {
          overallScore: Math.round(u * 0.9),
          strengths:    this.stats.conceptsLearned.map(c => `Taught: ${c}`).slice(0, 3),
          nextTimeTip:  "Keep building on this foundation!",
          nextLesson:   `Continue with ${topic}`,
        };

    return {
      teachingScore:  evaluation.overallScore ?? Math.round(u * 0.9),
      xpEarned:       this.stats.xpEarned,
      agentFeedback:  evaluation.nextTimeTip || `Good work teaching ${topic}.`,
      keyConcepts:    (this.stats.conceptsLearned || []).slice(0, 5),
      strengthAreas:  evaluation.strengths || [],
      gapsIdentified: this.stats.misconceptionsCleared?.length
        ? this.stats.misconceptionsCleared.slice(0, 3)
        : (evaluation.nextLesson ? [evaluation.nextLesson] : []),
    };
  }

  async endSession() {
    const { topic, history } = this.session;
    const agentId   = this.studentAgentRecord.id;
    const studentId = this.studentId;
    const subject   = this.decayPayload?.subject || null;

    const state = await getStudentState(agentId);
    const u = Math.round(state.cognitive.understanding * 100);
    const c = Math.round(state.cognitive.confusion     * 100);

    // Flush knowledge buffer
    const sessionId  = this.session.sessionId || `session_${agentId}_${Date.now()}`;
    const savedCount = await this.studentAgent.flushKnowledgeBuffer(sessionId);
    this.stats.agentKnowledgeAdded = savedCount;

    // If this was a decay review — reinforce the topic confidence
    let reinforcementResult = null;
    if (this.sessionType === "decay_review" && this.decayPayload?.topic) {
      reinforcementResult = await decayEngine.reinforceKnowledge(
        agentId, studentId,
        this.decayPayload.subject,
        this.decayPayload.topic,
        u / 100,   // performance score
        sessionId
      );

      // Mark notification as actioned
      if (this.notificationId) {
        await decayEngine.markNotificationActioned(this.notificationId, sessionId);
      }
    }

    // Increment agent stats
    await incrementAgentStats(agentId, {
      turnsAdded:     this.stats.turnsCompleted,
      knowledgeAdded: savedCount * 5,
      xpEarned:       this.stats.xpEarned,
      subject,
    });

    // Reload updated agent record
    const { data: updatedAgent } = await supabase
      .schema("edu").from("student_agents")
      .select("*")
      .eq("id", agentId)
      .single();

    // Finalize session delta
    const durationSec = Math.round((Date.now() - this.sessionStartTime) / 1000);
    if (this.sessionDeltaId) {
      await finalizeSessionDelta({
        sessionId,
        understandingEnd:      u,
        conceptsLearned:       this.stats.conceptsLearned,
        misconceptionsCleared: this.stats.misconceptionsCleared,
        agentKnowledgeAdded:   savedCount,
        studentKnowledgeRefs:  this.stats.studentKnowledgeRefs,
        teacherChunksUsed:     this.stats.teacherChunksUsed,
        totalTurns:            this.stats.turnsCompleted,
        durationSec,
        xpEarned:              this.stats.xpEarned,
      }).catch(() => null);
    }

    // Guide evaluation
    const evaluation = this.guideOrchestrator.guide?.evaluateSession
      ? await this.guideOrchestrator.guide.evaluateSession(topic, history, u)
      : {
          overallScore: Math.round(u * 0.9),
          strengths:    this.stats.conceptsLearned.map(c => `Taught: ${c}`).slice(0, 3),
          nextTimeTip:  "Keep building on this foundation!",
          nextLesson:   `Continue with ${topic}`,
        };

    const controlReport = this.guideOrchestrator.control?.getFinalReport?.() ||
      { summary: `✅ Session complete — ${this.stats.turnsCompleted} turns` };

    return {
      evaluation,
      controlReport,
      finalState:  { understanding: u, confusion: c },
      totalTurns:  this.session.turnCount,
      topic,
      agentPairId: "student-session",
      sessionType: this.sessionType,

      agentGrowth: {
        knowledgeChunksSaved:  savedCount,
        xpEarned:              this.stats.xpEarned,
        conceptsLearned:       this.stats.conceptsLearned,
        misconceptionsCleared: this.stats.misconceptionsCleared,
        agentLevel:            updatedAgent?.level || this.studentAgentRecord.level,
        agentKnowledgeScore:   Math.round(updatedAgent?.knowledge_score || 0),
        totalSessions:         updatedAgent?.total_sessions || 0,
        leveledUp:             (updatedAgent?.level || 1) > this.studentAgentRecord.level,
      },

      // Decay-specific summary
      decayResult: reinforcementResult ? {
        topicReinforced:    this.decayPayload?.topic,
        subject:            this.decayPayload?.subject,
        confidenceBefore:   reinforcementResult.confidenceBefore,
        confidenceAfter:    reinforcementResult.confidenceAfter,
        reinforcementType:  reinforcementResult.reinforcementType,
        newPriority:        reinforcementResult.newPriority,
        nextReviewDue:      reinforcementResult.nextReviewDue,
      } : null,
    };
  }
}
