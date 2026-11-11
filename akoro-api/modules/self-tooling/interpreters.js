/**
 * modules/self-tooling/interpreters.js — validate and run the two built-tool
 * forms (plan §7.5–7.6). A definition is DATA: nothing here evaluates code.
 *
 * SPEC (stage 2) — one Data View:
 *   { kind:"spec", from, where?, compute?, group?, sort?, limit?, select? }
 * CODE (stage 3, flag AKORO_SELF_TOOLING_CODE_ENABLED, on unless "false") — declared reads + one
 *   sandboxed function: { kind:"code", steps:[…as recipe…], source:"function run(input, data, akoro) {…}" }
 *   (sandbox/index.js — data in, answer out; the code never calls Akoro)
 * RECIPE (stage 1, compose) — up to 4 steps (views or capabilities), then ops:
 *   { kind:"recipe", steps:[{ id, view, where? } | { id, cap, args?, rows }],
 *     then:[{ op:"from", ref } | { op:"save", as } | { op:"join", right, on, type? } |
 *           { op:"filter"|"compute"|"group"|"sort"|"limit"|"pick"|"rename"|"dedupe", … }] }
 *   from: the current rows become a step's (or saved table's) rows.
 *   save: name the current rows so a later join can use them.
 *   join: current rows (or `left`) ⋈ `right` on keys.
 */
import { DATA_VIEWS, audienceOf } from "./views.js";
import { CAPABILITIES, capAudience } from "./capabilities.js";
import { CAP_RUNNERS } from "./capRuntime.js";
import { runCode, staticCheck, asRows, codeEnabled } from "./sandbox/index.js";
import { capabilityStatus } from "./registry.js";
import { readView } from "./viewRuntime.js";
import { bind, refsIn, paramProps } from "./bind.js";
import * as O from "./ops.js";
import { checkArgs, resolveArgs } from "./writeArgs.js";

const { ToolError, valid } = O;
const MAX_STEPS = 4, MAX_THEN = 14;
const OUT_OPS = new Set(["filter", "compute", "group", "sort", "limit", "pick", "rename", "dedupe"]);

function checkWhere(errors, where, fields, label) {
  if (where == null) return;
  if (!Array.isArray(where)) return errors.push(`${label}: where must be a list`);
  for (const w of where) {
    if (!w || typeof w !== "object") { errors.push(`${label}: bad filter`); continue; }
    if (fields && !(w.field in fields)) errors.push(`${label}: unknown field ${w.field}`);
    if (!valid.op(w.op)) errors.push(`${label}: unknown filter op ${typeof w.op === "string" ? w.op : JSON.stringify(w.op)} — op is one name, e.g. {"field":"started_at","op":"year","value":"this"}`);
    if (w.op === "within" && !(typeof w.value === "string" && (w.value.startsWith("$") || O.withinMs(w.value) != null))) errors.push(`${label}: within needs a duration like "30d" (for a calendar year use op "year")`);
    if ((w.op === "year" || w.op === "month") && !(w.value === "this" || typeof w.value === "number" || (typeof w.value === "string" && (w.value.startsWith("$") || /^\d{4}(-\d{2})?$/.test(w.value))))) errors.push(`${label}: ${w.op} needs "this", a number or a "$param"`);
    if ((w.op === "isNull" || w.op === "notNull") && w.value != null && w.value !== true) errors.push(`${label}: ${w.op} takes no value (to keep rows that HAVE ${w.field}, use notNull)`);
    if (w.value && typeof w.value === "object" && !Array.isArray(w.value)) errors.push(`${label}: a filter value is a plain value or "$param", not an object`);
  }
}
function checkOp(errors, o, label, fields) {
  switch (o.op) {
    case "filter": return checkWhere(errors, o.where, fields, label);
    case "compute":
      if (!o.as || !valid.fn(o.fn)) errors.push(`${label}: compute needs as + fn (${o.fn})`);
      for (const x of [o.a, o.b]) if (x != null && typeof x !== "string" && typeof x !== "number") errors.push(`${label}: compute a/b are field names or numbers — nest by adding another compute step`);
      return;
    case "group":
      if (!Array.isArray(o.by)) errors.push(`${label}: group.by must be a list`);
      for (const b of [].concat(o.by || [])) if (b && typeof b === "object" && b.bucket && !valid.bucket(b.bucket)) errors.push(`${label}: bucket ${b.bucket}`);
      return;
    case "sort": if (!o.by) errors.push(`${label}: sort.by`); return;
    case "limit": if (!(Number(o.n) > 0)) errors.push(`${label}: limit.n`); return;
    case "pick": if (!Array.isArray(o.fields) || !o.fields.length) errors.push(`${label}: pick.fields`); return;
    case "rename": if (!o.from || !o.to) errors.push(`${label}: rename from/to`); return;
    case "dedupe": if (!Array.isArray(o.fields)) errors.push(`${label}: dedupe.fields`); return;
    default: errors.push(`${label}: unknown op ${o.op}`);
  }
}
function checkRefs(errors, def, params) {
  const declared = new Set(Object.keys(paramProps(params)));
  for (const r of refsIn(def)) if (!declared.has(r)) errors.push(`$${r} is not a declared param`);
}

