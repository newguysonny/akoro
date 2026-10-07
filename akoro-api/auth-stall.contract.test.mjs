import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const auth = read("modules/auth/routes.js");
const meeting = read("modules/courses/meeting-integration.js");

test("authenticateToken's network calls carry a deadline — the silent wedge is dead", () => {
  // Live catch (Render log, 2026-10-07T05:59:29Z): two community requests
  // REQUEST_STALLED at ~25s, inside the router, while the app answered
  // favicon 404s in 1ms. The wedge was authenticateToken's unwrapped I/O:
  // a fetch on a just-closed keep-alive socket hangs up to undici's 300s
  // header timeout — past every deadline, silent in every log.
  assert.match(auth, /const AUTH_IO_TIMEOUT_MS = 10_000;/);
  assert.match(auth, /function withAuthDeadline\(promise, label\)/);
  assert.match(auth, /Promise\.race\(\[promise, timeout\]\)/);
  // every network call in the auth path is wrapped, by name
  assert.match(auth, /withAuthDeadline\(DenyList\.has\(decoded\.jti\), "denylist"\)/);
  assert.match(auth, /"user-load"\)\)/);
  assert.match(auth, /"user-load-fallback"\)\)/);
  assert.match(auth, /withAuthDeadline\(schoolBillTo\(user\.id\), "school-bill-to"\)/);
});

test("an auth stall is a retryable 503, never a logout and never silence", () => {
  // A 401 would sign the learner out of a healthy session and send the
  // client into its refresh-retry loop; a 503 keeps the session and lets
  // the page retry. The log line names the stalled call.
  assert.match(auth, /err\.authStall/);
  assert.match(auth, /status\(503\)\.json\(\{ error: "The sign-in check is not answering\. Please retry\." \}\)/);
  assert.match(auth, /console\.error\(`\[auth\] \$\{err\.step\} stalled/);
});

test("the 6-hourly provider-token cron respects the jobs gate", () => {
  assert.match(meeting, /skipJob\("provider token refresh"\)/);
});
