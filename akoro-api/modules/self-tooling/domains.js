/**
 * self-tooling/domains.js — curated, DETERMINISTIC domain tools.
 *
 * One tool per data domain, taking { action } sub-params over ONE data view
 * (a mini-RPC). These replace the near-duplicate "count / list / search / by
 * subject" tools the agent used to build one-per-question. Read-only to start:
 * no capabilities, no writes, no cards.
 *
 * Adding a domain or an action = edit this file. The tool is built
 * deterministically (no LLM), EVERY action is verified before it is saved
 * (domain regression), then saved and run. See
 * architecture/akoro-domain-tools(one-tool-per-domain,action-subparams,domain-regression).md
 */

/** Group/count source over a view's rows. Groups by ANY field named in
 *  action="by_<field>", so ADDING AN ACTION is just adding an enum value — the
 *  code already handles it (and every action is re-verified before saving).
 *  Server-side template: the GENERATED source contains no `${...}`. */
function groupSource(stepId, field, listFields, searchField = "name") {
  const picks = listFields.map((f) => `${f}: r.${f}`).join(", ");
  return `function run(input, data, akoro) {
  var rows = data.${stepId} || [];
  var action = String(input.action || "count");
  if (action === "count") return [{ count: rows.length }];
  var agg = /^(sum|avg|min|max)_([a-z_]+)$/.exec(action);
  if (agg) {
    var op = agg[1], f = agg[2], vals = [];
    for (var i = 0; i < rows.length; i++) {
      var raw = rows[i][f];
      if (raw === null || raw === undefined || raw === "") continue;
      var v = Number(raw);
      if (isFinite(v)) vals.push(v);
    }
    if (!vals.length) return [{ op: op, field: f, value: op === "sum" ? 0 : null, n: 0 }];
    var s = 0, mn = vals[0], mx = vals[0];
    for (var z = 0; z < vals.length; z++) { s += vals[z]; if (vals[z] < mn) mn = vals[z]; if (vals[z] > mx) mx = vals[z]; }
    var value = op === "sum" ? s : (op === "avg" ? s / vals.length : (op === "min" ? mn : mx));
    return [{ op: op, field: f, value: value, n: vals.length }];
  }
  if (action === "accuracy") {
    var att = 0, cor = 0;
    for (var a = 0; a < rows.length; a++) {
      att += Number(rows[a].attempted) || 0;
      cor += Number(rows[a].correct) || 0;
    }
    return [{ attempted: att, correct: cor, accuracy: att ? Math.round((cor / att) * 1000) / 10 : null }];
  }
  if (action === "search") {
    var q = String(input.query || "").toLowerCase();
    var out = [];
    if (!q) return out;
    for (var j = 0; j < rows.length; j++) {
      var nm = rows[j].${searchField};
      if (nm != null && String(nm).toLowerCase().indexOf(q) >= 0) out.push({ name: String(nm) });
    }
    return out;
  }
  if (action.indexOf("by_") === 0) {
    var f = action.slice(3);
    var m = {};
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i][f] == null ? "unknown" : String(rows[i][f]);
      m[k] = (m[k] || 0) + 1;
    }
    return Object.keys(m).map(function (k) { var o = {}; o[f] = k; o.count = m[k]; return o; });
  }
  var lim = Number(input.limit) || 100;
  return rows.slice(0, lim).map(function (r) { return { ${picks} }; });
}`;
}

