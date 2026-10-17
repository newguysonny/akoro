// Seam tests for the Supabase-backed study-prep store, run against the
// in-memory fake db (no network). Asserts on what the store writes and returns.
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const { default: db } = await import("../../../db.js");
const { installFakeDb } = await import("../../../lib/testing/fakeDb.mjs");
const { supabaseStore: store } = await import("./store.js");
const { InsufficientBalanceError } = await import("./harness.js");

const L = "learner-1";
const OTHER = "learner-2";
const S = "edu.study_prep_sessions";
const T = "edu.study_prep_topics";
const E = "edu.study_prep_events";

/** Install the fake for one test and restore it afterwards. */
function fakeFor(t, seed = {}, options = {}) {
  const fake = installFakeDb(db, seed, options);
  t.after(() => fake.restore());
  return fake;
}

/**
 * PostgREST's `or=(col.ilike.pattern,...)` — the fake only models eq/is inside
 * or(), so wrap each query to evaluate ilike alternatives too. A segment that
 * does not parse as `col.op.value` is a PostgREST parse error (400), modelled
 * with failNext so the query returns an error like the real API would.
 */
function withIlikeOr(fake) {
  const schema = db.schema;
  db.schema = (name) => {
    const builder = schema(name);
    return {
      ...builder,
      from: (table) => {
        const q = builder.from(table);
        q.or = (expr) => {
          const parts = String(expr).split(",");
          const alts = parts.map((part) => {
            const m = /^([a-z_]+)\.(ilike|eq)\.(.*)$/.exec(part);
            return m ? { c: m[1], op: m[2], v: m[3] } : null;
          });
          if (alts.some((a) => a == null)) {
            fake.failNext(`${name}.${table}`, "select", { code: "PGRST100", message: `failed to parse logic tree (${expr})` });
            return q;
          }
          const re = (p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
          q.filters.push((r) => alts.some(({ c, op, v }) => (op === "eq" ? String(r[c]) === v : re(v).test(String(r[c] ?? "")))));
          return q;
        };
        return q;
      },
    };
  };
}

// ── sessions ────────────────────────────────────────────────────────────────

test("findActiveSession returns the learner's single active session, ignoring ended and other learners' sessions", async (t) => {
  fakeFor(t, {
    [S]: [
      { id: "done", learner_id: L, status: "completed" },
      { id: "cancelled", learner_id: L, status: "cancelled" },
      { id: "theirs", learner_id: OTHER, status: "planning" },
      { id: "mine", learner_id: L, status: "paused" },
    ],
  });
  assert.deepEqual(await store.findActiveSession(L), { id: "mine", learner_id: L, status: "paused" });
});

test("findActiveSession returns null when only ended sessions exist", async (t) => {
  fakeFor(t, { [S]: [{ id: "a", learner_id: L, status: "completed" }, { id: "b", learner_id: L, status: "abandoned" }] });
  assert.equal(await store.findActiveSession(L), null);
});

test("findActiveSession treats every active status as active", async (t) => {
  for (const status of ["planning", "awaiting_confirmation", "topic_active", "replanning", "paused"]) {
    const fake = installFakeDb(db, { [S]: [{ id: `s-${status}`, learner_id: L, status }] });
    try {
      assert.equal((await store.findActiveSession(L))?.id, `s-${status}`, status);
    } finally { fake.restore(); }
  }
  t.diagnostic("all five active statuses matched");
});

test("findActiveSession surfaces a db error instead of reporting no session", async (t) => {
  const fake = fakeFor(t, { [S]: [] });
  fake.failNext(S, "select", { message: "boom" });
  await assert.rejects(store.findActiveSession(L), { message: "boom" });
});

test("findActiveSessionsList: active only, newest first, at most 3, as a { data, error } result", async (t) => {
  fakeFor(t, {
    [S]: [
      { id: "old", learner_id: L, status: "paused", updated_at: "2026-01-01T00:00:00Z" },
      { id: "ended", learner_id: L, status: "completed", updated_at: "2026-09-01T00:00:00Z" },
      { id: "newest", learner_id: L, status: "planning", updated_at: "2026-05-01T00:00:00Z" },
      { id: "mid", learner_id: L, status: "topic_active", updated_at: "2026-03-01T00:00:00Z" },
      { id: "mid2", learner_id: L, status: "replanning", updated_at: "2026-02-01T00:00:00Z" },
      { id: "theirs", learner_id: OTHER, status: "planning", updated_at: "2026-10-01T00:00:00Z" },
    ],
  });
  const { data, error } = await store.findActiveSessionsList(L);
  assert.equal(error, null);
  assert.deepEqual(data.map((r) => r.id), ["newest", "mid", "mid2"]);
});

test("createSession inserts the row and returns it with its generated id", async (t) => {
  const fake = fakeFor(t);
  const row = { learner_id: L, goal: "Pass BECE", subject: "Basic Science", status: "planning" };
  const created = await store.createSession(row);
  assert.ok(created.id);
  assert.equal(created.goal, "Pass BECE");
  assert.equal(fake.rows(S).length, 1);
  assert.equal(fake.rows(S)[0].id, created.id);
});

test("createSession throws when the insert fails", async (t) => {
  const fake = fakeFor(t);
  fake.failNext(S, "insert", { code: "23505", message: "duplicate key value violates unique constraint" });
  await assert.rejects(store.createSession({ learner_id: L, status: "planning" }), { code: "23505" });
  assert.equal(fake.rows(S).length, 0);
});

test("getSession returns the row by id, or null", async (t) => {
  fakeFor(t, { [S]: [{ id: "s1", learner_id: L, status: "planning" }] });
  assert.equal((await store.getSession("s1")).learner_id, L);
  assert.equal(await store.getSession("nope"), null);
});

test("updateSessionConditional: writes and returns the row only when the expected status still holds", async (t) => {
  const fake = fakeFor(t, { [S]: [{ id: "s1", learner_id: L, status: "planning", goal: "g" }] });
  const won = await store.updateSessionConditional("s1", "planning", { status: "awaiting_confirmation" });
  assert.equal(won.status, "awaiting_confirmation");
  assert.equal(won.goal, "g");
  // A second writer that still expects "planning" loses and changes nothing.
  const lost = await store.updateSessionConditional("s1", "planning", { status: "cancelled" });
  assert.equal(lost, null);
  assert.equal(fake.rows(S)[0].status, "awaiting_confirmation");
});

test("updateSessionConditional on an unknown id returns null", async (t) => {
  fakeFor(t, { [S]: [] });
  assert.equal(await store.updateSessionConditional("missing", "planning", { status: "paused" }), null);
});

// ── topics ──────────────────────────────────────────────────────────────────

test("getTopics returns only this session's topics, ordered by position", async (t) => {
  fakeFor(t, {
    [T]: [
      { id: "t3", session_id: "s1", position: 3 },
      { id: "t1", session_id: "s1", position: 1 },
      { id: "x", session_id: "s2", position: 1 },
      { id: "t2", session_id: "s1", position: 2 },
    ],
  });
  assert.deepEqual((await store.getTopics("s1")).map((r) => r.id), ["t1", "t2", "t3"]);
  assert.deepEqual(await store.getTopics("empty"), []);
});

test("createTopics inserts queued rows, activates the first, and returns them in position order", async (t) => {
  const fake = fakeFor(t);
  const topics = await store.createTopics("s1", [
    { syllabusTopicId: "states-of-matter", label: "States of matter", position: 1 },
    { syllabusTopicId: "living-things", label: "Living things" }, // position defaults to index + 1
    { syllabusTopicId: "x".repeat(200), label: "y".repeat(300), position: 3 },
  ]);
  assert.deepEqual(topics.map((r) => [r.position, r.status]), [[1, "active"], [2, "queued"], [3, "queued"]]);
  assert.equal(topics[1].position, 2);
  assert.equal(topics[2].syllabus_topic_id.length, 120);
  assert.equal(topics[2].label.length, 180);
  assert.ok(topics.every((r) => r.session_id === "s1"));
  assert.equal(fake.rows(T).filter((r) => r.status === "active").length, 1);
});

test("createTopics with an empty plan writes nothing", async (t) => {
  const fake = fakeFor(t);
  assert.deepEqual(await store.createTopics("s1", []), []);
  assert.deepEqual(await store.createTopics("s1", null), []);
  assert.equal(fake.calls.length, 0);
});

test("createTopics throws when the insert fails", async (t) => {
  const fake = fakeFor(t);
  fake.failNext(T, "insert", { message: "insert failed" });
  await assert.rejects(store.createTopics("s1", [{ syllabusTopicId: "a", label: "A" }]), { message: "insert failed" });
});

test("updateTopicConditional: winner only when the expected status holds", async (t) => {
  const fake = fakeFor(t, { [T]: [{ id: "t1", session_id: "s1", status: "active", attempts_used: 0 }] });
  assert.equal((await store.updateTopicConditional("t1", "active", { status: "passed" })).status, "passed");
  assert.equal(await store.updateTopicConditional("t1", "active", { status: "deferred" }), null);
  assert.equal(fake.rows(T)[0].status, "passed");
});

// ── events ──────────────────────────────────────────────────────────────────

test("appendEvents allocates max(sequence)+1 per session, starting at 0", async (t) => {
  const fake = fakeFor(t, { [E]: [{ session_id: "other", sequence: 41 }] }, { unique: { [E]: [["session_id", "sequence"]] } });
  const first = await store.appendEvents("s1", [{ event_type: "observation", sequence: 999 }, { event_type: "harness_decision" }]);
  assert.deepEqual(first.map((r) => r.sequence), [0, 1], "caller's sequence is overridden");
  const more = await store.appendEvents("s1", [{ event_type: "agent_action" }]);
  assert.equal(more[0].sequence, 2);
  assert.equal(more[0].session_id, "s1");
  assert.deepEqual(fake.rows(E).filter((r) => r.session_id === "s1").map((r) => r.sequence), [0, 1, 2]);
});

test("appendEvents retries with a fresh max when a concurrent append wins the slot (23505)", async (t) => {
  const fake = fakeFor(t, { [E]: [{ session_id: "s1", sequence: 0 }] }, { unique: { [E]: [["session_id", "sequence"]] } });
  // Race: between our max() read and our insert, another writer takes sequence 1.
  const schema = db.schema;
  let raced = false;
  db.schema = (name) => {
    const builder = schema(name);
    return {
      ...builder,
      from: (table) => {
        const q = builder.from(table);
        const insert = q.insert.bind(q);
        q.insert = (rows) => {
          if (!raced && name === "edu" && table === "study_prep_events") {
            raced = true;
            fake.rows(E).push({ id: "racer", session_id: "s1", sequence: 1, event_type: "racer" });
          }
          return insert(rows);
        };
        return q;
      },
    };
  };
  const [placed] = await store.appendEvents("s1", [{ event_type: "mine" }]);
  assert.equal(raced, true);
  assert.equal(placed.sequence, 2);
  const seqs = fake.rows(E).map((r) => `${r.sequence}:${r.event_type ?? "seed"}`);
  assert.deepEqual(seqs, ["0:seed", "1:racer", "2:mine"]);
  assert.equal(fake.calls.filter((c) => c.table === E && c.op === "insert").length, 2, "one lost insert, one retry");
});

test("appendEvents gives up after three lost slots", async (t) => {
  const fake = fakeFor(t, {}, { unique: { [E]: [["session_id", "sequence"]] } });
  const dup = { code: "23505", message: "duplicate key value violates unique constraint" };
  const schema = db.schema;
  db.schema = (name) => {
    const builder = schema(name);
    return { ...builder, from: (table) => { const q = builder.from(table); const ins = q.insert.bind(q); q.insert = (r) => { fake.failNext(E, "insert", dup); return ins(r); }; return q; } };
  };
  await assert.rejects(store.appendEvents("s1", [{ event_type: "x" }]), /Could not allocate an event sequence/);
  assert.equal(fake.calls.filter((c) => c.op === "insert").length, 3);
  assert.equal(fake.rows(E).length, 0);
});

test("appendEvents rethrows a non-unique insert error without retrying", async (t) => {
  const fake = fakeFor(t);
  fake.failNext(E, "insert", { code: "23502", message: "null value in column" });
  await assert.rejects(store.appendEvents("s1", [{ event_type: "x" }]), { code: "23502" });
  assert.equal(fake.calls.filter((c) => c.op === "insert").length, 1);
});

test("listEvents returns this session's events in ascending sequence; limit is clamped to 1..500", async (t) => {
  const rows = Array.from({ length: 600 }, (_, i) => ({ session_id: "s1", sequence: 599 - i }));
  fakeFor(t, { [E]: [...rows, { session_id: "s2", sequence: 0 }] });
  const all = await store.listEvents("s1");
  assert.equal(all.length, 200);
  assert.ok(all.every((r, i) => i === 0 || r.sequence > all[i - 1].sequence));
  assert.ok(all.every((r) => r.session_id === "s1"));
  assert.equal((await store.listEvents("s1", { limit: 10_000 })).length, 500);
  assert.equal((await store.listEvents("s1", { limit: -4 })).length, 1);
  assert.equal((await store.listEvents("s1", { limit: "nonsense" })).length, 200);
});

test("listEvents with a limit returns the NEWEST events (oldest-first), like the harness contract double", async (t) => {
  fakeFor(t, { [E]: Array.from({ length: 10 }, (_, i) => ({ session_id: "s1", sequence: i })) });
  const recent = await store.listEvents("s1", { limit: 3 });
  assert.deepEqual(recent.map((r) => r.sequence), [7, 8, 9]);
});

// ── mastery evidence ────────────────────────────────────────────────────────

test("recordMasteryEvidence upserts one learner_concept_evidence row when an approved concept matches", async (t) => {
  const fake = fakeFor(t, {
    "edu.concept_catalog": [
      { id: "draft", status: "draft", subject: "Basic Science", topic_key: "states-of-matter", title: "States of Matter" },
      { id: "c-som", status: "approved", subject: "Basic Science JSS1", topic_key: "states-of-matter", title: "States of Matter" },
    ],
  });
  withIlikeOr(fake);
  const id = await store.recordMasteryEvidence({
    learnerId: L, sessionRef: "sess-1:topic-1", topicLabel: "States of Matter", subject: "Basic Science",
    passed: true, score: 0.8, mastery: { previous: 0.2, next: 0.6 },
  });
  assert.equal(id, "c-som");
  const rows = fake.rows("edu.learner_concept_evidence");
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { ...rows[0], id: undefined, created_at: undefined },
    {
      id: undefined, created_at: undefined,
      learner_id: L, concept_id: "c-som", source_session_id: "sess-1:topic-1", source_turn_id: "sess-1:topic-1:attempt",
      observation_kind: "assessment_result", response_quality: 0.8, claim_validity: 1, model_confidence: 1,
      claim_status: "not_checked", evidence_summary: "Study-prep passed: score 80% (mastery → 0.6)",
      provenance: { source: "study_prep", mastery: { previous: 0.2, next: 0.6 } },
    },
  );
});

