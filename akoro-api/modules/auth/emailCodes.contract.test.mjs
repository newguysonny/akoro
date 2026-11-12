import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("codes are hashed, single-use, rate-limited and emailed", () => {
  const codes = read("./emailCodes.js");
  const routes = read("./routes.js");
  const emails = read("./emails.js");
  const sql = read("../../migrations/2026-email-verification-codes.sql");
  const manifest = JSON.parse(read("../../migrations/manifest.json"));

  assert.match(sql, /create table if not exists public\.email_verification_codes/);
  assert.match(sql, /update public\.users[\s\S]{0,120}set email_verified = true/, "existing accounts are grandfathered");
  assert.ok(manifest.schema.includes("2026-email-verification-codes.sql"));

  assert.match(codes, /createHmac\("sha256"/, "codes are stored as an HMAC");
  assert.match(codes, /timingSafeEqual/, "constant-time compare");
  assert.match(codes, /RESEND_SECONDS/, "resend cooldown");
  assert.match(codes, /MAX_PER_HOUR/, "hourly send cap");
  assert.match(codes, /max_attempts/, "attempt cap");
  assert.match(codes, /consumed_at/, "single use");

  assert.match(emails, /sendViaResend/, "Resend is the primary transport");
  assert.match(emails, /resend\.emails\.send/);
  assert.match(emails, /sendViaSendGrid/, "SendGrid is the fallback transport");
  assert.match(emails, /api\.sendgrid\.com\/v3\/mail\/send/);
  assert.match(emails, /No email transport is configured/, "missing keys fail clearly");
  assert.match(emails, /renderVerificationCodeEmail/);

  assert.match(routes, /router\.post\("\/verify-email"/);
  assert.match(routes, /router\.post\("\/verify-login"/);
  assert.match(routes, /router\.post\("\/resend-code"/);
  // Resend must survive a challenge that is already consumed/expired (page
  // restored from cache, refresh, back button): recover by email and re-issue.
  assert.match(routes, /resend-code[\s\S]{0,220}body\("email"\)/, "resend accepts the email fallback");
  assert.match(codes, /if \(!row && email\)/, "resend recovers the challenge by email");
  assert.doesNotMatch(codes, /!row \|\| row\.consumed_at/, "a consumed challenge no longer dead-ends the user");
  assert.match(codes, /stillUsable/, "cooldown only guards a still-usable code");
  assert.match(codes, /CODE_RESEND_SECONDS/, "the resend window is exported");
  assert.match(routes, /resendSeconds: CODE_RESEND_SECONDS/, "the client learns the resend window");
  assert.match(routes, /body\("purpose"\)\.optional\(\)\.isIn/, "resend can target a purpose");
  assert.match(routes, /purpose === "reset"[\s\S]{0,160}codeSent: true/, "reset resends are generic");
  assert.match(routes, /verificationRequired: true[\s\S]{0,320}challengeId/, "register asks for a code when enabled");
  assert.match(routes, /codeRequired: true[\s\S]{0,320}challengeId/, "login asks for a code when enabled");
  assert.match(routes, /purpose: "reset"/, "forgot-password sends a reset code");
  assert.match(routes, /verifyEmailCode\(\{ email, code, purpose: "reset"/, "reset verifies the code");
});
