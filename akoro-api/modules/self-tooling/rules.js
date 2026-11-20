/**
 * modules/self-tooling/rules.js — pure shape, normalisation and validation
 * helpers for the custom-tool pipeline (pipeline.js). No database, no model
 * calls, no execution: everything here is a function of its arguments, so the
 * contract tests can exercise the real shapes.
 */
import { paramProps } from "./bind.js";
import { CAPABILITIES } from "./capabilities.js";
import { mergedLibraryEnabled, LIBRARY_MERGED_ACTIONS } from "./mergedLibrary.js";
import { mergedChatsEnabled, CHATS_MERGED_ACTIONS } from "./mergedChats.js";
import { MERGED_DOMAIN_LIST } from "./mergedDomains.js";

export const NAME = /^[a-z][a-z0-9_]{2,47}$/;

/** A domain tool: one code tool per view with an `action` enum. */
export const isDomainTool = (t) => t?.mode === "code" && Array.isArray(t?.params_schema?.action?.enum);

export const LIMITS = {
  // Per-learner tool builds per day. Env-overridable (SELF_TOOLING_DAILY_CREATES);
  // default raised from 5 to 20 to match the total-tool cap, since the
  // similar-goal dedupe now prevents wasteful duplicate builds.
  dailyCreates: Math.max(1, Number(process.env.SELF_TOOLING_DAILY_CREATES) || 20),
  maxTools: Math.max(1, Number(process.env.SELF_TOOLING_MAX_TOOLS) || 20),
  // Every ACTIVE tool a learner owns must be callable in chat — a tool the model
  // can't see is a tool it says it "can't run from here". This used to be 8, so
  // once a learner had more tools the older ones silently fell out of the chat's
  // tool list (a saved "Library count" was unreachable, and the agent rebuilt it).
  inCatalogue: Math.max(24, Number(process.env.SELF_TOOLING_CATALOGUE) || 24),
  runMs: 3_000,
  builderCalls: 5,
};

export const reject = (reason, extra = {}) => ({ status: "rejected", reason, ...extra });

/** How a build uses an approved capability: a read is a step; a change is the recipe's final write op. */
export const howToUse = (c) => (CAPABILITIES[c]?.kind === "write"
  ? `use the approved change ${c}: read the rows from the view ${CAPABILITIES[c].target}, filter them to exactly what the goal says, and END the recipe with {"op":"write","cap":"${c}"${CAPABILITIES[c].args ? `,"args":{${Object.keys(CAPABILITIES[c].args).map((k) => `"${k}":…`).join(",")}}` : ""}} (never a step with "cap" for a change)`
  : `use the approved capability ${c} (a step {"id":"x","cap":"${c}"} — returns ${JSON.stringify(CAPABILITIES[c].returns || [])})`);

const SCHEDULING = /\b(spread|schedule|timetable|plan (out|my)|(per|a|each|every) (day|week)|skip(ping)? (sundays?|saturdays?|weekends?)|over the (next|coming) \d*\s*(days|weeks)|until (my|the) (exam|test))\b/i;
/** Goals only code can express (plans over dates, N per day, skip days). */
export const needsCode = (goal) => SCHEDULING.test(String(goal || ""));

/**
 * Code may only hard-code a date the learner gave (in the goal or a param
 * default). A generated plan once started on an invented "2026-10-01"
 * instead of akoro.today, so half of it was in the past.
 */
export function inventedDates(source, goal, params = {}) {
  const given = `${goal} ${JSON.stringify(params)}`;
  const found = [...new Set(String(source || "").match(/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g) || [])].filter((d) => !given.includes(d));
  return found.length ? [`code: don't hard-code ${found.join(", ")} — start from akoro.today (dates the learner gave are fine)`] : [];
}

/** Fields that identify ONE specific row (its display identity), as opposed
 * to a condition many rows share (status, priority, a subject). */
const IDENTITY_FIELDS = new Set(["title", "name"]);

/**
 * A WRITE definition must not hard-code the specific row it acts on
 * (Matt, 2026-11-17): a saved "Delete a chat" tool built for one chat baked
 * that chat's title into its filter, so it could never delete any other —
 * and reusing it matched nothing, silently. The row's identity belongs in
 * a param the learner's agent supplies each run. PURE: returns one entry
 * per hard-coded target { param, field, value, message } — `message` is
 * builder feedback; the caller auto-declares `param` (default = the value
 * this request named) so the repair attempt can bind it. Only literals the
 * GOAL itself names count (the learner pointed at that row), only on
 * identity fields, only in definitions that write.
 */
