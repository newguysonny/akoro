// Merged domains — the config-driven engine behind the library (edc274a5)
// and chats (c254a392) merges, generalised for the rollout Matt ordered
// 2026-11-15: tasks, goals, study notes, learning sessions, past questions,
// weak topics. One config per domain; pipeline.js (build guard, My-tools
// presentation, view runner) and chat.js (def assembly, dispatch) are
// generic over these configs. Each domain has its own kill switch.
//
// A merged domain serves its actions from two sides with no duplicates:
//   - baseActions     → the platform side: reads over the domain's Data View.
//   - platformActions → the platform side: the existing hand-written
//                       built-in handler (richer than the view: ids, content
//                       search, derived summaries).
//   - anything else   → the learner's own saved delta actions on their row.
// Pure module (no imports) so the contract tests exercise the real shapes.

function makeMergedDomain(cfg) {
  const mergedActions = [...cfg.baseActions, ...cfg.platformActions];
  return {
    ...cfg,
    mergedActions,
    enabled: () => process.env[cfg.envVar] !== "false",
    buildIsCovered(actions) {
      return Array.isArray(actions) && actions.length > 0
        && actions.every((a) => mergedActions.includes(a));
    },
    deltaActions(row) {
      if (!row) return [];
      const off = new Set(row.disabledActions || row.disabled_actions || []);
      return (row.actions || []).filter((a) => !mergedActions.includes(a) && !off.has(a));
    },
    def({ delta = [] } = {}) {
      const actions = [...cfg.actionOrder, ...delta.filter((a) => !cfg.actionOrder.includes(a))];
      const extra = delta.length
        ? ` This learner also saved extra actions on their own copy of this tool: ${delta.join(", ")} — those run from their copy.`
        : "";
      return {
        type: "function",
        function: {
          name: cfg.name,
          description: cfg.description + extra,
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", enum: actions, description: "Which action to run." },
              query: { type: "string", description: "Search words (used by action=search, and by filters where the description says so)." },
              limit: { type: "integer", description: "Max rows where the description gives a cap." },
            },
            required: ["action"],
          },
        },
      };
    },
  };
}

export const MERGED_DOMAINS = {
  my_tasks: makeMergedDomain({
    name: "my_tasks",
    view: "my_tasks",
    area: "plans",
    envVar: "AKORO_MERGED_TASKS",
    actionOrder: ["count", "list", "by_status", "search"],
    baseActions: ["count", "by_status", "search"],
    platformActions: ["list"],
    description: "Your tasks and to-dos — one tool for all of it. Actions: count = how many tasks you have in total (every status); list = your pending tasks, most important first, each with its taskId (use a taskId with the task tools, e.g. to mark one done); by_status = how many tasks per status; search = tasks whose title matches query. Never invent a task.",
  }),
  my_goals: makeMergedDomain({
    name: "my_goals",
    view: "my_goals",
    area: "plans",
    envVar: "AKORO_MERGED_GOALS",
    actionOrder: ["count", "list", "by_status", "search"],
    baseActions: ["count", "by_status", "search"],
    platformActions: ["list"],
    description: "Your goals — one tool for all of it. Actions: count = how many goals you have in total; list = all your goals with their goalId, status, category and target date; by_status = how many goals per status (a goal counts as completed only when its status is achieved — there is no 'completed' status); search = goals whose title matches query. Never invent a goal.",
  }),
  my_study_notes: makeMergedDomain({
    name: "my_study_notes",
    view: "my_study_notes",
    area: "teaching",
    envVar: "AKORO_MERGED_NOTES",
    actionOrder: ["count", "list", "by_subject", "search"],
    baseActions: ["count", "list", "by_subject"],
    platformActions: ["search"],
    description: "Your saved study notes — the topics you have taught your agent, each with a subject, topic and confidence score. These are NOT Library documents (uploads, links, pasted text — those live in library_documents); when the learner says 'study notes' or 'notes', they mean THIS tool. Actions: count = how many notes you have; list = your notes; by_subject = how many notes per subject; search = find notes by what they say — pass query. Never invent a note.",
  }),
  my_study_sessions: makeMergedDomain({
    name: "my_study_sessions",
    view: "my_learning_sessions",
    area: "teaching",
    envVar: "AKORO_MERGED_SESSIONS",
    actionOrder: ["count", "list", "by_subject", "search", "overview"],
    baseActions: ["count", "list", "by_subject", "search"],
    platformActions: ["overview"],
    description: "Your learning sessions — one tool for all of it. Actions: count = how many learning sessions you have; list = your session records; by_subject = sessions per subject; search = sessions whose subject or topic matches query; overview = your learning profile: your agent, what you have taught it by subject with confidence levels, and your most recent sessions. Never invent a session.",
  }),


};

export const MERGED_DOMAIN_LIST = Object.values(MERGED_DOMAINS);
