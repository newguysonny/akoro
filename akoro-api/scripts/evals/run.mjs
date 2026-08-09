#!/usr/bin/env node
// scripts/evals/run.mjs
//
// Run an eval suite from a terminal.
//
// Imports the same lib/evals/index.js the queue worker does, so a run started
// here and a run started from the admin page execute identical code. If they
// diverged, a green board would mean two different things depending on who
// pressed the button.
//
//   node scripts/evals/run.mjs                      # list suites
//   node scripts/evals/run.mjs questions            # default model
//   node scripts/evals/run.mjs routing gpt-4.1-mini
//   node scripts/evals/run.mjs all gpt-4o-mini
//
// Nothing is written to eval_runs: this path is for a developer checking a
// suite before it goes near the button that spends from the admin app. Pass
// --record to store the run alongside the ones started from the page.

import "dotenv/config";
import db from "../../db.js";
import { SUITES, suiteByKey, EVAL_MODELS, estimateUsd, runSuite } from "../../lib/evals/index.js";

const args   = process.argv.slice(2).filter((a) => a !== "--record");
const record = process.argv.includes("--record");
const which  = args[0] ?? null;
const model  = args[1] ?? EVAL_MODELS[0];

if (!which) {
  console.log("\nSuites:\n");
  for (const s of SUITES) {
    console.log(`  ${s.key.padEnd(12)} ${s.cases.length} cases · about $${estimateUsd(s, model)} on ${model}`);
    console.log(`  ${" ".repeat(12)} ${s.purpose.replace(/\s+/g, " ").slice(0, 120)}…\n`);
  }
  console.log(`Models: ${EVAL_MODELS.join(", ")}\n`);
  process.exit(0);
}

if (!EVAL_MODELS.includes(model)) {
  console.error(`Unknown model "${model}". Try one of: ${EVAL_MODELS.join(", ")}`);
  process.exit(1);
}

// The same refusal the endpoint makes. Without a live key every call goes to
// the stand-in model, which returns a fixed reply and would pass the routing
// suite by accident — a perfect score that proves nothing is worse than an
// error, because someone will quote it.
if (!process.env.OPENAI_API_KEY) {
  console.error("\nNo OPENAI_API_KEY. Evals need a live key — the stand-in model would score green and mean nothing.\n");
  process.exit(1);
}

const chosen = which === "all" ? SUITES : [suiteByKey(which)].filter(Boolean);
if (!chosen.length) {
  console.error(`Unknown suite "${which}". Try: ${SUITES.map((s) => s.key).join(", ")}, or "all".`);
  process.exit(1);
}

let anyFailed = false;

for (const suite of chosen) {
  console.log(`\n\x1b[1m${suite.title}\x1b[0m on ${model} — ${suite.cases.length} cases, about $${estimateUsd(suite, model)}\n`);

  let runId = null;
  if (record) {
    const { data } = await db.schema("edu").from("eval_runs").insert({
      suite: suite.key, model, status: "running",
      cases_total: suite.cases.length, started_at: new Date().toISOString(),
    }).select().single();
    runId = data?.id ?? null;
  }

  const res = await runSuite({
    suite, model, runId,
    onCase: (r) => {
      const mark = r.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
      console.log(`  ${mark} ${r.name.padEnd(48)} ${String(r.ms).padStart(6)}ms`);
      if (!r.passed) console.log(`      \x1b[31m${r.detail ?? ""}\x1b[0m`);
    },
  });

  if (runId) {
    await db.schema("edu").from("eval_runs").update({
      status: "done", finished_at: new Date().toISOString(),
      cases_passed: res.passed, cases_failed: res.failed,
      cost_usd: res.costUsd, ms: res.ms,
    }).eq("id", runId);
  }

  const rate = res.total ? Math.round((res.passed / res.total) * 100) : 0;
  console.log(`\n  ${res.passed}/${res.total} passed (${rate}%) · ${(res.ms / 1000).toFixed(1)}s · $${res.costUsd}\n`);
  if (res.failed) anyFailed = true;
}

// Non-zero on failure so this can gate a deploy without anyone reading it.
process.exit(anyFailed ? 1 : 0);
