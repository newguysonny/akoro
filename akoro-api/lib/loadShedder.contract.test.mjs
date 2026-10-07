// lib/loadShedder.contract.test.mjs
//
// The shedder's contract: under overload, non-essential traffic gets an
// honest 503 + Retry-After — but auth flows and health stay reachable, so a
// learner mid-session can still refresh a token and the platform can still
// see the truth. When NOT overloaded, nothing is shed.
import test from "node:test";
import assert from "node:assert/strict";
import { decideShed } from "../middleware/loadShedder.js";

test("when overloaded: auth and health are exempt, everything else sheds", () => {
  assert.equal(decideShed({ overloaded: true, path: "/health" }), false, "health must answer");
  assert.equal(decideShed({ overloaded: true, path: "/health?deep=1" }), false);
  assert.equal(decideShed({ overloaded: true, path: "/api/auth/login" }), false, "login must work");
  assert.equal(decideShed({ overloaded: true, path: "/api/auth/refresh" }), false, "refresh must work — a mid-session user is being silently re-authed");
  assert.equal(decideShed({ overloaded: true, path: "/api/auth/register" }), false);
  assert.equal(decideShed({ overloaded: true, path: "/api/auth/logout" }), false);

  assert.equal(decideShed({ overloaded: true, path: "/api/adaptive/chat/agent" }), true, "agent chat sheds first");
  assert.equal(decideShed({ overloaded: true, path: "/api/tasks" }), true);
  assert.equal(decideShed({ overloaded: true, path: "/api/records" }), true);
});

test("prefix matching must not exempt look-alike paths", () => {
  assert.equal(decideShed({ overloaded: true, path: "/api/auth/refresh-all" }), true,
    "a different route sharing a prefix stem must not ride the exemption");
});

test("when not overloaded: nothing is shed", () => {
  assert.equal(decideShed({ overloaded: false, path: "/api/adaptive/chat/agent" }), false);
  assert.equal(decideShed({ overloaded: false, path: "/api/anything" }), false);
});
