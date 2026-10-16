/**
 * modules/self-tooling/pipeline.js — create_tool and the learner-tool runtime
 * (plan §7.4, §7.9, §7.10). Phase S2: stages 1 (recipe) and 2 (spec);
 * sandboxed code (S5) and admin escalation (S3) come later.
 *
 *   createTool  → { status: created|rejected, … }   one call in, one status out
 *   runLearnerTool / learnerToolDefs / listMyTools / setMyToolStatus
 */
import db from "../../db.js";
import { schemaLookup, capabilityStatus } from "./registry.js";
import { forbiddenFor, CAPABILITIES } from "./capabilities.js";
import { DATA_VIEWS } from "./views.js";
import { validateDefinition, runDefinition } from "./interpreters.js";
import { validateParams, coerceInput, paramProps } from "./bind.js";
import { buildDefinition, registrySlice } from "./builder.js";
import { createExpect, repeatVerdict } from "../verify/assertions.js";

const edu = () => db.schema("edu");
const NAME = /^[a-z][a-z0-9_]{2,47}$/;
export const LIMITS = {
  dailyCreates: Math.max(1, Number(process.env.SELF_TOOLING_DAILY_CREATES) || 5),
  maxTools: Math.max(1, Number(process.env.SELF_TOOLING_MAX_TOOLS) || 20),
  inCatalogue: 8,
  runMs: 3_000,
  builderCalls: 5,
};

const reject = (reason, extra = {}) => ({ status: "rejected", reason, ...extra });

async function logEvent(row) {
  const { error } = await edu().from("self_tool_events").insert(row);
  if (error) console.warn("[self-tooling] event not logged:", error.message);
}

