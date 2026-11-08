// Model evals through the gate (Phase 17): the same /api/admin/evals the admin
// Evals page uses, as the test admin tester90 (no password; the gate lets it
// reach the evals and nothing else — context.js). evals.run starts a suite on
// a model and waits for it; evals.result reads a run that outlived the wait.
const ADMIN = "@tester90";
const POLL_MS = 15_000;
const WAIT_MS = 570_000;

/** Notes for a finished run: the score, the bar, the cost, and each failed case. */
function report(ctx, run, results) {
  const rate = run.cases_total ? (run.cases_passed / run.cases_total) : 0;
  ctx.note(`${run.suite} on ${run.model}: ${run.status} · ${run.cases_passed}/${run.cases_total} passed (${Math.round(rate * 100)}%) · bar ${Math.round(Number(run.threshold ?? 1) * 100)}% · ${run.met_threshold ? "meets the bar" : "below the bar"} · $${Number(run.cost_usd ?? 0).toFixed(4)} · ${Math.round((run.ms || 0) / 1000)} s · run ${run.id}`);
  if (run.error) ctx.note(`run error: ${run.error}`);
  for (const r of (results || []).filter((x) => !x.passed).slice(0, 40)) {
    ctx.note(`FAILED ${r.case_key} — ${r.name}: ${String(r.detail ?? "").slice(0, 300)}${r.actual ? ` · got ${JSON.stringify(r.actual).slice(0, 180)}` : ""}`);
  }
  ctx.expect.eq("the run finished", run.status, "done");
  ctx.expect.eq("every case has a result", (results || []).length, run.cases_total);
}

async function readRun(ctx, id) {
  const r = await ctx.http({ as: ADMIN, path: `/api/admin/evals/${id}` });
  ctx.expect.status("the run can be read", r, 200);
  return { run: r.body?.run, results: r.body?.results || [] };
}

export const evalsRun = {
  name: "evals.run", area: "evals", risk: "write", timeoutMs: 600_000,
  description: "Run one eval suite on one model as the test admin, the way the Evals page does (params: suite, model, learner for suites that need one); waits up to ~9.5 min and reports the score, the bar, the cost and every failed case.",
  params: { suite: { default: "agent-checks" }, model: { default: "deepseek" }, learner: { default: null } },
  async run(ctx, params) {
    const meta = await ctx.http({ as: ADMIN, path: "/api/admin/evals/suites" });
    ctx.expect.status("the suites list answers", meta, 200);
    const suites = (meta.body?.suites || []).map((s) => s.key);
    const models = meta.body?.models || [];
    if (!suites.includes(params.suite)) ctx.expect.blocked(`No suite "${params.suite}" here. Suites: ${suites.join(", ")}`);
    if (!models.includes(params.model)) ctx.expect.blocked(`Model "${params.model}" isn't set up on this server. Models: ${models.join(", ")}`);
    const start = await ctx.http({ as: ADMIN, method: "POST", path: "/api/admin/evals/run", body: { suite: params.suite, model: params.model, ...(params.learner ? { learner: params.learner } : {}) } });
    if (start.status === 409) ctx.expect.blocked(`Another eval run is going (${start.body?.runId}) — read it with evals.result runId=${start.body?.runId}.`);
    ctx.expect.status("the run is queued", start, 202);
    const id = start.body?.runId;
    ctx.note(`run ${id} · ${start.body?.cases} cases · about $${start.body?.estimatedUsd}`);
    const until = Date.now() + WAIT_MS;
    while (Date.now() < until) {
      await new Promise((ok) => setTimeout(ok, POLL_MS));
      const list = await ctx.http({ as: ADMIN, path: "/api/admin/evals?limit=5" });
      const run = (list.body?.runs || []).find((x) => x.id === id);
      if (run && !["queued", "running"].includes(run.status)) break;
    }
    const { run, results } = await readRun(ctx, id);
    if (["queued", "running"].includes(run?.status)) {
      ctx.note(`${run.cases_passed + run.cases_failed}/${run.cases_total} cases done so far`);
      ctx.expect.blocked(`Still ${run.status} after the wait — read it later with evals.result runId=${id}.`);
    }
    report(ctx, run, results);
  },
};

export const evalsResult = {
  name: "evals.result", area: "evals", risk: "read",
  description: "Read one eval run (param runId) as the test admin: its score, bar, cost and every failed case.",
  params: { runId: { default: null } },
  async run(ctx, params) {
    if (!/^(\d{1,12}|[0-9a-f-]{36})$/i.test(String(params.runId ?? ""))) ctx.expect.blocked("Pass runId (from evals.run).");
    const { run, results } = await readRun(ctx, params.runId);
    if (["queued", "running"].includes(run?.status)) {
      ctx.note(`${run.cases_passed + run.cases_failed}/${run.cases_total} cases done so far`);
      ctx.expect.blocked(`Still ${run.status} — read it again shortly.`);
    }
    report(ctx, run, results);
  },
};

/** A few benchmark cases by template, on one model — the cheap way to check one behaviour without the full 115. */
export const benchmarkCases = {
  name: "evals.benchmark_cases", area: "evals", risk: "read", timeoutMs: 300_000,
  description: "Run the benchmark cases of one template (param template, e.g. plan_three_tasks) on one model (param model) and report each case's calls, what the intent step read and whether it passed. Costs a few cents; nothing is written.",
  params: { template: { default: "plan_three_tasks" }, model: { default: "deepseek" }, limit: { default: 5 } },
  async run(ctx, params) {
    const { BENCHMARK_SCENARIOS, runOnce } = await import("../../../lib/evals/benchmark.js");
    const picked = BENCHMARK_SCENARIOS.filter((sc) => sc.template === params.template).slice(0, Math.max(1, Math.min(10, Number(params.limit) || 5)));
    if (!picked.length) ctx.expect.blocked(`No benchmark cases for template "${params.template}".`);
    let passed = 0;
    for (const sc of picked) {
      const r = await runOnce(sc, { model: params.model, userId: null }).catch((e) => ({ success: false, error: e.message }));
      if (r.success) passed++;
      ctx.note(`${sc.id}: ${r.success ? "PASS" : "FAIL"} · calls ${JSON.stringify(r.calls || [])} · intent ${JSON.stringify(r.intent || null)}${r.error ? ` · error ${r.error}` : ""} · failed ${JSON.stringify(Object.entries(r.checks || {}).filter(([, v]) => !v).map(([k]) => k))}`);
    }
    ctx.note(`${passed}/${picked.length} passed`);
    ctx.expect.ok(`every ${params.template} case passes`, passed === picked.length, `${passed}/${picked.length}`);
  },
};
