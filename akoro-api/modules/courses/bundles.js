/**
 * routes/bundles.js  —  Piabam Course Bundles & Full-Text Search
 *
 * Handles:
 *   - Course bundle CRUD (instructor)
 *   - Bundle purchase via Paystack (enrolls in all bundled courses)
 *   - Bundle listing + detail
 *   - Full-text course search using pg_trgm (weighted title + description)
 *   - Wishlist toggle + list
 *
 * Usage in app.js:
 *   import bundlesRouter from "./routes/bundles.js";
 *   app.use("/api", bundlesRouter);
 */

import { Router }                         from "express";
import { peekAccessToken }                from "../../lib/tokenPeek.js";
import axios                              from "axios";
import { paystackPost, paystackGet }            from "../../lib/paystackBreaker.js";
import { body, query, validationResult }  from "express-validator";
import db                                 from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { businessConfig }                 from "../../config/index.js";

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

// ─── Full-text search helpers ─────────────────────────────────────────────────

/**
 * searchCourses
 * Uses Postgres pg_trgm similarity search for ranked full-text results.
 * Title matches are weighted higher than description matches.
 *
 * Falls back to ilike if no pg_trgm extension (should always be present on Supabase).
 */
const searchCourses = async ({ q, courseType, subject, level, minPrice, maxPrice, limit = 20, offset = 0 }) => {
  // Use Supabase RPC for the weighted similarity query
  // This calls a Postgres function — add it to migration.sql
  try {
    const { data, error } = await db.rpc("search_courses", {
      search_query: q,
      p_course_type: courseType ?? null,
      p_subject:     subject    ?? null,
      p_level:       level      ?? null,
      p_min_price:   minPrice   ?? null,
      p_max_price:   maxPrice   ?? null,
      p_limit:       Number(limit),
      p_offset:      Number(offset),
    });

    if (!error && data) return data;
  } catch (e) {
    console.warn("[search] pg_trgm RPC unavailable, falling back to ilike:", e.message);
  }

  // Fallback: basic ilike search
  const qs = String(q || "").replace(/[,()%*:\\]/g, " ");  // neuter PostgREST filter metacharacters
  let query = db
    .from("courses")
    .select(`
      id, title, slug, description, cover_image_url, course_type,
      subject, level, language, price, discount_price, currency,
      is_free, total_students, rating, total_hours, is_published,
      users!courses_instructor_id_fkey ( id, full_name, avatar_url )
    `)
    .eq("is_published", true)
    .or(`title.ilike.%${qs}%,description.ilike.%${qs}%`)
    .order("rating", { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (courseType) query = query.eq("course_type", courseType);
  if (subject)    query = query.eq("subject", subject);
  if (level)      query = query.eq("level", level);
  if (minPrice)   query = query.gte("price", Number(minPrice));
  if (maxPrice)   query = query.lte("price", Number(maxPrice));

  const { data } = await query;
  return data ?? [];
};

// ─── Search handler ────────────────────────────────────────────────────────────

const searchHandler = asyncHandler(async (req, res) => {
  const { q, course_type, subject, level, min_price, max_price, limit = 20, offset = 0 } = req.query;

  if (!q || q.trim().length < 2)
    return res400(res, "Search query must be at least 2 characters");

  const results = await searchCourses({
    q: q.trim(),
    courseType: course_type,
    subject, level,
    minPrice: min_price,
    maxPrice: max_price,
    limit, offset,
  });

  // Attach enrollment status if authenticated
  if (req.user) {
    for (const course of results) {
      const { data: enrollment } = await db
        .from("enrollments").select("id, progress")
        .eq("user_id", req.user.id).eq("course_id", course.id).single();
      course.is_enrolled = !!enrollment;
      course.progress    = enrollment?.progress ?? 0;

      const { data: wishlisted } = await db
        .from("wishlists").select("id")
        .eq("user_id", req.user.id).eq("course_id", course.id).single();
      course.is_wishlisted = !!wishlisted;
    }
  }

  res200(res, results, { query: q, total: results.length });
});

// ─── Wishlist handlers ────────────────────────────────────────────────────────

const wishlistHandlers = {

  // GET /api/user/wishlist
  list: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("wishlists")
      .select(`
        id, created_at,
        courses (
          id, title, slug, cover_image_url, course_type,
          price, discount_price, currency, is_free,
          total_students, rating,
          users!courses_instructor_id_fkey ( full_name, avatar_url )
        )
      `)
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),

  // POST /api/courses/:courseId/wishlist  — toggle
  toggle: asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    const userId       = req.user.id;

    const { data: existing } = await db
      .from("wishlists").select("id")
      .eq("user_id", userId).eq("course_id", courseId).single();

    if (existing) {
      await db.from("wishlists").delete().eq("id", existing.id);
      return res200(res, { wishlisted: false });
    }

    // Verify course exists
    const { data: course } = await db.from("courses").select("id").eq("id", courseId).single();
    if (!course) return res404(res, "Course not found");

    await db.from("wishlists").insert({ user_id: userId, course_id: courseId });
    res201(res, { wishlisted: true });
  }),
};

