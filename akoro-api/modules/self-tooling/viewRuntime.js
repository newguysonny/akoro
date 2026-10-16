/**
 * modules/self-tooling/viewRuntime.js — reading a Data View for one learner.
 *
 * Scope is enforced HERE, in code, on every call (rule 26): the owner filter
 * is added before anything else, and every returned row is checked against
 * it again — a row owned by anyone else stops the tool with an error, so a
 * bug in the filter can never become a leak.
 */
import db from "../../db.js";
import { DATA_VIEWS, selectColumns } from "./views.js";
import { ToolError, MAX_ROWS } from "./ops.js";

const PUSHABLE = { eq: "eq", neq: "neq", lt: "lt", lte: "lte", gt: "gt", gte: "gte" };

/** Rows of `viewName` for `learnerId`, flattened to the view's field names. */
export async function readView(viewName, learnerId, { where = [] } = {}) {
  const view = DATA_VIEWS[viewName];
  if (!view) throw new ToolError(`unknown data view ${viewName}`);
  const { schema, table, owner, ownerPath } = view.source;
  const owners = [owner].flat().filter(Boolean);
  const [ownerRel, ownerCol] = String(ownerPath || "").split(".");
  let q = (schema === "public" ? db.from(table) : db.schema(schema).from(table)).select(selectColumns(view));

  if (view.scope === "self") {
    if (!learnerId) throw new ToolError("no learner");
    if (ownerRel) q = q.eq(`${ownerRel}.${ownerCol}`, learnerId);   // owned through a parent row (inner join)
    else q = owners.length === 1 ? q.eq(owners[0], learnerId) : q.or(owners.map((o) => `${o}.eq.${learnerId}`).join(","));
  } else if (view.scope === "public") {
    for (const [k, v] of Object.entries(view.source.where || {})) q = q.eq(k, v);
  } else {
    throw new ToolError(`view ${viewName} has no readable scope`);
  }
  // Push simple filters on the view's OWN columns down to the database (the
  // rest run in memory); values were bound and validated by the caller.
  for (const w of where) {
    const f = view.fields[w.field];
    if (!f || f.path || !PUSHABLE[w.op] || w.value == null || typeof w.value === "object") continue;
    if (f.type === "string") continue;                       // string equality is case-insensitive in memory
    q = q[PUSHABLE[w.op]](w.field, w.value);
  }
  const { data, error } = await q.limit(MAX_ROWS);
  if (error) throw new ToolError(`couldn't read ${viewName}`);

  const rel1 = (row, rel) => (Array.isArray(row[rel]) ? row[rel][0] : row[rel]);
  // Person fields: one lookup for every user id on the page — display name only.
  const personCols = [...new Set(Object.values(view.fields).filter((f) => f.person).map((f) => f.person))];
  const names = new Map();
  if (personCols.length) {
    const ids = [...new Set((data || []).flatMap((row) => personCols.map((c) => row[c])).filter(Boolean))];
    for (let i = 0; i < ids.length; i += 200) {
      const { data: users } = await db.from("users").select("id, full_name, username").in("id", ids.slice(i, i + 200));
      for (const u of users || []) names.set(u.id, u.full_name || u.username || "A student");
    }
  }
  return (data || []).map((row) => {
    const owned = ownerRel ? rel1(row, ownerRel)?.[ownerCol] === learnerId : owners.some((o) => row[o] === learnerId);
    if (view.scope === "self" && !owned) {
      // Defence in depth: never return a row the caller doesn't own.
      throw new ToolError("scope violation");
    }
    const out = {};
    for (const [k, f] of Object.entries(view.fields)) {
      if (f.path) { const [rel, col] = f.path.split("."); const e = rel1(row, rel); out[k] = e ? e[col] ?? null : null; }
      else if (f.person) out[k] = row[f.person] ? names.get(row[f.person]) || "A student" : null;
      else out[k] = row[k] ?? null;
    }
    // A write target's id rides along privately (S6): a write step needs it,
    // and runDefinition strips it before rows reach the model or the learner.
    if (view.ref && row[view.ref] != null) Object.defineProperty(out, "_ref", { value: String(row[view.ref]), enumerable: true, writable: true, configurable: true });
    return out;
  });
}
