/**
 * detail-responds.test.mjs — the community details page must ANSWER.
 *
 * The founding bug of the communities saga: communityOr404 ended with
 *   return withExtras([c])[0];
 * withExtras is async, so that indexes a PROMISE — undefined — and every
 * id-taking route then hit `if (!c) return;` and resolved WITHOUT sending
 * a response. The request hung forever: no error, no 504, no log line —
 * only the watchdog's REQUEST_STALLED and the learner's 30s card. Worse,
 * it hung only when the community EXISTED (the not-found path responded
 * instantly), which is why unauthenticated probes looked healthy.
 *
 * This test drives the REAL router — real authenticateToken (Bearer),
 * real step() deadlines, real handlers — with only PostgREST stubbed at
 * the fetch boundary. On the unfixed code the detail request never
 * responds and this test fails on its own 4s client deadline; on the
 * fixed code it must return 200 with the enriched community.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// ── Environment BEFORE any app import ───────────────────────────────────────
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "stub-service-key";
process.env.JWT_SECRET = process.env.JWT_SECRET || "stub-jwt-secret";
process.env.JWT_ISSUER = process.env.JWT_ISSUER || "https://api.akoro.app";
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || "https://akoro.app";
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "stub-google-id";
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "stub-google-secret";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "stub-openai-key";
delete process.env.PRIVATE_KEY;
delete process.env.PUBLIC_KEY;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COMMUNITY_ID = "22222222-2222-4222-8222-222222222222";
const community = {
  id: COMMUNITY_ID, name: "Study Circle", description: "We study",
  owner_id: USER_ID, is_public: true, created_at: "2026-01-01T00:00:00Z",
};
const user = {
  id: USER_ID, email: "stu@demo.akoro.app", username: "stu",
  full_name: "Stub Student", avatar_url: null, role: "student", is_active: true,
};

// ── Stub PostgREST at the fetch boundary ────────────────────────────────────
// Keep the REAL fetch for the test's own calls to the Express server; only
// supabase builders (constructed after this point) capture the stub.
const realFetch = globalThis.fetch.bind(globalThis);
const jsonResponse = (rows) => new Response(JSON.stringify(rows), {
  status: 200, headers: { "content-type": "application/json" },
});
const served = [];
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof URL ? input : input?.url ?? input);
  const q = url.split("?")[1] || "";
  served.push(url.replace("https://stub.supabase.co/rest/v1/", ""));
  if (url.includes("/users")) return jsonResponse([user]);
  if (url.includes("/communities?")) {
    // Respect the id filter: a lookup for an unknown id finds nothing.
    if (q.includes("id=eq.33333333-3333-4333-8333-333333333333")) return jsonResponse([]);
    return jsonResponse([community]);
  }
  if (url.includes("/community_members")) {
    // myMembership filters by user_id=eq.; memberCounts by community_id=in.(…)
    if (q.includes("user_id=eq.")) return jsonResponse([{ role: "member", joined_at: "2026-02-01T00:00:00Z" }]);
    return jsonResponse([{ community_id: COMMUNITY_ID }, { community_id: COMMUNITY_ID }]);
  }
  if (url.includes("/community_activities")) return jsonResponse([]);
  if (url.includes("/community_activity_submissions")) return jsonResponse([]);
  return jsonResponse([]);
};

// ── Real router, real auth ──────────────────────────────────────────────────
const { default: express } = await import("express");
const { default: communitiesModule } = await import("./routes.js");
const { default: jwt } = await import("jsonwebtoken");

const token = jwt.sign({ sub: USER_ID, role: "student" }, process.env.JWT_SECRET, {
  issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE,
  expiresIn: "5m", algorithm: "HS256",
});

const app = express();
app.use("/api/communities", communitiesModule);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const authedGet = async (path) => {
  // The regression assertion is inside the timeout: on the buggy code the
  // server never responds and the abort fires — the exact user experience.
  const ac = new AbortController();
  const giveUp = setTimeout(() => ac.abort(new Error("client deadline: no answer at all")), 4000);
  try {
    return await realFetch(base + path, { headers: { authorization: `Bearer ${token}` }, signal: ac.signal });
  } finally { clearTimeout(giveUp); }
};

test("GET /:id responds 200 with the enriched community (the founding-bug regression)", async () => {
  const res = await authedGet(`/api/communities/${COMMUNITY_ID}`);
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.id, COMMUNITY_ID);
  assert.equal(body.data.member_count, 2, "withExtras enrichment ran");
  assert.equal(body.data.owner_name, "Stub Student");
  assert.equal(body.data.my_role, "member", "myMembership ran after withExtras");
});

test("GET /:id/activities responds 200 (same helper, same silent-return risk)", async () => {
  const res = await authedGet(`/api/communities/${COMMUNITY_ID}/activities`);
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data));
});

test("GET /:id for a missing community responds 404, not a hang", async () => {
  const res = await authedGet(`/api/communities/33333333-3333-4333-8333-333333333333`);
  assert.equal(res.status, 404);
});

test("the promise-indexing typo can never return (static pin)", async () => {
  const { readFile } = await import("node:fs/promises");
  // Phase 19 step 4 moved communityOr404 (the helper this bug lived in) to
  // service.js; the email of the pin is the same.
  const src = await readFile(new URL("./service.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /withExtras\(\[c\]\)\[0\]/, "unawaited indexing of an async helper");
  assert.match(src, /const rows = await withExtras\(\[c\]\);/);
  // falsy ⇒ ALWAYS responded: the defensive guard that turns any future
  // regression into a 404 instead of an eternal silent hang.
  assert.match(src, /if \(!rows\[0\]\) \{ missing\(res\); return null; \}/);

  // Shut down deterministically. Importing the real auth/db modules leaves
  // background handles (undici keep-alive inside supabase-js, config,
  // passport) that keep this test subprocess alive long after the
  // assertions pass. node --test runs each file in its own subprocess, so
  // a delayed exit affects only this file; the 300ms grace lets the TAP
  // reporter flush this very result line before the process goes away.
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
});
