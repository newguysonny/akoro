/**
 * adaptive-learning/strategies/recommend.js — Phase 4a (§7.7, §7.7.1 step 2,
 * §7.15.3): which Strategy Library strategies to offer, ranked.
 *
 *   recommendStrategies({ learnerId, conceptId? | subject+topic, struggleType?,
 *                         workflow, executor? })
 *     → { ranked: [{ id, name, executor, reasons, ownRate, populationRate, usesOnTopic, limit }],
 *         exhausted: [{ id, reason, usesOnTopic, limit }], struggleTypes }
 *   checkStrategyLimit({ learnerId, strategyId, conceptId? | subject+topic })
 *     → { refusal: "strategy_limit_reached" | null, usesOnTopic, limit }
 *   rankStrategies(...) / strategyLimitRefusal(...)   PURE (tested without a db)
 *
 * Ranking (a recommendation — the agent chooses, the harness validates):
 *   1. the learner's OWN outcomes with the strategy (worked > untried > failed),
 *   2. then the anonymous population outcome for the same struggle type
 *      (only from ≥ 5 learners, D36),
 *   3. then library order.
 * Exhausted strategies are left out: used `limits.maxUsesPerTopic` times on
 * this topic already, or last judged `did_not_work` on it in this workflow
 * (§7.7 "no repeating the same failed strategy indefinitely").
 *
 * Reads only. Never throws: on a read failure the candidates come back in
 * library order, marked `degraded`.
 */
import db from "../../../db.js";
import { getStrategy, strategiesFor, strategiesForStruggle } from "./library.js";

const E = () => db.schema("edu");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Anonymous totals count only from this many learners (D36). */
export const POPULATION_MIN_LEARNERS = 5;
const OUTCOME_VALUE = Object.freeze({ worked: 1, partial: 0.5, did_not_work: 0 });
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** PURE: is this outcome row about this topic (concept first, else the topic label)? */
export function onTopic(row, { conceptId = null, topic = null } = {}) {
  if (conceptId && row?.concept_id === conceptId) return true;
  return !!topic && !!norm(row?.topic_label) && norm(row.topic_label) === norm(topic);
}

/** PURE: one "use" of a strategy — a session (Teaching), or one accepted offer (Study Prep). */
export const useKey = (row) => row?.details?.use || row?.session_ref || row?.id;

/** PURE: a judged outcome's value (worked 1, partial 0.5, did_not_work 0); pending/abandoned → null. */
export const outcomeValue = (row) => (row?.details?.pending ? null : OUTCOME_VALUE[row?.outcome] ?? null);

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

/** PURE: how many times this strategy was used on this topic, and its limit. */
export function topicUses({ strategyId, ownRows = [], conceptId = null, topic = null }) {
  const s = getStrategy(strategyId);
  const here = ownRows.filter((r) => r.strategy_id === s?.id && onTopic(r, { conceptId, topic }));
  return { usesOnTopic: new Set(here.map(useKey)).size, limit: s?.limits?.maxUsesPerTopic ?? null, here };
}

/** PURE: "strategy_limit_reached" when one more use would pass limits.maxUsesPerTopic, else null. */
export function strategyLimitRefusal(input) {
  const { usesOnTopic, limit } = topicUses(input);
  return limit != null && usesOnTopic >= limit ? "strategy_limit_reached" : null;
}

/**
 * PURE: rank candidate ids. `own` are this learner's outcome rows (any topic),
 * `population` everyone's rows for the struggle type(s).
 */
export function rankStrategies({ candidates = [], own = [], population = [], conceptId = null, topic = null, workflow = null, struggleTypes = [], minLearners = POPULATION_MIN_LEARNERS } = {}) {
  const ranked = [];
  const exhausted = [];
  candidates.forEach((id, order) => {
    const s = getStrategy(id);
    if (!s) return;
    const mine = own.filter((r) => r.strategy_id === s.id);
    const { usesOnTopic, limit, here } = topicUses({ strategyId: s.id, ownRows: own, conceptId, topic });
    if (limit != null && usesOnTopic >= limit) { exhausted.push({ id: s.id, reason: "limit_reached", usesOnTopic, limit }); return; }
    const lastHere = here.filter((r) => (!workflow || r.workflow === workflow) && outcomeValue(r) != null)
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
    if (lastHere?.outcome === "did_not_work") { exhausted.push({ id: s.id, reason: "failed_here", usesOnTopic, limit }); return; }
    const ownRate = mean(mine.map(outcomeValue).filter((v) => v != null));
    const pop = population.filter((r) => r.strategy_id === s.id && outcomeValue(r) != null);
    const learners = new Set(pop.map((r) => r.learner_id)).size;
    const populationRate = learners >= minLearners ? mean(pop.map(outcomeValue)) : null;
    const reasons = [];
    if (struggleTypes.some((t) => s.targets.includes(t))) reasons.push("targets_struggle");
    if (ownRate == null) reasons.push("untried_by_you");
    else reasons.push(ownRate >= 0.5 ? "worked_for_you" : "did_not_work_for_you");
    if (populationRate != null) reasons.push(populationRate >= 0.5 ? "worked_for_others" : "rarely_works_for_others");
    ranked.push({
      id: s.id, name: s.name, executor: s.runsAs.executor, operation: s.runsAs.operation || null, reasons,
      ownRate: round2(ownRate), populationRate: round2(populationRate), populationLearners: learners,
      usesOnTopic, limit, order,
    });
  });
  // Own outcome first (untried sits between "worked for you" and "failed for you"), then the population, then library order.
  const key = (r) => [r.ownRate ?? 0.5, r.populationRate ?? 0.5, -r.order];
  ranked.sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  });
  return { ranked: ranked.map(({ order, ...r }) => r), exhausted };
}

