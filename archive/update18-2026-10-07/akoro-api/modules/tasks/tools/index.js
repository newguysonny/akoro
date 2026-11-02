import { generateQuizDefinition,     executeGenerateQuiz     } from "./generate-quiz.js";
import { sendReminderDefinition,     executeSendReminder     } from "./send-reminder.js";
import { gradeSubmissionsDefinition, executeGradeSubmissions } from "./grade-submissions.js";
import { fetchStudentDataDefinition, executeFetchStudentData } from "./fetch-student-data.js";
import { scheduleSessionDefinition,  executeScheduleSession  } from "./schedule-session.js";
import { exportReportDefinition,     executeExportReport     } from "./export-report.js";
import { createBattleDefinition,     executeCreateBattle     } from "./create-battle.js";

export const ALL_TOOLS = [
  { definition: generateQuizDefinition,     execute: executeGenerateQuiz     },
  { definition: sendReminderDefinition,     execute: executeSendReminder     },
  { definition: gradeSubmissionsDefinition, execute: executeGradeSubmissions  },
  { definition: fetchStudentDataDefinition, execute: executeFetchStudentData  },
  { definition: scheduleSessionDefinition,  execute: executeScheduleSession   },
  { definition: exportReportDefinition,     execute: executeExportReport      },
  { definition: createBattleDefinition,     execute: executeCreateBattle      },
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
  general:            ALL_TOOLS,
};

export const getToolsForTaskType = (type) => TOOLS_BY_TYPE[type] ?? TOOLS_BY_TYPE.general;
export const findTool            = (name) => ALL_TOOLS.find((t) => t.definition.name === name);
