/**
 * course-content-rules.js  —  shared helpers + validation chains
 *
 * Extracted from course-content.js (Phase 19 step 4). Response shorthands,
 * the async wrapper, the express-validator chains and the timestamp helper
 * are unchanged; the mounted router and the outline reads both import them.
 */

import { body, validationResult } from "express-validator";

// ─── § HELPERS ────────────────────────────────────────────────────────────────

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const res204 = (res)                  => res.status(204).send();
const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
const res403 = (res, msg)             => res.status(403).json({ success: false, message: msg });
const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
};

const now = () => new Date().toISOString();

// ─── § VALIDATION RULES ───────────────────────────────────────────────────────

const rules = {
  createModule: [
    body("title").trim().notEmpty().withMessage("title is required").isLength({ max: 255 }),
    body("description").optional().trim().isLength({ max: 2000 }),
    body("order_index").optional().isInt({ min: 0 }),
  ],
  createLesson: [
    body("title").trim().notEmpty().withMessage("title is required").isLength({ max: 255 }),
    body("description").optional().trim().isLength({ max: 2000 }),
    body("lesson_type").optional().isIn(["video", "quiz", "assignment", "reading"]),
    body("order_index").optional().isInt({ min: 0 }),
    body("is_preview").optional().isBoolean(),
    body("duration_seconds").optional().isInt({ min: 0 }),
    body("content_json").optional().isObject(),
  ],
  saveProgress: [
    body("position").isInt({ min: 0 }).withMessage("position (seconds) is required"),
  ],
  submitQuiz: [
    body("answers").isArray({ min: 1 }).withMessage("answers array is required"),
    body("answers.*.question_id").notEmpty(),
    body("answers.*.answer").notEmpty(),
  ],
};

export { asyncHandler, res200, res201, res204, res400, res403, res404, runValidation, now, rules };
