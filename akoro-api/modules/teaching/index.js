/**
 * teaching — the teaching tool suite (catalogue + runner), the resource
 * scaffold prompt helpers, and the JSON repair used by session assessment.
 * `default` is the /api/teaching/tools router.
 */
export { default } from "./tools.js";
export {
  TOOLS,
  ToolError,
  cleanToolInput,
  generateToolResult,
  saveToolOutput,
  toolByKey,
  toolPayload,
  upgradeSaved,
  runTeachingTool,
} from "./tools.js";
export { COMPACT_TEMPLATE_RULE, assembleResourceDoc } from "./contentScaffold.js";
export { closeJson } from "./jsonRepair.js";
