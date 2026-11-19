/**
 * modules/course-builder/routes.js — the Course Creator API (Akoro Instructor)
 *
 * Instructor-built marketplace courses behind the instructor app's
 * "Course Creator" section, ported 1:1 from
 * reference/Kpemu Course Builder.html: courses → sections → lessons, with
 * the exact operations the prototype exposes:
 *
 *   GET    /courses                      full tree (own courses; admin: all)
 *   POST   /courses                      create {title,sub,cat,level,lang,tags,type,platform}
 *   PATCH  /courses/:id                  details / pricing / cover / color fields
 *   DELETE /courses/:id                  remove a draft (owner or admin)
 *   POST   /courses/:id/status           {status, note?} — the review flow
 *   POST   /courses/:id/sections         add section {title}
 *   POST   /courses/:id/sections/reorder {order:[sectionId,…]}
 *   PATCH  /sections/:id                 rename {title}
 *   DELETE /sections/:id
 *   POST   /sections/:id/lessons         add lesson (any content type)
 *   POST   /sections/:id/lessons/reorder {order:[lessonId,…]}
 *   PATCH  /lessons/:id                  edit lesson (incl. the ex exception map)
 *   DELETE /lessons/:id
 *
 * The payload shape mirrors the prototype's state object verbatim —
 * {id,title,sub,cat,level,type,platform,lang,tags,status,price,pm,desc,
 *  learn,color,cover,note,sections:[{id,title,lessons:[{…,when,end,plat,
 *  rep,until,t2s,t2e,ex}]}]} — so the ported UI works on the same field
 * names as the reference HTML.
 *
 * Review flow (status): instructors move their own courses draft ⇄ review
 * and published → draft (unpublish); only admins set published, and only
 * admins attach a review note ("changes requested"). Mounted at
 * /api/course-builder (app.js) behind authenticateToken +
 * requireRole(['instructor','admin']); instructors only ever see and touch
 * rows where owner_id is their own user id, admins see every course (the
 * prototype's review queue).
 */
import { Router }            from "express";
import db                    from "../../db.js";
import { authenticateToken, requireRole } from "../auth/index.js";
import { adoptOldCourses, linkUnlinked, createLinkedCourse, publishLinkedCourse, removeLinkedCourse, syncLinkedCourse } from "./link.js";

const edu = () => db.schema("edu");
const router = Router();

router.use(authenticateToken, requireRole(["instructor", "admin"]));

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok      = (res, data) => res.json({ success: true, data });
const bad     = (res, m)    => res.status(400).json({ success: false, error: m });
const missing = (res, m)    => res.status(404).json({ success: false, error: m });
const denied  = (res, m)    => res.status(403).json({ success: false, error: m });

const COURSE_TYPES  = ["video", "live"];
const STATUSES      = ["draft", "review", "published"];
const LESSON_TYPES  = ["live", "video", "pdf", "audio", "article", "link", "slides"];
const REPEATS       = ["", "daily", "twice", "weekly", "biweekly", "monthly"];
const clean = (v) => (typeof v === "string" ? v.trim() : v ?? null);
const isAdmin = (req) => req.user?.role === "admin";

/* ── row ↔ prototype-shape mappers ───────────────────────────────────── */

const toLesson = (r) => ({
  id: r.id, title: r.title, type: r.type, meta: r.meta ?? "",
  src: r.src ?? "", desc: r.description ?? "", free: !!r.free,
  img: r.img_url ?? "", when: r.when_at ?? "", end: r.end_time ?? "",
  plat: r.platform ?? "", rep: r.rep ?? "", until: r.rep_until ?? "",
  t2s: r.t2s ?? "", t2e: r.t2e ?? "", ex: r.ex ?? {},
});

const toCourse = (r, sections, ownerName) => ({
  id: r.id, title: r.title, sub: r.subtitle ?? "", cat: r.category ?? "Other",
  level: r.level ?? "Beginner", type: r.type, platform: r.platform ?? "",
  lang: r.language ?? "English", tags: r.tags ?? "", status: r.status,
  price: r.price ?? "", pm: !!r.preview_mode, desc: r.description ?? "",
  learn: r.learn ?? "", color: r.color ?? 0, cover: r.cover_url ?? "",
  note: r.review_note ?? "", ownerId: r.owner_id, owner: ownerName ?? "",
  // The platform course row this edits (live sessions, enrolments, payments use it).
  courseId: r.course_id ?? null,
  createdAt: r.created_at, sections,
});

