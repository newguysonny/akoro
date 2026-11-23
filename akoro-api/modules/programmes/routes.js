/**
 * modules/programmes/routes.js — the Program Courses API (Akoro Admin)
 *
 * Generic academic programmes behind the admin section of the same name:
 * programmes → sections → courses → learning materials, with the exact
 * operations the prototype (reference/Kpemu Admin (1).html) exposes:
 *
 *   GET    /overview                        home-page counts + latest log
 *   GET    /programs?q=                     programme list + course counts
 *   POST   /programs                        create {name,code,description,duration_label,years[],status,cover_url}
 *   GET    /programs/:id                    programme + sections (+course counts)
 *   PATCH  /programs/:id                    edit fields {…, years} — years replaces section names/positions
 *   POST   /programs/:id/publish            status → published
 *   POST   /programs/:id/unpublish          status → draft
 *   DELETE /programs/:id
 *   POST   /programs/:id/sections           add section {name}
 *   POST   /programs/:id/sections/reorder   {order:[sectionId,…]}
 *   POST   /programs/reorder                {order:[programId,…]}
 *   PATCH  /sections/:id                    rename {name}
 *   DELETE /sections/:id
 *   GET    /courses?programme=&q=           all courses (+programme/section/material counts)
 *   POST   /courses                         create {programme_id,section_id,code,title,instructor,color,status,cover_url}
 *   GET    /courses/:id                     course + programme + section + materials
 *   PATCH  /courses/:id
 *   POST   /courses/:id/move                {dir:'up'|'down'} — swap within its section
 *   DELETE /courses/:id
 *   GET    /materials?course=&type=&status=&q=
 *   POST   /materials                       {course_id,title,type,meta,url,thumb_url,status}
 *   PATCH  /materials/:id
 *   POST   /materials/:id/move              {dir:'up'|'down'}
 *   DELETE /materials/:id
 *   GET    /log                             latest activity (home Updates)
 *
 * Every write appends a line to edu.programme_log, which the home page
 * renders as its Updates list. Mounted at /api/programmes (app.js), admin
 * only — the same authenticateToken + requireRole(['admin']) guard as the
 * rest of the admin API — EXCEPT the /catalogue routes below, which are
 * the learner app's published view (public, like /api/pharmd/programme):
 *
 *   GET /catalogue              published programmes (+published course counts)
 *   GET /catalogue/:id          one published programme → sections → published courses
 *   GET /catalogue/courses/:id  one published course → its published materials
 *
 * The catalogue filters by status at EVERY level: draft programmes,
 * draft courses and draft materials never leave the API.
 */
import { Router }            from "express";
import db                    from "../../db.js";
import { authenticateToken, requireRole } from "../auth/index.js";
import { pharmdContentKey } from "../../lib/contentKey.js";

const edu = () => db.schema("edu");
const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok      = (res, data) => res.json({ success: true, data });
const bad     = (res, m)    => res.status(400).json({ success: false, error: m });
const missing = (res, m)    => res.status(404).json({ success: false, error: m });

const MATERIAL_TYPES = ["pdf", "video", "audio", "note", "link", "slides"];
const clean = (v) => (typeof v === "string" ? v.trim() : v ?? null);

async function logLine(headline, detail) {
  await edu().from("programme_log").insert({ headline, detail });
}

/* ── Published catalogue — the learner app's view (public) ─────────────────
   Registered BEFORE the admin guard: a published course catalogue is
   browseable, like /api/pharmd/programme. Only published rows ever leave. */

router.get("/catalogue", asyncHandler(async (_req, res) => {
  const { data: rows } = await edu().from("programmes")
    .select("id, name, code, description, duration_label, cover_url, source, programme_courses(id, status)")
    .eq("status", "published")
    .order("created_at", { ascending: true });
  ok(res, (rows ?? []).map((p) => ({
    id: p.id, name: p.name, code: p.code, description: p.description,
    duration_label: p.duration_label, cover_url: p.cover_url, source: p.source,
    course_count: (p.programme_courses ?? []).filter((c) => c.status === "published").length,
  })));
}));

