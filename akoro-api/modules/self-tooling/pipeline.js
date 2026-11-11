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
import { createExpect, repeatVerdict } from "../verify/assertions.js";
import { escalate } from "./escalation.js";
import { proposeWrite, proposePermission } from "./confirmations.js";
import { codeEnabled } from "./sandbox/index.js";
import { basisColumns, currentActionBasis } from "../agent-runtime/actionBasis.js";
import { isDocumentGoal, similarGoal } from "./toolSimilarity.js";
import { DOMAINS, domainForGoal, genericDomain, genericReadGoal, inferAction, verifyDomainActions, byActionForGoal, aggregateForGoal, bestSelfView, MAX_DOMAIN_ACTIONS } from "./domains.js";

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
  const expect = createExpect(sink);
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
  return { verdict: repeatVerdict({ assertions: sink }), assertions: sink, runs, emptyEverywhere: runs.every((r) => r.ok && !r.rows.length) };
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

  // Self-repair: rebuild a saved tool in place — archive the named/ided tool
  // first, so the build below replaces it instead of being deduped back to it.
  // Capture its identity + actions BEFORE archiving: a domain rebuild must carry
  // forward the actions the old tool already had (e.g. by_size while adding by_name).
  const replaceRaw = String(input?.replace || "").trim();
  let replaced = null;
  if (replaceRaw && !dry && !resumed) {
    try {
      const q = /^[0-9a-f-]{36}$/i.test(replaceRaw)
        ? edu().from("agent_tools").select("id, name, views, domain, params_schema").eq("owner_id", learnerId).eq("id", replaceRaw)
        : edu().from("agent_tools").select("id, name, views, domain, params_schema").eq("owner_id", learnerId).eq("name", replaceRaw);
      const { data: old } = await q.in("status", ["active", "disabled"]).maybeSingle();
      if (old?.id) {
        await edu().from("agent_tools").update({ status: "archived", updated_at: new Date().toISOString() })
          .eq("id", old.id).eq("owner_id", learnerId);
        if (!String(input?.name || "").trim()) name = old.name;
        replaced = old;
      }
    } catch { /* best-effort */ }
  }

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
    const { data: existing } = await edu().from("agent_tools").select("id, status, params_schema")
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
      return finish("reused", { status: "reused", tool: spec.name, label: spec.label, actions,
        note: `You already have "${spec.label}" — it IS available in this chat: call ${spec.name} with action=(${actions.join("|")}) to answer. Never tell the learner to open Settings.` });
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
    // Retire ONLY after verification passes: a rejected rebuild must never take
    // the learner's working domain tool away.
    if (existing?.id && !replaceRaw) {
      await edu().from("agent_tools").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", existing.id).eq("owner_id", learnerId);
    }
    // One tool per domain: retire other saved domain tools over the same view
    // (never the learner's Confirm-gated write tools).
    await retireSameView(learnerId, spec.view, spec.name);
    const { data: row, error } = await edu().from("agent_tools").insert({
      owner_id: learnerId, scope: "learner", audience, name: spec.name, label: spec.label,
      goal: `${spec.label}: ${actions.join(", ")}`, mode: "code", definition: def, params_schema: spec2.params,
      capabilities: [], views: [spec.view], domain: spec.view, actions,
      verification: { verdict: "pass", at: new Date().toISOString(), assertions: checks.map((c) => ({ name: `action:${c.action}`, passed: c.ok })), samples: [] },
      status: "active", usage_count: 1, last_used_at: new Date().toISOString(),
    }).select("id").single();
    if (error) return finish("failed", reject(`Couldn't save the tool: ${error.message}`));
    ev.tool_id = row.id; ev.mode = "code"; ev.capabilities = [];
    const action = inferAction(goal, actions, spec.view);
    const out = await tryRun(def, spec2.params, { action }, ctxD);
    await finish("created", {});
    return { status: "created", tool: spec.name, label: spec.label, mode: "code", actions,
      result: out.ok ? { rows: out.rows, total: out.total } : { error: out.error },
      note: `Saved "${spec.label}". It answers ${actions.join(", ")}; next time call ${spec.name} with action=.... The answer for this request is in result.` };
  }

  // 1) A curated domain; 2) a per-learner DYNAMIC domain for a read goal over one
  // of the learner's own-data views (the agent "fills" its own domain tools).
  const dkey = audience === "learner" ? domainForGoal(goal) : null;
  if (dkey) return await buildDomain(DOMAINS[dkey]);
  if (audience === "learner") {
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
      const { data: mine } = await edu().from("agent_tools").select("id, name, label, goal, views, domain, mode, params_schema")
        .eq("owner_id", learnerId).eq("status", "active").limit(200);
      const goalView = docGoal ? "my_library" : (dkey ? DOMAINS[dkey].view : bestSelfView(goal));
      const domainOf = (t) => t.domain || (Array.isArray(t.views) && t.views[0]) || null;
      const readGoal = !asksForChange(goal) && (genericReadGoal(goal) || !!aggregateForGoal(goal, goalView));
      // A read/aggregate goal over a view that already has a domain tool EXTENDS
      // that tool (the action is added); it never builds a near-duplicate.
      if (goalView && readGoal) {
        const hasDomainTool = (mine || []).some((t) => domainOf(t) === goalView && isDomainTool(t));
        if (hasDomainTool) {
          const spec = Object.values(DOMAINS).find((d) => d.view === goalView) || genericDomain(goalView);
          if (spec) return await buildDomain(spec);
        }
      }
      // Same-domain candidates only (when the view is known). A read domain tool
      // can't serve a write goal — the split keeps writes on their own tools.
      const sameDomain = goalView ? (mine || []).filter((t) => domainOf(t) === goalView) : (mine || []);
      const candidates = sameDomain.filter((t) => !asksForChange(goal) || !isDomainTool(t));
      const dupes = candidates.filter((t) => similarGoal(t.goal || t.label || "", goal));
      if (dupes.length) {
        // A document goal may reuse a duplicate ONLY if it reads my_library.
        // Otherwise every wrong-view duplicate (counted sessions by subject) is
        // archived so the corrected build replaces them in one go.
        const usable = docGoal ? dupes.find((t) => (t.views || []).includes("my_library")) : dupes[0];
        if (usable) return finish("reused", {
          status: "reused", tool: usable.name, label: usable.label,
          note: `You already have a tool for this — "${usable.label}" (${usable.name}). It IS available in this chat: CALL ${usable.name} now to answer. Never tell the learner to open Settings to run it, and never build a near-duplicate — if it can't do exactly this, extend that tool instead.`,
        });
        for (const d of dupes) {
          if (d.id) await edu().from("agent_tools").update({ status: "archived", updated_at: new Date().toISOString() })
            .eq("id", d.id).eq("owner_id", learnerId);
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
    const { data: mine } = await edu().from("agent_tools").select("name").eq("owner_id", learnerId).in("status", ["active", "disabled"]).limit(LIMITS.maxTools + 1);
    if ((mine || []).some((t) => t.name === name)) return reject(`You already have a tool called ${name} — call it, or pick another name.`);
    if ((mine || []).length >= LIMITS.maxTools) return finish("rejected", reject(`You have ${LIMITS.maxTools} tools — delete one in Settings → Agent → My tools first.`));
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
    const changes = { items: (runNow.write?.targets || []).map((t) => t.label), more: runNow.write?.more || 0 };
    if (dry) {
      await finish("dry", {});
      return { status: "needs_permission", dryRun: true, tool: name, label, wouldChange: changes.items,
        note: "DRY RUN — the tool was drafted and checked but NOT saved, and no card was made. Live, the learner gets a card showing what it would change; Approve turns it on." };
    }
    const { data: row, error } = await edu().from("agent_tools").insert({ owner_id: learnerId, scope: "learner", audience, ...def,
      status: "disabled", verification: { ...def.verification, awaitingPermission: draftCap }, usage_count: 0 }).select("id").single();
    if (error) return finish("failed", reject(`Couldn't save the draft: ${error.message}`));
    ev.tool_id = row.id; ev.mode = def.mode; ev.capabilities = def.capabilities;
    const out = await proposePermission({ learnerId, conversationId, capability: draftCap, proposed: { name, label, goal }, toolId: row.id, changes });
    await finish("escalated", {});   // logged as asked-for (stages_tried says "draft"), the outcome list is fixed
    return { ...out, tool: name, label, drafted: true };
  }

  async function register({ stage, built, v, check }) {
    ev.mode = stage;
    ev.capabilities = v.uses.capabilities;
    const verification = { verdict: check.verdict, at: new Date().toISOString(),
      assertions: check.assertions.map((a) => ({ name: a.name, passed: a.passed })), samples: built.samples || [] };
    const runNow = await tryRun(built.definition, params, input?.run && typeof input.run === "object" ? input.run : (built.samples || [])[0] || {}, ctx);
    const def = { name, label, goal, mode: stage, definition: built.definition, params_schema: params,
      capabilities: v.uses.capabilities, views: [...new Set(v.uses.views)], verification };
    if (draftCap) return draftAndAsk({ def, runNow });
    if (dry) {
      await finish("created", {});
      return { status: "created", dryRun: true, tool: name, label, mode: stage, verified: true, definition: built.definition,
        result: runNow.ok ? (runNow.write ? await writeOutcome({ learnerId, dry: true, tool: { label }, write: runNow.write })
          : { rows: runNow.rows, total: runNow.total, truncated: runNow.truncated }) : { error: runNow.error },
        note: "DRY RUN — the tool was built and verified but NOT saved. Answer the learner from `result`." + droppedNote };
    }
    const { data: row, error } = await edu().from("agent_tools").insert({ owner_id: learnerId, scope: "learner", audience, ...def, domain: (def.views || [])[0] || null, actions: def.params_schema?.action?.enum || null, usage_count: runNow.ok ? 1 : 0, last_used_at: new Date().toISOString() }).select("id").single();
    if (error) return finish("failed", reject(`Couldn't save the tool: ${error.message}`));
    ev.tool_id = row.id;
    // One tool per domain: a newly saved action tool retires older action tools
    // over the same view (write tools are untouched — they have no `action`).
    if (def.params_schema?.action?.enum && def.views?.[0]) await retireSameView(learnerId, def.views[0], name);
    await finish("created", {});
    return {
      status: "created", tool: name, label, mode: stage, verified: true,
      result: runNow.ok ? (runNow.write ? await writeOutcome({ learnerId, conversationId, dry: false, tool: { id: row.id, name, label }, write: runNow.write })
        : { rows: runNow.rows, total: runNow.total, truncated: runNow.truncated }) : { error: runNow.error },
      note: `Saved as the learner's tool "${label}". \`result\` is its answer for this request — use it now. Next time, call ${name} directly.${droppedNote}`,
      __newTool: toolDef(def),
    };
  }
}

/** A saved tool as an OpenAI function. */
export function toolDef(t) {
  const props = Object.fromEntries(Object.entries(paramProps(t.params_schema)).map(([k, p]) => [k, {
    ...(Array.isArray(p.enum) ? { type: typeof p.enum[0] === "number" ? "number" : "string", enum: p.enum } : { type: p.type }),
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
export async function learnerToolDefs(learnerId, audience = "learner") {
  const [{ data: mine }, { data: platform }] = await Promise.all([
    edu().from("agent_tools").select("name, label, goal, params_schema, scope")
      .eq("owner_id", learnerId).eq("status", "active").order("last_used_at", { ascending: false, nullsFirst: false }).limit(LIMITS.inCatalogue),
    edu().from("agent_tools").select("name, label, goal, params_schema, scope")
      .eq("scope", "platform").eq("audience", audience).eq("status", "active").order("usage_count", { ascending: false }).limit(LIMITS.inCatalogue),
  ]);
  const own = new Set((mine || []).map((t) => t.name));
  return [...(mine || []), ...(platform || []).filter((t) => !own.has(t.name))].map(toolDef);
}

/** Run a saved tool — the learner's own, else a platform one. → result, or null when there's no such tool. */
export async function runLearnerTool(name, input, learnerId, { callCapability, conversationId = null, dry = false, audience = "learner" }) {
  if (!NAME.test(String(name || ""))) return null;
  let { data: t } = await edu().from("agent_tools").select("*").eq("owner_id", learnerId).eq("name", name).in("status", ["active", "disabled"]).maybeSingle();
  if (!t) ({ data: t } = await edu().from("agent_tools").select("*").eq("scope", "platform").eq("audience", audience).eq("name", name).in("status", ["active", "disabled"]).maybeSingle());
  if (t && (t.audience || "learner") !== audience) return null;   // never run another audience's tool
  if (!t) return null;
  const platform = t.scope === "platform";
  if (t.status !== "active") return { error: platform ? "This Akoro tool is turned off for now." : "This tool is turned off — rebuild it or turn it back on in Settings → Agent → My tools." };
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
  const { data, error } = await edu().from("agent_tools").select("id, name, label, goal, mode, status, usage_count, last_used_at, created_at")
    .eq("owner_id", learnerId).in("status", ["active", "disabled"]).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error("Couldn't load your tools");
  return data || [];
}

export async function updateMyTool(learnerId, id, patch) {
  const allowed = {};
  if (typeof patch?.label === "string" && patch.label.trim().length >= 2) allowed.label = patch.label.trim().slice(0, 60);
  if (["active", "disabled"].includes(patch?.status)) allowed.status = patch.status;
  if (patch?.delete === true) allowed.status = "archived";
  if (!Object.keys(allowed).length) throw Object.assign(new Error("Nothing to change"), { status: 400 });
  const { data, error } = await edu().from("agent_tools").update({ ...allowed, updated_at: new Date().toISOString(), ...(allowed.status !== "active" ? { fail_streak: 0 } : {}) })
    .eq("owner_id", learnerId).eq("id", id).in("status", ["active", "disabled"]).select("id, name, label, status").maybeSingle();
  if (error) throw new Error("Couldn't update the tool");
  if (!data) throw Object.assign(new Error("Tool not found"), { status: 404 });
  return data;
}
