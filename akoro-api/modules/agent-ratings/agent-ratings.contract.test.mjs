/**
 * Grand Plan Phase 18 item 4 — ratings on agent replies: the learner sets and
 * clears a rating on their OWN message only; the rating never reaches the
 * model's context; it joins the Phase 17 episode as a human label next to the
 * code-computed verdict, under the episode's opt-out and anonymisation rules.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.OPENAI_API_KEY ||= "test-key";
process.env.AI_TELEMETRY_DB = "off";
process.env.AI_TELEMETRY = "off";
process.env.JWT_SECRET ||= "stub-jwt-secret";
process.env.JWT_ISSUER ||= "https://api.akoro.app";
process.env.JWT_AUDIENCE ||= "https://akoro.app";
process.env.GOOGLE_CLIENT_ID ||= "stub-google-id";
process.env.GOOGLE_CLIENT_SECRET ||= "stub-google-secret";

const { default: db } = await import("../../db.js");
const { installFakeDb } = await import("../../lib/testing/fakeDb.mjs");
const { default: express } = await import("express");
const R = await import("./ratings.js");
const { labelEpisode } = await import("./store.js");
const { default: ratingsRouter } = await import("./routes.js");
const { loadLearnerAgentConversationContext } = await import("../agent-tools/conversation-context-routes.js");
const { safeHistory } = await import("../adaptive-learning/chat.js");
const { assembleChatDoctrine } = await import("../agent-context/chat-doctrine.js");

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const SESSION = "22222222-2222-4222-8222-222222222222";
const REPLY = "33333333-3333-4333-8333-333333333333";
const MY_Q = "44444444-4444-4444-8444-444444444444";
const OTHERS_REPLY = "55555555-5555-4555-8555-555555555555";
const WF = "66666666-6666-4666-8666-666666666666";
const EVENT = "77777777-7777-4777-8777-777777777777";
const OTHERS_EVENT = "88888888-8888-4888-8888-888888888888";
const CANARY = "CANARY-RATING-7f3a the answer skipped my fractions";
const ENV_ALL = { AGENT_EPISODES: "all", JWT_SECRET: "stub-jwt-secret" };

function seed() {
  return {
    users: [{ id: ME, username: "ada_l", full_name: "Ada Lovelace", agent_training_opt_out: false, agent_training_consent: false },
      { id: OTHER, username: "bo", agent_training_opt_out: false }],
    chat_sessions: [{ id: SESSION, user_id: ME, title: "Fractions" }],
    chat_messages: [
      { id: MY_Q, session_id: SESSION, user_id: ME, role: "user", text: "Explain fractions", created_at: "2026-11-01T10:00:00Z" },
      { id: REPLY, session_id: SESSION, user_id: ME, role: "agent", text: "A fraction is part of a whole.", created_at: "2026-11-01T10:00:05Z" },
      { id: OTHERS_REPLY, session_id: "x", user_id: OTHER, role: "agent", text: "Not yours", created_at: "2026-11-01T10:00:06Z" },
    ],
    "edu.workflow_instances": [{ id: WF, learner_id: ME }, { id: "wf-other", learner_id: OTHER }],
    "edu.workflow_events": [{ id: EVENT, workflow_id: WF, event_type: "workflow.completed", payload: {} }, { id: OTHERS_EVENT, workflow_id: "wf-other", event_type: "workflow.completed", payload: {} }],
    "edu.agent_episodes": [{ id: "ep_1", source: "real", surface: "agent_chat", verdict: "pass", label_key: R.labelKeyFor("agent_chat", REPLY, ENV_ALL), human_label: null, episode: {} }],
  };
}

async function withApp(user, fn) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use("/ratings", ratingsRouter);
  const server = http.createServer(app);
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}/ratings`;
  const call = async (method, path, body) => {
    const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", connection: "close" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json() };
  };
  try { return await fn(call); } finally { server.close(); }
}

/* ── Pure ─────────────────────────────────────────────────────────────── */

test("a rating is up or down with an optional short reason", () => {
  assert.deepEqual(R.normaliseRating({ rating: "UP" }), { rating: "up", reason: null });
  assert.deepEqual(R.normaliseRating({ rating: "down", reason: "  too   long\nwinded " }), { rating: "down", reason: "too long winded" });
  assert.match(R.normaliseRating({ rating: "meh" }).error, /up or down/);
  assert.match(R.normaliseRating({ rating: "down", reason: "x".repeat(281) }).error, /280/);
  assert.deepEqual(R.SURFACES, ["agent_chat", "workflow_summary"]);
});