router.get("/catalogue/:id", asyncHandler(async (req, res) => {
  const { data: p } = await edu().from("programmes")
    .select("id, name, code, description, duration_label, cover_url, source")
    .eq("id", req.params.id).eq("status", "published").maybeSingle();
  if (!p) return missing(res, "That programme is not published");
  const [{ data: sections }, { data: courses }] = await Promise.all([
    edu().from("programme_sections").select("id, name, position")
      .eq("programme_id", p.id).order("position"),
    edu().from("programme_courses")
      .select("id, section_id, code, title, instructor, color, cover_url, position, programme_materials(id, status)")
      .eq("programme_id", p.id).eq("status", "published")
      .order("position").order("created_at"),
  ]);
  const pub = (courses ?? []).map((c) => ({
    id: c.id, section_id: c.section_id, code: c.code, title: c.title,
    instructor: c.instructor, color: c.color, cover_url: c.cover_url,
    materials_count: (c.programme_materials ?? []).filter((m) => m.status === "published").length,
  }));
  ok(res, {
    ...p,
    published_courses: pub.length,
    sections: (sections ?? []).map((s) => ({
      id: s.id, name: s.name, position: s.position,
      courses: pub.filter((c) => c.section_id === s.id),
    })),
  });
}));

router.get("/catalogue/courses/:id", asyncHandler(async (req, res) => {
  const { data: c } = await edu().from("programme_courses")
    .select("id, programme_id, section_id, code, title, instructor, color, cover_url")
    .eq("id", req.params.id).eq("status", "published").maybeSingle();
  if (!c) return missing(res, "That course is not published");
  const [{ data: p }, { data: s }, { data: materials }] = await Promise.all([
    edu().from("programmes").select("id, name, status").eq("id", c.programme_id).maybeSingle(),
    edu().from("programme_sections").select("id, name").eq("id", c.section_id).maybeSingle(),
    edu().from("programme_materials")
      .select("id, title, type, meta, url, thumb_url, position, file_path, file_hash")
      .eq("course_id", c.id).eq("status", "published")
      .order("position").order("created_at"),
  ]);
  if (!p || p.status !== "published") return missing(res, "That course is not published");
  ok(res, {
    ...c,
    programme: { id: p.id, name: p.name },
    section: s ? { id: s.id, name: s.name } : null,
    materials: (materials ?? []).map((m) => ({
      ...m,
      mime: m.type === "video" ? "video/mp4" : m.type === "audio" ? "audio/mpeg"
        : m.type === "note" ? "text/plain" : "application/pdf",
      // Files uploaded to the catalogue play/read in the app's own reader;
      // external links keep m.url (opened in a new tab by the client).
      file_url: m.file_path ? `${req.protocol}://${req.get("host")}/api/pharmd/topics/${m.id}/file` : null,
      contentKey: m.file_path ? pharmdContentKey({ file_path: m.file_path, file_hash: m.file_hash }) : null,
    })),
  });
}));

/* Everything below is the admin console. */
router.use(adminOnly);

/* ── Overview — the home page's stats grid + updates ──────────────────── */
router.get("/overview", asyncHandler(async (_req, res) => {
  const [programs, courses, materials, publishedMaterials, publishedCourses, drafts, logResult] = await Promise.all([
    edu().from("programmes").select("id", { count: "exact", head: true }),
    edu().from("programme_courses").select("id", { count: "exact", head: true }),
    edu().from("programme_materials").select("id", { count: "exact", head: true }),
    edu().from("programme_materials").select("id", { count: "exact", head: true }).eq("status", "published"),
    edu().from("programme_courses").select("id", { count: "exact", head: true }).eq("status", "published"),
    edu().from("programme_materials").select("id", { count: "exact", head: true }).neq("status", "published"),
    edu().from("programme_log").select("*").order("created_at", { ascending: false }).limit(6),
  ]);
  const { data: inst } = await edu().from("programme_courses").select("instructor").not("instructor", "is", null);
  ok(res, {
    programs: programs?.count ?? 0,
    courses: courses?.count ?? 0,
    materials: materials?.count ?? 0,
    publishedMaterials: publishedMaterials?.count ?? 0,
    publishedCourses: publishedCourses?.count ?? 0,
    drafts: drafts?.count ?? 0,
    instructors: new Set((inst ?? []).map((r) => r.instructor)).size,
    // Supabase returns a query-result object; expose only its rows so the
    // frontend contract is always an array (never { data, error, ... }).
    log: Array.isArray(logResult?.data) ? logResult.data : [],
  });
}));

