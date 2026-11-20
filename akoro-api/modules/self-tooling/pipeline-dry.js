/**
 * modules/self-tooling/pipeline-dry.js — dry-run execution against a domain
 * spec: add the requested breakdown as a new action, verify EVERY action
 * through the same runner the saved tool uses, then either report the dry run,
 * reuse a covered merged tool, ask about the learner's own copy, or save the
 * verified domain tool (drafted or active).
 */
import db from "../../db.js";
import { reject, REBUILD_HONESTY } from "./rules.js";
import { tryRun } from "./pipeline-verify.js";
import { logEvent, ownCopyOfferOpen, retireSameView } from "./pipeline-io.js";
import { deriveToolArea } from "./areas.js";
import { byActionForGoal, aggregateForGoal, inferAction, verifyDomainActions, MAX_DOMAIN_ACTIONS } from "./domains.js";
import { mergedLibraryEnabled, LIBRARY_MERGED_ACTIONS, libraryBuildIsCovered } from "./mergedLibrary.js";
import { mergedChatsEnabled, CHATS_MERGED_ACTIONS, chatsBuildIsCovered } from "./mergedChats.js";
import { MERGED_DOMAIN_LIST } from "./mergedDomains.js";
import { rowsText } from "./escalation.js";
import { proposeBuild } from "./confirmations.js";

const edu = () => db.schema("edu");

// Build a domain tool: one tool per domain with { action } sub-params, read-only.
// EVERY action is verified before saving (domain regression); the tool is saved
// and run. Used for the curated registry AND per-learner dynamic domains.
export async function buildDomain(spec, ctx) {
  const { learnerId, audience, dry, resumed, goal, hint, conversationId, replaceRaw, ev,
    replaced, finish, retireReplacedBeforeInsert, archiveReplaced, carriedActions } = ctx;
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
