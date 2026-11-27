/**
 * modules/self-tooling/pipeline-create.js — create_tool (plan §7.4, §7.9):
 * validation, reuse, escalation, the recipe → spec → code build loop, and the
 * save paths. Dry runs execute through pipeline-verify.js; domain builds run
 * through pipeline-dry.js; storage lives in pipeline-io.js.
 *
 *   createTool  → { status: created|escalated|rejected, … }   one call in, one status out
 */
import db from "../../db.js";
import { schemaLookup, capabilityStatus } from "./registry.js";
import { forbiddenFor, CAPABILITIES, learnerGrantable, ownChangeAsked, asksForChange } from "./capabilities.js";
import { DATA_VIEWS } from "./views.js";
import { validateDefinition } from "./interpreters.js";
import { validateParams, paramProps, wellFormedParams } from "./bind.js";
import { buildDefinition, registrySlice } from "./builder.js";
import { escalate, rowsText } from "./escalation.js";
import { proposePermission, proposeBuild } from "./confirmations.js";
import { codeEnabled } from "./sandbox/index.js";
import { isDocumentGoal, similarGoal, goalTokens } from "./toolSimilarity.js";
import { deriveToolArea } from "./areas.js";
import { DOMAINS, domainForGoal, genericDomain, genericReadGoal, aggregateForGoal, inferAction, bestSelfView } from "./domains.js";
import { LIMITS, NAME, reject, howToUse, needsCode, inventedDates, hardCodedTargets, pickReplacement, othersCapabilityFirst, isDomainTool, isAnswerOnlyRead, toolDef, REBUILD_HONESTY } from "./rules.js";
import { logEvent, retireSameView, writeOutcome } from "./pipeline-io.js";
import { tryRun, verifyTool } from "./pipeline-verify.js";
import { buildDomain as runDomainBuild } from "./pipeline-dry.js";
import { validateModeDefinition, initialModeState } from "./modeSpec.js";
import { validatePresentation } from "./uiCatalogue.js";

const edu = () => db.schema("edu");

/** Learner-readable lines for a mode tool's build card: the titles of the
 *  first checklist in its initial state (coverage, key points), if any. */
