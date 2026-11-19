/**
 * Phase 15 item 4 (audit F16, F7): shared-secret checks fail closed and compare
 * in constant time. An unset secret used to match an absent header
 * (`req.headers["x-internal-secret"] !== process.env.INTERNAL_SECRET` is
 * `undefined !== undefined` → false → let in), and a Paystack HMAC keyed with
 * "" is computable by anyone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import { safeCompare, envSecret, matchesEnvSecret, hmacHexMatches, paystackSignatureValid, requireSharedSecret } from "./safeCompare.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("safeCompare: equal non-empty strings only", () => {
  assert.equal(safeCompare("abc", "abc"), true);
  for (const [a, b] of [["abc", "abd"], ["abc", "abcd"], ["", ""], [undefined, undefined], [null, null], ["abc", undefined], [undefined, "abc"], [["abc"], "abc"], ["é", "e"]]) {
    assert.equal(safeCompare(a, b), false, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
});

test("an unset or blank env secret matches nothing — not even an absent header", () => {
  const saved = process.env.SC_TEST_SECRET;
  try {
    delete process.env.SC_TEST_SECRET;
    assert.equal(envSecret("SC_TEST_SECRET"), null);
    for (const given of [undefined, "", "anything"]) assert.equal(matchesEnvSecret(given, "SC_TEST_SECRET"), false);
    process.env.SC_TEST_SECRET = "   ";
    assert.equal(matchesEnvSecret("", "SC_TEST_SECRET"), false);
    assert.equal(matchesEnvSecret("   ", "SC_TEST_SECRET"), false);
    process.env.SC_TEST_SECRET = "s3cret";
    assert.equal(matchesEnvSecret("s3cret", "SC_TEST_SECRET"), true);
    assert.equal(matchesEnvSecret("s3cre", "SC_TEST_SECRET"), false);
    assert.equal(matchesEnvSecret(undefined, "SC_TEST_SECRET"), false);
  } finally {
    if (saved === undefined) delete process.env.SC_TEST_SECRET; else process.env.SC_TEST_SECRET = saved;
  }
});

test("HMAC signatures: right key and body pass; empty key, missing or wrong signature fail", () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "r1" } });
  const sig = crypto.createHmac("sha512", "sk_test_x").update(body).digest("hex");
  assert.equal(hmacHexMatches({ secret: "sk_test_x", payload: body, signature: sig }), true);
  assert.equal(hmacHexMatches({ secret: "sk_test_x", payload: body, signature: sig.toUpperCase() }), true, "hex case doesn't matter");
  assert.equal(hmacHexMatches({ secret: "sk_test_x", payload: body + " ", signature: sig }), false);
  assert.equal(hmacHexMatches({ secret: "sk_test_x", payload: body, signature: sig.slice(0, -2) }), false, "length mismatch refused");
  assert.equal(hmacHexMatches({ secret: "sk_test_x", payload: body, signature: undefined }), false);
  const emptyKeySig = crypto.createHmac("sha512", "").update(body).digest("hex");
  assert.equal(hmacHexMatches({ secret: "", payload: body, signature: emptyKeySig }), false, "an empty key is never accepted");
  assert.equal(hmacHexMatches({ secret: undefined, payload: body, signature: emptyKeySig }), false);
  const buf = Buffer.from(body);
  assert.equal(hmacHexMatches({ secret: "sk_test_x", payload: buf, signature: sig }), true, "raw Buffer bodies work");
});

test("paystackSignatureValid refuses when PAYSTACK_SECRET_KEY is unset", () => {
  const saved = process.env.PAYSTACK_SECRET_KEY;
  try {
    const body = "{}";
    delete process.env.PAYSTACK_SECRET_KEY;
    assert.equal(paystackSignatureValid(body, crypto.createHmac("sha512", "").update(body).digest("hex")), false);
    process.env.PAYSTACK_SECRET_KEY = "sk_test_y";
    assert.equal(paystackSignatureValid(body, crypto.createHmac("sha512", "sk_test_y").update(body).digest("hex")), true);
  } finally {
    if (saved === undefined) delete process.env.PAYSTACK_SECRET_KEY; else process.env.PAYSTACK_SECRET_KEY = saved;
  }
});

test("requireSharedSecret over HTTP: unset → 503, missing/wrong → 403, right → through", async () => {
  const saved = process.env.SC_HTTP_SECRET;
  const app = express();
  app.get("/x", requireSharedSecret("SC_HTTP_SECRET"), (_req, res) => res.json({ ok: true }));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/x`;
  try {
    delete process.env.SC_HTTP_SECRET;
    assert.equal((await fetch(base)).status, 503, "unset secret: nobody in");
    assert.equal((await fetch(base, { headers: { "x-internal-secret": "" } })).status, 503);
    process.env.SC_HTTP_SECRET = "hush";
    assert.equal((await fetch(base)).status, 403);
    assert.equal((await fetch(base, { headers: { "x-internal-secret": "nope" } })).status, 403);
    assert.equal((await fetch(base, { headers: { "x-internal-secret": "hush" } })).status, 200);
  } finally {
    server.close();
    if (saved === undefined) delete process.env.SC_HTTP_SECRET; else process.env.SC_HTTP_SECRET = saved;
  }
});

test("every shared-secret and signature check in the API goes through the helper", () => {
  const stream = read("../modules/courses/stream.js");
  assert.doesNotMatch(stream, /x-internal-secret"\] !== process\.env\.INTERNAL_SECRET/);
  assert.equal((stream.match(/internalGuard\(req, res\)/g) || []).length, 2, "source-url and update are both guarded");

  const ticks = read("../modules/admin/ticks.js");
  assert.match(ticks, /requireSharedSecret\("INTERNAL_SECRET"/);

  const app = read("../app.js");
  assert.doesNotMatch(app, /config\.isDev;?\s*(\/\/.*)?\n\s*if \(!authorized\)/, "no dev-mode open door on /internal/*");
  assert.equal((app.match(/app\.get\("\/internal\/(egress|preflight)", requireSharedSecret\("INTERNAL_SECRET"\)/g) || []).length, 2);

  for (const f of ["../modules/courses/payments.js", "../modules/courses/payouts.js", "../modules/webhooks/paystack.js", "./paystackService.js"]) {
    const s = read(f);
    assert.match(s, /paystackSignatureValid\(/, `${f} uses the shared Paystack check`);
    assert.doesNotMatch(s, /hash !== req\.headers|hash === req\.headers|return hash === signature/, `${f} has no plain compare`);
  }
  for (const f of ["../modules/records/parseConsole.js", "../modules/agentConsole/routes.js", "../modules/hfmirror/routes.js", "../modules/pharmd/routes.js", "../modules/verify/policy.js"]) {
    const s = read(f);
    assert.match(s, /safeCompare\(got, want\)/, `${f} compares its key in constant time`);
    assert.doesNotMatch(s, /got !== want/, f);
  }
  const chat = read("../modules/adaptive-learning/chat.js");
  assert.match(chat, /safeCompare\(req\.get\("x-agent-console-dry"\), key\)/);
  assert.match(chat, /safeCompare\(req\.get\("x-agent-console-inspect"\), key\)/);
  assert.match(read("../modules/agent-tools/capability.js"), /import \{ safeCompare \} from "\.\.\/\.\.\/lib\/safeCompare\.js"/);
});
