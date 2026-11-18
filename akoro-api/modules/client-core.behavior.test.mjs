// Behaviour of the shared client core (Phase 19 step 5), with fetch mocked.
// The contract test keeps the copies in step; this one pins the session rules
// the four apps relied on before the move: bearer override on the FIRST
// attempt, one refresh across a parallel herd, the app-supplied refresh path,
// the 401 replay, and the one error shape.
import assert from "node:assert/strict";
import test from "node:test";
import { createApiCore } from "../../design-system/client/apiCore.ts";

function stubStorage() {
  const m = new Map();
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
  return m;
}

function stubNavigator() {
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
}

const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const coreFor = (overrides = {}) => createApiCore({
  apiBase: "https://api.test",
  portalId: "school",
  ...overrides,
});

test("authorize is applied to the first attempt, not only the replay", async () => {
  stubStorage(); stubNavigator();
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return jsonRes({ ok: true });
  };

  const core = coreFor({
    authorize: (init) => ({ ...init, credentials: "omit", headers: { ...init.headers, Authorization: "Bearer t" } }),
  });
  await core.apiGet("/api/thing");

  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.credentials, "omit", "the tenant request never sends cookies");
  assert.equal(seen[0].init.headers.Authorization, "Bearer t", "the bearer token is on the first request");
  assert.equal(seen[0].init.headers["X-Akoro-Portal"], "school");
});

test("a herd of 401s shares ONE refresh and every call replays", async () => {
  stubStorage(); stubNavigator();
  const calls = { refresh: 0, resource: 0 };
  let refreshed = false;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/api/auth/refresh")) { calls.refresh++; refreshed = true; return jsonRes({ accessExpiresAt: Date.now() + 900000 }); }
    calls.resource++;
    return refreshed ? jsonRes({ ok: true }) : jsonRes({ message: "expired" }, 401);
  };

  const core = coreFor();
  const out = await Promise.all([core.apiGet("/api/a"), core.apiGet("/api/b"), core.apiGet("/api/c")]);

  assert.equal(calls.refresh, 1, "one refresh for the whole batch");
  assert.deepEqual(out, [{ ok: true }, { ok: true }, { ok: true }], "every call replays after the refresh");
});

test("an app-supplied refresh replaces the cookie one (tenant bearer)", async () => {
  stubStorage(); stubNavigator();
  let cookieRefreshes = 0;
  let customRefreshes = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/api/auth/refresh")) { cookieRefreshes++; return jsonRes({}); }
    return jsonRes({ ok: true }, 401);
  };

  const core = coreFor({
    refresh: async () => { customRefreshes++; return { ok: true, status: 200, json: { accessToken: "new" } }; },
  });
  await core.apiGet("/api/x").catch(() => {});
  assert.equal(customRefreshes, 1, "the app's refresh ran");
  assert.equal(cookieRefreshes, 0, "the cookie refresh never ran");
});

test("only the expiry is stored, and the server's error message is what the user sees", async () => {
  const store = stubStorage(); stubNavigator();
  globalThis.fetch = async () => jsonRes({ accessExpiresAt: 1790000000000 }, 200);
  const core = coreFor();
  await core.apiGet("/api/x");
  assert.equal(store.size, 0, "a plain response stores nothing");

  core.rememberExpiry({ accessExpiresAt: 1790000000000 });
  assert.deepEqual([...store.keys()], ["akoro_access_exp"], "no token in storage");

  globalThis.fetch = async () => jsonRes({ error: "Opponent has no agent yet" }, 409);
  const err = await core.apiGet("/api/battle").catch((e) => e);
  assert.equal(err.message, "Opponent has no agent yet");
  assert.equal(err.status, 409);
  assert.equal(err.path, "/api/battle");
  assert.equal(err.method, "GET");
  assert.equal(err.detail, "GET /api/battle -> 409");
});

test("a hung refresh is abandoned at its deadline and never pins the herd", async () => {
  stubStorage(); stubNavigator();
  globalThis.fetch = (url, init) => new Promise((_, reject) => {
    if (String(url).endsWith("/api/auth/refresh")) {
      init.signal?.addEventListener("abort", () => {
        const e = new Error("aborted"); e.name = "AbortError"; reject(e);
      });
    }
  });

  const core = coreFor({ refreshTimeoutMs: 15 });
  const r = await core.refreshSession();
  assert.equal(r.ok, false);
  assert.equal(r.status, 0, "a timeout is not a rejection");
});

test("endSession clears the expiry and calls the app's handler", async () => {
  const store = stubStorage(); stubNavigator();
  coreFor().rememberExpiry({ accessExpiresAt: 1790000000000 });
  assert.equal(store.size, 1);

  let called = 0;
  const core = coreFor({ onSessionEnd: () => { called++; } });
  core.rememberExpiry({ accessExpiresAt: 1790000000000 });
  core.endSession();
  assert.equal(called, 1, "the app's sign-out handler ran");
  assert.equal(store.has("akoro_access_exp"), false, "the expiry is gone");
});