test("recordMasteryEvidence: a failed attempt is partial_understanding; a repeat upserts the same row", async (t) => {
  const fake = fakeFor(t, { "edu.concept_catalog": [{ id: "c1", status: "approved", subject: "Basic Science", topic_key: "living-things", title: "Living Things" }] });
  withIlikeOr(fake);
  const args = { learnerId: L, sessionRef: "s:t", topicLabel: "Living things", subject: "basic science", passed: false, score: "junk", mastery: null };
  assert.equal(await store.recordMasteryEvidence(args), "c1");
  assert.equal(await store.recordMasteryEvidence(args), "c1");
  const rows = fake.rows("edu.learner_concept_evidence");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].observation_kind, "partial_understanding");
  assert.equal(rows[0].response_quality, 0);
  assert.equal(rows[0].evidence_summary, "Study-prep attempt: score 0% (mastery → n/a)");
});

test("recordMasteryEvidence writes nothing and returns null when no approved concept matches", async (t) => {
  const fake = fakeFor(t, {
    "edu.concept_catalog": [
      { id: "wrong-subject", status: "approved", subject: "Mathematics", topic_key: "states-of-matter", title: "States of Matter" },
      { id: "unapproved", status: "draft", subject: "Basic Science", topic_key: "states-of-matter", title: "States of Matter" },
    ],
  });
  withIlikeOr(fake);
  assert.equal(await store.recordMasteryEvidence({ learnerId: L, sessionRef: "s", topicLabel: "States of Matter", subject: "Basic Science", passed: true, score: 1 }), null);
  assert.equal(fake.rows("edu.learner_concept_evidence").length, 0);
});

