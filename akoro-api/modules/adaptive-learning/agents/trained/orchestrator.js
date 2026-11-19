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
import { getStudentState, updateStudentState } from "../../../learner-state/index.js";

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
  /**
   * Retired (D42). This class only supplies the GUIDE (and control) inside a
   * StudentSessionOrchestrator session; it never runs a teaching turn. Its old
   * turn moved the learner's phase on the guide's say-so — phases now change
   * only through the evidence gate (teaching-session/state-machine.js).
   */
  async processTeachingMessage() {
    throw new Error("Guide pairs don't run teaching turns — use the student session (D42).");
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