const asList = (x) => (x == null ? x : Array.isArray(x) ? x : [x]);
function normOp(o) {
  if (!o || typeof o !== "object") return o;
  if (o.where != null) o.where = asList(o.where);
  if (o.op === "group") o.by = asList(o.by) || [];
  for (const k of ["sum", "avg", "min", "max", "counts", "fields", "on"]) if (o[k] != null) o[k] = asList(o[k]);
  return o;
}
/**
 * The builder model often writes one item where a list belongs (group.by as
 * a single {field, bucket}, sum as one field name). Wrap those in lists, in
 * place, so validation and running see one shape. Idempotent.
 */
export function normalizeDefinition(def) {
  if (!def || typeof def !== "object") return def;
  if (def.where != null) def.where = asList(def.where);
  if (def.group && typeof def.group === "object") { def.group.by = asList(def.group.by) || []; for (const k of ["sum", "avg", "min", "max", "counts"]) if (def.group[k] != null) def.group[k] = asList(def.group[k]); }
  if (def.compute != null) def.compute = asList(def.compute);
  if (def.sort != null) def.sort = asList(def.sort);
  if (typeof def.select === "string") def.select = [def.select];
  if (Array.isArray(def.steps)) for (const st of def.steps) if (st && st.where != null) st.where = asList(st.where);
  if (Array.isArray(def.then)) def.then.forEach(normOp);
  return def;
}

/**
 * Follow which fields — and their types — the rows carry through the ops, so
 * a filter, sort or pick on a field that isn't there (a hard-coded template
 * name, a field dropped by a group) or a sum of timestamps fails validation
 * instead of quietly returning nothing. `cur` is a Map name → type ("number",
 * "integer", "string", "timestamp", "date", "boolean", or null when unknown),
 * or null when the fields themselves are unknown (capability rows).
 */