const OUTCOME_COLUMNS = "id, learner_id, strategy_id, concept_id, topic_label, workflow, outcome, struggle_type, session_ref, turn_ref, details, created_at";

async function ownOutcomes(learnerId) {
  const { data, error } = await E().from("learning_strategy_outcomes").select(OUTCOME_COLUMNS)
    .eq("learner_id", learnerId).order("created_at", { ascending: false }).limit(500);
  if (error) throw error;
  return data || [];
}

async function populationOutcomes(types, ids) {
  if (!types.length || !ids.length) return [];
  const { data, error } = await E().from("learning_strategy_outcomes").select(OUTCOME_COLUMNS)
    .in("struggle_type", types).in("strategy_id", ids).limit(2000);
  if (error) throw error;
  return data || [];
}

/** The learner's open struggle types on this concept / topic (or with no concept). */
async function openStruggleTypes({ learnerId, conceptId, topic }) {
  const { data, error } = await E().from("learning_struggles").select("struggle_type, concept_id, topic_label")
    .eq("learner_id", learnerId).eq("status", "open").limit(50);
  if (error) throw error;
  return [...new Set((data || []).filter((r) => onTopic(r, { conceptId, topic }) || (!r.concept_id && !r.topic_label)).map((r) => r.struggle_type))];
}

async function conceptFor({ conceptId, subject, topic }) {
  if (conceptId) return UUID.test(conceptId) ? conceptId : null;
  if (!topic) return null;
  const { resolveConceptId } = await import("../learner/learning-events.js");
  return resolveConceptId({ subject, topic });
}

/** The candidates before ranking: the struggle types' strategies in this workflow, else all of the workflow's. */
export function candidatesFor({ struggleTypes = [], workflow, executor = null, env = process.env }) {
  const byType = [...new Set(struggleTypes.flatMap((t) => strategiesForStruggle(t, workflow, env)))];
  const pool = byType.length ? byType : strategiesFor(workflow, { executor, env });
  const order = strategiesFor(workflow, { executor, env });
  return pool.filter((id) => !executor || getStrategy(id)?.runsAs.executor === executor)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

export async function recommendStrategies({ learnerId, conceptId = null, subject = null, topic = null, struggleType = null, workflow = "study_prep", executor = null, env = process.env } = {}) {
  let struggleTypes = struggleType ? [struggleType] : [];
  try {
    if (!learnerId) throw new Error("no learner");
    const concept = await conceptFor({ conceptId, subject, topic });
    if (!struggleTypes.length) struggleTypes = await openStruggleTypes({ learnerId, conceptId: concept, topic });
    const candidates = candidatesFor({ struggleTypes, workflow, executor, env });
    const [own, population] = await Promise.all([ownOutcomes(learnerId), populationOutcomes(struggleTypes, candidates)]);
    return { ...rankStrategies({ candidates, own, population, conceptId: concept, topic, workflow, struggleTypes }), struggleTypes, conceptId: concept };
  } catch (e) {
    if (learnerId) console.warn("[strategies/recommend] degraded:", e?.message || e);
    const candidates = candidatesFor({ struggleTypes, workflow, executor, env });
    return { ...rankStrategies({ candidates, struggleTypes }), struggleTypes, conceptId: null, degraded: true };
  }
}

/** Is one more use of this strategy on this topic allowed? Never throws (a read failure allows it). */
export async function checkStrategyLimit({ learnerId, strategyId, conceptId = null, subject = null, topic = null } = {}) {
  const limit = getStrategy(strategyId)?.limits?.maxUsesPerTopic ?? null;
  if (!learnerId || !getStrategy(strategyId)) return { refusal: null, usesOnTopic: 0, limit };
  try {
    const concept = await conceptFor({ conceptId, subject, topic });
    const ownRows = await ownOutcomes(learnerId);
    const input = { strategyId, ownRows, conceptId: concept, topic };
    return { refusal: strategyLimitRefusal(input), usesOnTopic: topicUses(input).usesOnTopic, limit, conceptId: concept };
  } catch (e) {
    console.warn("[strategies/recommend] limit check unavailable:", e?.message || e);
    return { refusal: null, usesOnTopic: null, limit, degraded: true };
  }
}
