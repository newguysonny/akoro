/**
 * modules/self-tooling/pipeline.js — create_tool and the learner-tool runtime
 * (plan §7.4, §7.9, §7.10). Stages 1 (recipe), 2 (spec), 3 (sandboxed code,
 * sandbox/ — on by default; AKORO_SELF_TOOLING_CODE_ENABLED=false turns it off) and 4 (escalate to an
 * admin, escalation.js).
 *
 *   createTool  → { status: created|escalated|rejected, … }   one call in, one status out
 *   runLearnerTool / learnerToolDefs / listMyTools / setMyToolStatus
 */
import db from "../../db.js";
import { schemaLookup, capabilityStatus } from "./registry.js";
import { forbiddenFor, CAPABILITIES, learnerGrantable, ownChangeAsked, asksForChange, changeAskedOf } from "./capabilities.js";
import { DATA_VIEWS } from "./views.js";
import { validateDefinition, runDefinition } from "./interpreters.js";
import { validateParams, coerceInput, paramProps, wellFormedParams } from "./bind.js";
import { buildDefinition, registrySlice } from "./builder.js";
import { verificationAssertions } from "../../lib/verificationAssertions.js";
import { escalate, rowsText } from "./escalation.js";
import { proposeWrite, proposePermission, proposeBuild } from "./confirmations.js";
import { codeEnabled } from "./sandbox/index.js";
import { basisColumns, currentActionBasis } from "../agent-runtime/actionBasis.js";
import { isDocumentGoal, similarGoal, goalTokens } from "./toolSimilarity.js";
import { deriveToolArea } from "./areas.js";
import { DOMAINS, domainForGoal, genericDomain, genericReadGoal, inferAction, verifyDomainActions, byActionForGoal, aggregateForGoal, bestSelfView, MAX_DOMAIN_ACTIONS } from "./domains.js";
import { mergedLibraryEnabled, LIBRARY_MERGED_ACTIONS, libraryBuildIsCovered } from "./mergedLibrary.js";
import { mergedChatsEnabled, CHATS_MERGED_ACTIONS, chatsBuildIsCovered } from "./mergedChats.js";
import { MERGED_DOMAIN_LIST } from "./mergedDomains.js";

const edu = () => db.schema("edu");
const NAME = /^[a-z][a-z0-9_]{2,47}$/;

/** A domain tool: one code tool per view with an `action` enum. */
const isDomainTool = (t) => t?.mode === "code" && Array.isArray(t?.params_schema?.action?.enum);

/** Archive the owner's OTHER domain tools over the same data view — one tool per
 *  domain. Write tools (no `action` enum) are never touched: the split keeps
 *  them separate and Confirm-gated. */
async function retireSameView(learnerId, view, keepName) {
  if (!view) return [];
  const { data } = await edu().from("agent_tools").select("id, name, views, domain, mode, params_schema")
    .eq("owner_id", learnerId).eq("status", "active");
  const archived = [];
  for (const t of data || []) {
    if (t.name === keepName || !isDomainTool(t)) continue;
    const domain = t.domain || (Array.isArray(t.views) && t.views[0]);
    if (domain === view || (Array.isArray(t.views) && t.views.includes(view))) {
      await edu().from("agent_tools").update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("id", t.id).eq("owner_id", learnerId);
      archived.push(t.name);
    }
  }
  return archived;
}
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

const reject = (reason, extra = {}) => ({ status: "rejected", reason, ...extra });
/** How a build uses an approved capability: a read is a step; a change is the recipe's final write op. */
export const howToUse = (c) => (CAPABILITIES[c]?.kind === "write"
  ? `use the approved change ${c}: read the rows from the view ${CAPABILITIES[c].target}, filter them to exactly what the goal says, and END the recipe with {"op":"write","cap":"${c}"${CAPABILITIES[c].args ? `,"args":{${Object.keys(CAPABILITIES[c].args).map((k) => `"${k}":…`).join(",")}}` : ""}} (never a step with "cap" for a change)`
  : `use the approved capability ${c} (a step {"id":"x","cap":"${c}"} — returns ${JSON.stringify(CAPABILITIES[c].returns || [])})`);

// The audit row says whether a person asked for this build or the agent went ahead under a rule (Phase 18 item 6).
async function logEvent(row) {
  const { error } = await edu().from("self_tool_events").insert({ ...row, ...basisColumns(currentActionBasis() || { basis: "explicit" }) });
  if (error) console.warn("[self-tooling] event not logged:", error.message);
}

const OWN_COPY_OFFER_WINDOW_MS = 30 * 60 * 1000;
/**
 * The own-copy gate remembers its own question. When it fires it logs an
 * "own_copy_offered" event (the view in detail); a later build for the same
 * view inside the window finds that offer still open and proceeds — the
 * learner already said yes, and the model's follow-up create_tool call does
 * not always carry hint.ownCopy (the re-ask loop seen live 2026-11-15: the
 * agent asked the same question twice and nothing was built). Honouring the
 * offer logs "own_copy_accepted", closing it: one offer, one build. Any
 * lookup failure falls back to asking (the pre-fix behaviour).
 */
async function ownCopyOfferOpen(learnerId, view) {
  try {
    const since = new Date(Date.now() - OWN_COPY_OFFER_WINDOW_MS).toISOString();
    const { data } = await edu().from("self_tool_events")
      .select("outcome, detail, created_at").eq("user_id", learnerId)
      .in("outcome", ["own_copy_offered", "own_copy_accepted"])
      .gte("created_at", since).order("created_at", { ascending: false }).limit(10);
    const viewOf = (e) => { try { const d = typeof e?.detail === "string" ? JSON.parse(e.detail) : e?.detail; return d?.view; } catch { return undefined; } };
    const latest = (data || []).find((e) => viewOf(e) === view);
    if (!latest || latest.outcome !== "own_copy_offered") return false;
    await logEvent({ user_id: learnerId, goal: "(own-copy offer honoured)", outcome: "own_copy_accepted", detail: { view } });
    return true;
  } catch {
    return false;
  }
}

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
 * The forced first step (iteration 0) for that question: create_tool, so the
 * agent reaches "this needs an admin's permission" (or builds it, once granted)
 * instead of answering "I can't see that" from unrelated tools — which it did
 * about 1 time in 10–15 on every model tried. Not forced when the learner (or
 * everyone) already has a tool for it: then the agent just calls that tool.
 * → "create_tool" | null
 */
export async function forcedSelfTool(learnerId, message) {
  // A change to their own tasks no tool makes yet: look up what can be built FIRST,
  // so the agent offers to build it — left on auto (with an older "only an admin
  // can" turn in the history) it told the learner to ask an admin instead.
  const change = ownChangeAsked(message);
  if (change) {
    const { data } = await edu().from("agent_tools").select("id").eq("status", "active")
      .or(`owner_id.eq.${learnerId},scope.eq.platform`).contains("capabilities", [change]).limit(1);
    return data?.length ? null : "schema_lookup";
  }
  // Any other change ("rename my chats"): look up first too — it either can be built, or the
  // agent says it can't yet and offers to ask the Akoro team (it used to just give a workaround).
  if (changeAskedOf(message)) return "schema_lookup";
  if (!asksAboutOthersInBattles(message)) return null;
  const { data } = await edu().from("agent_tools").select("id").eq("status", "active")
    .or(`owner_id.eq.${learnerId},scope.eq.platform`).contains("capabilities", ["battles.class_results"]).limit(1);
  return data?.length ? null : "create_tool";
}

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

/** Run a definition once, timed; never throws. */
async function tryRun(def, params, input, ctx) {
  const t0 = Date.now();
  try {
    const out = await runDefinition(def, coerceInput(params, input), ctx);
    return { ok: true, ms: Date.now() - t0, ...out };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e.message || String(e) };
  }
}

/**
 * Verify before register (§7.9): every sample runs without error, returns a
 * list, within time. (Scope is enforced inside the view reader on every row.)
 * → { verdict, assertions, runs, emptyEverywhere }
 */
