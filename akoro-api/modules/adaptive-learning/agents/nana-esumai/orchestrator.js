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

  /**
   * Retired (D42). This class only supplies the GUIDE (and control) inside a
   * StudentSessionOrchestrator session; it never runs a teaching turn. Its old
   * turn moved the learner's phase on the guide's say-so — phases now change
   * only through the evidence gate (teaching-session/state-machine.js).
   */
  async processTeachingMessage() {
    throw new Error("Guide pairs don't run teaching turns — use the student session (D42).");
  }

  async endSession() {
    const { topic, history } = this.session;
    const state = await getStudentState(this.session.agentId);
    const u = Math.round(state.cognitive.understanding * 100);
    const evaluation = await this.guide.evaluateSession(topic, history, u);
    return { evaluation, controlReport: this.control.getFinalReport(), finalState: { understanding: u, confusion: Math.round(state.cognitive.confusion * 100) }, totalTurns: this.session.turnCount, topic, agentPairId: NaNaEsumaiOrchestrator.profile.id };
  }
}
