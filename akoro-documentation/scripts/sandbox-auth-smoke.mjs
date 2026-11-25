#!/usr/bin/env node
/**
 * Disposable sandbox auth smoke: registration probe, TOTP 2FA, password reset
 * request/validation.
 *
 * Default: dry run — prints the plan, performs no HTTP request.
 * Run for real:
 *
 *   node akoro-documentation/scripts/sandbox-auth-smoke.mjs --confirm
 *
 * Safety model:
 *   - One disposable user is created through POST /api/admin/users/create.
 *     Its id is captured immediately and deleted in `finally` with
 *     DELETE /api/admin/users/:id, then GET /api/admin/users/:id must 404.
 *   - TOTP is generated locally; 2FA is disabled before deletion. Deleting the
 *     user is the final backstop and also removes the secret.
 *   - The registration probe creates a second disposable user only if the
 *     sandbox lets it. The user is found by exact email through the admin list
 *     and deleted in `finally`.
 *   - Password reset success requires an emailed code/link we cannot read, so
 *     only the request/validation behaviour is asserted (no password changed).
 *
 * It refuses to run against anything except sandbox.akoro.ng.
 */
import { createHmac } from "node:crypto";

const BASE = (process.env.SANDBOX_BASE || "https://sandbox.akoro.ng").replace(/\/+$/, "");
const CONFIRM = process.argv.includes("--confirm");
const ADMIN_EMAIL = process.env.SANDBOX_ADMIN_EMAIL || "admin@demo.akoro.app";
const ADMIN_PASSWORD = process.env.SANDBOX_ADMIN_PASSWORD || "Password123!";
const STAMP = Date.now().toString(36);
const USER_EMAIL = `docs-auth-${STAMP}@docs.akoro.invalid`;
const REG_EMAIL = `docs-reg-${STAMP}@docs.akoro.invalid`;
const USER_PASSWORD = `Disp-${STAMP}-Pass1!`;
const REG_PASSWORD = `Reg-${STAMP}-Pass1!`;

