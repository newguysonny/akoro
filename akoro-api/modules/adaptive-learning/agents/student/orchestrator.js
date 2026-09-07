// =============================================================
// agents/student/orchestrator.js  v3.1
// Student session orchestrator.
// Supports two session types:
//   TYPE 1 — free_teaching: student picks any topic freely
//   TYPE 2 — decay_review:  system pre-loads subject+topic
//            triggered by DecayEngine when confidence drops
// =============================================================

import { BaseOrchestrator } from "../base-orchestrator.js";
import { StudentAgent } from "./agent.js";
import {
  getOrCreateStudentAgent,
  incrementAgentStats,
  createSessionDelta,
  finalizeSessionDelta,
  retrieveAgentKnowledgeByTopic,
} from "./knowledge.js";
import { decayEngine } from "./decayEngine.js";
import { getStudentState } from "../../student-state.js";
import { createTeachingEvidenceState, publicTeachingEvidence } from "../../teaching-evidence.js";
import { executeTeachingTurnWorkflow } from "../../teaching-workflow/runner.js";
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

const ACTION_FOR_DIALOGUE_MOVE = Object.freeze({
  clarify_core: "DIG_DEEPER",
  repair_misconception: "CLEAR_MISTAKE",
  apply_in_context: "USE_ANALOGY",
  connect_and_explain: "ONE_MORE_PUSH",
  stretch_transfer: "CHALLENGE",
  consolidate_and_advance: "GAP_CLOSED",
  synthesise: "TRIGGER_RECALL",
});

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
                decayPayload = null,
                referenceMaterial = null,
                teachingEvidence = null }) {      // compact server-derived evidence for a continuation
    super();
    this.studentId          = studentId;
    this.teacherAgentId     = teacherAgentId;
    this.guideOrchestrator  = guideOrchestrator;
    this.sessionType        = sessionType;
    this.decayPayload       = decayPayload;       // { subject, topic, confidence, priority, ... }
    this.subject            = subject || decayPayload?.subject || null;
    // The REST upload route already caps this value; keep only this object in
    // live memory and never write its raw source text to adaptive_sessions.
    this.referenceMaterial  = referenceMaterial?.text ? referenceMaterial : null;
    // Compact, transcript-free evidence may be restored for a continuation.
    // It is normalised only after the lesson ladder is known in initialize().
    this.resumeTeachingEvidence = teachingEvidence;
    this.teachingEvidence       = null;
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

  // Learner pace is derived from an expiry-aware, aggregate-only profile. If
  // the optional profile migration is unavailable or has too little evidence,
  // the evidence model safely uses the neutral standard pace.
  async _loadLearnerPaceProfile() {
    try {
      const { data, error } = await supabase
        .schema("edu").from("learner_teaching_profiles")
        .select("evidence_count, profile_confidence, pacing_recommendation, expires_at")
        .eq("learner_id", this.studentId)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    } catch (error) {
      console.warn("[teaching-evidence] learner pace profile unavailable:", error.message);
      return null;
    }
  }

  getTeachingEvidenceSnapshot() {
    return publicTeachingEvidence(this.teachingEvidence, this.session.mustKnowIndex);
  }

  getTeachingEvidenceScore() {
    const concepts = this.teachingEvidence?.concepts || [];
    if (!concepts.length) return 0;
    return Math.round((concepts.reduce((sum, concept) => sum + Number(concept.learnerMastery || 0), 0) / concepts.length) * 100);
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
      subject:     this.subject,   // scope expressed intelligence to this subject
      referenceMaterial: this.referenceMaterial,
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
    } else if (this.presetMustKnow?.length) {
      // Ladder already resolved (cached / scheme-of-work / grounded) — reuse it
      // instead of paying for detectMustKnowParts again.
      mustKnow = this.presetMustKnow;
    } else if (this.guideOrchestrator.guide?.detectMustKnowParts) {
      mustKnow = await this.guideOrchestrator.guide.detectMustKnowParts(topic);
    }
    this.session.mustKnowParts = mustKnow;

    // Pick up where they left off.
    //
    // A continuation used to replay the old transcript and then start teaching
    // from the first phase of the first subtopic, because nothing carried the
    // position across. The learner saw their previous words greyed out above a
    // lesson that had forgotten all of it — which is what "the previous data is
    // not there" describes, even though the words were right there.
    //
    // Clamped to the ladder actually resolved for this session: a stored index
    // of 4 against a three-step ladder would otherwise put them past the end.
    if (this.resumeFrom) {
      const idx = Number(this.resumeFrom.subtopicIdx);
      if (Number.isInteger(idx) && idx > 0) {
        this.session.mustKnowIndex = Math.min(idx, Math.max(0, mustKnow.length - 1));
      }
      const ph = String(this.resumeFrom.phase || "").toUpperCase();
      if (/^PHASE_[1-4]$/.test(ph) || ph === "MASTERY") this.session.phase = ph;
    }

    // A stale continuation cannot select an out-of-range concept.
    this.session.mustKnowIndex = Math.max(0, Math.min(
      Number(this.session.mustKnowIndex) || 0,
      Math.max(0, mustKnow.length - 1),
    ));

    // The pace comes from the authenticated learner's bounded profile, while
    // each concept's state comes only from demonstrated session evidence.
    const paceProfile = await this._loadLearnerPaceProfile();
    this.teachingEvidence = createTeachingEvidenceState({
      paceProfile,
      persisted: this.resumeTeachingEvidence,
      conceptCount: mustKnow.length || 1,
    });
    this.session.teachingEvidence = this.teachingEvidence;

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
        // The must-know parts ride ON the header now.
        //
        // They used to be rendered twice: once as the header's progress bar and
        // again, in full, as a separate "Objectives" checklist directly beneath
        // it. Same array, same order, same length — the checklist was the bar
        // spelled out. The header can page through them instead.
        type:     "subtopic-hdr",
        subtopic: mustKnow[0] || topic,
        items:    mustKnow,
        // Parallel to items — same order, same length. Empty for a
        // teacher-authored scheme of work, where the ordering is theirs and
        // needs no explanation from us.
        map:      this.session?.knowledgeMap || [],
        idx:      0,
        total:    mustKnow.length || 1,
        topic,
        subject:  this.subject || "",
      },
      // No "plan" block. The four phases are how the teaching agent steers the
      // session, not something a learner needs to read — they were a table of
      // contents for machinery. The PHASE_1 badge stays on the guide's own
      // messages, which is where knowing the phase actually helps.
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
      // This compact server-owned snapshot lets the transport report progress
      // without putting any mastery decision in the browser.
      teachingEvidence: this.getTeachingEvidenceSnapshot(),
      agentPairId:      "student-session",
      sessionType:      this.sessionType,
      decayPayload:     this.decayPayload || null,
    };
  }

  // ── PROCESS ONE TURN ─────────────────────────────────────────
  async processTeachingMessage(humanMessage, callbacks = {}) {
    // The turn is a fixed server workflow, not a model-routed collection of
    // capabilities. Its named tools run in an evidence-first sequence and the
    // final deterministic gate is the sole authority for lesson progress.
    this.session.turnCount++;
    this.stats.turnsCompleted++;

    const workflow = await executeTeachingTurnWorkflow({
      orchestrator: this,
      humanMessage,
      callbacks,
      phaseLabels: STUDENT_PHASES,
      actionForDialogueMove: ACTION_FOR_DIALOGUE_MOVE,
    });
    const {
      topic,
      mustKnowParts,
      analysis,
      evidenceUpdate,
      studentReply,
      updatedState,
      guideResult,
      phaseChanged,
      phaseLabel,
      subtopicAdvanced,
    } = workflow;

    const evidenceVerifiedConcept = evidenceUpdate.current.masteryStatus === "verified"
      ? analysis.newConceptLearned
      : null;
    const misconceptionCleared = evidenceUpdate.misconceptionRepaired;

    // Conversation content remains in the existing bounded session history.
    // The workflow trace itself carries only named public steps, never raw
    // messages, LLM rationale, or hidden chain-of-thought.
    this.session.history.push({ role: "human_teacher", content: humanMessage, timestamp: new Date() });
    this.session.history.push({ role: "student_agent", content: studentReply, timestamp: new Date() });

    // Reward verified work, not an unverified well-worded response.
    const baseXP = 5 +
      (evidenceVerifiedConcept ? 20 : 0) +
      (misconceptionCleared ? 15 : 0);
    const turnXP = this.sessionType === "decay_review" ? Math.round(baseXP * 1.5) : baseXP;
    this.stats.xpEarned += turnXP;

    const guideName = this.guideOrchestrator.guide?.name || "Guide";
    const controlName = this.guideOrchestrator.control?.name || "Control";

    return {
      type: "teaching_response",
      studentAgentResponse: studentReply,
      guideMessage: guideResult.tip,
      guideIsUrgent: guideResult.isUrgent || false,
      guideName,
      controlStatusLine: null,
      controlName,
      workflow: workflow.publicWorkflow,
      adaptiveEngine: {
        understanding: Math.round(updatedState.cognitive.understanding * 100),
        confusion: Math.round(updatedState.cognitive.confusion * 100),
        actionLabel: this._friendlyAction(guideResult.nextAction, analysis),
        misconception: analysis.misconceptionDetected || null,
        misconceptionCleared,
        newConceptLearned: evidenceVerifiedConcept,
        agentKnowledgeAdded: this.stats.agentKnowledgeAdded,
        knowledgeScore: Math.round(this.studentAgentRecord.knowledge_score),
        agentLevel: this.studentAgentRecord.level,
        learnerMastery: evidenceUpdate.current.learnerMastery,
        protegeUnderstanding: evidenceUpdate.current.protegeUnderstanding,
        teachingSkill: evidenceUpdate.current.teachingSkill,
        masteryStatus: evidenceUpdate.current.masteryStatus,
        dialogueMove: evidenceUpdate.dialogue.move,
        pace: evidenceUpdate.dialogue.pace,
      },
      teachingEvidence: this.getTeachingEvidenceSnapshot(),
      phaseChanged,
      phaseLabel,
      subtopicAdvanced,
      currentSubtopic: mustKnowParts[this.session.mustKnowIndex] || null,
      currentPhase: this.session.phase,
      topic,
      subject: this.subject || "",
      subtopicIdx: this.session.mustKnowIndex,
      totalSubtopics: mustKnowParts.length || 1,
      subtopicObjectives: subtopicAdvanced ? mustKnowParts : [],
      driftInfo: {
        isDrifting: !!guideResult?.offTopic,
        driftLevel: guideResult?.offTopic ? "edge" : "none",
      },
      agentPairId: "student-session",
      sessionType: this.sessionType,
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
    const protegeUnderstanding = Math.round(state.cognitive.understanding * 100);
    const learnerEvidenceScore = this.getTeachingEvidenceScore();

    const evaluation = this.guideOrchestrator.guide?.evaluateSession
      ? await this.guideOrchestrator.guide.evaluateSession(topic, history, learnerEvidenceScore)
      : {
          overallScore: Math.round(learnerEvidenceScore * 0.9),
          strengths:    this.stats.conceptsLearned.map(c => `Taught: ${c}`).slice(0, 3),
          nextTimeTip:  "Keep building on this foundation!",
          nextLesson:   `Continue with ${topic}`,
        };

    const evidence = this.getTeachingEvidenceSnapshot();
    const qualitativeScore = Number(evaluation?.overallScore);
    const boundedTeachingScore = Math.max(0, Math.min(
      100,
      learnerEvidenceScore,
      Number.isFinite(qualitativeScore) ? qualitativeScore : learnerEvidenceScore,
    ));
    const evidenceGaps = evidence.currentConcept?.masteryStatus === "verified"
      ? []
      : ["Build one more real-life explanation or application before moving on."];
    return {
      // Teaching score reflects the learner's demonstrated evidence, not merely
      // a fluent protege reply. The guide's qualitative evaluation can refine
      // it but cannot inflate it beyond demonstrated evidence.
      teachingScore:  boundedTeachingScore,
      protegeUnderstanding,
      learnerEvidenceScore,
      teachingEvidence: evidence,
      xpEarned:       this.stats.xpEarned,
      agentFeedback:  evaluation.nextTimeTip || `Good work teaching ${topic}.`,
      keyConcepts:    (this.stats.conceptsLearned || []).slice(0, 5),
      strengthAreas:  evaluation.strengths || [],
      gapsIdentified: this.stats.misconceptionsCleared?.length
        ? this.stats.misconceptionsCleared.slice(0, 3)
        : (evidenceGaps.length ? evidenceGaps : (evaluation.nextLesson ? [evaluation.nextLesson] : [])),
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
    const learnerEvidenceScore = this.getTeachingEvidenceScore();

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
        learnerEvidenceScore / 100,   // demonstrated teaching evidence, not delivery
        sessionId
      );

      // Mark notification as actioned
      if (this.notificationId) {
        await decayEngine.markNotificationActioned(this.notificationId, sessionId, studentId);
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
    let evaluation = this.guideOrchestrator.guide?.evaluateSession
      ? await this.guideOrchestrator.guide.evaluateSession(topic, history, learnerEvidenceScore)
      : {
          overallScore: Math.round(learnerEvidenceScore * 0.9),
          strengths:    this.stats.conceptsLearned.map(c => `Taught: ${c}`).slice(0, 3),
          nextTimeTip:  "Keep building on this foundation!",
          nextLesson:   `Continue with ${topic}`,
        };

    // Qualitative guide feedback is helpful, but its score may never claim more
    // than the learner actually demonstrated in server-owned evidence.
    const guideScore = Number(evaluation?.overallScore);
    evaluation = {
      ...evaluation,
      overallScore: Math.max(0, Math.min(
        100,
        learnerEvidenceScore,
        Number.isFinite(guideScore) ? guideScore : learnerEvidenceScore,
      )),
    };

    const controlReport = this.guideOrchestrator.control?.getFinalReport?.() ||
      { summary: `✅ Session complete — ${this.stats.turnsCompleted} turns` };

    return {
      evaluation,
      controlReport,
      finalState:  { understanding: u, confusion: c },
      learnerEvidenceScore,
      teachingEvidence: this.getTeachingEvidenceSnapshot(),
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