/** Library documents: count / list / by_<field> / search titles. */
function librarySource() {
  return `function run(input, data, akoro) {
  var rows = data.lib || [];
  var action = String(input.action || "count");
  if (action === "count") return [{ count: rows.length }];
  var agg = /^(sum|avg|min|max)_([a-z_]+)$/.exec(action);
  if (agg) {
    var op = agg[1], f = agg[2], vals = [];
    for (var i = 0; i < rows.length; i++) {
      var raw = rows[i][f];
      if (raw === null || raw === undefined || raw === "") continue;
      var v = Number(raw);
      if (isFinite(v)) vals.push(v);
    }
    if (!vals.length) return [{ op: op, field: f, value: op === "sum" ? 0 : null, n: 0 }];
    var s = 0, mn = vals[0], mx = vals[0];
    for (var z = 0; z < vals.length; z++) { s += vals[z]; if (vals[z] < mn) mn = vals[z]; if (vals[z] > mx) mx = vals[z]; }
    var value = op === "sum" ? s : (op === "avg" ? s / vals.length : (op === "min" ? mn : mx));
    return [{ op: op, field: f, value: value, n: vals.length }];
  }
  if (action === "search") {
    var q = String(input.query || "").toLowerCase();
    var out = [];
    if (!q) return out;
    for (var j = 0; j < rows.length; j++) { if (String(rows[j].name || "").toLowerCase().indexOf(q) >= 0) out.push({ name: rows[j].name, kind: rows[j].kind }); }
    return out;
  }
  if (action.indexOf("by_") === 0) {
    var f = action.slice(3);
    var m = {};
    for (var i = 0; i < rows.length; i++) { var k = rows[i][f] == null ? "unknown" : String(rows[i][f]); m[k] = (m[k] || 0) + 1; }
    return Object.keys(m).map(function (k) { var o = {}; o[f] = k; o.count = m[k]; return o; });
  }
  var lim = Number(input.limit) || 100;
  return rows.slice(0, lim).map(function (r) { return { name: r.name, kind: r.kind, added: r.created_at }; });
}`;
}

const ACTION_PARAM = (actions, help) => ({
  type: "string", enum: actions, default: actions[0], description: help,
});

/** One tool stays focused: cap the actions a domain tool can carry. */
export const MAX_DOMAIN_ACTIONS = 8;

export const DOMAINS = {
  library_documents: {
    name: "library_documents",
    label: "Library documents",
    view: "my_library",
    step: "lib",
    actions: ["count", "list", "by_kind", "search"],
    params: {
      action: ACTION_PARAM(["count", "list", "by_kind", "search"], "count = total documents; list = titles; by_kind = count per kind; search = titles matching query"),
      query: { type: "string", description: "Search words (used by action=search)" },
      limit: { type: "integer", description: "Max rows for list (default 100)" },
    },
    source: librarySource(),
  },
  my_study_sessions: {
    name: "my_study_sessions",
    label: "Study sessions",
    view: "my_learning_sessions",
    step: "s",
    actions: ["count", "list", "by_subject", "search"],
    params: {
      action: ACTION_PARAM(["count", "list", "by_subject", "search"], "count = sessions; list = sessions; by_subject = sessions per subject; search = sessions whose topic matches query"),
      query: { type: "string", description: "Search words (used by action=search)" },
      limit: { type: "integer", description: "Max rows for list (default 100)" },
    },
    source: groupSource("s", "subject", ["subject", "topic", "status", "started_at"], "topic"),
  },
  my_past_questions: {
    name: "my_past_questions",
    label: "Past questions",
    view: "my_past_questions",
    step: "p",
    actions: ["count", "list", "by_subject", "accuracy", "search"],
    params: {
      action: ACTION_PARAM(["count", "list", "by_subject", "accuracy", "search"], "count = attempts; list = attempts; by_subject = attempts per subject; accuracy = correct ÷ attempted; search = attempts whose subject matches query"),
      query: { type: "string", description: "Search words (used by action=search)" },
      limit: { type: "integer", description: "Max rows for list (default 100)" },
    },
    source: groupSource("p", "subject", ["exam", "subject", "year", "attempted", "correct"], "subject"),
  },
  my_study_notes: {
    name: "my_study_notes",
    label: "Study notes",
    view: "my_study_notes",
    step: "n",
    actions: ["count", "list", "by_subject", "search"],
    params: {
      action: ACTION_PARAM(["count", "list", "by_subject", "search"], "count = notes; list = notes; by_subject = notes per subject; search = notes whose topic matches query"),
      query: { type: "string", description: "Search words (used by action=search)" },
      limit: { type: "integer", description: "Max rows for list (default 100)" },
    },
    source: groupSource("n", "subject", ["subject", "topic", "confidence"], "topic"),
  },
};

