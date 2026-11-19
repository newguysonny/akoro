/**
 * modules/school/mgmt-service-generic.js — the whitelisted CRUD factory that
 * backs /api/school/mgmt/:resource.
 */

import * as store from "./mgmt-store.js";
import { getMySchool } from "./mgmt-service.js";
import {
  RESOURCES, TEACHER_READABLE, isSchoolAdmin, sanitizeMgmtRow,
  cleanBody, extractDocVariables,
} from "./mgmt-rules.js";

export async function listResource(req, res) {
  try {
    const cfg = RESOURCES[req.params.resource];
    if (!cfg) return res.status(404).json({ error: "Unknown resource" });
    if (!isSchoolAdmin(req) && !TEACHER_READABLE.has(req.params.resource)) return res.status(403).json({ error: "Not permitted for this resource" });
    const school = await getMySchool(req, res);
    if (!school) return;
    const filters = [["eq", "school_id", school.id]];
    for (const f of cfg.filters || []) {
      if (req.query[f] === undefined || req.query[f] === "") continue;
      // "__null__" filters for rows with no value (e.g. students without a class)
      filters.push(req.query[f] === "__null__" ? ["is", f, null] : ["eq", f, req.query[f]]);
    }
    const { data, error } = await store.select(cfg.table, {
      filters, orderBy: cfg.orderBy || "created_at", asc: cfg.asc ?? false, limit: 500,
    });
    if (error) throw new Error(error.message);
    const isAdmin = ["school", "school_admin", "admin"].includes(req.user.role);
    const withRefs = await store.attachRefs(cfg, data || [], school.id);
    res.json({ success: true, data: withRefs.map((r) => sanitizeMgmtRow(r, isAdmin)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Keep the denormalised class/section "teacher" display field (shown on the
// Classes & Sections lists) in sync with the authoritative class_teachers
// assignment table.
async function syncTeacherDisplay(schoolId, classId, sectionId) {
  if (!classId) return;
  const filters = [["eq", "school_id", schoolId], ["eq", "class_id", classId]];
  if (sectionId) filters.push(["eq", "section_id", sectionId]);
  else filters.push(["is", "section_id", null]);
  const { data: ct } = await store.select("class_teachers", {
    columns: "teacher_id", filters, orderBy: "created_at", asc: true, limit: 1, maybeSingle: true,
  });
  let name = null;
  if (ct?.teacher_id) {
    const { data: u } = await store.select("users", {
      schema: "public", columns: "full_name, email", filters: [["eq", "id", ct.teacher_id]], maybeSingle: true,
    });
    name = u?.full_name || u?.email || null;
  }
  if (sectionId) await store.update("sections", { teacher: name }, [["eq", "id", sectionId], ["eq", "school_id", schoolId]]);
  else await store.update("classes", { teacher: name }, [["eq", "id", classId], ["eq", "school_id", schoolId]]);
}

export async function createResource(req, res) {
  try {
    const cfg = RESOURCES[req.params.resource];
    if (!cfg || cfg.readOnly || cfg.readOnlyCreate) return res.status(404).json({ error: "Unknown resource" });
    const school = await getMySchool(req, res);
    if (!school) return;
    const body = cleanBody(cfg, req.body);
    for (const f of cfg.required || []) {
      if (body[f] === undefined || body[f] === null || body[f] === "") return res.status(400).json({ error: `${f} is required` });
    }
    // Stamp teacher provenance so instructors can filter to their own students.
    if (req.params.resource === "students" && req.user.role === "instructor") body.created_by = req.user.id;
    // Document templates: auto-derive fillable fields from the body's {{tokens}}.
    if (req.params.resource === "document-templates" && body.body && (!Array.isArray(body.variables) || !body.variables.length)) body.variables = extractDocVariables(body.body);
    const { data, error } = await store.insert(cfg.table, { ...body, school_id: school.id }, { columns: "*", single: true });
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "A record with those unique values already exists" });
      throw new Error(error.message);
    }
    if (req.params.resource === "class-teachers") await syncTeacherDisplay(school.id, data.class_id, data.section_id || null).catch(() => {});
    res.status(201).json({ success: true, data: (await store.attachRefs(cfg, [data], school.id))[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function updateResource(req, res) {
  try {
    const cfg = RESOURCES[req.params.resource];
    if (!cfg || cfg.readOnly) return res.status(404).json({ error: "Unknown resource" });
    const school = await getMySchool(req, res);
    if (!school) return;
    const body = cleanBody(cfg, req.body);
    if (!Object.keys(body).length) return res.status(400).json({ error: "No valid fields to update" });
    // Keep document-template fillable fields in sync when the body changes.
    if (req.params.resource === "document-templates" && body.body !== undefined && (!Array.isArray(body.variables) || !body.variables.length)) body.variables = extractDocVariables(body.body);
    const { data, error } = await store.update(cfg.table, body,
      [["eq", "id", req.params.id], ["eq", "school_id", school.id]], { columns: "*", single: true });
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "A record with those unique values already exists" });
      throw new Error(error.message);
    }
    res.json({ success: true, data: (await store.attachRefs(cfg, [data], school.id))[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function deleteResource(req, res) {
  try {
    const cfg = RESOURCES[req.params.resource];
    if (!cfg) return res.status(404).json({ error: "Unknown resource" });
    const school = await getMySchool(req, res);
    if (!school) return;
    // For class-teacher removals, remember which class/section to re-sync after.
    let ctRow = null;
    if (req.params.resource === "class-teachers") {
      ({ data: ctRow } = await store.select("class_teachers", {
        columns: "class_id, section_id",
        filters: [["eq", "id", req.params.id], ["eq", "school_id", school.id]], maybeSingle: true,
      }));
    }
    const { error } = await store.remove(cfg.table, [["eq", "id", req.params.id], ["eq", "school_id", school.id]]);
    if (error) throw new Error(error.message);
    if (ctRow) await syncTeacherDisplay(school.id, ctRow.class_id, ctRow.section_id || null).catch(() => {});
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

