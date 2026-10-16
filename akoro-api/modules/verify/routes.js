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
 * Guard: the agent-console key (Authorization: Bearer — the coding agent's
 * environment adds it). Verdicts: PASS · FAIL · BLOCKED · ERROR · INCONCLUSIVE;
 * only PASS is "verified".
 */
import express from "express";
import { guard, TARGET, writesAllowed } from "./policy.js";
import { startRun, getRun, listRuns, listScenarios, listSuites, publicRun, buildSha } from "./runner.js";

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const WAIT_MS = 110_000;

router.use(guard);

router.get("/scenarios", (_req, res) => {
  res.json({ success: true, data: { target: TARGET, sha: buildSha(), writesAllowed: writesAllowed(), scenarios: listScenarios() } });
});
router.get("/suites", (_req, res) => res.json({ success: true, data: listSuites() }));

router.post("/runs", asyncHandler(async (req, res) => {
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
  res.json({ success: true, data: await listRuns({ limit: req.query.limit, name: req.query.name, verdict: req.query.verdict }) });
}));
router.get("/runs/:id", asyncHandler(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ success: false, error: "run id is a uuid" });
  const run = await getRun(req.params.id);
  return run ? res.json({ success: true, data: run }) : res.status(404).json({ success: false, error: "No such run." });
}));

export default router;
