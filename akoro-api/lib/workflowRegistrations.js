/**
 * lib/workflowRegistrations.js — every workflow definition module, imported for
 * its registration side effect (Phase 19 step 2).
 *
 * The verify dashboard scenario used to reach into adaptive-learning's
 * internals to register these four types before creating an engine. This one
 * lib file keeps that registration in a single place the scenario can import;
 * it must be imported before `createWorkflowEngine` / `registeredTypes()`.
 */
import "../modules/adaptive-learning/study-prep/workflow.js";
import "../modules/adaptive-learning/teaching-session/workflow.js";
import "../modules/adaptive-learning/decay-review/workflow.js";
import "../modules/adaptive-learning/practice/workflow.js";