test("the label key is a keyed hash of the message — never the id, and nothing without a secret", () => {
  const k = R.labelKeyFor("agent_chat", REPLY, { JWT_SECRET: "s1" });
  assert.match(k, /^[0-9a-f]{40}$/);
  assert.ok(!k.includes(REPLY.replace(/-/g, "").slice(0, 8)));
  assert.equal(R.labelKeyFor("agent_chat", REPLY.toUpperCase(), { JWT_SECRET: "s1" }), k, "case-insensitive id");
  assert.notEqual(R.labelKeyFor("workflow_summary", REPLY, { JWT_SECRET: "s1" }), k, "the surface is part of it");
  assert.notEqual(R.labelKeyFor("agent_chat", REPLY, { JWT_SECRET: "s2" }), k, "another secret, another key");
  assert.equal(R.labelKeyFor("agent_chat", REPLY, {}), null, "no secret → no join");
  assert.equal(R.labelKeyFor("agent_chat", "not-a-uuid", { JWT_SECRET: "s1" }), null);
});

test("the human label is anonymised like the episode: placeholders, sensitive reasons dropped", () => {
  const l = R.humanLabel({ rating: "down", reason: "Ada asked, mail ada@example.com", surface: "agent_chat" }, { names: ["Ada"] });
  assert.deepEqual(l, { rating: "down", reason: "<NAME> asked, mail <EMAIL>", surface: "agent_chat", source: "learner" });
  assert.equal(R.humanLabel({ rating: "down", reason: "this made my anxiety attack worse", surface: "agent_chat" }).reason, null, "a sensitive reason is not kept");
  assert.equal(R.humanLabel({ rating: "down", reason: "", surface: "agent_chat" }).rating, "down");
  assert.equal(R.humanLabel({ rating: "x", surface: "agent_chat" }), null);
  assert.equal("learner_id" in l || "user_id" in l, false, "no identity on the label");
});

test("rate per surface and worst-rated first (a thumbs-down the checks passed leads)", () => {
  const s = R.rateBySurface([{ surface: "agent_chat", rating: "up" }, { surface: "agent_chat", rating: "down" }, { surface: "agent_chat", rating: "up" }, { surface: "workflow_summary", rating: "down" }, { surface: "nope", rating: "up" }]);
  assert.deepEqual(s.find((x) => x.surface === "agent_chat"), { surface: "agent_chat", up: 2, down: 1, total: 3, upRate: 0.667 });
  assert.deepEqual(s.find((x) => x.surface === "workflow_summary"), { surface: "workflow_summary", up: 0, down: 1, total: 1, upRate: 0 });
  const w = R.worstFirst([
    { id: "a", rating: "down", verdict: "fail", reason: null, updated_at: "2026-11-02" },
    { id: "b", rating: "down", verdict: "pass", reason: null, updated_at: "2026-11-01" },
    { id: "c", rating: "down", verdict: null, reason: "wrong", updated_at: "2026-11-01" },
  ]);
  assert.deepEqual(w.map((x) => x.id), ["b", "c", "a"]);
});

/* ── Routes: own messages only ────────────────────────────────────────── */

test("the learner sets, changes and clears a rating on their own reply; never on another's", async () => {
  const fake = installFakeDb(db, seed());
  const prev = process.env.AGENT_EPISODES;
  process.env.AGENT_EPISODES = "all";
  try {
    await withApp({ id: ME, role: "student", username: "ada_l", fullName: "Ada Lovelace" }, async (call) => {
      let r = await call("PUT", `/agent_chat/${REPLY}`, { rating: "down", reason: CANARY });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.rating.rating, "down");
      r = await call("PUT", `/agent_chat/${REPLY}`, { rating: "up" });
      assert.equal(r.status, 200);
      assert.equal(fake.rows("edu.agent_message_ratings").length, 1, "one row per message: a change updates it");
      assert.equal(fake.rows("edu.agent_message_ratings")[0].rating, "up");
      assert.equal(fake.rows("edu.agent_episodes")[0].human_label.rating, "up", "joined to the episode");

      assert.equal((await call("PUT", `/agent_chat/${OTHERS_REPLY}`, { rating: "down" })).status, 404, "another learner's reply");
      assert.equal((await call("PUT", `/agent_chat/${MY_Q}`, { rating: "down" })).status, 404, "their own message, but not an agent reply");
      assert.equal((await call("DELETE", `/agent_chat/${OTHERS_REPLY}`)).status, 404);
      assert.equal((await call("PUT", `/workflow_summary/${EVENT}`, { rating: "down" })).status, 200, "their own workflow's summary");
      assert.equal((await call("PUT", `/workflow_summary/${OTHERS_EVENT}`, { rating: "up" })).status, 404, "another learner's workflow");
      assert.equal((await call("PUT", `/nope/${REPLY}`, { rating: "up" })).status, 422);
      assert.equal((await call("PUT", `/agent_chat/123`, { rating: "up" })).status, 422);
      assert.equal((await call("PUT", `/agent_chat/${REPLY}`, { rating: "sideways" })).status, 422);

      r = await call("GET", `?surface=agent_chat&ids=${REPLY},${OTHERS_REPLY}`);
      assert.deepEqual(r.body.ratings.map((x) => x.message_id), [REPLY]);

      r = await call("DELETE", `/agent_chat/${REPLY}`);
      assert.equal(r.status, 200);
      assert.equal(fake.rows("edu.agent_message_ratings").filter((x) => x.surface === "agent_chat").length, 0);
      assert.equal(fake.rows("edu.agent_episodes")[0].human_label, null, "clearing the rating clears the label");
    });
  } finally { fake.restore(); if (prev === undefined) delete process.env.AGENT_EPISODES; else process.env.AGENT_EPISODES = prev; }
});

