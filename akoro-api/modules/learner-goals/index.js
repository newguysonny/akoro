/**
 * learner-goals — the learner's educational goals: the one write path and its
 * router. `default` is the /api/learner-goals router.
 */
export { default } from "./routes.js";
export { createGoal, listGoals, updateGoal } from "./service.js";
