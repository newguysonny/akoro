import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./service.js", import.meta.url), "utf8");

test("every review transition reaches the requester and their agent", () => {
  // A status edit that only writes the row is a silent drop: the learner (and
  // the agent that filed the request) must actually be told.
  assert.match(
    src,
    /NOTIFY_STATUSES\s*=\s*new Set\(\["under_review",\s*"planned",\s*"declined",\s*"implemented"\]\)/,
    "under_review and declined notify, not only planned/implemented",
  );
  for (const status of ["under_review", "planned", "declined", "implemented"]) {
    assert.match(src, new RegExp(`\\b${status}:\\s*\\{`), `copy exists for ${status}`);
  }
  assert.match(src, /informLearnerInChat\(\{\s*userId:\s*updated\.requester_id/, "the agent is told in chat");
  assert.doesNotMatch(src, /const NOTIFY_STATUSES\s*=\s*new Set\(\["planned",\s*"implemented"\]\)/, "the old two-status gate is gone");
});
