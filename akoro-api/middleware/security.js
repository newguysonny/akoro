/**
 * security.js — Centralised security middleware
 *
 * Rate limiters, BOLA guard, Zod validation factory, structured security logger.
 * Import and apply in app.js.
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z }                         from 'zod';
import { createHash }                from 'node:crypto';
import { peekAccessToken }           from '../lib/tokenPeek.js';

// ─── Who is this request? ─────────────────────────────────────────────────────

/**
 * attachRateLimitIdentity — mount ONCE, before any limiter.
 *
 * The limiters were mounted on the app while authenticateToken lives inside
 * each router, so req.user did not exist when the key was computed and every
 * "per user" limiter fell back to per-IP. Behind a proxy that is one shared
 * bucket for the entire platform.
 *
 * This verifies the access token's signature (no database, no deny-list check)
 * purely to answer "whose quota is this?". Verification is the gate: an
 * unsigned or forged token yields null and the request keys by IP as before, so
 * nobody can borrow another user's quota or dodge their own.
 */
export function attachRateLimitIdentity(req, res, next) {
  const claims = peekAccessToken(req);
  if (claims) {
    req.rateLimitId = String(claims.sub);
    // Minted by signInternalAccess() for a background job acting as a user.
    // Only our signing key can produce this claim, so the signature check above
    // is what makes it trustworthy — not the flag itself.
    req.isInternalCall = claims.internal === true;
  }
  next();
}

// ─── Rate-limit key helpers ────────────────────────────────────────────────────

/**
 * ipKey — the IPv6-safe key for an address.
 *
 * express-rate-limit v8's ipKeyGenerator takes an IP STRING; it was being
 * called as ipKeyGenerator(req, res), which returns the request object. Every
 * request therefore produced a different key and no counter ever incremented —
 * so standardLimit, teachingLimit, aiLimit, strictLimit and refreshLimit were
 * all silently inert, including the 5-per-15-minutes guard on login.
 */
const ipKey = (req) => ipKeyGenerator(req.ip ?? req.socket?.remoteAddress ?? "unknown");

/** Prefer authenticated user id over IP; fall back to an IPv6-safe address key. */
function userOrIpKey(req) {
  const id = req.user?.id ?? req.rateLimitId;
  return id ? String(id) : ipKey(req);
}

/**
 * Internal calls get their own bucket, not an exemption.
 *
 * The task worker calls this same API over loopback to create battles and
 * assignments — one cron firing six assignments is a dozen requests from one
 * address, which trips a 10/min AI limit and fails work the teacher scheduled.
 * But "skip entirely" turns a runaway loop into an outage, so they are counted
 * against a ceiling high enough that only a bug reaches it.
 */
const isInternal = (req) => req.isInternalCall === true;

// ─── Tiered rate limiters ──────────────────────────────────────────────────────

/**
 * Ceilings are env-tunable, with today's values as defaults.
 *
 * They were hardcoded, so raising a limit for a school running two hundred
 * learners at once — or lowering one under abuse — meant a code change and a
 * deploy. A number you cannot change while an incident is happening is not
 * really a control.
 */