function modeCardItems(state) {
  for (const v of Object.values(state || {})) {
    if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object" && typeof x.title === "string")) {
      return v.slice(0, 5).map((x) => x.title);
    }
  }
  return [];
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

  // Build a domain tool (pipeline-dry.js): one tool per domain with { action } sub-params, read-only.
  const buildDomain = (spec) => runDomainBuild(spec, {
    learnerId, audience, dry, resumed, goal, hint, conversationId, replaceRaw, ev, replaced,
    finish, retireReplacedBeforeInsert, archiveReplaced, carriedActions,
  });

  // 1) A curated domain; 2) a per-learner DYNAMIC domain for a read goal over one
  // of the learner's own-data views (the agent "fills" its own domain tools).
  // Never route a CHANGE goal to a read domain: "delete a task by position"
  // matched the "by <field>" read regex and answered with a count instead of
  // reaching the learner's write tool.
  const dkey = audience === "learner" && hint.mode !== "mode" && !asksForChange(goal) ? domainForGoal(goal) : null;
  if (dkey) return await buildDomain(DOMAINS[dkey]);
  if (audience === "learner" && hint.mode !== "mode" && !asksForChange(goal)) {
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
  // A MODE tool (Plugin Runtime): an interactive session/protocol the learner
  // runs with the agent in chat — a steer, a state document, declared state
  // actions and a presentation. Not a data answer, so it skips the stages
  // loop, the capability escalation and the domain routes entirely.
  if (hint.mode === "mode" && audience === "learner") return await buildModeTool();
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
    const { createLearnerToolRequest } = await import("../agent-tool-requests/index.js");
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
      writes: !!runNow.write, items, more: runNow.write?.more || 0,
      ui: def.presentation ? { presentation: def.presentation, rows: (runNow.rows || []).slice(0, 20) } : null });
    await finish("escalated", {});
    return { status: "needs_consent", drafted: true, tool: name, label, mode: def.mode, confirmation: card.confirmation,
      result: runNow.ok ? (runNow.write ? await writeOutcome({ learnerId, dry: true, tool: { label }, write: runNow.write })
        : { rows: runNow.rows, total: runNow.total, truncated: runNow.truncated }) : { error: runNow.error },
      note: `The tool is built and checked, but it is NOT on: it is drafted and OFF, and a card is asking the learner to Keep it. ` + "`result`" + ` is its answer for this request — use it now, and be honest about anything it cannot do. In your own words: say you've built "${label}", what it does, and that tapping Keep on the card saves it in their tools; if they want it different — another grouping, range or field — say you'll rebuild it, and call create_tool again with the same name and ` + "`replace`" + ` set to "${name}". Never say it is saved or on.${droppedNote}` };
  }

  /**
   * Build a MODE tool (hint.mode === "mode"): the builder proposes a steer +
   * state + actions + presentation in one call; validation is structural
   * (modeSpec + the UI catalogue) — there are no rows to verify against.
   * Same consent shape as a data tool: drafted OFF, Keep card with the live
   * preview; a resumed or replacing build was already approved, so it saves
   * active. The session itself starts when the tool is RUN (runLearnerTool
   * returns the steer + live state).
   */
  async function buildModeTool() {
    ev.stages_tried.push("mode");
    let feedback = null, lastProblem = null;
    for (let attempt = 1; attempt <= 2 && ev.builder_calls < LIMITS.builderCalls; attempt++) {
      ev.builder_calls++;
      let built;
      try { built = await buildDefinition({ stage: "mode", goal, params, slice, feedback, learnerId, platformPays: dry || resumed }); }
      catch (e) {
        if (/coin|balance/i.test(String(e?.message))) return finish("rejected", reject("Not enough coins to build a tool."));
        lastProblem = `builder failed: ${e.message}`; break;
      }
      if (built.notExpressible) { lastProblem = built.notExpressible; break; }
      if (!built.definition) { feedback = built.error || "no definition"; lastProblem = feedback; continue; }
      const mv = validateModeDefinition(built.definition);
      const pv = built.presentation
        ? validatePresentation(built.presentation, { stateKeys: Object.keys(built.definition?.state || {}) })
        : { ok: false, errors: ["a mode tool needs a presentation — its tab is how the learner sees the session"] };
      const errors = [...mv.errors, ...pv.errors];
      if (errors.length) { feedback = errors.slice(0, 6).join("; "); lastProblem = feedback; continue; }
      ev.mode = "mode";
      const runInput = { ...(input?.run && typeof input.run === "object" ? input.run : (built.samples || [])[0] || {}) };
      const initialState = initialModeState(built.definition, runInput);
      const verification = { verdict: "PASS", at: new Date().toISOString(),
        assertions: [{ name: "mode shape", passed: true }, { name: "presentation bindings", passed: true }], samples: built.samples || [] };
      const def = { name, label, goal, mode: "mode", definition: built.definition, params_schema: params,
        capabilities: [], views: [], verification, presentation: built.presentation };
      Object.assign(def, deriveToolArea(def));
      if (dry) {
        await finish("created", {});
        return { status: "created", dryRun: true, tool: name, label, mode: "mode", verified: true, definition: built.definition, presentation: built.presentation,
          result: { mode: true, state: initialState },
          note: "DRY RUN — the session tool was built and checked but NOT saved. Describe the session it would run from `result`." + droppedNote };
      }
      await retireReplacedBeforeInsert();
      const directSave = resumed || !!replaced;
      const { data: row, error } = await edu().from("agent_tools").insert({ owner_id: learnerId, scope: "learner", audience, ...def,
        domain: null, actions: null, usage_count: 0,
        ...(directSave ? {} : { status: "disabled", verification: { ...verification, awaitingBuild: true } }) }).select("id").single();
      if (error) return finish("failed", reject(`Couldn't save the tool: ${error.message}`));
      ev.tool_id = row.id;
      await archiveReplaced(row.id);
      if (directSave) {
        await finish("created", {});
        return { status: "created", tool: name, label, mode: "mode", verified: true,
          result: { mode: true, steer: built.definition.steer, state: initialState, actions: built.definition.actions.map((a) => a.name) },
          note: `Saved as the learner's session tool "${label}". Call ${name} by name to start or resume the session — it returns the steer and the live state.${droppedNote}` };
      }
      ev.stages_tried.push("consent");
      const card = await proposeBuild({ learnerId, conversationId, toolId: row.id,
        refs: [], proposed: { name, label, goal, run: runInput },
        does: "It runs an interactive session with you in this chat, and keeps its progress in its own tab. It only reads your own data.",
        writes: false, items: modeCardItems(initialState), more: 0,
        ui: { presentation: built.presentation, state: initialState } });
      await finish("escalated", {});
      return { status: "needs_consent", drafted: true, tool: name, label, mode: "mode", confirmation: card.confirmation,
        result: { mode: true, steer: built.definition.steer, state: initialState, actions: built.definition.actions.map((a) => a.name) },
        note: `The session tool is built and checked, but it is NOT on: it is drafted and OFF, and a card is asking the learner to Keep it. ` + "`result`" + ` shows the session it will run — use it to describe the session now, in your own words: say you've built "${label}", what it will be like, and that tapping Keep on the card starts it. When they keep it, call await_decision as usual to finish the keep — its result carries the session itself (steer + live state), and you run the session from there. Never say it is saved or on.${droppedNote}` };
    }
    return finish("rejected", reject(`Couldn't build it safely: ${String(lastProblem || "the mode builder couldn't express it").slice(0, 240)}`));
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
    // autoTargetValues — never via a default. (Live 2026-11-18: a
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
    // A presentation the builder proposed rides along when every binding
    // resolves against the verified run's fields; a bad one is dropped,
    // never a failed build (Plugin Runtime, 2026-11-27).
    if (built.presentation) {
      const rowFields = runNow.ok && Array.isArray(runNow.rows) && runNow.rows[0] ? Object.keys(runNow.rows[0]) : [];
      if (validatePresentation(built.presentation, { rowFields }).ok) def.presentation = built.presentation;
    }
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
