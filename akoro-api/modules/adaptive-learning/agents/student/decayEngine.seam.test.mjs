// Seam tests for the decay math (MIGRATION_MATRIX §3.3, §7): the pure
// functions only. decayEngine.js builds its own Supabase client at import;
// with dummy env that constructs without touching the network, and no DB
// method (applyDecay, reinforceKnowledge, ...) is ever called here.
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const {
  DECAY_CONFIG, calculateDecayedConfidence, getPriority, getNextReviewDate, DecayEngine,
} = await import("./decayEngine.js");

const close = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-9, `${msg ?? ""} expected ${expected}, got ${actual}`);
const RATE = DECAY_CONFIG.baseDecayRate;

// ── calculateDecayedConfidence ─────────────────────────────────────────────

test("scale: decayEngine works in 0..1 confidence (not the 0-100 of edu.knowledge_confidence)", () => {
  const out = calculateDecayedConfidence(0.6, 2, RATE);
  assert.ok(out > 0 && out < 1, `0..1 in, 0..1 out (got ${out})`);
  // Thresholds and floor are fractions too.
  assert.ok(DECAY_CONFIG.minConfidence < 1);
  assert.ok(Object.values(DECAY_CONFIG.priorityThresholds).every((t) => t > 0 && t <= 1));
});

test("no time elapsed → confidence unchanged (below the 0.98 ceiling)", () => {
  for (const c of [0.05, 0.2, 0.5, 0.75, 0.9]) close(calculateDecayedConfidence(c, 0, RATE), c);
});

test("monotonic non-increasing with time since review", () => {
  for (const c of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
    let prev = Infinity;
    for (let d = 0; d <= 60; d += 0.5) {
      const v = calculateDecayedConfidence(c, d, RATE);
      assert.ok(v <= prev, `start ${c}: day ${d} (${v}) rose above previous (${prev})`);
      prev = v;
    }
  }
});

test("bounded to [minConfidence, 0.98] for any start/time/rate", () => {
  for (const c of [0, 0.01, 0.35, 0.55, 0.72, 0.99, 1]) {
    for (const d of [0, 1, 3, 10, 100, 10_000]) {
      for (const r of [0, 0.05, RATE, 0.5]) {
        const v = calculateDecayedConfidence(c, d, r);
        assert.ok(v >= DECAY_CONFIG.minConfidence && v <= 0.98, `c=${c} d=${d} r=${r} → ${v}`);
      }
    }
  }
});

test("long neglect bottoms out at the minConfidence floor, never 0", () => {
  assert.equal(calculateDecayedConfidence(0.9, 365, RATE), DECAY_CONFIG.minConfidence);
  assert.equal(calculateDecayedConfidence(0.02, 0, RATE), DECAY_CONFIG.minConfidence, "below-floor input is lifted to the floor");
});

test("full confidence is reported at the 0.98 ceiling even with no decay", () => {
  assert.equal(calculateDecayedConfidence(1, 0, RATE), 0.98);
});

test("strength effect: per-day decay = rate × masteryMultiplier of the starting bucket", () => {
  const cases = [[0.1, 0], [0.3, 1], [0.5, 2], [0.7, 3], [0.9, 4]];
  for (const [c, bucket] of cases) {
    const drop = c - calculateDecayedConfidence(c, 0.1, RATE); // tiny step: avoids the floor
    close(drop, RATE * DECAY_CONFIG.masteryMultiplier[bucket] * 0.1, `bucket ${bucket}`);
  }
  // Stronger knowledge decays strictly slower per day.
  const drops = cases.map(([c]) => c - calculateDecayedConfidence(c, 0.1, RATE));
  for (let i = 1; i < drops.length; i++) assert.ok(drops[i] < drops[i - 1], `bucket ${i} decays slower than ${i - 1}`);
});

test("stronger start never ends below a weaker start (same days, same rate)", () => {
  for (const d of [1, 2, 5, 10]) {
    let prev = -Infinity;
    for (let c = 0.05; c <= 0.98; c += 0.01) {
      const v = calculateDecayedConfidence(c, d, RATE);
      assert.ok(v >= prev - 1e-12, `d=${d}: c=${c.toFixed(2)} → ${v} < ${prev}`);
      prev = v;
    }
  }
});

test("decay is linear in the per-topic decay_rate; rate 0 freezes confidence", () => {
  const base = 0.8 - calculateDecayedConfidence(0.8, 1, 0.05);
  const dbl = 0.8 - calculateDecayedConfidence(0.8, 1, 0.10);
  close(dbl, 2 * base);
  close(calculateDecayedConfidence(0.8, 30, 0), 0.8);
});

// ── getPriority ─────────────────────────────────────────────────────────────

