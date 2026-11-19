/** Tasks: intake/routes, tool catalogue, task context, and task persistence. */

export { MAX_TOOL_ITERATIONS, SIDE_EFFECTING, runAgentLoop } from "./lib/agentLoop.js";
export { buildContext, buildSystemPrompt, buildTaskPrompt, extractIntent } from "./lib/context.js";
export {
  DEFAULT_FILE_CHARS,
  DEFAULT_TOTAL_CHARS,
  preFilterFileTexts,
} from "./lib/contextPrefilter.js";
export {
  AgentDB,
  DynamicToolDB,
  TaskDB,
  TaskFileDB,
  TaskOutputDB,
  TaskRunDB,
  TaskScheduleDB,
} from "./lib/db.js";
export { ALL_TOOLS, TOOLS_BY_TYPE, findTool, getToolsForTask, getToolsForTaskType } from "./tools/index.js";
export { parseJsonLoose } from "./tools/_json.js";
export { assignBattleDefinition, callAsUser, executeAssignBattle } from "./tools/assign-battle.js";
export { assembleLessonPlan, assembleWorksheetQuestions } from "./tools/generator-scaffold.js";
export { assembleQuiz } from "./tools/quiz-scaffold.js";