test("recordMasteryEvidence is best-effort: a catalog error returns null, an upsert error still returns the concept", async (t) => {
  const fake = fakeFor(t, { "edu.concept_catalog": [{ id: "c1", status: "approved", subject: "Basic Science", topic_key: "living-things", title: "Living Things" }] });
  withIlikeOr(fake);
  const args = { learnerId: L, sessionRef: "s", topicLabel: "Living Things", subject: "Basic Science", passed: true, score: 1 };
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a.join(" "));
  t.after(() => { console.error = original; });
  fake.failNext("edu.concept_catalog", "select", { message: "catalog down" });
  assert.equal(await store.recordMasteryEvidence(args), null);
  fake.failNext("edu.learner_concept_evidence", "upsert", { message: "upsert failed" });
  assert.equal(await store.recordMasteryEvidence(args), "c1");
  assert.ok(errors.some((e) => e.includes("upsert failed")));
});

test("recordMasteryEvidence still matches a topic whose label contains a comma", async (t) => {
  const fake = fakeFor(t, { "edu.concept_catalog": [{ id: "c1", status: "approved", subject: "Basic Science", topic_key: "work-energy", title: "Forces, Motion and Energy" }] });
  withIlikeOr(fake);
  const id = await store.recordMasteryEvidence({ learnerId: L, sessionRef: "s", topicLabel: "Forces, Motion and Energy", subject: "Basic Science", passed: true, score: 1 });
  assert.equal(id, "c1");
});