/* ── Programmes ────────────────────────────────────────────────────────── */
router.get("/programs", asyncHandler(async (req, res) => {
  const q = clean(req.query.q)?.toLowerCase();
  let query = edu().from("programmes").select(`
    *, programme_sections(id, name, position),
    programme_courses(id)`);
  // Order by position once the migration has run; fall back to created_at if the column is missing.
  let rows;
  try {
    const { data, error } = await query.order("position", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true });
    if (error) throw error;
    rows = data;
  } catch {
    const { data } = await edu().from("programmes").select(`
      *, programme_sections(id, name, position),
      programme_courses(id)`).order("created_at", { ascending: true });
    rows = data;
  }
  const programs = (rows ?? [])
    .filter((p) => !q || `${p.name}${p.code || ""}`.toLowerCase().includes(q))
    .map((p) => ({ ...p, course_count: (p.programme_courses ?? []).length, programme_courses: undefined }));
  ok(res, programs);
}));

router.post("/programs", asyncHandler(async (req, res) => {
  const { name, code, description, duration_label, years, status, cover_url } = req.body ?? {};
  if (!clean(name)) return bad(res, "Programme name is required");
  const { data: programme, error } = await edu().from("programmes").insert({
    name: clean(name), code: clean(code), description: clean(description),
    duration_label: clean(duration_label), cover_url: clean(cover_url) || null,
    status: status === "published" ? "published" : "draft",
  }).select().single();
  if (error) return bad(res, error.message);
  const names = Array.isArray(years) ? years.map(clean).filter(Boolean)
    : (typeof years === "string" ? years.split(",").map((s) => s.trim()).filter(Boolean) : []);
  if (names.length) {
    await edu().from("programme_sections")
      .insert(names.map((n, i) => ({ programme_id: programme.id, name: n, position: i })));
  }
  await logLine("Programme created", `${programme.name}${programme.code ? ` (${programme.code})` : ""} was created.`);
  ok(res, programme);
}));

async function getProgramme(id) {
  const { data: p } = await edu().from("programmes").select("*").eq("id", id).maybeSingle();
  return p;
}

router.get("/programs/:id", asyncHandler(async (req, res) => {
  const p = await getProgramme(req.params.id);
  if (!p) return missing(res, "That programme no longer exists");
  const { data: sections } = await edu().from("programme_sections")
    .select("*, programme_courses(id)").eq("programme_id", p.id).order("position");
  ok(res, { ...p, sections: (sections ?? []).map((s) => ({ ...s, course_count: (s.programme_courses ?? []).length, programme_courses: undefined })) });
}));

router.patch("/programs/:id", asyncHandler(async (req, res) => {
  const p = await getProgramme(req.params.id);
  if (!p) return missing(res, "That programme no longer exists");
  const { name, code, description, duration_label, status, cover_url, years } = req.body ?? {};
  const patch = {};
  if (name !== undefined) patch.name = clean(name);
  if (code !== undefined) patch.code = clean(code);
  if (description !== undefined) patch.description = clean(description);
  if (duration_label !== undefined) patch.duration_label = clean(duration_label);
  if (status !== undefined) patch.status = status === "published" ? "published" : "draft";
  if (cover_url !== undefined) patch.cover_url = clean(cover_url) || null;
  if (Object.keys(patch).length) {
    const { error } = await edu().from("programmes").update(patch).eq("id", p.id);
    if (error) return bad(res, error.message);
  }
  // years replaces the section list (the edit form's comma-separated field).
  if (Array.isArray(years) || typeof years === "string") {
    const names = (Array.isArray(years) ? years : String(years).split(",")).map(clean).filter(Boolean);
    const { data: existing } = await edu().from("programme_sections").select("id, name").eq("programme_id", p.id);
    const keep = new Set(names);
    for (const s of existing ?? []) if (!keep.has(s.name)) await edu().from("programme_sections").delete().eq("id", s.id);
    for (let i = 0; i < names.length; i += 1) {
      const hit = (existing ?? []).find((s) => s.name === names[i]);
      if (hit) await edu().from("programme_sections").update({ position: i }).eq("id", hit.id);
      else await edu().from("programme_sections").insert({ programme_id: p.id, name: names[i], position: i });
    }
  }
  await logLine("Programme updated", `${patch.name ?? p.name} was updated.`);
  ok(res, await getProgramme(p.id));
}));