/* Loads a course row the caller may touch, or answers for us. */
async function guardCourse(req, res, id) {
  const { data: c } = await edu().from("builder_courses").select("*").eq("id", id).maybeSingle();
  if (!c) { missing(res, "Course not found"); return null; }
  if (!isAdmin(req) && c.owner_id !== req.user.id) { denied(res, "Not your course"); return null; }
  return c;
}

/* Walks lesson → section → course to apply the same ownership guard. */
async function guardSection(req, res, id) {
  const { data: s } = await edu().from("builder_sections").select("*").eq("id", id).maybeSingle();
  if (!s) { missing(res, "Section not found"); return null; }
  const c = await guardCourse(req, res, s.course_id);
  return c ? s : null;
}

async function guardLesson(req, res, id) {
  const { data: l } = await edu().from("builder_lessons").select("*").eq("id", id).maybeSingle();
  if (!l) { missing(res, "Lesson not found"); return null; }
  const s = await guardSection(req, res, l.section_id);
  return s ? l : null;
}

/* ── the tree ────────────────────────────────────────────────────────── */

router.get("/courses", asyncHandler(async (req, res) => {
  // Courses made on the old Courses page join My Courses (once; see link.js).
  if (req.user.role === "instructor") {
    await adoptOldCourses(req.user.id).catch((e) => console.warn("[course-builder] adopt failed:", e.message));
    await linkUnlinked(req.user.id).catch((e) => console.warn("[course-builder] backfill failed:", e.message));
  }
  let q = edu().from("builder_courses").select("*").order("created_at", { ascending: true });
  if (!isAdmin(req)) q = q.eq("owner_id", req.user.id);
  const { data: courses } = await q;
  const rows = courses ?? [];
  if (!rows.length) return ok(res, []);

  const ids = rows.map((c) => c.id);
  const { data: sections } = await edu().from("builder_sections")
    .select("*").in("course_id", ids).order("position").order("created_at");
  const sectionRows = sections ?? [];
  const sectionIds = sectionRows.map((s) => s.id);
  const { data: lessons } = sectionIds.length
    ? await edu().from("builder_lessons")
        .select("*").in("section_id", sectionIds).order("position").order("created_at")
    : { data: [] };
  const lessonRows = lessons ?? [];

  // Owner names for the admin review queue ("by Dr. Amina Yusuf").
  const ownerIds = [...new Set(rows.map((c) => c.owner_id))];
  const { data: owners } = await db.from("users").select("id, full_name").in("id", ownerIds);
  const nameOf = new Map((owners ?? []).map((u) => [u.id, u.full_name]));

  ok(res, rows.map((c) => toCourse(
    c,
    sectionRows.filter((s) => s.course_id === c.id).map((s) => ({
      id: s.id, title: s.title,
      lessons: lessonRows.filter((l) => l.section_id === s.id).map(toLesson),
    })),
    nameOf.get(c.owner_id),
  )));
}));

/* ── courses ─────────────────────────────────────────────────────────── */

router.post("/courses", asyncHandler(async (req, res) => {
  const title = clean(req.body?.title);
  if (!title) return bad(res, "title is required");
  const type = COURSE_TYPES.includes(req.body?.type) ? req.body.type : "video";
  const { data: c, error } = await edu().from("builder_courses").insert({
    owner_id: req.user.id,
    title,
    subtitle: clean(req.body?.sub) ?? "",
    category: clean(req.body?.cat) ?? "Other",
    level:    clean(req.body?.level) ?? "Beginner",
    language: clean(req.body?.lang) ?? "English",
    tags:     clean(req.body?.tags) ?? "",
    type,
    platform: type === "live" ? clean(req.body?.platform) : null,
    color: Number.isInteger(req.body?.color) ? req.body.color : Math.floor(Math.random() * 6),
  }).select("*").single();
  if (error) throw error;
  // Its platform course row, unpublished, so it can be scheduled at once.
  const linked = await createLinkedCourse(c).catch((e) => { console.warn("[course-builder] link failed:", e.message); return c; });
  ok(res, toCourse(linked, [], null));
}));

