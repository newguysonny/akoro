/** Public names and labels for the fixed server-owned teaching workflow. */
export const TEACHING_TURN_TOOL_CATALOG = Object.freeze([
  { name: "load_session_state", label: "Loading the teaching session" },
  { name: "observe_teaching_evidence", label: "Checking the explanation" },
  { name: "generate_protege_discussion", label: "Preparing the protege response" },
  { name: "assess_protege_understanding", label: "Checking protege understanding" },
  { name: "persist_cognitive_state", label: "Updating learning progress" },
  { name: "record_verified_learning", label: "Recording verified learning" },
  { name: "coach_teaching_dialogue", label: "Preparing a teaching nudge" },
  { name: "gate_teaching_progress", label: "Checking whether to continue" },
]);
