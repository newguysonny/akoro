/**
 * modules/school/mgmt-service-operations.js — HR, library, inventory,
 * transport, the website-builder pages/media and the public portal admin
 * actions for the Management API.
 */

import crypto from "crypto";
import { invalidateCachedUser } from "../auth/index.js";
import { ensureBucket, uploadPublicFile } from "./templateStorage.js";
import * as store from "./mgmt-store.js";
import { getMySchool } from "./mgmt-service.js";
import { studentLabel, mediaTypeOf } from "./mgmt-rules.js";

/* ═══════════════ Staff ════════════════════════════════════════════════════ */

// Force-log-out a staff member's app sessions.
export async function staffLogout(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: staff } = await store.select("staff", {
      columns: "id, email",
      filters: [["eq", "id", req.params.id], ["eq", "school_id", school.id]], maybeSingle: true,
    });
    if (!staff) return res.status(404).json({ error: "Staff not found" });
    if (!staff.email) return res.json({ success: true, loggedOut: false, message: "This staff has no email/login account." });

    const { data: user } = await store.select("users", {
      schema: "public", columns: "id", filters: [["eq", "email", staff.email]], maybeSingle: true,
    });
    if (!user) return res.json({ success: true, loggedOut: false, message: "No app account is linked to this staff's email." });

    const { error } = await store.update("users", { force_logout_at: new Date() }, [["eq", "id", user.id]], { schema: "public" });
    if (error) throw new Error(error.message);
    invalidateCachedUser(user.id);   // security field — never serve it stale
    res.json({ success: true, loggedOut: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Staff attendance register (mirrors the student one).
export async function hrAttendanceRegister(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "date is required" });
    const { data: staff } = await store.select("staff", {
      columns: "id, staff_no, first_name, last_name",
      filters: [["eq", "school_id", school.id], ["eq", "status", "active"]],
      orderBy: "staff_no", asc: true,
    });
    const ids = (staff || []).map((s) => s.id);
    const { data: marks } = ids.length
      ? await store.select("staff_attendance", {
        columns: "staff_id, status", filters: [["eq", "date", date], ["in", "staff_id", ids]],
      })
      : { data: [] };
    const markOf = Object.fromEntries((marks || []).map((m) => [m.staff_id, m.status]));
    res.json({ success: true, data: (staff || []).map((s) => ({ ...s, name: studentLabel(s), status: markOf[s.id] || null })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function hrAttendanceMark(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { date, entries } = req.body;
    if (!date || !Array.isArray(entries) || !entries.length) return res.status(400).json({ error: "date and entries[] are required" });
    const rows = entries.filter((e) => e.staff_id && e.status).map((e) => ({ school_id: school.id, staff_id: e.staff_id, date, status: e.status }));
    const { error } = await store.upsert("staff_attendance", rows, { onConflict: "staff_id,date" });
    if (error) throw new Error(error.message);
    res.json({ success: true, marked: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Payroll: generate a month's records from staff salaries.
export async function hrPayrollGenerate(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { month } = req.body;                      // 'YYYY-MM'
    if (!/^\d{4}-\d{2}$/.test(month || "")) return res.status(400).json({ error: "month must be YYYY-MM" });
    const { data: staff } = await store.select("staff", {
      columns: "id, monthly_salary",
      filters: [["eq", "school_id", school.id], ["eq", "status", "active"], ["gt", "monthly_salary", 0]],
    });
    if (!staff?.length) return res.json({ success: true, generated: 0, message: "No active salaried staff." });
    const { data: existing } = await store.select("payroll_records", {
      columns: "staff_id", filters: [["eq", "school_id", school.id], ["eq", "month", month]],
    });
    const done = new Set((existing || []).map((r) => r.staff_id));
    const rows = staff.filter((s) => !done.has(s.id)).map((s) => ({
      school_id: school.id, staff_id: s.id, month,
      gross: s.monthly_salary, deductions: 0, net: s.monthly_salary, status: "pending",
    }));
    if (rows.length) {
      const { error } = await store.insert("payroll_records", rows);
      if (error) throw new Error(error.message);
    }
    res.json({ success: true, generated: rows.length, skipped: done.size });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/* ═══════════════ Library ══════════════════════════════════════════════════ */

export async function libraryIssue(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { book_id, student_id, borrower_name, due_on } = req.body;
    if (!book_id) return res.status(400).json({ error: "book_id is required" });
    const { data: book } = await store.select("books", {
      columns: "id, copies_available", filters: [["eq", "id", book_id], ["eq", "school_id", school.id]], maybeSingle: true,
    });
    if (!book) return res.status(404).json({ error: "Book not found" });
    if (book.copies_available < 1) return res.status(400).json({ error: "No copies available" });
    const { data, error } = await store.insert("book_loans", {
      school_id: school.id, book_id, student_id: student_id || null,
      borrower_name: borrower_name || null, due_on: due_on || null, status: "issued",
    }, { columns: "*", single: true });
    if (error) throw new Error(error.message);
    await store.update("books", { copies_available: book.copies_available - 1 }, [["eq", "id", book_id]]);
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function libraryReturn(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: loan } = await store.select("book_loans", {
      columns: "id, book_id, status", filters: [["eq", "id", req.params.loanId], ["eq", "school_id", school.id]], maybeSingle: true,
    });
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    if (loan.status === "returned") return res.status(400).json({ error: "Already returned" });
    await store.update("book_loans", { status: "returned", returned_on: new Date().toISOString().slice(0, 10) }, [["eq", "id", loan.id]]);
    const { data: book } = await store.select("books", { columns: "copies_available", filters: [["eq", "id", loan.book_id]], maybeSingle: true });
    if (book) await store.update("books", { copies_available: book.copies_available + 1 }, [["eq", "id", loan.book_id]]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/* ═══════════════ Inventory ════════════════════════════════════════════════ */

async function adjustItemQty(schoolId, itemId, delta) {
  const { data: item } = await store.select("inventory_items", {
    columns: "quantity", filters: [["eq", "id", itemId], ["eq", "school_id", schoolId]], maybeSingle: true,
  });
  if (!item) return { error: "Item not found" };
  const next = Number(item.quantity || 0) + delta;
  if (next < 0) return { error: "Not enough stock" };
  await store.update("inventory_items", { quantity: next }, [["eq", "id", itemId]]);
  return { quantity: next };
}

export async function inventoryStock(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { item_id, quantity, unit_cost = 0, supplier_id, note } = req.body;
    if (!item_id || !Number(quantity)) return res.status(400).json({ error: "item_id and quantity are required" });
    const adj = await adjustItemQty(school.id, item_id, Number(quantity));
    if (adj.error) return res.status(400).json({ error: adj.error });
    const { data, error } = await store.insert("stock_entries", {
      school_id: school.id, item_id, quantity: Number(quantity), unit_cost, supplier_id: supplier_id || null, note: note || null,
    }, { columns: "*", single: true });
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data, newQuantity: adj.quantity });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function inventoryIssue(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { item_id, quantity, issued_to, purpose } = req.body;
    if (!item_id || !Number(quantity)) return res.status(400).json({ error: "item_id and quantity are required" });
    const adj = await adjustItemQty(school.id, item_id, -Number(quantity));
    if (adj.error) return res.status(400).json({ error: adj.error });
    const { data, error } = await store.insert("item_issues", {
      school_id: school.id, item_id, quantity: Number(quantity), issued_to: issued_to || null, purpose: purpose || null,
    }, { columns: "*", single: true });
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data, newQuantity: adj.quantity });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function inventorySale(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { item_id, quantity, unit_price, buyer } = req.body;
    if (!item_id || !Number(quantity)) return res.status(400).json({ error: "item_id and quantity are required" });
    const adj = await adjustItemQty(school.id, item_id, -Number(quantity));
    if (adj.error) return res.status(400).json({ error: adj.error });
    const price = Number(unit_price || 0);
    const { data, error } = await store.insert("pos_sales", {
      school_id: school.id, item_id, quantity: Number(quantity), unit_price: price,
      total: price * Number(quantity), buyer: buyer || null,
    }, { columns: "*", single: true });
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data, newQuantity: adj.quantity });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/* ═══════════════ Transport ════════════════════════════════════════════════ */

export async function transportLatestLocations(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: vehicles } = await store.select("vehicles", {
      columns: "id, plate_no, model, driver_name, status", filters: [["eq", "school_id", school.id]],
    });
    const { data: locs } = await store.select("vehicle_locations", {
      columns: "vehicle_id, location, note, reported_at",
      filters: [["eq", "school_id", school.id]], orderBy: "reported_at", asc: false, limit: 200,
    });
    const latest = {};
    for (const l of locs || []) if (!latest[l.vehicle_id]) latest[l.vehicle_id] = l;
    res.json({ success: true, data: (vehicles || []).map((v) => ({ ...v, last: latest[v.id] || null })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/* ═══════════════ Public portal admin ══════════════════════════════════════ */

// Admit an online application → creates the mgmt.students row and links it.
export async function admissionAdmit(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: app } = await store.select("admission_applications", {
      filters: [["eq", "id", req.params.id], ["eq", "school_id", school.id]], maybeSingle: true,
    });
    if (!app) return res.status(404).json({ error: "Application not found" });
    if (app.status === "admitted" && app.student_id) return res.status(409).json({ error: "Already admitted" });

    const admissionNo = (req.body.admission_no || "").trim() ||
      `ADM-${Date.now().toString(36).toUpperCase()}`;
    const { data: student, error } = await store.insert("students", {
      school_id: school.id, admission_no: admissionNo,
      first_name: app.first_name, last_name: app.last_name,
      gender: app.gender, dob: app.dob,
      class_id: req.body.class_id || null,
      guardian_name: app.guardian_name, guardian_phone: app.guardian_phone,
      guardian_email: app.email, address: app.address,
      status: "active", admitted_on: new Date().toISOString().slice(0, 10),
    }, { columns: "id, admission_no", single: true });
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "That admission number already exists" });
      throw new Error(error.message);
    }
    await store.update("admission_applications", {
      status: "admitted", student_id: student.id, reviewed_at: new Date(),
    }, [["eq", "id", app.id]]);
    res.status(201).json({ success: true, data: { student_id: student.id, admission_no: student.admission_no } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Generate result PINs for an exam.
export async function resultPinsGenerate(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { exam_id, class_id, max_uses = 10 } = req.body;
    if (!exam_id) return res.status(400).json({ error: "exam_id is required" });

    const filters = [["eq", "school_id", school.id], ["eq", "status", "active"]];
    if (class_id) filters.push(["eq", "class_id", class_id]);
    const { data: students } = await store.select("students", { columns: "id", filters });
    if (!students?.length) return res.json({ success: true, generated: 0, message: "No active students matched." });

    const { data: existing } = await store.select("result_pins", {
      columns: "student_id", filters: [["eq", "school_id", school.id], ["eq", "exam_id", exam_id]],
    });
    const has = new Set((existing || []).map((r) => r.student_id));
    const pinFor = () => crypto.randomBytes(4).toString("hex").toUpperCase().replace(/^(.{4})/, "$1-");
    const rows = students.filter((s) => !has.has(s.id)).map((s) => ({
      school_id: school.id, exam_id, student_id: s.id,
      pin: pinFor(), max_uses: Number(max_uses) || 10,
    }));
    if (!rows.length) return res.json({ success: true, generated: 0, message: "All matched students already have PINs for this exam." });
    const { error } = await store.insert("result_pins", rows);
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, generated: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/* ═══════════════ Website Builder: pages ═══════════════════════════════════ */

// Overrides the generic GET /site-pages so we can hide/soft-delete via
// deleted_at. Create/update/permanent-delete still use the generic routes.
export async function listSitePages(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const view = req.query.view || "active";           // active | trash | all
    const filters = [["eq", "school_id", school.id]];
    if (view === "active") filters.push(["is", "deleted_at", null]);
    else if (view === "trash") filters.push(["not", "deleted_at", "is", null]);
    if (req.query.status) filters.push(["eq", "status", req.query.status]);
    const { data, error } = await store.select("site_pages", {
      filters, orderBy: [["sort_order", true], ["created_at", false]],
    });
    if (error) throw new Error(error.message);
    res.json({ success: true, data: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function getSitePage(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data, error } = await store.select("site_pages", {
      filters: [["eq", "id", req.params.id], ["eq", "school_id", school.id]], maybeSingle: true,
    });
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: "Page not found" });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function trashSitePage(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { error } = await store.update("site_pages", { deleted_at: new Date() },
      [["eq", "id", req.params.id], ["eq", "school_id", school.id]]);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function restoreSitePage(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { error } = await store.update("site_pages", { deleted_at: null },
      [["eq", "id", req.params.id], ["eq", "school_id", school.id]]);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/* ═══════════════ Website Builder: media ═══════════════════════════════════ */

export async function uploadSiteMedia(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No files uploaded" });

    await ensureBucket();
    const created = [];
    for (const f of files) {
      const safe = (f.originalname || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
      const dest = `media/${school.id}/${Date.now()}-${crypto.randomBytes(3).toString("hex")}-${safe}`;
      const url = await uploadPublicFile(dest, f.buffer, f.mimetype || "application/octet-stream");
      const { data, error } = await store.insert("site_media", {
        school_id: school.id,
        title: (f.originalname || "Untitled").replace(/\.[^.]+$/, ""),
        media_type: mediaTypeOf(f.mimetype),
        url,
      }, { columns: "*", single: true });
      if (error) throw new Error(error.message);
      created.push(data);
    }
    res.status(201).json({ success: true, data: created });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Media list + trash, mirroring pages.
export async function listSiteMedia(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const view = req.query.view || "active";           // active | trash | all
    const filters = [["eq", "school_id", school.id]];
    if (view === "active") filters.push(["is", "deleted_at", null]);
    else if (view === "trash") filters.push(["not", "deleted_at", "is", null]);
    if (req.query.media_type) filters.push(["eq", "media_type", req.query.media_type]);
    const { data, error } = await store.select("site_media", {
      filters, orderBy: "created_at", asc: false,
    });
    if (error) throw new Error(error.message);
    res.json({ success: true, data: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function getSiteMedia(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data, error } = await store.select("site_media", {
      filters: [["eq", "id", req.params.id], ["eq", "school_id", school.id]], maybeSingle: true,
    });
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: "Media not found" });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function trashSiteMedia(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { error } = await store.update("site_media", { deleted_at: new Date() },
      [["eq", "id", req.params.id], ["eq", "school_id", school.id]]);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function restoreSiteMedia(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { error } = await store.update("site_media", { deleted_at: null },
      [["eq", "id", req.params.id], ["eq", "school_id", school.id]]);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
