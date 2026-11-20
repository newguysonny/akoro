// Activities feature — public surface.
//
// The learner's own work: the activity detail screen (question stepper,
// hand-in, marked paper) and the proctored assessment room. Features only
// see this file; shared code lives in
// src/{components,contexts,hooks,lib,services,utils,client}.
export { default as ActivityDetailPage } from './ActivityDetailPage.jsx';
export { default as AssessmentPage } from './AssessmentPage.jsx';
export { default as AssessmentRoom } from './components/AssessmentRoom.jsx';
export { default as AssessmentChat } from './components/AssessmentChat.jsx';
export { default as ExamPrepConfidenceModal } from './components/ExamPrepConfidenceModal.jsx';
export { default as ProctorMonitor } from './components/ProctorMonitor.jsx';
export { default as VoiceExam } from './components/VoiceExam.jsx';
