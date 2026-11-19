/**
 * instructor/service-curriculum.js — modules, the recurrence schedule preview
 * and commit, on-demand curriculum, and per-session materials.
 */
import { generateSchedule } from "./schedule.js";
import { mapModule } from "./rules.js";
import { asyncHandler, created, ok, err400, err403, err404, err500, now, ownCourse } from "./service-core.js";
import {
  modulesForCourse, moduleById, insertModule,
  updateModule as updateModuleRow, deleteModule as deleteModuleRow,
  insertLesson, setScheduleConfig, materialsForSession, insertMaterials,
  insertMaterial, materialById, deleteMaterial as deleteMaterialRow,
} from "./store-courses.js";
import {
  sessionsForModules, sessionOwnerRef, insertSession,
} from "./store-sessions.js";

// ─── § MODULES & SCHEDULE ─────────────────────────────────────────────────────

// GET /api/instructor/courses/:courseId/modules — modules + their sessions.
export const listModules = asyncHandler(async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!(await ownCourse(courseId, req.user.id))) return err403(res, "You do not own this course");

    const { data: modules, error } = await modulesForCourse(courseId);
    if (error) throw new Error(error.message);

    const ids = (modules ?? []).map((m) => m.id);
    let byModule = {};
    if (ids.length) {
      const { data: sessions } = await sessionsForModules(ids);
      for (const s of sessions ?? []) (byModule[s.module_id] ??= []).push(s);
    }

    ok(res, (modules ?? []).map((m) => mapModule(m, byModule[m.id] ?? [])));
  } catch (e) { err500(res, e); }
});

// POST /api/instructor/courses/:courseId/modules — create a single module.
export const createModule = asyncHandler(async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!(await ownCourse(courseId, req.user.id))) return err403(res, "You do not own this course");
    const { title, description, orderIndex } = req.body;
    if (!title) return err400(res, "title is required");

    const { data, error } = await insertModule({ course_id: courseId, title, description: description ?? null, order_index: Number(orderIndex ?? 0) });
    if (error) throw new Error(error.message);
    created(res, mapModule(data));
  } catch (e) { err500(res, e); }
});

// PATCH /api/instructor/modules/:id — rename / reorder a module.
export const updateModule = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { data: mod } = await moduleById(id);
    if (!mod) return err404(res, "Module not found");
    if (!(await ownCourse(mod.course_id, req.user.id))) return err403(res, "You do not own this module's course");

    const b = req.body, updates = {};
    if (b.title !== undefined)       updates.title = b.title;
    if (b.description !== undefined) updates.description = b.description;
    if (b.orderIndex !== undefined)  updates.order_index = Number(b.orderIndex);
    if (Object.keys(updates).length === 0) return err400(res, "No updatable fields provided");

    const { data, error } = await updateModuleRow(id, updates);
    if (error) throw new Error(error.message);
    ok(res, mapModule(data));
  } catch (e) { err500(res, e); }
});

// DELETE /api/instructor/modules/:id — delete a module (sessions keep, module_id nulled).
export const deleteModule = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { data: mod } = await moduleById(id);
    if (!mod) return err404(res, "Module not found");
    if (!(await ownCourse(mod.course_id, req.user.id))) return err403(res, "You do not own this module's course");

    const { error } = await deleteModuleRow(id);
    if (error) throw new Error(error.message);
    ok(res, { message: "Module deleted" });
  } catch (e) { err500(res, e); }
});

// POST /api/instructor/courses/:courseId/schedule/preview
// Expand a recurrence spec into a module→sessions tree (no writes).
export const previewSchedule = asyncHandler(async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!(await ownCourse(courseId, req.user.id))) return err403(res, "You do not own this course");
    const tree = generateSchedule(req.body || {});
    ok(res, tree);
  } catch (e) {
    // generator throws plain validation errors — surface as 400.
    return err400(res, e.message);
  }
});

// POST /api/instructor/courses/:courseId/schedule/commit
// Persist an edited module→sessions tree (+ optional per-session materials)
// and save the reusable schedule_config on the course.
export const commitSchedule = asyncHandler(async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!(await ownCourse(courseId, req.user.id))) return err403(res, "You do not own this course");

    const { modules = [], scheduleConfig } = req.body || {};
    if (!Array.isArray(modules) || modules.length === 0) return err400(res, "modules array is required");

    if (scheduleConfig) {
      await setScheduleConfig(courseId, scheduleConfig, now());
    }

    const createdModules = [];
    for (const [mi, m] of modules.entries()) {
      const { data: modRow, error: mErr } = await insertModule({ course_id: courseId, title: m.title || `Week ${mi + 1}`, description: m.description ?? null, order_index: Number(m.orderIndex ?? mi) });
      if (mErr) throw new Error(mErr.message);

      const createdSessions = [];
      for (const [si, s] of (m.sessions ?? []).entries()) {
        if (!s.scheduled_start && !s.startTime) continue;
        const startIso = s.scheduled_start ?? s.startTime;
        const durationMin = Number(s.duration_min ?? s.duration ?? 60);
        const endIso = s.scheduled_end ?? new Date(new Date(startIso).getTime() + durationMin * 60000).toISOString();

        const { data: sess, error: sErr } = await insertSession({
          course_id:       courseId,
          instructor_id:   req.user.id,
          module_id:       modRow.id,
          order_index:     Number(s.order_index ?? si),
          title:           s.title || `Session ${si + 1}`,
          description:     s.description ?? null,
          topic:           s.topic ?? s.title ?? null,
          scheduled_start: startIso,
          scheduled_end:   endIso,
          platform:        s.platform ?? "zoom",
          status:          "scheduled",
          max_participants: 50,
          created_at:      now(),
          updated_at:      now(),
        });
        if (sErr) throw new Error(sErr.message);

        // Optional materials for this session.
        const mats = (s.materials ?? []).filter((x) => x && (x.title || x.url || x.body));
        if (mats.length) {
          await insertMaterials(
            mats.map((x, xi) => ({
              session_id:  sess.id,
              title:       x.title || x.url || "Material",
              kind:        ["file", "link", "note"].includes(x.kind) ? x.kind : "file",
              url:         x.url ?? null,
              body:        x.body ?? null,
              file_type:   x.fileType ?? x.file_type ?? null,
              order_index: xi,
            }))
          );
        }
        createdSessions.push(sess);
      }
      createdModules.push(mapModule(modRow, createdSessions));
    }

    created(res, { modules: createdModules });
  } catch (e) { err500(res, e); }
});

