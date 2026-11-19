/**
 * lib/battleJobHandlers.js — handlers the battle worker can run without
 * importing another module's internals (Phase 19 step 2). app.js registers
 * them before the worker starts.
 */

const handlers = new Map();

export function registerBattleJobHandler(action, handler) {
  handlers.set(action, handler);
}

export function battleJobHandler(action) {
  const handler = handlers.get(action);
  if (!handler) throw new Error(`Battle job handler "${action}" used before installation (register it in app.js before the battle worker starts).`);
  return handler;
}
