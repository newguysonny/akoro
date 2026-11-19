/**
 * lib/turnCheck.js — the end-of-turn check (Grand Plan Phase 16,
 * step 2). Pure; no db.
 *
 * The reply is held against what really happened this turn:
 *   1. an ACTION it claims ("I've created your task", "I've scheduled…",
 *      "I've deleted…") needs a successful tool call that changes things; a
 *      change that only made a Confirm card hasn't happened yet;
 *   2. when the task ledger still has steps left, a reply saying it's all done
 *      gets what is left.
 * Admin-request claims keep their own check (requestClaims.js). The checks
 * append a plain line; they never rewrite the reply.
 */
import { doneWhenOf, meetDoneWhen } from "./taskLedger.js";

// "I've created / set up / scheduled / added / deleted / removed / cancelled /
// sent / posted / saved / published / started / booked / assigned / updated …"
const VERBS = "created|made|set up|scheduled|added|deleted|removed|cancelled|canceled|sent|posted|saved|published|started|booked|assigned|updated|marked|moved|renamed|completed|challenged|messaged|blocked|enrolled|filed";
const CLAIM = new RegExp(String.raw`\b(?:I(?:'ve| have)|I just|I(?:'ve| have) just|Done[,!—–-]\s*I(?:'ve| have)?)\s+(?:also\s+)?(?:${VERBS})\b`, "i");
// "Your task is created", "the battle has been scheduled", "it's been deleted"
const PASSIVE = new RegExp(String.raw`\b(?:is|has been|have been|was|were|it's been|now)\s+(?:successfully\s+)?(?:${VERBS})\b`, "i");
// Not a claim: a question, an offer, a plan or a conditional ("I can create", "Shall I…", "once you confirm, I'll…").
const HEDGE = /\b(?:can I|shall I|should I|would you like|want me to|do you want|I can|I could|I'll|I will|I would|once you|when you|if you|after you|to (?:create|schedule|delete)|not (?:yet )?(?:created|scheduled|deleted|sent|saved))\b/i;

// Not a claim either: the verb negated — an honest failure ("nothing was added", "it wasn't created", "I haven't scheduled it").
const NEGATED = new RegExp(String.raw`\b(?:nothing|not|no|never|no longer|\w+n['’]t)\s+(?:\w+\s+){0,3}?(?:${VERBS})\b`, "i");

const sentences = (text) => String(text || "").replace(/\s+/g, " ").match(/[^.!?\n]+[.!?]*/g) || [];

/** PURE: the sentences that claim an action happened. */
export function actionClaims(reply) {
  return sentences(reply).filter((s) => (CLAIM.test(s) || PASSIVE.test(s)) && !HEDGE.test(s) && !NEGATED.test(s) && !/\?\s*$/.test(s)).map((s) => s.trim());
}

/**
 * PURE: the correction for claimed actions this turn didn't do, or null.
 * executions: this turn's tool calls ({ tool, success, sideEffecting, confirm, adminRequest, teach }).
 */
export function actionClaimCorrection(reply, executions = []) {
  const claims = actionClaims(reply);
  if (!claims.length) return null;
  const xs = (executions || []).filter((x) => x && x.tool !== "update_plan");
  // A Teach me button the protégé put in this chat backs "I've set up a Teach me button".
  const changed = xs.some((x) => x.success && (((x.sideEffecting || x.teach) && !x.confirm) || x.appliedDecision));
  if (changed) return null;
  if (xs.some((x) => x.confirm)) return "Note: nothing has changed yet — it happens when you tap **Confirm** on the card above.";
  // Admin requests are requestClaims.js's to judge; a failed change is the honest-failure path's.
  if (xs.some((x) => x.adminRequest)) return null;
  // A tool WAS attempted and failed: correct with its real error, not a guess.
  const failed = xs.find((x) => !x.success && x.error);
  if (failed) return `Correction: that didn't go through — ${String(failed.error).slice(0, 160)} Nothing was saved. Ask me again and I'll retry.`;
  // No write was attempted. Only correct a claim about the AGENT'S OWN action —
  // a first-person "I've …". A passive like "more material has been added since"
  // describes something/someone else, and correcting it on a read-only turn is
  // wrong (it produced a bogus "I didn't actually make that change" after a count).
  const firstPerson = claims.some((s) => CLAIM.test(s));
  if (!firstPerson) return null;
  return "Correction: I didn't actually make that change this time — nothing was saved. Ask me again and I'll do it properly.";
}

// "That's everything", "all done", "you're all set", "everything is ready", "all three are done".
const ALL_DONE = /\b(?:all (?:done|set|sorted|finished)|that'?s (?:everything|all of it|it)|everything(?:'s| is) (?:done|ready|set|sorted)|you(?:'re| are) all set|all (?:\w+ )?(?:of them|steps) (?:are|is) (?:done|complete))\b/i;

/** PURE: what the ledger still has left, appended when the reply says it's all done. */
export function ledgerLeftCorrection(reply, ledger, executions = []) {
  if (!ALL_DONE.test(String(reply || ""))) return null;
  const plan = Array.isArray(ledger?.plan) ? ledger.plan : [];
  const left = plan.filter((s) => s && !["done", "completed"].includes(s.status)).map((s) => String(s.step || "").trim()).filter(Boolean);
  // The plan's "done when" conditions (Phase 22 Part E) not yet made true by a successful call (this turn included).
  for (const d of meetDoneWhen(doneWhenOf(ledger), executions)) if (!d.met) left.push(d.condition);
  if (!left.length) return null;
  return `Still to do: ${left.slice(0, 4).join("; ")}${left.length > 4 ? ` (+${left.length - 4} more)` : ""}.`;
}

/** Both checks → the lines to append (possibly none). */
export function turnCorrections(reply, { executions = [], ledger = null } = {}) {
  return [actionClaimCorrection(reply, executions), ledgerLeftCorrection(reply, ledger, executions)].filter(Boolean);
}
