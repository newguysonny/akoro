// =============================================================
// agents/trained/orchestrator.js
// Trained teacher orchestrator — fully DB-driven.
// Each teacher has their own unique flow, phases, voice.
// NOT linked to NaNa or Sargeant in any way.
// =============================================================

import { BaseOrchestrator, openai } from "../base-orchestrator.js";
import { TrainedGuide }   from "./guide.js";
import { TrainedControl } from "./control.js";
import {
  loadOrchestrationConfig,
  loadOrchestrationConfigByTeacher,
} from "../../training/agentOrchestration.js";
import {
  loadTeacherProfile,
  loadTeacherChunks,
  buildStudentAgentPrompt,
} from "../../training/agentPromptBuilder.js";
import { getStudentState, updateStudentState } from "../../student-state.js";

export class TrainedOrchestrator extends BaseOrchestrator {

  // Profile is populated dynamically from DB — override below
  static profile = {
    id:           "trained",
    name:         "Trained Teacher Agent",
    description:  "Teacher's own unique agent — trained from real lessons.",
    style:        "custom",
    bestFor:      ["subject-specific", "personalised teaching"],
    avatar:       "🎓",
  };

  constructor(config, teacherProfile) {
    super();
    this.config        = config;
    this.teacherProfile = teacherProfile;
    this.guide         = new TrainedGuide(config, teacherProfile);
    this.control       = new TrainedControl(config, teacherProfile);

    // Build dynamic profile from teacher data
    this._profile = {
      id:           `trained:${config.agent_id}`,
      name:         teacherProfile?.teacher_name
        ? `${teacherProfile.teacher_name}'s Agent`
        : "Trained Teaching Agent",
      description:  teacherProfile?.style_profile?.overall_summary
        || "Trained from real teaching sessions.",
      style:        teacherProfile?.style_profile?.tone || "custom",
      bestFor:      [teacherProfile?.subject || "general"].concat(
        (teacherProfile?.concepts_taught || []).slice(0, 3)
      ),
      avatar:       "🎓",
      guideAgent:   this.guide.name,
      controlAgent: this.control.name,
    };

    this.session.phase = this._getInitialPhase();
  }

  get profile() { return this._profile; }

  // ── Static factory — load from DB by agentId ─────────────────
  static async fromAgentId(agentId) {
    const config  = await loadOrchestrationConfig(agentId);
    if (!config) return null;
    const profile = await loadTeacherProfile(config.teacher_id);
    return new TrainedOrchestrator(config, profile);
  }

  static async fromTeacherId(teacherId) {
    const config  = await loadOrchestrationConfigByTeacher(teacherId);
    if (!config) return null;
    const profile = await loadTeacherProfile(teacherId);
    return new TrainedOrchestrator(config, profile);
  }

  // ── Get the first phase ID from the teacher's custom phases ──
  _getInitialPhase() {
    const phases = this.config.phase_definitions?.phases || [];
    return phases[0]?.id || "PHASE_1";
  }

  _getCurrentPhaseLabel(phaseId) {
    const phases = this.config.phase_definitions?.phases || [];
    const found  = phases.find(p => p.id === phaseId);
    return found?.label || phaseId;
  }

