/**
 * modules/verify/context.js — what a scenario can use.
 *
 * DRIVE the system only through its public paths (HTTP loopback as an
 * account, the real Agent Chat route) and OBSERVE it through a separate read
 * path (ctx.db reads, tool records, logs) — never through the code under
 * test's own claims (plan rule 32).
 *
 *   ctx.as(handle)            resolve an account; policy-checked for this run
 *   ctx.http(req)             one API request as an account (or anonymous), recorded
 *   ctx.agent.chat(req)       one real Agent Chat turn as a learner (dry unless live allowed)
 *   ctx.agent.tool(req)       one learner tool, directly
 *   ctx.db.rows/count         read-only evidence queries
 *   ctx.health()              /health (build SHA, redis quota, …)
 *   ctx.expect.*              assertions (assertions.js)
 *   ctx.cleanup(fn)           undo for a write; always runs
 *   ctx.note(text)            a line in the evidence
 */
import db from "../../db.js";
import { signInternalAccess } from "../auth/routes.js";
import { runDry } from "../../lib/dryRunContext.js";
import { readLogs, logSeq } from "../../lib/logTap.js";
import { createExpect, BlockedError } from "./assertions.js";
import { resolveAccount, assertMayActAs, PolicyError } from "./policy.js";
import { redact } from "./evidence.js";

const API_BASE = process.env.INTERNAL_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
let chatMod = null;
const chat = async () => (chatMod ||= await import("../adaptive-learning/chat.js"));

const table = (name) => {
  const [schema, t] = name.includes(".") ? name.split(".") : ["public", name];
  return schema === "public" ? db.from(t) : db.schema(schema).from(t);
};

