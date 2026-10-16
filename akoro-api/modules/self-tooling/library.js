/**
 * modules/self-tooling/library.js — the admin tool library (plan §7.12, phase S4).
 *
 *   listTools / getTool       every built tool, learner and platform
 *   setToolStatus             active | disabled | revoked (audit-logged)
 *   promoteTool               a learner's tool → a platform tool for EVERY
 *                             learner, only after the gate scenario
 *                             selftool.promotion_check PASSes on 3 testers;
 *                             optionally archives the learner copies it replaces
 *   similarTools              near-duplicates (same data, similar goal) — merge
 *                             candidates: promote one, retire the rest
 *   analytics                 how create_tool goals end, what's escalated, usage
 */
import db from "../../db.js";
import { CAPABILITIES } from "./capabilities.js";

const edu = () => db.schema("edu");
const NAME = /^[a-z][a-z0-9_]{2,47}$/;
const LIST_COLUMNS = "id, owner_id, scope, name, label, goal, mode, status, version, capabilities, views, usage_count, fail_streak, last_used_at, promoted_from, created_at, updated_at, verification";

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

async function audit(admin, action, entityId, before, after) {
  const { error } = await db.from("admin_audit_log").insert({
    actor: admin?.id ?? null, actor_label: admin?.label || "admin",
    action, entity_type: "agent_tool", entity_id: entityId, before: before ?? null, after: after ?? null,
  });
  if (error) console.warn("[self-tooling] audit insert failed:", error.message);
}

