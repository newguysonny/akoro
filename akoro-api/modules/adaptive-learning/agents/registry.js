// =============================================================
// modules/adaptive-learning/agents/registry.js  v3.2
// Adapted for akoro-api:
//   • Uses db.js instead of direct supabase createClient
//   • edu schema tables accessed via db.schema("edu")
// =============================================================

import * as NanaEsumai                from "./nana-esumai/index.js";
import { Sargeant }                    from "./sargeant/assessment.js";
import { TrainedOrchestrator }        from "./trained/orchestrator.js";
import { StudentSessionOrchestrator } from "./student/orchestrator.js";
import { loadOrchestrationConfig }    from "../training/agentOrchestration.js";
import { loadTeacherProfile }         from "../training/agentPromptBuilder.js";
import { getAgentPreferences, userOwnsAgent } from "../../learner-state/index.js";
import db                             from "../../../db.js";

// NaNa Esumai is the default platform guide pair
const BUILTIN_REGISTRY = {
  "nana-esumai": NanaEsumai,
};

export async function getOrchestrator({
  agentPairId    = null,
  agentId        = null,
  studentId      = null,
  userId         = null,
  teacherAgentId = null,
  mode           = "auto",
  sessionType       = "free_teaching",
  subject           = null,
  decayPayload      = null,
  referenceMaterial = null,
  teachingEvidence  = null,
  priorBlocks       = null,   // previous session's block_history — restored as conversation memory
} = {}) {

  // D42: a learner's teaching session is ALWAYS the student session — the
  // 8-step turn, where the phase moves only through the evidence gate. A
  // guide pair ("nana-esumai" / "trained:<agentId>"), a trained agent id or
  // the learner's saved preference only chooses the GUIDE inside it. (They
  // used to return the NaNa / Trained orchestrators, which moved the phase on
  // the guide's say-so.)
  const caller = userId || studentId;
  if (!caller) return null;
  let guideId = teacherAgentId;
  if (!guideId && agentPairId?.startsWith("trained:")) guideId = agentPairId.replace("trained:", "");
  if (!guideId && agentId && agentId !== studentId) guideId = agentId;
  if (!guideId && !agentPairId) {
    const prefs = await getAgentPreferences(caller).catch(() => ({}));
    if (String(prefs?.guide_pair_id || "").startsWith("trained:")) guideId = prefs.guide_pair_id.replace("trained:", "");
  }
  const guideOrchestrator = await _resolveGuideForStudent(guideId, caller);
  return new StudentSessionOrchestrator({
    studentId: studentId || caller, teacherAgentId: guideId || null, guideOrchestrator, sessionType, subject, decayPayload, referenceMaterial, teachingEvidence, priorBlocks,
  });
}

async function _loadTrainedOrchestrator(agentId) {
  try {
    const config = await loadOrchestrationConfig(agentId);
    if (!config) return null;
    const teacherProfile = await loadTeacherProfile(config.teacher_id);
    return new TrainedOrchestrator(config, teacherProfile);
  } catch (err) {
    console.warn("[Registry] Could not load trained orchestrator:", err.message);
    return null;
  }
}

async function _resolveGuideForStudent(teacherAgentId, callerId) {
  // Default guide pair: NaNa Esumai (guide) + Sargeant (control). The student
  // orchestrator dereferences guideOrchestrator.guide / .control, so this must
  // never be null — fall back to the built-in NaNa pair.
  const defaultGuide = () => new BUILTIN_REGISTRY["nana-esumai"].Orchestrator();

  if (!teacherAgentId) return defaultGuide();
  try {
    if (callerId) {
      const owns = await userOwnsAgent(callerId, teacherAgentId);
      if (!owns) return defaultGuide();
    }
    const trained = await _loadTrainedOrchestrator(teacherAgentId);
    if (trained) return trained;
  } catch (err) {
    console.warn("[Registry] Teacher agent not found, using default:", err.message);
  }
  return defaultGuide();
}

export async function listAgentPairs(userId = null) {
  const builtIn = [];

  let trained = [];
  if (userId) {
    const prefs           = await getAgentPreferences(userId);
    const purchasedAgents = prefs.purchased_agents || [];
    if (purchasedAgents.length > 0) trained = await _loadPurchasedAgentProfiles(purchasedAgents);
  } else {
    trained = await _loadAllMarketplaceProfiles();
  }

  return [...builtIn, ...trained];
}

async function _loadPurchasedAgentProfiles(agentIds) {
  try {
    const { data } = await db.schema("edu")
      .from("marketplace_listings")
      .select("agent_id, title, subject, teacher_name, style_summary, avg_rating, teacher_avatar")
      .in("agent_id", agentIds).eq("is_active", true);
    return (data || []).map((row) => _mapListingToProfile(row, true));
  } catch (err) {
    console.warn("[Registry] Could not load purchased profiles:", err.message);
    return [];
  }
}

async function _loadAllMarketplaceProfiles() {
  try {
    const { data } = await db.schema("edu")
      .from("marketplace_summary")
      .select("agent_id, title, subject, teacher_name, style_summary, avg_rating, teacher_avatar, price_kobo, is_free")
      .eq("is_active", true).order("avg_rating", { ascending: false }).limit(50);
    return (data || []).map((row) => _mapListingToProfile(row, false));
  } catch (err) {
    console.warn("[Registry] Could not load marketplace profiles:", err.message);
    return [];
  }
}

function _mapListingToProfile(row, isPurchased) {
  return {
    id:           `trained:${row.agent_id}`,
    agentId:      row.agent_id,
    name:         row.title,
    description:  row.style_summary || "Trained teacher agent",
    style:        "trained",
    bestFor:      [row.subject],
    avatar:       row.teacher_avatar || "🎓",
    guideAgent:   row.teacher_name ? `${row.teacher_name}'s Guide` : "Trained Guide",
    controlAgent: "Focus Monitor",
    isTrained:    true,
    isPurchased,
    isFree:       row.is_free ?? false,
    priceKobo:    row.price_kobo,
    teacherName:  row.teacher_name,
    subject:      row.subject,
    rating:       row.avg_rating,
  };
}

export async function getAgentPairProfile(agentPairId, userId = null) {
  if (BUILTIN_REGISTRY[agentPairId]) return { ...BUILTIN_REGISTRY[agentPairId].Orchestrator.profile, isFree: true };
  if (agentPairId?.startsWith("trained:")) {
    const rawId = agentPairId.replace("trained:", "");
    if (userId && !await userOwnsAgent(userId, rawId)) return null;
    const orch = await _loadTrainedOrchestrator(rawId);
    return orch?.profile || null;
  }
  return null;
}

export const isValidBuiltInPairId = (id) => id in BUILTIN_REGISTRY;
export const listBuiltInPairs = () => [];
