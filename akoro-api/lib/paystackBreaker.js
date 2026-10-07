/**
 * lib/paystackBreaker.js — every outbound Paystack call, behind one breaker.
 *
 * Paystack is the money path: checkout initialize, bank resolution, transfer
 * recipients, transfers. When it degrades, a hanging provider call stalls a
 * learner mid-checkout — the breaker turns that into an immediate, honest 503
 * (code provider_unavailable) so the client can say "try again in a moment"
 * instead of watching a spinner die.
 *
 * The whole courses module talks to Paystack through axios; the marketplace
 * service through fetch. Both funnel through here so ONE breaker state covers
 * all of it (also visible in /health.breakers as "paystack").
 */
import { makeHttpBreaker } from "./httpBreaker.js";
import { ProviderUnavailableError } from "./circuitBreaker.js";

export class PaystackUnavailableError extends ProviderUnavailableError {
  constructor(message = "Payment provider temporarily unavailable — please retry shortly.", retryAfterSec = null) {
    super(message, retryAfterSec);
    this.name = "PaystackUnavailableError";
  }
}

const http = makeHttpBreaker("paystack", PaystackUnavailableError);

/** POST — returns the full axios response so `const { data } = …` call sites
 *  keep working unchanged. */
export function paystackPost(url, body, config = {}) {
  return http.post(url, body, config);
}

/** GET — same contract. */
export function paystackGet(url, config = {}) {
  return http.get(url, config);
}

/** Run an arbitrary request thunk under the same breaker state. */
export function paystackThrough(fn) {
  return http.through(fn);
}

export const paystackBreaker = http.breaker;