for (const status of ["publish", "unpublish"]) {
  router.post(`/programs/:id/${status}`, asyncHandler(async (req, res) => {
    const p = await getProgramme(req.params.id);
    if (!p) return missing(res, "That programme no longer exists");
    const next = status === "publish" ? "published" : "draft";
    await edu().from("programmes").update({ status: next }).eq("id", p.id);
    await logLine(next === "published" ? "Program published" : "Program unpublished",
      `${p.name} is ${next === "published" ? "live in the student app" : "hidden from students"}.`);
    ok(res, { status: next });
  }));
}

router.delete("/programs/:id", asyncHandler(async (req, res) => {
  const p = await getProgramme(req.params.id);
  if (!p) return missing(res, "That programme no longer exists");
  await edu().from("programmes").delete().eq("id", p.id);
  await logLine("Program deleted", `${p.name} and everything in it was removed.`);
  ok(res, { deleted: true });
}));

/* ── Sections ──────────────────────────────────────────────────────────── */
router.post("/programs/:id/sections", asyncHandler(async (req, res) => {
  const p = await getProgramme(req.params.id);
  if (!p) return missing(res, "That programme no longer exists");
  const name = clean(req.body?.name);
  if (!name) return bad(res, "Section name is required");
  const { data: existing } = await edu().from("programme_sections").select("id").eq("programme_id", p.id);
  const { data: section, error } = await edu().from("programme_sections")
    .insert({ programme_id: p.id, name, position: (existing ?? []).length })
    .select().single();
  if (error) return bad(res, error.message);
  await logLine("Section added", `${name} was added to ${p.name}.`);
  ok(res, section);
}));

router.post("/programs/:id/sections/reorder", asyncHandler(async (req, res) => {
  const order = req.body?.order;
  if (!Array.isArray(order) || !order.length) return bad(res, "order must be a list of section ids");
  for (let i = 0; i < order.length; i += 1) {
    await edu().from("programme_sections").update({ position: i }).eq("id", order[i]);
  }
  ok(res, { reordered: order.length });
}));

router.post("/programs/reorder", asyncHandler(async (req, res) => {
  const order = req.body?.order;
  if (!Array.isArray(order) || !order.length) return bad(res, "order must be a list of program ids");
  for (let i = 0; i < order.length; i += 1) {
    await edu().from("programmes").update({ position: i }).eq("id", order[i]);
  }
  await logLine("Programs reordered", `${order.length} programs reordered.`);
  ok(res, { reordered: order.length });
}));

router.patch("/sections/:id", asyncHandler(async (req, res) => {
  const name = clean(req.body?.name);
  if (!name) return bad(res, "Section name is required");
  const { data: section } = await edu().from("programme_sections").select("*, programmes(name)").eq("id", req.params.id).maybeSingle();
  if (!section) return missing(res, "That section no longer exists");
  const { error } = await edu().from("programme_sections").update({ name }).eq("id", section.id);
  if (error) return bad(res, error.message);
  await logLine("Section renamed", `A section of ${section.programmes?.name ?? "a programme"} is now called ${name}.`);
  ok(res, { id: section.id, name });
}));

router.delete("/sections/:id", asyncHandler(async (req, res) => {
  const { data: section } = await edu().from("programme_sections").select("*, programmes(name)").eq("id", req.params.id).maybeSingle();
  if (!section) return missing(res, "That section no longer exists");
  await edu().from("programme_sections").delete().eq("id", section.id);
  await logLine("Section deleted", `${section.name} was removed from ${section.programmes?.name ?? "a programme"}.`);
  ok(res, { deleted: true });
}));

/* ── Courses ───────────────────────────────────────────────────────────── */
router.get("/courses", asyncHandler(async (req, res) => {
  const q = clean(req.query.q)?.toLowerCase();
  let query = edu().from("programme_courses")
    .select("*, programmes(id, name), programme_sections(id, name), programme_materials(id)")
    .order("position").order("created_at");
  if (clean(req.query.programme)) query = query.eq("programme_id", req.query.programme);
  const { data: rows } = await query;
  const courses = (rows ?? [])
    .filter((c) => !q || `${c.code}${c.title ?? ""}`.toLowerCase().includes(q))
    .map((c) => ({
      ...c,
      programme_name: c.programmes?.name ?? null,
      section_name: c.programme_sections?.name ?? null,
      materials_count: (c.programme_materials ?? []).length,
      programmes: undefined, programme_sections: undefined, programme_materials: undefined,
    }));
  ok(res, courses);
}));

