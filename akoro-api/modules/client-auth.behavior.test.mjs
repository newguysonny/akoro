// The shared auth-refresh policy (Phase 19 step 5): what a refresh result means
// for the signed-in user, identical in all four apps.
import assert from "node:assert/strict";
import test from "node:test";
import { refreshAuth, userFromRefresh } from "../../design-system/client/authSession.ts";

const deps = (outcome, sink = {}) => ({
  refreshSession: async () => outcome,
  saveUser: (u) => sink.saved = u,
  clearUser: () => { sink.cleared = true; },
  onSoftFailure: (s) => { sink.soft = s; },
});

test("a successful refresh stores the user from data.user or user", async () => {
  const a = {};
  const ra = await refreshAuth(deps({ ok: true, status: 200, json: { data: { user: { id: "1" } } } }, a));
  assert.deepEqual(ra, { ok: true, rejected: false, user: { id: "1" } });
  assert.deepEqual(a.saved, { id: "1" });

  const b = {};
  const rb = await refreshAuth(deps({ ok: true, status: 200, json: { user: { id: "2" } } }, b));
  assert.deepEqual(rb.user, { id: "2" });
  assert.deepEqual(b.saved, { id: "2" });
});

test("a rejected refresh signs out; a gateway or network problem does not", async () => {
  const rejected = {};
  const r1 = await refreshAuth(deps({ ok: false, status: 401, json: null }, rejected));
  assert.equal(r1.rejected, true);
  assert.equal(rejected.cleared, true, "the user is cleared");
  assert.equal(rejected.soft, undefined, "a rejection is not a soft failure");

  const kept = {};
  const r2 = await refreshAuth(deps({ ok: false, status: 502, json: null }, kept));
  assert.equal(r2.rejected, false);
  assert.equal(kept.cleared, undefined, "the session survives a 502");
  assert.equal(kept.soft, 502, "the app is told it was a soft failure");

  const offline = {};
  const r3 = await refreshAuth(deps({ ok: false, status: 0, json: null }, offline));
  assert.equal(r3.rejected, false);
  assert.equal(offline.soft, 0);
});

test("a success without a user payload stores nothing but stays signed in", async () => {
  const sink = {};
  const r = await refreshAuth(deps({ ok: true, status: 200, json: {} }, sink));
  assert.deepEqual(r, { ok: true, rejected: false, user: null });
  assert.equal(sink.saved, undefined);
  assert.equal(sink.cleared, undefined);
});

test("userFromRefresh ignores non-object payloads", () => {
  assert.equal(userFromRefresh(null), null);
  assert.equal(userFromRefresh({ data: { user: "yes" } }), null);
  assert.deepEqual(userFromRefresh({ data: { user: { id: "3" } } }), { id: "3" });
});
