/**
 * modules/verify/runner.js — runs scenarios and suites, decides verdicts,
 * persists them.
 *
 *   PASS · FAIL · BLOCKED · ERROR · INCONCLUSIVE — only PASS counts (rule 31).
 *
 * Runs execute in-process with a small concurrency limit (no queue
 * dependency: the gate must still say BLOCKED when Redis is down, not hang).
 * Each run is persisted to edu.verify_runs / edu.verify_assertions; if those
 * tables are missing the run still completes and says persisted:false.
 */
import { randomUUID } from "node:crypto";
import db from "../../db.js";
import { createContext } from "./context.js";
import { repeatVerdict, combineRepeats, combineSuite, BlockedError } from "./assertions.js";
import { LIMITS, TARGET, PolicyError } from "./policy.js";
import { capEvidence } from "./evidence.js";
import { SCENARIOS, SUITES } from "./scenarios/index.js";

const edu = () => db.schema("edu");
const live = new Map();          // runId → run (in progress and recent), newest kept
let running = 0;
const waiting = [];

const slot = () => new Promise((resolve) => {
  if (running < LIMITS.maxConcurrent) { running++; resolve(); } else waiting.push(resolve);
});
const release = () => { const next = waiting.shift(); if (next) next(); else running--; };

export const buildSha = () => process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null;
const shaMatches = (want, have) => !want || (!!have && (have.startsWith(want) || want.startsWith(have)));

export function listScenarios() {
  return Object.values(SCENARIOS).map((s) => ({ name: s.name, area: s.area, risk: s.risk, description: s.description,
    repeats: s.repeats || 1, params: s.params || {} }));
}
export const listSuites = () => Object.entries(SUITES).map(([name, list]) => ({ name, scenarios: list }));

async function persistStart(run) {
  const { error } = await edu().from("verify_runs").insert({
    id: run.id, kind: run.kind, name: run.name, target: TARGET, actor: run.actor, params: run.params,
    status: "running", expected_sha: run.expectSha || null, build_sha: run.sha,
  });
  run.persisted = !error;
  if (error) console.warn(`[verify] run ${run.id} not persisted: ${error.message}`);
}
async function persistEnd(run) {
  if (!run.persisted) return;
  const rows = run.scenarios.flatMap((s) => s.assertions.map((a) => ({
    run_id: run.id, scenario: s.name, repeat: a.repeat, name: a.name, passed: a.passed,
    expected: a.expected ?? null, actual: a.actual ?? null, detail: a.detail,
  })));
  if (rows.length) {
    const { error } = await edu().from("verify_assertions").insert(rows.slice(0, 2000));
    if (error) console.warn(`[verify] assertions for ${run.id} not saved: ${error.message}`);
  }
  const { error } = await edu().from("verify_runs").update({
    status: "done", verdict: run.verdict, reason: run.reason, real_user: run.realUser, ms: run.ms,
    evidence: capEvidence({ scenarios: run.scenarios.map((s) => ({ name: s.name, verdict: s.verdict, reason: s.reason, repeats: s.repeats, evidence: s.evidence })) }),
    finished_at: new Date().toISOString(),
  }).eq("id", run.id);
  if (error) console.warn(`[verify] run ${run.id} end not saved: ${error.message}`);
}

/** Every run as a real user is audit-logged (plan §8.5). */
async function auditRealUsers(run, ids) {
  if (!ids.size) return;
  const entries = [...ids].map((id) => ({
    actor: null, actor_label: `verify-gate (${run.actor})`, action: "verify.run_as_user",
    entity_type: "user", entity_id: id, after: { runId: run.id, name: run.name, kind: run.kind },
  }));
  const { error } = await db.from("admin_audit_log").insert(entries);
  if (error) console.warn(`[verify] audit log failed for ${run.id}: ${error.message}`);
}

