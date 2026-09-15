import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const auth = await readFile(new URL("./routes.js", import.meta.url), "utf8");
const adminSource = await readFile(new URL("../admin/routes.js", import.meta.url), "utf8");
const schoolMgmt = await readFile(new URL("../school/mgmt.js", import.meta.url), "utf8");
const schoolRoutes = await readFile(new URL("../school/routes.js", import.meta.url), "utf8");
const profiles = await readFile(new URL("../profiles/routes.js", import.meta.url), "utf8");
const appJs = await readFile(new URL("../../app.js", import.meta.url), "utf8");
const layout = await readFile(
  new URL("../../../akoro-instructor/src/components/Layout.jsx", import.meta.url), "utf8",
);
const instructorSocket = await readFile(
  new URL("../../../akoro-instructor/src/hooks/useWebSocket.js", import.meta.url), "utf8",
);
const learnerSocket = await readFile(
  new URL("../../../akoro-learner/src/hooks/useWebSocket.js", import.meta.url), "utf8",
);

test("every authenticated request no longer costs two DB commands", () => {
  // User row: 45s in-process cache, looked up BEFORE the query.
  assert.match(auth, /const USER_CACHE_TTL_MS = 45_000;/);
  assert.match(auth, /const cached = _userCache\.get\(decoded\.sub\);/);
  assert.match(auth, /if \(user\) cacheUser\(user\);/);
  // Revoked-token check: negative results are cached, never re-queried hot.
  assert.match(auth, /const JTI_CLEAR_TTL_MS = 30_000;/);
  assert.match(auth, /_jtiClear\.set\(jti, Date\.now\(\) \+ JTI_CLEAR_TTL_MS\)/);
  assert.match(auth, /if \(data\) \{ _denyList\.set\(jti/);
});

test("security-field changes bust the user cache immediately", () => {
  // force_logout_at / is_active / role writers must invalidate.
  assert.match(auth, /export function invalidateCachedUser/);
  const admin = adminSource;
  const busts = [
    [admin, /invalidateCachedUser\(req\.params\.id\)/],
    [schoolMgmt, /invalidateCachedUser\(user\.id\)/],
    [profiles, /invalidateCachedUser\(existingUser\.id\)/],
    [schoolRoutes, /invalidateCachedUser\(existing\.id\)/],
  ];
  for (const [src, re] of busts) assert.match(src, re);
});

test("join-request badges ride the websocket, not a 60-second poll", () => {
  // Server pushes on request + decision.
  assert.match(profiles, /emit\("join-requests-changed", \{ classroomId \}\)/);
  assert.match(profiles, /join-requests-changed/, "decision endpoint also emits");
  // The instructor layout has no 60s interval left.
  assert.doesNotMatch(layout, /setInterval\(poll, 60_?000\)/);
  assert.match(layout, /on\('join-requests-changed', onEvent\)/);
  assert.match(layout, /on\('notification', onPush\)/);
});

test("background jobs can stand down on metered deployments", () => {
  assert.match(appJs, /AKORO_BACKGROUND_JOBS_ENABLED \?\? "true"/);
  for (const job of ["embedding sweeper", "alert worker", "eval worker", "routine scheduler", "tenant host refresh"]) {
    assert.ok(appJs.includes(`skipJob("${job}")`), `guarded: ${job}`);
  }
});

test("socket clients cap their reconnect rate", () => {
  assert.match(instructorSocket, /reconnectionDelayMax: 30000/);
  assert.match(learnerSocket, /reconnectionDelayMax: 30000/);
});