// ── coins (through lib/coins.js) ───────────────────────────────────────────

/** coin_debit / coin_credit over the coin_accounts rows, like the SQL ledger functions. */
const ledger = {
  coin_debit: ({ p_account, p_amount }, s) => {
    const acc = s.table("coin_accounts").find((a) => a.id === p_account);
    if (!acc || acc.balance < p_amount) return { data: null };
    acc.balance -= p_amount;
    return { data: acc.balance };
  },
  coin_credit: ({ p_account, p_amount }, s) => {
    const acc = s.table("coin_accounts").find((a) => a.id === p_account);
    acc.balance += p_amount;
    return { data: acc.balance };
  },
};

test("chargeCoins debits the learner's own wallet first", async (t) => {
  const fake = fakeFor(t, { coin_accounts: [{ id: "acc-u", owner_type: "user", owner_id: L, balance: 10 }] }, { rpc: ledger });
  const charge = await store.chargeCoins({ learnerId: L, coins: 4, feature: "study_prep_practice", ref: "topic-1" });
  assert.equal(charge.charged, 4);
  assert.deepEqual(charge.applied, [{ account: "acc-u", kind: "user", took: 4, balanceAfter: 6 }]);
  assert.equal(fake.rows("coin_accounts")[0].balance, 6);
  const debit = fake.rpcCalls.find((c) => c.name === "coin_debit");
  assert.equal(debit.args.p_type, "debit");
  assert.equal(debit.args.p_meta.feature, "study_prep_practice");
  assert.equal(debit.args.p_meta.ref, "topic-1");
  assert.equal(debit.args.p_meta.by, L);
});

