#!/usr/bin/env node
/**
 * The Verification Gate as an MCP server (plan phase V3) — stdio, no
 * dependencies. Any MCP client (Claude Code, Claude Desktop, …) gets the gate
 * as tools:
 *
 *   gate_status      which build and target the gate tests, sandbox state
 *   gate_scenarios   scenarios and suites (name, risk, params)
 *   gate_run         run a scenario or suite and wait for the verdict
 *   gate_get_run     one run's verdict, failed assertions and evidence
 *
 * Env:  AKORO_GATE_URL   e.g. https://api.akoro.name.ng   (no /api/verify)
 *       AKORO_GATE_KEY   the gate key (AGENT_CONSOLE_KEY on the server)
 *
 * Claude Code:  claude mcp add akoro-gate -e AKORO_GATE_URL=… -e AKORO_GATE_KEY=… -- node akoro-api/scripts/verify/mcp-server.mjs
 */
import { createInterface } from "node:readline";

const BASE = String(process.env.AKORO_GATE_URL || "").replace(/\/+$/, "");
const KEY = process.env.AKORO_GATE_KEY || "";
const VERSION = "1.0.0";

async function gate(method, path, body) {
  if (!BASE || !KEY) throw new Error("Set AKORO_GATE_URL and AKORO_GATE_KEY for the gate MCP server.");
  const r = await fetch(`${BASE}/api/verify${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 202) throw new Error(json?.error || `gate answered ${r.status}`);
  return json;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A run's essentials — the full evidence stays one gate_get_run away. */
const summary = (run) => ({
  id: run.id, name: run.name, verdict: run.verdict, status: run.status, reason: run.reason, sha: run.sha, target: run.target,
  verified: run.verdict === "PASS",
  scenarios: (run.scenarios || []).map((s) => ({ name: s.name, verdict: s.verdict, repeats: s.repeats, reason: s.reason,
    failed: (s.failed || []).slice(0, 8).map((a) => ({ name: a.name, expected: a.expected, actual: a.actual, repeat: a.repeat })) })),
});

const TOOLS = [
  { name: "gate_status", description: "Which build (git sha) and target the Akoro Verification Gate tests, whether writes are allowed, and the sandbox state.",
    inputSchema: { type: "object", properties: {} },
    run: async () => { const d = (await gate("GET", "/scenarios")).data; return { target: d.target, sha: d.sha, writesAllowed: d.writesAllowed, runsGoTo: d.runsGoTo, sandbox: d.sandbox }; } },
  { name: "gate_scenarios", description: "List the gate's scenarios (name, area, risk, params) and suites.",
    inputSchema: { type: "object", properties: {} },
    run: async () => ({ scenarios: (await gate("GET", "/scenarios")).data.scenarios, suites: (await gate("GET", "/suites")).data }) },
  { name: "gate_run", description: "Run a gate scenario or suite and wait for the verdict (PASS · FAIL · BLOCKED · ERROR · INCONCLUSIVE — only PASS means verified). Pass expectSha (the commit you pushed) so a stale deploy says BLOCKED instead of testing old code.",
    inputSchema: { type: "object", properties: {
      scenario: { type: "string" }, suite: { type: "string" }, params: { type: "object" },
      expectSha: { type: "string", description: "git sha the server must be running" },
      target: { type: "string", enum: ["default", "production"], description: "production = run on this API even when the sandbox is on" },
      maxWaitSeconds: { type: "number", description: "default 540" },
    } },
    run: async (a) => {
      if (!a.scenario === !a.suite) throw new Error("Pass exactly one of scenario or suite.");
      const started = (await gate("POST", "/runs", { scenario: a.scenario, suite: a.suite, params: a.params || {}, expectSha: a.expectSha, wait: false, actor: "mcp",
        ...(a.target === "production" ? { target: "production" } : {}) })).data;
      const deadline = Date.now() + Math.min(900, Math.max(10, Number(a.maxWaitSeconds) || 540)) * 1000;
      let run = started;
      while (run.status !== "done" && Date.now() < deadline) {
        await sleep(5000);
        run = (await gate("GET", `/runs/${started.id}`)).data;
      }
      return run.status === "done" ? summary(run) : { id: started.id, status: run.status, note: "Still running — call gate_get_run with this id." };
    } },
  { name: "gate_get_run", description: "One gate run by id: verdict, failed assertions, and (full=true) the evidence.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, full: { type: "boolean" } }, required: ["id"] },
    run: async (a) => { const run = (await gate("GET", `/runs/${encodeURIComponent(a.id)}`)).data; return a.full ? run : summary(run); } },
];

// ── minimal MCP over stdio (JSON-RPC 2.0, one message per line) ─────────
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  const reply = (result) => id !== undefined && send({ id, result });
  const fail = (code, message) => id !== undefined && send({ id, error: { code, message } });
  try {
    if (method === "initialize") {
      return reply({ protocolVersion: params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "akoro-gate", version: VERSION } });
    }
    if (method === "notifications/initialized" || method?.startsWith("notifications/")) return;
    if (method === "ping") return reply({});
    if (method === "tools/list") return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
    if (method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(-32602, `Unknown tool ${params?.name}`);
      try {
        const out = await tool.run(params?.arguments || {});
        return reply({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: `Gate error: ${e.message}` }], isError: true });
      }
    }
    return fail(-32601, `Method not found: ${method}`);
  } catch (e) {
    return fail(-32603, e.message);
  }
});
