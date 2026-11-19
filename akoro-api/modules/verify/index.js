/**
 * verify — the Verification Gate harness. `default` is the /api/verify router;
 * named exports are the run entry points, the real-user approval helpers, the
 * target/write policy, and the assertion helpers installed at boot.
 *
 * Scenario modules are internal: they are registered through
 * `scenarios/index.js` and never re-exported here.
 */
export { default } from "./routes.js";
export { getRun, startRun } from "./runner.js";
export { listRealUserRuns, realUserScenarios, startRealUserRun } from "./realUser.js";
export { realUserWritesEnabled, resolveAccount, TARGET } from "./policy.js";
export { createExpect, repeatVerdict } from "./assertions.js";
