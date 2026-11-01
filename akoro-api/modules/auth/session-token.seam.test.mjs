/**
 * Only a session (access) token signs in. A refresh token (30 days), a 2FA
 * challenge (password given, no code yet) and the school AI-login hand-off are
 * signed with the same key, issuer and audience — before this check each of
 * them also worked as a login, so the 2FA challenge was a 5-minute bypass.
 * Rejected before any database call, so no database is needed here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.AKORO_BACKGROUND_JOBS_ENABLED = "false";
process.env.JWT_SECRET ||= "session-token-seam-test-secret-0123456789";   // the server has no built-in key any more
// auth/routes.js builds a Google strategy at import (needs a client id) and starts a 60s
// DenyList sweep that would keep this process alive: load it with intervals unref'd.
for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) process.env[k] ||= "test";
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => { const t = realSetInterval(...args); t?.unref?.(); return t; };
const { authenticateToken, authenticateSocket, isSessionToken } = await import("./routes.js").finally(() => { globalThis.setInterval = realSetInterval; });

const SECRET = process.env.JWT_SECRET;
const ISS = process.env.JWT_ISSUER || "https://api.akoro.app";
const AUD = process.env.JWT_AUDIENCE || "https://akoro.app";
const sign = (claims, ttl = 300) => jwt.sign({ sub: "00000000-0000-0000-0000-000000000001", iss: ISS, aud: AUD, ...claims }, SECRET, { algorithm: "HS256", expiresIn: ttl });

/** Runs authenticateToken with a bearer token; → { status, body } (or { next: true } when it lets the request through). */
async function call(token) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; },
      setHeader() {}, cookie() {}, clearCookie() {},
    };
    const req = { headers: { authorization: `Bearer ${token}` }, cookies: {}, get: () => undefined };
    Promise.resolve(authenticateToken(req, res, () => resolve({ next: true }))).catch((e) => resolve({ error: e }));
  });
}

test("isSessionToken: access tokens yes; refresh, 2FA challenge, hand-off no", () => {
  assert.equal(isSessionToken({ sub: "u", jti: "j" }), true);
  assert.equal(isSessionToken({ sub: "u", internal: true }), true);
  for (const type of ["refresh", "2fa_challenge", "ai_handoff", "course_invite"]) assert.equal(isSessionToken({ sub: "u", type }), false, type);
  assert.equal(isSessionToken(null), false);
});

for (const type of ["2fa_challenge", "refresh", "ai_handoff"]) {
  test(`a ${type} token does not sign in (401 before any lookup)`, async () => {
    const out = await call(sign({ type, jti: "t-" + type }));
    assert.equal(out.next, undefined, "must not reach the route");
    assert.equal(out.status, 401);
    assert.equal(out.body?.code ?? out.body?.error?.code ?? "token_invalid", "token_invalid");
  });
  test(`a ${type} token does not open a realtime socket`, async () => {
    const socket = { handshake: { headers: {}, auth: { token: sign({ type }) } } };
    assert.equal(await authenticateSocket(socket), null);
  });
}
