/**
 * instructor/service.js — request orchestration for the instructor router.
 * One export per handler; routes.js only names them. No SQL here (store*.js
 * owns the queries) and no pure normalisers (rules.js owns those).
 *
 * The handlers are split by resource to stay small:
 *   service-dashboard   → stats, profile/preferences, classrooms
 *   service-courses     → course CRUD and cover upload
 *   service-curriculum  → modules, schedule preview/commit, curriculum, materials
 *   service-sessions    → live sessions and their reminders
 *   service-students    → the teacher's learner list and enrolment
 *   service-battles     → battle CRUD
 *   service-credentials → streaming/social credentials
 *   service-documents   → document templates, rendering and records
 */
export {
  getStats, getProfile, updateProfile, updateNotifications, updateAgent,
  listClassrooms, listClassroomStudents,
} from "./service-dashboard.js";
export {
  listCourses, createCourse, updateCourse, deleteCourse, uploadCourseCover,
} from "./service-courses.js";
export {
  listModules, createModule, updateModule, deleteModule,
  previewSchedule, commitSchedule, commitCurriculum,
  listMaterials, addMaterial, deleteMaterial,
} from "./service-curriculum.js";
export {
  listSessions, createSession, updateSession, deleteSession,
} from "./service-sessions.js";
export {
  listStudents, enrolStudent, removeStudent,
} from "./service-students.js";
export {
  listBattles, createBattle, updateBattle, deleteBattle,
} from "./service-battles.js";
export {
  getStreaming, connectStreaming, disconnectStreaming,
  getSocial, connectSocial, disconnectSocial,
} from "./service-credentials.js";
export {
  listDocTemplates, createDocTemplate, createDocTemplateFromSample,
  updateDocTemplate, deleteDocTemplate, docTemplateHtml,
  renderDocTemplate, previewDocument,
} from "./service-documents.js";
