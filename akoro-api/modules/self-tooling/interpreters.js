/**
 * modules/self-tooling/interpreters.js — validate and run the two built-tool
 * forms (plan §7.5–7.6). A definition is DATA: nothing here evaluates code.
 *
 * SPEC (stage 2) — one Data View:
 *   { kind:"spec", from, where?, compute?, group?, sort?, limit?, select? }
 * RECIPE (stage 1, compose) — up to 4 steps (views or capabilities), then ops:
 *   { kind:"recipe", steps:[{ id, view, where? } | { id, cap, args?, rows }],
 *     then:[{ op:"from", ref } | { op:"save", as } | { op:"join", right, on, type? } |
 *           { op:"filter"|"compute"|"group"|"sort"|"limit"|"pick"|"rename"|"dedupe", … }] }
 *   from: the current rows become a step's (or saved table's) rows.
 *   save: name the current rows so a later join can use them.
 *   join: current rows (or `left`) ⋈ `right` on keys.
 */
import { DATA_VIEWS } from "./views.js";
import { CAPABILITIES } from "./capabilities.js";
import { capabilityStatus } from "./registry.js";
import { readView } from "./viewRuntime.js";
import { bind, refsIn, paramProps } from "./bind.js";
import * as O from "./ops.js";

const { ToolError, valid } = O;
const MAX_STEPS = 4, MAX_THEN = 14;
const OUT_OPS = new Set(["filter", "compute", "group", "sort", "limit", "pick", "rename", "dedupe"]);

function checkWhere(errors, where, fields, label) {
  if (where == null) return;
  if (!Array.isArray(where)) return errors.push(`${label}: where must be a list`);
  for (const w of where) {
    if (!w || typeof w !== "object") { errors.push(`${label}: bad filter`); continue; }
    if (fields && !(w.field in fields)) errors.push(`${label}: unknown field ${w.field}`);
    if (!valid.op(w.op)) errors.push(`${label}: unknown filter op ${w.op}`);
    if (w.op === "within" && typeof w.value === "string" && !w.value.startsWith("$") && O.withinMs(w.value) == null) errors.push(`${label}: within needs e.g. "30d"`);
  }
}
function checkOp(errors, o, label, fields) {
  switch (o.op) {
    case "filter": return checkWhere(errors, o.where, fields, label);
    case "compute":
      if (!o.as || !valid.fn(o.fn)) errors.push(`${label}: compute needs as + fn (${o.fn})`);
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
  for (const k of ["sum", "avg", "min", "max", "fields", "on"]) if (o[k] != null) o[k] = asList(o[k]);
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
  if (def.group && typeof def.group === "object") { def.group.by = asList(def.group.by) || []; for (const k of ["sum", "avg", "min", "max"]) if (def.group[k] != null) def.group[k] = asList(def.group[k]); }
  if (def.compute != null) def.compute = asList(def.compute);
  if (def.sort != null) def.sort = asList(def.sort);
  if (typeof def.select === "string") def.select = [def.select];
  if (Array.isArray(def.steps)) for (const st of def.steps) if (st && st.where != null) st.where = asList(st.where);
  if (Array.isArray(def.then)) def.then.forEach(normOp);
  return def;
}

/**
 * Follow which fields the rows carry through the ops, so a filter, sort or
 * pick on a field that isn't there (a hard-coded template name, a field
 * dropped by a group) fails validation instead of quietly returning nothing.
 * `cur` is a Set of field names, or null when unknown (capability rows).
 */
function flowOp(errors, o, cur, label) {
  const need = (f, what) => { if (cur && typeof f === "string" && !f.startsWith("$") && !cur.has(f)) errors.push(`${label}: ${what} ${f} isn't a field here (have: ${[...cur].join(", ")})`); };
  switch (o.op) {
    case "filter": for (const w of [].concat(o.where || [])) need(w?.field, "filter field"); return cur;
    case "compute": need(o.a, "compute input"); if (o.fn !== "round") need(o.b, "compute input"); return cur && o.as ? new Set([...cur, o.as]) : cur;
    case "group": {
      const by = [].concat(o.by || []).map((b) => (typeof b === "string" ? { field: b } : b || {}));
      by.forEach((b) => need(b.field, "group field"));
      for (const k of ["sum", "avg", "min", "max"]) for (const f of [].concat(o[k] || [])) need(f, `${k} field`);
      return new Set([...by.map((b) => (b.bucket ? `${b.field}_${b.bucket}` : b.field)), ...(o.count ? ["count"] : []),
        ...["sum", "avg", "min", "max"].flatMap((k) => [].concat(o[k] || []).map((f) => `${k}_${f}`))]);
    }
    case "sort": need(o.by, "sort field"); return cur;
    case "pick": for (const f of [].concat(o.fields || [])) need(f, "pick field"); return new Set([].concat(o.fields || []));
    case "rename": need(o.from, "rename field"); return cur ? new Set([...[...cur].filter((f) => f !== o.from), o.to]) : cur;
    case "dedupe": for (const f of [].concat(o.fields || [])) need(f, "dedupe field"); return cur;
    default: return cur;
  }
}

/** → { ok, errors, uses: { views:[], capabilities:[] } } */
export async function validateDefinition(def, params) {
  const errors = [];
  const uses = { views: [], capabilities: [] };
  if (!def || typeof def !== "object") return { ok: false, errors: ["definition must be an object"], uses };
  normalizeDefinition(def);
  if (JSON.stringify(def).length > 8000) errors.push("definition too large");
  checkRefs(errors, def, params);

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
      let cur = new Set(Object.keys(fields));
      for (const c of [].concat(def.compute || [])) cur = flowOp(errors, { op: "compute", ...c }, cur, "spec.compute");
      if (def.group) cur = flowOp(errors, { op: "group", ...def.group }, cur, "spec.group");
      for (const st of [].concat(def.sort || [])) flowOp(errors, { op: "sort", ...st }, cur, "spec.sort");
      if (Array.isArray(def.select)) flowOp(errors, { op: "pick", fields: def.select }, cur, "spec.select");
    }
  } else if (def.kind === "recipe") {
    const steps = Array.isArray(def.steps) ? def.steps : [];
    if (!steps.length || steps.length > MAX_STEPS) errors.push(`recipe needs 1–${MAX_STEPS} steps`);
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
        const status = await capabilityStatus(st.cap);
        if (status !== "enabled") errors.push(`step ${st.id}: capability ${st.cap} needs approval`);
        if (cap.kind !== "read") errors.push(`step ${st.id}: ${st.cap} changes data — tools are read-only for now`);
        uses.capabilities.push(st.cap);
        if (st.rows != null && typeof st.rows !== "string") errors.push(`step ${st.id}: rows is a path like "weak_topics"`);
      } else errors.push(`step ${st.id}: needs view or cap`);
    }
    const then = Array.isArray(def.then) ? def.then : [];
    if (then.length > MAX_THEN) errors.push(`at most ${MAX_THEN} then-ops`);
    const tables = new Map(steps.filter((st) => st?.id).map((st) => [st.id, st.view && DATA_VIEWS[st.view] ? new Set(Object.keys(DATA_VIEWS[st.view].fields)) : null]));
    let cur = steps.length === 1 ? tables.get(steps[0]?.id) ?? null : null;
    const used = new Set(steps.length === 1 ? [steps[0]?.id] : []);
    const union = (a, b) => (a && b ? new Set([...a, ...b]) : null);
    for (const [i, o] of then.entries()) {
      if (!o || typeof o !== "object") continue;
      if (o.op === "from") { used.add(o.ref); cur = tables.get(o.ref) ?? null; }
      else if (o.op === "save") { if (o.as) tables.set(o.as, cur); }
      else if (o.op === "join") { used.add(o.right); if (o.left) used.add(o.left); cur = union(o.left ? tables.get(o.left) : cur, tables.get(o.right)); }
      else if (OUT_OPS.has(o.op)) cur = flowOp(errors, o, cur, `then[${i}]`);
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
      else errors.push(`${label}: unknown op ${o?.op}`);
    }
  } else errors.push(`kind must be "spec" or "recipe" (got ${def.kind})`);
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
const pathGet = (obj, path) => (path ? String(path).split(".").reduce((o, k) => (o == null ? o : o[k]), obj) : obj);

