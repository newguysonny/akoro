/**
 * agent-runtime/harness.js — the generic harness core (Grand Plan §7.2,
 * Phase 2): what every workflow's harness shares. A workflow plugs in its own
 * checks per action and its own code → HTTP map; the core runs them in order
 * and turns the first failure into a logged, typed rejection.
 *
 *   HarnessRejection                 stable code + HTTP status + copy
 *   createRejector({ httpFor, onReject })
 *                                    reject(subject, code, message, facts) — logs, then throws
 *   stateIs(field, allowed, message) a check: subject[field] must be one of allowed
 *   createChecker({ checks, reject }) check(action, ctx) — runs that action's checks
 *
 * A check is (ctx) → null (passes) | { code, message, facts? } (fails); it may
 * be async. Checks never write — the workflow acts only after they all pass.
 */

/** A harness rejection: stable machine-readable code + HTTP status + copy. */
export class HarnessRejection extends Error {
  constructor(code, message, httpStatus = 409) { super(message); this.code = code; this.httpStatus = httpStatus; }
}

/** reject(subject, code, message, facts): `onReject` records it (when there's a subject), then it throws. */
export function createRejector({ httpFor = {}, onReject = null } = {}) {
  return async function reject(subject, code, message, facts = {}) {
    if (subject && onReject) await onReject(subject, code, facts);
    throw new HarnessRejection(code, message, httpFor[code] ?? 409);
  };
}

/** A check that `ctx[key][field]` is one of `allowed` (default key: "session"). */
export function stateIs(allowed, message, { key = "session", field = "status" } = {}) {
  const ok = new Set(Array.isArray(allowed) ? allowed : [allowed]);
  return (ctx) => (ok.has(ctx?.[key]?.[field]) ? null : { code: "invalid_state_transition", message });
}

/** check(action, ctx): the first failing check of that action rejects (with ctx.session as the subject). */
export function createChecker({ checks = {}, reject }) {
  return async function check(action, ctx = {}) {
    for (const fn of checks[action] || []) {
      const failed = await fn(ctx);
      if (failed) return reject(ctx.session ?? null, failed.code, failed.message, failed.facts || {});
    }
    return null;
  };
}
