/**
 * modules/tasks/tools/dynamic.js
 * Config-only tools — defined as DB rows in `dynamic_tools`, not code.
 *
 * A forward-deployed engineer attaches a tool to a partner by inserting a row;
 * the worker loads it at run time and runs it through a built-in executor.
 * No code change or redeploy required for the common cases.
 *
 * Exports:
 *   buildConfigTool(row)            → { definition, execute, meta }
 *   loadDynamicToolsForUser(userId) → array of built config tools the user can use
 */

import Anthropic        from "@anthropic-ai/sdk";
import db               from "../../../db.js";
import { TaskDB, TaskOutputDB } from "../lib/db.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6";

// Fill {{var}} placeholders in a template string from the tool input.
function fillTemplate(str, vars) {
  if (!str) return "";
  return String(str).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
    vars?.[k] != null ? String(vars[k]) : ""
  );
}

// ─── Executors ────────────────────────────────────────────────────────────────
// Each receives (row, input, ctx) where ctx = { taskId, runId }.

async function runLlmPrompt(row, input, ctx) {
  const cfg    = row.config ?? {};
  const prompt = fillTemplate(cfg.prompt, input);
  if (!prompt.trim()) throw new Error(`Tool "${row.name}" has an empty prompt config`);

  const resp = await anthropic.messages.create({
    model:      cfg.model ?? MODEL,
    max_tokens: cfg.maxTokens ?? 1024,
    ...(cfg.system ? { system: cfg.system } : {}),
    messages:   [{ role: "user", content: prompt }],
  });

  const text = resp.content.filter(b => b.type === "text").map(b => b.text).join("");
  const outputType = cfg.outputType ?? "message";

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType,
    content:    { type: outputType, text, tool: row.name },
    delivered:  false,
  });

  return { success: true, text };
}

async function runNotify(row, input, ctx) {
  const cfg     = row.config ?? {};
  const task    = await TaskDB.findById(ctx.taskId);
  const userId  = cfg.targetUserId ?? task?.creator_id;
  const message = fillTemplate(cfg.messageTemplate ?? "{{message}}", input);

  if (userId) {
    try {
      await db.from("notifications").insert({
        user_id:    userId,
        type:       cfg.notifType ?? "agent",
        title:      cfg.title ?? "Notification",
        content:    message,
        is_read:    false,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn(`[dynamic:${row.name}] notification insert failed:`, err?.message ?? err);
    }
  }

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "reminder",
    content:    { type: "reminder", message, tool: row.name },
    delivered:  false,
  });

  return { success: true };
}

async function runHttpWebhook(row, input, ctx) {
  const cfg = row.config ?? {};
  const url = cfg.url;
  if (!url) throw new Error(`Tool "${row.name}" has no webhook URL configured`);

  const method  = (cfg.method ?? "POST").toUpperCase();
  const headers = { "Content-Type": "application/json", ...(cfg.headers ?? {}) };
  if (cfg.secret) headers["X-Webhook-Secret"] = cfg.secret;

  const body = cfg.payloadTemplate
    ? JSON.parse(fillTemplate(JSON.stringify(cfg.payloadTemplate), input))
    : input;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), (cfg.timeoutMs ?? 10000));

  let responseText = "";
  let status = 0;
  try {
    const resp = await fetch(url, {
      method,
      headers,
      body:   method !== "GET" ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    status = resp.status;
    responseText = await resp.text();
    if (!resp.ok) throw new Error(`Webhook returned ${status}: ${responseText.slice(0, 200)}`);
  } finally {
    clearTimeout(timeout);
  }

  let parsed;
  try { parsed = JSON.parse(responseText); } catch { parsed = { raw: responseText }; }

  const outputType = cfg.outputType ?? "message";
  const text = cfg.responseField ? (parsed[cfg.responseField] ?? responseText) : responseText;

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType,
    content:    { type: outputType, text: String(text), tool: row.name, webhookStatus: status },
    delivered:  false,
  });

  return { success: true, status, response: parsed };
}