const NUMERIC = new Set(["number", "integer"]);
const viewTypes = (view) => new Map(Object.entries(view.fields).map(([k, f]) => [k, f.type]));
function flowOp(errors, o, cur, label) {
  const need = (f, what) => {
    if (cur && typeof f === "string" && !f.startsWith("$") && !cur.has(f)) {
      errors.push(`${label}: ${what} ${f} isn't a field here (have: ${[...cur.keys()].join(", ")})${/^count_/.test(f) ? ' — "count" counts every row; to count rows that have a value, group with counts: ["<field>"] (gives count_<field>)' : ""}`);
    }
  };
  const needNum = (f, what) => { need(f, what); const t = cur?.get(f); if (t && !NUMERIC.has(t)) errors.push(`${label}: ${what} ${f} is a ${t}, not a number${t === "timestamp" ? " — use compute minutesBetween first" : ""}`); };
  switch (o.op) {
    case "filter": for (const w of [].concat(o.where || [])) need(w?.field, "filter field"); return cur;
    case "compute": {
      const timeFn = o.fn === "minutesBetween" || o.fn === "daysBetween";
      (timeFn ? need : needNum)(o.a, "compute input");
      if (o.fn !== "round" && typeof o.b === "string") (timeFn ? need : needNum)(o.b, "compute input");
      return cur && o.as ? new Map([...cur, [o.as, "number"]]) : cur;
    }
    case "group": {
      const by = [].concat(o.by || []).map((b) => (typeof b === "string" ? { field: b } : b || {}));
      by.forEach((b) => need(b.field, "group field"));
      for (const k of ["sum", "avg"]) for (const f of [].concat(o[k] || [])) needNum(f, `${k} field`);
      for (const k of ["min", "max", "counts"]) for (const f of [].concat(o[k] || [])) need(f, `${k} field`);
      return new Map([
        ...[].concat(o.counts || []).map((f) => [`count_${f}`, "integer"]),
        ...by.map((b) => (b.bucket ? [`${b.field}_${b.bucket}`, "string"] : [b.field, cur?.get(b.field) ?? null])),
        ...(o.count ? [["count", "integer"]] : []),
        ...["sum", "avg"].flatMap((k) => [].concat(o[k] || []).map((f) => [`${k}_${f}`, "number"])),
        ...["min", "max"].flatMap((k) => [].concat(o[k] || []).map((f) => [`${k}_${f}`, cur?.get(f) ?? null])),
      ]);
    }
    case "sort": need(o.by, "sort field"); return cur;
    case "pick": for (const f of [].concat(o.fields || [])) need(f, "pick field"); return cur ? new Map([].concat(o.fields || []).map((f) => [f, cur.get(f) ?? null])) : null;
    case "rename": need(o.from, "rename field"); return cur ? new Map([...[...cur].filter(([f]) => f !== o.from), [o.to, cur.get(o.from) ?? null]]) : cur;
    case "dedupe": for (const f of [].concat(o.fields || [])) need(f, "dedupe field"); return cur;
    default: return cur;
  }
}
/** A string that mixes a param into other text ("$year-$month") never binds — say so. */
function checkMixedRefs(errors, value) {
  if (typeof value === "string") { if (value.includes("$") && !/^\$[a-zA-Z][a-zA-Z0-9_]*$/.test(value)) errors.push(`"${value.slice(0, 40)}": a param must be a whole value ("$name"), not combined with other text`); }
  else if (Array.isArray(value)) value.forEach((v) => checkMixedRefs(errors, v));
  else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => { if (k !== "source") checkMixedRefs(errors, v); });   // code is code, not a param slot
}

export const MAX_WRITE_ROWS = 20;
/**
 * A write step (S6): the LAST op, a write capability that's on (granted),
 * applied to rows that still come from its target view (not grouped). It
 * changes nothing when the tool runs — it proposes; the learner confirms.
 */
async function checkWrite(errors, o, { origin, last, label, uses, learnerId = null, assume = [] }) {
  const cap = CAPABILITIES[o.cap];
  if (!cap) return errors.push(`${label}: unknown capability ${o.cap}`);
  if (cap.kind !== "write" || !cap.target) return errors.push(`${label}: ${o.cap} isn't a write a tool can make`);
  if (!assume.includes(o.cap) && (await capabilityStatus(o.cap, { learnerId })) !== "enabled") errors.push(`${label}: capability ${o.cap} needs approval`);
  if (!last) errors.push(`${label}: write must be the last step`);
  if (origin !== cap.target) errors.push(`${label}: ${o.cap} works on rows from ${cap.target} (filter/sort/pick them; don't group)`);
  for (const e of checkArgs(o.cap, cap, o.args)) errors.push(`${label}: ${e}`);
  uses.capabilities.push(o.cap);
}

/** Validate read steps (views or capabilities). → the set of step ids. */
async function checkSteps(errors, steps, uses, learnerId = null, assume = []) {
  const ids = new Set();
  for (const st of steps) {
    if (!st?.id || !/^[a-z][a-z0-9_]{0,23}$/.test(st.id) || ids.has(st.id)) { errors.push(`step id ${st?.id} invalid or repeated`); continue; }
    ids.add(st.id);
    if (st.view) {
      if (!DATA_VIEWS[st.view]) errors.push(`step ${st.id}: unknown view ${st.view}`); else uses.views.push(st.view);
      checkWhere(errors, st.where, DATA_VIEWS[st.view]?.fields, `step ${st.id}`);
    } else if (st.cap) {
      const cap = CAPABILITIES[st.cap];
      if (!cap) { errors.push(`step ${st.id}: unknown capability ${st.cap}`); continue; }
      const status = assume.includes(st.cap) ? "enabled" : await capabilityStatus(st.cap, { learnerId });
      if (status !== "enabled") errors.push(`step ${st.id}: capability ${st.cap} needs approval`);
      if (cap.kind !== "read") errors.push(cap.target ? `step ${st.id}: ${st.cap} is a change, not a read — read ${cap.target} in a step and end the recipe with {"op":"write","cap":"${st.cap}"}` : `step ${st.id}: ${st.cap} changes data — tools are read-only for now`);
      uses.capabilities.push(st.cap);
      if (st.rows != null && typeof st.rows !== "string") errors.push(`step ${st.id}: rows is a path like "weak_topics"`);
    } else errors.push(`step ${st.id}: needs view or cap`);
  }
  return ids;
}