test("chargeCoins spills the remainder onto the learner's school wallet", async (t) => {
  const fake = fakeFor(t, {
    coin_accounts: [
      { id: "acc-u", owner_type: "user", owner_id: L, balance: 3 },
      { id: "acc-s", owner_type: "school", owner_id: "school-1", balance: 50 },
    ],
    "mgmt.students": [{ user_id: L, school_id: "school-1" }],
  }, { rpc: ledger });
  const charge = await store.chargeCoins({ learnerId: L, coins: 5, feature: "f", ref: "r" });
  assert.deepEqual(charge.applied.map((a) => [a.account, a.kind, a.took]), [["acc-u", "user", 3], ["acc-s", "school", 2]]);
  assert.deepEqual(fake.rows("coin_accounts").map((a) => a.balance), [0, 48]);
});

test("chargeCoins: insufficient balance rolls back and maps to InsufficientBalanceError", async (t) => {
  const fake = fakeFor(t, { coin_accounts: [{ id: "acc-u", owner_type: "user", owner_id: L, balance: 3 }] }, { rpc: ledger });
  await assert.rejects(store.chargeCoins({ learnerId: L, coins: 5, feature: "f", ref: "r" }), (error) => {
    assert.ok(error instanceof InsufficientBalanceError);
    assert.equal(error.code, "insufficient_balance");
    assert.equal(error.coins, 5);
    assert.equal(error.balance, 3);
    return true;
  });
  assert.equal(fake.rows("coin_accounts")[0].balance, 3, "the partial debit was refunded");
  assert.deepEqual(fake.rpcCalls.map((c) => [c.name, c.args.p_type]), [["coin_debit", "debit"], ["coin_credit", "refund"]]);
});

