/**
 * workflows/registry.js — workflow type → its definition (and, from Phase 2,
 * its controller). The engine looks a type up here; an unregistered type
 * cannot be created.
 */
const registry = new Map();

export function registerWorkflow(def, controller = null) {
  if (!def?.type) throw new Error("registerWorkflow: a definition with a type is required");
  registry.set(def.type, { def, controller });
  return def;
}

export function workflowDefinition(type) {
  return registry.get(type)?.def || null;
}

export function workflowController(type) {
  return registry.get(type)?.controller || null;
}

export function registeredTypes() {
  return [...registry.keys()];
}
