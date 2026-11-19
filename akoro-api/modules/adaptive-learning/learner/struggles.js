/**
 * adaptive-learning/learner/struggles.js — Phase 4a slice 2 (§7.13.1, §7.15, D38):
 * struggles are recorded when detected and become BREAKTHROUGHS when they
 * resolve. One table, edu.learning_struggles.
 *
 *   recordStruggle({ learnerId, type, detectedBy, conceptId?, subject?, topic?,
 *                    observation, evidenceRefs, sourceWorkflow })
 *       → { status: "opened" | "updated" | "unchanged" (a replay), id } | { status: "refused", reason }
 *   resolveStruggles({ learnerId, type, conceptId?, evidenceRef, whatWorkedStrategy?,
 *                      whatWorked?, scoreAfter? }) → { resolved: n, ids }
 *   struggleEffects(event)   PURE: what a learning event opens / resolves
 *   afterLearningEvent(event)  called by the recorder after every write; a
 *       resolution credits the event's strategy, else the one recorded as
 *       working in that session (strategies/outcomes.js)
 *
 * Rules (§7.15.2): the type must be on the closed list and the detector one
 * the type allows (health_energy only from the learner's own words, never
 * inferred); an agent's observation must cite evidence; a sensitive type is
 * stored as type + date (+ concept) only — no summary, no "what worked";
 * health_energy expires after 30 days. One OPEN struggle per learner + type
 * + concept: a repeat adds its evidence and an attempt instead of a duplicate.
 */
import db from "../../../db.js";
import { struggleType, DETECTED_BY, STRUGGLE_TYPES_VERSION, HEALTH_EXPIRY_DAYS } from "../../../lib/struggleTypes.js";
import { strategyLabel } from "../strategies/library.js";
import { strategyThatWorked } from "../strategies/outcomes.js";

const E = () => db.schema("edu");
const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t ? t.slice(0, n) : null; };
const DAY = 864e5;

/** PURE: may this detector record this type? → null | reason */
export function refusalFor({ type, detectedBy, observation, evidenceRefs = [] }) {
  const def = struggleType(type);
  if (!def) return "unknown_type";
  if (!(DETECTED_BY[type] || []).includes(detectedBy)) return "detector_not_allowed";
  if (detectedBy === "agent" && !(evidenceRefs.length || String(observation || "").trim().length >= 20)) return "no_cited_evidence";
  return null;
}

/** PURE: the struggles a learning event opens or resolves (rule-detected types). */
export function struggleEffects(event) {
  const kind = event?.kind;
  const decaySource = event?.source === "learner_recall" || event?.details?.result != null || String(event?.sessionRef || "").startsWith("decay:");
  if (kind === "misconception_detected") return [{ action: "open", type: "misconception" }];
  if (kind === "misconception_cleared") return [{ action: "resolve", type: "misconception" }];
  if (kind === "recall_gap" && decaySource) return [{ action: "open", type: "decay" }];
  if (kind === "recall_success" && decaySource) return [{ action: "resolve", type: "decay" }];
  return [];
}

export async function recordStruggle({ learnerId, type, detectedBy, conceptId = null, subject = null, topic = null,
  observation = null, evidenceRefs = [], sourceWorkflow = null, scoreBefore = null, classLevel = null } = {}) {
  if (!learnerId) return { status: "refused", reason: "no_learner" };
  const why = refusalFor({ type, detectedBy, observation, evidenceRefs });
  if (why) return { status: "refused", reason: why };
  const def = struggleType(type);
  const refs = [...new Set((evidenceRefs || []).map((r) => String(r).slice(0, 200)).filter(Boolean))].slice(0, 20);
  try {
    // A repeat of an open struggle: one more attempt, its evidence added.
    let q = E().from("learning_struggles").select("id, attempts_before, evidence_refs").eq("learner_id", learnerId).eq("struggle_type", type).eq("status", "open");
    q = def.concept && conceptId ? q.eq("concept_id", conceptId) : q.is("concept_id", null);
    const { data: open } = await q.limit(1);
    if (open?.[0]) {
      const row = open[0];
      // A replay of evidence it already cites (a re-run, the backfill) is no new attempt.
      if (refs.length && refs.every((r) => (row.evidence_refs || []).includes(r))) return { status: "unchanged", id: row.id };
      const merged = [...new Set([...(row.evidence_refs || []), ...refs])].slice(-40);
      await E().from("learning_struggles").update({ attempts_before: (row.attempts_before || 0) + 1, evidence_refs: merged, updated_at: new Date().toISOString() }).eq("id", row.id);
      return { status: "updated", id: row.id };
    }
    const now = Date.now();
    const { data, error } = await E().from("learning_struggles").insert({
      learner_id: learnerId, category: def.category, struggle_type: type, types_version: STRUGGLE_TYPES_VERSION,
      subject: clip(subject, 120), class_level: clip(classLevel, 60), concept_id: def.concept ? conceptId : null,
      topic_label: clip(topic, 200), detected_by: detectedBy, evidence_refs: refs, status: "open",
      // Sensitive: type + date (+ concept) only — never words about the learner.
      struggle_summary: def.sensitive ? null : clip(observation, 200),
      misconception_key: type === "misconception" ? clip(String(topic || "").toLowerCase(), 120) : null,
      score_before: scoreBefore, source_workflow: clip(sourceWorkflow, 60),
      sensitive: def.sensitive, shareable: false,
      expires_at: type === "health_energy" ? new Date(now + HEALTH_EXPIRY_DAYS * DAY).toISOString() : null,
    }).select("id").single();
    if (error) {
      // Two writers raced to open the same struggle: the unique open index won — treat as an update.
      if (/duplicate|unique/i.test(error.message || "")) return recordStruggle({ learnerId, type, detectedBy, conceptId, subject, topic, observation, evidenceRefs, sourceWorkflow, scoreBefore, classLevel });
      console.warn("[struggles] not recorded:", error.message);
      return { status: "refused", reason: "write_failed", detail: error.message };
    }
    return { status: "opened", id: data.id };
  } catch (e) {
    console.warn("[struggles] failed:", e?.message || e);
    return { status: "refused", reason: "error" };
  }
}