  // ── INIT ──────────────────────────────────────────────────────
  async initialize(agentId, topic) {
    this.session.agentId = agentId;
    this.session.topic   = topic;

    const agent = await this._loadStudentAgent(agentId);

    const [, boundary, mustKnow] = await Promise.all([
      Promise.resolve(agent),
      this.control.getTopicBoundary(topic),
      this.guide.detectMustKnowParts(topic),
    ]);

    this.session.mustKnowParts = mustKnow;

    const plan        = this.guide.buildTeachingPlan(topic, mustKnow);
    const allowedList = boundary.allowed.map(a  => `    ${a}`).join("\n");
    const offList     = boundary.offTopic.map(o => `    ${o}`).join("\n");

    const state = await getStudentState(agentId);
    const u     = Math.round(state.cognitive.understanding * 100);
    const c     = Math.round(state.cognitive.confusion     * 100);

    const phases       = this.config.phase_definitions?.phases || [];
    const phaseHeaders = phases.map((p, i) =>
      `  Phase ${i + 1}: ${p.label}`
    ).join("\n");

    const openingPrompt = [
      `═══════════════════════════════════════════════════════════════`,
      `SESSION START: Student teaches "${topic}" to Student Agent`,
      `Teacher Agent: ${this._profile.name}`,
      `Engine: Real-Time Adaptive Learning System`,
      `═══════════════════════════════════════════════════════════════`,
      ``,
      `🧠 INITIAL STATE`,
      `Understanding: ${u}% | Confusion: ${c}%`,
      ``,
      `${this.guide.name}:`,
      plan,
      ``,
      `${this.control.name}:`,
      `🎯 Topic boundary: ${topic} ONLY`,
      allowedList ? `  ✅ Allowed:\n${allowedList}` : "",
      offList     ? `  ❌ Off-topic:\n${offList}`   : "",
      ``,
      phases.length > 0 ? `📋 This teacher's phases:\n${phaseHeaders}` : "",
      ``,
      `═══════════════════════════════════════════════════════════════`,
      this._getCurrentPhaseLabel(this.session.phase),
      `═══════════════════════════════════════════════════════════════`,
      ``,
      `Ready — start teaching! 🚀`,
    ].filter(Boolean).join("\n");

    return {
      openingPrompt,
      topicBoundary:    boundary,
      mustKnowParts:    mustKnow,
      studentAgentName: agent.name,
      initialState:     { understanding: u, confusion: c },
      agentPairId:      this._profile.id,
      teacherName:      this.teacherProfile?.teacher_name || null,
    };
  }

