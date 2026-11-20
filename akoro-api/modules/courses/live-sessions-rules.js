/**
 * live-sessions-rules.js — pure validation rules and constants for live sessions.
 *
 * No database import and no Express objects. The service and router import the
 * chains and field allowlist from here so the request contract lives in one
 * place; `now` is the timestamp every write stamps.
 */

import { body } from "express-validator";

export const sessionRules = {
  create: [
    body("title").trim().notEmpty().withMessage("title is required"),
    body("scheduled_start").isISO8601().withMessage("scheduled_start must be a valid ISO date"),
    body("platform").optional().isIn(["zoom", "meet", "teams"]),
    body("session_type").optional().isIn(["class", "revision", "office_hours"]),
    body("max_participants").optional().isInt({ min: 1, max: 500 }),
    body("description").optional().trim(),
    body("topic").optional().trim(),
  ],
  update: [
    body("title").optional().trim().notEmpty(),
    body("scheduled_start").optional().isISO8601(),
    body("description").optional().trim(),
    body("topic").optional().trim(),
    body("max_participants").optional().isInt({ min: 1, max: 500 }),
  ],
  feedback: [
    body("rating").isInt({ min: 1, max: 5 }).withMessage("rating must be 1–5"),
    body("feedback_text").optional().trim().isLength({ max: 1000 }),
  ],
};

/** Fields a PUT /live-sessions/:sessionId may change; everything else is ignored. */
export const UPDATABLE_SESSION_FIELDS = [
  "title", "description", "topic", "scheduled_start", "scheduled_end", "max_participants",
];

export const now = () => new Date().toISOString();