/** Open struggles of this type (and concept) become breakthroughs. */
export async function resolveStruggles({ learnerId, type, conceptId = null, evidenceRef = null, whatWorkedStrategy = null, whatWorked = null, scoreAfter = null } = {}) {
  const def = struggleType(type);
  if (!learnerId || !def) return { resolved: 0, ids: [] };
  try {
    let q = E().from("learning_struggles").select("id, detected_at, evidence_refs, sensitive").eq("learner_id", learnerId).eq("struggle_type", type).eq("status", "open");
    q = def.concept && conceptId ? q.eq("concept_id", conceptId) : q;
    const { data: open } = await q.limit(10);
    const ids = [];
    for (const row of open || []) {
      const nowIso = new Date().toISOString();
      const days = Math.max(0, Math.round((Date.now() - new Date(row.detected_at).getTime()) / DAY));
      const { error } = await E().from("learning_struggles").update({
        status: "resolved", resolved_at: nowIso, days_to_overcome: days, score_after: scoreAfter,
        what_worked_strategy: clip(whatWorkedStrategy, 60),
        what_worked: row.sensitive ? null : clip(whatWorked, 300),
        evidence_refs: evidenceRef ? [...new Set([...(row.evidence_refs || []), String(evidenceRef).slice(0, 200)])].slice(-40) : row.evidence_refs,
        updated_at: nowIso,
      }).eq("id", row.id).eq("status", "open");
      if (!error) ids.push(row.id);
    }
    return { resolved: ids.length, ids };
  } catch (e) {
    console.warn("[struggles] resolve failed:", e?.message || e);
    return { resolved: 0, ids: [] };
  }
}

/** The recorder calls this after every successful evidence write. Never throws. */
export async function afterLearningEvent(event) {
  const out = [];
  const ref = `${event.sessionRef}/${event.turnRef}`;
  for (const fx of struggleEffects(event)) {
    if (fx.action === "open") {
      out.push({ ...fx, ...(await recordStruggle({ learnerId: event.learnerId, type: fx.type, detectedBy: "rule", conceptId: event.conceptId,
        subject: event.subject, topic: event.details?.part || event.details?.concept || event.topic,
        observation: `${event.kind.replace(/_/g, " ")} (${event.source})`, evidenceRefs: [ref], sourceWorkflow: event.source,
        scoreBefore: event.quality })) });
      // Phase 21 part 2: a NEW, non-sensitive struggle on a concept — the agent may
      // ask a friend's (or an opted-in learner's) agent what worked. Fire-and-forget.
      const opened = out[out.length - 1];
      if (opened?.status === "opened" && event.conceptId && !struggleType(fx.type)?.sensitive) {
        import("../../agent-network/index.js").then((o) => o.reachOut({ learnerId: event.learnerId, trigger: "struggle", purpose: "study_question",
          conceptId: event.conceptId, subject: event.subject || null, topic: event.details?.concept || event.topic || event.details?.part || null,
          gaps: [event.details?.part].filter(Boolean) })).catch(() => {});
      }
    } else {
      // What worked: the strategy the event names, else the one recorded as
      // working in this session (recordStrategyOutcome, slice 3).
      const strategy = event.details?.strategy || await strategyThatWorked({ learnerId: event.learnerId, conceptId: event.conceptId, sessionRef: event.sessionRef });
      out.push({ ...fx, ...(await resolveStruggles({ learnerId: event.learnerId, type: fx.type, conceptId: event.conceptId, evidenceRef: ref,
        whatWorkedStrategy: strategy || null, scoreAfter: event.quality,
        whatWorked: strategy ? `${strategyLabel(strategy)} in ${event.source}` : null })) });
    }
  }
  return out;
}