/** → { ok, errors, uses: { views:[], capabilities:[] } } */
/**
 * `assume`: capabilities to treat as on — a DRAFT built for the learner to
 * approve (it is saved switched off, and only their Approve turns both on).
 */
export async function validateDefinition(def, params, { audience = "learner", learnerId = null, assume = [] } = {}) {
  const errors = [];
  const uses = { views: [], capabilities: [] };
  if (!def || typeof def !== "object") return { ok: false, errors: ["definition must be an object"], uses };
  normalizeDefinition(def);
  if (JSON.stringify(def).length > 8000) errors.push("definition too large");
  checkRefs(errors, def, params);
  checkMixedRefs(errors, def);

  if (def.kind === "spec") {
    const view = DATA_VIEWS[def.from];
    if (!view) errors.push(`unknown view ${def.from}`); else uses.views.push(def.from);
    const fields = view?.fields;
    checkWhere(errors, def.where, fields, "spec");
    for (const c of [].concat(def.compute || [])) checkOp(errors, { op: "compute", ...c }, "spec.compute", fields);
    if (def.group) checkOp(errors, { op: "group", ...def.group }, "spec.group", fields);
    for (const s of [].concat(def.sort || [])) checkOp(errors, { op: "sort", ...s }, "spec.sort", fields);
    if (def.limit != null && !(Number(def.limit) > 0)) errors.push("spec.limit");
    if (def.select != null && !Array.isArray(def.select)) errors.push("spec.select must be a list");
    if (fields) {
      let cur = viewTypes(view);
      for (const c of [].concat(def.compute || [])) cur = flowOp(errors, { op: "compute", ...c }, cur, "spec.compute");
      if (def.group) cur = flowOp(errors, { op: "group", ...def.group }, cur, "spec.group");
      for (const st of [].concat(def.sort || [])) flowOp(errors, { op: "sort", ...st }, cur, "spec.sort");
      if (Array.isArray(def.select)) flowOp(errors, { op: "pick", fields: def.select }, cur, "spec.select");
    }
  } else if (def.kind === "code") {
    // Stage 3: declared reads (same rules as recipe steps) + one sandboxed function.
    if (!codeEnabled()) errors.push("code tools are turned off on this server");
    const steps = Array.isArray(def.steps) ? def.steps : [];
    if (steps.length > MAX_STEPS) errors.push(`at most ${MAX_STEPS} reads`);
    await checkSteps(errors, steps, uses, learnerId, assume);
    if (def.then != null) errors.push("a code tool has no then-ops — do it in the code");
    for (const e of staticCheck(def.source)) errors.push(`code: ${e}`);
  } else if (def.kind === "recipe") {
    const steps = Array.isArray(def.steps) ? def.steps : [];
    if (!steps.length || steps.length > MAX_STEPS) errors.push(`recipe needs 1–${MAX_STEPS} steps`);
    const ids = await checkSteps(errors, steps, uses, learnerId, assume);
    const then = Array.isArray(def.then) ? def.then : [];
    if (then.length > MAX_THEN) errors.push(`at most ${MAX_THEN} then-ops`);
    const tables = new Map(steps.filter((st) => st?.id).map((st) => [st.id, st.view && DATA_VIEWS[st.view] ? viewTypes(DATA_VIEWS[st.view]) : null]));
    let cur = steps.length === 1 ? tables.get(steps[0]?.id) ?? null : null;
    const used = new Set(steps.length === 1 ? [steps[0]?.id] : []);
    const union = (a, b) => (a && b ? new Map([...b, ...a]) : null);
    // Which view the current rows still come from (a write needs its target's rows, ungrouped).
    const origins = new Map(steps.filter((st) => st?.id).map((st) => [st.id, st.view || null]));
    let origin = steps.length === 1 ? steps[0]?.view || null : null;
    for (const [i, o] of then.entries()) {
      if (!o || typeof o !== "object") continue;
      if (o.op === "from") { used.add(o.ref); cur = tables.get(o.ref) ?? null; origin = origins.get(o.ref) ?? null; }
      else if (o.op === "save") { if (o.as) { tables.set(o.as, cur); origins.set(o.as, origin); } }
      else if (o.op === "join") {
        used.add(o.right); if (o.left) used.add(o.left);
        const left = o.left ? tables.get(o.left) : cur, right = tables.get(o.right);
        for (const k of [].concat(o.on || [])) for (const [side, t] of [["left", left], ["right", right]]) if (t && !t.has(k)) errors.push(`then[${i}]: join key ${k} isn't a field of the ${side} rows (have: ${[...t.keys()].join(", ")})`);
        cur = union(left, right);
        if (o.left) origin = origins.get(o.left) ?? null;
      }
      else if (o.op === "write") await checkWrite(errors, o, { origin, last: i === then.length - 1, label: `then[${i}]`, uses, learnerId, assume });
      else if (OUT_OPS.has(o.op)) { cur = flowOp(errors, o, cur, `then[${i}]`); if (o.op === "group") origin = null; }
    }
    for (const st of steps) if (st?.id && !used.has(st.id)) errors.push(`step ${st.id} is never used — remove it`);
    for (const [i, o] of then.entries()) {
      const label = `then[${i}]`;
      if (o?.op === "from") { if (!ids.has(o.ref)) errors.push(`${label}: from unknown step ${o.ref}`); }
      else if (o?.op === "save") { if (!o.as || !/^[a-z][a-z0-9_]{0,23}$/.test(o.as) || ids.has(o.as)) errors.push(`${label}: save.as invalid or taken`); else ids.add(o.as); }
      else if (o?.op === "join") {
        if (!ids.has(o.right)) errors.push(`${label}: join right unknown step ${o.right}`);
        if (o.left && !ids.has(o.left)) errors.push(`${label}: join left unknown step ${o.left}`);
        if (!Array.isArray(o.on) || !o.on.length) errors.push(`${label}: join.on`);
      } else if (OUT_OPS.has(o?.op)) checkOp(errors, o, label, null);
      else if (o?.op !== "write") errors.push(`${label}: unknown op ${o?.op}`);
    }
  } else errors.push(`kind must be "spec", "recipe" or "code" (got ${def.kind})`);
  // One audience per tool (S7): learner tools read learner data, instructor tools instructor data.
  for (const v of new Set(uses.views)) if (DATA_VIEWS[v] && audienceOf(DATA_VIEWS[v]) !== audience) errors.push(`${v} isn't available to ${audience} tools`);
  for (const c of new Set(uses.capabilities)) if (CAPABILITIES[c] && capAudience(CAPABILITIES[c]) !== audience) errors.push(`${c} isn't available to ${audience} tools`);
  return { ok: !errors.length, errors, uses };
}