/** Run a definition once, timed; never throws. */
async function tryRun(def, params, input, ctx) {
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
async function verifyTool(def, params, samples, ctx) {
  const sink = [];
  const expect = createExpect(sink);
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
  return { verdict: repeatVerdict({ assertions: sink }), assertions: sink, runs, emptyEverywhere: runs.every((r) => r.ok && !r.rows.length) };
}

/** create_tool (§7.1). `builtIn`: names of built-in tools (never shadowed). */
export async function createTool({ learnerId, input, dry = false, builtIn = new Set(), callCapability }) {
  const t0 = Date.now();
  const goal = String(input?.goal || "").trim().slice(0, 300);
  const name = String(input?.name || "").trim();
  const label = String(input?.label || "").trim().slice(0, 60);
  const params = input?.params && typeof input.params === "object" ? paramProps(input.params) : {};
  const hint = input?.hint && typeof input.hint === "object" ? input.hint : {};
  const ev = { user_id: learnerId, goal: goal || "(none)", stages_tried: [], capabilities: [], builder_calls: 0 };
  const finish = async (outcome, out) => {
    await logEvent({ ...ev, outcome: dry && outcome === "created" ? "dry" : outcome, reason: out.reason || null, ms: Date.now() - t0 });
    return out;
  };

  // ── 0. validate ───────────────────────────────────────────────────────
  if (goal.length < 3) return reject("Say what the tool should do (goal).");
  if (!NAME.test(name)) return reject("name must be snake_case, 3–48 characters, starting with a letter.");
  if (builtIn.has(name)) return reject(`"${name}" is an existing tool — use it instead.`);
  if (label.length < 2) return reject("Give the tool a learner-facing label.");
  const pErr = validateParams(params);
  if (pErr.length) return reject(`params: ${pErr.join("; ")}`);
  const forbidden = forbiddenFor(goal);
  if (forbidden.length) return finish("rejected", reject(`Not allowed: ${forbidden.map((f) => f.description).join(" ")}`));

  if (!dry) {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    // Tools saved in the last day, any status (a learner deleting a tool archives it, so it still counts).
    const { count: today } = await edu().from("agent_tools").select("*", { count: "exact", head: true })
      .eq("owner_id", learnerId).gte("created_at", since);
    if ((today || 0) >= LIMITS.dailyCreates) return finish("rejected", reject(`You can build ${LIMITS.dailyCreates} tools a day — try again tomorrow, or reuse one you have.`));
    const { data: mine } = await edu().from("agent_tools").select("name").eq("owner_id", learnerId).in("status", ["active", "disabled"]).limit(LIMITS.maxTools + 1);
    if ((mine || []).some((t) => t.name === name)) return reject(`You already have a tool called ${name} — call it, or pick another name.`);
    if ((mine || []).length >= LIMITS.maxTools) return finish("rejected", reject(`You have ${LIMITS.maxTools} tools — delete one in Settings → Agent → My tools first.`));
  }

  // What could it use?
  const lookup = await schemaLookup(goal);
  const slice = registrySlice(lookup, hint);
  const locked = (lookup.capabilities || []).filter((c) => c.status === "needs_approval").map((c) => c.name);
  if (!slice.views.length && !slice.capabilities.length) {
    return finish("rejected", reject(locked.length
      ? `This needs a permission that isn't on yet (${locked.join(", ")}). Asking an admin for it is coming soon.`
      : "Nothing available matches this goal, so it can't be built.", locked.length ? { needsApproval: locked } : {}));
  }

  // ── 1. recipe, 2. spec ─────────────────────────────────────────────────
  const order = hint.mode === "spec" ? ["spec", "recipe"] : ["recipe", "spec"];
  const ctx = { learnerId, callCapability };
  let lastProblem = null;
  for (const stage of order) {
    ev.stages_tried.push(stage);
    let feedback = null;
    let fallback = null;   // a verified build that returned nothing for every sample — kept if the repair is no better
    for (let attempt = 1; attempt <= 3 && ev.builder_calls < LIMITS.builderCalls; attempt++) {
      ev.builder_calls++;
      let built;
      try { built = await buildDefinition({ stage, goal, params, slice, feedback, learnerId, platformPays: dry }); }
      catch (e) {
        if (/coin|balance/i.test(String(e?.message))) return finish("rejected", reject("Not enough coins to build a tool."));
        lastProblem = `builder failed: ${e.message}`; break;
      }
      if (built.notExpressible) { lastProblem = built.notExpressible; break; }
      if (!built.definition) { feedback = built.error || "no definition"; lastProblem = feedback; continue; }
      if (built.definition.kind !== stage) built.definition.kind = stage === "spec" && built.definition.from ? "spec" : built.definition.kind;
      const v = await validateDefinition(built.definition, params);
      if (!v.ok) { feedback = v.errors.slice(0, 6).join("; "); lastProblem = feedback; continue; }
      const check = await verifyTool(built.definition, params, built.samples || [], ctx);
      if (check.verdict !== "PASS") {
        feedback = check.assertions.filter((a) => !a.passed).map((a) => `${a.name}: ${a.actual ?? ""}`).join("; ");
        lastProblem = feedback; continue;
      }
      if (check.emptyEverywhere && attempt === 1) {
        fallback = { built, v, check };
        feedback = "every sample returned no rows — check the filters (this learner does have data)";
        lastProblem = feedback;
        continue;
      }
      return register({ stage, built, v, check });
    }
    if (fallback) return register({ stage, ...fallback });
  }
  return finish("rejected", reject(`Couldn't build it safely: ${String(lastProblem || "no stage could express it").slice(0, 240)}`));

  async function register({ stage, built, v, check }) {
    ev.mode = stage;
    ev.capabilities = v.uses.capabilities;
    const verification = { verdict: check.verdict, at: new Date().toISOString(),
      assertions: check.assertions.map((a) => ({ name: a.name, passed: a.passed })), samples: built.samples || [] };
    const runNow = await tryRun(built.definition, params, input?.run && typeof input.run === "object" ? input.run : (built.samples || [])[0] || {}, ctx);
    const def = { name, label, goal, mode: stage, definition: built.definition, params_schema: params,
      capabilities: v.uses.capabilities, views: [...new Set(v.uses.views)], verification };
    if (dry) {
      await finish("created", {});
      return { status: "created", dryRun: true, tool: name, label, mode: stage, verified: true, definition: built.definition,
        result: runNow.ok ? { rows: runNow.rows, total: runNow.total, truncated: runNow.truncated } : { error: runNow.error },
        note: "DRY RUN — the tool was built and verified but NOT saved. Answer the learner from `result`." };
    }
    const { data: row, error } = await edu().from("agent_tools").insert({ owner_id: learnerId, scope: "learner", ...def, usage_count: runNow.ok ? 1 : 0, last_used_at: new Date().toISOString() }).select("id").single();
    if (error) return finish("failed", reject(`Couldn't save the tool: ${error.message}`));
    ev.tool_id = row.id;
    await finish("created", {});
    return {
      status: "created", tool: name, label, mode: stage, verified: true,
      result: runNow.ok ? { rows: runNow.rows, total: runNow.total, truncated: runNow.truncated } : { error: runNow.error },
      note: `Saved as the learner's tool "${label}". \`result\` is its answer for this request — use it now. Next time, call ${name} directly.`,
      __newTool: toolDef(def),
    };
  }
}

/** A saved tool as an OpenAI function. */
export function toolDef(t) {
  const props = Object.fromEntries(Object.entries(paramProps(t.params_schema)).map(([k, p]) => [k, {
    ...(Array.isArray(p.enum) ? { type: typeof p.enum[0] === "number" ? "number" : "string", enum: p.enum } : { type: p.type }),
    ...(p.description ? { description: String(p.description).slice(0, 200) } : {}),
  }]));
  return { type: "function", function: { name: t.name, description: `${t.label} — ${t.goal} (a tool the learner's agent built; read-only)`, parameters: { type: "object", properties: props, required: [] } } };
}

/** The learner's saved tools for the catalogue (most recently used first). */
export async function learnerToolDefs(learnerId) {
  const { data } = await edu().from("agent_tools").select("name, label, goal, params_schema")
    .eq("owner_id", learnerId).eq("status", "active").order("last_used_at", { ascending: false, nullsFirst: false }).limit(LIMITS.inCatalogue);
  return (data || []).map(toolDef);
}

/** Run a saved tool. → result, or null when `name` isn't one of the learner's tools. */
export async function runLearnerTool(name, input, learnerId, { callCapability }) {
  if (!NAME.test(String(name || ""))) return null;
  const { data: t } = await edu().from("agent_tools").select("*").eq("owner_id", learnerId).eq("name", name).in("status", ["active", "disabled"]).maybeSingle();
  if (!t) return null;
  if (t.status !== "active") return { error: "This tool is turned off — rebuild it or turn it back on in Settings → Agent → My tools." };
  // Re-check on EVERY call: a revoked grant or removed view takes effect at once (§7.10).
  for (const c of t.capabilities || []) {
    if ((await capabilityStatus(c)) !== "enabled" || CAPABILITIES[c]?.kind !== "read") return { error: "This tool uses something that's no longer allowed, so it can't run." };
  }
  for (const v of t.views || []) if (!DATA_VIEWS[v]) return { error: "This tool uses data that's no longer available." };
  const r = await tryRun(t.definition, t.params_schema, input || {}, { learnerId, callCapability });
  const fail = r.ok ? 0 : (t.fail_streak || 0) + 1;
  await edu().from("agent_tools").update({
    usage_count: (t.usage_count || 0) + 1, last_used_at: new Date().toISOString(), fail_streak: fail,
    ...(fail >= 3 ? { status: "disabled" } : {}), updated_at: new Date().toISOString(),
  }).eq("id", t.id);
  if (!r.ok) return { error: fail >= 3 ? "This tool failed three times in a row and was turned off — rebuild it." : `The tool couldn't run: ${r.error}` };
  return { tool: t.label, rows: r.rows, total: r.total, truncated: r.truncated };
}

export async function listMyTools(learnerId) {
  const { data, error } = await edu().from("agent_tools").select("id, name, label, goal, mode, status, usage_count, last_used_at, created_at")
    .eq("owner_id", learnerId).in("status", ["active", "disabled"]).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error("Couldn't load your tools");
  return data || [];
}

export async function updateMyTool(learnerId, id, patch) {
  const allowed = {};
  if (typeof patch?.label === "string" && patch.label.trim().length >= 2) allowed.label = patch.label.trim().slice(0, 60);
  if (["active", "disabled"].includes(patch?.status)) allowed.status = patch.status;
  if (patch?.delete === true) allowed.status = "archived";
  if (!Object.keys(allowed).length) throw Object.assign(new Error("Nothing to change"), { status: 400 });
  const { data, error } = await edu().from("agent_tools").update({ ...allowed, updated_at: new Date().toISOString(), ...(allowed.status !== "active" ? { fail_streak: 0 } : {}) })
    .eq("owner_id", learnerId).eq("id", id).in("status", ["active", "disabled"]).select("id, name, label, status").maybeSingle();
  if (error) throw new Error("Couldn't update the tool");
  if (!data) throw Object.assign(new Error("Tool not found"), { status: 404 });
  return data;
}