/** Which curated domain (if any) a goal belongs to. Documents first (they have
 *  no subject), then the subject-bearing domains by their own words. */
export function domainForGoal(goal) {
  const g = String(goal || "").toLowerCase();
  if (!g.trim()) return null;
  if (/\b(documents?|files?|uploads?|pdfs?|papers?)\b/.test(g) || (/\blibrary\b/.test(g) && /\b(count|counts|list|listing|how many|total|titles?|names?)\b/.test(g))) return "library_documents";
  if (/\b(past questions?|past papers?|waec|jamb|neco|bece|exam practice)\b/.test(g)) return "my_past_questions";
  if (/\b(study notes?|my notes?)\b/.test(g)) return "my_study_notes";
  if (/\b(study sessions?|learning sessions?|lessons?|taught|teaching sessions?)\b/.test(g)) return "my_study_sessions";
  return null;
}

/** The action to run for THIS request, inferred from the goal wording. */
export function actionForGoal(goal) {
  const g = String(goal || "").toLowerCase();
  if (/\b(by kind|per kind|each kind|breakdown by kind)\b/.test(g)) return "by_kind";
  if (/\b(by subject|per subject|each subject|breakdown by subject)\b/.test(g)) return "by_subject";
  if (/\b(search|find|matching|look for)\b/.test(g)) return "search";
  if (/\b(list|titles?|names?|show|what are)\b/.test(g)) return "list";
  return "count";
}

/* ── Per-learner dynamic domains ─────────────────────────────────────────────
   A read goal over the learner's OWN data view (scope "self") that isn't in the
   curated registry becomes ONE domain tool for that view, with count/list/by_<field>.
   The tool is verified action-by-action before it is saved, and reused/extended
   (via replace) rather than duplicated. */
import { DATA_VIEWS } from "./views.js";

