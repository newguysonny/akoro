/**
 * The app's POST/GET /api/teaching/workflows router (workflowRoutes.js) on the
 * real engine, store and auth. Kept apart so the router's tests stay db-free.
 */
import db from "../../../db.js";
import { authenticateToken } from "../../auth/routes.js";
import { createWorkflowEngine } from "../../workflows/engine.js";
import { makeSupabaseWorkflowStore } from "../../workflows/store.js";
import { workflowEngineEnabled } from "../study-prep/workflow.js";
import "./workflow.js";   // registers the teaching workflow type with the engine
import { createTeachingWorkflowsRouter } from "./workflowRoutes.js";

let _engine = null;
const engine = () => (_engine ||= createWorkflowEngine({ store: makeSupabaseWorkflowStore(db) }));

export default createTeachingWorkflowsRouter({ engine, authenticate: authenticateToken, enabled: workflowEngineEnabled });
