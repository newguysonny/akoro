/**
 * workflows/modelPicks.js — the learner's model pick, remembered (Grand Plan
 * §7.11.5, Scenario K).
 *
 * The chat box's pick is saved on the chat thread (chat_sessions.model_selection)
 * and on the learner's open Study Prep / Teaching workflows
 * (workflow_instances.model_selection); each change on a workflow is a
 * `model.changed` event on its stream. The latest pick on any thread is the
 * learner's pick on every device (GET /chat/models answers it as
 * picker.saved).
 *
 * At call time, a workflow's controller decisions and persona replies ask
 * `callFields` for the `__learnerChoice` + the payer's tier list
 * (`__allowedModels`) that meteredCreate resolves (lib/modelRegistry.js);
 * locked roles (assessor, evidence, and any AI_MODEL_LOCKED_ROLES) never get
 * a pick. The resolved model is what is billed.
 *
 *   makeModelPicks({ threads, engine, tiersFor, registry, env, now })
 *     .learnerPick(learnerId)                         → { modelId, ... } | null
 *     .choiceFor({ learnerId, workflow, billTo, role }) → { learnerChoice, allowedModels } | null
 *     .callFields(opts)                               → { __learnerChoice, __allowedModels } | {}
 *     .saveThreadPick({ learnerId, conversationId, modelId, billTo })
 *     .saveWorkflowPick({ learnerId, workflowId, modelId, from })
 *   modelPicks()   the app's instance (real db, engine, tier lists)
 */
import { modelRegistry, pickerFlag, ROLES } from "../../lib/modelRegistry.js";

export const MODEL_CHANGED = "model.changed";
/** Workflows that carry the learner's pick (the others run on locked or background roles). */
export const PICKED_WORKFLOWS = Object.freeze(["study_prep", "teaching"]);
const TTL_MS = 20_000;

export class ModelPickError extends Error {
  constructor(code, message, status = 422) { super(message); this.name = "ModelPickError"; this.code = code; this.status = status; }
}

const hasPick = (sel) => !!sel && typeof sel === "object" && Object.prototype.hasOwnProperty.call(sel, "modelId");
const pickOf = (sel) => (hasPick(sel) ? sel.modelId || null : undefined);

/** chat_sessions as the thread store. */
export function supabaseThreads(db) {
  return {
    async get(conversationId, learnerId) {
      const { data, error } = await db.from("chat_sessions").select("id, model_selection").eq("id", conversationId).eq("user_id", learnerId).maybeSingle();
      if (error) throw new Error(`chat_sessions: ${error.message}`);
      return data ? { id: data.id, selection: data.model_selection || {} } : null;
    },
    async set(conversationId, learnerId, selection) {
      const { data, error } = await db.from("chat_sessions").update({ model_selection: selection }).eq("id", conversationId).eq("user_id", learnerId).select("id").maybeSingle();
      if (error) throw new Error(`chat_sessions: ${error.message}`);
      return !!data;
    },
    async latest(learnerId) {
      const { data, error } = await db.from("chat_sessions").select("id, model_selection").eq("user_id", learnerId)
        .not("model_selection->>changedAt", "is", null)
        .order("model_selection->>changedAt", { ascending: false }).limit(1);
      if (error) throw new Error(`chat_sessions: ${error.message}`);
      const row = data?.[0];
      return row ? { ...row.model_selection, conversationId: row.id } : null;
    },
  };
}

