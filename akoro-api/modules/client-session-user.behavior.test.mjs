// Behaviour of the shared session-user store (Phase 19 step 5). The contract
// test keeps the app copies byte-identical; this one pins the rules each app
// has to survive: a bad key, malformed JSON, and a storage that throws.
import assert from "node:assert/strict";
import test from "node:test";
import { createSessionUser } from "../../design-system/client/sessionUser.ts";

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

function throwingStorage() {
  globalThis.localStorage = {
    getItem: () => { throw new Error("storage blocked"); },
    setItem: () => { throw new Error("storage blocked"); },
    removeItem: () => { throw new Error("storage blocked"); },
    clear: () => { throw new Error("storage blocked"); },
    key: () => { throw new Error("storage blocked"); },
    get length() { throw new Error("storage blocked"); },
  };
}

test("save then read round-trips the user", () => {
  stubStorage();
  const store = createSessionUser();
  const user = { id: "u1", name: "Ada", role: "admin", onboardingCompleted: false };
  assert.deepEqual(store.save(user), user, "save returns the user it stored");
  assert.deepEqual(store.read(), user);
});

test("the default key is akoro_user", () => {
  const map = stubStorage();
  const store = createSessionUser();
  store.save({ id: "u1" });
  assert.deepEqual([...map.keys()], ["akoro_user"]);
  assert.deepEqual(JSON.parse(map.get("akoro_user")), { id: "u1" });
});

test("a custom user key is honoured", () => {
  const map = stubStorage();
  const store = createSessionUser({ userKey: "akoro_school_user" });
  store.save({ id: "u2" });
  assert.deepEqual([...map.keys()], ["akoro_school_user"]);
  assert.deepEqual(store.read(), { id: "u2" });
});

test("read returns null when the key is missing", () => {
  stubStorage();
  assert.equal(createSessionUser().read(), null);
});

test("read returns null on malformed JSON", () => {
  const map = stubStorage();
  map.set("akoro_user", "{not json");
  assert.equal(createSessionUser().read(), null);
});

test("read returns null when storage throws (private mode, blocked)", () => {
  throwingStorage();
  assert.equal(createSessionUser().read(), null);
});

test("save and clear do not throw when storage throws", () => {
  throwingStorage();
  const store = createSessionUser();
  const user = { id: "u1" };
  assert.doesNotThrow(() => store.save(user));
  assert.deepEqual(store.save(user), user, "save still hands the user back");
  assert.doesNotThrow(() => store.clear());
});

test("clear removes only this store's key", () => {
  const map = stubStorage();
  map.set("akoro_redirect", "/admin");
  const store = createSessionUser();
  store.save({ id: "u1" });
  store.clear();
  assert.equal(map.has("akoro_user"), false, "the user key is gone");
  assert.equal(map.get("akoro_redirect"), "/admin", "unrelated keys survive");
});
