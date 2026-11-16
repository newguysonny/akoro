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
// Instructor domains (my_classes … my_activity_drafts) enrolled 2026-11-16.

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
  my_past_questions: makeMergedDomain({
    name: "my_past_questions",
    view: "my_past_questions",
    area: "progress",
    envVar: "AKORO_MERGED_PASTQ",
    actionOrder: ["count", "list", "by_subject", "accuracy", "search"],
    baseActions: ["count", "list", "by_subject", "search"],
    platformActions: ["accuracy"],
    description: "Your past-question practice — one tool for all of it. Actions: count = how many practice records you have; list = your practice records; by_subject = records per subject; accuracy = attempted, correct and accuracy grouped by exam and subject (pass query as a subject name to filter it); search = practice records whose subject matches query. Never invent practice results.",
  }),
  my_weak_topics: makeMergedDomain({
    name: "my_weak_topics",
    view: "my_weak_topics",
    area: "progress",
    envVar: "AKORO_MERGED_WEAK",
    actionOrder: ["count", "list", "by_subject", "search"],
    baseActions: ["count", "by_subject", "search"],
    platformActions: ["list"],
    description: "Your weak topics — one tool for all of it. Actions: list = the topics you find hardest, weakest first, with confidence levels (pass query as a subject name to filter); count = how many weak-topic records you have; by_subject = records per subject; search = weak-topic records whose topic matches query. Never invent a weak topic.",
  }),

  // Instructor domains (Matt's order 2026-11-16: the learner treatment —
  // merger, area grouping, runtime selection — for instructor tools too).
  // The pipeline side (build guard, My-tools delta presentation, view
  // runner) is generic over this list, so enrolling a view here extends
  // all of it to instructor builds; chat.js assembles and dispatches the
  // merged defs for instructor turns. All five live in the activities area.
  my_classes: makeMergedDomain({
    name: "my_classes",
    view: "my_classes",
    area: "activities",
    envVar: "AKORO_MERGED_CLASSES",
    actionOrder: ["count", "list", "search"],
    baseActions: ["count", "search"],
    platformActions: ["list"],
    description: "Your classes — one tool for all of it. Actions: count = how many classes you have; list = your classes with learner counts and each class's roster (up to 40 names per class); search = classes whose name matches query. Never invent a class.",
  }),
  my_class_students: makeMergedDomain({
    name: "my_class_students",
    view: "my_class_students",
    area: "activities",
    envVar: "AKORO_MERGED_CLASS_STUDENTS",
    actionOrder: ["count", "list", "by_status", "search"],
    baseActions: ["count", "list", "by_status", "search"],
    platformActions: [],
    description: "Students in your classes — one tool for all of it. Actions: count = how many class enrolments there are across your classes; list = the students in your classes, each with their class and enrolment status; by_status = enrolments per status; search = enrolments whose class name matches query. Never invent a student.",
  }),
  my_activities: makeMergedDomain({
    name: "my_activities",
    view: "my_activities",
    area: "activities",
    envVar: "AKORO_MERGED_ACTIVITIES",
    actionOrder: ["count", "list", "by_subject", "search"],
    baseActions: ["count", "list", "by_subject", "search"],
    platformActions: [],
    description: "Activities you have set — one tool for all of it. Actions: count = how many activities you have set; list = your activities (title, type, subject, topic, difficulty, due date, status); by_subject = activities per subject; search = activities whose title matches query. This tool only reads activities already set — to prepare a new one, use prepare_activity. Never invent an activity.",
  }),
  my_activity_results: makeMergedDomain({
    name: "my_activity_results",
    view: "my_activity_results",
    area: "activities",
    envVar: "AKORO_MERGED_RESULTS",
    actionOrder: ["count", "list", "by_subject", "search", "overview"],
    baseActions: ["count", "list", "by_subject", "search"],
    platformActions: ["overview"],
    description: "Your students' results on activities you set — one tool for all of it. Actions: count = how many result records there are; list = results (student, activity, subject, status, grade); by_subject = results per subject; search = results whose subject matches query; overview = the outcome summary for ONE activity (pass its assignmentId as query) — with no query it lists your recent activities to pick from. Never invent a result.",
  }),
  my_activity_drafts: makeMergedDomain({
    name: "my_activity_drafts",
    view: "my_activity_drafts",
    area: "activities",
    envVar: "AKORO_MERGED_DRAFTS",
    actionOrder: ["count", "list", "by_subject", "search", "get"],
    baseActions: ["count", "by_subject", "search"],
    platformActions: ["list", "get"],
    description: "Your unassigned activity drafts — one tool for all of it. Actions: count = how many drafts are waiting; list = your pending drafts (draftId, title, type, when prepared); by_subject = drafts per subject; search = drafts whose title matches query; get = one draft in full, questions included (pass its draftId as query). Never invent a draft.",
  }),

};

export const MERGED_DOMAIN_LIST = Object.values(MERGED_DOMAINS);