/**
 * Run a validated definition for a learner. `callCapability(tool, args)` runs
 * an existing learner tool as that learner (injected: chat.js executeChatTool).
 * → { rows, total, truncated }
 */
export async function runDefinition(def, input, { learnerId, callCapability }) {
  const d = bind(normalizeDefinition(def), input);
  let rows;
  if (d.kind === "spec") {
    rows = await readView(d.from, learnerId, { where: d.where || [] });
    rows = O.filter(rows, d.where || []);
    for (const c of [].concat(d.compute || [])) rows = O.compute(rows, c);
    if (d.group) rows = O.group(rows, d.group);
    for (const s of [].concat(d.sort || [])) rows = O.sort(rows, s);
    if (Array.isArray(d.select) && d.select.length) rows = O.pick(rows, { fields: d.select });
    if (d.limit) rows = O.limit(rows, { n: d.limit });
  } else {
    const out = {};
    for (const st of d.steps) {
      if (st.view) out[st.id] = O.filter(await readView(st.view, learnerId, { where: st.where || [] }), st.where || []);
      else {
        const cap = CAPABILITIES[st.cap];
        const res = await callCapability(cap.tool, st.args || {});
        if (res?.error) throw new ToolError(`${st.cap} failed: ${res.error}`);
        const got = pathGet(res, st.rows);
        out[st.id] = Array.isArray(got) ? got : got == null ? [] : [got];
      }
    }
    rows = d.steps.length === 1 ? out[d.steps[0].id] : null;
    for (const o of d.then || []) {
      if (o.op === "from") rows = out[o.ref];
      else if (o.op === "save") { out[o.as] = rows || []; }
      else if (o.op === "join") rows = O.join(o.left ? out[o.left] : rows || [], out[o.right], o);
      else rows = applyOp(rows || [], o);
      if (rows.length > O.MAX_ROWS) throw new ToolError("too many rows");
    }
    rows = rows || [];
  }
  const total = rows.length;
  return { rows: rows.slice(0, O.MAX_OUT), total, truncated: total > O.MAX_OUT };
}
