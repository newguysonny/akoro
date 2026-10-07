/**
 * modules/auth/totp.js
 * RFC 6238 TOTP (Time-based One-Time Password) — zero external dependencies.
 * Compatible with Google Authenticator, Authy, 1Password, etc.
 */

import crypto from "crypto";

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS       = 6;

/** Generate a random base32 secret (default 20 bytes → 32 base32 chars). */
export function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

/** Build an otpauth:// URI for QR codes. */
export function otpauthURL(secret, accountName, issuer = "Akoro") {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits:    String(DIGITS),
    period:    String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Compute the TOTP code for a given secret + counter. */
function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac   = crypto.createHmac("sha1", secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset]     & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8)  |
    (hmac[offset + 3]  & 0xff);
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Verify a user-supplied token against the secret.
 * `window` = number of ±30s steps to tolerate clock drift (default 1).
 */
export function verifyTOTP(secret, token, window = 1) {
  if (!secret || !token) return false;
  const clean = String(token).replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const secretBuf = base32Decode(secret);
  const counter   = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (let i = -window; i <= window; i++) {
    if (timingSafeEq(hotp(secretBuf, counter + i), clean)) return true;
  }
  return false;
}

function timingSafeEq(a, b) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/* ── base32 (RFC 4648, no padding) ─────────────────────────────────────── */
function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = str.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
