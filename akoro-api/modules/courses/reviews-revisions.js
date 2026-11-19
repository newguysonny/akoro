/**
 * reviews-revisions.js  —  Piabam Reviews & Ratings router
 *
 * Handles:
 *   - List course reviews (paginated, filterable by star rating)
 *   - Submit review (enrolled students only)
 *   - Update own review
 *   - Delete own review (or admin)
 *   - Toggle helpful vote on a review
 *
 * Usage in app.js:
 *   import reviewsRouter from "./routes/reviews-revisions.js";
 *   app.use("/api", reviewsRouter);
 */

import { Router }                         from "express";
import { body, query, validationResult }  from "express-validator";
import db                                 from "../../db.js";
import { authenticateToken, requireRole } from "../auth/index.js";
import { notify }                         from "../notifications/events.js";

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

const REVIEW_SELECT = `
  id, rating, comment, is_verified_purchase,
  helpful_count, reported_count, created_at, updated_at,
  users!reviews_user_id_fkey ( id, full_name, username, avatar_url )
`;

const handlers = {

  /**
   * GET /api/courses/:courseId/reviews
   * Paginated list of reviews. Optional ?rating=5 filter.
   */
  list: asyncHandler(async (req, res) => {
    const { rating, limit = 20, offset = 0 } = req.query;

    let q = db
      .from("reviews")
      .select(REVIEW_SELECT, { count: "exact" })
      .eq("course_id", req.params.courseId)
      .order("helpful_count", { ascending: false })
      .order("created_at",    { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (rating) q = q.eq("rating", Number(rating));

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);

    // Attach current user's helpful vote status
    const enriched = await Promise.all((data ?? []).map(async (r) => {
      const { data: voted } = await db
        .from("review_helpful")
        .select("id")
        .eq("review_id", r.id)
        .eq("user_id", req.user.id)
        .single();

      return { ...r, has_voted_helpful: !!voted };
    }));

    // Rating distribution
    const { data: allRatings } = await db
      .from("reviews")
      .select("rating")
      .eq("course_id", req.params.courseId);

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    (allRatings ?? []).forEach((r) => { distribution[r.rating] = (distribution[r.rating] ?? 0) + 1; });

    const total    = allRatings?.length ?? 0;
    const avgRating = total
      ? Math.round((allRatings ?? []).reduce((s, r) => s + r.rating, 0) / total * 10) / 10
      : 0;

    res200(res, enriched, {
      total: count ?? 0,
      avg_rating:   avgRating,
      distribution,
    });
  }),

  /**
   * POST /api/courses/:courseId/reviews
   * Submit a review. Student must be enrolled.
   * One review per student per course (upsert).
   */
  submit: asyncHandler(async (req, res) => {
    const { courseId }      = req.params;
    const { rating, comment } = req.body;
    const userId            = req.user.id;

    // Check enrollment
    const { data: enrollment } = await db
      .from("enrollments")
      .select("id")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .eq("status", "active")
      .single();

    if (!enrollment)
      return res403(res, "You must be enrolled in this course to leave a review");

    // Check if already reviewed
    const { data: existing } = await db
      .from("reviews")
      .select("id")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .single();

    let data, error;

    if (existing) {
      // Update existing review
      ({ data, error } = await db
        .from("reviews")
        .update({ rating, comment: comment ?? null, updated_at: now() })
        .eq("id", existing.id)
        .select(REVIEW_SELECT)
        .single());
    } else {
      // Create new review
      ({ data, error } = await db
        .from("reviews")
        .insert({
          user_id:              userId,
          course_id:            courseId,
          rating,
          comment:              comment ?? null,
          is_verified_purchase: true,
        })
        .select(REVIEW_SELECT)
        .single());
    }

    if (error) throw new Error(error.message);

    // Recompute course avg rating
    const { data: allRatings } = await db
      .from("reviews")
      .select("rating")
      .eq("course_id", courseId);

    const avgRating = allRatings?.length
      ? Math.round((allRatings.reduce((s, r) => s + r.rating, 0) / allRatings.length) * 100) / 100
      : 0;

    await db.from("courses").update({ rating: avgRating }).eq("id", courseId);

    // Notify the instructor of a genuinely new review (not an edit).
    if (!existing) {
      const { data: course } = await db.from("courses").select("instructor_id, title").eq("id", courseId).single();
      if (course?.instructor_id)
        notify.newReview({ instructorId: course.instructor_id, courseTitle: course.title, rating });
    }

    const status = existing ? 200 : 201;
    res.status(status).json({ success: true, data, avg_rating: avgRating });
  }),

  /**
   * PUT /api/reviews/:reviewId
   * Update own review.
   */
  update: asyncHandler(async (req, res) => {
    const { rating, comment } = req.body;

    const { data: review } = await db
      .from("reviews")
      .select("id, user_id, course_id")
      .eq("id", req.params.reviewId)
      .single();

    if (!review) return res404(res, "Review not found");
    if (review.user_id !== req.user.id)
      return res403(res, "You can only edit your own review");

    const { data, error } = await db
      .from("reviews")
      .update({
        rating:  rating  ?? undefined,
        comment: comment ?? undefined,
        updated_at: now(),
      })
      .eq("id", req.params.reviewId)
      .select(REVIEW_SELECT)
      .single();

    if (error) throw new Error(error.message);

    // Recompute avg rating
    const { data: allRatings } = await db
      .from("reviews")
      .select("rating")
      .eq("course_id", review.course_id);

    const avgRating = allRatings?.length
      ? Math.round((allRatings.reduce((s, r) => s + r.rating, 0) / allRatings.length) * 100) / 100
      : 0;

    await db.from("courses").update({ rating: avgRating }).eq("id", review.course_id);

    res200(res, { ...data, avg_rating: avgRating });
  }),

  /**
   * DELETE /api/reviews/:reviewId
   * Owner or admin can delete.
   */
  delete: asyncHandler(async (req, res) => {
    const { data: review } = await db
      .from("reviews")
      .select("id, user_id, course_id")
      .eq("id", req.params.reviewId)
      .single();

    if (!review) return res404(res, "Review not found");

    const canDelete = review.user_id === req.user.id || req.user.role === "admin";
    if (!canDelete) return res403(res, "Not authorised to delete this review");

    await db.from("reviews").delete().eq("id", req.params.reviewId);

    // Recompute avg rating after deletion
    const { data: allRatings } = await db
      .from("reviews")
      .select("rating")
      .eq("course_id", review.course_id);

    const avgRating = allRatings?.length
      ? Math.round((allRatings.reduce((s, r) => s + r.rating, 0) / allRatings.length) * 100) / 100
      : 0;

    await db.from("courses").update({ rating: avgRating }).eq("id", review.course_id);

    res204(res);
  }),

  /**
   * POST /api/reviews/:reviewId/helpful
   * Toggle helpful vote on a review.
   */
  toggleHelpful: asyncHandler(async (req, res) => {
    const { reviewId } = req.params;

    const { data: existing } = await db
      .from("review_helpful")
      .select("id")
      .eq("review_id", reviewId)
      .eq("user_id", req.user.id)
      .single();

    let helpful_count, voted;

    if (existing) {
      // Remove vote
      await db.from("review_helpful").delete().eq("id", existing.id);
      const { data: r } = await db
        .from("reviews")
        .select("helpful_count")
        .eq("id", reviewId)
        .single();
      helpful_count = Math.max(0, (r?.helpful_count ?? 1) - 1);
      await db.from("reviews").update({ helpful_count }).eq("id", reviewId);
      voted = false;
    } else {
      // Add vote
      await db
        .from("review_helpful")
        .insert({ review_id: reviewId, user_id: req.user.id });
      const { data: r } = await db
        .from("reviews")
        .select("helpful_count")
        .eq("id", reviewId)
        .single();
      helpful_count = (r?.helpful_count ?? 0) + 1;
      await db.from("reviews").update({ helpful_count }).eq("id", reviewId);
      voted = true;
    }

    res200(res, { voted, helpful_count });
  }),
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

router.get   ("/courses/:courseId/reviews",       authenticateToken, handlers.list);
router.post  ("/courses/:courseId/reviews",       authenticateToken, [
  body("rating").isInt({ min: 1, max: 5 }).withMessage("rating must be 1–5"),
  body("comment").optional().trim().isLength({ max: 2000 }),
], runValidation, handlers.submit);
router.put   ("/reviews/:reviewId",               authenticateToken, [
  body("rating").optional().isInt({ min: 1, max: 5 }),
  body("comment").optional().trim().isLength({ max: 2000 }),
], runValidation, handlers.update);
router.delete("/reviews/:reviewId",               authenticateToken, handlers.delete);
router.post  ("/reviews/:reviewId/helpful",       authenticateToken, handlers.toggleHelpful);

export default router;
