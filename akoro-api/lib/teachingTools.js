/**
 * lib/teachingTools.js — the teaching tool catalog and helpers for the task
 * engine and self-study drafts, plus the runner installed at boot (Phase 19
 * step 2). Callers read this instead of importing teaching internals.
 */
import {
  TOOLS, ToolError, cleanToolInput, generateToolResult, saveToolOutput, toolByKey, toolPayload,
} from "../modules/teaching/index.js";

export {
  TOOLS, ToolError, cleanToolInput, generateToolResult, saveToolOutput, toolByKey, toolPayload,
};

let runner = null;

export function setTeachingToolRunner(fn) {
  runner = fn;
}

export function getTeachingToolRunner() {
  if (!runner) throw new Error("Teaching tool runner used before installation (setTeachingToolRunner in app.js).");
  return runner;
}
