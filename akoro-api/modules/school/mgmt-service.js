/**
 * modules/school/mgmt-service.js — request orchestration for the Management
 * dashboards, attendance registers, QR check-in and per-module settings.
 *
 * Who may act and which status/body is right lives here; every query is behind
 * mgmt-store.js and every pure normaliser is in mgmt-rules.js.
 */

import * as store from "./mgmt-store.js";

// Resolve the caller's school (first one they administer, else an approved
// teacher link). 404s if none.
export async function getMySchool(req, res) {
  // School admins own a school directly.
  const { data: owned } = await store.select("school_profiles", {
    schema: "public", columns: "id, name",
    filters: [["eq", "admin_user_id", req.user.id]],
    orderBy: "created_at", asc: true, limit: 1, maybeSingle: true,
  });
  if (owned) return owned;
  // A teacher approved into a school works within that school's context.
  const { data: link } = await store.select("school_teachers", {
    schema: "public", columns: "school_id",
    filters: [["eq", "teacher_id", req.user.id], ["eq", "status", "approved"]],
    orderBy: "created_at", asc: true, limit: 1, maybeSingle: true,
  });
  if (link) {
    const { data: sch } = await store.select("school_profiles", {
      schema: "public", columns: "id, name", filters: [["eq", "id", link.school_id]], maybeSingle: true,
    });
    if (sch) return sch;
  }
  res.status(404).json({ error: "No school is linked to this account." }); return null;
}

/* ═══════════════ Dashboards ═══════════════════════════════════════════════ */