// ─── Bundle handlers ──────────────────────────────────────────────────────────

const bundleHandlers = {

  // GET /api/bundles
  list: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("course_bundles")
      .select(`
        id, title, description, cover_image_url, price, currency, is_active, created_at,
        users!course_bundles_instructor_id_fkey ( id, full_name, avatar_url ),
        bundle_courses (
          courses ( id, title, cover_image_url, course_type, total_students, rating )
        )
      `)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const enriched = (data ?? []).map((b) => ({
      ...b,
      course_count: b.bundle_courses?.length ?? 0,
      courses:      (b.bundle_courses ?? []).map((bc) => bc.courses),
      savings_ngn:  ((b.bundle_courses ?? []).reduce((s, bc) => s + (bc.courses?.price ?? 0), 0) - b.price) / 100,
    }));

    res200(res, enriched, { total: enriched.length });
  }),

  // GET /api/bundles/:bundleId
  get: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("course_bundles")
      .select(`
        id, title, description, cover_image_url, price, currency, is_active, created_at,
        users!course_bundles_instructor_id_fkey ( id, full_name, avatar_url ),
        bundle_courses (
          courses (
            id, title, description, cover_image_url, course_type,
            subject, level, total_students, rating, total_hours,
            price, currency
          )
        )
      `)
      .eq("id", req.params.bundleId)
      .single();

    if (error || !data) return res404(res, "Bundle not found");

    const courses     = (data.bundle_courses ?? []).map((bc) => bc.courses);
    const totalWorth  = courses.reduce((s, c) => s + (c?.price ?? 0), 0);

    res200(res, {
      ...data,
      courses,
      course_count: courses.length,
      total_worth_ngn: totalWorth / 100,
      bundle_price_ngn: data.price / 100,
      savings_ngn: (totalWorth - data.price) / 100,
    });
  }),

  // POST /api/bundles  — create (instructor)
  create: asyncHandler(async (req, res) => {
    const { title, description, cover_image_url, price, currency = "NGN", course_ids } = req.body;

    if (!course_ids?.length) return res400(res, "At least one course is required");

    // Verify instructor owns all courses
    const { data: courses } = await db
      .from("courses").select("id, instructor_id").in("id", course_ids);

    const notOwned = (courses ?? []).filter((c) => c.instructor_id !== req.user.id);
    if (notOwned.length && req.user.role !== "admin")
      return res403(res, "You can only bundle your own courses");

    const { data: bundle, error: bundleErr } = await db
      .from("course_bundles")
      .insert({ instructor_id: req.user.id, title, description: description ?? null, cover_image_url: cover_image_url ?? null, price, currency })
      .select().single();

    if (bundleErr) throw new Error(bundleErr.message);

    // Add courses to bundle
    await db.from("bundle_courses").insert(
      course_ids.map((cid) => ({ bundle_id: bundle.id, course_id: cid }))
    );

    res201(res, { ...bundle, course_count: course_ids.length });
  }),

  // PUT /api/bundles/:bundleId
  update: asyncHandler(async (req, res) => {
    const { data: bundle } = await db
      .from("course_bundles").select("instructor_id").eq("id", req.params.bundleId).single();

    if (!bundle) return res404(res, "Bundle not found");
    if (bundle.instructor_id !== req.user.id && req.user.role !== "admin")
      return res403(res, "Not authorised");

    const allowed = ["title", "description", "cover_image_url", "price", "is_active"];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    updates.updated_at = now();

    const { data, error } = await db
      .from("course_bundles").update(updates).eq("id", req.params.bundleId).select().single();

    if (error) throw new Error(error.message);
    res200(res, data);
  }),

  // DELETE /api/bundles/:bundleId
  delete: asyncHandler(async (req, res) => {
    const { data: bundle } = await db
      .from("course_bundles").select("instructor_id").eq("id", req.params.bundleId).single();

    if (!bundle) return res404(res, "Bundle not found");
    if (bundle.instructor_id !== req.user.id && req.user.role !== "admin")
      return res403(res, "Not authorised");

    await db.from("course_bundles").delete().eq("id", req.params.bundleId);
    res204(res);
  }),

  // POST /api/bundles/:bundleId/purchase
  // Initiates Paystack payment for the bundle.
  // On webhook success, enrolls student in ALL bundled courses.
  purchase: asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const { data: bundle } = await db
      .from("course_bundles")
      .select(`
        id, title, price, currency, is_active,
        bundle_courses ( course_id, courses ( id, title, instructor_id ) )
      `)
      .eq("id", req.params.bundleId).single();

    if (!bundle || !bundle.is_active) return res404(res, "Bundle not found");

    const courseIds = (bundle.bundle_courses ?? []).map((bc) => bc.course_id);

    // Check if already enrolled in ALL courses
    const { data: existingEnrollments } = await db
      .from("enrollments").select("course_id")
      .eq("user_id", userId).eq("status", "active").in("course_id", courseIds);

    const alreadyEnrolled = (existingEnrollments ?? []).map((e) => e.course_id);
    if (alreadyEnrolled.length === courseIds.length)
      return res400(res, "You are already enrolled in all courses in this bundle");

    const { data: user } = await db.from("users").select("email").eq("id", userId).single();
    const split = {
      commissionPercent: businessConfig.commissionPercent,
      commissionAmount:  Math.round(bundle.price * (businessConfig.commissionPercent / 100)),
      netAmount:         bundle.price - Math.round(bundle.price * (businessConfig.commissionPercent / 100)),
    };

    // Create a payment record for the bundle purchase
    const { data: payment } = await db.from("payments").insert({
      user_id:          userId,
      course_id:        courseIds[0],  // primary course for FK — bundle covers all
      amount_paid:      bundle.price,
      currency:         bundle.currency ?? "NGN",
      payment_provider: "paystack",
      status:           "pending",
      provider_response: {
        bundle_id:          bundle.id,
        bundle_title:       bundle.title,
        course_ids:         courseIds,
        commission_percent: split.commissionPercent,
      },
    }).select().single();

    const { data: psData } = await paystackPost(
      "https://api.paystack.co/transaction/initialize",
      {
        email:     user.email,
        amount:    bundle.price,
        currency:  bundle.currency ?? "NGN",
        reference: `akoro_bundle_${payment.id}_${Date.now()}`,
        metadata: {
          payment_id:  payment.id,
          course_id:   courseIds[0],
          user_id:     userId,
          is_bundle:   true,
          bundle_id:   bundle.id,
          bundle_title: bundle.title,
          course_ids:  courseIds,
        },
        callback_url: `${process.env.APP_URL}/api/payments/verify`,
      },
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    await db.from("payments").update({ provider_reference: psData.data.reference }).eq("id", payment.id);

    res201(res, {
      checkout_url:  psData.data.authorization_url,
      reference:     psData.data.reference,
      bundle_title:  bundle.title,
      price_ngn:     bundle.price / 100,
      courses_count: courseIds.length,
    });
  }),
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

