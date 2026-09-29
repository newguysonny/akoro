/**
 * lib/meetingsBreaker.js — live-class provider calls behind one breaker.
 *
 * Zoom (OAuth token, create/delete meeting) and Google Meet (token refresh,
 * calendar events) provision live classes; the courses scheduler and the
 * meeting integration both call them. They are one family from the user's
 * point of view — "can I start my class?" — so they share one breaker state:
 * when the provider side is down, a teacher gets an immediate honest 503
 * instead of a create-class request hanging past the lesson bell.
 * Visible in /health.breakers as "meetings".
 */
import { makeHttpBreaker } from "./httpBreaker.js";
import { ProviderUnavailableError } from "./circuitBreaker.js";

export class LiveClassUnavailableError extends ProviderUnavailableError {
  constructor(message = "Live class provider temporarily unavailable — please retry shortly.", retryAfterSec = null) {
    super(message, retryAfterSec);
    this.name = "LiveClassUnavailableError";
  }
}

const http = makeHttpBreaker("meetings", LiveClassUnavailableError);

export function meetingsPost(url, body, config = {}) {
  return http.post(url, body, config);
}

export function meetingsGet(url, config = {}) {
  return http.get(url, config);
}

export function meetingsDelete(url, config = {}) {
  return http.delete(url, config);
}

export const meetingsBreaker = http.breaker;