function applyOp(rows, o) {
  switch (o.op) {
    case "filter": return O.filter(rows, o.where);
    case "compute": return O.compute(rows, o);
    case "group": return O.group(rows, o);
    case "sort": return O.sort(rows, o);
    case "limit": return O.limit(rows, o);
    case "pick": return O.pick(rows, o);
    case "rename": return O.rename(rows, o);
    case "dedupe": return O.dedupe(rows, o);
    default: throw new ToolError(`unknown op ${o.op}`);
  }
}
/** One declared read: a view (the learner's own rows) or a capability's list. */
async function readStep(st, learnerId, callCapability) {
  if (st.view) return O.filter(await readView(st.view, learnerId, { where: st.where || [] }), st.where || []);
  const cap = CAPABILITIES[st.cap];
  const res = cap.runtime ? await CAP_RUNNERS[st.cap](learnerId, st.args || {}).catch((e) => ({ error: e.message })) : await callCapability(cap.tool, st.args || {});
  if (res?.error) throw new ToolError(`${st.cap} failed: ${res.error}`);
  const got = pathGet(res, st.rows);
  return Array.isArray(got) ? got : got == null ? [] : [got];
}
const TIMEZONE = process.env.AKORO_TIMEZONE || "Africa/Lagos";

const pathGet = (obj, path) => (path ? String(path).split(".").reduce((o, k) => (o == null ? o : o[k]), obj) : obj);

/**
 * Run a validated definition for a learner. `callCapability(tool, args)` runs
 * an existing learner tool as that learner (injected: chat.js executeChatTool).
 * → { rows, total, truncated }
 */