async function runCreateBattle(row, input, ctx) {
  const cfg    = row.config ?? {};
  const task   = await TaskDB.findById(ctx.taskId);
  const userId = task?.creator_id;
  if (!input.opponentId) throw new Error("opponentId is required");

  const now            = Date.now();
  const scheduledStart = new Date(now + 5 * 60 * 1000).toISOString();
  const expiresAt      = new Date(now + 24 * 60 * 60 * 1000).toISOString();

  const { data: battle, error } = await db.from("battles").insert({
    course_id:          null,
    battle_type:        "1v1",
    title:              `Challenge: ${input.topic ?? cfg.defaultTopic ?? "Quiz"}`,
    description:        fillTemplate(cfg.descriptionTemplate ?? "1v1 battle on {{topic}}", input),
    subject:            input.subject ?? cfg.subject ?? "General",
    difficulty:         input.difficulty ?? cfg.difficulty ?? "medium",
    xp_prize:           cfg.xpPrize ?? 100,
    xp_pool:            cfg.xpPrize ?? 100,
    time_limit_seconds: cfg.timeLimitSeconds ?? 600,
    status:             "scheduled",
    peak_viewers:       0,
    scheduled_start:    scheduledStart,
    expires_at:         expiresAt,
    created_by:         userId ?? null,
  }).select().single();

  if (error) throw new Error(error.message);

  const [{ data: myAgent }, { data: oppAgent }] = await Promise.all([
    db.from("user_agents").select("id").eq("user_id", userId).eq("is_active", true).maybeSingle(),
    db.from("user_agents").select("id").eq("user_id", input.opponentId).eq("is_active", true).maybeSingle(),
  ]);

  await db.from("battle_participants").insert([
    { battle_id: battle.id, user_id: userId,           agent_id: myAgent?.id ?? null,  role: "creator",  score: 0, hp: 100 },
    { battle_id: battle.id, user_id: input.opponentId, agent_id: oppAgent?.id ?? null, role: "opponent", score: 0, hp: 100 },
  ]);

  global.io?.to(`user:${input.opponentId}`).emit("new_challenge", {
    battleId: battle.id, title: battle.title,
  });

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "battle",
    content:    { type: "battle", battleId: battle.id, topic: input.topic, tool: row.name },
    delivered:  false,
  });

  return { success: true, battleId: battle.id };
}

const EXECUTORS = {
  llm_prompt:    runLlmPrompt,
  notify:        runNotify,
  create_battle: runCreateBattle,
  http_webhook:  runHttpWebhook,
};

// ─── Build a runnable tool from a DB row ────────────────────────────────────────

export function buildConfigTool(row) {
  const definition = {
    name:         row.name,
    description:  row.description,
    input_schema: row.input_schema ?? { type: "object", properties: {} },
  };

  const execute = async (input, ctx) => {
    const fn = EXECUTORS[row.executor];
    if (!fn) throw new Error(`Unknown executor "${row.executor}" for tool "${row.name}"`);
    return fn(row, input ?? {}, ctx);
  };

  return { definition, execute, meta: { dynamic: true, id: row.id, intentKeywords: row.intent_keywords ?? [] } };
}

// ─── Load the tools a given user is entitled to ─────────────────────────────────

export async function loadDynamicToolsForUser(userId) {
  if (!userId) return [];

  // Which schools does this user teach in? (standalone teachers have none)
  const { data: st } = await db
    .from("school_teachers")
    .select("school_id")
    .eq("teacher_id", userId);
  const schoolIds = (st ?? []).map(r => r.school_id).filter(Boolean);

  // global OR owned-by-user OR in-one-of-my-schools
  const ors = ["scope.eq.global", `owner_user_id.eq.${userId}`];
  if (schoolIds.length) ors.push(`school_id.in.(${schoolIds.join(",")})`);

  const { data, error } = await db
    .from("dynamic_tools")
    .select("*")
    .eq("enabled", true)
    .or(ors.join(","));

  if (error) {
    console.warn("[dynamic] load failed:", error.message);
    return [];
  }
  return (data ?? []).map(buildConfigTool);
}
