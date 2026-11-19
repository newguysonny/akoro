// =============================================================
// modules/adaptive-learning/learner/student-state.js  v3.2
// Adapted for akoro-api:
//   • Uses ioredis (not node-redis) — matches our existing Redis client
//   • Uses Supabase JS client from ../../db.js (not raw pg Pool)
//   • user IDs reference public.users(id) — not auth.users
//   • SUPABASE_SERVICE_ROLE_KEY → SUPABASE_SERVICE_KEY (our env var)
// =============================================================

import Redis  from "ioredis";
import db     from "../../../db.js";
import { traceRedis } from "../../../lib/redisTrace.js";
import { redisConnectionOptions } from "../../../lib/redisOptions.js";

// ── ioredis singleton (reuses the same Redis URL as the rest of akoro) ────────
let _redis = null;

export function getRedis() {
  if (!_redis) {
    _redis = traceRedis(new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", redisConnectionOptions({ label: "student-state" })), "student-state");
    _redis.on("error", (err) => console.error("[adaptive/Redis]", err.message));
    console.log("✅ [adaptive] Redis connected");
  }
  return _redis;
}

// ── Default state ─────────────────────────────────────────────────────────────
function defaultState(agentId) {
  return {
    agentId,
    knowledge: {},
    cognitive: {
      understanding: 0.20,
      confusion:     0.30,
      engagement:    0.60,
    },
    session: {
      phase:         "PHASE_1",
      mustKnowIndex: 0,
      turnCount:     0,
      lastAction:    null,
      agentPairId:   null,
    },
    history:   [],
    updatedAt: Date.now(),
  };
}

const CACHE_KEY = (id) => `adaptive_state:${id}`;
const CACHE_TTL = 60 * 60 * 24;   // 24 hours in seconds

// ── READ ──────────────────────────────────────────────────────────────────────
export async function getStudentState(agentId) {
  // 1. Try Redis hot cache
  try {
    const redis = getRedis();
    const raw   = await redis.get(CACHE_KEY(agentId));
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("[adaptive/State] Redis read failed:", e.message);
  }

  // 2. Fall back to Supabase cold store
  try {
    const { data } = await db
      .schema("edu").from("student_states")    // edu schema table — created in migration
      .select("state")
      .eq("agent_id", agentId)
      .single();

    if (data?.state) {
      await _cacheWrite(agentId, data.state);
      return data.state;
    }
  } catch (e) {
    console.warn("[adaptive/State] DB read failed:", e.message);
  }

  return defaultState(agentId);
}

// ── WRITE ─────────────────────────────────────────────────────────────────────
export async function saveStudentState(agentId, state) {
  state.updatedAt = Date.now();
  await Promise.allSettled([
    _cacheWrite(agentId, state),
    db.schema("edu").from("student_states").upsert(
      { agent_id: agentId, state, updated_at: new Date().toISOString() },
      { onConflict: "agent_id" }
    ),
  ]);
}

async function _cacheWrite(agentId, state) {
  try {
    const redis = getRedis();
    await redis.setex(CACHE_KEY(agentId), CACHE_TTL, JSON.stringify(state));
  } catch (e) {
    console.warn("[adaptive/State] Redis write failed:", e.message);
  }
}

// ── UPDATE ────────────────────────────────────────────────────────────────────
export async function updateStudentState(agentId, topic, analysis, delta = {}) {
  const state = await getStudentState(agentId);

  state.cognitive.understanding = _norm(analysis.understanding ?? state.cognitive.understanding * 100);
  state.cognitive.confusion     = _norm(analysis.confusion     ?? state.cognitive.confusion     * 100);
  state.cognitive.engagement    = _norm(analysis.engagement    ?? state.cognitive.engagement    * 100);

  // Phase 10: the per-agent `mistakes` / `strengths` arrays are retired.
  // Misconceptions live in the learner model (learner_concept_state via
  // learning-events.js); only the level and review time stay here. Old
  // states lose the arrays on their next write.
  state.knowledge[topic] = {
    level:        state.cognitive.understanding,
    lastReviewed: Date.now(),
  };

  if (delta.phase         !== undefined) state.session.phase         = delta.phase;
  if (delta.mustKnowIndex !== undefined) state.session.mustKnowIndex = delta.mustKnowIndex;
  if (delta.lastAction    !== undefined) state.session.lastAction    = delta.lastAction;
  if (delta.agentPairId   !== undefined) state.session.agentPairId   = delta.agentPairId;
  state.session.turnCount++;

  state.history.push({
    topic,
    understanding: state.cognitive.understanding,
    confusion:     state.cognitive.confusion,
    timestamp:     Date.now(),
  });
  if (state.history.length > 100) state.history = state.history.slice(-100);

  await saveStudentState(agentId, state);
  return state;
}

// ── DECISION ──────────────────────────────────────────────────────────────────
// decideNextAction moved into the Adaptive Learning Engine (adaptive-engine.js,
// recommendNextAction) — this module stores state; it no longer decides.

// ── CLEAR ─────────────────────────────────────────────────────────────────────
export async function clearStateCache(agentId) {
  try {
    const redis = getRedis();
    await redis.del(CACHE_KEY(agentId));
  } catch (e) {
    console.warn("[adaptive/State] Redis clear failed:", e.message);
  }
}

// =============================================================
// PREFERENCES  v3.2
// Reads from edu.user_agent_preferences.
// user_id references public.users(id) — our shared identity.
// =============================================================

export async function getAgentPreferences(userId) {
  try {
    const { data: prefs } = await db
      .schema("edu")
      .from("user_agent_preferences")
      .select("default_pair_id, purchased_agents, active_agent_id, updated_at")
      .eq("user_id", userId)
      .single();

    if (prefs) {
      const purchasedAgents = prefs.purchased_agents || [];
      return {
        guide_pair_id:    prefs.default_pair_id   || "nana-esumai",
        purchased_agents: purchasedAgents,
        active_agent_id:  prefs.active_agent_id   || null,
        available_pairs:  [
          "nana-esumai",
          "nana-esumai",
          ...purchasedAgents.map((id) => `trained:${id}`),
        ],
      };
    }

    // Fallback: legacy table
    const { data: legacy } = await db
      .schema("edu")
      .from("agent_preferences")
      .select("guide_pair_id")
      .eq("agent_id", userId)
      .single();

    return {
      guide_pair_id:    legacy?.guide_pair_id || "nana-esumai",
      purchased_agents: [],
      active_agent_id:  null,
      available_pairs:  ["nana-esumai", "professor-warden"],
    };
  } catch {
    return {
      guide_pair_id:    "nana-esumai",
      purchased_agents: [],
      active_agent_id:  null,
      available_pairs:  ["nana-esumai", "professor-warden"],
    };
  }
}

export async function saveAgentPreferences(userId, agentPairId) {
  await db.schema("edu")
    .from("user_agent_preferences")
    .upsert(
      { user_id: userId, default_pair_id: agentPairId, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
}

export async function userOwnsAgent(userId, agentId) {
  if (agentId === "nana-esumai" || agentId === "professor-warden") return true;
  try {
    const { data } = await db.rpc("edu_user_owns_agent", { p_user_id: userId, p_agent_id: agentId });
    return data === true;
  } catch {
    const prefs  = await getAgentPreferences(userId);
    const rawId  = agentId.replace("trained:", "");
    return prefs.purchased_agents.includes(rawId);
  }
}

export async function addPurchasedAgent(userId, agentId) {
  const prefs    = await getAgentPreferences(userId);
  const existing = prefs.purchased_agents || [];
  if (existing.includes(agentId)) return;
  await db.schema("edu")
    .from("user_agent_preferences")
    .upsert(
      { user_id: userId, purchased_agents: [...existing, agentId], updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _norm(val) {
  if (val > 1) return Math.min(1, val / 100);
  return Math.min(1, Math.max(0, val));
}
