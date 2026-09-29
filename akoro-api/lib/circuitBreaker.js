/**
 * lib/circuitBreaker.js — opossum breakers for external providers.
 *
 * Why: when OpenAI (or any external dependency) degrades, every chat surface
 * hangs on its SDK timeout one request at a time — the cascading-failure shape
 * of the Sept 2026 outage. A breaker flips to failing FAST after enough
 * errors, lets the client see an honest 503 + Retry-After immediately, and
 * probes for recovery instead of keeping the punishment going.
 *
 * All AI calls route through here via lib/aiModel.js, so one integration
 * covers chat, streaming chat, embeddings, voice, tasks and training.
 *
 * Env (all optional):
 *   BREAKER_TIMEOUT_MS        backstop per-call timeout   (default 60000)
 *   BREAKER_ERROR_PCT         open above this error rate  (default 50)
 *   BREAKER_RESET_MS          half-open probe after       (default 30000)
 */
import CircuitBreaker from "opossum";

const num = (key, fallback) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/** Typed error for "we are failing fast on purpose". Maps to 503 + Retry-After
 *  in app.js's global handler — never a 500, because nothing is broken: the
 *  provider is, and the client should retry, not report a bug. */
export class AIProviderUnavailableError extends Error {
  constructor(message = "AI provider temporarily unavailable — please retry shortly.", retryAfterSec = null) {
    super(message);
    this.name = "AIProviderUnavailableError";
    this.statusCode = 503;
    this.code = "provider_unavailable";
    this.expose = true;
    this.retryAfterSec = retryAfterSec;
  }
}

const breakerRegistry = new Map();

/** Observable state for /health and the observability stack. */
export function breakerStats() {
  return [...breakerRegistry.entries()].map(([name, b]) => ({
    name,
    state: b.opened ? "open" : b.halfOpen ? "half-open" : "closed",
    fires: b.stats.fires,
    failures: b.stats.failures,
    rejects: b.stats.rejects,
  }));
}

/**
 * Wrap an external call. `fn` receives the fire() arguments verbatim.
 * `overrides` exists so tests can use millisecond windows — production should
 * never pass it.
 */
export function makeAiBreaker(name, fn, overrides = {}) {
  const breaker = new CircuitBreaker(fn, {
    // Backstop only — most calls carry their own __timeoutMs at the SDK level,
    // and streamed chat only waits here for response HEADERS, not the stream.
    timeout:                 num("BREAKER_TIMEOUT_MS", 60_000),
    errorThresholdPercentage: num("BREAKER_ERROR_PCT", 50),
    resetTimeout:            num("BREAKER_RESET_MS", 30_000),
    rollingCountTimeout:     60_000,
    rollingCountBuckets:     6,
    // A 4xx that is NOT 429 is OUR request bug (bad prompt, bad key shape) —
    // the provider is fine, so it must not open the breaker and 503 every
    // other caller. 429 and 5xx/timeouts are provider trouble and count.
    errorFilter: (err) => {
      const status = err?.status;
      return Boolean(status && status >= 400 && status < 500 && status !== 429);
    },
    ...overrides,
  });

  // State changes are the events an operator needs in the logs — the observ-
  // ability plan's "closed → open → half-open" line items.
  breaker.on("open",     () => console.warn(`[breaker:${name}] OPEN — failing fast for ~${Math.round(breaker.options.resetTimeout / 1000)}s`));
  breaker.on("halfOpen", () => console.log(`[breaker:${name}] half-open — letting a probe through`));
  breaker.on("close",    () => console.log(`[breaker:${name}] closed — provider healthy again`));

  breakerRegistry.set(name, breaker);

  const retryAfterSec = Math.max(1, Math.ceil(breaker.options.resetTimeout / 1000));
  return {
    breaker,
    async fire(...args) {
      try {
        return await breaker.fire(...args);
      } catch (e) {
        if (breaker.opened) {
          // The rejection IS the design: one honest 503 instead of a queue of
          // requests each burning a full SDK timeout against a dead provider.
          throw new AIProviderUnavailableError(undefined, retryAfterSec);
        }
        throw e;
      }
    },
  };
}
