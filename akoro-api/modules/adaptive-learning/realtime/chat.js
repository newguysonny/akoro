// Chat-domain socket events: the learner's agent inventory and the retired
// session starts.

import { listAgentPairs } from "../agents/registry.js";
import { getAgentPreferences } from "../../learner-state/index.js";

export function registerChatHandlers(socket) {
  // ── list_agent_pairs ──────────────────────────────────────
  // v3.2: accepts userId to return only owned agents
  socket.on("list_agent_pairs", async ({ userId } = {}) => {
    try {
      const pairs = await listAgentPairs(userId || null);
      socket.emit("agent_pairs_list", { pairs });
    } catch (err) { socket.emit("error", { message: err.message }); }
  });

  // ── get_my_agents ─────────────────────────────────────────
  // NEW v3.2 — returns user's full agent inventory
  socket.on("get_my_agents", async ({ userId }) => {
    if (!userId) return socket.emit("error", { message: "userId required" });
    try {
      const prefs = await getAgentPreferences(userId);
      const pairs = await listAgentPairs(userId);
      socket.emit("my_agents_data", {
        userId,
        defaultPairId:   prefs.guide_pair_id,
        activeAgentId:   prefs.active_agent_id,
        purchasedAgents: prefs.purchased_agents,
        availablePairs:  prefs.available_pairs,
        pairs,
      });
    } catch (err) { socket.emit("error", { message: err.message }); }
  });

  // ── Retired session starts (D42) ──────────────────────────
  // start_session ran the NaNa / Trained orchestrators, which moved the
  // learner up a phase on the guide's say-so; start_student_session and
  // start_decay_session never saved the session. Every teaching session now
  // starts with start_adaptive_session (fresh | continuation | decay), where
  // phases change only through the evidence gate and the guide is a choice
  // inside the session (switch_agent_pair).
  for (const retired of ["start_session", "start_student_session", "start_decay_session"]) {
    socket.on(retired, () => socket.emit("error", {
      code: "retired_event",
      message: `${retired} was retired — start the session with start_adaptive_session.`,
    }));
  }
}
