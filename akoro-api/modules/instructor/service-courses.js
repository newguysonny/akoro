/**
 * instructor/service-courses.js — course list/create/update/delete and the
 * cover-image upload.
 */
import { linkUnlinked } from "../course-builder/index.js";
import { ensureBucket, uploadPublicFile } from "../school/index.js";
import {
  slugify, typeToDb, typeToApi, mapCourse, VALID_LEVELS,
} from "./rules.js";
import { asyncHandler, created, ok, err400, err403, err404, err500, now, notify } from "./service-core.js";
import {
  coursesByInstructor, activeEnrollmentCountForCourse,
  insertCourse, courseForOwnership, updateCourse as updateCourseRow,
  courseForDelete, deleteCourse as deleteCourseRow,
} from "./store-courses.js";

// ─── § COURSES ────────────────────────────────────────────────────────────────

export const listCourses = asyncHandler(async (req, res) => {
  try {
    // Course Creator courses made before the link get their courses row, so Schedule sessions lists them.
    await linkUnlinked(req.user.id).catch((e) => console.warn("[instructor] course link failed:", e.message));
    const { data: courses, error } = await coursesByInstructor(req.user.id);

    if (error) throw new Error(error.message);

    // Enrich each course with enrolled student count
    const enriched = await Promise.all((courses ?? []).map(async (course) => {
      const { count } = await activeEnrollmentCountForCourse(course.id);
      return mapCourse(course, count ?? 0);
    }));

    ok(res, enriched);
  } catch (e) {
    err500(res, e);
  }
});

export const createCourse = asyncHandler(async (req, res) => {
  try {
    const {
      title, description, subject = null, category = null,
      level, type, course_type, status,
      language      = "English",
      price         = 0,
      discountPrice, discount_price,
      isFree, is_free,
      thumbnail, thumbnail_url,
      maxStudents,  // not a courses column — ignored
    } = req.body;

    if (!title) return err400(res, "title is required");

    const lvl       = VALID_LEVELS.includes(level) ? level : "all";
    const dbType    = typeToDb(type ?? course_type);
    const published = status === "active" || status === "live" || status === "published";
    const priceVal  = Math.round(Number(price) || 0);
    const discount  = discountPrice ?? discount_price;
    const free      = isFree ?? is_free ?? (priceVal === 0);

    const { data, error } = await insertCourse({
      instructor_id:   req.user.id,
      title,
      slug:            slugify(title),
      description:     description ?? null,
      subject:         subject ?? category,
      level:           lvl,
      language,
      price:           priceVal,
      discount_price:  discount != null && discount !== "" ? Math.round(Number(discount)) : null,
      is_free:         !!free,
      course_type:     dbType,
      cover_image_url: thumbnail ?? thumbnail_url ?? null,
      is_published:    published,
      published_at:    published ? now() : null,
      created_at:      now(),
      updated_at:      now(),
    });

    if (error) throw new Error(error.message);
    notify(req.user.id, {
      type:      "course_created",
      title:     `Course "${title}" created`,
      content:   `${typeToApi(dbType)} · ${lvl}`,
      relatedId: data.id,
    });
    created(res, mapCourse(data, 0));
  } catch (e) {
    err500(res, e);
  }
});

export const updateCourse = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const { data: existing } = await courseForOwnership(id);

    if (!existing)                        return err404(res, "Course not found");
    if (existing.instructor_id !== req.user.id) return err403(res, "You do not own this course");

    // Map frontend vocabulary → real columns, whitelisted.
    const b = req.body;
    const updates = {};
    if (b.title       !== undefined) updates.title           = b.title;
    if (b.description !== undefined) updates.description     = b.description;
    if (b.subject     !== undefined) updates.subject         = b.subject;
    if (b.language    !== undefined) updates.language        = b.language;
    if (b.price       !== undefined) updates.price           = Math.round(Number(b.price) || 0);
    if (b.level       !== undefined) updates.level           = VALID_LEVELS.includes(b.level) ? b.level : "all";
    if (b.type !== undefined || b.course_type !== undefined) updates.course_type = typeToDb(b.type ?? b.course_type);
    if (b.thumbnail !== undefined || b.thumbnail_url !== undefined) updates.cover_image_url = b.thumbnail ?? b.thumbnail_url;
    if (b.status !== undefined) {
      const pub = b.status === "active" || b.status === "live" || b.status === "published";
      updates.is_published = pub;
      updates.published_at = pub ? now() : null;
    }
    if (Object.keys(updates).length === 0) return err400(res, "No updatable fields provided");
    updates.updated_at = now();

    const { data, error } = await updateCourseRow(id, updates);

    if (error) throw new Error(error.message);
    notify(req.user.id, {
      type:      "course_updated",
      title:     `Course "${data.title}" updated`,
      content:   `Changes saved`,
      relatedId: data.id,
    });
    ok(res, mapCourse(data, 0));
  } catch (e) {
    err500(res, e);
  }
});

export const deleteCourse = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing } = await courseForDelete(id);

    if (!existing)                        return err404(res, "Course not found");
    if (existing.instructor_id !== req.user.id) return err403(res, "You do not own this course");

    // No 'archived' state in schema — hard delete (cascades sessions/enrollments).
    const { error } = await deleteCourseRow(id);
    if (error) throw new Error(error.message);
    notify(req.user.id, {
      type:    "course_deleted",
      title:   `Course "${existing.title}" deleted`,
      content: `The course and its sessions were removed`,
    });
    ok(res, { message: "Course deleted" });
  } catch (e) {
    err500(res, e);
  }
});

// POST /api/instructor/courses/upload — upload a course cover, returns { url }.
export const uploadCourseCover = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file provided" });
  if (!/^image\//.test(req.file.mimetype || "")) return res.status(400).json({ success: false, message: "Only image files are allowed" });
  await ensureBucket().catch(() => {});
  const ext  = (req.file.originalname?.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `course-covers/${req.user.id}/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
  const url  = await uploadPublicFile(path, req.file.buffer, req.file.mimetype);
  res.status(201).json({ success: true, url });
});