test("getPriority thresholds: <0.35 critical, <0.55 high, <0.72 medium, else low", () => {
  const t = DECAY_CONFIG.priorityThresholds;
  assert.equal(getPriority(0), "critical");
  assert.equal(getPriority(t.critical - 1e-6), "critical");
  assert.equal(getPriority(t.critical), "high");
  assert.equal(getPriority(t.high - 1e-6), "high");
  assert.equal(getPriority(t.high), "medium");
  assert.equal(getPriority(t.medium - 1e-6), "medium");
  assert.equal(getPriority(t.medium), "low");
  assert.equal(getPriority(1), "low");
});

test("a confident topic left alone walks down the priority ladder over time", () => {
  const seen = [];
  for (let d = 0; d <= 30; d++) {
    const p = getPriority(calculateDecayedConfidence(0.9, d, RATE));
    if (seen.at(-1) !== p) seen.push(p);
  }
  assert.deepEqual(seen, ["low", "medium", "high", "critical"]);
});

// ── getNextReviewDate ───────────────────────────────────────────────────────

test("getNextReviewDate: interval per priority (1/3/7/14 days); unknown → low interval", () => {
  const daysAhead = (d) => Math.round((d.getTime() - Date.now()) / 86_400_000);
  for (const [priority, days] of Object.entries(DECAY_CONFIG.reviewIntervals)) {
    const due = getNextReviewDate(0.5, priority);
    assert.ok(due instanceof Date);
    assert.equal(daysAhead(due), days, priority);
  }
  assert.equal(daysAhead(getNextReviewDate(0.5, "nonsense")), DECAY_CONFIG.reviewIntervals.low);
  // Interval depends on priority only, not on the confidence argument.
  assert.equal(daysAhead(getNextReviewDate(0.01, "low")), daysAhead(getNextReviewDate(0.99, "low")));
});

// ── DecayEngine pure _build* helpers ────────────────────────────────────────

const engine = new DecayEngine();

test("DecayEngine constructs without a socket and without network", () => {
  assert.equal(engine.wsManager, null);
  const io = {};
  engine.setWsManager(io);
  assert.equal(engine.wsManager, io);
  engine.setWsManager(null);
});

test("_buildSessionTitle tiers line up with getPriority and capitalise the topic", () => {
  const prefix = { critical: "Urgent Review: ", high: "Strengthen: ", medium: "Mastery Check: ", low: "Reinforce: " };
  for (const c of [0, 0.2, 0.3499, 0.35, 0.5, 0.5499, 0.55, 0.7, 0.7199, 0.72, 0.95]) {
    const title = engine._buildSessionTitle("photosynthesis", c);
    assert.ok(title.startsWith(prefix[getPriority(c)]), `${c} → ${title}`);
    assert.match(title, /Photosynthesis/);
  }
  assert.equal(engine._buildSessionTitle("cells", 0.4), "Strengthen: Cells Fundamentals");
});

test("_buildSessionDescription: >7 days wins; then <0.40 struggling; else spaced-repetition copy; pct rounded", () => {
  assert.match(engine._buildSessionDescription("biology", "osmosis", 0.9, 8), /8 days .* Osmosis.* 90%/);
  assert.match(engine._buildSessionDescription("biology", "osmosis", 0.394, 7), /Osmosis knowledge is at 39% — it's struggling/);
  assert.match(engine._buildSessionDescription("biology", "osmosis", 0.4, 2), /Osmosis knowledge \(40%\) can be strengthened/);
});

test("_buildTeachingGoal: rebuild <0.40, reinforce <0.65, push toward mastery with percentage", () => {
  assert.equal(engine._buildTeachingGoal("fractions", 0.39), "Rebuild core understanding of fractions from scratch");
  assert.equal(engine._buildTeachingGoal("fractions", 0.4), "Reinforce the key principles of fractions");
  assert.equal(engine._buildTeachingGoal("fractions", 0.649), "Reinforce the key principles of fractions");
  assert.equal(engine._buildTeachingGoal("fractions", 0.654), "Push fractions knowledge from 65% toward mastery");
});

test("_buildAlertMessage names the faded concepts (D44), capitalises subject/topic, no emoji", () => {
  const t = DECAY_CONFIG.priorityThresholds;
  assert.match(engine._buildAlertMessage("maths", "algebra", 0.5, 9, ["Factorising"]), /forgetting Factorising in Maths — Algebra\. Teach it again/);
  assert.match(engine._buildAlertMessage("maths", "algebra", 0.5, 9, ["A", "B", "C", "D", "E"]), /forgetting A, B, C and 2 more in Maths — Algebra\. Teach them again/);
  assert.match(engine._buildAlertMessage("maths", "algebra", t.critical - 0.01, 9), /forgetting Maths — Algebra \(34%\)/);
  assert.match(engine._buildAlertMessage(null, "algebra", t.high, 9), /^Algebra needs revision \(55%\)/, "a missing subject doesn't crash");
  assert.doesNotMatch(engine._buildAlertMessage("maths", "algebra", 0.1, 9, ["x"]), /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u);
});