const humanize = (v) => String(v || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function listOnlySource(listFields, searchField = "name") {
  const picks = listFields.map((f) => `${f}: r.${f}`).join(", ");
  return `function run(input, data, akoro) {
  var rows = data.v || [];
  var action = String(input.action || "count");
  if (action === "count") return [{ count: rows.length }];
  var agg = /^(sum|avg|min|max)_([a-z_]+)$/.exec(action);
  if (agg) {
    var op = agg[1], f = agg[2], vals = [];
    for (var i = 0; i < rows.length; i++) {
      var raw = rows[i][f];
      if (raw === null || raw === undefined || raw === "") continue;
      var v = Number(raw);
      if (isFinite(v)) vals.push(v);
    }
    if (!vals.length) return [{ op: op, field: f, value: op === "sum" ? 0 : null, n: 0 }];
    var s = 0, mn = vals[0], mx = vals[0];
    for (var z = 0; z < vals.length; z++) { s += vals[z]; if (vals[z] < mn) mn = vals[z]; if (vals[z] > mx) mx = vals[z]; }
    var value = op === "sum" ? s : (op === "avg" ? s / vals.length : (op === "min" ? mn : mx));
    return [{ op: op, field: f, value: value, n: vals.length }];
  }
  if (action === "search") {
    var q = String(input.query || "").toLowerCase();
    var out = [];
    if (!q) return out;
    for (var j = 0; j < rows.length; j++) {
      var nm = rows[j].${searchField};
      if (nm != null && String(nm).toLowerCase().indexOf(q) >= 0) out.push({ name: String(nm) });
    }
    return out;
  }
  var lim = Number(input.limit) || 100;
  return rows.slice(0, lim).map(function (r) { return { ${picks} }; });
}`;
}

/** Build a dynamic domain spec for one own-data view (or null). */
export function genericDomain(view) {
  const v = DATA_VIEWS[view];
  if (!v || v.scope !== "self" || !v.fields) return null;
  const fields = Object.keys(v.fields);
  if (!fields.length) return null;
  const isText = (f) => ["text", "string"].includes(v.fields[f]?.type);
  const textField = ["name", "title", "topic", "subject"].find((f) => fields.includes(f) && isText(f)) || fields.find(isText);
  const groupField = fields.includes("subject") ? "subject" : (fields.includes("kind") ? "kind" : (textField || null));
  const actions = ["count", "list", ...(groupField ? [`by_${groupField}`] : []), ...(textField ? ["search"] : [])];
  const listFields = fields.slice(0, 6);
  return {
    name: view, label: humanize(view), view, step: "v", actions,
    params: {
      action: { type: "string", enum: actions, default: "count", description: `count = how many; list = rows;${groupField ? ` by_${groupField} = count per ${groupField};` : ""}${textField ? ` search = rows whose ${textField} matches query;` : ""}` },
      ...(textField ? { query: { type: "string", description: "Search words (used by action=search)" } } : {}),
      limit: { type: "integer", description: "Max rows for list (default 100)" },
    },
    source: groupField ? groupSource("v", groupField, listFields, textField || "name") : listOnlySource(listFields, textField || "name"),
  };
}

/** Does this goal plainly read/count/list the learner's own data (safe for a
 *  view domain)? Value aggregates are handled deterministically by
 *  aggregateForGoal instead. */
export function genericReadGoal(goal) {
  const g = String(goal || "");
  if (!g.trim()) return false;
  if (/\b(sum|average|mean|accuracy|score|percentage|percent)\b/i.test(g)) return false;
  return /\b(how many|count|counts|list|listing|show|what are|which|search|find|matching|look for|by\s|breakdown|per\s)\b/i.test(g);
}

/* ── Deterministic aggregates ────────────────────────────────────────────────
   sum/avg/min/max over a numeric field of a view, plus accuracy for past
   questions, are script actions — no LLM builder. They are added to a domain
   tool at runtime exactly like by_<field>. */

const NUMERIC_TYPES = new Set(["int", "integer", "num", "number", "float", "decimal"]);
const numericFields = (view) => Object.entries(DATA_VIEWS[view]?.fields || {})
  .filter(([, f]) => NUMERIC_TYPES.has(String(f?.type))).map(([k]) => k);
// Goal words that name a metric differently from its field.
const METRIC_ALIAS = { xp: "amount", points: "amount", point: "amount", earned: "amount", score: "score", progress: "progress", size: "size", confidence: "confidence", rank: "final_rank" };

/** The scripted aggregate action a goal asks for on this view (or null):
 *  "total XP" → sum_amount, "average score" → avg_score, "WAEC accuracy" →
 *  accuracy. Requires a real numeric field, so "total documents" is NOT an
 *  aggregate (it's a count). */
export function aggregateForGoal(goal, view) {
  const g = String(goal || "").toLowerCase();
  if (!view || !DATA_VIEWS[view]) return null;
  if (view === "my_past_questions" && /\b(accuracy|percentage|percent|score)\b/.test(g)) return "accuracy";
  const m = g.match(/\b(total|sum|combined|add up|average|avg|mean|highest|largest|biggest|max|lowest|smallest|min)\b(?:\s+(?:of|my|the))?\s*([a-z_]+)?/);
  if (!m) return null;
  const nums = numericFields(view);
  if (!nums.length) return null;
  const metric = m[2];
  const field = metric && nums.includes(metric) ? metric
    : metric && METRIC_ALIAS[metric] && nums.includes(METRIC_ALIAS[metric]) ? METRIC_ALIAS[metric]
    : !metric && nums.length === 1 ? nums[0] : null;
  if (!field) return null;
  const op = /^(average|avg|mean)$/.test(m[1]) ? "avg"
    : /^(highest|largest|biggest|max)$/.test(m[1]) ? "max"
    : /^(lowest|smallest|min)$/.test(m[1]) ? "min" : "sum";
  return `${op}_${field}`;
}

/** The own-data view a goal is about, from the views' own keywords (cheap,
 *  pure). Used to make tool reuse domain-based instead of goal-text fuzzy. */
export function bestSelfView(goal) {
  const g = ` ${String(goal || "").toLowerCase()} `;
  let best = null, bestScore = 0;
  for (const [name, v] of Object.entries(DATA_VIEWS)) {
    if (v.scope !== "self") continue;
    let s = 0;
    for (const k of v.keywords || []) if (g.includes(k)) s += k.includes(" ") ? 3 : 2;
    if (s > bestScore) { best = name; bestScore = s; }
  }
  return best;
}

/** Which action to run for this request, from the actions the tool declares. */
export function inferAction(goal, actions = [], view = null) {
  const g = String(goal || "").toLowerCase();
  const agg = aggregateForGoal(goal, view);
  if (agg && actions.includes(agg)) return agg;
  const by = g.match(/\bby\s+([a-z_]+)/);
  if (by && actions.includes(`by_${by[1]}`)) return `by_${by[1]}`;
  if (actions.includes("search") && /\b(search|find|matching)\b/.test(g)) return "search";
  if (actions.includes("list") && /\b(list|titles?|names?|show|what are)\b/.test(g)) return "list";
  if (actions.includes("count")) return "count";
  return actions[0];
}

const isObj = (r) => !!r && typeof r === "object" && !Array.isArray(r);
const finiteNum = (n) => typeof n === "number" && Number.isFinite(n);
const AGG_ACTION = /^(sum|avg|min|max)_([a-z_]+)$/;

/** Output contract for ONE action, checked by script only (no LLM). Returns an
 *  error string, or null when the result has the right shape. Actions:
 *  count → one numeric row; list → objects; by_<field> → { field, positive count }
 *  whose counts add up to `total`; search → rows with a string name;
 *  sum/avg/min/max_<field> → one numeric (or null) value with n; accuracy → one
 *  row with attempted/correct and a 0–100 accuracy. */
export function actionContract(action, r) {
  if (!r || !r.ok) return null; // the run's own error is reported separately
  const rows = r.rows;
  if (!Array.isArray(rows)) return "did not return a list of rows";
  if (action === "count") {
    if (rows.length !== 1) return `count should return exactly one row (got ${rows.length})`;
    const n = rows[0]?.count;
    if (!finiteNum(n) || n < 0) return "count row must have a numeric count ≥ 0";
    if (finiteNum(r.total) && r.total !== n) return `total (${r.total}) disagrees with count (${n})`;
    return null;
  }
  if (AGG_ACTION.test(action)) {
    if (rows.length !== 1) return `${action} should return exactly one row (got ${rows.length})`;
    const row = rows[0];
    if (!finiteNum(row?.n)) return `${action} must report a numeric n`;
    if (!(row?.value === null || finiteNum(row?.value))) return `${action} value must be numeric or null`;
    if (row?.op !== AGG_ACTION.exec(action)[1]) return `${action} reported op "${row?.op}"`;
    if (row?.field !== AGG_ACTION.exec(action)[2]) return `${action} reported field "${row?.field}"`;
    return null;
  }
  if (action === "accuracy") {
    if (rows.length !== 1) return `accuracy should return exactly one row (got ${rows.length})`;
    const row = rows[0];
    if (!finiteNum(row?.attempted) || !finiteNum(row?.correct)) return "accuracy needs numeric attempted and correct";
    if (!(row?.accuracy === null || (finiteNum(row?.accuracy) && row.accuracy >= 0 && row.accuracy <= 100))) return "accuracy must be a percentage 0–100, or null";
    return null;
  }
  if (action === "search") {
    if (rows.some((x) => !isObj(x) || typeof x.name !== "string")) return "search rows must carry a string name";
    if (finiteNum(r.total) && rows.length > r.total) return `search returned ${rows.length} rows for a total of ${r.total}`;
    return null;
  }
  if (action.startsWith("by_")) {
    const f = action.slice(3);
    for (const row of rows) {
      if (!isObj(row)) return `by_${f} rows must be objects`;
      if (!(f in row)) return `by_${f} rows must carry the '${f}' key`;
      if (!finiteNum(row.count) || row.count <= 0) return `by_${f} rows must have a positive numeric count`;
    }
    if (finiteNum(r.total) && !r.truncated) {
      const sum = rows.reduce((n, x) => n + x.count, 0);
      if (sum !== r.total) return `by_${f} counts sum to ${sum} but total is ${r.total}`;
    }
    return null;
  }
  // list
  if (rows.some((x) => !isObj(x))) return "list rows must be objects";
  if (finiteNum(r.total) && rows.length > r.total) return `list returned ${rows.length} rows for a total of ${r.total}`;
  return null;
}

/** A sandbox worker that failed to start or was stopped is transient; a real
 *  tool failure is not. Retrying one of these keeps verification honest without
 *  letting worker-start jitter block a save. */
const TRANSIENT_RUN = /(ran too long|sandbox stopped|sandbox unavailable)/i;

/** Run EVERY action of a domain spec through `run(spec, sample)` and return a
 *  per-action check. Any `ok:false` blocks the save (domain regression). Pure
 *  orchestration — the caller supplies the runner, so this is unit-testable.
 *  Each action is checked against its output contract, then the actions are
 *  cross-checked: every breakdown must add up to the count, and a list can't
 *  exceed it. Script only — deterministic, no LLM, no cost. */
export async function verifyDomainActions(spec, run, { budgetMs = 12000, now = Date.now } = {}) {
  const checks = [];
  const start = now();
  for (const action of spec.actions) {
    // Budget: a slow/failing action can't make verification run forever — over
    // budget, the remaining actions are flagged (which blocks the save).
    if (now() - start > budgetMs) { checks.push({ action, ok: false, error: "verification budget exceeded" }); continue; }
    const sample = action === "search" ? { action, query: "a" } : { action };
    let r = await run(spec, sample);
    if (!r?.ok && TRANSIENT_RUN.test(String(r?.error || "")) && now() - start <= budgetMs) {
      r = await run(spec, sample); // one retry: worker start / wall jitter, not a tool bug
    }
    const ok = !!(r && r.ok && Array.isArray(r.rows));
    const contractError = ok ? actionContract(action, r) : null;
    checks.push({
      action, ok: ok && !contractError,
      error: ok ? (contractError || undefined) : (r && r.error),
      ...(finiteNum(r?.total) ? { total: r.total } : {}),
      ...(r?.truncated ? { truncated: true } : {}),
    });
  }

  // Cross-action invariants over the same data: a breakdown that doesn't add up
  // to the count (or a list longer than it) means the definition regressed.
  const countCheck = checks.find((c) => c.action === "count" && c.ok && finiteNum(c.total));
  if (countCheck) {
    for (const c of checks) {
      if (!c.ok || c.truncated || c.action === "count" || !finiteNum(c.total)) continue;
      if (c.action.startsWith("by_") && c.total !== countCheck.total) {
        c.ok = false;
        c.error = `by_${c.action.slice(3)} adds up to ${c.total} but count is ${countCheck.total}`;
      } else if (c.action === "list" && c.total > countCheck.total) {
        c.ok = false;
        c.error = `list has ${c.total} rows but count is only ${countCheck.total}`;
      }
    }
  }
  return checks;
}

/** A requested "by <field>" action for this view, when the field exists:
 *  "documents by size" → "by_size". Null when no breakdown is asked or the field
 *  isn't in the view. */
export function byActionForGoal(goal, view) {
  const g = String(goal || "").toLowerCase();
  const m = g.match(/\b(?:by|per|breakdown by|grouped by)\s+([a-z][a-z_]*)/);
  if (!m) return null;
  const field = m[1].replace(/[^a-z_]/g, "");
  const v = DATA_VIEWS[view];
  if (!v || !v.fields || !v.fields[field]) return null;
  return `by_${field}`;
}
