/**
 * modules/school/mgmt-service-records.js — bulk import/export, student
 * documents, printable document templates and certificates for the
 * Management API.
 */

import AdmZip from "adm-zip";
import { ensureBucket, uploadPublicFile } from "./templateStorage.js";
import { renderDocument } from "./documentRenderer.js";
import { openai } from "../../lib/aiModel.js";
import { renderPdfToImages } from "../../lib/pdfRender.js";
import { DEFAULT_DOC_TEMPLATES, getDefaultDoc } from "./defaultDocs/index.js";
import * as store from "./mgmt-store.js";
import { getMySchool } from "./mgmt-service.js";
import {
  extractDocVariables, parseCsvText, mimeForFile, studentLabel,
  TINY_PNG, TPL_VISION_SYSTEM,
} from "./mgmt-rules.js";

/* ═══════════════ Bulk import helpers ══════════════════════════════════════ */

async function logBulkImport(schoolId, kind, fileName, { total = 0, success = 0, failed = 0, errors = [] } = {}) {
  const status = failed === 0 ? "completed" : success === 0 ? "failed" : "partial";
  await store.insert("bulk_import_logs", {
    school_id: schoolId, kind, file_name: fileName || null, status,
    total_rows: total, success_count: success, failed_count: failed, errors: errors.slice(0, 30),
  });
}

