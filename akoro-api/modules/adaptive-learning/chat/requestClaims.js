/**
 * adaptive-learning/chat/requestClaims.js — the agent may only say a request went
 * to an admin when one did, this turn.
 *
 * Two tools put a request in front of an admin (the Agent requests page):
 * submit_tool_request (a feature request) and create_tool when it escalates
 * (a permission request). A reply that says "I've filed the request…" /
 * "I've asked an admin…" with neither having really happened gets a plain
 * correction appended — the learner is never told about a request no admin
 * will ever see.
 */

/** PURE: what a tool result says about an admin request. → { made, waiting } */
export function adminRequestOf(tool, result) {
  const r = result && typeof result === "object" ? result : {};
  if (tool === "submit_tool_request") {
    return { made: r.submitted === true, waiting: r.duplicate === true && ["new", "under_review", "planned"].includes(r.status) };
  }
  if (tool === "create_tool") {
    // A change no tool can make, asked of the Akoro team with the learner's yes (a Tool idea).
    if (r.status === "requested" && !r.dryRun) return { made: r.submitted === true, waiting: r.duplicate === true && !r.reopened };
    const real = r.status === "escalated" && !r.dryRun && !!r.requestId;
    return { made: real && !r.duplicate, waiting: real && !!r.duplicate };
  }
  return { made: false, waiting: false };
}

// "I've filed/sent/submitted/raised the request", "I've asked an admin", "the request is pending".
const CLAIM = /\b(?:I(?:'ve| have)|I)\s+(?:just\s+)?(?:filed|sent|submitted|raised|logged|made|put in|passed on)\b[^.!?\n]{0,60}\b(?:request|ask)\b|\bI(?:'ve| have)\s+(?:just\s+)?asked\s+(?:an?\s+)?admin|\brequest\b[^.!?\n]{0,40}\b(?:is|it's|now)\s+(?:pending|with (?:an?|the) admins?|waiting)\b/i;

/** PURE: does the reply say a request went to an admin? */
export const claimsRequest = (reply) => CLAIM.test(String(reply || ""));

/** PURE: the correction to append, or null when the reply is honest. */
export function requestClaimCorrection(reply, executions = []) {
  if (!claimsRequest(reply)) return null;
  const backed = (executions || []).some((x) => x?.adminRequest && (x.adminRequest.made || x.adminRequest.waiting));
  if (backed) return null;
  return "Correction: no request actually reached an admin this time. Say \"send it to the admins\" and I'll file it properly.";
}
