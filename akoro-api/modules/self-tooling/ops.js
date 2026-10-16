/**
 * modules/self-tooling/ops.js — the only data operations a created tool can
 * perform (plan §7.5–7.6). Pure functions over arrays of plain rows: no I/O,
 * no expressions, no loops the tool can write. Shared by recipes and specs.
 *
 *   filter  where: [{ field, op, value }]   op: eq neq lt lte gt gte in contains startsWith isNull notNull within year month
 *   compute { as, fn, a, b }                fn: divide multiply add subtract round percent minutesBetween daysBetween
 *   group   { by: [field | {field, bucket}], count?, sum?, avg?, min?, max? }   bucket: day week month year
 *   sort    { by, dir }        limit { n }        pick { fields }        rename { from, to }
 *   join    { left, right, on: [keys], type: inner|left }
 *   dedupe  { fields }
 */
export const MAX_ROWS = 2000;
export const MAX_OUT = 100;
const OPS = new Set(["eq", "neq", "lt", "lte", "gt", "gte", "in", "contains", "startsWith", "isNull", "notNull", "within", "year", "month"]);
const FNS = new Set(["divide", "multiply", "add", "subtract", "round", "percent", "minutesBetween", "daysBetween"]);
const BUCKETS = new Set(["day", "week", "month", "year"]);

export class ToolError extends Error {
  constructor(message) { super(message); this.name = "ToolError"; }
}

/** "30d" | "12h" | "2w" | "6m" → ms ago; else null. */
export function withinMs(v) {
  const m = /^(\d{1,4})\s*(h|d|w|m|y)$/i.exec(String(v || "").trim());
  if (!m) return null;
  const n = Number(m[1]), unit = m[2].toLowerCase();
  return n * { h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000, m: 30 * 86_400_000, y: 365 * 86_400_000 }[unit];
}

const num = (v) => (v == null || v === "" ? null : Number(v));
const cmp = (a, b) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && typeof a !== "string") return na - nb;
  const ta = Date.parse(a), tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb) && /\d{4}-\d{2}-\d{2}/.test(String(a))) return ta - tb;
  return String(a).localeCompare(String(b));
};

export function matches(row, { field, op, value }) {
  const v = row[field];
  switch (op) {
    case "eq": return typeof v === "string" && typeof value === "string" ? v.toLowerCase() === value.toLowerCase() : v == value; // eslint-disable-line eqeqeq
    case "neq": return typeof v === "string" && typeof value === "string" ? v.toLowerCase() !== value.toLowerCase() : v != value; // eslint-disable-line eqeqeq
    case "lt": return v != null && cmp(v, value) < 0;
    case "lte": return v != null && cmp(v, value) <= 0;
    case "gt": return v != null && cmp(v, value) > 0;
    case "gte": return v != null && cmp(v, value) >= 0;
    case "in": return Array.isArray(value) && value.some((x) => (typeof x === "string" && typeof v === "string" ? x.toLowerCase() === v.toLowerCase() : x == v)); // eslint-disable-line eqeqeq
    case "contains": return v != null && String(v).toLowerCase().includes(String(value).toLowerCase());
    case "startsWith": return v != null && String(v).toLowerCase().startsWith(String(value).toLowerCase());
    case "isNull": return v == null;
    case "notNull": return v != null;
    case "within": { const ms = withinMs(value); return ms != null && v != null && Date.parse(v) >= Date.now() - ms; }
    // Calendar periods (UTC): year 2026 | "this"; month "2026-03" | "this".
    case "year": { const t = Date.parse(v); return Number.isFinite(t) && new Date(t).getUTCFullYear() === (value === "this" ? new Date().getUTCFullYear() : Number(value)); }
    case "month": { const t = Date.parse(v); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 7) === (value === "this" ? new Date().toISOString().slice(0, 7) : String(value)); }
    default: throw new ToolError(`unknown filter op ${op}`);
  }
}

export const filter = (rows, where = []) => rows.filter((r) => where.every((w) => matches(r, w)));

export function compute(rows, { as, fn, a, b }) {
  const val = (row, x) => (typeof x === "string" ? row[x] : x);
  return rows.map((r) => {
    const x = val(r, a), y = val(r, b);
    let out = null;
    switch (fn) {
      case "divide": out = num(y) ? num(x) / num(y) : null; break;
      case "multiply": out = num(x) != null && num(y) != null ? num(x) * num(y) : null; break;
      case "add": out = num(x) != null && num(y) != null ? num(x) + num(y) : null; break;
      case "subtract": out = num(x) != null && num(y) != null ? num(x) - num(y) : null; break;
      case "round": out = num(x) != null ? Math.round(num(x) * 10 ** (Number(b) || 0)) / 10 ** (Number(b) || 0) : null; break;
      case "percent": out = num(y) ? Math.round((num(x) / num(y)) * 1000) / 10 : null; break;
      case "minutesBetween": { const t1 = Date.parse(x), t2 = Date.parse(y); out = Number.isFinite(t1) && Number.isFinite(t2) ? Math.round((t2 - t1) / 60_000) : null; break; }
      case "daysBetween": { const t1 = Date.parse(x), t2 = Date.parse(y); out = Number.isFinite(t1) && Number.isFinite(t2) ? Math.round((t2 - t1) / 86_400_000) : null; break; }
      default: throw new ToolError(`unknown compute fn ${fn}`);
    }
    return { ...r, [as]: Number.isFinite(out) ? out : null };
  });
}

