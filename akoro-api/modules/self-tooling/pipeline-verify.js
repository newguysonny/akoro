/**
 * modules/self-tooling/pipeline-verify.js — run and verify a built tool before
 * it is saved (plan §7.9). Every sample must run without error, return a list
 * and finish inside the run limit; percentage outputs must agree with their own
 * counts. Scope is enforced inside the view reader on every row.
 */
import { runDefinition } from "./interpreters.js";
import { coerceInput } from "./bind.js";
import { verificationAssertions } from "../../lib/verificationAssertions.js";
import { LIMITS } from "./rules.js";

/** Run a definition once, timed; never throws. */
export async function tryRun(def, params, input, ctx) {
  const t0 = Date.now();
  try {
    const out = await runDefinition(def, coerceInput(params, input), ctx);
    return { ok: true, ms: Date.now() - t0, ...out };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e.message || String(e) };
  }
}

/**
 * Verify before register (§7.9): every sample runs without error, returns a
 * list, within time. (Scope is enforced inside the view reader on every row.)
 * → { verdict, assertions, runs, emptyEverywhere }
 */
export async function verifyTool(def, params, samples, ctx) {
  const sink = [];
  const expect = verificationAssertions().createExpect(sink);
  const inputs = samples.length ? samples : [{}];
  const runs = [];
  for (const [i, s] of inputs.entries()) {
    const r = await tryRun(def, params, s, ctx);
    runs.push(r);
    expect.ok(`sample ${i + 1} runs`, r.ok, r.error);
    if (r.ok) {
      expect.ok(`sample ${i + 1} returns a list`, Array.isArray(r.rows));
      expect.lte(`sample ${i + 1} time (ms)`, r.ms, LIMITS.runMs);
    }
  }
  // Percentage sanity: a percent outside 0-100, or one that disagrees with the
  // part/whole counts in its own row, is a wrong answer wearing a verified badge.
  const pcts = percentFieldsOf(def);
  if (pcts.length) for (const [i, r] of runs.entries()) {
    if (!r.ok || !Array.isArray(r.rows)) continue;
    for (const pf of pcts) for (const row of r.rows) {
      const v = row?.[pf.field];
      if (typeof v !== "number") continue;
      expect.ok(`sample ${i + 1} percent ${pf.field} in range`, v >= 0 && v <= 100, `${pf.field} = ${v}`);
      if (pf.count && typeof row[pf.count] === "number" && typeof row[pf.total] === "number") {
        const want = row[pf.total] ? Math.round((row[pf.count] * 1000) / row[pf.total]) / 10 : 0;
        expect.ok(`sample ${i + 1} percent ${pf.field} matches its counts`, Math.abs(v - want) <= 0.11, `${pf.field} = ${v} but ${pf.count}/${pf.total} gives ${want}`);
      }
    }
  }
  return { verdict: verificationAssertions().repeatVerdict({ assertions: sink }), assertions: sink, runs, emptyEverywhere: runs.every((r) => r.ok && !r.rows.length) };
}

/** Percent outputs a definition declares: group percentOf (structural - the
 * interpreter derives part and whole from the same rows) and per-row compute
 * fn "percent". Verified above: in range, and for percentOf consistent with
 * the counts it ships beside. */
function percentFieldsOf(def) {
  const out = [];
  const scanGroup = (g) => { for (const pc of [].concat(g?.percentOf || [])) if (pc?.as) out.push({ field: pc.as, count: `${pc.as}_count`, total: `${pc.as}_total` }); };
  const scanCompute = (c) => { for (const x of [].concat(c || [])) if (x?.fn === "percent" && x?.as) out.push({ field: x.as }); };
  if (def?.kind === "spec") { scanGroup(def.group); scanCompute(def.compute); }
  if (def?.kind === "recipe") for (const o of def.then || []) { if (o?.op === "group") scanGroup(o); if (o?.op === "compute") scanCompute(o); }
  return out;
}