/* ── The episode join honours the episode's rules ─────────────────────── */

test("the label joins the episode only when the learner's turns are recorded: opt-out wins, modes respected", async () => {
  const user = { id: ME, username: "ada_l", fullName: "Ada Lovelace" };
  let fake = installFakeDb(db, seed());
  try {
    assert.equal(await labelEpisode({ user, surface: "agent_chat", messageId: REPLY, rating: "down", reason: "Ada thinks it was wrong", env: ENV_ALL }), "labelled");
    const label = fake.rows("edu.agent_episodes")[0].human_label;
    assert.deepEqual(label, { rating: "down", reason: "<NAME> thinks it was wrong", surface: "agent_chat", source: "learner" });
    assert.equal(fake.rows("edu.agent_episodes")[0].verdict, "pass", "the code-computed verdict stays beside it, untouched");
    // The learner opts out: the next rating removes the label instead of writing it.
    fake.rows("users")[0].agent_training_opt_out = true;
    assert.equal(await labelEpisode({ user, surface: "agent_chat", messageId: REPLY, rating: "up", env: ENV_ALL }), "cleared");
    assert.equal(fake.rows("edu.agent_episodes")[0].human_label, null);
  } finally { fake.restore(); }
  fake = installFakeDb(db, seed());
  try {
    for (const mode of ["off", "synthetic", "consented"]) {
      await labelEpisode({ user, surface: "agent_chat", messageId: REPLY, rating: "down", env: { ...ENV_ALL, AGENT_EPISODES: mode } });
      assert.equal(fake.rows("edu.agent_episodes")[0].human_label, null, `${mode}: no label (no consent for consented)`);
    }
    fake.rows("users")[0].agent_training_consent = true;
    await labelEpisode({ user, surface: "agent_chat", messageId: REPLY, rating: "down", env: { ...ENV_ALL, AGENT_EPISODES: "consented" } });
    assert.equal(fake.rows("edu.agent_episodes")[0].human_label.rating, "down", "consented + consent → labelled");
    assert.equal(await labelEpisode({ user, surface: "agent_chat", messageId: REPLY, rating: "down", env: { AGENT_EPISODES: "all" } }), "no_key", "no secret → nothing joined");
  } finally { fake.restore(); }
});

test("the chat stores its episode keyed to the saved reply, after the reply is saved", () => {
  const chat = read("../adaptive-learning/chat.js");
  const route = chat.slice(chat.indexOf('router.post("/agent"'));
  assert.match(route, /savedReplyId = messageId \|\| null;/);
  assert.match(route, /labelKey: labelKeyFor\("agent_chat", savedReplyId\)/);
  assert.ok(route.indexOf("void saveEpisode(") > route.indexOf("let turnSaved = false;"), "saved after the reply's own save");
  const store = read("../agent-contract/store.js");
  assert.match(store, /label_key: String\(labelKey\)/);
  assert.doesNotMatch(store, /user_id|learner_id/, "the episode row still holds no user id");
});

/* ── Never in the model's context ─────────────────────────────────────── */

test("a saved rating is absent from the next chat prompt", async () => {
  const fake = installFakeDb(db, seed());
  try {
    await withApp({ id: ME, role: "student" }, async (call) => {
      assert.equal((await call("PUT", `/agent_chat/${REPLY}`, { rating: "down", reason: CANARY })).status, 200);
    });
    assert.ok(JSON.stringify(fake.rows("edu.agent_message_ratings")).includes("CANARY-RATING"), "the rating is stored");
    // Even if a rating ever rode on the message row, the prompt's loader keeps role + text only.
    fake.rows("chat_messages").find((m) => m.id === REPLY).rating = { rating: "down", reason: CANARY };

    // The durable path: what the next turn's dialogue is built from.
    const ctx = await loadLearnerAgentConversationContext({ conversationId: SESSION, userId: ME });
    assert.equal(ctx.messages.length, 2);
    assert.ok(!JSON.stringify(ctx).includes("CANARY-RATING"), "no rating in the conversation context");
    for (const m of ctx.messages) assert.deepEqual(Object.keys(m).sort(), ["content", "createdAt", "role"], "role, text and time only");
    // The browser-history path: extra fields on history items never pass.
    const h = safeHistory([{ role: "assistant", content: "A fraction is part of a whole.", rating: "down", reason: CANARY, feedback: { reason: CANARY } }]);
    assert.deepEqual(h, [{ role: "assistant", content: "A fraction is part of a whole." }]);
    // The static doctrine.
    assert.ok(!(await assembleChatDoctrine({ role: "student", durableMemory: true })).includes("CANARY-RATING"));
  } finally { fake.restore(); }
});