router.patch("/courses/:id", asyncHandler(async (req, res) => {
  const c = await guardCourse(req, res, req.params.id);
  if (!c) return;
  const b = req.body ?? {};
  const patch = {};
  if (b.title !== undefined)    patch.title       = clean(b.title) || c.title;
  if (b.sub !== undefined)      patch.subtitle    = clean(b.sub) ?? "";
  if (b.cat !== undefined)      patch.category    = clean(b.cat) ?? "Other";
  if (b.level !== undefined)    patch.level       = clean(b.level) ?? "Beginner";
  if (b.lang !== undefined)     patch.language    = clean(b.lang) ?? "English";
  if (b.tags !== undefined)     patch.tags        = clean(b.tags) ?? "";
  if (b.platform !== undefined) patch.platform    = clean(b.platform);
  if (b.desc !== undefined)     patch.description = clean(b.desc) ?? "";
  if (b.learn !== undefined)    patch.learn       = typeof b.learn === "string" ? b.learn : "";
  if (b.cover !== undefined)    patch.cover_url   = b.cover || null;
  if (b.price !== undefined)    patch.price       = String(b.price ?? "");
  if (b.pm !== undefined)       patch.preview_mode = !!b.pm;
  if (b.color !== undefined) {
    if (!Number.isInteger(b.color) || b.color < 0 || b.color > 5) return bad(res, "color must be 0-5");
    patch.color = b.color;
  }
  if (b.type !== undefined) {
    if (!COURSE_TYPES.includes(b.type)) return bad(res, "bad course type");
    patch.type = b.type;
  }
  if (!Object.keys(patch).length) return ok(res, toCourse(c, [], null));
  patch.updated_at = new Date().toISOString();
  const { data: next, error } = await edu().from("builder_courses")
    .update(patch).eq("id", c.id).select("*").single();
  if (error) throw error;
  await syncLinkedCourse(next);
  ok(res, toCourse(next, [], null));
}));

router.delete("/courses/:id", asyncHandler(async (req, res) => {
  const c = await guardCourse(req, res, req.params.id);
  if (!c) return;
  await edu().from("builder_courses").delete().eq("id", c.id);
  await removeLinkedCourse(c).catch((e) => console.warn("[course-builder] unlink failed:", e.message));
  ok(res, { deleted: true });
}));

/* The review flow. Who may set what:
   - review:    the owner submits a draft (admins may too).
   - draft:     the owner withdraws/unpublishes; an admin requests changes
                (that's when the note lands on the course).
   - published: admins only — the prototype's "Approve & publish".       */
router.post("/courses/:id/status", asyncHandler(async (req, res) => {
  const c = await guardCourse(req, res, req.params.id);
  if (!c) return;
  const status = req.body?.status;
  if (!STATUSES.includes(status)) return bad(res, "bad status");
  if (status === "published" && !isAdmin(req)) return denied(res, "Only an admin can publish");
  const patch = { status, updated_at: new Date().toISOString() };
  if (isAdmin(req) && typeof req.body?.note === "string") patch.review_note = req.body.note.trim();
  if (status === "published") patch.review_note = "";
  const { data: next, error } = await edu().from("builder_courses")
    .update(patch).eq("id", c.id).select("*").single();
  if (error) throw error;
  // Published in Course Creator is what learners see.
  await publishLinkedCourse(next, status === "published");
  ok(res, toCourse(next, [], null));
}));

/* ── sections ────────────────────────────────────────────────────────── */

router.post("/courses/:id/sections", asyncHandler(async (req, res) => {
  const c = await guardCourse(req, res, req.params.id);
  if (!c) return;
  const title = clean(req.body?.title);
  if (!title) return bad(res, "title is required");
  const { count } = await edu().from("builder_sections")
    .select("id", { count: "exact", head: true }).eq("course_id", c.id);
  const { data: s, error } = await edu().from("builder_sections")
    .insert({ course_id: c.id, title, position: count ?? 0 }).select("*").single();
  if (error) throw error;
  ok(res, { id: s.id, title: s.title, lessons: [] });
}));

