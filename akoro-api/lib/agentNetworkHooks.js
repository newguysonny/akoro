/**
 * lib/agentNetworkHooks.js — the agent-network functions battle needs, installed
 * at boot (Phase 19 step 2). battle never imports agent-network internals: app.js
 * registers the same functions it already loads.
 */

let hooks = null;

export function setAgentNetworkHooks(next) {
  hooks = next;
}

/** → { dailyRanking, postChallengeRequest }; throws before app.js installs them. */
export function agentNetworkHooks() {
  if (!hooks) throw new Error("Agent network hooks used before installation (setAgentNetworkHooks in app.js).");
  return hooks;
}
