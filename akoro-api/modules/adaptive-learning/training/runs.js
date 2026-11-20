// =============================================================
// training/runs.js
// In-memory run state and the SSE broadcast every stage writes to.
// =============================================================

import { v4 as uuid } from "uuid";

// ── In-memory run store ───────────────────────────────────────
const runs = new Map();

function createRun(runId, sessionId, teacherId, agentId, subject) {
  const run = {
    runId, sessionId, teacherId, agentId, subject,
    phase: "init", pct: 0, status: "running",
    logs: [], insights: [], summary: null,
    sseClients: new Set(),
    startedAt: new Date().toISOString(), completedAt: null,
  };
  runs.set(runId, run);
  return run;
}

function runLog(run, tag, message, value = null) {
  const entry = { id: uuid(), ts: new Date().toISOString(), tag, message, value };
  run.logs.push(entry);
  _broadcast(run, "log", entry);
  return entry;
}

function runProgress(run, phase, pct, message) {
  run.phase = phase; run.pct = pct;
  _broadcast(run, "progress", { phase, pct, message, ts: new Date().toISOString() });
}

function runInsight(run, insight) {
  const entry = { id: uuid(), ts: new Date().toISOString(), ...insight };
  run.insights.push(entry);
  _broadcast(run, "insight", entry);
  return entry;
}

function completeRun(run, summary) {
  run.status = "complete"; run.pct = 100;
  run.summary = summary; run.completedAt = new Date().toISOString();
  _broadcast(run, "complete", summary);
  setTimeout(() => { run.sseClients.forEach(c => { try { c.end(); } catch (_) {} }); run.sseClients.clear(); }, 3000);
}

function errorRun(run, message) {
  run.status = "error";
  runLog(run, "err", "Training run failed", message);
  _broadcast(run, "error", { message, ts: new Date().toISOString() });
  run.sseClients.forEach(c => { try { c.end(); } catch (_) {} });
  run.sseClients.clear();
}

function _broadcast(run, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  run.sseClients.forEach(c => { try { c.write(msg); } catch (_) {} });
}

export { runs, createRun, runLog, runProgress, runInsight, completeRun, errorRun, _broadcast };
