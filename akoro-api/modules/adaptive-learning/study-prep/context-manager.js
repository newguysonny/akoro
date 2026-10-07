/**
 * study-prep context-manager — SHIM. The manager was promoted to platform
 * infrastructure in P0 of the Context Layer Adoption mini-plan
 * (modules/agent-context/context-manager.js + manifest.mjs). This file keeps
 * study-prep's imports (wiring.js, the context-layer contract tests) stable;
 * delete it in P7 when study-prep imports the platform module directly.
 */

export {
  CONTEXT_BUDGET, CONTEXT_MANIFEST, CONTEXT_SETS, CONTEXT_SET_NAMES,
  MANIFEST_VERSION, PENDING_ADOPTION,
  buildAgentContext, clearContextCache, contextVersion, loadContext, loadDoctrine, preflight,
} from "../../agent-context/context-manager.js";
