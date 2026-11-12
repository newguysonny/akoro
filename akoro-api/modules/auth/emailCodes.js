/**
 * modules/auth/emailCodes.js — emailed, hashed, single-use codes for signup,
 * login and password reset.
 *
 * Security properties:
 *  - 6-digit code, stored only as an HMAC (never plaintext).
 *  - 10-minute expiry, 5 attempts, single use.
 *  - 60-second resend cooldown and 5 sends/hour per email+purpose.
 *  - Constant-time compare; unknown/expired/used codes share one message.
 *  - A new code invalidates the previous one.
 *
 * Rollout: `AUTH_EMAIL_CODES` is off by default. It accepts:
 *   off | on | student | student,instructor | …
 * so a portal can be enabled only after its UI handles the code screens.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import db from "../../db.js";
import { sendVerificationCodeEmail } from "./emails.js";

const FLAG = String(process.env.AUTH_EMAIL_CODES || "off").trim().toLowerCase();
const TTL_MIN = Math.max(3, Math.min(30, parseInt(process.env.AUTH_CODE_TTL_MINUTES ?? "10", 10) || 10));
const RESEND_SECONDS = Math.max(30, Math.min(300, parseInt(process.env.AUTH_CODE_RESEND_SECONDS ?? "60", 10) || 60));
const MAX_PER_HOUR = Math.max(2, Math.min(20, parseInt(process.env.AUTH_CODE_MAX_PER_HOUR ?? "5", 10) || 5));
const MAX_ATTEMPTS = 5;
const SECRET = process.env.AUTH_CODE_SECRET || process.env.COOKIE_SECRET || process.env.JWT_PRIVATE_KEY || "akoro-dev-code-secret";

export const CODE_TTL_MINUTES = TTL_MIN;
export const CODE_RESEND_SECONDS = RESEND_SECONDS;

export function emailCodesEnabled(portal) {
  if (!FLAG || ["off", "false", "0"].includes(FLAG)) return false;
  if (["on", "true", "1", "all"].includes(FLAG)) return true;
  return FLAG.split(",").map((s) => s.trim()).includes(String(portal || "student"));
}

export const normaliseEmail = (email) => String(email || "").trim().toLowerCase();

/**
 * Seeded testers/demo learners cannot receive email. Their accounts live on a
 * domain Akoro controls, so the login code is skipped for those addresses ONLY.
 * Real domains are never bypassed; set AUTH_EMAIL_CODES_BYPASS= (empty) to
 * require codes for testers too.
 */
const BYPASS_DOMAINS = String(process.env.AUTH_EMAIL_CODES_BYPASS ?? "demo.akoro.app")
  .split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);

