/**
 * Phase 15 item 3 (audit F15): a teacher's course invite links to the learner
 * app's real /join/:token page, is signed by the auth module's key (no
 * fallback secret), carries type "course_invite" so it never signs anyone in,
 * and is redeemed by a signed-in learner at POST /api/profiles/invite/redeem.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import jwt from "jsonwebtoken";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.AKORO_BACKGROUND_JOBS_ENABLED = "false";
process.env.JWT_SECRET ||= "invite-contract-test-secret-0123456789abcdef";
for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) process.env[k] ||= "test";
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => { const t = realSetInterval(...args); t?.unref?.(); return t; };
const auth = await import("../auth/index.js").finally(() => { globalThis.setInterval = realSetInterval; });
const { signCourseInvite, verifyCourseInvite, authenticateToken, signHandoff, INVITE_MAX_DAYS } = auth;

const TEACHER = "00000000-0000-0000-0000-0000000000aa";
const COURSES = ["00000000-0000-0000-0000-0000000000c1", "00000000-0000-0000-0000-0000000000c2"];
const ISS = process.env.JWT_ISSUER || "https://api.akoro.app";
const AUD = process.env.JWT_AUDIENCE || "https://akoro.app";

const src = [
  readFileSync(new URL("./routes.js", import.meta.url), "utf8"),
  readFileSync(new URL("./service-invites.js", import.meta.url), "utf8"),
  readFileSync(new URL("./store-invites.js", import.meta.url), "utf8"),
  readFileSync(new URL("./service-links.js", import.meta.url), "utf8"),
].join("\n");
const app     = readFileSync(new URL("../../../akoro-learner/src/App.jsx", import.meta.url), "utf8");
const page    = readFileSync(new URL("../../../akoro-learner/src/pages/JoinPage.jsx", import.meta.url), "utf8");
const caller  = readFileSync(new URL("../../../akoro-instructor/src/hooks/useStudentsAPI.js", import.meta.url), "utf8");

test("an invite round-trips: teacher, courses and expiry come back", () => {
  const out = verifyCourseInvite(signCourseInvite({ teacherId: TEACHER, courseIds: COURSES }, 7));
  assert.equal(out.teacherId, TEACHER);
  assert.deepEqual(out.courseIds, COURSES);
  const days = (Date.parse(out.expiresAt) - Date.now()) / 86400e3;
  assert.ok(days > 6.9 && days <= 7, `expires in ~7 days (got ${days})`);
});

test("expiry is clamped to 1–30 days", () => {
  const far = verifyCourseInvite(signCourseInvite({ teacherId: TEACHER, courseIds: COURSES }, 3650));
  assert.ok((Date.parse(far.expiresAt) - Date.now()) / 86400e3 <= INVITE_MAX_DAYS);
  const zero = verifyCourseInvite(signCourseInvite({ teacherId: TEACHER, courseIds: COURSES }, 0));
  assert.ok((Date.parse(zero.expiresAt) - Date.now()) / 86400e3 > 0.9);
});

test("only a course_invite token redeems: session, hand-off, forged and old fallback-secret tokens are refused", () => {
  assert.equal(verifyCourseInvite(signHandoff(TEACHER)), null, "a hand-off token is not an invite");
  const claims = { sub: TEACHER, courseIds: COURSES, iss: ISS, aud: AUD };
  assert.equal(verifyCourseInvite(jwt.sign(claims, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: 60 })), null, "untyped (session-shaped) token");
  for (const key of ["akoro-dev-secret", "akoro-dev-secret-change-in-production"]) {
    assert.equal(verifyCourseInvite(jwt.sign({ ...claims, type: "course_invite" }, key, { algorithm: "HS256", expiresIn: 60 })), null, `signed with ${key}`);
    // The pre-fix shape: no issuer/audience, signed with the old fallback.
    assert.equal(verifyCourseInvite(jwt.sign({ courseIds: COURSES, courseId: COURSES[0], teacherId: TEACHER, type: "course_invite" }, key, { expiresIn: "7d" })), null);
  }
  assert.equal(verifyCourseInvite(jwt.sign({ ...claims, type: "course_invite", courseIds: [] }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: 60 })), null, "no courses");
  assert.equal(verifyCourseInvite(jwt.sign({ ...claims, type: "course_invite" }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: -10 })), null, "expired");
  for (const bad of [undefined, null, "", "x", 42, "a".repeat(5000)]) assert.equal(verifyCourseInvite(bad), null);
});

test("an invite token never signs in", async () => {
  const token = signCourseInvite({ teacherId: TEACHER, courseIds: COURSES }, 7);
  const out = await new Promise((resolve) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; }, setHeader() {}, cookie() {}, clearCookie() {} };
    const req = { headers: { authorization: `Bearer ${token}` }, cookies: {}, get: () => undefined };
    Promise.resolve(authenticateToken(req, res, () => resolve({ next: true }))).catch((e) => resolve({ error: e }));
  });
  assert.equal(out.next, undefined);
  assert.equal(out.status, 401);
});

test("the invite route signs with the auth helper and links to the learner app (FRONTEND_URL)", () => {
  assert.doesNotMatch(src, /akoro-dev-secret|JWT_SECRET \?\?/);
  assert.doesNotMatch(src, /akoro\.app\/join/);
  assert.match(src, /signCourseInvite\(\{ teacherId: req\.user\.id, courseIds \}, expires_in_days\)/);
  assert.match(src, /const inviteUrl = `\$\{LEARNER_APP_URL\(\)\}\/join\/\$\{token\}`/);
  assert.match(src, /process\.env\.FRONTEND_URL/);
  assert.match(src, /router\.post\("\/teacher\/invite", authenticateToken, requireRole\(\["instructor", "admin"\]\)/);
});

test("preview is public, redeem needs sign-in and re-checks the teacher still owns the courses", () => {
  assert.match(src, /router\.get\("\/invite\/:token", asyncHandler\(/);
  assert.match(src, /router\.post\("\/invite\/redeem", authenticateToken, asyncHandler\(/);
  assert.match(src, /\.in\("id", invite\.courseIds\)\.eq\("instructor_id", invite\.teacherId\)/);
  assert.equal((src.match(/verifyCourseInvite\(/g) || []).length, 2);
});

test("the learner app has /join/:token, which previews, sends to sign-in/up and back, then redeems", () => {
  assert.match(app, /<Route path="\/join\/:token"\s+element=\{<JoinPage \/>\}\/>/);
  assert.match(page, /apiGet\(`\/api\/profiles\/invite\/\$\{enc\}`/);
  assert.match(page, /apiPost\('\/api\/profiles\/invite\/redeem', \{ token \}\)/);
  assert.match(page, /\/signin\?next=\$\{next\}/);
  assert.match(page, /\/signup\?next=\$\{next\}/);
  assert.match(caller, /apiPost\('\/api\/profiles\/teacher\/invite'/, "the instructor app still sends invites");
});

test("next= only ever points inside the learner app", async () => {
  const { nextPath } = await import("../../../akoro-learner/src/utils/nextPath.js");
  assert.equal(nextPath("?next=%2Fjoin%2Fabc.def"), "/join/abc.def");
  for (const bad of ["?next=%2F%2Fevil.com", "?next=https%3A%2F%2Fevil.com", "?next=%2F%5Cevil.com", "?next=join", "", "?x=1"]) assert.equal(nextPath(bad), null, bad);
});