/** A filter on an optional param the caller didn't give is skipped, not matched against null. */
export function dropUnsetFilters(value, input) {
  if (Array.isArray(value)) {
    return value.filter((w) => !(w && typeof w === "object" && "field" in w && "op" in w && typeof w.value === "string"
      && /^\$[a-zA-Z][a-zA-Z0-9_]*$/.test(w.value) && input[w.value.slice(1)] == null)).map((v) => dropUnsetFilters(v, input));
  }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, dropUnsetFilters(v, input)]));
  return value;
}

/**
 * The tool's `total`. For a `spec` run we know the source records that matched.
 * For a code/steps run we don't — and a count tool returns ONE aggregate row
 * (e.g. [{ kind: "upload", count: 12 }]), so `rows.length` said "total 1" while
 * the row said 12. When every result row carries a numeric `count`, the total is
 * their sum (the records they count); otherwise it is the row count.
 */
export function resolveTotal(rows, matched = null) {
  if (matched != null) return matched;
  const out = Array.isArray(rows) ? rows : [];
  if (out.length && out.every((r) => r && typeof r.count === "number" && Number.isFinite(r.count))) {
    return Math.round(out.reduce((n, r) => n + r.count, 0));
  }
  return out.length;
}

export async function runDefinition(def, input, { learnerId, callCapability }) {
  const d = bind(dropUnsetFilters(normalizeDefinition(def), input), input);
  let rows;
  let matched = null;   // source records that matched, before group/select/limit
  let write = null;   // a recipe's write step: the change it PROPOSES (S6)
  if (d.kind === "spec") {
    rows = await readView(d.from, learnerId, { where: d.where || [] });
    rows = O.filter(rows, d.where || []);
    matched = rows.length;
    for (const c of [].concat(d.compute || [])) rows = O.compute(rows, c);
    if (d.group) rows = O.group(rows, d.group);
    for (const s of [].concat(d.sort || [])) rows = O.sort(rows, s);
    if (Array.isArray(d.select) && d.select.length) rows = O.pick(rows, { fields: d.select });
    if (d.limit) rows = O.limit(rows, { n: d.limit });
  } else if (d.kind === "code") {
    if (!codeEnabled()) throw new ToolError("code tools are turned off");
    const data = {};
    for (const st of d.steps || []) data[st.id] = await readStep(st, learnerId, callCapability);
    const now = new Date();
    const akoro = { today: now.toLocaleDateString("en-CA", { timeZone: TIMEZONE }), now: now.toISOString(), timezone: TIMEZONE };
    const r = await runCode(d.source, { input, data, akoro });
    if (!r.ok) throw new ToolError(r.error);
    rows = asRows(r.value);
  } else {
    const out = {};
    for (const st of d.steps) {
      out[st.id] = await readStep(st, learnerId, callCapability);
    }
    rows = d.steps.length === 1 ? out[d.steps[0].id] : null;
    for (const o of d.then || []) {
      if (o.op === "from") rows = out[o.ref];
      else if (o.op === "save") { out[o.as] = rows || []; }
      else if (o.op === "join") rows = O.join(o.left ? out[o.left] : rows || [], out[o.right], o);
      else if (o.op === "write") {
        // Propose, never apply: the rows it would change, by private id.
        const cap = CAPABILITIES[o.cap];
        const targets = (rows || []).filter((r) => r?._ref);
        // Its value (a date, a priority) as it will be applied — dates from the learner's today.
        const args = resolveArgs(o.cap, cap, o.args, new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE }));
        write = { cap: o.cap, ...(args ? { args } : {}), does: cap.describe && args ? cap.describe(args) : cap.description, targets: targets.slice(0, MAX_WRITE_ROWS).map((r) => ({ ref: r._ref, label: String(cap.item ? cap.item(r) : r._ref).slice(0, 120) })), more: Math.max(0, targets.length - MAX_WRITE_ROWS) };
        continue;
      }
      else rows = applyOp(rows || [], o);
      if (rows.length > O.MAX_ROWS) throw new ToolError("too many rows");
    }
    rows = rows || [];
  }
  const outRows = Array.isArray(rows) ? rows : [];
  // `total` is the number of records that matched — NOT the number of rows a
  // group produced. A "group by subject" must still total the records, not the
  // subjects; rebuilt tools reported "total 6" for 51 rows because of this.
  const total = resolveTotal(outRows, matched);
  // The private _ref never leaves the server.
  return { rows: O.stripRefs(outRows.slice(0, O.MAX_OUT)), total, truncated: outRows.length > O.MAX_OUT, ...(write ? { write } : {}) };
}