test("chargeCoins rethrows non-balance errors unchanged", async (t) => {
  fakeFor(t, { coin_accounts: [{ id: "acc-u", owner_type: "user", owner_id: L, balance: 10 }] }, { rpc: { coin_debit: () => ({ error: { message: "ledger offline" } }) } });
  await assert.rejects(store.chargeCoins({ learnerId: L, coins: 2, feature: "f" }), (error) => {
    assert.ok(!(error instanceof InsufficientBalanceError));
    assert.match(error.message, /ledger offline/);
    return true;
  });
});

test("chargeCoins of zero coins charges nothing", async (t) => {
  const fake = fakeFor(t, {}, { rpc: ledger });
  assert.deepEqual(await store.chargeCoins({ learnerId: L, coins: 0, feature: "f" }), { charged: 0, applied: [] });
  assert.equal(fake.rpcCalls.length, 0);
});

test("refundCoins credits each applied account back and returns the failure count", async (t) => {
  const fake = fakeFor(t, {
    coin_accounts: [
      { id: "acc-u", owner_type: "user", owner_id: L, balance: 0 },
      { id: "acc-s", owner_type: "school", owner_id: "school-1", balance: 48 },
    ],
  }, { rpc: ledger });
  const failed = await store.refundCoins({
    charge: { charged: 5, applied: [{ account: "acc-u", kind: "user", took: 3 }, { account: "acc-s", kind: "school", took: 2 }] },
    feature: "study_prep_practice", ref: "topic-1",
  });
  assert.equal(failed, 0);
  assert.deepEqual(fake.rows("coin_accounts").map((a) => a.balance), [3, 50]);
  assert.deepEqual(fake.rpcCalls.map((c) => [c.name, c.args.p_type, c.args.p_meta.feature, c.args.p_meta.ref]), [
    ["coin_credit", "refund", "study_prep_practice:refund", "topic-1"],
    ["coin_credit", "refund", "study_prep_practice:refund", "topic-1"],
  ]);
});

test("refundCoins with no applied breakdown is a no-op; a failed credit is counted", async (t) => {
  const fake = fakeFor(t, {}, { rpc: { coin_credit: () => ({ error: { message: "nope" } }) } });
  assert.equal(await store.refundCoins({ charge: null, feature: "f", ref: "r" }), 0);
  assert.equal(await store.refundCoins({ charge: { applied: [] }, feature: "f", ref: "r" }), 0);
  assert.equal(fake.rpcCalls.length, 0);
  const original = console.error;
  console.error = () => {};
  t.after(() => { console.error = original; });
  assert.equal(await store.refundCoins({ charge: { applied: [{ account: "a", took: 1 }, { account: "b", took: 2 }] }, feature: "f", ref: "r" }), 2);
});