router.post("/courses", asyncHandler(async (req, res) => {
  const { programme_id, section_id, code, title, instructor, color, status, cover_url } = req.body ?? {};
  if (!programme_id || !section_id) return bad(res, "Programme and section are required");
  if (!clean(code)) return bad(res, "Course code is required");
  const { data: last } = await edu().from("programme_courses").select("position").eq("section_id", section_id).order("position", { ascending: false }).limit(1);
  const { data: course, error } = await edu().from("programme_courses").insert({
    programme_id, section_id,
    code: clean(code), title: clean(title), instructor: clean(instructor),
    color: Number.isInteger(color) ? Math.max(0, Math.min(5, color)) : 0,
    cover_url: clean(cover_url) || null,
    status: status === "published" ? "published" : "draft",
    position: ((last ?? [])[0]?.position ?? -1) + 1,
  }).select().single();
  if (error) return bad(res, error.message);
  const p = await getProgramme(programme_id);
  await logLine("Course added", `${course.code} was added to ${p?.name ?? "a programme"}.`);
  ok(res, course);
}));

async function getCourse(id) {
  const { data: c } = await edu().from("programme_courses").select("*").eq("id", id).maybeSingle();
  return c;
}

router.get("/courses/:id", asyncHandler(async (req, res) => {
  const c = await getCourse(req.params.id);
  if (!c) return missing(res, "That course no longer exists");
  const [p, s, materials] = await Promise.all([
    getProgramme(c.programme_id),
    edu().from("programme_sections").select("*").eq("id", c.section_id).maybeSingle(),
    edu().from("programme_materials").select("*").eq("course_id", c.id).order("position"),
  ]);
  ok(res, { ...c, programme: p, section: s?.data ?? null, materials: materials.data ?? [] });
}));

router.patch("/courses/:id", asyncHandler(async (req, res) => {
  const c = await getCourse(req.params.id);
  if (!c) return missing(res, "That course no longer exists");
  const { section_id, code, title, instructor, color, status, cover_url } = req.body ?? {};
  const patch = {};
  if (section_id !== undefined) patch.section_id = section_id;
  if (code !== undefined) patch.code = clean(code);
  if (title !== undefined) patch.title = clean(title);
  if (instructor !== undefined) patch.instructor = clean(instructor);
  if (color !== undefined) patch.color = Math.max(0, Math.min(5, Number(color) || 0));
  if (cover_url !== undefined) patch.cover_url = clean(cover_url) || null;
  if (status !== undefined) patch.status = status === "published" ? "published" : "draft";
  const { error } = await edu().from("programme_courses").update(patch).eq("id", c.id);
  if (error) return bad(res, error.message);
  await logLine("Course updated", `${patch.code ?? c.code} was updated.`);
  ok(res, await getCourse(c.id));
}));

router.post("/courses/:id/move", asyncHandler(async (req, res) => {
  const c = await getCourse(req.params.id);
  if (!c) return missing(res, "That course no longer exists");
  const dir = req.body?.dir === "up" ? -1 : 1;
  const { data: siblings } = await edu().from("programme_courses")
    .select("id, position").eq("section_id", c.section_id).order("position");
  const i = (siblings ?? []).findIndex((s) => s.id === c.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= siblings.length) return ok(res, { moved: false });
  await edu().from("programme_courses").update({ position: siblings[j].position }).eq("id", siblings[i].id);
  await edu().from("programme_courses").update({ position: siblings[i].position }).eq("id", siblings[j].id);
  ok(res, { moved: true });
}));

router.delete("/courses/:id", asyncHandler(async (req, res) => {
  const c = await getCourse(req.params.id);
  if (!c) return missing(res, "That course no longer exists");
  await edu().from("programme_courses").delete().eq("id", c.id);
  await logLine("Course deleted", `${c.code} was removed.`);
  ok(res, { deleted: true });
}));

