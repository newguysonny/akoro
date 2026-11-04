import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import test from "node:test";

/**
 * Extraction E2E — the "Failed to fetch" scenario, for real.
 *
 * Boots the REAL records router on a REAL Express HTTP server over the
 * in-memory Supabase stand-in, fronts RunPod with a fake GPU (real fetch
 * interception in-process), then drives the learner's REAL extraction run
 * loop (akoro-learner/src/lib/extractRun.js) against it over HTTP — with
 * the mobile failure injected at the client's network layer: dropped
 * connections ("Failed to fetch", no HTTP status).
 *
 * Proven here, not just in code:
 *   1. a couple of dropped polls ride out and the run completes —
 *      and the page is genuinely cached server-side (GET /extract/:id);
 *   2. a dropped submit is retried and RunPod sees exactly one job;
 *   3. a sustained outage fails the run client-side, then "Try again"
 *      helps finish the OTHER run's batch under the single-flight claim
 *      and completes from the settled batch without a second GPU job.
 */

process.env.SUPABASE_URL            ||= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_KEY    ||= "sandbox-key";
process.env.RUNPOD_API_KEY          ||= "rp-sandbox";
process.env.RUNPOD_PARSE_ENDPOINT_ID ||= "ep-sandbox";
process.env.GOOGLE_CLIENT_ID        ||= "sandbox-client";
process.env.GOOGLE_CLIENT_SECRET    ||= "sandbox-secret";
process.env.GOOGLE_CALLBACK_URL     ||= "https://api.akoro.app/api/auth/google/callback";
process.env.OPENAI_API_KEY          ||= "sandbox-openai";

/* A real RSA keypair so authenticateToken verifies a real RS256 JWT. */
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.JWT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
process.env.JWT_PUBLIC_KEY  = publicKey.export({ type: "spki",  format: "pem" });

const ME   = "11111111-1111-4111-8111-111111111111";
const rec  = (n, key) => ({
  id: `22222222-0000-4000-8000-00000000000${n}`, user_id: ME,
  name: `scan-${n}.jpg`, mime: "image/jpeg", kind: "upload", private: false,
  file_key: key, deleted_at: null, created_at: "2026-11-01T00:00:00Z",
});

/* ── The fake GPU: intercept RunPod before the routes ever see network ───── */
const realFetch = globalThis.fetch;
const gpu = { runs: 0, statusHits: 0, pagesByJob: new Map() };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes("api.runpod.ai")) {
    if (u.endsWith("/run")) {
      gpu.runs += 1;
      const id = `job-${gpu.runs}`;
      gpu.pagesByJob.set(id, `page ${gpu.runs} text`);
      return new Response(JSON.stringify({ id, status: "IN_QUEUE" }), { status: 200 });
    }
    if (u.includes("/status/")) {
      gpu.statusHits += 1;
      const id = u.split("/status/")[1];
      // First hit: still grinding. Later hits: done, with OCR-shaped output.
      const done = gpu.statusHits > gpu.runs || gpu.statusHits > 1;
      return new Response(JSON.stringify(done ? {
        id, status: "COMPLETED", output: {
          model: "sandbox-ocr", wall_ms: 5,
          blocks: [{ bbox_2d: [10, 10, 500, 80], text_content: gpu.pagesByJob.get(id) || "text" }],
        },
      } : { id, status: "IN_PROGRESS" }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "unexpected runpod path" }), { status: 404 });
  }
  return realFetch(url, opts);
};

/* ── Boot the real router over the fake DB, with real token auth ─────────── */
const { default: db }      = await import("../../db.js");
const { installFakeDb }    = await import("../../lib/testing/fakeDb.mjs");
const { default: express } = await import("express");
const { default: router }  = await import("./routes.js");

const fake = installFakeDb(db, {
  users: [{ id: ME, email: "me@akoro.app", username: "me", full_name: "Me", role: "student", is_active: true }],
  "edu.records": [rec(1, "ck-1"), rec(2, "ck-2"), rec(3, "ck-3")],
  "edu.content_jobs": [],
  "edu.content_parses": [],
}, { unique: { "edu.content_jobs": [["content_key", "lane"]] } });   // production's single-flight key

const app = express();
app.use(express.json({ limit: "12mb" }));