router.post("/courses/:id/sections/reorder", asyncHandler(async (req, res) => {
  const c = await guardCourse(req, res, req.params.id);
  if (!c) return;
  const order = req.body?.order;
  if (!Array.isArray(order) || !order.length) return bad(res, "order must be a non-empty array");
  await Promise.all(order.map((sid, i) =>
    edu().from("builder_sections").update({ position: i }).eq("id", sid).eq("course_id", c.id)));
  ok(res, { reordered: true });
}));

router.patch("/sections/:id", asyncHandler(async (req, res) => {
  const s = await guardSection(req, res, req.params.id);
  if (!s) return;
  const title = clean(req.body?.title);
  if (!title) return bad(res, "title is required");
  await edu().from("builder_sections").update({ title }).eq("id", s.id);
  ok(res, { id: s.id, title });
}));

router.delete("/sections/:id", asyncHandler(async (req, res) => {
  const s = await guardSection(req, res, req.params.id);
  if (!s) return;
  await edu().from("builder_sections").delete().eq("id", s.id);
  ok(res, { deleted: true });
}));

/* ── lessons ─────────────────────────────────────────────────────────── */

function lessonPatch(b, existing = {}) {
  const p = {};
  if (b.title !== undefined) p.title       = clean(b.title) || existing.title;
  if (b.type !== undefined)  p.type        = LESSON_TYPES.includes(b.type) ? b.type : (existing.type ?? "video");
  if (b.meta !== undefined)  p.meta        = clean(b.meta) ?? "";
  if (b.src !== undefined)   p.src         = clean(b.src) ?? "";
  if (b.desc !== undefined)  p.description = clean(b.desc) ?? "";
  if (b.free !== undefined)  p.free        = !!b.free;
  if (b.img !== undefined)   p.img_url     = b.img || null;
  if (b.when !== undefined)  p.when_at     = clean(b.when) ?? "";
  if (b.end !== undefined)   p.end_time    = clean(b.end) ?? "";
  if (b.plat !== undefined)  p.platform    = clean(b.plat);
  if (b.rep !== undefined)   p.rep         = REPEATS.includes(b.rep) ? b.rep : "";
  if (b.until !== undefined) p.rep_until   = clean(b.until) ?? "";
  if (b.t2s !== undefined)   p.t2s         = clean(b.t2s) ?? "";
  if (b.t2e !== undefined)   p.t2e         = clean(b.t2e) ?? "";
  if (b.ex !== undefined)    p.ex          = (b.ex && typeof b.ex === "object" && !Array.isArray(b.ex)) ? b.ex : {};
  return p;
}

router.post("/sections/:id/lessons", asyncHandler(async (req, res) => {
  const s = await guardSection(req, res, req.params.id);
  if (!s) return;
  const b = req.body ?? {};
  const title = clean(b.title);
  if (!title) return bad(res, "title is required");
  const { count } = await edu().from("builder_lessons")
    .select("id", { count: "exact", head: true }).eq("section_id", s.id);
  const { data: l, error } = await edu().from("builder_lessons").insert({
    section_id: s.id, position: count ?? 0, ...lessonPatch(b), title,
  }).select("*").single();
  if (error) throw error;
  ok(res, toLesson(l));
}));

router.post("/sections/:id/lessons/reorder", asyncHandler(async (req, res) => {
  const s = await guardSection(req, res, req.params.id);
  if (!s) return;
  const order = req.body?.order;
  if (!Array.isArray(order) || !order.length) return bad(res, "order must be a non-empty array");
  await Promise.all(order.map((lid, i) =>
    edu().from("builder_lessons").update({ position: i }).eq("id", lid).eq("section_id", s.id)));
  ok(res, { reordered: true });
}));

router.patch("/lessons/:id", asyncHandler(async (req, res) => {
  const l = await guardLesson(req, res, req.params.id);
  if (!l) return;
  const patch = lessonPatch(req.body ?? {}, l);
  if (!Object.keys(patch).length) return ok(res, toLesson(l));
  const { data: next, error } = await edu().from("builder_lessons")
    .update(patch).eq("id", l.id).select("*").single();
  if (error) throw error;
  ok(res, toLesson(next));
}));

router.delete("/lessons/:id", asyncHandler(async (req, res) => {
  const l = await guardLesson(req, res, req.params.id);
  if (!l) return;
  await edu().from("builder_lessons").delete().eq("id", l.id);
  ok(res, { deleted: true });
}));

export default router;
