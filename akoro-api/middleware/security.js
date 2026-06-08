/**
 * security.js — Centralised security middleware
 *
 * Rate limiters, BOLA guard, Zod validation factory, structured security logger.
 * Import and apply in app.js.
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z }                         from 'zod';

// ─── Rate-limit key helpers ────────────────────────────────────────────────────

/** Prefer authenticated user id over IP; use ipKeyGenerator for IPv6 safety */
function userOrIpKey(req, res) {
  return req.user?.id ? String(req.user.id) : ipKeyGenerator(req, res);
}

// ─── Tiered rate limiters ──────────────────────────────────────────────────────

const BASE = {
  standardHeaders: true,   // X-RateLimit-* headers
  legacyHeaders:   false,
  skipSuccessfulRequests: false,
};

/** Auth endpoints: login / register — 5 req / 15 min */
export const strictLimit = rateLimit({
  ...BASE,
  windowMs: 15 * 60 * 1000,
  max:      5,
  keyGenerator: ipKeyGenerator,
  message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
});

/** Token refresh — 30 req / 15 min */
export const refreshLimit = rateLimit({
  ...BASE,
  windowMs: 15 * 60 * 1000,
  max:      30,
  keyGenerator: ipKeyGenerator,
  message: { success: false, message: 'Too many refresh attempts. Please slow down.' },
});

/** Standard read endpoints — 100 req / min */
export const standardLimit = rateLimit({
  ...BASE,
  windowMs: 60 * 1000,
  max:      100,
  keyGenerator: userOrIpKey,
  message: { success: false, message: 'Rate limit exceeded. Please slow down.' },
});

/** Adaptive / teaching endpoints — 50 req / min */
export const teachingLimit = rateLimit({
  ...BASE,
  windowMs: 60 * 1000,
  max:      50,
  keyGenerator: userOrIpKey,
  message: { success: false, message: 'Teaching endpoint rate limit exceeded.' },
});

/** Resource-intensive AI operations — 10 req / min */
export const aiLimit = rateLimit({
  ...BASE,
  windowMs: 60 * 1000,
  max:      10,
  keyGenerator: userOrIpKey,
  message: { success: false, message: 'AI operation rate limit exceeded. Please wait.' },
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

export function securityLog(event, req, extra = {}) {
  const entry = {
    ts:      new Date().toISOString(),
    event,
    ip:      req?.ip,
    method:  req?.method,
    path:    req?.path,
    userId:  req?.user?.id ?? null,
    ...scrub(extra),
  };
  // Only log to stderr so it doesn't mix with access logs
  process.stderr.write(JSON.stringify(entry) + '\n');
}

/**
 * requestLogger — mounts as app-level middleware.
 * Logs completed requests (status, latency) without leaking sensitive fields.
 */
export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (res.statusCode >= 400) {
      securityLog('HTTP_ERROR', req, { status: res.statusCode, ms });
    }
  });
  next();
}
