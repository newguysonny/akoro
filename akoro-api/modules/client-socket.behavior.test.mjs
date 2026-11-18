// The shared socket setup (Grand Plan Phase 19 step 5): the options object the
// console apps hand to socket.io-client. Behaviour only — the copies in each
// app are covered by client-core.contract.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { socketOptions } from "../../design-system/client/socket.ts";

test("the socket always carries the session cookie and names its portal", () => {
  const options = socketOptions({ portal: "admin" });
  assert.equal(options.withCredentials, true, "HttpOnly session cookie is sent");
  assert.deepEqual(options.auth, { portal: "admin" });
  assert.equal(socketOptions({ portal: "instructor" }).auth.portal, "instructor");
});

test("transports default to websocket then polling", () => {
  assert.deepEqual(socketOptions({ portal: "school" }).transports, ["websocket", "polling"]);
});

test("custom transports are passed through as given", () => {
  const transports = ["polling"];
  const options = socketOptions({ portal: "student", transports });
  assert.deepEqual(options.transports, ["polling"]);
  assert.notEqual(options.transports, transports, "the caller's array is not aliased");
});

test("reconnectionDelayMax appears only when provided", () => {
  assert.equal("reconnectionDelayMax" in socketOptions({ portal: "admin" }), false);
  assert.equal(socketOptions({ portal: "instructor", reconnectionDelayMax: 30000 }).reconnectionDelayMax, 30000);
});

test("the returned object has exactly the keys socket.io-client expects", () => {
  assert.deepEqual(Object.keys(socketOptions({ portal: "admin" })).sort(), [
    "auth",
    "transports",
    "withCredentials",
  ]);
  assert.deepEqual(Object.keys(socketOptions({ portal: "instructor", reconnectionDelayMax: 30000 })).sort(), [
    "auth",
    "reconnectionDelayMax",
    "transports",
    "withCredentials",
  ]);
});
