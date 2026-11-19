/**
 * modules/school/mgmt-store.js — every Supabase query for the Management +
 * Facilities & Services API lives behind these helpers.
 *
 * No Express import. The service layer supplies plain filter descriptors and
 * result options; the query chain is built here, against the `mgmt` schema or
 * the public schema for the few cross-schema reads (school_profiles,
 * school_teachers, users).
 */

import db from "../../db.js";

export const mgmt = () => db.schema("mgmt");

function tableFor(table, schema) {
  return schema === "public" ? db.from(table) : mgmt().from(table);
}

// A filter is [op, column, value] or ["not", column, operator, value].
function applyFilters(q, filters = []) {
  for (const f of filters) {
    const [op, col, ...rest] = f;
    switch (op) {
      case "eq": q = q.eq(col, rest[0]); break;
      case "neq": q = q.neq(col, rest[0]); break;
      case "in": q = q.in(col, rest[0]); break;
      case "is": q = q.is(col, rest[0]); break;
      case "not": q = q.not(col, rest[0], rest[1]); break;
      case "gte": q = q.gte(col, rest[0]); break;
      case "lte": q = q.lte(col, rest[0]); break;
      case "gt": q = q.gt(col, rest[0]); break;
      default: throw new Error(`Unknown mgmt filter op: ${op}`);
    }
  }
  return q;
}

export function select(table, {
  schema = "mgmt", columns = "*", filters = [], orderBy, asc = false,
  limit, count, head = false, single = false, maybeSingle = false,
} = {}) {
  let q = tableFor(table, schema).select(columns, count ? { count, head } : undefined);
  q = applyFilters(q, filters);
  if (orderBy) {
    const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
    for (const o of orders) {
      if (Array.isArray(o)) q = q.order(o[0], { ascending: o[1] });
      else q = q.order(o, { ascending: asc });
    }
  }
  if (limit != null) q = q.limit(limit);
  if (single) q = q.single();
  else if (maybeSingle) q = q.maybeSingle();
  return q;
}

export async function countRows(table, schoolId, filters = []) {
  const { count } = await select(table, {
    columns: "id", count: "exact", head: true,
    filters: schoolId == null ? filters : [["eq", "school_id", schoolId], ...filters],
  });
  return count || 0;
}

export function insert(table, rows, { schema = "mgmt", columns, single = false } = {}) {
  let q = tableFor(table, schema).insert(rows);
  if (columns) q = q.select(columns);
  if (single) q = q.single();
  return q;
}

export function update(table, patch, filters = [], { schema = "mgmt", columns, single = false } = {}) {
  let q = tableFor(table, schema).update(patch);
  q = applyFilters(q, filters);
  if (columns) q = q.select(columns);
  if (single) q = q.single();
  return q;
}

export function remove(table, filters = [], { schema = "mgmt" } = {}) {
  let q = tableFor(table, schema).delete();
  return applyFilters(q, filters);
}

export function upsert(table, rows, { schema = "mgmt", onConflict } = {}) {
  const base = tableFor(table, schema);
  return onConflict ? base.upsert(rows, { onConflict }) : base.upsert(rows);
}

// Attach `<key minus _id>_name` labels to list rows from cfg.refs. A ref may be
// [table, labelColumn] or [table, rowLabelFn, "public"] for unscoped lookups.
export async function attachRefs(cfg, rows, schoolId) {
  if (!cfg.refs || !rows.length) return rows;
  for (const [key, ref] of Object.entries(cfg.refs)) {
    const [table, label, schema] = ref;              // schema 'public' → unscoped lookup (e.g. users)
    const ids = [...new Set(rows.map((r) => r[key]).filter(Boolean))];
    if (!ids.length) continue;
    const cols = typeof label === "function" ? "*" : `id, ${label}`;
    let q = (schema === "public" ? db.from(table) : mgmt().from(table)).select(cols).in("id", ids);
    if (schema !== "public") q = q.eq("school_id", schoolId);
    const { data } = await q;
    const nameOf = Object.fromEntries((data || []).map((r) => [r.id, typeof label === "function" ? label(r) : r[label]]));
    const outKey = key.replace(/_id$/, "") + "_name";
    for (const row of rows) row[outKey] = row[key] ? (nameOf[row[key]] ?? null) : null;
  }
  return rows;
}