export function bucketOf(v, bucket) {
  const t = new Date(v);
  if (!Number.isFinite(t.getTime())) return null;
  const y = t.getUTCFullYear(), mo = String(t.getUTCMonth() + 1).padStart(2, "0"), d = String(t.getUTCDate()).padStart(2, "0");
  if (bucket === "year") return String(y);
  if (bucket === "month") return `${y}-${mo}`;
  if (bucket === "day") return `${y}-${mo}-${d}`;
  // ISO week start (Monday)
  const day = (t.getUTCDay() + 6) % 7;
  const mon = new Date(Date.UTC(y, t.getUTCMonth(), t.getUTCDate() - day));
  return `week of ${mon.toISOString().slice(0, 10)}`;
}

export function group(rows, { by = [], count = false, sum = [], avg = [], min = [], max = [] }) {
  const keys = by.map((b) => (typeof b === "string" ? { field: b } : b));
  const map = new Map();
  for (const r of rows) {
    const k = keys.map(({ field, bucket }) => (bucket ? bucketOf(r[field], bucket) : r[field] ?? null));
    const id = JSON.stringify(k);
    if (!map.has(id)) map.set(id, { key: k, rows: [] });
    map.get(id).rows.push(r);
  }
  const out = [];
  for (const { key, rows: rs } of map.values()) {
    const g = {};
    keys.forEach(({ field, bucket }, i) => { g[bucket ? `${field}_${bucket}` : field] = key[i]; });
    if (count) g.count = rs.length;
    for (const f of sum) g[`sum_${f}`] = rs.reduce((n, r) => n + (num(r[f]) || 0), 0);
    for (const f of avg) { const xs = rs.map((r) => num(r[f])).filter((x) => x != null); g[`avg_${f}`] = xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : null; }
    for (const f of min) g[`min_${f}`] = rs.map((r) => r[f]).filter((x) => x != null).sort(cmp)[0] ?? null;
    for (const f of max) g[`max_${f}`] = rs.map((r) => r[f]).filter((x) => x != null).sort(cmp).at(-1) ?? null;
    out.push(g);
  }
  return out;
}

export const sort = (rows, { by, dir = "asc" }) => [...rows].sort((a, b) => (dir === "desc" ? -cmp(a[by], b[by]) : cmp(a[by], b[by])));
export const limit = (rows, { n }) => rows.slice(0, Math.min(MAX_OUT, Math.max(1, Number(n) || MAX_OUT)));
// pick keeps a write target's private _ref (S6) so a write step after it still knows which row.
export const pick = (rows, { fields }) => rows.map((r) => Object.fromEntries([...fields.filter((f) => f in r).map((f) => [f, r[f]]), ...("_ref" in r ? [["_ref", r._ref]] : [])]));
/** Remove the private _ref before rows leave the server. */
export const stripRefs = (rows) => rows.map((r) => { if (!r || typeof r !== "object" || !("_ref" in r)) return r; const { _ref, ...rest } = r; return rest; });
export const rename = (rows, { from, to }) => rows.map((r) => { const { [from]: v, ...rest } = r; return { ...rest, [to]: v }; });
export function dedupe(rows, { fields }) {
  const seen = new Set();
  return rows.filter((r) => { const k = JSON.stringify(fields.map((f) => r[f])); if (seen.has(k)) return false; seen.add(k); return true; });
}
export function join(left, right, { on, type = "inner" }) {
  const key = (r) => JSON.stringify(on.map((k) => (typeof r[k] === "string" ? r[k].toLowerCase() : r[k])));
  const idx = new Map();
  for (const r of right) { const k = key(r); if (!idx.has(k)) idx.set(k, []); idx.get(k).push(r); }
  const out = [];
  for (const l of left) {
    const hits = idx.get(key(l));
    if (hits) for (const r of hits) out.push({ ...r, ...l, ...Object.fromEntries(Object.entries(r).filter(([k]) => !(k in l)).map(([k, v]) => [k, v])) });
    else if (type === "left") out.push({ ...l });
    if (out.length > MAX_ROWS) throw new ToolError("the join produced too many rows");
  }
  return out;
}

/** Shape checks shared by recipe/spec validators. */
export const valid = {
  op: (op) => OPS.has(op),
  fn: (fn) => FNS.has(fn),
  bucket: (b) => BUCKETS.has(b),
};