test("nothing that builds a prompt reads the ratings", () => {
  const promptSources = [
    "../adaptive-learning/chat.js", "../agent-tools/conversation-context-routes.js", "../agent-context/chat-doctrine.js",
    "../agent-context/context-manager.js", "../agent-context/template.js", "../agent-runtime/loop.js", "../agent-runtime/harness.js",
    "../adaptive-learning/contextBudget.js", "../adaptive-learning/intent/intentStep.js", "../tasks/lib/agentLoop.js",
  ];
  for (const p of promptSources) {
    const src = read(p);
    assert.doesNotMatch(src, /agent_message_ratings|agent-ratings\/(?:store|routes)|human_label/, `${p} must not read ratings`);
  }
  // The only import of the ratings module in chat.js is the pure key function.
  const chat = read("../adaptive-learning/chat.js");
  assert.deepEqual([...chat.matchAll(/from "\.\.\/agent-ratings\/([^"]+)"/g)].map((m) => m[1]), ["ratings.js"]);
  assert.match(chat, /import \{ labelKeyFor \} from "\.\.\/agent-ratings\/ratings\.js";/);
  // The durable loader selects the transcript's role and text, nothing else.
  assert.match(read("../agent-tools/conversation-context-routes.js"), /db\.from\("chat_messages"\)\s*\n\s*\.select\("role, text, created_at"\)/);
});

test("admin evals reads are admin-only and carry no learner identity", () => {
  const src = read("../admin/agent-ratings.js");
  const routes = [...src.matchAll(/router\.(get|post|put|delete)\("([^"]+)", (\w+)/g)];
  assert.ok(routes.length >= 2);
  for (const [, , path, guard] of routes) assert.equal(guard, "adminOnly", path);
  assert.match(src, /requireRole\(\["admin"\]\)/);
  assert.doesNotMatch(src, /learner_id/, "never selects or returns the learner");
  assert.match(read("../admin/index.js"), /router\.use\("\/", agentRatingsRouter\);/);
  assert.match(read("../adaptive-learning/index.js"), /router\.use\("\/ratings",\s+authenticateToken, agentRatingsRouter\);/);
});

test("the migration is idempotent and registered last in the schema list", () => {
  const sql = read("../../migrations/2026-agent-reply-ratings.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS edu\.agent_message_ratings/);
  assert.match(sql, /CHECK \(surface IN \('agent_chat', 'workflow_summary'\)\)/);
  assert.match(sql, /CHECK \(rating IN \('up', 'down'\)\)/);
  assert.match(sql, /REVOKE ALL ON edu\.agent_message_ratings FROM anon, authenticated/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS human_label jsonb/);
  for (const stmt of sql.match(/^(CREATE|ALTER)[^;]+;/gm) || []) assert.match(stmt, /IF NOT EXISTS|ENABLE ROW LEVEL SECURITY/, stmt);
  const manifest = JSON.parse(read("../../migrations/manifest.json"));
  assert.ok(manifest.schema.includes("2026-agent-reply-ratings.sql"));
});

test("the gate scenarios are registered", () => {
  const idx = read("../verify/scenarios/index.js");
  assert.match(idx, /import \{ ratingSavedNotInPrompt, promptOverrideFlagged \} from "\.\/ratingsPrompts\.js";/);
  assert.match(idx, /ratingSavedNotInPrompt, promptOverrideFlagged[,\]]/);
  assert.match(idx, /"agent-hygiene": \[[^\]]*"ratings\.saved_not_in_prompt", "prompts\.override_flagged"/);
  const sc = read("../verify/scenarios/ratingsPrompts.js");
  assert.match(sc, /name: "ratings\.saved_not_in_prompt", area: "agent-chat", risk: "write"/);
  assert.match(sc, /name: "prompts\.override_flagged", area: "agent-chat", risk: "read"/);
  assert.doesNotMatch(sc, /method: "(PUT|POST)", path: "\/api\/admin\/agent-prompts/, "the gate never edits a live prompt");
});

// chat.js keeps a db client open (the root after-hook only runs once the loop
// drains), so end the process once the last test has reported.
test("done", () => { setTimeout(() => process.exit(process.exitCode ?? 0), 300); });
