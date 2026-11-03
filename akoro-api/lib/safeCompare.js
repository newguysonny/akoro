/**
 * lib/safeCompare.js — shared-secret and signature checks that fail closed.
 *
 * Every guard that compares a caller-supplied value against a secret from the
 * environment goes through here, so that:
 *   - an unset (or blank) secret never matches anything — not even an absent
 *     header, which is what `header !== process.env.X` lets through;
 *   - the compare is constant-time (crypto.timingSafeEqual on equal-length
 *     buffers; a length mismatch is refused without comparing).
 */
import crypto from "node:crypto";

/** true only when both are non-empty strings and byte-for-byte equal (constant-time). */
export function safeCompare(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string" || !given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The env secret's value when it is set (trimmed), else null — the caller must then refuse. */
export function envSecret(name) {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Does `given` match the secret in env var `name`? false when the secret is unset. */
export function matchesEnvSecret(given, name) {
  const want = envSecret(name);
  return !!want && safeCompare(typeof given === "string" ? given.trim() : given, want);
}

/**
 * Express guard for a service-to-service route: header `header` must equal env
 * secret `envName`. Unset secret → 503 (the route is off, not open); missing or
 * wrong header → 403.
 */
export function requireSharedSecret(envName, header = "x-internal-secret") {
  return (req, res, next) => {
    if (!envSecret(envName)) return res.status(503).json({ success: false, message: `${envName} is not set — this endpoint is disabled.` });
    if (!matchesEnvSecret(req.headers?.[header], envName)) return res.status(403).json({ success: false, message: "Forbidden" });
    next();
  };
}

/**
 * Verify a hex HMAC signature (e.g. Paystack's x-paystack-signature: HMAC-SHA512
 * of the raw body with the secret key). false when the secret or signature is
 * missing — an empty key would make the signature computable by anyone.
 */
export function hmacHexMatches({ algorithm = "sha512", secret, payload, signature }) {
  if (typeof secret !== "string" || !secret.trim() || typeof signature !== "string" || !signature) return false;
  const digest = crypto.createHmac(algorithm, secret).update(payload ?? "").digest("hex");
  return safeCompare(signature.trim().toLowerCase(), digest);
}

/** Paystack webhook signature check against PAYSTACK_SECRET_KEY. */
export function paystackSignatureValid(payload, signature) {
  return hmacHexMatches({ algorithm: "sha512", secret: envSecret("PAYSTACK_SECRET_KEY"), payload, signature });
}
