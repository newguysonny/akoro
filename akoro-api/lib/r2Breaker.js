/**
 * lib/r2Breaker.js — Cloudflare R2 object operations behind one breaker.
 *
 * Presigned URLs are LOCAL SigV4 signing — no network, no breaker needed.
 * The actual network calls are the s3.send(...) operations (uploads,
 * deletes) scattered across records, tasks, certificates, stream and
 * subtitles. They all run through here so one breaker state covers object
 * storage: visible in /health.breakers as "r2", and a degraded store is an
 * immediate honest 503 instead of a hanging upload.
 */
import { makeBreaker, ProviderUnavailableError } from "./circuitBreaker.js";

export class R2UnavailableError extends ProviderUnavailableError {
  constructor(message = "File storage temporarily unavailable — please retry shortly.", retryAfterSec = null) {
    super(message, retryAfterSec);
    this.name = "R2UnavailableError";
  }
}

const breaker = makeBreaker(
  "r2",
  ([client, command]) => client.send(command),
  { errorClass: R2UnavailableError },
);

/** `await s3.send(cmd)` → `await r2Send(s3, cmd)` — same semantics, guarded. */
export function r2Send(client, command) {
  return breaker.fire(client, command);
}

export const r2Breaker = breaker.breaker;
