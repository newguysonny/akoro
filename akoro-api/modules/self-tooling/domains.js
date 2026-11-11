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

/** Group/count source over a view's rows. Server-side template: the GENERATED
 *  source contains no `${...}` (only literal ids/fields), so it passes the
 *  sandbox's ES2020 rules. */
function groupSource(stepId, field, listFields) {
  const picks = listFields.map((f) => `${f}: r.${f}`).join(", ");
  return `function run(input, data, akoro) {
  var rows = data.${stepId} || [];
  var action = String(input.action || "count");
  if (action === "count") return [{ count: rows.length }];
  if (action === "by_${field}") {
    var m = {};
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].${field} == null ? "unknown" : String(rows[i].${field});
      m[k] = (m[k] || 0) + 1;
    }
    return Object.keys(m).map(function (k) { var o = {}; o.${field} = k; o.count = m[k]; return o; });
  }
  var lim = Number(input.limit) || 100;
  return rows.slice(0, lim).map(function (r) { return { ${picks} }; });
}`;
}

/** Library documents: count / list / by_kind / search titles. */
function librarySource() {
  return `function run(input, data, akoro) {
  var rows = data.lib || [];
  var action = String(input.action || "count");
  if (action === "count") return [{ count: rows.length }];
  if (action === "by_kind") {
    var m = {};
    for (var i = 0; i < rows.length; i++) { var k = rows[i].kind || "unknown"; m[k] = (m[k] || 0) + 1; }
    return Object.keys(m).map(function (k) { return { kind: k, count: m[k] }; });
  }
  if (action === "search") {
    var q = String(input.query || "").toLowerCase();
    var out = [];
    if (!q) return out;
    for (var j = 0; j < rows.length; j++) { if (String(rows[j].name || "").toLowerCase().indexOf(q) >= 0) out.push({ name: rows[j].name, kind: rows[j].kind }); }
    return out;
  }
  var lim = Number(input.limit) || 100;
  return rows.slice(0, lim).map(function (r) { return { name: r.name, kind: r.kind, added: r.created_at }; });
}`;
}

const ACTION_PARAM = (actions, help) => ({
  type: "string", enum: actions, default: actions[0], description: help,
});

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
    actions: ["count", "list", "by_subject"],
    params: {
      action: ACTION_PARAM(["count", "list", "by_subject"], "count = sessions; list = sessions; by_subject = sessions per subject"),
      limit: { type: "integer", description: "Max rows for list (default 100)" },
    },
    source: groupSource("s", "subject", ["subject", "topic", "status", "started_at"]),
  },
  my_past_questions: {
    name: "my_past_questions",
    label: "Past questions",
    view: "my_past_questions",
    step: "p",
    actions: ["count", "list", "by_subject"],
    params: {
      action: ACTION_PARAM(["count", "list", "by_subject"], "count = attempts; list = attempts; by_subject = attempts per subject"),
      limit: { type: "integer", description: "Max rows for list (default 100)" },
    },
    source: groupSource("p", "subject", ["exam", "subject", "year", "attempted", "correct"]),
  },
  my_study_notes: {
    name: "my_study_notes",
    label: "Study notes",
    view: "my_study_notes",
    step: "n",
    actions: ["count", "list", "by_subject"],
    params: {
      action: ACTION_PARAM(["count", "list", "by_subject"], "count = notes; list = notes; by_subject = notes per subject"),
      limit: { type: "integer", description: "Max rows for list (default 100)" },
    },
    source: groupSource("n", "subject", ["subject", "topic", "confidence"]),
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

function listOnlySource(listFields) {
  const picks = listFields.map((f) => `${f}: r.${f}`).join(", ");
  return `function run(input, data, akoro) {
  var rows = data.v || [];
  var action = String(input.action || "count");
  if (action === "count") return [{ count: rows.length }];
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
  const textField = fields.find((f) => v.fields[f]?.type === "text");
  const groupField = fields.includes("subject") ? "subject" : (fields.includes("kind") ? "kind" : (textField || null));
  const actions = ["count", "list", ...(groupField ? [`by_${groupField}`] : [])];
  const listFields = fields.slice(0, 6);
  return {
    name: view, label: humanize(view), view, step: "v", actions,
    params: {
      action: { type: "string", enum: actions, default: "count", description: `count = how many; list = rows;${groupField ? ` by_${groupField} = count per ${groupField};` : ""}` },
      limit: { type: "integer", description: "Max rows for list (default 100)" },
    },
    source: groupField ? groupSource("v", groupField, listFields) : listOnlySource(listFields),
  };
}

/** Does this goal read/aggregate the learner's own data (safe for a view domain)?
 *  Value aggregates (sum/average/accuracy/score) are left to the generic builder. */
export function genericReadGoal(goal) {
  const g = String(goal || "");
  if (!g.trim()) return false;
  if (/\b(sum|average|mean|accuracy|score|percentage|percent)\b/i.test(g)) return false;
  return /\b(how many|count|counts|list|listing|show|what are|which|by\s|breakdown|per\s)\b/i.test(g);
}

/** Which action to run for this request, from the actions the tool declares. */
export function inferAction(goal, actions = []) {
  const g = String(goal || "").toLowerCase();
  const by = g.match(/\bby\s+([a-z_]+)/);
  if (by && actions.includes(`by_${by[1]}`)) return `by_${by[1]}`;
  if (actions.includes("search") && /\b(search|find|matching)\b/.test(g)) return "search";
  if (actions.includes("list") && /\b(list|titles?|names?|show|what are)\b/.test(g)) return "list";
  if (actions.includes("count")) return "count";
  return actions[0];
}

/** Run EVERY action of a domain spec through `run(spec, sample)` and return a
 *  per-action check. Any `ok:false` blocks the save (domain regression). Pure
 *  orchestration — the caller supplies the runner, so this is unit-testable. */
export async function verifyDomainActions(spec, run) {
  const checks = [];
  for (const action of spec.actions) {
    const sample = action === "search" ? { action, query: "a" } : { action };
    const r = await run(spec, sample);
    checks.push({ action, ok: !!(r && r.ok && Array.isArray(r.rows)), error: r && r.error });
  }
  return checks;
}
