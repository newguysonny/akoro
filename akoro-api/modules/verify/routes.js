/**
 * modules/verify/routes.js — the Verification Gate's HTTP API.
 * Plan: reference/Self-Tooling & Verification Gate — Grand Plan.md §8.
 *
 *   GET  /api/verify/scenarios           what can be verified (name, area, risk, params)
 *   GET  /api/verify/suites              named sets of scenarios
 *   POST /api/verify/runs                { scenario | suite, params?, expectSha?, wait?, models? } → run
 *                                        models: ["gpt-4o-mini","gpt-4.1"] runs ONE scenario per model
 *                                        and adds a side-by-side `compare`
 *                                        wait (default true): answer when done (≤ ~110 s),
 *                                        else answer at once with the run id to poll
 *   GET  /api/verify/runs                recent runs (?name=&verdict=&limit=)
 *   GET  /api/verify/runs/:id            one run: verdict, failed assertions, evidence
 *
 * Sandbox (V3, sandbox.js): with VERIFY_SANDBOX_ENABLED=true + VERIFY_SANDBOX_URL
 * runs are forwarded to the sandbox gate (its own API + database); pass
 * "target":"production" (or ?target=production) to run here anyway. Unset:
 * everything runs here, as before.
 *
 * Guard: the agent-console key (Authorization: Bearer — the coding agent's
 * environment adds it). Verdicts: PASS · FAIL · BLOCKED · ERROR · INCONCLUSIVE;
 * only PASS is "verified".
 */
import express from "express";
import { guard, TARGET, writesAllowed } from "./policy.js";
import { startRun, getRun, listRuns, listScenarios, listSuites, publicRun, buildSha } from "./runner.js";
import { sandboxConfig, goesToSandbox, forward } from "./sandbox.js";

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const WAIT_MS = 110_000;

router.use(guard);

const sandboxNote = async () => {
  const c = sandboxConfig();
  if (!c.requested) return { enabled: false };
  if (!c.enabled) return { enabled: false, problem: "VERIFY_SANDBOX_ENABLED is true but VERIFY_SANDBOX_URL is missing or not http(s) — running here." };
  const r = await forward("GET", "/scenarios", null, { timeoutMs: 15_000 });
  return { enabled: true, url: c.url, reachable: r.status === 200, sha: r.body?.data?.sha || null, target: r.body?.data?.target || null,
    ...(r.status === 200 ? {} : { problem: r.body?.error || `answered ${r.status}` }) };
};

router.get("/scenarios", asyncHandler(async (req, res) => {
  const sandbox = await sandboxNote();
  res.json({ success: true, data: { target: TARGET, sha: buildSha(), writesAllowed: writesAllowed(), runsGoTo: sandbox.enabled && TARGET !== "sandbox" ? "sandbox" : "here", sandbox, scenarios: listScenarios() } });
}));
router.get("/suites", (_req, res) => res.json({ success: true, data: listSuites() }));

router.post("/runs", asyncHandler(async (req, res) => {
  if (goesToSandbox(req.body?.target || req.query.target)) {
    const { target, ...body } = req.body || {};
    const r = await forward("POST", "/runs", { ...body, actor: String(body.actor || "coding-agent").slice(0, 40) });
    return res.status(r.status).json(r.body);
  }
  const { scenario, suite, params, expectSha, models } = req.body || {};
  let run;
  try {
    run = startRun({ scenario, suite, models, params: params && typeof params === "object" ? params : {}, expectSha, actor: String(req.body?.actor || "coding-agent").slice(0, 40) });
  } catch (e) {
    return res.status(e.status || 400).json({ success: false, error: e.message });
  }
  if (req.body?.wait === false) return res.status(202).json({ success: true, data: publicRun(run, { full: false }) });
  const done = await Promise.race([run.done, new Promise((r) => setTimeout(() => r(null), WAIT_MS))]);
  res.status(done ? 200 : 202).json({ success: true, data: publicRun(done || run, { full: !!done }) });
}));

router.get("/runs", asyncHandler(async (req, res) => {
  if (goesToSandbox(req.query.target)) {
    const q = new URLSearchParams(Object.entries({ limit: req.query.limit, name: req.query.name, verdict: req.query.verdict }).filter(([, v]) => v != null)).toString();
    const r = await forward("GET", `/runs${q ? `?${q}` : ""}`, null, { timeoutMs: 20_000 });
    return res.status(r.status).json(r.body);
  }
  res.json({ success: true, data: await listRuns({ limit: req.query.limit, name: req.query.name, verdict: req.query.verdict }) });
}));
router.get("/runs/:id", asyncHandler(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ success: false, error: "run id is a uuid" });
  const run = await getRun(req.params.id);
  if (run) return res.json({ success: true, data: run });
  // Not a run of this server — with the sandbox on, it's probably the sandbox's.
  if (sandboxConfig().enabled && TARGET !== "sandbox") {
    const r = await forward("GET", `/runs/${req.params.id}`, null, { timeoutMs: 20_000 });
    return res.status(r.status).json(r.body);
  }
  return res.status(404).json({ success: false, error: "No such run." });
}));

export default router;
