// =============================================================
// training/routes.js
// The training HTTP router: upload/start, run stream/logs/insights/
// status/export, query/correct, sessions, profile, orchestration, chunks,
// delete, and the live-stream start endpoint.
// =============================================================

import express from "express";
import multer  from "multer";
import { v4 as uuid } from "uuid";
import db from "../../../db.js";
import { runs, createRun, errorRun } from "./runs.js";
import { runPipeline } from "./runner.js";
import { upload, cleanTmp } from "./upload.js";
import { embed, storeChunk, retrieveChunks } from "./store.js";

const router = express.Router();

// =============================================================
// ROUTES
// =============================================================

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// POST /training/upload
router.post("/upload", (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
      return res.status(status).json({ error: err.message });
    }
    next();
  });
}, asyncHandler(async (req, res) => {
  const teacherId = req.user.id;
  const { agentId, subject = "General", sessionTitle } = req.body;
  const file = req.file;
  if (!file)    return res.status(400).json({ error: "No file received" });
  if (!agentId) return res.status(400).json({ error: "agentId is required" });

  const runId = uuid(), sessionId = uuid();
  const run   = createRun(runId, sessionId, teacherId, agentId, subject);
  res.status(202).json({ runId, sessionId, message: "Training started — connect to SSE stream" });
  runPipeline(run, file, teacherId, agentId, subject, sessionTitle).catch(err => {
    errorRun(run, err.message); cleanTmp(file.path);
  });
}));

/**
 * A training run is its teacher's (or an admin's) to watch: the logs and
 * insights carry the uploaded material. Any run id used to answer anyone
 * (Phase 15 item 6). Someone else's run reads as not found.
 */
function ownRun(req, res) {
  const run = runs.get(req.params.runId);
  if (!run || (run.teacherId !== req.user.id && req.user.role !== "admin")) {
    res.status(404).json({ error: "Run not found" });
    return null;
  }
  return run;
}

// GET /training/run/:runId/stream  (SSE)
router.get("/run/:runId/stream", (req, res) => {
  const run = ownRun(req, res);
  if (!run) return;

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  run.logs.forEach(e     => res.write(`event: log\ndata: ${JSON.stringify(e)}\n\n`));
  run.insights.forEach(e => res.write(`event: insight\ndata: ${JSON.stringify(e)}\n\n`));
  res.write(`event: progress\ndata: ${JSON.stringify({ phase: run.phase, pct: run.pct, ts: new Date().toISOString() })}\n\n`);

  if (run.status === "complete") { res.write(`event: complete\ndata: ${JSON.stringify(run.summary)}\n\n`); return res.end(); }
  if (run.status === "error")    { res.write(`event: error\ndata: ${JSON.stringify({ message: "Run failed" })}\n\n`);   return res.end(); }

  run.sseClients.add(res);
  req.on("close", () => run.sseClients.delete(res));
});

// GET /training/run/:runId/logs
router.get("/run/:runId/logs", (req, res) => {
  const run = ownRun(req, res);
  if (!run) return;
  const from = parseInt(req.query.from || "0", 10);
  const tag  = req.query.tag;
  let logs   = run.logs.slice(from);
  if (tag) logs = logs.filter(l => l.tag === tag);
  res.json({
    runId: run.runId, status: run.status, phase: run.phase, pct: run.pct,
    total: run.logs.length, from, logs,
    stats: {
      ok:   run.logs.filter(l => l.tag === "ok").length,
      info: run.logs.filter(l => l.tag === "info").length,
      warn: run.logs.filter(l => l.tag === "warn").length,
      err:  run.logs.filter(l => l.tag === "err").length,
      xp:   run.logs.filter(l => l.tag === "xp").length,
      sys:  run.logs.filter(l => l.tag === "sys").length,
    },
  });
});

// GET /training/run/:runId/insights
router.get("/run/:runId/insights", (req, res) => {
  const run = ownRun(req, res);
  if (!run) return;
  const from = parseInt(req.query.from || "0", 10);
  const type = req.query.type;
  let ins    = run.insights.slice(from);
  if (type) ins = ins.filter(i => i.type === type);
  const totalXP = run.insights.reduce((s, i) => s + (i.xp || 0), 0);
  res.json({
    runId: run.runId, status: run.status, total: run.insights.length, totalXP, from, insights: ins,
    breakdown: run.insights.reduce((acc, i) => { acc[i.type] = (acc[i.type] || 0) + 1; return acc; }, {}),
  });
});

// GET /training/run/:runId/status
router.get("/run/:runId/status", (req, res) => {
  const run = ownRun(req, res);
  if (!run) return;
  const lastError = [...run.logs].reverse().find(l => l.tag === "err");
  res.json({
    runId: run.runId, sessionId: run.sessionId, subject: run.subject,
    status: run.status, phase: run.phase, pct: run.pct,
    startedAt: run.startedAt, completedAt: run.completedAt,
    logCount: run.logs.length, insightCount: run.insights.length,
    totalXP: run.insights.reduce((s, i) => s + (i.xp || 0), 0),
    error: run.status === "error" ? (lastError?.value || lastError?.message || "Training run failed") : null,
    summary: run.summary,
  });
});

