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

test("communities requests narrate arrival and auth in the logs", async () => {
  const routes = await read("modules/communities/routes.js");
  // The bracket pair that segments the next hang: arrival (pre-auth) and
  // auth-ok (post-authenticateToken). Whichever line is missing names the
  // wedged segment.
  assert.match(routes, /— arrived/);
  assert.match(routes, /— auth ok/);
  const arrived = routes.indexOf("— arrived");
  const authMount = routes.indexOf("router.use(authenticateToken);");
  const authOk = routes.indexOf("— auth ok");
  assert.ok(arrived !== -1 && arrived < authMount && authMount < authOk,
    "bracket order: arrived → authenticateToken → auth ok");
});

test("securityLog entries carry the full, never-mount-stripped URL", async () => {
  const security = await read("middleware/security.js");
  // The requestLogger logs req.path, which Express rewrites to the
  // innermost-router-relative path while a request descends into nested
  // mounts — a 422 showed up as "/sessions/<uuid>" with no hint of which
  // of four possible routers answered. originalUrl never changes, so every
  // AUTH_CHALLENGE / HTTP_NOT_FOUND / HTTP_ERROR line now names its endpoint.
  assert.match(security, /url:\s*req\?\.originalUrl/);
  const urlAt = security.indexOf("url:");
  const userIdAt = security.indexOf("userId:");
  assert.ok(urlAt !== -1 && userIdAt !== -1 && urlAt < userIdAt,
    "url sits beside the other request identity fields");
});