export async function dashboard(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const count = (table, filters = []) => store.countRows(table, school.id, filters);
    const today = new Date().toISOString().slice(0, 10);
    let data;
    if (req.params.area === "students") {
      data = {
        total: await count("students"),
        active: await count("students", [["eq", "status", "active"]]),
        disabled: await count("students", [["eq", "is_disabled", true]]),
        houses: await count("student_houses"),
        categories: await count("student_categories"),
        presentToday: await count("student_attendance", [["eq", "date", today], ["eq", "status", "present"]]),
        absentToday: await count("student_attendance", [["eq", "date", today], ["eq", "status", "absent"]]),
        behaviorIncidents: await count("behavior_records"),
      };
    } else if (req.params.area === "academics") {
      data = {
        sessions: await count("academic_sessions"),
        classes: await count("classes"),
        sections: await count("sections"),
        subjects: await count("subjects"),
        periods: await count("periods"),
        timetableSlots: await count("timetable_slots"),
      };
    } else if (req.params.area === "finance") {
      const { data: pays } = await store.select("fee_payments", {
        columns: "amount, method, paid_on", filters: [["eq", "school_id", school.id]],
      });
      const { data: assigns } = await store.select("fee_assignments", {
        columns: "amount", filters: [["eq", "school_id", school.id]],
      });
      const collected = (pays || []).reduce((s, p) => s + Number(p.amount || 0), 0);
      const assigned = (assigns || []).reduce((s, a) => s + Number(a.amount || 0), 0);
      data = {
        collected, assigned, outstanding: Math.max(0, assigned - collected),
        transactions: (pays || []).length,
        onlineTransactions: (pays || []).filter((p) => p.method === "online").length,
        collectedToday: (pays || []).filter((p) => p.paid_on === today).reduce((s, p) => s + Number(p.amount || 0), 0),
        feeTypes: await count("fee_types"),
      };
    } else if (req.params.area === "front-office") {
      data = {
        enquiries: await count("enquiries"),
        openEnquiries: await count("enquiries", [["eq", "status", "new"]]),
        visitorsToday: await count("visitors", [["gte", "check_in", `${today}T00:00:00Z`]]),
        openComplaints: await count("complaints", [["neq", "status", "resolved"]]),
        postalRecords: await count("postal_records"),
      };
    } else if (req.params.area === "accounts") {
      const { data: inc } = await store.select("incomes", { columns: "amount", filters: [["eq", "school_id", school.id]] });
      const { data: exp } = await store.select("expenses", { columns: "amount", filters: [["eq", "school_id", school.id]] });
      const totalIncome = (inc || []).reduce((s, r) => s + Number(r.amount || 0), 0);
      const totalExpense = (exp || []).reduce((s, r) => s + Number(r.amount || 0), 0);
      data = {
        totalIncome, totalExpense, netBalance: totalIncome - totalExpense,
        incomeEntries: (inc || []).length, expenseEntries: (exp || []).length,
        bankAccounts: await count("bank_accounts"),
      };
    } else if (req.params.area === "hr") {
      data = {
        staff: await count("staff"),
        activeStaff: await count("staff", [["eq", "status", "active"]]),
        departments: await count("departments"),
        pendingLeaves: await count("leave_requests", [["eq", "status", "pending"]]),
        presentToday: await count("staff_attendance", [["eq", "date", today], ["eq", "status", "present"]]),
        activeLoans: await count("staff_loans", [["eq", "status", "active"]]),
        pendingPayroll: await count("payroll_records", [["eq", "status", "pending"]]),
      };
    } else if (req.params.area === "exams") {
      data = {
        exams: await count("exams"),
        upcoming: await count("exams", [["eq", "status", "upcoming"]]),
        schedules: await count("exam_schedules"),
        marksEntered: await count("exam_marks"),
        examTypes: await count("exam_types"),
        uploads: await count("marksheet_uploads"),
      };
    } else if (req.params.area === "cbc") {
      const levels = {};
      for (const l of ["exceeding", "meeting", "approaching", "below"]) {
        levels[l] = await count("cbc_assessments", [["eq", "level", l]]);
      }
      data = {
        strands: await count("cbc_strands"),
        assessments: await count("cbc_assessments"),
        competencies: await count("core_competencies"),
        pathways: await count("cbc_pathways"),
        ...levels,
      };
    } else if (req.params.area === "ptm") {
      data = {
        meetings: await count("ptm_meetings"),
        scheduled: await count("ptm_meetings", [["eq", "status", "scheduled"]]),
        attendanceRecords: await count("ptm_attendance"),
        attended: await count("ptm_attendance", [["eq", "attended", true]]),
        openFollowups: await count("ptm_followups", [["eq", "status", "open"]]),
      };
    } else if (req.params.area === "lesson-planner") {
      const byStatus = {};
      for (const s of ["draft", "submitted", "approved", "rejected"]) {
        byStatus[s] = await count("lesson_plans", [["eq", "status", s]]);
      }
      data = { plans: await count("lesson_plans"), ...byStatus };
    } else if (req.params.area === "osm") {
      const { data: evals } = await store.select("osm_evaluations", {
        columns: "score", filters: [["eq", "school_id", school.id], ["not", "score", "is", null]],
      });
      const avg = evals?.length ? Math.round(evals.reduce((s, e) => s + Number(e.score), 0) / evals.length) : 0;
      data = {
        sessions: await count("osm_sessions"),
        completed: await count("osm_sessions", [["eq", "status", "completed"]]),
        evaluations: await count("osm_evaluations"),
        pendingModeration: await count("osm_evaluations", [["eq", "status", "pending"]]),
        averageScore: avg,
      };
    } else if (req.params.area === "study-center") {
      data = {
        syllabusItems: await count("syllabus_items"),
        syllabusCovered: await count("syllabus_items", [["eq", "status", "covered"]]),
        classworkLogs: await count("classwork_logs"),
        resources: await count("learning_resources"),
        openHomework: await count("homework_assignments", [["eq", "status", "open"]]),
        liveClasses: await count("live_classes", [["neq", "status", "ended"]]),
      };
    } else if (req.params.area === "library") {
      const { data: books } = await store.select("books", {
        columns: "copies_total, copies_available", filters: [["eq", "school_id", school.id]],
      });
      data = {
        titles: (books || []).length,
        totalCopies: (books || []).reduce((s, b) => s + (b.copies_total || 0), 0),
        availableCopies: (books || []).reduce((s, b) => s + (b.copies_available || 0), 0),
        activeLoans: await count("book_loans", [["eq", "status", "issued"]]),
        categories: await count("book_categories"),
      };
    } else if (req.params.area === "inventory") {
      const { data: items } = await store.select("inventory_items", {
        columns: "quantity, reorder_level, unit_price", filters: [["eq", "school_id", school.id]],
      });
      const { data: sales } = await store.select("pos_sales", {
        columns: "total", filters: [["eq", "school_id", school.id]],
      });
      data = {
        items: (items || []).length,
        lowStock: (items || []).filter((i) => Number(i.quantity) <= Number(i.reorder_level)).length,
        stockValue: (items || []).reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0),
        salesTotal: (sales || []).reduce((s, r) => s + Number(r.total || 0), 0),
        suppliers: await count("inventory_suppliers"),
        openOrders: await count("purchase_orders", [["in", "status", ["draft", "ordered"]]]),
      };
    } else if (req.params.area === "transport") {
      data = {
        vehicles: await count("vehicles"),
        activeVehicles: await count("vehicles", [["eq", "status", "active"]]),
        routes: await count("transport_routes"),
        locationReports: await count("vehicle_locations"),
      };
    } else if (req.params.area === "hostel") {
      const { data: rooms } = await store.select("hostel_rooms", {
        columns: "capacity", filters: [["eq", "school_id", school.id]],
      });
      data = {
        hostels: await count("hostels"),
        rooms: (rooms || []).length,
        capacity: (rooms || []).reduce((s, r) => s + (r.capacity || 0), 0),
        allocated: await count("hostel_allocations", [["eq", "status", "active"]]),
        roomTypes: await count("room_types"),
      };
    } else if (req.params.area === "assets") {
      const { data: assets } = await store.select("assets", {
        columns: "purchase_cost, status", filters: [["eq", "school_id", school.id]],
      });
      data = {
        assets: (assets || []).length,
        inUse: (assets || []).filter((a) => a.status === "in_use").length,
        underMaintenance: (assets || []).filter((a) => a.status === "maintenance").length,
        disposed: (assets || []).filter((a) => a.status === "disposed").length,
        totalCost: (assets || []).reduce((s, a) => s + Number(a.purchase_cost || 0), 0),
        openAudits: await count("asset_audits", [["eq", "status", "open"]]),
      };
    } else return res.status(404).json({ error: "Unknown dashboard area" });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/* ═══════════════ Attendance ═══════════════════════════════════════════════ */