async function runScenarioOnce(def, params, repeat, runId) {
  const sink = [];
  const evidence = { accounts: [], http: [], agent: [], tools: [], db: [], logs: [], notes: [] };
  const realUsers = new Set();
  const ctx = createContext({ scenario: def, sink, evidence, realUsers, runId });
  let error = null, timer;
  try {
    await Promise.race([
      def.run(ctx, params),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${LIMITS.runTimeoutMs} ms`)), LIMITS.runTimeoutMs); }),
    ]);
  } catch (e) {
    error = e;
  } finally {
    clearTimeout(timer);
  }
  const cleanupFailures = await ctx.runCleanups();
  if (cleanupFailures.length) {
    sink.push({ name: "cleanup", passed: false, expected: "all writes undone", actual: cleanupFailures, detail: "cleanup failed — test data may remain" });
  }
  const verdict = repeatVerdict({ assertions: sink, error });
  return {
    repeat, verdict, assertions: sink.map((a) => ({ ...a, repeat })),
    reason: error ? `${error.name === "BlockedError" || error instanceof PolicyError ? "" : "gate error: "}${error.message}` : null,
    evidence, realUsers,
  };
}

async function runScenario(def, params, runId) {
  const repeats = Math.min(LIMITS.maxRepeats, Math.max(1, Number(params?.repeats) || def.repeats || 1));
  const merged = { ...defaultsOf(def), ...(params || {}) };
  const results = [];
  for (let i = 1; i <= repeats; i++) {
    const r = await runScenarioOnce(def, merged, i, runId);
    results.push(r);
    if (r.verdict === "BLOCKED" || r.verdict === "ERROR") break;   // repeating can't fix a precondition
  }
  const verdict = combineRepeats(results.map((r) => r.verdict));
  return {
    name: def.name, verdict,
    repeats: `${results.filter((r) => r.verdict === "PASS").length}/${results.length}`,
    reason: results.find((r) => r.reason)?.reason || (verdict === "INCONCLUSIVE" ? "the agent behaved differently across repeats" : null),
    assertions: results.flatMap((r) => r.assertions),
    evidence: results.length === 1 ? results[0].evidence : results.map((r) => ({ repeat: r.repeat, ...r.evidence })),
    realUsers: new Set(results.flatMap((r) => [...r.realUsers])),
  };
}

const defaultsOf = (def) => Object.fromEntries(Object.entries(def.params || {}).filter(([, v]) => v && "default" in v).map(([k, v]) => [k, v.default]));

/** Start a run. Resolves when it finishes; callers may not wait. */
/**
 * `nested`: started from inside another run (a scenario that runs the
 * promotion check) — it skips the concurrency slot, which the outer run
 * already holds, so it can't wait on itself.
 */
export function startRun({ scenario, suite, params = {}, expectSha = null, actor = "coding-agent", models = null, nested = false }) {
  const names = suite ? SUITES[suite] : scenario ? [scenario] : null;
  // Model comparison: the same scenario once per model (plan §8.6).
  const compare = Array.isArray(models) && models.length ? models.slice(0, 4).map(String) : null;
  if (compare && !scenario) throw Object.assign(new Error("models compares one scenario — pass scenario, not suite."), { status: 400 });
  if (!names) throw Object.assign(new Error(suite ? `No suite "${suite}".` : "Pass scenario or suite."), { status: 400 });
  const missing = names.filter((n) => !SCENARIOS[n]);
  if (missing.length) throw Object.assign(new Error(`Unknown scenario: ${missing.join(", ")}`), { status: 400 });
  const run = {
    id: randomUUID(), kind: suite || compare ? "suite" : "scenario", name: compare ? `${scenario} × ${compare.join(", ")}` : suite || scenario, actor,
    params, expectSha: expectSha ? String(expectSha).slice(0, 64) : null, sha: buildSha(), target: TARGET,
    status: "queued", verdict: null, reason: null, scenarios: [], realUser: false,
    createdAt: new Date().toISOString(), finishedAt: null, ms: null, persisted: false,
  };
  live.set(run.id, run);
  if (live.size > 200) live.delete(live.keys().next().value);

  run.done = (async () => {
    if (!nested) await slot();
    const t0 = Date.now();
    run.status = "running";
    try {
      await persistStart(run);
      if (!shaMatches(run.expectSha, run.sha)) {
        run.verdict = "BLOCKED";
        run.reason = `stale deploy: expected ${run.expectSha}, this server runs ${run.sha || "an unknown build"}`;
      } else {
        const realUsers = new Set();
        const plan = compare ? compare.map((m) => ({ name: names[0], params: { ...params, model: m }, label: `${names[0]}@${m}` }))
          : names.map((n) => ({ name: n, params }));
        for (const step of plan) {
          const t0s = Date.now();
          const res = await runScenario(SCENARIOS[step.name], step.params, run.id);
          res.realUsers.forEach((id) => realUsers.add(id));
          delete res.realUsers;
          if (step.label) { res.name = step.label; res.model = step.params.model; }
          res.ms = Date.now() - t0s;
          run.scenarios.push(res);
        }
        if (compare) {
          run.compare = run.scenarios.map((s) => ({ model: s.model, verdict: s.verdict, repeats: s.repeats, ms: s.ms,
            failed: s.assertions.filter((a) => !a.passed).map((a) => a.name) }));
        }
        run.realUser = realUsers.size > 0;
        await auditRealUsers(run, realUsers);
        run.verdict = run.kind === "suite" ? combineSuite(run.scenarios.map((s) => s.verdict)) : run.scenarios[0].verdict;
        run.reason = run.verdict === "PASS" ? null
          : run.scenarios.filter((s) => s.verdict !== "PASS").map((s) => `${s.name}: ${s.verdict}${s.reason ? ` (${s.reason})` : ""}`).join("; ");
      }
    } catch (e) {
      run.verdict = "ERROR";
      run.reason = `gate error: ${e.message}`;
    } finally {
      run.status = "done";
      run.ms = Date.now() - t0;
      run.finishedAt = new Date().toISOString();
      await persistEnd(run).catch(() => {});
      if (!nested) release();
      console.log(`[verify] ${run.kind} ${run.name} → ${run.verdict} (${run.ms} ms, run ${run.id})`);
    }
    return run;
  })();
  return run;
}

export function publicRun(run, { full = true } = {}) {
  const base = { id: run.id, kind: run.kind, name: run.name, status: run.status, verdict: run.verdict, reason: run.reason,
    sha: run.sha, expectedSha: run.expectSha, target: run.target, ms: run.ms, createdAt: run.createdAt, finishedAt: run.finishedAt,
    persisted: run.persisted, verified: run.verdict === "PASS", ...(run.compare ? { compare: run.compare } : {}) };
  if (!full) return base;
  return { ...base, scenarios: run.scenarios.map((s) => ({ name: s.name, verdict: s.verdict, repeats: s.repeats, reason: s.reason,
    failed: s.assertions.filter((a) => !a.passed), assertions: s.assertions, evidence: s.evidence })) };
}

/** A run from memory, else from the database (survives restarts). */
export async function getRun(id) {
  if (live.has(id)) return publicRun(live.get(id));
  const { data, error } = await edu().from("verify_runs").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const { data: rows } = await edu().from("verify_assertions").select("scenario, repeat, name, passed, expected, actual, detail").eq("run_id", id).limit(2000);
  // A run still "running" in the database but not in this process was cut off by a restart.
  const interrupted = data.status === "running";
  const byScenario = new Map();
  for (const r of rows || []) {
    if (!byScenario.has(r.scenario)) byScenario.set(r.scenario, []);
    byScenario.get(r.scenario).push(r);
  }
  const ev = data.evidence?.scenarios || [];
  return {
    id: data.id, kind: data.kind, name: data.name, status: interrupted ? "done" : data.status,
    verdict: interrupted ? "ERROR" : data.verdict, reason: interrupted ? "interrupted — the server restarted during the run" : data.reason,
    sha: data.build_sha, expectedSha: data.expected_sha, target: data.target, ms: data.ms,
    createdAt: data.created_at, finishedAt: data.finished_at, persisted: true, verified: !interrupted && data.verdict === "PASS",
    scenarios: ev.map((s) => ({ ...s, assertions: byScenario.get(s.name) || [], failed: (byScenario.get(s.name) || []).filter((a) => !a.passed) })),
  };
}

export async function listRuns({ limit = 30, name, verdict } = {}) {
  let q = edu().from("verify_runs").select("id, kind, name, status, verdict, reason, build_sha, ms, created_at").order("created_at", { ascending: false }).limit(Math.min(100, Number(limit) || 30));
  if (name) q = q.eq("name", name);
  if (verdict) q = q.eq("verdict", verdict);
  const { data, error } = await q;
  if (!error) return data || [];
  return [...live.values()].reverse().slice(0, limit).map((r) => publicRun(r, { full: false }));
}

export { BlockedError };