// GET /training/run/:runId/export
router.get("/run/:runId/export", (req, res) => {
  const run = ownRun(req, res);
  if (!run) return;
  const lines = [
    "=== Piabam Agent Training Log ===",
    `Run ID:  ${run.runId}`, `Subject: ${run.subject}`,
    `Status:  ${run.status}`, `Started: ${run.startedAt}`,
    `Ended:   ${run.completedAt || "in progress"}`, "=".repeat(50), "",
    ...run.logs.map(l => `[${l.ts}] [${l.tag.toUpperCase().padEnd(4)}] ${l.message}${l.value ? "  →  " + l.value : ""}`),
    "", "=== INSIGHTS ===",
    ...run.insights.map(i => `[${i.ts}] [${i.type}] ${i.concept}: ${i.text} (+${i.xp || 0} XP)`),
  ];
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Content-Disposition", `attachment; filename="training-run-${run.runId}.txt"`);
  res.send(lines.join("\n"));
});

// POST /training/stream-start
router.post("/stream-start", async (req, res) => {
  const teacherId = req.user.id;   // caller trains their OWN agent only
  const { agentId, subject = "General" } = req.body;
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  const sessionId = uuid(), wsToken = uuid(), runId = uuid();
  await db.schema("edu").from("training_sessions").insert({
    id: sessionId, teacher_id: teacherId, agent_id: agentId,
    subject, title: "Live stream — " + new Date().toLocaleString(),
    file_type: "live", status: "streaming", run_id: runId, created_at: new Date(),
  });
  await db.schema("edu").from("stream_tokens").insert({
    token: wsToken, session_id: sessionId, teacher_id: teacherId,
    agent_id: agentId, subject, run_id: runId,
    expires_at: new Date(Date.now() + 30 * 60 * 1000),
  });
  createRun(runId, sessionId, teacherId, agentId, subject);
  res.json({ runId, sessionId, wsToken });
});

// POST /training/query
router.post("/query", async (req, res) => {
  const teacherId = req.user.id;
  const { agentId, studentQuery } = req.body;
  if (!studentQuery) return res.status(400).json({ error: "studentQuery required" });
  try {
    const { buildAgentSystemPrompt } = await import("./agentPromptBuilder.js");
    const systemPrompt = await buildAgentSystemPrompt(teacherId, agentId, studentQuery);
    res.json({ systemPrompt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /training/correct
router.post("/correct", async (req, res) => {
  // Corrections write into the teacher's own knowledge base — bind to the
  // authenticated user so nobody can inject training data into another agent.
  const teacherId = req.user.id;
  const { agentId, studentQuery, agentResponse, correction, subject } = req.body;
  if (!correction) return res.status(400).json({ error: "correction required" });
  try {
    const correctionText = `Student asked: "${studentQuery}"\nAgent said (wrong): "${agentResponse}"\nTeacher correction: "${correction}"`;
    const embedding = await embed(correctionText);
    await storeChunk({ teacherId, agentId, sessionId: uuid(), chunkText: correction,
      chunkType: "correction", metadata: { originalQuery: studentQuery, wrongResponse: agentResponse, subject, priority: "high" }, embedding });
    res.json({ stored: true, message: "Correction stored as high-priority training example" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /training/sessions/:teacherId
router.get("/sessions/:teacherId", async (req, res) => {
  if (req.params.teacherId !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorised" });
  const { limit = 20, offset = 0 } = req.query;
  const { data, error } = await db
    .schema("edu").from("training_sessions")
    .select("id, run_id, title, subject, file_type, status, chunks_stored, created_at, completed_at")
    .eq("teacher_id", req.params.teacherId)
    .order("created_at", { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ sessions: data });
});

// GET /training/profile/:teacherId
router.get("/profile/:teacherId", async (req, res) => {
  if (req.params.teacherId !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorised" });
  const { data, error } = await db
    .schema("edu").from("teacher_profiles").select("*")
    .eq("teacher_id", req.params.teacherId).maybeSingle();
  if (error) return res.status(404).json({ error: "Profile not found" });
  res.json({ profile: data });
});

// GET /training/orchestration/:agentId
router.get("/orchestration/:agentId", async (req, res) => {
  const { data, error } = await db
    .schema("edu").from("agent_orchestration_config").select("*")
    .eq("agent_id", req.params.agentId).maybeSingle();
  if (error) return res.status(404).json({ error: "Orchestration config not found" });
  res.json({ config: data });
});

// GET /training/chunks/:teacherId
router.get("/chunks/:teacherId", async (req, res) => {
  if (req.params.teacherId !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorised" });
  const { q, limit = 5 } = req.query;
  if (!q) return res.status(400).json({ error: "q is required" });
  try {
    const embedding = await embed(q);
    const chunks    = await retrieveChunks(req.params.teacherId, embedding, Number(limit));
    res.json({ chunks });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /training/session/:sessionId
router.delete("/session/:sessionId", async (req, res) => {
  const teacherId = req.user.id;
  const { data: session } = await db.schema("edu").from("training_sessions")
    .select("teacher_id, file_path").eq("id", req.params.sessionId).single();
  if (!session || (session.teacher_id !== teacherId && req.user.role !== "admin"))
    return res.status(403).json({ error: "Not authorised" });
  if (session.file_path) await db.storage.from("training-assets").remove([session.file_path]);
  await db.schema("edu").from("training_chunks").delete().eq("session_id", req.params.sessionId);
  await db.schema("edu").from("training_sessions").delete().eq("id", req.params.sessionId);
  res.json({ deleted: true });
});

export default router;