  // ── PROCESS ONE TURN ──────────────────────────────────────────
  async processTeachingMessage(humanMessage, callbacks = {}) {
    const { onStudentChunk, onGuideChunk, onStateUpdate } = callbacks;
    const { topic, phase, mustKnowParts, mustKnowIndex, history } = this.session;

    this.session.turnCount++;

    const state = await getStudentState(this.session.agentId);

    // 1. Drift check + student reply IN PARALLEL
    // Student reply uses trained teacher's style prompt
    const recentHistory = history.slice(-6).map(h =>
      `${h.role === "human_teacher" ? "Teacher" : "Student Agent"}: ${h.content}`
    ).join("\n");

    const teacherChunks = await loadTeacherChunks(
      this.config.teacher_id,
      humanMessage,
      4
    );

    const combinedContext = teacherChunks.length > 0
      ? `## Relevant material from teacher's sessions:\n` +
        teacherChunks.map((c, i) => `[${i + 1}] (${c.chunk_type}) ${c.chunk_text}`).join("\n\n")
      : "";

    const studentSystemPrompt = await buildStudentAgentPrompt({
      config:          this.config,
      topic,
      understanding:   state.cognitive.understanding,
      confusion:       state.cognitive.confusion,
      phaseLabel:      this._getCurrentPhaseLabel(phase),
      combinedContext,
      recentHistory,
    });

    // No separate drift check. It ran beside this call, and its verdict could
    // discard the reply before anyone saw it — a turn spent, two calls billed,
    // one thrown away, and a red warning where teaching should have been. The
    // guide steers inside its own tip now. See nana-esumai/guide.js.
    const studentReply = await this._streamOrComplete(
      studentSystemPrompt, humanMessage, 0.65, onStudentChunk);

    // 2. Analyze understanding
    const analysis = await this._analyzeUnderstanding(studentReply, topic, history);

    // 3. Persist state
    const updatedState = await updateStudentState(
      this.session.agentId, topic, analysis,
      { phase, mustKnowIndex, lastAction: null, agentPairId: this._profile.id }
    );

    if (onStateUpdate) {
      onStateUpdate({
        understanding: Math.round(updatedState.cognitive.understanding * 100),
        confusion:     Math.round(updatedState.cognitive.confusion     * 100),
        engagement:    Math.round(updatedState.cognitive.engagement    * 100),
      });
    }

    // 4. Guide tip
    const guideResult = await this.guide.getTip(
      {
        topic,
        phase:           this._getCurrentPhaseLabel(phase),
        currentSubtopic: mustKnowParts[mustKnowIndex] || null,
        humanMessage,
        studentResponse: studentReply,
        understanding:   Math.round(updatedState.cognitive.understanding * 100),
        confusion:       Math.round(updatedState.cognitive.confusion     * 100),
        history,
        mustKnowParts,
        mustKnowIndex,
      },
      onGuideChunk || null
    );

    // 5. Advance phase / subtopic
    let phaseChanged     = false;
    let phaseLabel       = null;
    let subtopicAdvanced = false;

    if (guideResult.nextPhase && guideResult.nextPhase !== phase) {
      this.session.phase = guideResult.nextPhase;
      phaseChanged       = true;
      phaseLabel         = this._getCurrentPhaseLabel(guideResult.nextPhase);
    }

    if (guideResult.nextMustKnowIndex > mustKnowIndex) {
      this.session.mustKnowIndex = guideResult.nextMustKnowIndex;
      subtopicAdvanced           = true;
    }

    // 6. Final persist
    await updateStudentState(
      this.session.agentId, topic, analysis,
      {
        phase:         this.session.phase,
        mustKnowIndex: this.session.mustKnowIndex,
        lastAction:    guideResult.nextAction,
        agentPairId:   this._profile.id,
      }
    );

    // 7. Control status
    const controlStatusLine =
      // Nothing announced for staying on topic: "✅ On topic." on every turn was
      // noise, and noise is what made the warning easy to miss when it mattered.
      null;

    history.push({ role: "human_teacher", content: humanMessage, timestamp: new Date() });
    history.push({ role: "student_agent", content: studentReply,  timestamp: new Date() });

    return {
      type:                 "teaching_response",
      studentAgentResponse: studentReply,
      guideMessage:         guideResult.tip,
      guideIsUrgent:        guideResult.isUrgent || false,
      guideName:            this.guide.name,
      controlStatusLine,
      controlName:          this.control.name,
      adaptiveEngine: {
        understanding:        Math.round(updatedState.cognitive.understanding * 100),
        confusion:            Math.round(updatedState.cognitive.confusion     * 100),
        actionLabel:          this._friendlyAction(guideResult.nextAction, analysis),
        misconception:        analysis.misconceptionDetected  || null,
        misconceptionCleared: analysis.misconceptionCleared   || false,
      },
      phaseChanged,
      phaseLabel,
      subtopicAdvanced,
      currentSubtopic: mustKnowParts[this.session.mustKnowIndex] || null,
      currentPhase:    this.session.phase,
      driftInfo:       { isDrifting: !!guideResult?.offTopic, driftLevel: guideResult?.offTopic ? "edge" : "none" },
      agentPairId:     this._profile.id,
    };
  }

  // ── END SESSION ───────────────────────────────────────────────
  async endSession() {
    const { topic, history } = this.session;
    const state = await getStudentState(this.session.agentId);
    const u     = Math.round(state.cognitive.understanding * 100);
    const c     = Math.round(state.cognitive.confusion     * 100);

    const [evaluation] = await Promise.all([
      this.guide.evaluateSession(topic, history, u),
    ]);

    return {
      evaluation,
      controlReport: this.control.getFinalReport(),
      finalState:    { understanding: u, confusion: c },
      totalTurns:    this.session.turnCount,
      topic,
      agentPairId:   this._profile.id,
    };
  }

  // ── Stream or complete helper ─────────────────────────────────
  async _streamOrComplete(systemPrompt, userMessage, temperature, onChunk) {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userMessage  },
    ];

    if (onChunk) {
      const stream = await openai.chat.completions.create({
        model: "gpt-4.1-mini", temperature, stream: true, messages,
      });
      let full = "";
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || "";
        if (delta) { full += delta; onChunk(delta); }
      }
      return full;
    }

    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini", temperature, messages,
    });
    return res.choices[0].message.content;
  }
}