if (!/^https:\/\/sandbox\.akoro\.ng$/.test(BASE)) {
  console.error(`Refusing to run outside sandbox.akoro.ng (got ${BASE}).`);
  process.exit(1);
}
if (!CONFIRM) {
  console.log("DRY RUN — no HTTP requests.");
  console.log(`Would create disposable user ${USER_EMAIL}, test TOTP setup/enable/login/disable,`);
  console.log(`probe registration for ${REG_EMAIL}, exercise forgot/reset validation,`);
  console.log("then delete every created user and verify they are gone.");
  console.log("Re-run with --confirm to execute on sandbox.");
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failed = false;
let blocked = false;
let adminCookie = "";
let userId = null;
let regUserId = null;
let sessionCookie = "";
let twoFactorEnabled = false;
let twoFactorSecret = "";
let twoFactorLogin = null;

function record(name, status, detail) {
  results.push({ name, status, detail });
  console.log(`${status === "ok" ? "PASS" : status === "blocked" ? "BLOCKED" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (status === "fail") failed = true;
  if (status === "blocked") blocked = true;
}

async function call(path, { method = "GET", cookie = "", body, portal = "student" } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "X-Akoro-Portal": portal, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 400); }
  return { status: res.status, headers: res.headers, data, text };
}

function rateLimited(r) {
  return r.status === 429
    || /hibernate-rate-limited/i.test(r.headers.get("x-render-routing") || "")
    || /hibernate-rate-limited/i.test(String(r.text).slice(0, 400));
}
function cookiesOf(r) {
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
}

// ─── TOTP (RFC 6238, SHA-1, 6 digits, 30s) — independent of the API code ────
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(input) {
  const clean = String(input || "").replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret, offsetSteps = 0) {
  const counter = Math.floor(Date.now() / 1000 / 30) + offsetSteps;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[off] & 0x7f) << 24) | ((hmac[off + 1] & 0xff) << 16)
    | ((hmac[off + 2] & 0xff) << 8) | (hmac[off + 3] & 0xff);
  return String(bin % 1e6).padStart(6, "0");
}

async function findUserByEmail(email) {
  const list = await call(`/api/admin/users?search=${encodeURIComponent(email)}&limit=200`, { cookie: adminCookie, portal: "admin" });
  if (list.status !== 200) return { error: list };
  const rows = Array.isArray(list.data?.data) ? list.data.data : [];
  const row = rows.find((u) => String(u.email).toLowerCase() === email.toLowerCase());
  return { row };
}

async function cleanup() {
  if (userId && twoFactorEnabled && twoFactorSecret && sessionCookie) {
    const off = await call("/api/auth/2fa/disable", {
      method: "POST", cookie: sessionCookie, body: { code: totp(twoFactorSecret) },
    }).catch(() => null);
    if (off?.status === 200) { console.log("cleanup: 2FA disabled"); record("cleanup: 2FA disabled", "ok"); }
    else console.error(`cleanup: 2FA disable failed (HTTP ${off?.status ?? "network"}); deleting user anyway`);
  }
  for (const [label, id] of [["disposable user", userId], ["registration probe user", regUserId]]) {
    if (!id) continue;
    const del = await call(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE", cookie: adminCookie, portal: "admin" });
    if (del.status === 200 || del.status === 404) {
      const check = await call(`/api/admin/users/${encodeURIComponent(id)}`, { cookie: adminCookie, portal: "admin" });
      if (check.status === 404) {
        console.log(`cleanup: ${label} ${id} deleted and not found`);
        record(`cleanup: ${label} deleted and verified gone`, "ok", id);
      } else { failed = true; console.error(`cleanup: ${label} ${id} still readable (HTTP ${check.status})`); }
    } else {
      failed = true;
      console.error(`cleanup: ${label} delete failed HTTP ${del.status}: ${String(del.text).slice(0, 300)}`);
    }
  }
}

try {
  // ── Admin session ─────────────────────────────────────────────────────────
  const adminLogin = await call("/api/auth/login", {
    method: "POST", portal: "admin", body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (rateLimited(adminLogin)) {
    console.error("BLOCKED: sandbox is hibernate-rate-limited. No writes performed.");
    process.exit(2);
  }
  if (adminLogin.status !== 200) { record("admin login", "fail", `HTTP ${adminLogin.status}`); throw new Error("admin login"); }
  adminCookie = cookiesOf(adminLogin);
  const me0 = await call("/api/auth/me", { cookie: adminCookie, portal: "admin" });
  if (!adminCookie || me0.status !== 200 || me0.data?.data?.role !== "admin") {
    record("admin session", "fail", `cookie=${!!adminCookie} me=${me0.status} role=${me0.data?.data?.role ?? "?"}`);
    throw new Error("admin session");
  }
  record("admin login + /me", "ok", `role=admin`);

  // ── Disposable user ───────────────────────────────────────────────────────
  const created = await call("/api/admin/users/create", {
    method: "POST", cookie: adminCookie, portal: "admin",
    body: { email: USER_EMAIL, full_name: "Docs Auth Smoke", role: "student", password: USER_PASSWORD },
  });
  userId = created.data?.data?.id || null;
  if (rateLimited(created) || created.status === 429) {
    record("create disposable user", "blocked", "rate limited");
    throw new Error("rate-limited");
  }
  if (created.status !== 201 || !userId) {
    record("create disposable user", "fail", `HTTP ${created.status}: ${String(created.text).slice(0, 200)}`);
    throw new Error("create user");
  }
  record("create disposable user", "ok", userId);

  const userLogin = await call("/api/auth/login", {
    method: "POST", portal: "student", body: { email: USER_EMAIL, password: USER_PASSWORD },
  });
  if (userLogin.status !== 200) {
    record("disposable user login", "blocked", `HTTP ${userLogin.status}: ${String(userLogin.text).slice(0, 200)}`);
    throw new Error("user login");
  }
  sessionCookie = cookiesOf(userLogin);
  if (!sessionCookie || userLogin.data?.data?.codeRequired || userLogin.data?.data?.verificationRequired) {
    record("disposable user login", "blocked", `email-code gate: ${JSON.stringify(userLogin.data).slice(0, 180)}`);
    throw new Error("user login gate");
  }
  record("disposable user login", "ok");

  // ── 2FA setup / enable ────────────────────────────────────────────────────
  const setup = await call("/api/auth/2fa/setup", { method: "POST", cookie: sessionCookie });
  const secret = setup.data?.data?.secret;
  if (setup.status !== 200 || !secret) {
    record("2FA setup", "blocked", `HTTP ${setup.status}: ${String(setup.text).slice(0, 200)}`);
  } else {
    twoFactorSecret = secret;
    record("2FA setup", "ok", `secret length ${secret.length}, otpauth ${setup.data?.data?.otpauthUrl ? "present" : "missing"}`);
    const enable = await call("/api/auth/2fa/enable", { method: "POST", cookie: sessionCookie, body: { code: totp(secret) } });
    if (enable.status === 200 && enable.data?.data?.twoFactorEnabled === true) {
      twoFactorEnabled = true;
      record("2FA enable with locally generated TOTP", "ok");

      const gated = await call("/api/auth/login", {
        method: "POST", portal: "student", body: { email: USER_EMAIL, password: USER_PASSWORD },
      });
      const gatedData = gated.data?.data || gated.data || {};
      if (gated.status === 200 && gatedData.twoFactorRequired && gatedData.challengeToken) {
        twoFactorLogin = "challenge";
        const login2fa = await call("/api/auth/2fa/login", {
          method: "POST", portal: "student", body: { challengeToken: gatedData.challengeToken, code: totp(secret) },
        });
        if (login2fa.status === 200) {
          const c = cookiesOf(login2fa);
          const me = await call("/api/auth/me", { cookie: c });
          if (c && me.status === 200) {
            sessionCookie = c;
            record("2FA login challenge + /2fa/login", "ok");
          } else record("2FA login challenge + /2fa/login", "fail", `cookie=${!!c} me=${me.status}`);
        } else {
          record("2FA login challenge + /2fa/login", "fail", `HTTP ${login2fa.status}: ${String(login2fa.text).slice(0, 200)}`);
        }
      } else if (gated.status === 503 || gatedData.codeRequired || gatedData.verificationRequired) {
        twoFactorLogin = "blocked-by-email-code";
        record("2FA login challenge", "blocked", `email-code gate precedes 2FA: ${JSON.stringify(gatedData).slice(0, 180)}`);
      } else {
        twoFactorLogin = "bypassed";
        record("2FA login challenge", "blocked",
          `login returned HTTP ${gated.status} without a 2FA challenge (demo-domain bypass or RATE limit)`);
      }

      // Disable with the still-valid session (2FA enable does not invalidate it).
      const off = await call("/api/auth/2fa/disable", { method: "POST", cookie: sessionCookie, body: { code: totp(secret) } });
      if (off.status === 200 && off.data?.data?.twoFactorEnabled === false) {
        twoFactorEnabled = false;
        record("2FA disable", "ok");
        if (twoFactorLogin !== "challenge") {
          const plain = await call("/api/auth/login", {
            method: "POST", portal: "student", body: { email: USER_EMAIL, password: USER_PASSWORD },
          });
          const plainData = plain.data?.data || plain.data || {};
          if (plain.status === 200 && !plainData.twoFactorRequired && !plainData.codeRequired) {
            record("login after 2FA disable", "ok");
          } else {
            record("login after 2FA disable", "blocked", `HTTP ${plain.status}: ${JSON.stringify(plainData).slice(0, 160)}`);
          }
        }
      } else {
        record("2FA disable", "fail", `HTTP ${off.status}: ${String(off.text).slice(0, 200)}`);
      }
    } else {
      record("2FA enable", "fail", `HTTP ${enable.status}: ${String(enable.text).slice(0, 200)}`);
    }
  }

  // ── Registration probe ────────────────────────────────────────────────────
  const reg = await call("/api/auth/register", {
    method: "POST", portal: "student",
    body: { email: REG_EMAIL, password: REG_PASSWORD, fullName: "Docs Registration Probe", role: "student" },
  });
  const regData = reg.data?.data || reg.data || {};
  await sleep(500);
  const found = await findUserByEmail(REG_EMAIL);
  if (found.row?.id) regUserId = found.row.id;
  if (reg.status === 201 && !regData.verificationRequired) {
    record("registration", "ok", `HTTP 201, session issued, user ${regUserId ?? "id not listed"}`);
  } else if (regData.verificationRequired) {
    record("registration", "blocked",
      `HTTP ${reg.status}, verificationRequired=true, codeSent=${regData.codeSent}, challengeId=${!!regData.challengeId}; verification code is emailed and unreadable`);
  } else if (reg.status === 503) {
    record("registration", "blocked", "HTTP 503 send_failed (verification email could not be sent)");
  } else if (found.row?.id) {
    record("registration", "blocked", `HTTP ${reg.status}; user row created but flow did not issue a session`);
  } else {
    record("registration", "fail", `HTTP ${reg.status}: ${String(reg.text).slice(0, 200)}`);
  }

  const regBad = await call("/api/auth/register", {
    method: "POST", portal: "student", body: { email: "not-an-email", password: "short" },
  });
  if (regBad.status === 422) record("registration validation (bad email/password)", "ok", "422");
  else record("registration validation (bad email/password)", "fail", `HTTP ${regBad.status}`);

  // ── Password reset: request + validation only ─────────────────────────────
  const forgot = await call("/api/auth/forgot-password", { method: "POST", portal: "student", body: { email: USER_EMAIL } });
  if (forgot.status === 200) {
    const codeFlow = (forgot.data?.data || forgot.data || {}).codeFlow;
    record("forgot-password request", "ok", `generic 200, codeFlow=${codeFlow ?? "n/a"}`);
  } else {
    record("forgot-password request", "fail", `HTTP ${forgot.status}`);
  }

  const resetBadCode = await call("/api/auth/reset-password", {
    method: "POST", portal: "student", body: { email: USER_EMAIL, code: "000000", password: `${USER_PASSWORD}x` },
  });
  if (resetBadCode.status === 400) {
    record("reset-password with a wrong code", "ok", "400 invalid/expired code, password unchanged");
  } else {
    record("reset-password with a wrong code", "fail", `HTTP ${resetBadCode.status}`);
  }

  const resetBadPassword = await call("/api/auth/reset-password", {
    method: "POST", portal: "student", body: { email: USER_EMAIL, code: "000000", password: "short" },
  });
  if (resetBadPassword.status === 422) record("reset-password validation (short password)", "ok", "422");
  else record("reset-password validation (short password)", "fail", `HTTP ${resetBadPassword.status}`);

  record("reset-password success path", "blocked",
    "requires the emailed reset code/link; sandbox email is not readable from this script");
} catch (e) {
  console.error(`STOPPED: ${e.message}`);
} finally {
  if (adminCookie) await cleanup().catch((e) => { failed = true; console.error(`cleanup error: ${e.message}`); });
}

console.log("\nSummary");
for (const r of results) console.log(`- ${r.status.padEnd(7)} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
process.exit(failed ? 1 : blocked ? 2 : 0);