export function makeModelPicks({ threads, engine, tiersFor, registry = modelRegistry, env = process.env, now = () => new Date().toISOString(), clock = () => Date.now() }) {
  const cache = new Map();   // learnerId → { value, at }
  const lockedRoles = new Set([
    ...Object.entries(ROLES).filter(([, r]) => r.locked).map(([name]) => name),
    ...String(env.AI_MODEL_LOCKED_ROLES || "").split(",").map((s) => s.trim()).filter(Boolean),
  ]);

  /** A pick the catalogue can hold: null (the default) or a pickable model id. */
  function checkModelId(modelId) {
    if (modelId === null || modelId === undefined || modelId === "") return null;
    if (typeof modelId !== "string") throw new ModelPickError("invalid_model", "modelId must be a model id or null");
    const entry = registry.get(modelId);
    if (!entry || !entry.selectable) throw new ModelPickError("unknown_model", `"${modelId.slice(0, 60)}" isn't a model you can pick`);
    return entry.id === registry.defaultId ? null : entry.id;
  }

  const tierList = async (learnerId, billTo) => (tiersFor ? (await tiersFor(learnerId, { billTo }).catch(() => null))?.allowedModels ?? null : null);

  /** What a pick resolves to for a role, with the notice when it can't be used. */
  function describe(modelId, role, allowedModels) {
    if (!modelId) {
      const def = registry.get(registry.defaultId);
      return { modelId: null, label: def?.label || registry.defaultId, resolved: registry.defaultId, source: "default", notice: null };
    }
    const r = registry.resolve({ role, learnerChoice: modelId, allowedModels });
    return { modelId, label: registry.get(modelId)?.label || modelId, resolved: r.model.id, source: r.source, notice: r.notice || null };
  }

  async function learnerPick(learnerId) {
    if (!learnerId || !threads?.latest) return null;
    const hit = cache.get(learnerId);
    if (hit && clock() - hit.at < TTL_MS) return hit.value;
    const value = await threads.latest(learnerId).catch(() => null);
    cache.set(learnerId, { value, at: clock() });
    if (cache.size > 5000) cache.delete(cache.keys().next().value);
    return value;
  }

  async function instanceOf(workflow, learnerId) {
    if (!workflow) return null;
    if (typeof workflow === "object") return workflow;
    return engine ? engine.get(workflow, learnerId || null).catch(() => null) : null;
  }

  /** The pick a call should carry: the workflow's own, else the learner's latest; none for a locked role or with the picker off. */
  async function choiceFor({ learnerId, workflow = null, billTo = null, role = "controller" } = {}) {
    if (!pickerFlag(env) || !learnerId || lockedRoles.has(role)) return null;
    const instance = await instanceOf(workflow, learnerId);
    let choice = pickOf(instance?.model_selection);
    if (choice === undefined) choice = pickOf(await learnerPick(learnerId)) ?? null;
    if (!choice) return null;
    return { learnerChoice: choice, allowedModels: await tierList(learnerId, billTo) };
  }

  async function callFields(opts = {}) {
    const c = await choiceFor(opts).catch(() => null);
    return c ? { __learnerChoice: c.learnerChoice, ...(Array.isArray(c.allowedModels) ? { __allowedModels: c.allowedModels } : {}) } : {};
  }

  /** Save the pick on one workflow; a change is a `model.changed` event on its stream. → { changed, selection } | null */
  async function saveWorkflowPick({ learnerId, workflowId, modelId, from = "learner", billTo = null }) {
    const id = checkModelId(modelId);
    const instance = await instanceOf(workflowId, learnerId);
    if (!instance || (learnerId && instance.learner_id !== learnerId)) return null;
    const previous = pickOf(instance.model_selection);
    if (previous !== undefined && previous === id) return { changed: false, selection: instance.model_selection };
    const selection = { ...describe(id, "controller", await tierList(instance.learner_id, billTo)), changedAt: now(), from };
    let saved = await engine.selectModel(instance.id, selection);
    if (!saved) saved = await engine.selectModel(instance.id, selection);   // it moved meanwhile: once more on its new state
    if (!saved) return null;
    await engine.appendEvent(instance.id, {
      event_type: MODEL_CHANGED, category: "action", actor: "learner", visibility: "learner",
      payload: { from: previous ?? null, to: id, label: selection.label, resolved: selection.resolved, source: selection.source, ...(selection.notice ? { notice: selection.notice } : {}) },
    }).catch(() => null);
    return { changed: true, selection };
  }

  /**
   * Save the chat box's pick on its thread; a change also reaches the
   * learner's open Study Prep and Teaching workflows. → { changed, previous, selection, workflows }
   */
  async function saveThreadPick({ learnerId, conversationId, modelId, billTo = null }) {
    const id = checkModelId(modelId);
    const thread = await threads.get(conversationId, learnerId);
    if (!thread) throw new ModelPickError("thread_not_found", "That chat was not found", 404);
    const previous = pickOf(thread.selection);
    if (previous !== undefined && previous === id) return { changed: false, previous, selection: thread.selection, workflows: [] };
    const selection = { ...describe(id, "chat", await tierList(learnerId, billTo)), changedAt: now() };
    await threads.set(conversationId, learnerId, selection);
    cache.set(learnerId, { value: { ...selection, conversationId }, at: clock() });
    const workflows = [];
    if (engine) {
      const open = await engine.listForLearner(learnerId, { active: true }).catch(() => []);
      for (const w of open.filter((x) => PICKED_WORKFLOWS.includes(x.workflow_type))) {
        const r = await saveWorkflowPick({ learnerId, workflowId: w, modelId: id, from: "chat" }).catch(() => null);
        if (r?.changed) workflows.push(w.id);
      }
    }
    return { changed: true, previous: previous ?? null, selection, workflows };
  }

  return { learnerPick, choiceFor, callFields, saveThreadPick, saveWorkflowPick, describe, checkModelId, clear: () => cache.clear() };
}

let _picks = null;
/** The app's instance: the real chat threads, workflow engine and tier lists. */
export async function modelPicks() {
  if (_picks) return _picks;
  const [{ default: db }, { createWorkflowEngine }, { makeSupabaseWorkflowStore }, { allowedModelsFor }] = await Promise.all([
    import("../../db.js"), import("./engine.js"), import("./store.js"), import("../../lib/modelTiers.js"),
  ]);
  _picks = makeModelPicks({ threads: supabaseThreads(db), engine: createWorkflowEngine({ store: makeSupabaseWorkflowStore(db) }), tiersFor: allowedModelsFor });
  return _picks;
}

/** callFields through the app's instance; never throws (a lookup failure means the default model). */
export async function pickFields(opts) {
  try { return await (await modelPicks()).callFields(opts); } catch { return {}; }
}
