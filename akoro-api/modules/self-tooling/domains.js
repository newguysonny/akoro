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
