/**
 * workflows/store.js — the engine's persistence: edu.workflow_instances and
 * edu.workflow_events. Two implementations of one interface:
 *
 *   supabaseWorkflowStore   the real tables
 *   memoryWorkflowStore()   in-memory, for contract tests
 *
 *   insertInstance(row) → row          (unique-key clash → { conflict: true })
 *   findByKey(learnerId, type, key) → row | null
 *   getInstance(id) → row | null
 *   updateInstanceConditional(id, expectedState, patch) → row | null   (CAS on state)
 *   listInstances(learnerId, { active }) → rows (newest first)
 *   appendEvent(workflowId, row) → row (sequence = max + 1, retried on a clash)
 *   listEvents(workflowId, { limit }) → rows (oldest first)
 */
import { randomUUID } from "node:crypto";
import { TERMINAL_STATUSES, WORKFLOW_STATUSES } from "./definition.js";

const OPEN_STATUSES = WORKFLOW_STATUSES.filter((s) => !TERMINAL_STATUSES.includes(s));

const isUniqueClash = (error) => /duplicate key|unique constraint/i.test(String(error?.message || "")) || error?.code === "23505";

export function makeSupabaseWorkflowStore(db) {
  const edu = () => db.schema("edu");
  return {
    async insertInstance(row) {
      const { data, error } = await edu().from("workflow_instances").insert(row).select("*").single();
      if (error) { if (isUniqueClash(error)) return { conflict: true }; throw error; }
      return data;
    },
    async findByKey(learnerId, type, key) {
      const { data, error } = await edu().from("workflow_instances").select("*")
        .eq("learner_id", learnerId).eq("workflow_type", type).eq("idempotency_key", key).limit(1);
      if (error) throw error;
      return data?.[0] || null;
    },
    async getInstance(id) {
      const { data, error } = await edu().from("workflow_instances").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async updateInstanceConditional(id, expectedState, patch) {
      const { data, error } = await edu().from("workflow_instances").update(patch)
        .eq("id", id).eq("state", expectedState).select("*").maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async listInstances(learnerId, { active = false, limit = 50 } = {}) {
      let q = edu().from("workflow_instances").select("*").eq("learner_id", learnerId);
      if (active) q = q.in("status", OPEN_STATUSES);
      const { data, error } = await q.order("updated_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return data || [];
    },
    async appendEvent(workflowId, row) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const { data: last, error: lastError } = await edu().from("workflow_events").select("sequence")
          .eq("workflow_id", workflowId).order("sequence", { ascending: false }).limit(1).maybeSingle();
        if (lastError) throw lastError;
        const sequence = Number(last?.sequence ?? -1) + 1;
        const { data, error } = await edu().from("workflow_events").insert({ ...row, workflow_id: workflowId, sequence }).select("*").single();
        if (!error) return data;
        if (!isUniqueClash(error)) throw error;   // lost the slot — take the next one
      }
      throw new Error("workflow_events: could not allocate a sequence");
    },
    async listEvents(workflowId, { limit = 500 } = {}) {
      const { data, error } = await edu().from("workflow_events").select("*")
        .eq("workflow_id", workflowId).order("sequence", { ascending: true }).limit(limit);
      if (error) throw error;
      return data || [];
    },
  };
}

/** In-memory store with the same behaviour (unique keys, CAS, sequences). */
export function memoryWorkflowStore() {
  const instances = new Map();
  const events = new Map();
  const now = () => new Date().toISOString();
  return {
    instances, events,
    async insertInstance(row) {
      if (row.idempotency_key && [...instances.values()].some((i) => i.learner_id === row.learner_id && i.workflow_type === row.workflow_type && i.idempotency_key === row.idempotency_key)) {
        return { conflict: true };
      }
      const r = { id: randomUUID(), created_at: now(), updated_at: now(), metadata: {}, model_selection: {}, ...row };
      instances.set(r.id, r);
      return { ...r };
    },
    async findByKey(learnerId, type, key) {
      const r = [...instances.values()].find((i) => i.learner_id === learnerId && i.workflow_type === type && i.idempotency_key === key);
      return r ? { ...r } : null;
    },
    async getInstance(id) { const r = instances.get(id); return r ? { ...r } : null; },
    async updateInstanceConditional(id, expectedState, patch) {
      const r = instances.get(id);
      if (!r || r.state !== expectedState) return null;
      const u = { ...r, ...patch };
      instances.set(id, u);
      return { ...u };
    },
    async listInstances(learnerId, { active = false } = {}) {
      return [...instances.values()].filter((i) => i.learner_id === learnerId && (!active || !TERMINAL_STATUSES.includes(i.status)))
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).map((r) => ({ ...r }));
    },
    async appendEvent(workflowId, row) {
      const list = events.get(workflowId) || [];
      const r = { id: randomUUID(), created_at: now(), payload: {}, ...row, workflow_id: workflowId, sequence: list.length };
      list.push(r);
      events.set(workflowId, list);
      return { ...r };
    },
    async listEvents(workflowId) { return (events.get(workflowId) || []).map((r) => ({ ...r })); },
  };
}