async function verifyTool(def, params, samples, ctx) {
  const sink = [];
  const expect = verificationAssertions().createExpect(sink);
  const inputs = samples.length ? samples : [{}];
  const runs = [];
  for (const [i, s] of inputs.entries()) {
    const r = await tryRun(def, params, s, ctx);
    runs.push(r);
    expect.ok(`sample ${i + 1} runs`, r.ok, r.error);
    if (r.ok) {
      expect.ok(`sample ${i + 1} returns a list`, Array.isArray(r.rows));
      expect.lte(`sample ${i + 1} time (ms)`, r.ms, LIMITS.runMs);
    }
  }
  // Percentage sanity: a percent outside 0-100, or one that disagrees with the
  // part/whole counts in its own row, is a wrong answer wearing a verified badge.
  const pcts = percentFieldsOf(def);
  if (pcts.length) for (const [i, r] of runs.entries()) {
    if (!r.ok || !Array.isArray(r.rows)) continue;
    for (const pf of pcts) for (const row of r.rows) {
      const v = row?.[pf.field];
      if (typeof v !== "number") continue;
      expect.ok(`sample ${i + 1} percent ${pf.field} in range`, v >= 0 && v <= 100, `${pf.field} = ${v}`);
      if (pf.count && typeof row[pf.count] === "number" && typeof row[pf.total] === "number") {
        const want = row[pf.total] ? Math.round((row[pf.count] * 1000) / row[pf.total]) / 10 : 0;
        expect.ok(`sample ${i + 1} percent ${pf.field} matches its counts`, Math.abs(v - want) <= 0.11, `${pf.field} = ${v} but ${pf.count}/${pf.total} gives ${want}`);
      }
    }
  }
  return { verdict: verificationAssertions().repeatVerdict({ assertions: sink }), assertions: sink, runs, emptyEverywhere: runs.every((r) => r.ok && !r.rows.length) };
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

/** Percent outputs a definition declares: group percentOf (structural - the
 * interpreter derives part and whole from the same rows) and per-row compute
 * fn "percent". Verified above: in range, and for percentOf consistent with
 * the counts it ships beside. */
function percentFieldsOf(def) {
  const out = [];
  const scanGroup = (g) => { for (const pc of [].concat(g?.percentOf || [])) if (pc?.as) out.push({ field: pc.as, count: `${pc.as}_count`, total: `${pc.as}_total` }); };
  const scanCompute = (c) => { for (const x of [].concat(c || [])) if (x?.fn === "percent" && x?.as) out.push({ field: x.as }); };
  if (def?.kind === "spec") { scanGroup(def.group); scanCompute(def.compute); }
  if (def?.kind === "recipe") for (const o of def.then || []) { if (o?.op === "group") scanGroup(o); if (o?.op === "compute") scanCompute(o); }
  return out;
}

/** create_tool (§7.1). `builtIn`: names of built-in tools (never shadowed). */
/**
 * `conversationId`: the chat a resume answers into. `resumed`: re-run by the
 * resume job after an admin approval — no daily limit, a taken name gets a
 * suffix, and the platform pays (it was our gap).
 */
export async function createTool({ learnerId, input, dry = false, builtIn = new Set(), callCapability, conversationId = null, resumed = false, audience = "learner" }) {
  const t0 = Date.now();
  const goal = String(input?.goal || "").trim().slice(0, 300);
  // A goal about the learner's library DOCUMENTS must read `my_library` (uploads
  // have no subject). "library count" once counted study sessions by subject
  // (51) instead of the 12 uploads because the builder picked a subject view.
  const docGoal = audience === "learner" && isDocumentGoal(goal);
  let name = String(input?.name || "").trim();
  const label = String(input?.label || "").trim().slice(0, 60);
  const given = input?.params && typeof input.params === "object" && !Array.isArray(input.params) ? paramProps(input.params) : {};
  const { params, dropped: droppedParams } = wellFormedParams(given);
  const droppedNote = droppedParams.length ? ` (Ignored params that weren't simple values: ${droppedParams.join(", ")} — the tool reads the data itself.)` : "";
  const hint = input?.hint && typeof input.hint === "object" ? input.hint : {};
  const ev = { user_id: learnerId, goal: goal || "(none)", stages_tried: [], capabilities: [], builder_calls: 0 };
  const finish = async (outcome, out) => {
    await logEvent({ ...ev, outcome: dry && outcome === "created" ? "dry" : outcome, reason: out.reason || null, ms: Date.now() - t0 });
    return out;
  };

  // ── 0. validate ───────────────────────────────────────────────────────
  if (goal.length < 3) return reject("Say what the tool should do (goal).");
  if (!NAME.test(name)) return reject("name must be snake_case, 3–48 characters, starting with a letter.");
  if (builtIn.has(name)) return reject(`"${name}" is an existing tool — use it instead.`);
  if (label.length < 2) return reject("Give the tool a learner-facing label.");
  const pErr = validateParams(params);
  if (pErr.length) return reject(`params: ${pErr.join("; ")}`);
  const forbidden = forbiddenFor(goal);
  if (forbidden.length) return finish("rejected", reject(`Not allowed: ${forbidden.map((f) => f.description).join(" ")}`));

  // Self-repair: rebuild a saved tool in place. Capture the named/ided tool
  // now (its identity + actions: a domain rebuild must carry forward the
  // actions the old tool already had, e.g. by_size while adding by_name) but
  // archive it ONLY at the save point below, once the replacement is built,
  // verified and saved — a build that fails, is rejected or is answered-only
  // must never take the learner's working tool away. Until the swap, the
  // dedupe and name checks below exclude this row so the build replaces it
  // instead of being deduped back to it.
  const replaceRaw = String(input?.replace || "").trim();
  let replaced = null;
  if (replaceRaw && !dry && !resumed) {
    try {
      const q = /^[0-9a-f-]{36}$/i.test(replaceRaw)
        ? edu().from("agent_tools").select("id, name, views, domain, params_schema").eq("owner_id", learnerId).eq("id", replaceRaw)
        : edu().from("agent_tools").select("id, name, views, domain, params_schema").eq("owner_id", learnerId).eq("name", replaceRaw);
      const { data: old } = await q.in("status", ["active", "disabled"]).maybeSingle();
      if (old?.id) {
        if (!String(input?.name || "").trim()) name = old.name;
        replaced = old;
      }
    } catch { /* best-effort */ }
  }
  // The model often names the tool by its LABEL ("Goals percentage") when the
  // stored name is a slug variant ("goals_percentage_fixed") — resolve those
  // too, but only on a UNIQUE match: label (case-insensitive), the slugified
  // label as a name, or a single name the slug prefixes. Ambiguity keeps the
  // current behaviour (no swap) rather than retiring the wrong tool.
  if (replaceRaw && !replaced && !dry && !resumed) {
    try {
      const { data: mine } = await edu().from("agent_tools").select("id, name, label, views, domain, params_schema")
        .eq("owner_id", learnerId).in("status", ["active", "disabled"]).limit(50);
      const pick = pickReplacement(mine || [], replaceRaw);
      if (pick?.id) {
        if (!String(input?.name || "").trim()) name = pick.name;
        replaced = pick;
      }
    } catch { /* best-effort */ }
  }

  /** Retire the replaced tool once its replacement is safely saved. */
  const archiveReplaced = async (newRowId) => {
    if (!replaced?.id || replaced.id === newRowId) return;
    try {
      await edu().from("agent_tools").update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("id", replaced.id).eq("owner_id", learnerId);
    } catch { /* best-effort */ }
  };

  /** A same-name replacement collides with the live unique index
   * (owner, name) WHERE status IN ('active','disabled'): the old row must
   * retire BEFORE the new row inserts, not after — insert-first failed the
   * swap with a raw duplicate-key error (live, 2026-11-17). Every caller is
   * past verification, so a rejected build never reaches this. */
  const retireReplacedBeforeInsert = async () => {
    if (!replaced?.id || replaced.name !== name) return;
    try {
      await edu().from("agent_tools").update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("id", replaced.id).eq("owner_id", learnerId);
    } catch { /* best-effort */ }
  };

  /** Actions a replaced tool had, when it belongs to the domain being rebuilt. */
  const carriedActions = (view) => {
    if (!replaced) return [];
    const sameView = (Array.isArray(replaced.views) && replaced.views.includes(view)) || replaced.domain === view;
    if (!sameView && replaced.name !== name) return [];
    const enumv = replaced.params_schema?.action?.enum;
    return Array.isArray(enumv) ? enumv : [];
  };

  // Build a domain tool: one tool per domain with { action } sub-params, read-only.
  // EVERY action is verified before saving (domain regression); the tool is saved
  // and run. Used for the curated registry AND per-learner dynamic domains.
  async function buildDomain(spec) {
    // Add the requested breakdown as a NEW action (the generic source handles any
    // by_<field>), then re-verify the WHOLE action set before saving.
    const { data: existing } = await edu().from("agent_tools").select("id, status, params_schema, verification, disabled_actions")
      .eq("owner_id", learnerId).eq("name", spec.name).in("status", ["active", "disabled"]).maybeSingle();
    const have = new Set([...(existing?.params_schema?.action?.enum || []), ...carriedActions(spec.view)]);
    const extra = byActionForGoal(goal, spec.view) || aggregateForGoal(goal, spec.view);
    // Carry forward actions the tool already has, so a rebuild never loses a
    // previously-added breakdown (e.g. by_size) while adding another (by_name).
    const actions = Array.from(new Set([...(spec.actions || []), ...have, ...(extra ? [extra] : [])]));
    if (actions.length > MAX_DOMAIN_ACTIONS) return finish("rejected", reject(`This domain would have ${actions.length} actions (max ${MAX_DOMAIN_ACTIONS}) — keep it focused.`));
    const spec2 = { ...spec, actions, params: { ...spec.params, action: { ...spec.params.action, enum: actions } } };
    const covered = actions.every((a) => have.has(a));
    if (existing?.status === "active" && !replaceRaw && covered) {
      // Asking again for an action the learner switched off turns it back on.
      const want = inferAction(goal, actions, spec.view);
      const offNow = Array.isArray(existing.disabled_actions) ? existing.disabled_actions : [];
      if (offNow.includes(want)) {
        await edu().from("agent_tools").update({ disabled_actions: offNow.filter((a) => a !== want), updated_at: new Date().toISOString() }).eq("id", existing.id).eq("owner_id", learnerId);
      }
      return finish("reused", { status: "reused", tool: spec.name, label: spec.label, actions,
        note: `You already have "${spec.label}" — it IS available in this chat: call ${spec.name} with action=(${actions.join("|")}) to answer. Nothing was added or changed and every answer it had still works. Never tell the learner to open Settings.` });
    }
    // The library merge: count/list/by_kind/search are the merged built-in's
    // own actions now, so a build that adds nothing beyond them is not a
    // build at all — the answer is already in the chat as library_documents.
    // (Rebuilds and resumed builds keep the normal flow.)
    if (mergedLibraryEnabled() && spec.view === "my_library" && !resumed && !replaced && libraryBuildIsCovered(actions)) {
      return finish("reused", { status: "reused", tool: spec.name, label: spec.label, actions: LIBRARY_MERGED_ACTIONS,
        note: `This is built in now: ${spec.name} is already in this chat with action=(count|list|by_kind|search) — count, list and by_kind read the Library records and search looks inside the documents. Nothing needs building, drafting or keeping. Answer the learner's question by calling ${spec.name} with the action they need.` });
    }
    // The chats merge (same pattern as library): count/list/search are the
    // merged built-in's own actions, so a build adding nothing beyond them
    // is not a build at all.
    if (mergedChatsEnabled() && spec.view === "my_chats" && !resumed && !replaced && chatsBuildIsCovered(actions)) {
      return finish("reused", { status: "reused", tool: spec.name, label: spec.label, actions: CHATS_MERGED_ACTIONS,
        note: `This is built in now: ${spec.name} is already in this chat with action=(count|list|search) — count gives the exact total, list shows recent chats with their chatIds, search finds chats by what was talked about. Nothing needs building, drafting or keeping. Answer the learner's question by calling ${spec.name} with the action they need.` });
    }
    // The config-driven merged domains (mergedDomains.js): a build adding
    // nothing beyond the merged action set is not a build at all.
    const mCfg = MERGED_DOMAIN_LIST.find((c) => c.view === spec.view && c.enabled());
    if (mCfg && !resumed && !replaced && mCfg.buildIsCovered(actions)) {
      return finish("reused", { status: "reused", tool: spec.name, label: spec.label, actions: mCfg.mergedActions,
        note: `This is built in now: ${spec.name} is already in this chat with action=(${mCfg.mergedActions.join("|")}). Nothing needs building, drafting or keeping. Answer the learner's question by calling ${spec.name} with the action they need.` });
    }
    const def = { kind: "code", steps: [{ id: spec.step, view: spec.view }], source: spec.source };
    const ctxD = { learnerId, callCapability: undefined };
    const checks = await verifyDomainActions(spec2, (_spec, sample) => tryRun(def, spec2.params, sample, ctxD));
    const bad = checks.filter((c) => !c.ok);
    if (bad.length) return finish("rejected", reject(`The ${spec.label} tool failed its own checks for: ${bad.map((b) => b.action).join(", ")}${bad[0]?.error ? ` (${bad[0].error})` : ""}. Nothing was saved.`));
    if (dry) {
      await finish("dry", {});
      return { status: "created", dryRun: true, tool: spec.name, label: spec.label, mode: "code", actions, verified: true,
        note: `DRY RUN — verified every action (${actions.join(", ")}) but did not save.` };
    }
    const action = inferAction(goal, actions, spec.view);
    const out = await tryRun(def, spec2.params, { action }, ctxD);
    // Actions the learner switched off stay off across a rebuild — except the
    // ones this goal is asking for, which the ask itself turns back on.
    const carriedOff = (Array.isArray(existing?.disabled_actions) ? existing.disabled_actions : [])
      .filter((a) => actions.includes(a) && a !== action && a !== extra);
    const existingDraft = existing?.status === "disabled" && !!existing?.verification?.awaitingBuild;
    // The own-copy gate (the hardened build rule): a domain tool serves data a
    // built-in already covers, so a BRAND-NEW one is not even drafted until the
    // learner says they want their own copy anyway — the personal tool appears
    // only when the built-in runs out (or the learner insists on their own).
    // The build is verified and known-good by this point; asking costs nothing
    // saved. Extending/rebuilding a tool the learner already has and resumed
    // (already-approved) builds are not re-gated.
    if (audience === "learner" && !resumed && !replaced && (!existing || existingDraft) && hint?.ownCopy !== true && !(await ownCopyOfferOpen(learnerId, spec.view))) {
      await finish("offer_own_copy", {});
      await logEvent({ user_id: learnerId, goal, outcome: "own_copy_offered", detail: { view: spec.view, name: spec.name } });
      // Delta wording: when the build's actions go beyond the domain's
      // standard set, the built-in does NOT cover the request — the note
      // names the extra as what their own copy would ADD and forbids
      // claiming the built-in can do it (the failure seen live 2026-11-15:
      // the agent claimed the built-in could already break the library
      // down by size when it could not).
      const beyond = actions.filter((a) => !(spec.actions || []).includes(a));
      const note = beyond.length
        ? `STOP — do not build yet, and do not call create_tool again in this turn. A built-in covers the standard answers for this data (listing, counting, searching it), but it CANNOT do: ${beyond.join(", ")} — never claim it can, and never answer this request as if the built-in handled it. The learner's request asks for exactly that extra, and the extra is what their OWN copy would add: it would live in My tools with ${beyond.join(", ")} included, answers they can switch off, rename and extend. Ask them, naming ${beyond.join(", ")} as the extra their copy would have. Only if they say yes, call create_tool again with the same goal and hint set to { "ownCopy": true }. If they say no, answer what the built-in CAN cover and say plainly that ${beyond.join(", ")} needs their own copy.`
        : `STOP — do not build yet, and do not call create_tool again in this turn. A built-in already covers this data: you have built-in tools that list, count and search it, so the learner needs no new tool for this. In plain words, tell the learner you can already do this, and ask if they want their OWN copy anyway — their own tool would live in My tools, with answers they can switch off, rename and extend (other breakdowns of the same data, for example). If their request already asks for MORE than the built-in does, name the extra when you ask. Only if they say yes, call create_tool again with the same goal and hint set to { "ownCopy": true }. If they say no, just answer their question with the built-in.`;
      return { status: "offer_own_copy", tool: spec.name, label: spec.label, actions, note };
    }
    // The build-consent gate: a BRAND-NEW domain tool is only drafted — saved
    // OFF with a card asking the learner to keep it. Extending a tool the
    // learner already has active keeps the consent they already gave; an
    // unapproved draft of it is simply replaced by the new draft.
    await retireReplacedBeforeInsert();
    if (audience === "learner" && !resumed && (!existing || existingDraft)) {
      if (existing?.id) await edu().from("agent_tools").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", existing.id).eq("owner_id", learnerId);
      const { data: row, error } = await edu().from("agent_tools").insert({
        owner_id: learnerId, scope: "learner", audience, name: spec.name, label: spec.label,
        goal: `${spec.label}: ${actions.join(", ")}`, mode: "code", definition: def, params_schema: spec2.params,
        capabilities: [], views: [spec.view], domain: spec.view, actions, disabled_actions: carriedOff,
        area: deriveToolArea({ views: [spec.view] }).area, secondary_areas: [],
        verification: { verdict: "pass", at: new Date().toISOString(), assertions: checks.map((c) => ({ name: `action:${c.action}`, passed: c.ok })), samples: [], awaitingBuild: true },
        status: "disabled", usage_count: 0,
      }).select("id").single();
      if (error) return finish("failed", reject(`Couldn't save the tool: ${error.message}`));
      ev.tool_id = row.id; ev.mode = "code"; ev.capabilities = [];
      ev.stages_tried.push("consent");
      const card = await proposeBuild({ learnerId, conversationId, toolId: row.id,
        proposed: { name: spec.name, label: spec.label, goal, run: { action } },
        does: "It only reads your own data.", items: out.ok ? rowsText(out.rows || []).split("\n").map((s) => s.replace(/^• /, "")) : [] });
      await finish("escalated", {});
      return { status: "needs_consent", drafted: true, tool: spec.name, label: spec.label, mode: "code", actions,
        confirmation: card.confirmation,
        result: out.ok ? { rows: out.rows, total: out.total } : { error: out.error },
        note: `The tool is built and checked, but it is NOT on: it is drafted and OFF, and a card is asking the learner to Keep it. ` + "`result`" + ` is its answer for this request — use it now, and be honest about anything it cannot do. In your own words: say you've built "${spec.label}", what it does, and that tapping Keep on the card saves it in their tools; if they want it different, you'll rebuild it. Never say it is saved or on.` };
    }
    // Retire ONLY after verification passes: a rejected rebuild must never take
    // the learner's working domain tool away.
    if (existing?.id) {
      await edu().from("agent_tools").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", existing.id).eq("owner_id", learnerId);
    }
    // One tool per domain: retire other saved domain tools over the same view
    // (never the learner's Confirm-gated write tools).
    await retireSameView(learnerId, spec.view, spec.name);
    const { data: row, error } = await edu().from("agent_tools").insert({
      owner_id: learnerId, scope: "learner", audience, name: spec.name, label: spec.label,
      goal: `${spec.label}: ${actions.join(", ")}`, mode: "code", definition: def, params_schema: spec2.params,
      capabilities: [], views: [spec.view], domain: spec.view, actions, disabled_actions: carriedOff,
      area: deriveToolArea({ views: [spec.view] }).area, secondary_areas: [],
      verification: { verdict: "pass", at: new Date().toISOString(), assertions: checks.map((c) => ({ name: `action:${c.action}`, passed: c.ok })), samples: [] },
      status: "active", usage_count: 1, last_used_at: new Date().toISOString(),
    }).select("id").single();
    if (error) return finish("failed", reject(`Couldn't save the tool: ${error.message}`));
    ev.tool_id = row.id; ev.mode = "code"; ev.capabilities = [];
    await archiveReplaced(row.id);
    await finish("created", {});
    // Say what changed and that nothing regressed — the model repeats this to the
    // learner in plain words instead of a bare "Saved".
    const added = actions.filter((a) => !have.has(a));
    const kept = actions.filter((a) => have.has(a));
    const summary = [
      added.length ? `Added ${added.length === 1 ? "the answer" : "the answers"} ${added.join(", ")}.` : "No new answer was needed.",
      kept.length ? `Still available: ${kept.join(", ")}.` : "This is its first version.",
      `All ${actions.length} answers were checked before saving, so nothing that worked before has broken.`,
    ].join(" ");
    return { status: "created", tool: spec.name, label: spec.label, mode: "code", actions, added, kept,
      verified: checks.filter((c) => c.ok).map((c) => c.action),
      result: out.ok ? { rows: out.rows, total: out.total } : { error: out.error },
      note: `Saved "${spec.label}". ${summary} Tell the learner in plain words what was added and that the existing answers still work. Next time call ${spec.name} with action=.... The answer for this request is in result.` + (replaced ? REBUILD_HONESTY : "") };
  }

  // 1) A curated domain; 2) a per-learner DYNAMIC domain for a read goal over one
  // of the learner's own-data views (the agent "fills" its own domain tools).
  // Never route a CHANGE goal to a read domain: "delete a task by position"
  // matched the "by <field>" read regex and answered with a count instead of
  // reaching the learner's write tool.
  const dkey = audience === "learner" && !asksForChange(goal) ? domainForGoal(goal) : null;
  if (dkey) return await buildDomain(DOMAINS[dkey]);
  if (audience === "learner" && !asksForChange(goal)) {
    try {
      const lookupD = await schemaLookup(goal, { audience, learnerId });
      const top = (lookupD.views || []).find((x) => DATA_VIEWS[x?.name] && DATA_VIEWS[x.name].scope === "self");
      // A plain read OR a scripted aggregate over that view (no LLM builder).
      if (top?.name && (genericReadGoal(goal) || aggregateForGoal(goal, top.name))) {
        const spec = Object.values(DOMAINS).find((d) => d.view === top.name) || genericDomain(top.name);
        if (spec) return await buildDomain(spec);
      }
    } catch { /* fall through to the generic builder */ }
  }

  // Reuse, don't flood — BY DOMAIN first. A goal that names a data view reuses
  // (or extends) that domain's tool; goal-text fuzzy matching is only a fallback
  // when no view can be identified, and a tool over a DIFFERENT known domain is
  // never reused for this goal. That removes the near-duplicate path.
  if (!dry && !resumed) {
    try {
      const { data: mineRaw } = await edu().from("agent_tools").select("id, name, label, goal, views, domain, mode, params_schema")
        .eq("owner_id", learnerId).eq("status", "active").limit(200);
      const mine = (mineRaw || []).filter((t) => t.id !== replaced?.id);
      const goalView = docGoal ? "my_library" : (dkey ? DOMAINS[dkey].view : bestSelfView(goal));
      const domainOf = (t) => t.domain || (Array.isArray(t.views) && t.views[0]) || null;
      const readGoal = !asksForChange(goal) && (genericReadGoal(goal) || !!aggregateForGoal(goal, goalView));
      // A read/aggregate goal over a view that already has a domain tool EXTENDS
      // that tool (the action is added); it never builds a near-duplicate.
      if (goalView && readGoal) {
        const hasDomainTool = (mineRaw || []).some((t) => domainOf(t) === goalView && isDomainTool(t));
        if (hasDomainTool) {
          const spec = Object.values(DOMAINS).find((d) => d.view === goalView) || genericDomain(goalView);
          if (spec) return await buildDomain(spec);
        }
      }
      // Same-domain candidates only (when the view is known). A read domain tool
      // can't serve a write goal — the split keeps writes on their own tools.
      const sameDomain = goalView ? (mine || []).filter((t) => domainOf(t) === goalView) : (mine || []);
      const candidates = sameDomain.filter((t) => !asksForChange(goal) || !isDomainTool(t));
      // Rank near-duplicates by shared intent words, so "delete a task by
      // position" reuses the by-position tool and not "delete my tasks".
      const overlap = (a, b) => { const B = goalTokens(b); let n = 0; for (const x of goalTokens(a)) if (B.has(x)) n += 1; return n; };
      // Compare the stored goal, its label AND its name: the goal text can be a
      // long sentence ("Delete the learner's chat conversations that contain no
      // messages") while the label ("Delete empty chats") is what the new ask echoes.
      const textsOf = (t) => [t.goal, t.label, String(t.name || "").replace(/_/g, " ")].filter(Boolean);
      const dupes = candidates
        .filter((t) => textsOf(t).some((x) => similarGoal(x, goal)))
        .map((t) => ({ t, s: Math.max(...textsOf(t).map((x) => overlap(x, goal))) }))
        .sort((a, b) => b.s - a.s);
      if (dupes.length) {
        // A document goal may reuse a duplicate ONLY if it reads my_library.
        // Otherwise every wrong-view duplicate (counted sessions by subject) is
        // archived so the corrected build replaces them in one go.
        const usable = docGoal ? dupes.find((d) => (d.t.views || []).includes("my_library"))?.t : dupes[0].t;
        if (usable) return finish("reused", {
          status: "reused", tool: usable.name, label: usable.label,
          note: `You already have a tool for this — "${usable.label}" (${usable.name}). Nothing was added or changed. It IS available in this chat: CALL ${usable.name} now to answer. Never tell the learner to open Settings to run it, and never build a near-duplicate — if it can't do exactly this, extend that tool instead.`,
        });
        for (const { t } of dupes) {
          if (t.id) await edu().from("agent_tools").update({ status: "archived", updated_at: new Date().toISOString() })
            .eq("id", t.id).eq("owner_id", learnerId);
        }
      }
    } catch { /* best-effort: never block a build on the duplicate check */ }
  }

  if (!dry && resumed) {
    const { data: taken } = await edu().from("agent_tools").select("name").eq("owner_id", learnerId).in("status", ["active", "disabled"]).like("name", `${name}%`);
    const names = new Set((taken || []).map((t) => t.name));
    for (let i = 2; names.has(name) && i < 50; i++) name = `${String(input?.name).slice(0, 44)}_${i}`;
  }
  if (!dry && !resumed) {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    // Tools saved in the last day, any status (a learner deleting a tool archives it, so it still counts).
    const { count: today } = await edu().from("agent_tools").select("*", { count: "exact", head: true })
      .eq("owner_id", learnerId).gte("created_at", since);
    if ((today || 0) >= LIMITS.dailyCreates) return finish("rejected", reject(`You can build ${LIMITS.dailyCreates} tools a day — try again tomorrow, or reuse one you have.`));
    // A draft of this name the learner never approved (the card expired) makes way for this one.
    await edu().from("agent_tools").update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("owner_id", learnerId).eq("name", name).eq("status", "disabled").not("verification->awaitingPermission", "is", null);
    await edu().from("agent_tools").update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("owner_id", learnerId).eq("name", name).eq("status", "disabled").not("verification->awaitingBuild", "is", null);
    const { data: mine } = await edu().from("agent_tools").select("id, name").eq("owner_id", learnerId).in("status", ["active", "disabled"]).limit(LIMITS.maxTools + 1);
    if ((mine || []).some((t) => t.name === name && t.id !== replaced?.id)) return reject(`You already have a tool called ${name} — call it, or pick another name, or rebuild it in place: call create_tool again with the same name and replace set to "${name}" (or its exact label), and the old tool is swapped for the corrected build once the new one checks out.`);
    if ((mine || []).filter((t) => t.id !== replaced?.id).length >= LIMITS.maxTools) return finish("rejected", reject(`You have ${LIMITS.maxTools} tools — delete one in Settings → Agent → My tools first.`));
  }

  // What could it use?
  // learnerId is the OWNER: a learner, or an instructor for instructor tools (S7).
  const lookup = await schemaLookup(goal, { audience, learnerId });
  // For a document goal, offer ONLY `my_library` — and IGNORE the model's hint
  // views/capabilities (it kept hinting subject views from schema_lookup, so the
  // builder could still group sessions/XP by subject and call them "documents").
  const slice = docGoal
    ? registrySlice({ views: [], capabilities: [] }, { views: ["my_library"] }, audience)
    : registrySlice(lookup, hint, audience);
  // A resume after an approval must USE what was approved — a gate run once
  // 'resumed' into a tool that answered from an unrelated view instead.
  let mustUse = resumed ? [].concat(hint.capabilities || []).filter((c) => c in CAPABILITIES) : [];
  // A change the learner can allow, after they said yes: build it as a DRAFT (saved off), then ask on a card.
  let draftCap = null;
  const lockedIn = async (names) => {
    const out = [];
    for (const c of names) if (CAPABILITIES[c]?.status === "locked" && (await capabilityStatus(c, { learnerId })) === "locked") out.push(c);
    return out;
  };
  const locked = await lockedIn((lookup.capabilities || []).filter((c) => c.status === "needs_approval").map((c) => c.name));
  // ── 4. escalate (§7.8) — a locked capability named in the hint, or the only thing that fits.
  const toEscalate = async (capability, why) => {
    // A change to the learner's own rows: THEY turn it on, on a card in this chat — no admin.
    if (learnerGrantable(capability) && audience === "learner") {
      ev.stages_tried.push("permission"); ev.capabilities = [capability];
      // No separate "shall I build it?" round: the card is where they say yes (Approve) or no (Not now).
      const proposed = { name, label, goal, params, audience, hint: { views: [].concat(hint.views || []), capabilities: [capability] }, run: input?.run && typeof input.run === "object" ? input.run : {} };
      if (dry) return finish("dry", { status: "needs_permission", dryRun: true, capability: CAPABILITIES[capability].description,
        note: "DRY RUN — no card was made. Live, the learner would get a card to approve this and the tool would be built when they do." });
      const out = await proposePermission({ learnerId, conversationId, capability, proposed });
      return finish("escalated", out);   // logged as asked-for (stages_tried says "permission"), the outcome list is fixed
    }
    const out = await escalate({ learnerId, capability, goal, dry, conversationId,
      proposed: { name, label, params, audience, hint: { views: [].concat(hint.views || []), capabilities: [capability] }, run: input?.run && typeof input.run === "object" ? input.run : {} } });
    ev.stages_tried.push("escalate"); ev.capabilities = [capability]; ev.request_id = out.requestId || null;
    return finish(out.status === "escalated" ? (dry ? "dry" : "escalated") : "rejected", { ...out, ...(why ? { why } : {}) });
  };
  // A change no capability can make (no tool can be built for it): say so and offer to ask
  // the Akoro team; with the learner's yes, that request is a Tool idea on the admins' page.
  // Matched on the CHANGE asked for, not the thing it's about: "rename my chats" isn't "delete chats".
  const writeCaps = (names) => names.some((c) => CAPABILITIES[c]?.kind === "write");
  if (!resumed && audience === "learner" && asksForChange(goal) && !ownChangeAsked(goal) && !writeCaps([].concat(hint.capabilities || []))) {
    ev.stages_tried.push("change_request");
    if (input?.__agreed !== true) return finish("rejected", { status: "offer_request", reason: "no change like this exists yet",
      note: "NOTHING IS SENT. This change can't be made yet — no tool you have or can build does it. In your own words: say you can't do that right now, and offer to ask the Akoro team to add it. Call create_tool again with the same goal once they say yes — that sends the request. Don't suggest workarounds unless they ask." });
    if (dry) return finish("dry", { status: "requested", dryRun: true, note: "DRY RUN — live, this would send the request to the Akoro team." });
    const { createLearnerToolRequest } = await import("../agent-tool-requests/service.js");
    let r;
    try {
      r = await createLearnerToolRequest({ learnerId, body: { category: "other", title: `Change: ${goal}`.slice(0, 120),
        description: `A learner asked their agent to: "${goal.slice(0, 300)}". No change permission does this yet, so no tool could be built for it.` } });
    } catch (e) { return finish("failed", reject(`Couldn't send the request: ${e.message}`)); }
    const when = r.created ? new Date(r.created).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;
    return finish("escalated", { status: "requested", submitted: r.createdNew || !!r.reopened, duplicate: !r.createdNew, reopened: !!r.reopened,
      tell: r.createdNew ? "Sent: the Akoro team sees it on their Agent requests page and decides whether to add it."
        : r.reopened ? "You had asked for this before; it is re-opened for the Akoro team."
        : `You already asked for this${when ? ` on ${when}` : ""}; it is still waiting — say it is the same request, not a new one.` });
  }
  if (!resumed) {
    const hinted = await lockedIn([].concat(hint.capabilities || []));
    // A change the learner can allow: draft it now and show the card in this same reply (Approve is their yes).
    if (hinted.length && learnerGrantable(hinted[0]) && audience === "learner") { draftCap = hinted[0]; mustUse = [draftCap]; ev.stages_tried.push("draft"); }
    else if (hinted.length) return toEscalate(hinted[0]);
    // About OTHER learners, and the best match for that is a locked network
    // capability: the learner's own views can't answer it, and a build from
    // them passed the learner's own scores off as "the other players'".
    const others = draftCap ? null : othersCapabilityFirst(goal, lookup.capabilities || []);
    if (others && locked.includes(others)) return toEscalate(others);
  }
  if (!slice.views.length && !slice.capabilities.length) {
    const first = locked.find((c) => !asksForChange(goal) || CAPABILITIES[c]?.kind !== "write" || c === ownChangeAsked(goal));
    if (first && !resumed) return toEscalate(first);
    return finish("rejected", reject(locked.length ? "This needs a permission that isn't on." : "Nothing available matches this goal, so it can't be built."));
  }

  // ── 1. recipe, 2. spec ─────────────────────────────────────────────────
  // Cheapest and safest first; sandboxed code (stage 3) only when the flag is on.
  // A goal that reads as planning/scheduling goes to code first — a recipe or
  // spec "built" for it returned the rows unsorted into days and still passed.
  const base = hint.mode === "spec" ? ["spec", "recipe"] : ["recipe", "spec"];
  const stages = codeEnabled() ? (hint.mode === "code" || needsCode(goal) ? ["code", ...base] : [...base, "code"]) : base;
  // A spec reads one view — it can't use an approved capability, so a resume skips it.
  const order = mustUse.length ? stages.filter((st) => st !== "spec") : stages;
  const ctx = { learnerId, callCapability };
  const autoTargetValues = {};   // row-identity params declared by the hard-coded-target check (C2), filled at register
  let lastProblem = null;
  let inexpressible = false;   // the builder said what's available can't express it
  const tried = [];            // every attempt's problem, kept on a failed resume for the admin
  for (const stage of order) {
    ev.stages_tried.push(stage);
    let feedback = null;
    let fallback = null;   // a verified build that returned nothing for every sample — kept if the repair is no better
    for (let attempt = 1; attempt <= 3 && ev.builder_calls < LIMITS.builderCalls; attempt++) {
      ev.builder_calls++;
      let built;
      try { built = await buildDefinition({ stage, goal, params, slice, feedback, learnerId, platformPays: dry || resumed, approved: mustUse.map(howToUse) }); }
      catch (e) {
        if (/coin|balance/i.test(String(e?.message))) return finish("rejected", reject("Not enough coins to build a tool."));
        lastProblem = `builder failed: ${e.message}`; tried.push(`${stage}#${attempt}: ${lastProblem}`); break;
      }
      if (built.notExpressible) {
        lastProblem = built.notExpressible; inexpressible = true; tried.push(`${stage}#${attempt}: not expressible: ${lastProblem}`);
        // What was approved for this goal answers it: one repair before giving up.
        if (mustUse.length && attempt === 1) { feedback = `"${built.notExpressible}" — but ${mustUse.join(", ")} was approved for this goal: use it`; continue; }
        // At the code stage "needs scheduling/logic" is not a reason — code IS the logic. One repair.
        if (stage === "code" && attempt === 1 && /schedul|logic|per day|spread|skip/i.test(String(built.notExpressible))) { feedback = `"${built.notExpressible}" — you are writing code: write run() that does exactly that`; continue; }
        break;
      }
      if (!built.definition) { feedback = built.error || "no definition"; lastProblem = feedback; tried.push(`${stage}#${attempt}: ${feedback}`); continue; }
      if (built.definition.kind !== stage) built.definition.kind = stage === "spec" && built.definition.from ? "spec" : built.definition.kind;
      const v = await validateDefinition(built.definition, params, { audience, learnerId, assume: draftCap ? [draftCap] : [] });
      if (v.ok && built.definition.kind === "code") v.errors.push(...inventedDates(built.definition.source, goal, params));
      // No hard-coded targets in a write tool: declare the row-identity
      // param the builder reached past (default = the row THIS request
      // named, so the card's dry run still lists exactly its rows), then
      // send the build back with feedback naming the param to bind.
      if (v.ok) {
        for (const h of hardCodedTargets(built.definition, goal, params)) {
          if (h.paramDefault) continue; // register strips it from the saved schema; the builder cannot edit params
          if (!params[h.param]) {
            params[h.param] = { type: "string", description: `The ${h.field} of the specific row this tool acts on — named by the learner each run`, default: h.value };
            autoTargetValues[h.param] = h.value;
          }
          v.errors.push(h.message);
        }
      }
      for (const c of mustUse) if (!v.uses.capabilities.includes(c)) v.errors.push(howToUse(c));
      if (v.errors.length) v.ok = false;
      if (!v.ok) { feedback = v.errors.slice(0, 6).join("; "); lastProblem = feedback; tried.push(`${stage}#${attempt}: ${feedback}`); continue; }
      const check = await verifyTool(built.definition, params, built.samples || [], ctx);
      if (check.verdict !== "PASS") {
        feedback = check.assertions.filter((a) => !a.passed).map((a) => `${a.name}: ${a.detail ? (typeof a.detail === "string" ? a.detail : JSON.stringify(a.detail)).slice(0, 200) : a.actual ?? ""}`).join("; ");
        lastProblem = feedback; tried.push(`${stage}#${attempt}: verify: ${feedback}`); continue;
      }
      if (check.emptyEverywhere && attempt === 1) {
        fallback = { built, v, check };
        feedback = "every sample returned no rows — check the filters (this learner does have data)";
        lastProblem = feedback;
        continue;
      }
      return register({ stage, built, v, check });
    }
    if (fallback) return register({ stage, ...fallback });
  }
  // Nothing available could express it, but a locked capability might.
  // Never offer a DIFFERENT change than the one asked for (a rename must not become a delete card).
  const fallback = locked.find((c) => !asksForChange(goal) || CAPABILITIES[c]?.kind !== "write" || c === ownChangeAsked(goal));
  if (fallback && !resumed && !draftCap && inexpressible) return toEscalate(fallback, lastProblem);
  return finish("rejected", reject(`Couldn't build it safely: ${String(lastProblem || "no stage could express it").slice(0, 240)}`, (resumed || dry) ? { tried: tried.map((t) => t.slice(0, 300)) } : {}));

  /** Save the built tool switched OFF and ask the learner on a card, showing what it would change right now. */
  async function draftAndAsk({ def, runNow }) {
    if (!runNow.ok) return finish("rejected", reject(`Built, but it couldn't run: ${runNow.error}`));
    const changes = { items: (runNow.write?.targets || []).map((t) => t.label), more: runNow.write?.more || 0,
      refs: (runNow.write?.targets || []).map((t) => String(t.ref)) };
    if (dry) {
      await finish("dry", {});
      return { status: "needs_permission", dryRun: true, tool: name, label, wouldChange: changes.items,
        note: "DRY RUN — the tool was drafted and checked but NOT saved, and no card was made. Live, the learner gets a card showing what it would change; Approve turns it on." };
    }
    await retireReplacedBeforeInsert();
    const { data: row, error } = await edu().from("agent_tools").insert({ owner_id: learnerId, scope: "learner", audience, ...def,
      status: "disabled", verification: { ...def.verification, awaitingPermission: draftCap }, usage_count: 0 }).select("id").single();
    if (error) return finish("failed", reject(`Couldn't save the draft: ${error.message}`));
    ev.tool_id = row.id; ev.mode = def.mode; ev.capabilities = def.capabilities;
    // The card must carry this request's run values: at tap time the tool
    // runs again from proposed.run, and a parameterized tool (its target
    // title, say) acts on nothing without them. autoTargetValues pins any
    // row-identity param the validation check declared mid-build.
    const out = await proposePermission({ learnerId, conversationId, capability: draftCap, proposed: { name, label, goal, run: { ...(input?.run && typeof input.run === "object" ? input.run : {}), ...autoTargetValues } }, toolId: row.id, changes });
    await finish("escalated", {});   // logged as asked-for (stages_tried says "draft"), the outcome list is fixed
    return { ...out, tool: name, label, drafted: true };
  }

  /** Save a brand-new built tool switched OFF and ask the learner on a card to keep it. */
  async function draftBuildAndAsk({ def, runNow }) {
    const { data: row, error } = await edu().from("agent_tools").insert({ owner_id: learnerId, scope: "learner", audience, ...def,
      domain: (def.views || [])[0] || null, actions: def.params_schema?.action?.enum || null,
      status: "disabled", verification: { ...def.verification, awaitingBuild: true }, usage_count: 0 }).select("id").single();
    if (error) return finish("failed", reject(`Couldn't save the draft: ${error.message}`));
    ev.tool_id = row.id; ev.mode = def.mode; ev.capabilities = def.capabilities;
    ev.stages_tried.push("consent");
    const items = runNow.ok ? (runNow.write ? (runNow.write.targets || []).map((t) => t.label)
      : rowsText(runNow.rows || []).split("\n").map((s) => s.replace(/^• /, ""))) : [];
    const card = await proposeBuild({ learnerId, conversationId, toolId: row.id,
      refs: runNow.write ? (runNow.write.targets || []).map((t) => String(t.ref)) : [],
      proposed: { name, label, goal, run: { ...(input?.run && typeof input.run === "object" ? input.run : {}), ...autoTargetValues } },
      does: runNow.write ? "It can change your data — only ever after you confirm each change on a card." : "It only reads your own data.",
      writes: !!runNow.write, items, more: runNow.write?.more || 0 });
    await finish("escalated", {});
    return { status: "needs_consent", drafted: true, tool: name, label, mode: def.mode, confirmation: card.confirmation,
      result: runNow.ok ? (runNow.write ? await writeOutcome({ learnerId, dry: true, tool: { label }, write: runNow.write })
        : { rows: runNow.rows, total: runNow.total, truncated: runNow.truncated }) : { error: runNow.error },
      note: `The tool is built and checked, but it is NOT on: it is drafted and OFF, and a card is asking the learner to Keep it. ` + "`result`" + ` is its answer for this request — use it now, and be honest about anything it cannot do. In your own words: say you've built "${label}", what it does, and that tapping Keep on the card saves it in their tools; if they want it different — another grouping, range or field — say you'll rebuild it, and call create_tool again with the same name and ` + "`replace`" + ` set to "${name}". Never say it is saved or on.${droppedNote}` };
  }

  async function register({ stage, built, v, check }) {
    ev.mode = stage;
    ev.capabilities = v.uses.capabilities;
    const verification = { verdict: check.verdict, at: new Date().toISOString(),
      assertions: check.assertions.map((a) => ({ name: a.name, passed: a.passed })), samples: built.samples || [] };
    // The first run answers THIS request: the agent's run values (or the
    // builder's first sample), with any auto-declared row-identity param
    // pinned to the row this request actually named — never a sample's row.
    const runInput = { ...(input?.run && typeof input.run === "object" ? input.run : (built.samples || [])[0] || {}), ...autoTargetValues };
    // Strip baked targets BEFORE the first run, not only from the saved
    // schema: a param default that names a specific row (flagged by
    // hardCodedTargets) must not steer this build's own first run either.
    // The request's row, when it named one, arrives via runInput /
    // autoTargetValues — never via a default. (Live, 2026-11-18: a
    // rebuild whose request named no row still staged a delete card for
    // the chat its title default pointed at, because runNow ran with the
    // original params.)
    const bakedDefaults = hardCodedTargets(built.definition, goal, params).filter((h) => h.paramDefault);
    let runParams = params;
    if (bakedDefaults.length) {
      runParams = JSON.parse(JSON.stringify(params || {}));
      const rp = runParams?.properties && typeof runParams.properties === "object" ? runParams.properties : runParams;
      for (const h of bakedDefaults) if (rp[h.param]) delete rp[h.param].default;
    }
    const runNow = await tryRun(built.definition, runParams, runInput, ctx);
    const def = { name, label, goal, mode: stage, definition: built.definition, params_schema: runParams,
      capabilities: v.uses.capabilities, views: [...new Set(v.uses.views)], verification };
    // One taxonomy: the area is derived from the main read, never chosen.
    Object.assign(def, deriveToolArea(def));
    if (draftCap) return draftAndAsk({ def, runNow });
    if (dry) {
      await finish("created", {});
      return { status: "created", dryRun: true, tool: name, label, mode: stage, verified: true, definition: built.definition,
        result: runNow.ok ? (runNow.write ? await writeOutcome({ learnerId, dry: true, tool: { label }, write: runNow.write })
          : { rows: runNow.rows, total: runNow.total, truncated: runNow.truncated }) : { error: runNow.error },
        note: "DRY RUN — the tool was built and verified but NOT saved. Answer the learner from `result`." + droppedNote };
    }
    // Option 2 (answer-only): a pure computed read is answered from the
    // verified run above and NOT saved — no draft, no card. The verified
    // definition is stashed on the event so an explicit "save that" (or the
    // daily repeated-computation sweep) can save this exact tool later.
    if (audience === "learner" && !resumed && !replaced && isAnswerOnlyRead(def, runNow)) {
      ev.detail = { name, label, goal, mode: stage, definition: built.definition, params_schema: params,
        capabilities: v.uses.capabilities, views: def.views, samples: built.samples || [], runInput };
      await finish("answered", {});
      return { status: "answered", ephemeral: true, tool: name, label, mode: stage, verified: true,
        result: { rows: runNow.rows, total: runNow.total, truncated: runNow.truncated },
        note: `ONE-OFF — you worked out the answer and it is in \`result\`; the tool was NOT saved and the learner was not asked to keep it. Answer from result in plain words, and mention it wasn't saved as a tool. If the learner asks to save or keep it, call save_computation. Never say the tool is in their tools.${droppedNote}` };
    }
    // The build-consent gate: a brand-new learner tool is drafted OFF and the
    // learner commits it on a card. The build above already ran and verified —
    // it is the silent dry run that makes the card's ask honest. (Resumed
    // builds were approved on a card or by an admin; draftCap has its own card.)
    if (audience === "learner" && !resumed && !replaced) return draftBuildAndAsk({ def, runNow });
    await retireReplacedBeforeInsert();
    const { data: row, error } = await edu().from("agent_tools").insert({ owner_id: learnerId, scope: "learner", audience, ...def, domain: (def.views || [])[0] || null, actions: def.params_schema?.action?.enum || null, usage_count: runNow.ok ? 1 : 0, last_used_at: new Date().toISOString() }).select("id").single();
    if (error) return finish("failed", reject(`Couldn't save the tool: ${error.message}`));
    ev.tool_id = row.id;
    await archiveReplaced(row.id);
    // One tool per domain: a newly saved action tool retires older action tools
    // over the same view (write tools are untouched — they have no `action`).
    if (def.params_schema?.action?.enum && def.views?.[0]) await retireSameView(learnerId, def.views[0], name);
    await finish("created", {});
    return {
      status: "created", tool: name, label, mode: stage, verified: true,
      result: runNow.ok ? (runNow.write ? await writeOutcome({ learnerId, conversationId, dry: false, tool: { id: row.id, name, label }, write: runNow.write })
        : { rows: runNow.rows, total: runNow.total, truncated: runNow.truncated }) : { error: runNow.error },
      note: `Saved as the learner's tool "${label}". \`result\` is its answer for this request — use it now. Next time, call ${name} directly.${droppedNote}` + (replaced ? REBUILD_HONESTY : ""),
      __newTool: toolDef(def),
    };
  }
}

/** A saved tool as an OpenAI function. */
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

/**
 * The catalogue: the learner's own tools (most recently used first) and the
 * tools an admin promoted to everyone (most used first). The learner's own
 * tool wins a name clash; built-in names never reach here (§7.10).
 */
export async function learnerToolDefsWithAreas(learnerId, audience = "learner") {
  const cols = "name, label, goal, params_schema, scope, actions, disabled_actions, views, capabilities, area";
  const [{ data: mine }, { data: platform }] = await Promise.all([
    edu().from("agent_tools").select(cols)
      .eq("owner_id", learnerId).eq("status", "active").order("last_used_at", { ascending: false, nullsFirst: false }).limit(LIMITS.inCatalogue),
    edu().from("agent_tools").select(cols)
      .eq("scope", "platform").eq("audience", audience).eq("status", "active").order("usage_count", { ascending: false }).limit(LIMITS.inCatalogue),
  ]);
  const own = new Set((mine || []).map((t) => t.name));
  const rows = [...(mine || []), ...(platform || []).filter((t) => !own.has(t.name))];
  // Rows built before areas were stored derive theirs on the fly — nothing is area-less.
  const areas = new Map(rows.map((t) => [t.name, t.area || deriveToolArea(t).area]));
  const labels = new Map(rows.map((t) => [t.name, t.label || t.name]));
  return { defs: rows.map(toolDef).filter(Boolean), areas, labels };
}

export async function learnerToolDefs(learnerId, audience = "learner") {
  return (await learnerToolDefsWithAreas(learnerId, audience)).defs;
}

/**
 * Turn on a tool the learner kept on its build card (confirmations.confirmBuild):
 * flips a build-consent draft (verification.awaitingBuild) to active and retires
 * same-view domain siblings, exactly as a direct save would have. → the tool
 * row, or null when the draft is gone or was never awaiting consent.
 */
export async function activateBuiltTool(learnerId, toolId) {
  const { data: t } = await edu().from("agent_tools").select("id, name, label, views, params_schema, verification")
    .eq("id", toolId).eq("owner_id", learnerId).eq("status", "disabled").maybeSingle();
  if (!t?.verification?.awaitingBuild) return null;
  const { awaitingBuild, ...kept } = t.verification;
  await edu().from("agent_tools").update({ status: "active", verification: { ...kept, approvedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq("id", t.id);
  if (t.params_schema?.action?.enum && t.views?.[0]) await retireSameView(learnerId, t.views[0], t.name);
  return t;
}

/** Appended to a rebuild's result note: the agent reports only what it verified. */
export const REBUILD_HONESTY = " This REBUILDS a tool the learner already had. In your reply, report only what you verified: if the old tool's answer was wrong and the new answer differs, say what changed; if you did not establish what was wrong with the old tool, say plainly that you couldn't confirm the fault - never invent a cause or a story about the old tool.";

/** Run a saved tool — the learner's own, else a platform one. → result, or null when there's no such tool. */
/** The learner's library domain row state for the merged def/dispatch, or
 *  null when they have none. Only the fields the merge reads. */
export async function getLibraryToolState(learnerId) {
  const { data: t } = await edu().from("agent_tools").select("id, status, actions, disabled_actions, params_schema")
    .eq("owner_id", learnerId).eq("name", "library_documents").in("status", ["active", "disabled"]).maybeSingle();
  if (!t) return null;
  const acts = Array.isArray(t.actions) && t.actions.length ? t.actions : (t.params_schema?.action?.enum || []);
  return { id: t.id, status: t.status, actions: acts, disabledActions: Array.isArray(t.disabled_actions) ? t.disabled_actions : [] };
}

/** Serve a BASE library action (count/list/by_kind) platform-side: the real
 *  domain source over the learner's own my_library rows, with NO tool row —
 *  the merged built-in's records read. Same result shape as runLearnerTool. */
export async function runLibraryViewAction(action, input, learnerId) {
  const spec = DOMAINS.library_documents;
  const def = { kind: "code", steps: [{ id: spec.step, view: spec.view }], source: spec.source };
  const r = await tryRun(def, spec.params, { ...(input || {}), action }, { learnerId, callCapability: undefined });
  if (!r.ok) return { error: `The Library couldn't be read just now: ${r.error}` };
  return { tool: spec.label, rows: r.rows, total: r.total, truncated: r.truncated, via: "library records" };
}
export async function getChatsToolState(learnerId) {
  const { data: t } = await edu().from("agent_tools").select("id, status, actions, disabled_actions, params_schema")
    .eq("owner_id", learnerId).eq("name", "my_chats").in("status", ["active", "disabled"]).maybeSingle();
  if (!t) return null;
  const acts = Array.isArray(t.actions) && t.actions.length ? t.actions : (t.params_schema?.action?.enum || []);
  return { id: t.id, status: t.status, actions: acts, disabledActions: Array.isArray(t.disabled_actions) ? t.disabled_actions : [] };
}
export async function runChatsViewAction(action, input, learnerId) {
  const spec = genericDomain("my_chats");
  const def = { kind: "code", steps: [{ id: spec.step, view: spec.view }], source: spec.source };
  const r = await tryRun(def, spec.params, { ...(input || {}), action }, { learnerId, callCapability: undefined });
  if (!r.ok) return { error: `Your chats couldn't be read just now: ${r.error}` };
  return { tool: spec.label, rows: r.rows, total: r.total, truncated: r.truncated, via: "chat records" };
}
function mergedSpecFor(name) {
  return DOMAINS[name] || genericDomain(name);
}
export async function getMergedToolState(learnerId, name) {
  const { data: t } = await edu().from("agent_tools").select("id, status, actions, disabled_actions, params_schema")
    .eq("owner_id", learnerId).eq("name", name).in("status", ["active", "disabled"]).maybeSingle();
  if (!t) return null;
  const acts = Array.isArray(t.actions) && t.actions.length ? t.actions : (t.params_schema?.action?.enum || []);
  return { id: t.id, status: t.status, actions: acts, disabledActions: Array.isArray(t.disabled_actions) ? t.disabled_actions : [] };
}
export async function runMergedViewAction(name, action, input, learnerId) {
  const spec = mergedSpecFor(name);
  if (!spec) return { error: "That tool isn't available right now." };
  const def = { kind: "code", steps: [{ id: spec.step, view: spec.view }], source: spec.source };
  const r = await tryRun(def, spec.params, { ...(input || {}), action }, { learnerId, callCapability: undefined });
  if (!r.ok) return { error: `That couldn't be read just now: ${r.error}` };
  return { tool: spec.label, rows: r.rows, total: r.total, truncated: r.truncated, via: `${spec.label} records` };
}

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

export async function runLearnerTool(name, input, learnerId, { callCapability, conversationId = null, dry = false, audience = "learner" }) {
  if (!NAME.test(String(name || ""))) return null;
  let { data: t } = await edu().from("agent_tools").select("*").eq("owner_id", learnerId).eq("name", name).in("status", ["active", "disabled"]).maybeSingle();
  if (!t) ({ data: t } = await edu().from("agent_tools").select("*").eq("scope", "platform").eq("audience", audience).eq("name", name).in("status", ["active", "disabled"]).maybeSingle());
  if (t && (t.audience || "learner") !== audience) return null;   // never run another audience's tool
  if (!t) return null;
  const platform = t.scope === "platform";
  if (t.status !== "active") return { error: platform ? "This Akoro tool is turned off for now." : "This tool is turned off — rebuild it or turn it back on in Settings → Agent → My tools." };
  // An action the learner switched off (or deleted) must not run even if the
  // model asks for it by name — the catalogue already hides it (toolDef).
  if (input?.action && toolActions(t).length && !visibleActions(t).includes(input.action)) {
    return { error: "That action is turned off for this tool — turn it back on in Settings → Agent → My tools." };
  }
  // Re-check on EVERY call: a revoked grant or removed view takes effect at once (§7.10).
  for (const c of t.capabilities || []) {
    const cap = CAPABILITIES[c];
    if ((await capabilityStatus(c, { learnerId })) !== "enabled" || !(cap?.kind === "read" || cap?.target)) return { error: "This tool uses something that's no longer allowed, so it can't run." };
  }
  for (const v of t.views || []) if (!DATA_VIEWS[v]) return { error: "This tool uses data that's no longer available." };
  // Always as THIS learner: views are forced to their own rows (viewRuntime).
  const r = await tryRun(t.definition, t.params_schema, input || {}, { learnerId, callCapability });
  const fail = r.ok ? 0 : (t.fail_streak || 0) + 1;
  // A learner's tool turns itself off after 3 failures in a row; a platform tool
  // never does on one learner's failures — admins see its fail streak instead.
  await edu().from("agent_tools").update({
    usage_count: (t.usage_count || 0) + 1, last_used_at: new Date().toISOString(), fail_streak: fail,
    ...(fail >= 3 && !platform ? { status: "disabled" } : {}), updated_at: new Date().toISOString(),
  }).eq("id", t.id);
  if (!r.ok) return { error: fail >= 3 && !platform ? "This tool failed three times in a row and was turned off — rebuild it." : `The tool couldn't run: ${r.error}` };
  if (r.write) return writeOutcome({ learnerId, conversationId, dry, tool: t, write: r.write });
  return { tool: t.label, rows: r.rows, total: r.total, truncated: r.truncated };
}

/**
 * Save a previously ANSWERED one-off computation as a real tool — the
 * learner's explicit "save that", or the message a tool suggestion sends
 * when tapped. The stashed definition is re-verified and saved ACTIVE (the
 * ask itself is the consent); nothing is rebuilt, so the saved tool computes
 * exactly what the learner already saw. `hint` picks among recent one-offs
 * by goal words; without it, the most recent is saved.
 */
export async function saveComputation({ learnerId, hint = null, callCapability }) {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data: events } = await edu().from("self_tool_events")
    .select("id, goal, detail, created_at").eq("user_id", learnerId).eq("outcome", "answered")
    .gte("created_at", since).order("created_at", { ascending: false }).limit(25);
  const candidates = (events || []).filter((e) => e.detail && e.detail.definition && e.detail.name);
  if (!candidates.length) return { status: "none", note: "No recent one-off computation to save. If the learner still wants the tool, build it with create_tool." };
  let pick = candidates[0];
  if (hint) {
    const hintTokens = goalTokens(hint);
    const scored = candidates.map((e) => ({ e, score: [...hintTokens].filter((t) => goalTokens(e.goal).has(t)).length })).sort((a, b) => b.score - a.score);
    if (scored[0].score > 0) pick = scored[0].e;
  }
  const d = pick.detail;
  const { data: existing } = await edu().from("agent_tools").select("id").eq("owner_id", learnerId).eq("name", d.name).in("status", ["active", "disabled"]).maybeSingle();
  if (existing) return { status: "exists", tool: d.name, label: d.label, note: `"${d.label}" is already in the learner's tools — just call it by name.` };
  const { count } = await edu().from("agent_tools").select("id", { count: "exact", head: true }).eq("owner_id", learnerId).in("status", ["active", "disabled"]);
  if ((count || 0) >= LIMITS.maxTools) return { status: "full", error: `The learner already has ${LIMITS.maxTools} tools — one must be removed in Settings before another can be saved.` };
  const ctx = { learnerId, callCapability, audience: "learner" };
  const v = await validateDefinition(d.definition, d.params_schema || {}, { audience: "learner", learnerId, assume: [] });
  if (!v.ok) return { status: "stale", error: "That computation can no longer be saved — what it reads has changed. Build it again with create_tool." };
  const check = await verifyTool(d.definition, d.params_schema || {}, d.samples || [], ctx);
  if (check.verdict !== "PASS") return { status: "stale", error: "That computation no longer checks out — build it again with create_tool." };
  const def = { name: d.name, label: d.label, goal: d.goal, mode: d.mode || d.definition?.kind || "spec",
    definition: d.definition, params_schema: d.params_schema || {},
    capabilities: v.uses.capabilities, views: [...new Set(v.uses.views)],
    verification: { verdict: check.verdict, at: new Date().toISOString(), assertions: check.assertions.map((a) => ({ name: a.name, passed: a.passed })), samples: d.samples || [] } };
  Object.assign(def, deriveToolArea(def));
  const { data: row, error } = await edu().from("agent_tools").insert({ owner_id: learnerId, scope: "learner", audience: "learner", ...def,
    domain: (def.views || [])[0] || null, actions: def.params_schema?.action?.enum || null,
    usage_count: 1, last_used_at: new Date().toISOString() }).select("id").single();
  if (error) return { status: "failed", error: `Couldn't save the tool: ${error.message}` };
  if (def.params_schema?.action?.enum && def.views?.[0]) await retireSameView(learnerId, def.views[0], d.name);
  await logEvent({ user_id: learnerId, goal: d.goal, outcome: "created", mode: def.mode, stages_tried: [], capabilities: def.capabilities, tool_id: row.id, reason: "saved one-off computation", builder_calls: 0, ms: 0 });
  const run = await tryRun(def.definition, def.params_schema, d.runInput || {}, ctx);
  return { status: "saved", tool: d.name, label: d.label,
    result: run.ok ? { rows: run.rows, total: run.total } : { error: run.error },
    note: `Saved "${d.label}" as the learner's tool — it is in My tools now and can be called by name. Confirm in plain words.`,
    __newTool: toolDef({ ...def, scope: "learner" }) };
}

/**
 * A tool with a write step ran: in a dry run say what WOULD change; otherwise
 * store the proposal and return the confirmation card (nothing written).
 */
async function writeOutcome({ learnerId, conversationId, dry, tool, write }) {
  const items = write.targets.map((x) => x.label);
  if (dry) return { status: "would_need_confirmation", dryRun: true, tool: tool.label, action: write.does, items, more: write.more || 0,
    note: "DRY RUN — nothing was proposed or changed. Say what would change and that the learner would confirm it on a card." };
  return { tool: tool.label, ...(await proposeWrite({ learnerId, conversationId, tool, write })) };
}

/** Learner tools unused for `days` days are archived (§7.10 health). Platform tools are the admins' call. */
export async function archiveUnusedTools(days = 60) {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const now = new Date().toISOString();
  const { data, error } = await edu().from("agent_tools").update({ status: "archived", updated_at: now })
    .eq("scope", "learner").in("status", ["active", "disabled"])
    .or(`last_used_at.lt.${cutoff},and(last_used_at.is.null,created_at.lt.${cutoff})`).select("id");
  if (error) throw new Error(`archive failed: ${error.message}`);
  return { archived: (data || []).length };
}

export async function listMyTools(learnerId) {
  const { data, error } = await edu().from("agent_tools").select("id, name, label, goal, mode, status, usage_count, last_used_at, created_at, domain, actions, disabled_actions, views, area, secondary_areas, tags")
    .eq("owner_id", learnerId).in("status", ["active", "disabled"]).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error("Couldn't load your tools");
  return (data || []).map((t) => ({ ...t, actions: Array.isArray(t.actions) ? t.actions : [], disabled_actions: Array.isArray(t.disabled_actions) ? t.disabled_actions : [],
    area: t.area || deriveToolArea(t).area, secondary_areas: Array.isArray(t.secondary_areas) ? t.secondary_areas : [], tags: Array.isArray(t.tags) ? t.tags : [] }))
    .map(presentMergedToolRow).filter((t) => t !== null);
}

export async function updateMyTool(learnerId, id, patch) {
  const { data: row } = await edu().from("agent_tools")
    .select("id, name, label, status, domain, actions, params_schema, disabled_actions")
    .eq("owner_id", learnerId).eq("id", id).in("status", ["active", "disabled"]).maybeSingle();
  if (!row) throw Object.assign(new Error("Tool not found"), { status: 404 });
  const allowed = {};
  if (typeof patch?.label === "string" && patch.label.trim().length >= 2) allowed.label = patch.label.trim().slice(0, 60);
  if (["active", "disabled"].includes(patch?.status)) allowed.status = patch.status;
  if (Array.isArray(patch?.tags)) {
    allowed.tags = [...new Set(patch.tags.map((x) => String(x || "").trim().slice(0, 24)).filter(Boolean))].slice(0, 8);
  }
  if (patch?.delete === true) allowed.status = "archived";

  // Per-action management (domain tools): switch ONE action off or on, or
  // delete it from the set. Deleting the last action archives the tool — an
  // empty domain is no tool at all.
  const acts = toolActions(row);
  const mRule = mergedRowRule(row);
  const targetedAction = typeof patch?.deleteAction === "string" && patch.deleteAction ? patch.deleteAction
    : (typeof patch?.action === "string" && patch.action ? patch.action : null);
  if (mRule && targetedAction && mRule.mergedActions.includes(targetedAction)) {
    throw Object.assign(new Error("That action is built in — it can't be changed here"), { status: 400 });
  }
  let nextActions = null, nextOff = null;
  if (typeof patch?.deleteAction === "string" && patch.deleteAction) {
    if (!acts.includes(patch.deleteAction)) throw Object.assign(new Error("That action doesn't exist on this tool"), { status: 400 });
    nextActions = acts.filter((a) => a !== patch.deleteAction);
    nextOff = (Array.isArray(row.disabled_actions) ? row.disabled_actions : []).filter((a) => a !== patch.deleteAction);
    if (!nextActions.length) allowed.status = "archived";
    if (mRule && !nextActions.filter((a) => !mRule.mergedActions.includes(a)).length) allowed.status = "archived";
  } else if (typeof patch?.action === "string" && ["active", "disabled"].includes(patch?.actionStatus)) {
    if (!acts.includes(patch.action)) throw Object.assign(new Error("That action doesn't exist on this tool"), { status: 400 });
    const off = new Set(Array.isArray(row.disabled_actions) ? row.disabled_actions : []);
    if (patch.actionStatus === "disabled") off.add(patch.action); else off.delete(patch.action);
    nextOff = [...off];
  }
  if (nextActions) {
    allowed.actions = nextActions;
    allowed.params_schema = { ...(row.params_schema || {}), action: { ...(row.params_schema?.action || {}), enum: nextActions } };
  }
  if (nextOff) allowed.disabled_actions = nextOff;
  if (!Object.keys(allowed).length) throw Object.assign(new Error("Nothing to change"), { status: 400 });
  const { data, error } = await edu().from("agent_tools").update({ ...allowed, updated_at: new Date().toISOString(), ...(allowed.status !== "active" ? { fail_streak: 0 } : {}) })
    .eq("owner_id", learnerId).eq("id", row.id).in("status", ["active", "disabled"]).select("id, name, label, status, domain, actions, disabled_actions, area, secondary_areas, tags").maybeSingle();
  if (error) throw new Error("Couldn't update the tool");
  if (!data) throw Object.assign(new Error("Tool not found"), { status: 404 });
  const presented = { ...data, actions: Array.isArray(data.actions) ? data.actions : [], disabled_actions: Array.isArray(data.disabled_actions) ? data.disabled_actions : [],
    secondary_areas: Array.isArray(data.secondary_areas) ? data.secondary_areas : [], tags: Array.isArray(data.tags) ? data.tags : [] };
  return presentMergedToolRow(presented) || presented;
}
