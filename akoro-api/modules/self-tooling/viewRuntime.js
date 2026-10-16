/**
 * modules/self-tooling/viewRuntime.js — reading a Data View for one learner.
 *
 * Scope is enforced HERE, in code, on every call (rule 26): the owner filter
 * is added before anything else, and every returned row is checked against
 * it again — a row owned by anyone else stops the tool with an error, so a
 * bug in the filter can never become a leak.
 */
import db from "../../db.js";
import { DATA_VIEWS } from "./views.js";
import { ToolError, MAX_ROWS } from "./ops.js";

const PUSHABLE = { eq: "eq", neq: "neq", lt: "lt", lte: "lte", gt: "gt", gte: "gte" };

/** Rows of `viewName` for `learnerId`, flattened to the view's field names. */
export async function readView(viewName, learnerId, { where = [] } = {}) {
  const view = DATA_VIEWS[viewName];
  if (!view) throw new ToolError(`unknown data view ${viewName}`);
  const { schema, table, owner } = view.source;
  const owners = [owner].flat().filter(Boolean);
  const own = Object.entries(view.fields).filter(([, f]) => !f.path).map(([k]) => k);
  const embeds = Object.entries(view.embed || {}).map(([rel, cols]) => `${rel}(${cols.join(",")})`);
  const columns = [...new Set([...own, ...owners])].concat(embeds).join(", ");
  let q = (schema === "public" ? db.from(table) : db.schema(schema).from(table)).select(columns);

  if (view.scope === "self") {
    if (!learnerId) throw new ToolError("no learner");
    q = owners.length === 1 ? q.eq(owners[0], learnerId) : q.or(owners.map((o) => `${o}.eq.${learnerId}`).join(","));
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

  return (data || []).map((row) => {
    if (view.scope === "self" && !owners.some((o) => row[o] === learnerId)) {
      // Defence in depth: never return a row the learner doesn't own.
      throw new ToolError("scope violation");
    }
    const out = {};
    for (const [k, f] of Object.entries(view.fields)) {
      if (f.path) { const [rel, col] = f.path.split("."); const e = Array.isArray(row[rel]) ? row[rel][0] : row[rel]; out[k] = e ? e[col] ?? null : null; }
      else out[k] = row[k] ?? null;
    }
    return out;
  });
}