export function hardCodedTargets(def, goal, params = {}) {
  if (!def || typeof def !== "object") return [];
  const goalText = String(goal || "").toLowerCase();
  const inGoal = (lit) => goalText.includes(String(lit).toLowerCase());
  const props = paramProps(params);
  const paramFor = (field, value) => Object.keys(props).find((k) => props[k]?.default === value) || field;
  const out = [];
  const seen = new Set();
  const consider = (field, value) => {
    if (!IDENTITY_FIELDS.has(field)) return;
    for (const v of [].concat(value ?? [])) {
      if (typeof v !== "string" || v.startsWith("$") || v.trim().length < 6) continue;
      if (!inGoal(v)) continue;
      const param = paramFor(field, v);
      const key = `${param}:${v}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ param, field, value: v,
        message: `the definition hard-codes the specific row it acts on (${field} = "${v}") — a saved tool must take that row from the $${param} param instead, so it works for any row the learner names: filter ${field} by "$${param}", never the literal` });
    }
  };
  const boundIdentity = new Set();
  const scanWhere = (where) => { for (const w of [].concat(where || [])) if (w && typeof w === "object") { consider(String(w.field || ""), w.value); if (IDENTITY_FIELDS.has(String(w.field || "")) && typeof w.value === "string" && w.value.startsWith("$")) boundIdentity.add(w.value.slice(1)); } };
  // A param DEFAULT that names the row from this request bakes the target
  // into the saved tool just as surely as a hard-coded filter literal:
  // every later run that omits the param (or, before the coerceInput fix,
  // passed "") silently acts on the stale row (live, 2026-11-17: a
  // contains-delete tool whose title default named a chat proposed that
  // chat on a card whenever the phrase came in empty). Flagged with
  // paramDefault — the stage loop skips these (the builder cannot edit
  // the agent's params); register strips the default from the SAVED
  // schema while this build's own runs keep the value via the run pin.
  const scanDefaults = () => {
    for (const [k, p] of Object.entries(props)) {
      const d = p?.default;
      if (typeof d !== "string" || !d.trim()) continue;
      // Flagged when the default names the goal's row, OR whenever the
      // param feeds an identity-field filter on the write path — there
      // the default IS a target selector, and it may have leaked from
      // sample data rather than the goal text (the builder's samples are
      // the learner's real rows), so the goal check alone misses it.
      // Identity params only: a default on a condition param (status,
      // kind) names a class of rows, not a specific row — the same
      // distinction the literal scan makes.
      const identityish = boundIdentity.has(k) || IDENTITY_FIELDS.has(k);
      if (!identityish) continue;
      if (!((d.trim().length >= 6 && inGoal(d)) || boundIdentity.has(k))) continue;
      const key = `${k}:${d}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ param: k, field: k, value: d, paramDefault: true,
        message: `the $${k} param's default ("${d}") names the specific row from this request — a saved tool must not carry its target as a default: whoever runs it supplies the row, and a run with no value must act on nothing` });
    }
  };
  if (def.kind === "recipe") {
    const writes = [].concat(def.then || []).filter((op) => op?.op === "write");
    if (writes.length) {
      for (const s of [].concat(def.steps || [])) scanWhere(s?.where);
      for (const op of [].concat(def.then || [])) if (op?.op === "filter") scanWhere(op.where);
      scanDefaults();
    }
  } else if (def.kind === "code") {
    const hasWriteStep = [].concat(def.steps || []).some((s) => CAPABILITIES[s?.cap]?.kind === "write");
    if (hasWriteStep) {
      for (const s of [].concat(def.steps || [])) scanWhere(s?.where);
      for (const m of String(def.source || "").matchAll(/["']([^"']{6,})["']/g)) consider("title", m[1]);
      scanDefaults();
    }
  }
  return out;
}

const ABOUT_OTHERS = /\b(other (players?|learners?|students?|people)|others|classmates?|opponents?|everyone else|the rest of (my|the) class)\b/i;
const BATTLE_WORDS = /\b(battles?|duels?|challenges?|matches)\b/i;
const OTHERS_WORDS = /\b(other (players?|learners?|students?|people)|others|opponents?|classmates?|everyone else|the rest|compared? (to|with)|versus|vs\.?|who (beat|won)|beat me|than me)\b/i;
/** "How did the other players do in my battles?" — about other learners' battle results. */
export const asksAboutOthersInBattles = (message) => BATTLE_WORDS.test(String(message || "")) && OTHERS_WORDS.test(String(message || ""));

/**
 * For a goal about other learners: the lookup's TOP-ranked capability, when it
 * is a locked one over other learners' data (an available capability ranked
 * above it — e.g. the weekly league — may answer it, so then build). → name | null
 */
export function othersCapabilityFirst(goal, ranked) {
  if (!ABOUT_OTHERS.test(String(goal || ""))) return null;
  const top = ranked[0];
  return top?.status === "needs_approval" && CAPABILITIES[top.name]?.scope === "network" ? top.name : null;
}

/** PURE: which of the learner's tools a free-form `replace` value means, or
 * null when it matches none — or more than one (never guess between tools). */