const lim = (name, fallback) => {
  const v = Number(process.env[`RATE_LIMIT_${name}`]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const BASE = {
  standardHeaders: true,   // X-RateLimit-* headers
  legacyHeaders:   false,
  skipSuccessfulRequests: false,
  // One JSON envelope for every 429. express-rate-limit's default body is
  // plain text ("Too many requests..."), which no frontend error path can
  // parse — and a 429 the client can't identify can't back off intelligently.
  message: { success: false, message: 'Too many requests. Please slow down and try again shortly.', code: 'rate_limited' },
  // Log every limit hit (hardening plan: layer + route + key type). Without
  // this, a 429 storm is invisible in the logs — the client sees rejections,
  // the server sees nothing.
  handler: (req, res, options) => {
    const key = req.user?.id ? `user:${req.user.id}` : req.rateLimitId ? `session:${req.rateLimitId}` : `ip:${req.ip}`;
    console.warn(`[ratelimit] 429 ${req.method} ${req.originalUrl} key=${key} limit=${req.rateLimit?.limit}`);
    res.status(options.statusCode || 429).json(options.message);
  },
};

/** Auth endpoints: login / register — 5 req / 15 min */
export const strictLimit = rateLimit({
  ...BASE,
  windowMs: 15 * 60 * 1000,
  max:      lim('STRICT', 5),
  keyGenerator: ipKey,
  message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
});

/**
 * Token refresh — per SESSION, not per IP.
 *
 * Keying this by IP was wrong in the one place it matters most: a school. Thirty
 * learners on one NAT share one address, each app refreshes every 13 minutes,
 * and 30 per 15 minutes is reached by the class before the first lesson ends.
 * The 429s that followed were then treated as "session gone" by the clients, so
 * a rate limit intended to slow down abuse signed a whole classroom out.
 *
 * The refresh cookie identifies the session — one bucket per signed-in device is
 * exactly the granularity this limiter wants, and it survives NAT. It is hashed
 * so a token never reaches the limiter's key store or any log.
 *
 * What this gives up: someone holding many stolen refresh tokens gets a bucket
 * each. That is an acceptable trade — the endpoint rejects invalid tokens on
 * their own merits, and brute-forcing credentials is strictLimit's job, not
 * this one's. Requests with no cookie at all (the actual spray case) still key
 * by IP and still hit the old ceiling.
 *
 * Note the effect of rotation: a SUCCESSFUL refresh issues a new cookie and so
 * starts a new bucket. That is the behaviour we want — the ceiling then applies
 * to repeated attempts with a cookie that is NOT being accepted, which is the
 * hammering worth stopping, rather than to a device quietly refreshing on time.
 */
const refreshSessionKey = (req) => {
  const jar = req.cookies || {};
  const token = Object.keys(jar).find((k) => k.startsWith('akoro_refresh')) ;
  const value = token ? jar[token] : null;
  if (!value) return `ip:${ipKey(req)}`;
  return `rt:${createHash('sha256').update(value).digest('base64url').slice(0, 32)}`;
};

export const refreshLimit = rateLimit({
  ...BASE,
  windowMs: 15 * 60 * 1000,
  max:      lim('REFRESH', 30),
  keyGenerator: refreshSessionKey,
  message: { success: false, message: 'Too many refresh attempts. Please slow down.' },
});

/** Standard read endpoints — 100 req / min */
export const standardLimit = rateLimit({
  ...BASE,
  skip: isInternal,
  windowMs: 60 * 1000,
  max:      lim('STANDARD', 100),
  keyGenerator: userOrIpKey,
  message: { success: false, message: 'Rate limit exceeded. Please slow down.' },
});

/** Adaptive / teaching endpoints — 50 req / min */
export const teachingLimit = rateLimit({
  ...BASE,
  skip: isInternal,
  windowMs: 60 * 1000,
  max:      lim('TEACHING', 50),
  keyGenerator: userOrIpKey,
  message: { success: false, message: 'Teaching endpoint rate limit exceeded.' },
});

/** Resource-intensive AI operations — 10 req / min */
export const aiLimit = rateLimit({
  ...BASE,
  skip: isInternal,
  windowMs: 60 * 1000,
  max:      lim('AI', 10),
  keyGenerator: userOrIpKey,
  message: { success: false, message: 'AI operation rate limit exceeded. Please wait.' },
});

/**
 * Background work, all callers pooled — 300 req / min.
 *
 * Deliberately one shared bucket rather than per-task: the thing worth
 * catching is the platform's own jobs looping, and that shows up in the total.
 */
export const internalLimit = rateLimit({
  ...BASE,
  windowMs: 60 * 1000,
  max:      lim('INTERNAL', 300),
  keyGenerator: () => 'internal',
  skip: (req) => !isInternal(req),
  message: { success: false, message: 'Internal job rate limit exceeded.' },
});

// ─── BOLA guard ────────────────────────────────────────────────────────────────

/**
 * requireOwnership(getResourceOwnerId)
 *
 * Factory that returns Express middleware.
 * `getResourceOwnerId` is an async fn(req) → string|null that resolves
 * the owner ID of the requested resource.
 *
 * Usage:
 *   router.get('/:id', authenticate, requireOwnership(r => getWidgetOwner(r.params.id)), handler)
 */
export function requireOwnership(getResourceOwnerId) {
  return async (req, res, next) => {
    try {
      const ownerId = await getResourceOwnerId(req);
      if (!ownerId) return res.status(404).json({ success: false, message: 'Resource not found' });
      if (String(ownerId) !== String(req.user?.id)) {
        securityLog('BOLA_ATTEMPT', req, { ownerId, requesterId: req.user?.id });
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// ─── Zod validation factory ────────────────────────────────────────────────────

/**
 * validate(schema, source?)
 *
 * Validates req[source] against a Zod schema.
 * source defaults to 'body'. Supports 'body' | 'params' | 'query'.
 *
 * Usage:
 *   router.post('/thing', validate(z.object({ name: z.string() })), handler)
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        field:   e.path.join('.'),
        message: e.message,
      }));
      return res.status(422).json({ success: false, message: 'Validation failed', errors });
    }
    req[source] = result.data;   // replace with parsed/coerced data
    next();
  };
}

// re-export z so callers can do: import { validate, z } from '../middleware/security.js'
export { z };

// ─── Structured security logger ────────────────────────────────────────────────

const REDACTED = '[REDACTED]';
const SENSITIVE = new Set(['password', 'token', 'secret', 'authorization', 'cookie',
  'access_token', 'refresh_token', 'jti', 'private_key', 'credit_card']);

function scrub(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) =>
      SENSITIVE.has(k.toLowerCase()) ? [k, REDACTED] : [k, scrub(v, depth + 1)]
    )
  );
}

export function securityLog(event, req, extra = {}, { level = 'error' } = {}) {
  const entry = {
    ts:      new Date().toISOString(),
    event,
    // A `message` so log viewers that parse JSON have something to SHOW. Without
    // it Railway rendered every one of these as a blank red row: you had to
    // expand each one individually to learn it was a routine 401.
    message: `${event} ${req?.method ?? ''} ${req?.path ?? ''}`.trim() +
             (extra?.status ? ` -> ${extra.status}` : ''),
    level,
    ip:      req?.ip,
    method:  req?.method,
    path:    req?.path,
    userId:  req?.user?.id ?? null,
    ...scrub(extra),
  };
  // stderr is for things worth someone's attention; routine client-side
  // outcomes go to stdout so they don't read as incidents.
  const line = JSON.stringify(entry) + '\n';
  if (level === 'error') process.stderr.write(line);
  else                   process.stdout.write(line);
}

/**
 * requestLogger — mounts as app-level middleware.
 * Logs completed requests (status, latency) without leaking sensitive fields.
 */
export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const s  = res.statusCode;
    if (s < 400) return;

    // 401 is usually the auth handshake working, not failing: the access token
    // lives 15 minutes, so a screen opened after that 401s once per request
    // before the client refreshes and retries. Logging a wall of those as
    // errors buried the failures that matter. They are still recorded — as
    // AUTH_CHALLENGE on stdout — so a genuine flood is still visible.
    //
    // 403 stays an error: that is a signed-in user reaching for something that
    // is not theirs, which is worth seeing.
    if (s === 401) {
      securityLog('AUTH_CHALLENGE', req, { status: s, ms }, { level: 'info' });
    } else if (s === 404) {
      securityLog('HTTP_NOT_FOUND', req, { status: s, ms }, { level: 'info' });
    } else {
      securityLog('HTTP_ERROR', req, { status: s, ms });
    }
  });
  next();
}
