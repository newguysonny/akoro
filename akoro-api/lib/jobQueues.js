/**
 * lib/jobQueues.js — boot-installed queue registries (Phase 19 step 2).
 *
 * app.js installs these immediately after it starts the battle worker and the
 * tasks worker/scheduler, so modules that only enqueue or cancel jobs read the
 * live queue here instead of importing another module's worker (which would
 * construct Redis/BullMQ a second time and at the wrong point in boot).
 *
 * Calling an accessor before installation is a programming error, not a
 * silent no-op: the caller asked for work that can never run.
 */

export class QueueNotInstalledError extends Error {
  constructor(what) {
    super(`${what} used before installation (install it at boot).`);
    this.name = "QueueNotInstalledError";
  }
}

let battle = null;
let tasks = null;

/** Install the battle queue once app.js has started the battle worker. */
export function setBattleQueue(queue) {
  if (!queue) throw new QueueNotInstalledError("Battle queue installation");
  battle = queue;
}

/** The live battle queue. */
export function battleQueue() {
  if (!battle) throw new QueueNotInstalledError("Battle queue");
  return battle;
}

/** Install the task scheduler surface (plus the worker's runDueTasks). */
export function setTaskScheduler(scheduler) {
  if (!scheduler) throw new QueueNotInstalledError("Task scheduler installation");
  tasks = scheduler;
}

/** The live task scheduler surface: queue, schedule/cancel/tick, runDueTasks. */
export function taskScheduler() {
  if (!tasks) throw new QueueNotInstalledError("Task scheduler");
  return tasks;
}
