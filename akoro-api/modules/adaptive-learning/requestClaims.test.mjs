// node --test modules/adaptive-learning/requestClaims.test.mjs — the agent only says a request reached an admin when one did.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminRequestOf, claimsRequest, requestClaimCorrection } from "./requestClaims.js";
import { hasExplicitToolRequestConsent } from "./agent-tool-request-intent.js";

test("adminRequestOf: a real feature request, a still-open duplicate, a real escalation; dry runs and rejections are not", () => {
  assert.deepEqual(adminRequestOf("submit_tool_request", { submitted: true, duplicate: false }), { made: true, waiting: false });
  assert.deepEqual(adminRequestOf("submit_tool_request", { submitted: false, duplicate: true, status: "under_review" }), { made: false, waiting: true });
  assert.deepEqual(adminRequestOf("submit_tool_request", { submitted: false, error: "too short" }), { made: false, waiting: false });
  assert.deepEqual(adminRequestOf("create_tool", { status: "escalated", requestId: "r1" }), { made: true, waiting: false });
  assert.deepEqual(adminRequestOf("create_tool", { status: "escalated", dryRun: true }), { made: false, waiting: false });
  assert.deepEqual(adminRequestOf("create_tool", { status: "rejected", reason: "x" }), { made: false, waiting: false });
});

test("claimsRequest: the reply that started this — and honest replies that don't claim", () => {
  assert.ok(claimsRequest("I've filed the request — deleting tasks needs permission only an admin can grant, so it's pending now."));
  assert.ok(claimsRequest("I have asked an admin for permission to do that."));
  assert.ok(claimsRequest("Done — the request is now pending with the admins."));
  assert.ok(!claimsRequest("I can't delete tasks myself — I don't have a tool for that."));
  assert.ok(!claimsRequest("Do you want me to send a request to the admins?"));
});

test("requestClaimCorrection: a claim with nothing behind it is corrected; a backed one isn't", () => {
  const claim = "I've filed the request, so it's pending now.";
  assert.match(requestClaimCorrection(claim, []), /no request actually reached an admin/);
  assert.match(requestClaimCorrection(claim, [{ tool: "create_tool", adminRequest: { made: false, waiting: false } }]), /Correction/);
  assert.equal(requestClaimCorrection(claim, [{ tool: "submit_tool_request", adminRequest: { made: true, waiting: false } }]), null);
  assert.equal(requestClaimCorrection(claim, [{ tool: "submit_tool_request", adminRequest: { made: false, waiting: true } }]), null);
  assert.equal(requestClaimCorrection("Here are your tasks.", []), null);
  // The correction's own suggestion unlocks the request tool.
  assert.ok(hasExplicitToolRequestConsent("send it to the admins"));
});

test("asking for permission is consent to send the request", () => {
  for (const m of ["Ask for permission to delete task", "request access to my class results", "ask the admin for permission to delete tasks"]) assert.ok(hasExplicitToolRequestConsent(m), m);
  for (const m of ["do I have permission?", "What can you do?"]) assert.ok(!hasExplicitToolRequestConsent(m), m);
});

test("wiring: the chat records each turn's admin request and corrects an unbacked claim; a closed duplicate re-opens", () => {
  const chat = readFileSync(new URL("./chat/turn-answer.js", import.meta.url), "utf8");
  const loop = readFileSync(new URL("./chat/agent-loop.js", import.meta.url), "utf8");
  assert.match(loop, /adminRequest: adminRequestOf\(tool, toolResult\)/);
  assert.match(chat, /const fix = requestClaimCorrection\(reply, prepared\.toolExecutions\)/);
  const svc = readFileSync(new URL("../agent-tool-requests/service.js", import.meta.url), "utf8");
  assert.match(svc, /if \(CLOSED_STATUSES\.has\(existing\.data\.status\)\)/);
  const admin = readFileSync(new URL("../admin/agent-tool-requests.js", import.meta.url), "utf8");
  assert.match(admin, /order\("last_status_changed_at", \{ ascending: false, nullsFirst: false \}\)/);
});
