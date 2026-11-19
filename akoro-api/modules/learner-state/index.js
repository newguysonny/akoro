// Learner state: the Redis-backed record of what each learner's agent knows.
//
// One entry for every consumer, so no module reaches into the files behind it.
export {
  getRedis,
  getStudentState,
  saveStudentState,
  updateStudentState,
  clearStateCache,
  getAgentPreferences,
  saveAgentPreferences,
  userOwnsAgent,
  addPurchasedAgent,
} from "./student-state.js";
