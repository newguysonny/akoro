import { generateQuizDefinition,     executeGenerateQuiz     } from "./generate-quiz.js";
import { sendReminderDefinition,     executeSendReminder     } from "./send-reminder.js";
import { gradeSubmissionsDefinition, executeGradeSubmissions } from "./grade-submissions.js";
import { fetchStudentDataDefinition, executeFetchStudentData } from "./fetch-student-data.js";
import { scheduleSessionDefinition,  executeScheduleSession  } from "./schedule-session.js";
import { exportReportDefinition,     executeExportReport     } from "./export-report.js";
import { createBattleDefinition,     executeCreateBattle     } from "./create-battle.js";
import { quizMeDefinition,           executeQuizMe           } from "./quiz-me.js";
import { explainConceptDefinition,   executeExplainConcept   } from "./explain-concept.js";
import { studyPlanDefinition,        executeStudyPlan        } from "./study-plan.js";
import { setStudyReminderDefinition, executeSetStudyReminder } from "./set-study-reminder.js";
import { challengePeerDefinition,    executeChallengePeer    } from "./challenge-peer.js";

export const ALL_TOOLS = [
  { definition: generateQuizDefinition,     execute: executeGenerateQuiz     },
  { definition: sendReminderDefinition,     execute: executeSendReminder     },
  { definition: gradeSubmissionsDefinition, execute: executeGradeSubmissions  },
  { definition: fetchStudentDataDefinition, execute: executeFetchStudentData  },
  { definition: scheduleSessionDefinition,  execute: executeScheduleSession   },
  { definition: exportReportDefinition,     execute: executeExportReport      },
  { definition: createBattleDefinition,     execute: executeCreateBattle      },
  { definition: quizMeDefinition,           execute: executeQuizMe            },
  { definition: explainConceptDefinition,   execute: executeExplainConcept    },
  { definition: studyPlanDefinition,        execute: executeStudyPlan         },
  { definition: setStudyReminderDefinition, execute: executeSetStudyReminder  },
  { definition: challengePeerDefinition,    execute: executeChallengePeer     },
];

const tool = (name) => {
  const t = ALL_TOOLS.find((r) => r.definition.name === name);
  if (!t) throw new Error(`Tool "${name}" not found`);
  return t;
};

export const TOOLS_BY_TYPE = {
  generate_quiz:      [tool("generate_quiz"),      tool("fetch_student_data")],
  send_reminder:      [tool("send_reminder"),      tool("fetch_student_data")],
  grade_submissions:  [tool("grade_submissions"),  tool("fetch_student_data")],
  fetch_student_data: [tool("fetch_student_data")],
  schedule_session:   [tool("schedule_session"),   tool("fetch_student_data")],
  export_report:      [tool("export_report"),      tool("fetch_student_data")],
  create_battle:      [tool("create_battle"),      tool("fetch_student_data")],
  quiz_me:            [tool("quiz_me")],
  explain_concept:    [tool("explain_concept")],
  create_study_plan:  [tool("create_study_plan")],
  set_study_reminder: [tool("set_study_reminder")],
  challenge_peer:     [tool("challenge_peer")],
  general:            ALL_TOOLS,
};

export const getToolsForTaskType = (type) => TOOLS_BY_TYPE[type] ?? TOOLS_BY_TYPE.general;
export const findTool            = (name) => ALL_TOOLS.find((t) => t.definition.name === name);