/* ── Materials ─────────────────────────────────────────────────────────── */
router.get("/materials", asyncHandler(async (req, res) => {
  const q = clean(req.query.q)?.toLowerCase();
  let query = edu().from("programme_materials")
    .select("*, programme_courses(id, code, title, programme_id, programme_sections(name), programmes(name))")
    .order("position").order("created_at");
  if (clean(req.query.course)) query = query.eq("course_id", req.query.course);
  if (clean(req.query.type)) query = query.eq("type", req.query.type);
  const { data: rows } = await query;
  const materials = (rows ?? [])
    .filter((m) => (req.query.status ? m.status === req.query.status : true))
    .filter((m) => !q || m.title.toLowerCase().includes(q))
    .map((m) => ({
      ...m,
      course_code: m.programme_courses?.code ?? null,
      course_title: m.programme_courses?.title ?? null,
      programme_name: m.programme_courses?.programmes?.name ?? null,
      programme_courses: undefined,
    }));
  ok(res, materials);
}));

router.post("/materials", asyncHandler(async (req, res) => {
  const { course_id, title, type, meta, url, thumb_url, status } = req.body ?? {};
  if (!course_id) return bad(res, "Course is required");
  if (!clean(title)) return bad(res, "Title is required");
  const t = MATERIAL_TYPES.includes(type) ? type : "pdf";
  const { data: last } = await edu().from("programme_materials").select("position").eq("course_id", course_id).order("position", { ascending: false }).limit(1);
  const { data: material, error } = await edu().from("programme_materials").insert({
    course_id, title: clean(title), type: t,
    meta: clean(meta), url: clean(url) || null, thumb_url: clean(thumb_url) || null,
    status: status === "published" ? "published" : "draft",
    position: ((last ?? [])[0]?.position ?? -1) + 1,
  }).select().single();
  if (error) return bad(res, error.message);
  await logLine("Content added", `${material.title} was added as ${t}.`);
  ok(res, material);
}));

router.patch("/materials/:id", asyncHandler(async (req, res) => {
  const { data: m } = await edu().from("programme_materials").select("*").eq("id", req.params.id).maybeSingle();
  if (!m) return missing(res, "That material no longer exists");
  const { course_id, title, type, meta, url, thumb_url, status } = req.body ?? {};
  const patch = {};
  if (course_id !== undefined) patch.course_id = course_id;
  if (title !== undefined) patch.title = clean(title);
  if (type !== undefined && MATERIAL_TYPES.includes(type)) patch.type = type;
  if (meta !== undefined) patch.meta = clean(meta);
  if (url !== undefined) patch.url = clean(url) || null;
  if (thumb_url !== undefined) patch.thumb_url = clean(thumb_url) || null;
  if (status !== undefined) patch.status = status === "published" ? "published" : "draft";
  const { error } = await edu().from("programme_materials").update(patch).eq("id", m.id);
  if (error) return bad(res, error.message);
  await logLine("Content updated", `${patch.title ?? m.title} was updated.`);
  ok(res, { ...m, ...patch });
}));

router.post("/materials/:id/move", asyncHandler(async (req, res) => {
  const { data: m } = await edu().from("programme_materials").select("*").eq("id", req.params.id).maybeSingle();
  if (!m) return missing(res, "That material no longer exists");
  const dir = req.body?.dir === "up" ? -1 : 1;
  const { data: siblings } = await edu().from("programme_materials")
    .select("id, position").eq("course_id", m.course_id).order("position");
  const i = (siblings ?? []).findIndex((s) => s.id === m.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= siblings.length) return ok(res, { moved: false });
  await edu().from("programme_materials").update({ position: siblings[j].position }).eq("id", siblings[i].id);
  await edu().from("programme_materials").update({ position: siblings[i].position }).eq("id", siblings[j].id);
  ok(res, { moved: true });
}));

router.delete("/materials/:id", asyncHandler(async (req, res) => {
  const { data: m } = await edu().from("programme_materials").select("*").eq("id", req.params.id).maybeSingle();
  if (!m) return missing(res, "That material no longer exists");
  await edu().from("programme_materials").delete().eq("id", m.id);
  await logLine("Content deleted", `${m.title} was removed.`);
  ok(res, { deleted: true });
}));

export default router;
