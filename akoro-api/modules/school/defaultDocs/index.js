/**
 * Shared default document/form templates — a common repo of print-ready
 * templates (lesson plan, report card, worksheet, certificate) available to
 * both the School and Instructor apps. Each renders like a real file via
 * documentRenderer. Using one clones it into the caller's own templates.
 */
import lessonPlan from "./lessonPlan.js";
import reportCard from "./reportCard.js";
import worksheet from "./worksheet.js";
import certificate from "./certificate.js";

export const DEFAULT_DOC_TEMPLATES = [lessonPlan, reportCard, worksheet, certificate];
export const getDefaultDoc = (id) => DEFAULT_DOC_TEMPLATES.find((t) => t.id === id) || null;
