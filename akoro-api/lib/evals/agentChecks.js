// lib/evals/agentChecks.js
//
// Grand Plan Phase 16, step 6: Agent Chat measured on more than tool choice.
//
//   agent-checks  the code rules around the model, on recorded turns — the
//                 end-of-turn check (claims vs what happened, "all done" vs the
//                 ledger), the task ledger (done only when a call backs it),
//                 recovery after a failure, and the context budget for long
//                 chats. No model is called; every case must pass.
//   intent        the intent step's reading of learner messages (kind, and
//                 "more than one step"), hand-offs included — the model is called.
//
// Goldens: data/agent-checks.json, data/intent.json (data, not code).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openai } from "../aiModel.js";
import { actionClaimCorrection, ledgerLeftCorrection } from "../../modules/adaptive-learning/chat/turnCheck.js";
import { applyPlanUpdate } from "../../modules/adaptive-learning/chat/taskLedger.js";
import { shouldRetry, recoveryHint } from "../../modules/adaptive-learning/chat/toolRecovery.js";
import { fitDialogue } from "../../modules/adaptive-learning/grounding/contextBudget.js";
import { runIntentStep } from "../../modules/adaptive-learning/intent/intentStep.js";

const load = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(`./data/${f}`, import.meta.url)), "utf8"));
const CHECKS = load("agent-checks.json");
const INTENT = load("intent.json");
const matches = (want, got) => (typeof want === "string" && /^\/.*\/[a-z]*$/.test(want)
  ? new RegExp(want.slice(1, want.lastIndexOf("/")), want.slice(want.lastIndexOf("/") + 1)).test(String(got ?? ""))
  : want === got);

/** One recorded case through its rule. → { passed, expected, actual, detail } */
export function runCheck(c) {
  if (c.kind === "claim") {
    const fix = actionClaimCorrection(c.reply, c.executions);
    const actual = !fix ? "none" : /Confirm/.test(fix) ? "confirm" : "correction";
    return { passed: actual === c.expect, expected: c.expect, actual, detail: fix || "" };
  }
  if (c.kind === "left") {
    const actual = ledgerLeftCorrection(c.reply, c.ledger);
    return { passed: actual === c.expect, expected: c.expect, actual };
  }
  if (c.kind === "ledger") {
    const { ledger } = applyPlanUpdate(c.previous || null, c.input, c.executions);
    const actual = ledger.plan.map((s) => s.status);
    return { passed: JSON.stringify(actual) === JSON.stringify(c.expectStatuses), expected: c.expectStatuses, actual };
  }
  if (c.kind === "recovery") {
    const retry = shouldRetry(c.tool, c.result, { sideEffecting: !!c.sideEffecting });
    const next = recoveryHint(c.tool, c.result)?.next || "";
    const passed = retry === c.expectRetry && (c.expectNext === undefined || matches(c.expectNext, next));
    return { passed, expected: { retry: c.expectRetry, next: c.expectNext }, actual: { retry, next } };
  }
  if (c.kind === "budget") {
    const msgs = Array.from({ length: c.messages }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i} ${"x".repeat(c.chars)}` }));
    const { kept, dropped } = fitDialogue(msgs, { systemText: "s".repeat(c.systemChars) });
    const newest = kept.at(-1) === msgs.at(-1);
    const passed = (c.expectKept === undefined || kept.length === c.expectKept)
      && (c.expectKeptBelow === undefined || kept.length < c.expectKeptBelow)
      && (!c.expectKeepsNewest || newest) && kept.length + dropped.length === msgs.length;
    return { passed, expected: { kept: c.expectKept ?? `< ${c.expectKeptBelow}`, newest: !!c.expectKeepsNewest }, actual: { kept: kept.length, dropped: dropped.length, newest } };
  }
  return { passed: false, expected: "a known kind", actual: c.kind };
}

export const agentChecksSuite = {
  key: "agent-checks",
  title: "Agent Chat checks (no model)",
  purpose: "The code rules around Agent Chat's model, on recorded turns: claimed actions against what really happened, 'all done' against the task ledger, a step marked done only when a call backs it, recovery after a failure, and what of a long chat stays in front of the model. Costs nothing — no model call.",
  threshold: CHECKS.threshold,
  thresholdNote: CHECKS.thresholdNote,
  estimatedCalls: 0,
  cases: CHECKS.cases.map((c, i) => ({ key: `agent-check-${i + 1}`, name: `${c.kind} — ${c.name}`, async run() { return runCheck(c); } })),
};

export const intentSuite = {
  key: "intent",
  title: "Intent reading",
  purpose: "The intent step reads what the learner wants before the agent picks a tool: the kind of request (question, look-up, action, change, hand-off, chat), whether it takes several steps, and whether anything must be asked first (only what has no sensible default). Hand-off cases cover coordination — a session, the teaching guide or other agents taking over.",
  threshold: INTENT.threshold,
  thresholdNote: INTENT.thresholdNote,
  estimatedCalls: INTENT.cases.length,
  cases: INTENT.cases.map((c, i) => ({
    key: `intent-${i + 1}`,
    name: `${c.kind} — ${c.text.length > 48 ? c.text.slice(0, 45) + "…" : c.text}`,
    async run({ model, userId }) {
      if (c.kind === "chat") {
        // Greetings and thanks skip the model call by design; a reading is only checked when the step runs.
        const read = await runIntentStep({ message: c.text, create: (body) => openai.chat.completions.create({ ...body, model, __feature: "eval", __userId: userId, __payer: "platform" }) });
        return { passed: read === null || read.kind === "chat", expected: "chat (or no call)", actual: read?.kind ?? "skipped (greeting)" };
      }
      const read = await runIntentStep({ message: c.text, timeoutMs: 20_000, create: (body) => openai.chat.completions.create({ ...body, model, __feature: "eval", __userId: userId, __payer: "platform" }) });
      if (!read) return { passed: false, expected: c.kind, actual: "no reading", detail: "The intent step returned nothing (model error or unparseable answer)." };
      // missing: "none" — nothing to ask (defaults or a look-up cover it); "some" — the action can't run without asking.
      const missingOk = c.missing === undefined || (c.missing === "none" ? read.missing.length === 0 : read.missing.length > 0);
      const passed = read.kind === c.kind && (c.multiStep === undefined || read.multiStep === c.multiStep) && missingOk;
      return { passed, expected: { kind: c.kind, ...(c.multiStep !== undefined ? { multiStep: c.multiStep } : {}), ...(c.missing ? { missing: c.missing } : {}) },
        actual: { kind: read.kind, multiStep: read.multiStep, missing: read.missing }, detail: read.want };
    },
  })),
};
