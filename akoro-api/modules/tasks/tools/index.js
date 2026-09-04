import { generateQuizDefinition,     executeGenerateQuiz     } from "./generate-quiz.js";
import { sendReminderDefinition,     executeSendReminder     } from "./send-reminder.js";
import { gradeSubmissionsDefinition, executeGradeSubmissions } from "./grade-submissions.js";
import { fetchStudentDataDefinition, executeFetchStudentData } from "./fetch-student-data.js";
import { scheduleSessionDefinition,  executeScheduleSession  } from "./schedule-session.js";
import { exportReportDefinition,     executeExportReport     } from "./export-report.js";
import { quizMeDefinition,           executeQuizMe           } from "./quiz-me.js";
import { explainConceptDefinition,   executeExplainConcept   } from "./explain-concept.js";
import { studyPlanDefinition,        executeStudyPlan        } from "./study-plan.js";
import { setStudyReminderDefinition, executeSetStudyReminder } from "./set-study-reminder.js";
import { challengePeerDefinition,    executeChallengePeer    } from "./challenge-peer.js";
// Catalog-backed instructor tools (orchestrated workflows)
import { lessonPlanFillDefinition,      executeLessonPlanFill      } from "./lesson-plan-fill.js";
import { worksheetFillDefinition,       executeWorksheetFill       } from "./worksheet-fill.js";
import { reportWritingDefinition,       executeReportWriting       } from "./report-writing.js";
import { examPrepDefinition,            executeExamPrep            } from "./exam-prep.js";
import { attendanceRollcallDefinition,  executeAttendanceRollcall  } from "./attendance-rollcall.js";
import { interactiveMaterialDefinition, executeInteractiveMaterial } from "./interactive-material.js";
// Scheduling the things teachers actually assign, through the same endpoints
// the UI uses — so a battle or study topic set by a schedule is the same object
// as one set by hand.
import { assignBattleDefinition,    executeAssignBattle    } from "./assign-battle.js";
import { assignSelfStudyDefinition, executeAssignSelfStudy } from "./assign-self-study.js";
import { teachingToolDefinition,    executeTeachingTool    } from "./teaching-tool.js";

export const ALL_TOOLS = [
  { definition: generateQuizDefinition,     execute: executeGenerateQuiz     },
  { definition: sendReminderDefinition,     execute: executeSendReminder     },
  { definition: gradeSubmissionsDefinition, execute: executeGradeSubmissions  },
  { definition: fetchStudentDataDefinition, execute: executeFetchStudentData  },
  { definition: scheduleSessionDefinition,  execute: executeScheduleSession   },
  { definition: exportReportDefinition,     execute: executeExportReport      },
  { definition: quizMeDefinition,           execute: executeQuizMe            },
  { definition: explainConceptDefinition,   execute: executeExplainConcept    },
  { definition: studyPlanDefinition,        execute: executeStudyPlan         },
  { definition: setStudyReminderDefinition, execute: executeSetStudyReminder  },
  { definition: challengePeerDefinition,    execute: executeChallengePeer     },
  { definition: lessonPlanFillDefinition,      execute: executeLessonPlanFill      },
  { definition: worksheetFillDefinition,       execute: executeWorksheetFill       },
  { definition: reportWritingDefinition,       execute: executeReportWriting       },
  { definition: examPrepDefinition,            execute: executeExamPrep            },
  { definition: attendanceRollcallDefinition,  execute: executeAttendanceRollcall  },
  { definition: interactiveMaterialDefinition, execute: executeInteractiveMaterial },
  { definition: assignBattleDefinition,        execute: executeAssignBattle        },
  { definition: assignSelfStudyDefinition,     execute: executeAssignSelfStudy     },
  { definition: teachingToolDefinition,        execute: executeTeachingTool        },
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
  // 'create_battle' is the TASK TYPE every battle request routes to; the tool
  // of the same name is gone. It inserted straight into `battles` and wrote no
  // participants at all, so what it made was a battle with no players — and it
  // was offered to the model alongside assign_battle, leaving the choice
  // between a working tool and a broken one to two tool descriptions.
  create_battle:      [tool("assign_battle"), tool("fetch_student_data")],
  assign_battle:      [tool("assign_battle"), tool("fetch_student_data")],
  assign_self_study:  [tool("assign_self_study"), tool("fetch_student_data")],
  run_teaching_tool:  [tool("run_teaching_tool")],
  quiz_me:            [tool("quiz_me")],
  explain_concept:    [tool("explain_concept")],
  create_study_plan:  [tool("create_study_plan")],
  set_study_reminder: [tool("set_study_reminder")],
  challenge_peer:     [tool("challenge_peer")],
  lesson_plan_fill:     [tool("lesson_plan_fill")],
  worksheet_fill:       [tool("worksheet_fill")],
  report_writing:       [tool("report_writing"),      tool("fetch_student_data")],
  exam_prep:            [tool("exam_prep")],
  attendance_rollcall:  [tool("attendance_rollcall"),  tool("fetch_student_data")],
  interactive_material: [tool("interactive_material")],
  general:            ALL_TOOLS,
};

export const getToolsForTaskType = (type) => TOOLS_BY_TYPE[type] ?? TOOLS_BY_TYPE.general;
export const findTool            = (name) => ALL_TOOLS.find((t) => t.definition.name === name);

/**
 * getToolsForTask — resolves the full tool set for a task at run time.
 * Unions the static (code) tools for the task type with the config-only
 * (dynamic) tools the task creator's partner is entitled to. Deduped by name;
 * a code tool wins over a dynamic tool sharing its name.
 */
export const getToolsForTask = async (task) => {
  const staticTools = getToolsForTaskType(task?.task_type ?? "general");
  let dynamicTools = [];
  try {
    const { loadDynamicToolsForUser } = await import("./dynamic.js");
    dynamicTools = await loadDynamicToolsForUser(task?.creator_id);
  } catch (e) {
    console.warn("[tasks/tools] dynamic load skipped:", e.message);
  }
  const byName = new Map();
  for (const t of [...dynamicTools, ...staticTools]) byName.set(t.definition.name, t);

  // Enforcement: platform tools the instructor hasn't purchased are removed
  // from the agent's tool set, so the agent simply can't invoke them.
  try {
    const { TOOL_GATES, getUnlockedToolKeys } = await import("../../instructor/toolAccess.js");
    const gatedNames = Object.keys(TOOL_GATES).filter((n) => byName.has(n));
    if (gatedNames.length) {
      const unlocked = await getUnlockedToolKeys(task?.creator_id);
      for (const name of gatedNames) {
        if (!unlocked.has(TOOL_GATES[name])) byName.delete(name);
      }
    }
  } catch (e) {
    console.warn("[tasks/tools] tool-gate check skipped:", e.message);
  }

  return [...byName.values()];
};