async function owners(rows) {
  const ids = [...new Set(rows.map((r) => r.owner_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data } = await db.from("users").select("id, full_name, username").in("id", ids);
  return new Map((data || []).map((u) => [u.id, { name: u.full_name || null, username: u.username || null }]));
}

const publicTool = (t, who) => ({
  id: t.id, scope: t.scope, name: t.name, label: t.label, goal: t.goal, mode: t.mode, status: t.status, version: t.version,
  capabilities: t.capabilities || [], views: t.views || [], uses: t.usage_count || 0, failStreak: t.fail_streak || 0,
  lastUsedAt: t.last_used_at, createdAt: t.created_at, promotedFrom: t.promoted_from || null,
  owner: t.owner_id ? (who.get(t.owner_id) || { name: null, username: null }) : null,
  verified: t.verification?.verdict || null, promotion: t.verification?.promotion || null,
});

export async function listTools({ scope, status, mode, search, limit = 50, offset = 0 } = {}) {
  let q = edu().from("agent_tools").select(LIST_COLUMNS, { count: "exact" }).order("created_at", { ascending: false })
    .range(offset, offset + Math.min(100, limit) - 1);
  if (scope === "learner" || scope === "platform") q = q.eq("scope", scope);
  if (["active", "disabled", "revoked", "archived"].includes(status)) q = q.eq("status", status);
  if (["recipe", "spec", "code"].includes(mode)) q = q.eq("mode", mode);
  const term = String(search || "").replace(/[,()%*:\\]/g, " ").trim().slice(0, 80);
  if (term) q = q.or(`label.ilike.%${term}%,goal.ilike.%${term}%,name.ilike.%${term}%`);
  const { data, count, error } = await q;
  if (error) throw new Error(`Couldn't load tools: ${error.message}`);
  const who = await owners(data || []);
  return { tools: (data || []).map((t) => publicTool(t, who)), total: count || 0 };
}

export async function getTool(id) {
  const { data: t, error } = await edu().from("agent_tools").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("Couldn't load the tool");
  if (!t) throw httpError(404, "Tool not found");
  const who = await owners([t]);
  const { data: copies } = await edu().from("agent_tools").select("id, name, status").eq("promoted_from", id);
  return { ...publicTool(t, who), definition: t.definition, params: t.params_schema, verification: t.verification, platformCopies: copies || [] };
}

/** active | disabled | revoked. Revoked is final for the learner (they can't turn it back on). */
export async function setToolStatus({ id, status, admin }) {
  if (!["active", "disabled", "revoked"].includes(status)) throw httpError(422, "status must be active, disabled or revoked");
  const { data: before } = await edu().from("agent_tools").select("id, status").eq("id", id).maybeSingle();
  if (!before) throw httpError(404, "Tool not found");
  if (before.status === "archived") throw httpError(422, "This tool is archived");
  const { data, error } = await edu().from("agent_tools").update({ status, fail_streak: 0, updated_at: new Date().toISOString() })
    .eq("id", id).select("id, status").maybeSingle();
  if (error) throw new Error(`Couldn't update the tool: ${error.message}`);
  await audit(admin, `agent_tool.${status === "active" ? "enable" : status === "disabled" ? "disable" : "revoke"}`, id, { status: before.status }, { status });
  return data;
}

/**
 * Promote a learner tool to everyone. `runGate(toolId)` runs the gate
 * scenario selftool.promotion_check and resolves to the run (injected so this
 * module doesn't import the gate). `builtIn`: names that can never be used.
 */
export async function promoteTool({ id, name, label, goal, replaces = [], admin, runGate, builtIn = new Set() }) {
  const { data: t } = await edu().from("agent_tools").select("*").eq("id", id).maybeSingle();
  if (!t) throw httpError(404, "Tool not found");
  if (t.scope !== "learner") throw httpError(422, "Only a learner's tool can be promoted");
  if (t.status !== "active") throw httpError(422, "Turn the tool on before promoting it");
  const finalName = String(name || t.name).trim();
  if (!NAME.test(finalName)) throw httpError(422, "name must be snake_case, 3–48 characters");
  if (builtIn.has(finalName)) throw httpError(422, `"${finalName}" is a built-in tool name`);
  const { data: clash } = await edu().from("agent_tools").select("id").eq("scope", "platform").eq("name", finalName).in("status", ["active", "disabled"]).maybeSingle();
  if (clash) throw httpError(409, `A platform tool called ${finalName} already exists`);
  for (const c of t.capabilities || []) if (CAPABILITIES[c]?.kind !== "read") throw httpError(422, `Uses ${c}, which isn't a read capability`);

  // The gate decides (plan §9): the tool's samples on three test learners.
  const run = await runGate(id);
  if (run.verdict !== "PASS") {
    await audit(admin, "agent_tool.promote_blocked", id, null, { runId: run.id, verdict: run.verdict, reason: run.reason });
    throw httpError(422, `The promotion check didn't pass (${run.verdict}${run.reason ? `: ${String(run.reason).slice(0, 200)}` : ""}).`, { runId: run.id, verdict: run.verdict });
  }

  const now = new Date().toISOString();
  const { data: row, error } = await edu().from("agent_tools").insert({
    owner_id: null, scope: "platform", name: finalName,
    label: String(label || t.label).trim().slice(0, 60), goal: String(goal || t.goal).trim().slice(0, 300),
    mode: t.mode, definition: t.definition, params_schema: t.params_schema, capabilities: t.capabilities, views: t.views,
    status: "active", version: 1, promoted_from: t.id, usage_count: 0,
    verification: { ...(t.verification || {}), promotion: { runId: run.id, verdict: run.verdict, at: now, by: admin?.label || "admin" } },
    created_at: now, updated_at: now,
  }).select("id, name, label").single();
  if (error) throw new Error(`Couldn't save the platform tool: ${error.message}`);

  // Merge: the learner copies it replaces are retired (their owners now get the platform tool).
  let retired = 0;
  const ids = [...new Set([].concat(replaces || []).filter((x) => typeof x === "string" && x !== t.id))].slice(0, 50);
  if (ids.length) {
    const { data: gone } = await edu().from("agent_tools").update({ status: "archived", updated_at: now })
      .in("id", ids).eq("scope", "learner").in("status", ["active", "disabled"]).select("id");
    retired = (gone || []).length;
  }
  await audit(admin, "agent_tool.promote", row.id, { from: t.id, owner: t.owner_id }, { name: row.name, label: row.label, runId: run.id, retired });
  return { tool: row, runId: run.id, retired };
}

// ── near-duplicates ────────────────────────────────────────────────────

const STOP = new Set(["my", "me", "i", "the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "by", "per", "each", "with", "what", "how", "many", "much", "show", "list", "get", "all", "this", "that", "is", "are", "do", "did", "have", "has"]);
const wordsOf = (s) => new Set((String(s || "").toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !STOP.has(w) && w.length > 1).map((w) => w.replace(/s$/, "")));
export function goalSimilarity(a, b) {
  const A = wordsOf(a), B = wordsOf(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
const dataKey = (t) => `${[...new Set(t.views || [])].sort().join(",")}|${[...new Set(t.capabilities || [])].sort().join(",")}`;

/**
 * Groups of active tools reading the same data with similar goals (≥ 2 tools,
 * at least one a learner's). → [{ key, tools, owners, uses, platformTool }]
 */
export function groupSimilar(tools, threshold = 0.4) {
  const byKey = new Map();
  for (const t of tools) { const k = dataKey(t); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(t); }
  const groups = [];
  for (const [key, list] of byKey) {
    const used = new Set();
    for (let i = 0; i < list.length; i++) {
      if (used.has(i)) continue;
      const g = [list[i]]; used.add(i);
      for (let j = i + 1; j < list.length; j++) {
        if (!used.has(j) && g.some((x) => goalSimilarity(x.goal, list[j].goal) >= threshold)) { g.push(list[j]); used.add(j); }
      }
      if (g.length >= 2 && g.some((x) => x.scope === "learner")) groups.push({ key, tools: g });
    }
  }
  return groups.map((g) => ({
    key: g.key, tools: g.tools,
    owners: new Set(g.tools.filter((t) => t.owner_id).map((t) => t.owner_id)).size,
    uses: g.tools.reduce((n, t) => n + (t.usage_count || 0), 0),
    platformTool: g.tools.find((t) => t.scope === "platform")?.id || null,
  })).sort((a, b) => b.owners - a.owners || b.uses - a.uses);
}

export async function similarTools() {
  const { data, error } = await edu().from("agent_tools").select(LIST_COLUMNS).eq("status", "active").order("usage_count", { ascending: false }).limit(1000);
  if (error) throw new Error("Couldn't load tools");
  const who = await owners(data || []);
  return groupSimilar(data || []).slice(0, 50).map((g) => ({ ...g, tools: g.tools.map((t) => publicTool(t, who)) }));
}

// ── analytics ──────────────────────────────────────────────────────────

const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

/** Pure: summarise create_tool events, requests and tools. Exported for tests. */
export function summarise({ events = [], requests = [], tools = [], days = 30, now = Date.now() }) {
  const by = (xs, f) => xs.reduce((m, x) => { const k = f(x); if (k != null) m[k] = (m[k] || 0) + 1; return m; }, {});
  const created = events.filter((e) => e.outcome === "created");
  const daily = {};
  for (let d = days - 1; d >= 0; d--) daily[new Date(now - d * 86_400_000).toISOString().slice(0, 10)] = { created: 0, escalated: 0, rejected: 0, failed: 0 };
  for (const e of events) { const k = String(e.created_at).slice(0, 10); if (daily[k] && e.outcome in daily[k]) daily[k][e.outcome]++; }
  const reason = (r) => String(r || "").replace(/["“][^"”]*["”]/g, "…").replace(/\d+/g, "#").slice(0, 70);
  const topN = (m, n = 8) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }));
  const capLearners = {};
  for (const r of requests) { (capLearners[r.requested_capability] ||= new Set()).add(r.requester_id); }
  const live = tools.filter((t) => ["active", "disabled"].includes(t.status));
  return {
    days,
    goals: {
      total: events.length,
      byOutcome: by(events, (e) => e.outcome),
      createdByMode: by(created, (e) => e.mode),
      learners: new Set(events.map((e) => e.user_id)).size,
      avgBuilderCalls: created.length ? Math.round((created.reduce((n, e) => n + (e.builder_calls || 0), 0) / created.length) * 10) / 10 : null,
      msP50: pct(events.map((e) => e.ms).filter(Number.isFinite), 0.5),
      msP90: pct(events.map((e) => e.ms).filter(Number.isFinite), 0.9),
      topRejections: topN(by(events.filter((e) => e.outcome === "rejected" || e.outcome === "failed"), (e) => reason(e.reason))),
      daily: Object.entries(daily).map(([date, v]) => ({ date, ...v })),
    },
    requests: {
      byStatus: by(requests, (r) => r.status),
      topCapabilities: Object.entries(capLearners).map(([k, v]) => ({ capability: k, does: CAPABILITIES[k]?.description || null, learners: v.size }))
        .sort((a, b) => b.learners - a.learners).slice(0, 8),
    },
    tools: {
      learner: live.filter((t) => t.scope === "learner").length,
      platform: live.filter((t) => t.scope === "platform").length,
      byStatus: by(tools, (t) => t.status),
      mostUsed: [...live].sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0)).slice(0, 8)
        .map((t) => ({ id: t.id, label: t.label, scope: t.scope, uses: t.usage_count || 0 })),
      failing: live.filter((t) => (t.fail_streak || 0) > 0).slice(0, 8).map((t) => ({ id: t.id, label: t.label, scope: t.scope, failStreak: t.fail_streak })),
    },
  };
}

export async function analytics({ days = 30 } = {}) {
  const d = Math.min(180, Math.max(1, Number(days) || 30));
  const since = new Date(Date.now() - d * 86_400_000).toISOString();
  const [ev, rq, tl] = await Promise.all([
    edu().from("self_tool_events").select("user_id, outcome, mode, builder_calls, ms, reason, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(5000),
    edu().from("agent_tool_requests").select("requester_id, requested_capability, status, created_at").eq("kind", "capability").gte("created_at", since).limit(5000),
    edu().from("agent_tools").select("id, label, scope, status, usage_count, fail_streak").limit(5000),
  ]);
  if (ev.error || rq.error || tl.error) throw new Error("Couldn't load analytics");
  return summarise({ events: (ev.data || []).filter((e) => e.outcome !== "dry"), requests: rq.data || [], tools: tl.data || [], days: d });
}