export function emailCodeBypassed(email) {
  const domain = normaliseEmail(email).split("@")[1] || "";
  return BYPASS_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function hashCode(email, purpose, code) {
  return createHmac("sha256", SECRET).update(`${purpose}:${normaliseEmail(email)}:${code}`).digest("hex");
}

function safeEqualHex(a, b) {
  const A = Buffer.from(String(a || ""), "hex");
  const B = Buffer.from(String(b || ""), "hex");
  return A.length === B.length && A.length > 0 && timingSafeEqual(A, B);
}

const table = () => db.from("email_verification_codes");

/**
 * Issue (and email) a code. Returns { ok, challengeId, expiresAt } or
 * { ok:false, code:"cooldown"|"rate_limited"|"send_failed", retryAfter? }.
 */
export async function issueEmailCode({ userId = null, email, purpose, name = "there", ip = null, userAgent = null }) {
  const to = normaliseEmail(email);
  if (!to) return { ok: false, code: "invalid_email" };

  const { data: latest } = await table().select("id, created_at, consumed_at, expires_at")
    .eq("email", to).eq("purpose", purpose)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (latest?.created_at) {
    const age = Date.now() - new Date(latest.created_at).getTime();
    // Cooldown only protects a code that can still be typed in. If the previous
    // code was already used or has expired, holding the user to the cooldown
    // (and handing back its now-dead challenge id) strands them — issue fresh.
    const stillUsable = !latest.consumed_at && new Date(latest.expires_at).getTime() > Date.now();
    if (stillUsable && age < RESEND_SECONDS * 1000) {
      // Keep the previously emailed code usable; hand its challenge id back so
      // the client can still show the code screen.
      return { ok: false, code: "cooldown", retryAfter: Math.ceil((RESEND_SECONDS * 1000 - age) / 1000), challengeId: latest.id };
    }
  }
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await table().select("id", { count: "exact", head: true })
    .eq("email", to).eq("purpose", purpose).gte("created_at", hourAgo);
  if ((count || 0) >= MAX_PER_HOUR) return { ok: false, code: "rate_limited" };

  // A new code supersedes any older live one for this email+purpose.
  await table().update({ consumed_at: new Date().toISOString() })
    .eq("email", to).eq("purpose", purpose).is("consumed_at", null);

  const code = String(randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + TTL_MIN * 60 * 1000).toISOString();
  const { data: row, error } = await table().insert({
    user_id: userId, email: to, purpose,
    code_hash: hashCode(to, purpose, code),
    expires_at: expiresAt, max_attempts: MAX_ATTEMPTS,
    ip: ip ? String(ip).slice(0, 80) : null,
    user_agent: userAgent ? String(userAgent).slice(0, 200) : null,
  }).select("id, expires_at").single();
  if (error) throw error;

  try {
    await sendVerificationCodeEmail({ to, code, purpose, expiresMinutes: TTL_MIN, name });
  } catch (e) {
    // Remove the unusable code so the learner can retry without waiting out
    // the resend cooldown; surface the failure to the caller.
    try { await table().delete().eq("id", row.id); } catch { /* best effort */ }
    console.error("[auth:email-code] send failed:", e?.message || e);
    return { ok: false, code: "send_failed" };
  }
  return { ok: true, challengeId: row.id, expiresAt: row.expires_at };
}

/**
 * Verify a code by challenge id (signup/login) or by email (reset, where the
 * forgot response must not reveal whether an account exists).
 * `consume:false` leaves it usable for the caller to consume after a write.
 */
export async function verifyEmailCode({ challengeId = null, email = null, code, purpose, consume = true }) {
  const raw = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(raw)) return { ok: false, code: "invalid_code" };

  let query = table().select("*");
  if (challengeId) query = query.eq("id", challengeId).eq("purpose", purpose);
  else if (email) query = query.eq("email", normaliseEmail(email)).eq("purpose", purpose);
  else return { ok: false, code: "invalid_code" };

  const { data: row } = await query
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();

  if (!row) return { ok: false, code: "invalid_code" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, code: "expired" };
  if (Number(row.attempts) >= Number(row.max_attempts || MAX_ATTEMPTS)) return { ok: false, code: "too_many_attempts" };

  if (!safeEqualHex(hashCode(row.email, row.purpose, raw), row.code_hash)) {
    await table().update({ attempts: Number(row.attempts || 0) + 1 }).eq("id", row.id);
    return { ok: false, code: "invalid_code" };
  }

  if (consume) await table().update({ consumed_at: new Date().toISOString() }).eq("id", row.id);
  return { ok: true, row };
}

export async function consumeEmailCode(challengeId) {
  if (!challengeId) return;
  await table().update({ consumed_at: new Date().toISOString() }).eq("id", challengeId);
}

/** Issue a fresh code for an existing challenge (same email/purpose/user). */
export async function resendEmailCode({ challengeId = null, email = null, purpose = null, ip = null, userAgent = null }) {
  // Prefer the challenge row — it carries the email, purpose and user. A
  // consumed/expired row is still a valid anchor: the user proved they hold a
  // live challenge, and a fresh single-use code for that same address is safe.
  let row = null;
  if (challengeId) {
    const { data } = await table().select("*").eq("id", challengeId).maybeSingle();
    row = data || null;
  }
  // The screen can outlive its row (page restored from cache, refresh, back
  // button) — fall back to the email the client still holds instead of
  // dead-ending on "sign in again".
  if (!row && email) {
    let q = table().select("*").eq("email", normaliseEmail(email));
    if (purpose) q = q.eq("purpose", purpose);
    const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
    row = data || null;
  }
  if (!row) return { ok: false, code: "invalid_code" };
  return issueEmailCode({
    userId: row.user_id, email: row.email, purpose: row.purpose,
    name: "there", ip, userAgent,
  });
}