export function pickReplacement(rows, replaceRaw) {
  const raw = String(replaceRaw || "").trim();
  if (!raw) return null;
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const byLabel = rows.filter((t) => String(t?.label || "").toLowerCase() === raw.toLowerCase());
  if (byLabel.length === 1) return byLabel[0];
  const bySlug = rows.filter((t) => t?.name === slug);
  if (bySlug.length === 1) return bySlug[0];
  const byPrefix = rows.filter((t) => slug && String(t?.name || "").startsWith(`${slug}_`));
  if (byPrefix.length === 1) return byPrefix[0];
  return null;
}

/** The actions a tool row carries (its domain action set), or []. */
export const toolActions = (t) => (Array.isArray(t?.actions) && t.actions.length ? t.actions
  : (Array.isArray(t?.params_schema?.action?.enum) ? t.params_schema.action.enum : []));
/** Parameter names a tool declares (either params_schema shape). */
export const toolParamNames = (ps) => Object.keys((ps && typeof ps === "object") ? (ps.properties || ps) : {});
/**
 * Option 2 (answer-only): a pure computed READ — the run worked, changed
 * nothing, and the tool takes NO inputs at run time (everything is fixed by
 * the goal's wording) — is answered from its verified dry run and NOT saved.
 * Writes and parameterized tools still go through build + Keep.
 */
export const isAnswerOnlyRead = (def, run) => !!run?.ok && !run?.write && toolParamNames(def?.params_schema).length === 0;

/** Actions the learner has NOT switched off — the only ones the model may see or run. */
export const visibleActions = (t) => {
  const off = new Set(Array.isArray(t?.disabled_actions) ? t.disabled_actions : []);
  return toolActions(t).filter((a) => !off.has(a));
};

export function toolDef(t) {
  const off = new Set(Array.isArray(t?.disabled_actions) ? t.disabled_actions : []);
  const acts = toolActions(t);
  if (acts.length && !acts.some((a) => !off.has(a))) return null;   // every action switched off — offer nothing
  const props = Object.fromEntries(Object.entries(paramProps(t.params_schema)).map(([k, p]) => [k, {
    ...(Array.isArray(p.enum) ? { type: typeof p.enum[0] === "number" ? "number" : "string", enum: k === "action" ? p.enum.filter((a) => !off.has(a)) : p.enum } : { type: p.type }),
    ...(p.description ? { description: String(p.description).slice(0, 200) } : {}),
  }]));
  const origin = t.scope === "platform" ? "an Akoro tool for every learner, runs on this learner's own data" : "a tool the learner's agent built";
  return { type: "function", function: { name: t.name, description: `${t.label} — ${t.goal} (${origin}; read-only)`, parameters: { type: "object", properties: props, required: [] } } };
}

/** Appended to a rebuild's result note: the agent reports only what it verified. */
export const REBUILD_HONESTY = " This REBUILDS a tool the learner already had. In your reply, report only what you verified: if the old tool's answer was wrong and the new answer differs, say what changed; if you did not establish what was wrong with the old tool, say plainly that you couldn't confirm the fault - never invent a cause or a story about the old tool.";

// Merged domains (library, chats): the platform owns the merged action set,
// so My tools presents ONLY the learner's own delta actions — and a merged
// row with no delta left is not listed at all (nothing of theirs to manage).
// Pure helpers, exported for the contract tests.
const MERGED_ROW_DOMAINS = [
  { domain: "my_library", name: "library_documents", mergedActions: LIBRARY_MERGED_ACTIONS, enabled: mergedLibraryEnabled },
  { domain: "my_chats", name: "my_chats", mergedActions: CHATS_MERGED_ACTIONS, enabled: mergedChatsEnabled },
  ...MERGED_DOMAIN_LIST.map((c) => ({ domain: c.view, name: c.name, mergedActions: c.mergedActions, enabled: c.enabled })),
];
export function mergedRowRule(row) {
  // The rule applies ONLY to the domain tool itself (matched by name, the
  // same key the state lookups use). A computed tool that merely READS the
  // merged view carries the view in its domain field too — hiding it would
  // vanish the learner's tool from My tools (seen live 2026-11-15: a goals
  // percentage tool, domain my_goals, disappeared from the list while
  // still running fine).
  return MERGED_ROW_DOMAINS.find((r) => r.domain === row?.domain && r.name === row?.name && r.enabled()) || null;
}
export function presentMergedToolRow(row) {
  const rule = mergedRowRule(row);
  if (!rule) return row;
  const delta = (Array.isArray(row.actions) ? row.actions : []).filter((a) => !rule.mergedActions.includes(a));
  if (!delta.length) return null;
  const off = (Array.isArray(row.disabled_actions) ? row.disabled_actions : []).filter((a) => !rule.mergedActions.includes(a));
  return { ...row, actions: delta, disabled_actions: off };
}
