/**
 * The app's POST/GET /api/teaching/workflows router (workflowRoutes.js) on the
 * real engine, store and auth. Kept apart so the router's tests stay db-free.
 */
import db from "../../../db.js";
import { authenticateToken } from "../../auth/index.js";
import { createWorkflowEngine } from "../../workflows/index.js";
import { makeSupabaseWorkflowStore } from "../../workflows/index.js";
import { workflowEngineEnabled } from "../study-prep/workflow.js";
import "./workflow.js";   // registers the teaching workflow type with the engine
import { createTeachingWorkflowsRouter } from "./workflowRoutes.js";

let _engine = null;
const engine = () => (_engine ||= createWorkflowEngine({ store: makeSupabaseWorkflowStore(db) }));

export default createTeachingWorkflowsRouter({ engine, authenticate: authenticateToken, enabled: workflowEngineEnabled });