// Bulk upload students (CSV parsed client-side → rows of objects).
export async function studentsBulkUpload(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: "rows[] is required" });
    const allowed = ["admission_no", "roll_no", "first_name", "last_name", "gender", "dob", "guardian_name", "guardian_phone", "guardian_email", "address", "blood_group", "status"];
    let inserted = 0, updated = 0, skipped = 0;
    const errors = [];
    for (const [i, raw] of rows.entries()) {
      const row = {};
      for (const k of allowed) if (raw[k] !== undefined && raw[k] !== "") row[k] = raw[k];
      if (!row.admission_no || !row.first_name || !row.last_name) { skipped++; errors.push(`Row ${i + 1}: admission_no, first_name and last_name are required`); continue; }
      const { data: existing } = await store.select("students", {
        columns: "id", filters: [["eq", "school_id", school.id], ["eq", "admission_no", row.admission_no]], maybeSingle: true,
      });
      if (existing) {
        const { error } = await store.update("students", row, [["eq", "id", existing.id]]);
        if (error) { skipped++; errors.push(`Row ${i + 1}: ${error.message}`); } else updated++;
      } else {
        const { error } = await store.insert("students", { ...row, school_id: school.id });
        if (error) { skipped++; errors.push(`Row ${i + 1}: ${error.message}`); } else inserted++;
      }
    }
    await logBulkImport(school.id, "students", req.body.file_name, { total: rows.length, success: inserted + updated, failed: skipped, errors });
    res.json({ success: true, inserted, updated, skipped, errors: errors.slice(0, 20) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Bulk photo upload — files matched to students by filename = admission_no.
export async function studentsBulkPhotos(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No files uploaded" });
    const { data: students } = await store.select("students", {
      columns: "id, admission_no", filters: [["eq", "school_id", school.id]],
    });
    const byAdm = Object.fromEntries((students || []).map((s) => [String(s.admission_no).toLowerCase(), s.id]));

    await ensureBucket();
    let matched = 0; const unmatched = [];
    for (const f of files) {
      const base = (f.originalname || "").replace(/\.[^.]+$/, "").trim().toLowerCase();
      const studentId = byAdm[base];
      if (!studentId) { unmatched.push(f.originalname); continue; }
      const safe = (f.originalname || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
      const dest = `students/${school.id}/photos/${studentId}-${Date.now()}-${safe}`;
      const url = await uploadPublicFile(dest, f.buffer, f.mimetype || "image/jpeg");
      await store.update("students", { photo_url: url }, [["eq", "id", studentId]]);
      matched++;
    }
    await logBulkImport(school.id, "photos", null, { total: files.length, success: matched, failed: unmatched.length, errors: unmatched.map((f) => `Unmatched: ${f}`) });
    res.json({ success: true, matched, unmatched: unmatched.slice(0, 30), totalFiles: files.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Bulk document upload — files matched to students by filename = admission_no.
export async function studentsBulkDocs(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No files uploaded" });
    const { data: students } = await store.select("students", {
      columns: "id, admission_no", filters: [["eq", "school_id", school.id]],
    });
    const byAdm = Object.fromEntries((students || []).map((s) => [String(s.admission_no).toLowerCase(), s.id]));

    await ensureBucket();
    let matched = 0; const unmatched = [];
    for (const f of files) {
      const base = (f.originalname || "").replace(/\.[^.]+$/, "").trim();
      const studentId = byAdm[base.toLowerCase()];
      if (!studentId) { unmatched.push(f.originalname); continue; }
      const safe = (f.originalname || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
      const dest = `students/${school.id}/documents/${studentId}-${Date.now()}-${safe}`;
      const url = await uploadPublicFile(dest, f.buffer, f.mimetype || "application/octet-stream");
      await store.insert("student_documents", { school_id: school.id, student_id: studentId, title: f.originalname || "Document", url });
      matched++;
    }
    await logBulkImport(school.id, "documents", null, { total: files.length, success: matched, failed: unmatched.length, errors: unmatched.map((f) => `Unmatched: ${f}`) });
    res.json({ success: true, matched, unmatched: unmatched.slice(0, 30), totalFiles: files.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Bulk photo upload via ZIP + photo_mapping.csv (admission_no, file_name).
export async function studentsBulkPhotosZip(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "ZIP file is required" });
    let zip;
    try { zip = new AdmZip(file.buffer); } catch { return res.status(400).json({ error: "Invalid ZIP file" }); }
    const entries = zip.getEntries();
    const csvEntry = entries.find((e) => /photo_mapping\.csv$/i.test(e.entryName));
    if (!csvEntry) return res.status(400).json({ error: "ZIP must contain photo_mapping.csv" });
    const mapping = parseCsvText(csvEntry.getData().toString("utf8"));
    if (!mapping.length) return res.status(400).json({ error: "photo_mapping.csv has no rows" });
    const { data: students } = await store.select("students", {
      columns: "id, admission_no", filters: [["eq", "school_id", school.id]],
    });
    const byAdm = Object.fromEntries((students || []).map((s) => [String(s.admission_no).toLowerCase(), s.id]));
    const fileByName = Object.fromEntries(entries.filter((e) => !e.isDirectory).map((e) => [e.entryName.split("/").pop().toLowerCase(), e]));

    await ensureBucket();
    let success = 0; const errors = [];
    for (const [i, row] of mapping.entries()) {
      const adm = (row.admission_no || "").trim();
      const fname = (row.file_name || "").trim();
      if (!adm || !fname) { errors.push(`Row ${i + 1}: admission_no and file_name are required`); continue; }
      const studentId = byAdm[adm.toLowerCase()];
      if (!studentId) { errors.push(`Row ${i + 1}: no student with admission_no ${adm}`); continue; }
      const entry = fileByName[fname.toLowerCase()];
      if (!entry) { errors.push(`Row ${i + 1}: file ${fname} not found in ZIP`); continue; }
      const safe = fname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const dest = `students/${school.id}/photos/${studentId}-${Date.now()}-${safe}`;
      const url = await uploadPublicFile(dest, entry.getData(), mimeForFile(fname));
      await store.update("students", { photo_url: url }, [["eq", "id", studentId]]);
      success++;
    }
    await logBulkImport(school.id, "photos", file.originalname, { total: mapping.length, success, failed: mapping.length - success, errors });
    res.json({ success: true, total: mapping.length, matched: success, failed: mapping.length - success, errors: errors.slice(0, 30) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Bulk document upload via ZIP + document_mapping.csv.
export async function studentsBulkDocsZip(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "ZIP file is required" });
    let zip;
    try { zip = new AdmZip(file.buffer); } catch { return res.status(400).json({ error: "Invalid ZIP file" }); }
    const entries = zip.getEntries();
    const csvEntry = entries.find((e) => /document_mapping\.csv$/i.test(e.entryName));
    if (!csvEntry) return res.status(400).json({ error: "ZIP must contain document_mapping.csv" });
    const mapping = parseCsvText(csvEntry.getData().toString("utf8"));
    if (!mapping.length) return res.status(400).json({ error: "document_mapping.csv has no rows" });
    const { data: students } = await store.select("students", {
      columns: "id, admission_no", filters: [["eq", "school_id", school.id]],
    });
    const byAdm = Object.fromEntries((students || []).map((s) => [String(s.admission_no).toLowerCase(), s.id]));
    const fileByName = Object.fromEntries(entries.filter((e) => !e.isDirectory).map((e) => [e.entryName.split("/").pop().toLowerCase(), e]));

    await ensureBucket();
    let success = 0; const errors = [];
    for (const [i, row] of mapping.entries()) {
      const adm = (row.admission_no || "").trim();
      const fname = (row.file_name || "").trim();
      const label = (row.document_name || fname || "Document").trim();
      if (!adm || !fname) { errors.push(`Row ${i + 1}: admission_no and file_name are required`); continue; }
      const studentId = byAdm[adm.toLowerCase()];
      if (!studentId) { errors.push(`Row ${i + 1}: no student with admission_no ${adm}`); continue; }
      const entry = fileByName[fname.toLowerCase()];
      if (!entry) { errors.push(`Row ${i + 1}: file ${fname} not found in ZIP`); continue; }
      const safe = fname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const dest = `students/${school.id}/documents/${studentId}-${Date.now()}-${safe}`;
      const url = await uploadPublicFile(dest, entry.getData(), mimeForFile(fname));
      const { error } = await store.insert("student_documents", { school_id: school.id, student_id: studentId, title: label, url });
      if (error) { errors.push(`Row ${i + 1}: ${error.message}`); continue; }
      success++;
    }
    await logBulkImport(school.id, "documents", file.originalname, { total: mapping.length, success, failed: mapping.length - success, errors });
    res.json({ success: true, total: mapping.length, matched: success, failed: mapping.length - success, errors: errors.slice(0, 30) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Bulk import history (Recent Import History table).
export async function listBulkImportLogs(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const filters = [["eq", "school_id", school.id]];
    if (req.query.kind) filters.push(["eq", "kind", req.query.kind]);
    const { data, error } = await store.select("bulk_import_logs", {
      filters, orderBy: "created_at", asc: false, limit: 20,
    });
    if (error) throw new Error(error.message);
    res.json({ success: true, data: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/* ═══════════════ CSV templates / sample ZIPs ══════════════════════════════ */

export function bulkStudentsTemplateCsv(_req, res) {
  const csv = "admission_no,roll_no,first_name,last_name,gender,dob,guardian_name,guardian_phone,guardian_email,address,blood_group,status\nADM-1001,1,Jane,Doe,female,2015-04-12,John Doe,+2348000000000,,,,active\n";
  res.type("text/csv").attachment("students_template.csv").send(csv);
}

export function bulkPhotosTemplateCsv(_req, res) {
  const csv = "admission_no,file_name\nADM-1001,ADM-1001_photo.jpg\nADM-1002,ADM-1002_photo.jpg\n";
  res.type("text/csv").attachment("photo_mapping_template.csv").send(csv);
}

export function bulkPhotosSampleZip(_req, res) {
  const zip = new AdmZip();
  zip.addFile("photo_mapping.csv", Buffer.from("admission_no,file_name\nADM-1001,ADM-1001_photo.jpg\nADM-1002,ADM-1002_photo.jpg\n"));
  zip.addFile("ADM-1001_photo.jpg", TINY_PNG);
  zip.addFile("ADM-1002_photo.jpg", TINY_PNG);
  res.type("application/zip").attachment("photos_sample.zip").send(zip.toBuffer());
}

export function bulkDocsTemplateCsv(_req, res) {
  const csv = "admission_no,document_name,file_name\nADM-1001,Birth Certificate,ADM-1001_birth_cert.pdf\nADM-1001,Transfer Certificate,ADM-1001_tc.pdf\n";
  res.type("text/csv").attachment("document_mapping_template.csv").send(csv);
}

export function bulkDocsSampleZip(_req, res) {
  const zip = new AdmZip();
  zip.addFile("document_mapping.csv", Buffer.from("admission_no,document_name,file_name\nADM-1001,Birth Certificate,ADM-1001_birth_cert.pdf\nADM-1001,Transfer Certificate,ADM-1001_tc.pdf\n"));
  zip.addFile("ADM-1001_birth_cert.pdf", Buffer.from("Sample placeholder document -- replace with a real file."));
  zip.addFile("ADM-1001_tc.pdf", Buffer.from("Sample placeholder document -- replace with a real file."));
  res.type("application/zip").attachment("documents_sample.zip").send(zip.toBuffer());
}

/* ═══════════════ Student documents ════════════════════════════════════════ */

export async function uploadStudentDocuments(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: student } = await store.select("students", {
      columns: "id", filters: [["eq", "id", req.params.id], ["eq", "school_id", school.id]], maybeSingle: true,
    });
    if (!student) return res.status(404).json({ error: "Student not found" });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No files uploaded" });
    await ensureBucket();
    const created = [];
    for (const f of files) {
      const safe = (f.originalname || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
      const dest = `students/${school.id}/documents/${student.id}-${Date.now()}-${safe}`;
      const url = await uploadPublicFile(dest, f.buffer, f.mimetype || "application/octet-stream");
      const { data, error } = await store.insert("student_documents", { school_id: school.id, student_id: student.id, title: req.body.title || f.originalname || "Document", url }, { columns: "*", single: true });
      if (error) throw new Error(error.message);
      created.push(data);
    }
    res.status(201).json({ success: true, data: created });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/* ═══════════════ Document templates ═══════════════════════════════════════ */

// Build a document template from a sample (photo / scan / PDF) via vision.
export async function buildDocumentTemplateFromFile(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const f = req.file;
    if (!f) return res.status(400).json({ error: "Upload a document image or PDF" });

    const name = (f.originalname || "").toLowerCase();
    const isPdf = f.mimetype === "application/pdf" || /\.pdf$/i.test(name);
    const isImg = /^image\//.test(f.mimetype || "") || /\.(png|jpe?g|webp|gif|heic)$/i.test(name);

    let images = [];
    if (isPdf) {
      const r = await renderPdfToImages(f.buffer, { maxPages: 3, scale: 2 }).catch(() => ({ images: [] }));
      images = r.images || [];
    } else if (isImg) {
      images = [`data:${f.mimetype || "image/png"};base64,${f.buffer.toString("base64")}`];
    } else {
      return res.status(400).json({ error: "Upload a photo/scan (PNG, JPG) or a PDF of the document." });
    }
    if (!images.length) return res.status(400).json({ error: "Couldn't read that file. Try a clearer photo or a PDF." });

    const userContent = [{ type: "text", text: "Recreate this document as a reusable printable HTML template following the rules." }];
    for (const url of images) userContent.push({ type: "image_url", image_url: { url, detail: "high" } });

    const resp = await openai.chat.completions.create({
      __role: "vision", max_tokens: 3200, temperature: 0.2,
      messages: [{ role: "system", content: TPL_VISION_SYSTEM }, { role: "user", content: userContent }],
    });
    let html = (resp.choices?.[0]?.message?.content || "").trim();
    const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
    if (fence) html = fence[1].trim();
    if (!html) return res.status(502).json({ error: "Could not build a template from that document. Try again." });

    const tplName = (req.body?.name || "").trim() || (f.originalname || "Template").replace(/\.[^.]+$/, "") || "Template";
    const category = req.body?.category || "other";
    const { data, error } = await store.insert("document_templates",
      { school_id: school.id, name: tplName, category, body: html, page_size: "A4", orientation: "portrait", variables: extractDocVariables(html) },
      { columns: "id, name, category", single: true });
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data });
  } catch (e) {
    console.error("[document-templates/build-from-file]", e.message);
    res.status(500).json({ error: "Could not build the template. Try again." });
  }
}

// List the school's templates + the shared default gallery.
export async function listDocumentTemplates(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const filters = [["eq", "school_id", school.id]];
    if (req.query.category) filters.push(["eq", "category", req.query.category]);
    const { data } = await store.select("document_templates", {
      filters, orderBy: "created_at", asc: false,
    });
    const own = (data || []).map((t) => ({ ...t, isDefault: false }));
    const ownNames = new Set(own.map((t) => t.name));
    const defaults = DEFAULT_DOC_TEMPLATES
      .filter((t) => !ownNames.has(t.name) && (!req.query.category || t.category === req.query.category))
      .map((t) => ({ id: `default:${t.id}`, name: t.name, description: t.description, category: t.category, page_size: t.page_size, orientation: t.orientation, variables: t.variables, isDefault: true }));
    res.json({ success: true, data: [...own, ...defaults] });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// View a template rendered as a real file. ?sample=1 fills the demo data.
export async function documentTemplateHtml(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    let tpl;
    if (String(req.params.id).startsWith("default:")) {
      tpl = getDefaultDoc(String(req.params.id).slice("default:".length));
    } else {
      const { data } = await store.select("document_templates", {
        filters: [["eq", "id", req.params.id], ["eq", "school_id", school.id]], maybeSingle: true,
      });
      tpl = data;
    }
    if (!tpl) return res.status(404).type("html").send("<h1>Template not found</h1>");
    const data = req.query.sample === "1" ? (tpl.sample || {}) : {};
    res.type("html").send(renderDocument({ body: tpl.body, css: tpl.css, pageSize: tpl.page_size, orientation: tpl.orientation, data }));
  } catch (e) { res.status(500).type("html").send("<h1>Something went wrong</h1>"); }
}

// Clone a default doc template into the school's own (idempotent by name).
async function ensureSchoolDocTemplate(school, id) {
  if (!String(id).startsWith("default:")) return id;
  const def = getDefaultDoc(String(id).slice("default:".length));
  if (!def) return null;
  const { data: existing } = await store.select("document_templates", {
    columns: "id", filters: [["eq", "school_id", school.id], ["eq", "name", def.name]], maybeSingle: true,
  });
  if (existing) return existing.id;
  const { data: row, error } = await store.insert("document_templates", {
    school_id: school.id, name: def.name, description: def.description, category: def.category,
    page_size: def.page_size, orientation: def.orientation, body: def.body, css: def.css || null, variables: def.variables || [],
  }, { columns: "id", single: true });
  if (error) throw new Error(error.message);
  return row.id;
}

// Live preview while editing (unsaved) — body/css/page settings → print HTML.
export async function documentsPreview(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { body = "", css = "", page_size = "A4", orientation = "portrait", data = {} } = req.body || {};
    res.json({ success: true, html: renderDocument({ body, css, pageSize: page_size, orientation, data }) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Render a saved template filled with values; optionally save a record.
export async function documentTemplateRender(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    // Load from the school's template or the shared default gallery.
    let tpl;
    if (String(req.params.id).startsWith("default:")) tpl = getDefaultDoc(String(req.params.id).slice("default:".length));
    else ({ data: tpl } = await store.select("document_templates", {
      filters: [["eq", "id", req.params.id], ["eq", "school_id", school.id]], maybeSingle: true,
    }));
    if (!tpl) return res.status(404).json({ error: "Template not found" });
    const values = req.body.data || {};
    const html = renderDocument({ body: tpl.body, css: tpl.css, pageSize: tpl.page_size, orientation: tpl.orientation, data: values });

    let record = null;
    if (req.body.save) {
      const templateId = await ensureSchoolDocTemplate(school, req.params.id); // clone default if needed
      const serial = `DOC-${Date.now().toString(36).toUpperCase()}`;
      const { data: rec, error } = await store.insert("document_records", {
        school_id: school.id, template_id: templateId || null, title: req.body.title || tpl.name,
        serial_no: serial, data: values, student_id: req.body.student_id || null, staff_id: req.body.staff_id || null,
      }, { columns: "*", single: true });
      if (error) throw new Error(error.message);
      record = rec;
    }
    res.json({ success: true, html, record });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// A saved record rendered as a standalone print-ready page (open/print).
export async function documentRecordHtml(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: rec } = await store.select("document_records", {
      filters: [["eq", "id", req.params.id], ["eq", "school_id", school.id]], maybeSingle: true,
    });
    if (!rec) return res.status(404).type("html").send("<h1>Document not found</h1>");
    const { data: tpl } = rec.template_id
      ? await store.select("document_templates", { filters: [["eq", "id", rec.template_id]], maybeSingle: true })
      : { data: null };
    const html = renderDocument({ body: tpl?.body || "", css: tpl?.css, pageSize: tpl?.page_size, orientation: tpl?.orientation, data: rec.data || {} });
    res.type("html").send(html);
  } catch (e) { res.status(500).type("html").send("<h1>Something went wrong</h1>"); }
}

/* ═══════════════ Certificates ═════════════════════════════════════════════ */

export async function generateCertificate(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { template_id, student_id, recipient_name } = req.body;
    if (!template_id) return res.status(400).json({ error: "template_id is required" });
    const { data: tpl } = await store.select("certificate_templates", {
      filters: [["eq", "id", template_id], ["eq", "school_id", school.id]], maybeSingle: true,
    });
    if (!tpl) return res.status(404).json({ error: "Template not found" });

    let name = recipient_name;
    if (!name && student_id) {
      const { data: st } = await store.select("students", {
        columns: "first_name, last_name", filters: [["eq", "id", student_id], ["eq", "school_id", school.id]], maybeSingle: true,
      });
      if (st) name = studentLabel(st);
    }
    if (!name) return res.status(400).json({ error: "recipient_name or student_id is required" });

    const serial = `CERT-${Date.now().toString(36).toUpperCase()}`;
    const issuedOn = new Date().toISOString().slice(0, 10);
    const { data, error } = await store.insert("generated_documents", {
      school_id: school.id, template_id, student_id: student_id || null,
      recipient_name: name, serial_no: serial, issued_on: issuedOn,
    }, { columns: "*", single: true });
    if (error) throw new Error(error.message);

    const body = (tpl.body || "")
      .replaceAll("{{recipient_name}}", name)
      .replaceAll("{{school_name}}", school.name)
      .replaceAll("{{date}}", issuedOn)
      .replaceAll("{{serial_no}}", serial);
    res.status(201).json({ success: true, data: { ...data, body, template_name: tpl.name } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/* ═══════════════ Teaching materials ═══════════════════════════════════════ */

export async function uploadLearningResource(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const f = req.file;
    if (!f) return res.status(400).json({ error: "Choose a file to upload" });
    // Block active content (served from a public origin → stored XSS).
    const name = (f.originalname || "").toLowerCase();
    if (/svg|html?|xml|javascript|xhtml/i.test(f.mimetype || "") || /\.(svg|html?|xhtml|js|xml)$/i.test(name)) {
      return res.status(400).json({ error: "That file type isn't allowed. Upload a document, PDF, image or video." });
    }
    await ensureBucket();
    const safe = (f.originalname || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
    const dest = `materials/${school.id}/${Date.now()}-${safe}`;
    const url = await uploadPublicFile(dest, f.buffer, f.mimetype || "application/octet-stream");
    res.status(201).json({ success: true, data: { url, filename: f.originalname || safe } });
  } catch (e) { console.error("[learning-resources/upload]", e.message); res.status(500).json({ error: "Upload failed. Try again." }); }
}
