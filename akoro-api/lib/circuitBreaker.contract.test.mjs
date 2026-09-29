// lib/circuitBreaker.contract.test.mjs
//
// The breaker's contract, in order of importance:
//   1. When the provider errors, it OPENS — and an open breaker answers with
//      AIProviderUnavailableError (503, provider_unavailable, retryAfterSec)
//      WITHOUT calling the provider again.
//   2. After the reset window it half-opens, lets a probe through, and closes
//      on success — punishment ends when the provider recovers.
//   3. A 4xx that is not 429 is OUR bug, not an outage: it must not open the
//      breaker and 503 every other caller.
import test from "node:test";
import assert from "node:assert/strict";
import { makeAiBreaker, makeBreaker, AIProviderUnavailableError, ProviderUnavailableError } from "./circuitBreaker.js";
import { PaystackUnavailableError } from "./paystackBreaker.js";

const fastOpts = {
  timeout: 500,
  errorThresholdPercentage: 50,
  resetTimeout: 150,
  rollingCountTimeout: 1000,
  rollingCountBuckets: 2,
};

test("breaker opens after provider failures and fails fast with a 503 error", async () => {
  let calls = 0;
  const { fire, breaker } = makeAiBreaker("test-open", async () => {
    calls += 1;
    throw Object.assign(new Error("provider 500"), { status: 500 });
  }, fastOpts);

  let sawUnavailable = false;
  for (let i = 0; i < 6; i++) {
    try { await fire(); }
    catch (e) { if (e instanceof AIProviderUnavailableError) sawUnavailable = true; }
  }
  assert.ok(sawUnavailable, "expected an AIProviderUnavailableError once the breaker opened");
  assert.ok(breaker.opened, "breaker must be open after sustained failures");

  const callsAtOpen = calls;
  await assert.rejects(() => fire(), AIProviderUnavailableError);
  assert.equal(calls, callsAtOpen, "an open breaker must not call the provider");

  const err = await fire().catch((e) => e);
  assert.equal(err.statusCode, 503);
  assert.equal(err.code, "provider_unavailable");
  assert.ok(err.retryAfterSec > 0, "must carry a positive retryAfterSec for the Retry-After header");
});

test("breaker half-opens after the reset window and closes on a successful probe", async () => {
  let failing = true;
  const { fire, breaker } = makeAiBreaker("test-probe", async () => {
    if (failing) throw new Error("provider down");
    return "healthy";
  }, fastOpts);

  for (let i = 0; i < 6; i++) { try { await fire(); } catch {} }
  assert.ok(breaker.opened, "precondition: breaker open");

  failing = false;
  await new Promise((r) => setTimeout(r, 250));   // past resetTimeout
  const res = await fire();
  assert.equal(res, "healthy");
  assert.ok(!breaker.opened, "a successful probe must close the breaker");
});

test("4xx other than 429 is our request bug — it must not open the breaker", async () => {
  const { fire, breaker } = makeAiBreaker("test-4xx", async () => {
    throw Object.assign(new Error("bad request"), { status: 400 });
  }, fastOpts);

  for (let i = 0; i < 8; i++) { await assert.rejects(() => fire()); }
  assert.ok(!breaker.opened, "filtered errors must not trip the breaker");
});

test("429 from the provider DOES count toward opening the breaker", async () => {
  const { fire, breaker } = makeAiBreaker("test-429", async () => {
    throw Object.assign(new Error("rate limited"), { status: 429 });
  }, fastOpts);

  for (let i = 0; i < 6; i++) { try { await fire(); } catch {} }
  assert.ok(breaker.opened, "429 is provider pressure and must trip the breaker");
});

test("a custom errorClass flavors the fail-fast error (paystack money path)", async () => {
  const { fire } = makeBreaker("test-paystack", async () => {
    throw Object.assign(new Error("paystack 500"), { response: { status: 500 } });
  }, { ...fastOpts, errorClass: PaystackUnavailableError });

  let err = null;
  for (let i = 0; i < 6; i++) { try { await fire(); } catch (e) { err = e; } }
  assert.ok(err instanceof PaystackUnavailableError, "open breaker must throw the paystack-flavored error");
  assert.ok(err instanceof ProviderUnavailableError, "which is still a provider-unavailable error for the global handler");
  assert.equal(err.statusCode, 503);
  assert.match(err.message, /payment provider/i);
});

test("axios-shaped 4xx (err.response.status) is filtered like SDK 4xx", async () => {
  const { fire, breaker } = makeBreaker("test-axios-4xx", async () => {
    throw Object.assign(new Error("bad request"), { response: { status: 400 } });
  }, fastOpts);

  for (let i = 0; i < 8; i++) { await assert.rejects(() => fire()); }
  assert.ok(!breaker.opened, "axios 4xx is our bug, not an outage — breaker must stay closed");
});