app.use("/api/records", router);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/api/records`;

test.after(() => {
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
});

/* ── The learner's real run loop, wired to this server ───────────────────── */
const { runExtraction } = await import("../../../akoro-learner/src/lib/extractRun.js");
const jwtModule = await import("jsonwebtoken");
const TOKEN = jwtModule.default.sign(
  { id: ME, role: "student", email: "me@akoro.app" },
  process.env.JWT_PRIVATE_KEY,
  { algorithm: "RS256", subject: ME, issuer: "https://api.akoro.app", audience: "https://akoro.app", expiresIn: "10m" },
);

const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, {
    method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...(j.data ?? j) };
};

const client = (faults = {}) => {
  const f = { dropSubmits: 0, dropPolls: [], dropped: 0, ...faults };
  let pollAttempts = 0;
  return {
    state: f,
    async submit(target) {
      if (f.dropSubmits > 0) { f.dropSubmits -= 1; f.dropped += 1; throw new TypeError("Failed to fetch"); }
      const { pages, ...rest } = target;
      const r = await call("POST", "/extract", { ...rest, pages });
      if (r.status === 409) { const e = new Error("busy"); e.status = 409; throw e; }
      if (r.status === 429) { const e = new Error("slow down"); e.status = 429; throw e; }
      return r;
    },
    async poll(target) {
      pollAttempts += 1;
      if (f.dropPolls.includes(pollAttempts)) { f.dropped += 1; throw new TypeError("Failed to fetch"); }
      const q = target.contentKey ? `contentKey=${target.contentKey}` : `recordId=${target.recordId}`;
      const r = await call("GET", `/extract/status?${q}`);
      console.log("[poll]", q, "->", r.status, "done:", r.done, "pages:", (r.pages || []).length, "pending:", (r.pending || []).length);
      if (r.status === 429) { const e = new Error("slow down"); e.status = 429; throw e; }
      return r;
    },
  };
};

const img = (n) => ({ pageNumber: n, imageBase64: "aGVsbG8=", width: 612, height: 792, unit: "pt" });

test("a couple of dropped polls ride out and the page lands in the cache", async () => {
  const c = client({ dropPolls: [1, 3] });
  const out = await runExtraction({
    ...c, recordId: rec(1).id, pages: [img(1)],
    pollMs: 0, sleep: async () => {},
  });
  assert.equal(out.error, null, `expected a clean run, got: ${out.error}`);
  assert.equal(out.pages.length, 1);
  assert.match(out.pages[0].markdown, /page \d+ text/);
  assert.equal(c.state.dropped, 2, "the two drops were absorbed");
  assert.equal(gpu.runs, 1, "exactly one GPU job");

  // Production truth: the page is really cached server-side.
  const cached = await call("GET", `/extract/${rec(1).id}`);
  assert.equal(cached.pages.length, 1);
  assert.match(cached.pages[0].markdown, /page \d+ text/);
});

test("a dropped submit is retried; RunPod still sees exactly one job", async () => {
  const before = gpu.runs;
  const c = client({ dropSubmits: 1 });
  const out = await runExtraction({
    ...c, recordId: rec(2).id, pages: [img(1)],
    pollMs: 0, sleep: async () => {},
  });
  assert.equal(out.error, null);
  assert.equal(out.pages.length, 1);
  assert.equal(c.state.dropped, 1, "the dropped submit was retried");
  assert.equal(gpu.runs - before, 1, "no duplicate GPU job");
});

test("a sustained outage fails the run; Try again finishes it with no new GPU job", async () => {
  const before = gpu.runs;
  // Run 1: submit lands, then every poll is dropped — the mobile outage.
  const c1 = client({ dropPolls: [1, 2, 3, 4, 5, 6, 7] });
  const out1 = await runExtraction({
    ...c1, recordId: rec(3).id, pages: [img(1)],
    pollMs: 0, sleep: async () => {},
  });
  assert.match(out1.error || "", /Failed to fetch/, "the outage surfaces client-side");
  assert.equal(gpu.runs - before, 1, "the GPU job exists and keeps running server-side");

  // Run 2 — "Try again": another opener's batch holds the file (409), so the
  // run helps finish it, collects the settled page, and reports clean.
  const c2 = client();
  const out2 = await runExtraction({
    ...c2, recordId: rec(3).id, pages: [img(1)],
    pollMs: 0, sleep: async () => {},
  });
  assert.equal(out2.error, null, `"Try again" must come back clean, got: ${out2.error}`);
  assert.equal(out2.pages.length, 1);
  assert.equal(gpu.runs - before, 1, "no second GPU job — the cache won");

  // Production truth, again: one cached page for the file.
  const cached = await call("GET", `/extract/${rec(3).id}`);
  assert.equal(cached.pages.length, 1);
  assert.equal(fake.rows("edu.content_jobs").length, 3, "each file's single-flight claim tracked");
});