// Attendance register: students of a class/section + that day's marks.
export async function attendanceRegister(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { class_id, section_id, date } = req.query;
    if (!class_id || !date) return res.status(400).json({ error: "class_id and date are required" });
    const filters = [["eq", "school_id", school.id], ["eq", "class_id", class_id], ["eq", "status", "active"]];
    if (section_id) filters.push(["eq", "section_id", section_id]);
    const { data: students } = await store.select("students", {
      columns: "id, admission_no, roll_no, first_name, last_name",
      filters, orderBy: "roll_no", asc: true,
    });
    const ids = (students || []).map((s) => s.id);
    const { data: marks } = ids.length
      ? await store.select("student_attendance", {
        columns: "student_id, status, note",
        filters: [["eq", "date", date], ["in", "student_id", ids]],
      })
      : { data: [] };
    const markOf = Object.fromEntries((marks || []).map((m) => [m.student_id, m]));
    res.json({ success: true, data: (students || []).map((s) => ({
      ...s, name: [s.first_name, s.last_name].filter(Boolean).join(" "), status: markOf[s.id]?.status || null, note: markOf[s.id]?.note || null,
    })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Mark attendance (bulk upsert).
export async function attendanceMark(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { date, entries } = req.body;
    if (!date || !Array.isArray(entries) || !entries.length) return res.status(400).json({ error: "date and entries[] are required" });
    const rows = entries.filter((e) => e.student_id && e.status).map((e) => ({
      school_id: school.id, student_id: e.student_id, date, status: e.status, note: e.note || null,
    }));
    const { error } = await store.upsert("student_attendance", rows, { onConflict: "student_id,date" });
    if (error) throw new Error(error.message);
    res.json({ success: true, marked: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Attendance register: whole-class marking in one screen.
export async function attendanceRoster(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { class_id, section_id, date } = req.query;
    if (!class_id || !date) return res.status(400).json({ error: "class_id and date are required" });
    const filters = [["eq", "school_id", school.id], ["eq", "class_id", class_id], ["eq", "status", "active"]];
    if (section_id) filters.push(["eq", "section_id", section_id]);
    const { data: students } = await store.select("students", {
      columns: "id, admission_no, roll_no, first_name, last_name", filters,
    });
    const rows = students || [];
    rows.sort((a, b) => String(a.roll_no || a.admission_no || "").localeCompare(String(b.roll_no || b.admission_no || ""), undefined, { numeric: true }));
    const ids = rows.map((s) => s.id);
    let byStudent = {};
    if (ids.length) {
      const { data: att } = await store.select("student_attendance", {
        columns: "student_id, status, note",
        filters: [["eq", "date", date], ["in", "student_id", ids]],
      });
      byStudent = Object.fromEntries((att || []).map((a) => [a.student_id, a]));
    }
    res.json({ success: true, data: rows.map((s) => ({
      student_id: s.id, admission_no: s.admission_no, roll_no: s.roll_no,
      name: [s.first_name, s.last_name].filter(Boolean).join(" "),
      status: byStudent[s.id]?.status || null, note: byStudent[s.id]?.note || "",
    })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Mark attendance from a roster payload { date, records[] }.
export async function attendanceMarkRecords(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { date, records } = req.body;
    if (!date || !Array.isArray(records)) return res.status(400).json({ error: "date and records[] are required" });
    const VALID = new Set(["present", "absent", "late", "excused"]);
    let saved = 0;
    for (const r of records) {
      if (!r.student_id || !VALID.has(r.status)) continue;
      const { data: ex } = await store.select("student_attendance", {
        columns: "id",
        filters: [["eq", "student_id", r.student_id], ["eq", "date", date]], maybeSingle: true,
      });
      if (ex) await store.update("student_attendance", { status: r.status, note: r.note || null }, [["eq", "id", ex.id]]);
      else await store.insert("student_attendance", { school_id: school.id, student_id: r.student_id, date, status: r.status, note: r.note || null });
      saved++;
    }
    res.json({ success: true, saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/* ═══════════════ QR check-in ══════════════════════════════════════════════ */

export async function qrCheckin(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { person_type = "staff", staff_id, student_id, person_name, direction = "in", method = "manual" } = req.body;
    if (!person_name && !staff_id && !student_id) return res.status(400).json({ error: "person_name (or a staff/student id) is required" });
    const { data, error } = await store.insert("qr_attendance_events", {
      school_id: school.id, person_type, staff_id: staff_id || null, student_id: student_id || null,
      person_name: person_name || null, direction, method,
    }, { columns: "*", single: true });
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/* ═══════════════ Per-module settings ══════════════════════════════════════ */

export async function getModuleSettings(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await store.select("module_settings", {
      columns: "settings",
      filters: [["eq", "school_id", school.id], ["eq", "module", req.params.module]], maybeSingle: true,
    });
    res.json({ success: true, data: data?.settings || {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function putModuleSettings(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { error } = await store.upsert("module_settings", {
      school_id: school.id, module: req.params.module, settings: req.body || {}, updated_at: new Date(),
    }, { onConflict: "school_id,module" });
    if (error) throw new Error(error.message);
    res.json({ success: true, data: req.body || {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