// Search (optionally authenticated for enroll/wishlist status)
router.get("/courses/search",                         (req, res, next) => {
  // Attach the signed-in learner if there is one (for enrolled / wishlist flags) — never required.
  // The same check every login uses: signature, issuer, audience, and a session token only.
  const claims = peekAccessToken(req);
  req.user = claims ? { id: claims.sub, role: claims.role } : null;
  next();
}, searchHandler);

// Wishlist
router.get ("/user/wishlist",                         authenticateToken, wishlistHandlers.list);
router.post("/courses/:courseId/wishlist",            authenticateToken, wishlistHandlers.toggle);

// Bundles
router.get   ("/bundles",                             bundleHandlers.list);
router.get   ("/bundles/:bundleId",                   bundleHandlers.get);
router.post  ("/bundles",                             authenticateToken, requireRole(["instructor", "admin"]), [body("title").notEmpty(), body("price").isInt({ min: 0 }), body("course_ids").isArray({ min: 1 })], runValidation, bundleHandlers.create);
router.put   ("/bundles/:bundleId",                   authenticateToken, requireRole(["instructor", "admin"]), bundleHandlers.update);
router.delete("/bundles/:bundleId",                   authenticateToken, requireRole(["instructor", "admin"]), bundleHandlers.delete);
router.post  ("/bundles/:bundleId/purchase",          authenticateToken, bundleHandlers.purchase);

export default router;