// POST /api/instructor/courses/:courseId/curriculum
// Persist an on-demand course's sections → video lessons tree.
// Sections map to course_modules; lessons map to the lessons table.
export const commitCurriculum = asyncHandler(async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!(await ownCourse(courseId, req.user.id))) return err403(res, "You do not own this course");

    const { sections = [] } = req.body || {};
    if (!Array.isArray(sections) || sections.length === 0) return err400(res, "sections array is required");

    const createdSections = [];
    for (const [si, s] of sections.entries()) {
      const { data: modRow, error: mErr } = await insertModule({
        course_id:   courseId,
        title:       s.title || `Section ${si + 1}`,
        description: s.description ?? null,
        order_index: Number(s.orderIndex ?? si),
      });
      if (mErr) throw new Error(mErr.message);

      const createdLessons = [];
      for (const [li, l] of (s.lessons ?? []).entries()) {
        const durationSec = l.durationSeconds != null
          ? Number(l.durationSeconds)
          : Math.round((Number(l.duration) || 0) * 60);  // wizard sends minutes

        const { data: lesson, error: lErr } = await insertLesson({
          module_id:        modRow.id,
          title:            l.title || `Lesson ${li + 1}`,
          description:      l.description ?? null,
          video_url:        l.videoUrl ?? l.video_url ?? null,
          thumbnail_url:    l.thumbnailUrl ?? l.thumbnail_url ?? null,
          duration_seconds: durationSec || null,
          order_index:      Number(l.orderIndex ?? li),
          is_preview:       !!(l.preview ?? l.is_preview),
          lesson_type:      ["video", "quiz", "assignment", "reading"].includes(l.lessonType) ? l.lessonType : "video",
        });
        if (lErr) throw new Error(lErr.message);
        createdLessons.push(lesson);
      }
      createdSections.push({ ...modRow, lessons: createdLessons });
    }

    created(res, { sections: createdSections });
  } catch (e) { err500(res, e); }
});

// ─── § SESSION MATERIALS ──────────────────────────────────────────────────────

const sessionOwned = async (sessionId, userId) => {
  const { data: s } = await sessionOwnerRef(sessionId);
  if (!s) return null;
  return (await ownCourse(s.course_id, userId)) ? s : null;
};

// GET /api/instructor/sessions/:id/materials
export const listMaterials = asyncHandler(async (req, res) => {
  try {
    if (!(await sessionOwned(req.params.id, req.user.id))) return err403(res, "You do not own this session");
    const { data, error } = await materialsForSession(req.params.id);
    if (error) throw new Error(error.message);
    ok(res, data ?? []);
  } catch (e) { err500(res, e); }
});

// POST /api/instructor/sessions/:id/materials
export const addMaterial = asyncHandler(async (req, res) => {
  try {
    if (!(await sessionOwned(req.params.id, req.user.id))) return err403(res, "You do not own this session");
    const b = req.body;
    if (!b.title && !b.url && !b.body) return err400(res, "title, url, or body is required");

    const { data, error } = await insertMaterial({
      session_id:  req.params.id,
      title:       b.title || b.url || "Material",
      kind:        ["file", "link", "note"].includes(b.kind) ? b.kind : "file",
      url:         b.url ?? null,
      body:        b.body ?? null,
      file_type:   b.fileType ?? b.file_type ?? null,
      order_index: Number(b.orderIndex ?? b.order_index ?? 0),
    });
    if (error) throw new Error(error.message);
    created(res, data);
  } catch (e) { err500(res, e); }
});

// DELETE /api/instructor/materials/:id
export const deleteMaterial = asyncHandler(async (req, res) => {
  try {
    const { data: mat } = await materialById(req.params.id);
    if (!mat) return err404(res, "Material not found");
    if (!(await sessionOwned(mat.session_id, req.user.id))) return err403(res, "You do not own this material");
    const { error } = await deleteMaterialRow(req.params.id);
    if (error) throw new Error(error.message);
    ok(res, { message: "Material deleted" });
  } catch (e) { err500(res, e); }
});