export function createContext({ scenario, sink, evidence, realUsers, runId = "local" }) {
  // Everything a write scenario creates carries this, so leftovers are findable.
  const marker = `[verify:${String(runId).slice(0, 8)}]`;
  const accounts = new Map();
  const cleanups = [];
  const risk = scenario.risk;

  const as = async (handle) => {
    const key = String(handle || "").trim().toLowerCase();
    if (accounts.has(key)) return accounts.get(key);
    const acct = await resolveAccount(handle);
    assertMayActAs(acct, risk);
    if (!acct.tester) realUsers.add(acct.id);
    accounts.set(key, acct);
    evidence.accounts.push({ username: acct.username, role: acct.role, tester: acct.tester });
    return acct;
  };
  const realUser = () => realUsers.size > 0;

  async function http({ as: who = null, method = "GET", path, body, headers = {}, role } = {}) {
    if (!path || !path.startsWith("/")) throw new Error("ctx.http needs a path starting with /");
    const acct = who ? await as(who) : null;
    if (acct && method !== "GET" && risk === "read") throw new PolicyError(`A read scenario can't ${method} ${path}.`);
    if (acct && !acct.tester && method !== "GET") throw new PolicyError("Real users are read-only to the gate.");
    const h = { "Content-Type": "application/json", ...headers };
    if (acct) h.Authorization = `Bearer ${signInternalAccess({ id: acct.id, role: role || acct.role }, 300)}`;
    const t0 = Date.now();
    let status = 0, resBody = null, resHeaders = {};
    try {
      const r = await fetch(`${API_BASE}${path}`, { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      status = r.status;
      resHeaders = Object.fromEntries([...r.headers.entries()].filter(([k]) => /^ratelimit|^x-ratelimit|^content-type$|^retry-after$/i.test(k)));
      const text = await r.text();
      try { resBody = JSON.parse(text); } catch { resBody = text.slice(0, 2000); }
    } catch (e) {
      throw new BlockedError(`API unreachable at ${API_BASE}: ${e.message}`);
    }
    const out = { status, body: resBody, headers: resHeaders, ms: Date.now() - t0 };
    evidence.http.push({ method, path, as: acct?.username || null, status, ms: out.ms, headers: resHeaders,
      request: redact(body ?? null, { realUser: realUser() }), response: redact(resBody, { realUser: realUser() }) });
    return out;
  }

  async function agentChat({ as: who, prompt, mode = "dry", history = [], model } = {}) {
    const acct = await as(who);
    const live = mode === "live";
    if (live && risk !== "write") throw new PolicyError("A live agent turn changes data — only write scenarios may use it.");
    if (live && !acct.tester) throw new PolicyError("Real users are read-only to the gate.");
    const key = process.env.AGENT_CONSOLE_KEY;
    const fromSeq = logSeq();
    const t0 = Date.now();
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signInternalAccess({ id: acct.id, role: acct.role || "student" }, 600)}`,
      "x-agent-console-inspect": key,
      ...(live ? {} : { "x-agent-console-dry": key }),
    };
    let status = 0, body = null;
    try {
      // No conversationId: nothing is saved to the account's chats (real users: rule 35).
      const r = await fetch(`${API_BASE}/api/adaptive/chat/agent`, {
        method: "POST", headers,
        body: JSON.stringify({ message: prompt, history, ...(model ? { model } : {}) }),
      });
      status = r.status;
      body = await r.json().catch(() => null);
    } catch (e) {
      throw new BlockedError(`Agent Chat unreachable: ${e.message}`);
    }
    if (status === 402 || /coins|balance/i.test(String(body?.error || "")) && status >= 400) throw new BlockedError(`The account can't pay for an agent turn: ${body?.error || status}`);
    if (status >= 500) throw new BlockedError(`Agent Chat answered ${status}: ${body?.error || "server error"}`);
    const turn = {
      status, mode: live ? "live" : "dry",
      reply: body?.reply ?? body?.response ?? null,
      tools: (body?.toolExecutions || []).map((x) => ({ tool: x.tool, success: x.success, input: x.input ?? null, result: x.result ?? null, sideEffecting: !!x.sideEffecting })),
      error: status >= 400 ? (body?.error || `HTTP ${status}`) : null,
      ms: Date.now() - t0,
    };
    evidence.agent.push({ as: acct.username, prompt, mode: turn.mode, status, ms: turn.ms,
      tools: redact(turn.tools, { realUser: !acct.tester }), reply: redact(turn.reply, { realUser: !acct.tester }) });
    evidence.logs.push(...readLogs({ since: fromSeq, limit: 200 }).lines.map((l) => redact(l, { realUser: realUser() })));
    return turn;
  }

  async function agentTool({ as: who, tool, input = {}, mode = "dry" } = {}) {
    const acct = await as(who);
    const live = mode === "live";
    if (live && (risk !== "write" || !acct.tester)) throw new PolicyError("Live tool calls are for write scenarios on test learners only.");
    const { executeChatTool, getLearnerChatTools } = await chat();
    if (!getLearnerChatTools().some((t) => t.name === tool)) throw new BlockedError(`"${tool}" isn't an enabled learner tool on this server.`);
    const t0 = Date.now();
    const go = () => executeChatTool(tool, input, acct.id, { role: "student", channel: "verify" });
    let result;
    try { result = live ? await go() : await runDry(go); } catch (e) { result = { threw: e.message || String(e) }; }
    evidence.tools.push({ as: acct.username, tool, input: redact(input), mode: live ? "live" : "dry", ms: Date.now() - t0,
      ok: !(result?.error || result?.threw), result: redact(result, { realUser: !acct.tester }) });
    return result;
  }

  const dbApi = {
    /** Read rows (evidence). `filters`: { col: value } equality, or { col: { in: [...] } }. */
    async rows(name, filters = {}, { columns = "*", limit = 200, order } = {}) {
      let q = table(name).select(columns);
      for (const [k, v] of Object.entries(filters)) q = v && typeof v === "object" && Array.isArray(v.in) ? q.in(k, v.in) : q.eq(k, v);
      if (order) q = q.order(order.column, { ascending: !!order.ascending });
      const { data, error } = await q.limit(limit);
      if (error) throw new BlockedError(`Evidence query on ${name} failed: ${error.message}`);
      evidence.db.push({ table: name, filters: redact(filters), rows: (data || []).length });
      return data || [];
    },
    /**
     * Cleanup only: delete rows a write scenario created. The owner must be a
     * TEST learner acting in this run, and at least one narrowing filter
     * besides the owner is required — this can never sweep an account.
     */
    async deleteOwned(name, { ownerColumn, ownerId, filters = {} }) {
      if (risk !== "write") throw new PolicyError("Only write scenarios clean up.");
      const owner = [...accounts.values()].find((a) => a.id === ownerId);
      if (!owner?.tester) throw new PolicyError("deleteOwned: the owner isn't a test learner in this run.");
      if (!ownerColumn || !Object.keys(filters).length) throw new PolicyError("deleteOwned needs an owner column and a narrowing filter.");
      let q = table(name).delete().eq(ownerColumn, ownerId);
      for (const [k, v] of Object.entries(filters)) q = v && typeof v === "object" && v.like ? q.like(k, v.like) : q.eq(k, v);
      const { data, error } = await q.select("*");
      if (error) throw new Error(`cleanup on ${name} failed: ${error.message}`);
      evidence.db.push({ table: name, cleanup: true, deleted: (data || []).length });
      return (data || []).length;
    },
    /** Does a select of these columns work on the live database? → { ok, error } (never throws). */
    async probe(name, columns) {
      const { error } = await table(name).select(columns).limit(1);
      evidence.db.push({ table: name, probe: columns, ok: !error, ...(error ? { error: error.message } : {}) });
      return { ok: !error, error: error?.message || null };
    },
    async count(name, filters = {}) {
      let q = table(name).select("*", { count: "exact", head: true });
      for (const [k, v] of Object.entries(filters)) {
        q = v && typeof v === "object" && Array.isArray(v.in) ? q.in(k, v.in) : v && typeof v === "object" && v.like ? q.like(k, v.like) : q.eq(k, v);
      }
      const { count, error } = await q;
      if (error) throw new BlockedError(`Evidence count on ${name} failed: ${error.message}`);
      evidence.db.push({ table: name, filters: redact(filters), count });
      return count ?? 0;
    },
  };

  /** Poll until fn() returns a truthy value, or give up after timeoutMs. */
  async function until(fn, { timeoutMs = 90_000, everyMs = 3_000 } = {}) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() + everyMs > end) return null;
      await new Promise((r) => setTimeout(r, everyMs));
    }
  }

  return {
    scenario: scenario.name,
    marker, until,
    as, http,
    agent: { chat: agentChat, tool: agentTool },
    db: dbApi,
    health: () => http({ path: "/health" }),
    expect: createExpect(sink),
    cleanup: (fn) => { if (typeof fn === "function") cleanups.push(fn); },
    note: (text) => evidence.notes.push(String(text).slice(0, 500)),
    async runCleanups() {
      const failures = [];
      for (const fn of cleanups.reverse()) {
        try { await fn(); } catch (e) { failures.push(e.message || String(e)); }
      }
      return failures;
    },
  };
}
