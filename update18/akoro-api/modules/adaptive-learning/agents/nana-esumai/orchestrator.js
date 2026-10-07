/**
 * agents/nana-esumai/orchestrator.js
 * NaNaEsumaiOrchestrator — default platform guide pair.
 * Used as guideOrchestrator in StudentSessionOrchestrator (decay flow).
 * guide = NaNa Esumai (coach), control = Sargeant (drift + assessment).
 */
import { BaseOrchestrator } from "../base-orchestrator.js";
import { NaNaEsumai }       from "./guide.js";
import { Sargeant }         from "../sargeant/assessment.js";
import { getStudentState, updateStudentState } from "../../student-state.js";

export const PHASES = {
  PHASE_1: "Phase 1 — What does Student Agent already know?",
  PHASE_2: "Phase 2 — Must-know parts",
  PHASE_3: "Phase 3 — Student Agent teaches it back",
  PHASE_4: "Phase 4 — Push a little further!",
  MASTERY: "Mastery",
};

export class NaNaEsumaiOrchestrator extends BaseOrchestrator {

  static profile = {
    id:           "nana-esumai",
    name:         "NaNa Esumai & Sargeant",
    description:  "Platform default — guided discovery. NaNa coaches human teaching quality. Sargeant gates advancement.",
    style:        "gentle",
    bestFor:      ["all subjects", "beginners", "conceptual topics"],
    avatar:       "🧠⚡",
    guideAgent:   "NaNa Esumai",
    controlAgent: "Sargeant",
  };

  constructor() {
    super();
    this.guide   = new NaNaEsumai();
    this.control = new Sargeant();
    this.session.phase = "PHASE_1";
  }

  async initialize(agentId, topic) {
    this.session.agentId = agentId;
    this.session.topic   = topic;
    const agent = await this._loadStudentAgent(agentId);
    const [boundary, mustKnow] = await Promise.all([
      this.control.checkForDrift([{ role: "human_teacher", content: topic }], topic)
        .then(() => ({ allowed: [topic], offTopic: [], boundaryStatement: `Stay on ${topic}` }))
        .catch(() => ({ allowed: [topic], offTopic: [], boundaryStatement: "" })),
      this.guide.detectMustKnowParts(topic),
    ]);
    this.session.mustKnowParts    = mustKnow;
    this.session.studentAgentName = agent.name;
    const plan = this.guide.buildTeachingPlan(topic, mustKnow);
    const state = await getStudentState(agentId);
    const u = Math.round(state.cognitive.understanding * 100);
    const c = Math.round(state.cognitive.confusion     * 100);
    return {
      openingPrompt:    `SESSION START: Student teaches "${topic}" to Student Agent\nGuide: ${NaNaEsumaiOrchestrator.profile.name}\n\nUnderstanding: ${u}% | Confusion: ${c}%\n\n${plan}\n\n${PHASES.PHASE_1}\n\nReady — start teaching! 🚀`,
      topicBoundary:    boundary,
      mustKnowParts:    mustKnow,
      studentAgentName: agent.name,
      initialState:     { understanding: u, confusion: c },
      agentPairId:      NaNaEsumaiOrchestrator.profile.id,
    };
  }

  async processTeachingMessage(humanMessage, callbacks = {}) {
    const { onStudentChunk, onGuideChunk, onStateUpdate } = callbacks;
    const { topic, phase, mustKnowParts, mustKnowIndex, history } = this.session;
    this.session.turnCount++;
    const state = await getStudentState(this.session.agentId);
    const [drift, studentReply] = await Promise.all([
      this.control.checkForDrift([...history.slice(-4), { role: "human_teacher", content: humanMessage }], topic),
      this._generateStudentReply({ humanMessage, topic, understanding: Math.round(state.cognitive.understanding * 100), confusion: Math.round(state.cognitive.confusion * 100), history, phaseLabel: PHASES[phase] }, onStudentChunk),
    ]);
    if (drift.isDrifting) {
      return { type: "drift_warning", sargeantMessage: this.control.generateRedirectMessage(drift, topic), studentAgentResponse: null, guideMessage: null, adaptiveEngine: null, driftInfo: drift };
    }
    const analysis    = await this._analyzeUnderstanding(studentReply, topic, history);
    const updatedState = await updateStudentState(this.session.agentId, topic, analysis, { phase, mustKnowIndex, lastAction: null, agentPairId: NaNaEsumaiOrchestrator.profile.id });
    if (onStateUpdate) onStateUpdate({ understanding: Math.round(updatedState.cognitive.understanding * 100), confusion: Math.round(updatedState.cognitive.confusion * 100), engagement: Math.round((updatedState.cognitive.engagement || 0.5) * 100) });
    const guideResult = await this.guide.getTip({ topic, phase: PHASES[phase], currentSubtopic: mustKnowParts[mustKnowIndex] || null, humanMessage, studentResponse: studentReply, understanding: Math.round(updatedState.cognitive.understanding * 100), confusion: Math.round(updatedState.cognitive.confusion * 100), history, mustKnowParts, mustKnowIndex }, onGuideChunk);
    let phaseChanged = false, phaseLabel = null, subtopicAdvanced = false;
    if (guideResult.nextPhase && guideResult.nextPhase !== phase) { this.session.phase = guideResult.nextPhase; phaseChanged = true; phaseLabel = PHASES[guideResult.nextPhase]; }
    if (guideResult.nextMustKnowIndex > mustKnowIndex) { this.session.mustKnowIndex = guideResult.nextMustKnowIndex; subtopicAdvanced = true; }
    await updateStudentState(this.session.agentId, topic, analysis, { phase: this.session.phase, mustKnowIndex: this.session.mustKnowIndex, lastAction: guideResult.nextAction, agentPairId: NaNaEsumaiOrchestrator.profile.id });
    const controlStatusLine = drift.driftLevel === "edge" ? `⚠️ ${drift.edgeNote || "Edge expansion allowed."}` : drift.driftLevel === "none" ? `✅ ${drift.statusMessage || "On topic."}` : null;
    history.push({ role: "human_teacher", content: humanMessage, timestamp: new Date() });
    history.push({ role: "student_agent",  content: studentReply,  timestamp: new Date() });
    return { type: "teaching_response", studentAgentResponse: studentReply, guideMessage: guideResult.tip, guideIsUrgent: guideResult.isUrgent || false, guideName: this.guide.name, controlStatusLine, controlName: this.control.name, adaptiveEngine: { understanding: Math.round(updatedState.cognitive.understanding * 100), confusion: Math.round(updatedState.cognitive.confusion * 100), actionLabel: this._friendlyAction(guideResult.nextAction, analysis), misconception: analysis.misconceptionDetected || null, misconceptionCleared: analysis.misconceptionCleared || false }, phaseChanged, phaseLabel, subtopicAdvanced, currentSubtopic: mustKnowParts[this.session.mustKnowIndex] || null, currentPhase: this.session.phase, driftInfo: drift, agentPairId: NaNaEsumaiOrchestrator.profile.id };
  }

  async endSession() {
    const { topic, history } = this.session;
    const state = await getStudentState(this.session.agentId);
    const u = Math.round(state.cognitive.understanding * 100);
    const evaluation = await this.guide.evaluateSession(topic, history, u);
    return { evaluation, controlReport: this.control.getFinalReport(), finalState: { understanding: u, confusion: Math.round(state.cognitive.confusion * 100) }, totalTurns: this.session.turnCount, topic, agentPairId: NaNaEsumaiOrchestrator.profile.id };
  }
}
