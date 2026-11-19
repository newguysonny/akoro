/**
 * modules/school/mgmt-service-students.js — students, their profile views and
 * fee collection for the Management API.
 */

import crypto from "crypto";
import bcrypt from "bcrypt";
import * as store from "./mgmt-store.js";
import { RESOURCES, isSchoolAdmin, studentLabel } from "./mgmt-rules.js";
import { getMySchool } from "./mgmt-service.js";

// ── Fee dues: assigned − paid per student ─────────────────────────────────
export async function computeDues(schoolId, { student_id, class_id } = {}) {
  const filters = [["eq", "school_id", schoolId], ["eq", "status", "active"]];
  if (student_id) filters.push(["eq", "id", student_id]);
  if (class_id) filters.push(["eq", "class_id", class_id]);
  const { data: students } = await store.select("students", {
    columns: "id, admission_no, first_name, last_name, class_id", filters,
  });
  if (!students?.length) return [];
  const { data: assigns } = await store.select("fee_assignments", {
    columns: "id, class_id, student_id, amount, fee_type_id", filters: [["eq", "school_id", schoolId]],
  });
  const { data: pays } = await store.select("fee_payments", {
    columns: "student_id, amount", filters: [["eq", "school_id", schoolId]],
  });
  const paidOf = {};
  for (const p of pays || []) paidOf[p.student_id] = (paidOf[p.student_id] || 0) + Number(p.amount || 0);
  return students.map((s) => {
    const assigned = (assigns || [])
      .filter((a) => a.student_id === s.id || (a.class_id && a.class_id === s.class_id && !a.student_id))
      .reduce((sum, a) => sum + Number(a.amount || 0), 0);
    const paid = paidOf[s.id] || 0;
    return { student_id: s.id, admission_no: s.admission_no, name: studentLabel(s), assigned, paid, due: Math.max(0, assigned - paid) };
  });
}

export async function feesDues(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const rows = await computeDues(school.id, { student_id: req.query.student_id, class_id: req.query.class_id });
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Promote students (bulk move class → class).
export async function studentsPromote(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { from_class_id, to_class_id, session_id, student_ids } = req.body;
    if (!from_class_id || !to_class_id) return res.status(400).json({ error: "from_class_id and to_class_id are required" });
    const filters = [["eq", "school_id", school.id], ["eq", "class_id", from_class_id]];
    const hasIds = Array.isArray(student_ids) && student_ids.length;
    if (hasIds) filters.push(["in", "id", student_ids]);
    const { data, error } = await store.update("students", { class_id: to_class_id, section_id: null }, filters, { columns: "id" });
    if (error) throw new Error(error.message);
    await store.insert("promotion_logs", {
      school_id: school.id, from_class_id, to_class_id, session_id: session_id || null, student_count: (data || []).length,
    });
    res.json({ success: true, promoted: (data || []).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Assign students to a class (bulk, no from-class needed).
export async function studentsAssignClass(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { to_class_id, section_id, student_ids } = req.body;
    if (!to_class_id) return res.status(400).json({ error: "to_class_id is required" });
    if (!Array.isArray(student_ids) || !student_ids.length) return res.status(400).json({ error: "student_ids[] is required" });
    const { data, error } = await store.update("students",
      { class_id: to_class_id, section_id: section_id || null },
      [["eq", "school_id", school.id], ["in", "id", student_ids]], { columns: "id" });
    if (error) throw new Error(error.message);
    res.json({ success: true, assigned: (data || []).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Student List — students joined with class/section names + fee dues.
export async function studentsList(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const filters = [["eq", "school_id", school.id]];
    if (req.query.class_id) filters.push(["eq", "class_id", req.query.class_id]);
    if (req.query.section_id) filters.push(["eq", "section_id", req.query.section_id]);
    if (req.query.status) filters.push(["eq", "status", req.query.status]);
    else filters.push(["eq", "status", "active"]);
    const { data: students, error } = await store.select("students", {
      filters, orderBy: "created_at", asc: false,
    });
    if (error) throw new Error(error.message);
    const rows = await store.attachRefs(RESOURCES.students, students || [], school.id);

    const { data: assigns } = await store.select("fee_assignments", {
      columns: "class_id, student_id, amount", filters: [["eq", "school_id", school.id]],
    });
    const { data: pays } = await store.select("fee_payments", {
      columns: "student_id, amount", filters: [["eq", "school_id", school.id]],
    });
    const paidOf = {};
    for (const p of pays || []) paidOf[p.student_id] = (paidOf[p.student_id] || 0) + Number(p.amount || 0);

    const data = rows.map((s) => {
      const assigned = (assigns || [])
        .filter((a) => a.student_id === s.id || (a.class_id && a.class_id === s.class_id && !a.student_id))
        .reduce((sum, a) => sum + Number(a.amount || 0), 0);
      const paid = paidOf[s.id] || 0;
      return { ...s, name: studentLabel(s), fee_assigned: assigned, fee_paid: paid, fee_due: Math.max(0, assigned - paid) };
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Single student profile: record + fees + attendance summary.
export async function studentProfile(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: student } = await store.select("students", {
      filters: [["eq", "id", req.params.id], ["eq", "school_id", school.id]], maybeSingle: true,
    });
    if (!student) return res.status(404).json({ error: "Student not found" });
    const [row] = await store.attachRefs(RESOURCES.students, [student], school.id);

    const [dues, { data: attRows }] = await Promise.all([
      computeDues(school.id, { student_id: student.id }),
      store.select("student_attendance", {
        columns: "status", filters: [["eq", "school_id", school.id], ["eq", "student_id", student.id]],
      }),
    ]);
    const present = (attRows || []).filter((a) => a.status === "present").length;
    const absent = (attRows || []).filter((a) => a.status === "absent").length;
    const late = (attRows || []).filter((a) => a.status === "late").length;

    // Never expose password hashes — only whether one has been set.
    const { student_password_hash, parent_password_hash, ...safeRow } = row;
    res.json({
      success: true,
      data: {
        ...safeRow, name: studentLabel(student),
        hasStudentPassword: !!student_password_hash, hasParentPassword: !!parent_password_hash,
        // A pupil's fee totals are the school admin's, not their teacher's.
        ...(isSchoolAdmin(req) ? { fees: dues[0] || { assigned: 0, paid: 0, due: 0 } } : {}),
        attendance: { present, absent, late, total: (attRows || []).length },
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Credentials — regenerate the student/parent portal password.
export async function studentCredentialsRegenerate(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const target = req.body.target === "parent" ? "parent" : "student";
    const { data: student } = await store.select("students", {
      filters: [["eq", "id", req.params.id], ["eq", "school_id", school.id]], maybeSingle: true,
    });
    if (!student) return res.status(404).json({ error: "Student not found" });

    const password = crypto.randomBytes(6).toString("base64").replace(/[+/=]/g, "").slice(0, 8);
    const hash = await bcrypt.hash(password, 10);
    const patch = {};
    if (target === "student") {
      patch.student_username = student.student_username || `S${student.admission_no}`.replace(/\s+/g, "");
      patch.student_password_hash = hash;
    } else {
      patch.parent_username = student.parent_username || `P${(student.guardian_phone || student.admission_no || "").replace(/\D/g, "")}`;
      patch.parent_password_hash = hash;
    }
    const { error } = await store.update("students", patch, [["eq", "id", student.id]]);
    if (error) throw new Error(error.message);
    res.json({ success: true, username: patch.student_username || patch.parent_username, password });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Fees: assigned/collected/concession/balance + grouped, itemised rows.
export async function studentFees(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: student } = await store.select("students", {
      columns: "id, class_id", filters: [["eq", "id", req.params.id], ["eq", "school_id", school.id]], maybeSingle: true,
    });
    if (!student) return res.status(404).json({ error: "Student not found" });

    const [{ data: assigns }, { data: types }, { data: groups }, { data: discounts }, { data: sessions }, { data: pays }] = await Promise.all([
      store.select("fee_assignments", { columns: "id, session_id, fee_type_id, class_id, student_id, amount, due_date, discount_id", filters: [["eq", "school_id", school.id]] }),
      store.select("fee_types", { columns: "id, name, group_id", filters: [["eq", "school_id", school.id]] }),
      store.select("fee_groups", { columns: "id, name", filters: [["eq", "school_id", school.id]] }),
      store.select("fee_discounts", { columns: "id, discount_type, amount", filters: [["eq", "school_id", school.id]] }),
      store.select("academic_sessions", { columns: "id, name", filters: [["eq", "school_id", school.id]] }),
      store.select("fee_payments", { columns: "id, assignment_id, amount", filters: [["eq", "school_id", school.id], ["eq", "student_id", student.id]] }),
    ]);
    const typeOf = Object.fromEntries((types || []).map((t) => [t.id, t]));
    const groupName = Object.fromEntries((groups || []).map((g) => [g.id, g.name]));
    const discountOf = Object.fromEntries((discounts || []).map((d) => [d.id, d]));
    const sessionName = Object.fromEntries((sessions || []).map((s) => [s.id, s.name]));
    const paidByAssignment = {};
    let collected = 0;
    for (const p of pays || []) { collected += Number(p.amount || 0); if (p.assignment_id) paidByAssignment[p.assignment_id] = (paidByAssignment[p.assignment_id] || 0) + Number(p.amount || 0); }

    const mine = (assigns || []).filter((a) => a.student_id === student.id || (a.class_id && a.class_id === student.class_id && !a.student_id));
    const groupsMap = {};
    let assigned = 0, concessionTotal = 0;
    for (const a of mine) {
      const amount = Number(a.amount || 0);
      const disc = a.discount_id ? discountOf[a.discount_id] : null;
      const concession = disc ? (disc.discount_type === "percentage" ? amount * Number(disc.amount || 0) / 100 : Math.min(amount, Number(disc.amount || 0))) : 0;
      const paid = paidByAssignment[a.id] || 0;
      const due = Math.max(0, amount - concession - paid);
      const status = due <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
      assigned += amount; concessionTotal += concession;

      const type = typeOf[a.fee_type_id];
      const gName = type?.group_id ? (groupName[type.group_id] || "General Fees") : "General Fees";
      const sName = a.session_id ? (sessionName[a.session_id] || "") : "";
      const key = `${gName}::${sName}`;
      if (!groupsMap[key]) groupsMap[key] = { title: [gName, sName].filter(Boolean).join(" "), total: 0, due: 0, unpaidCount: 0, rows: [] };
      groupsMap[key].total += amount; groupsMap[key].due += due;
      if (status !== "paid") groupsMap[key].unpaidCount++;
      groupsMap[key].rows.push({ id: a.id, fee_type_name: type?.name || "Fee", due_date: a.due_date, amount, concession, paid, due, status });
    }
    const balance = Math.max(0, assigned - concessionTotal - collected);
    res.json({
      success: true,
      data: {
        assigned, collected, concession: concessionTotal, fine: 0, balance,
        percentCollected: assigned > 0 ? Math.round((collected / assigned) * 100) : 0,
        groups: Object.values(groupsMap),
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Behavior summary: +/- score, positive/negative counts, current-session log.
export async function studentBehaviorSummary(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: session } = await store.select("academic_sessions", {
      columns: "starts_on, ends_on",
      filters: [["eq", "school_id", school.id], ["eq", "is_active", true]], maybeSingle: true,
    });
    const { data: all } = await store.select("behavior_records", {
      filters: [["eq", "school_id", school.id], ["eq", "student_id", req.params.id]],
      orderBy: "recorded_on", asc: false,
    });
    let current = all || [];
    if (session?.starts_on) current = current.filter((r) => r.recorded_on >= session.starts_on && (!session.ends_on || r.recorded_on <= session.ends_on));
    const score = current.reduce((s, r) => s + (r.polarity === "positive" ? Number(r.points || 1) : -Number(r.points || 1)), 0);
    const positive = current.filter((r) => r.polarity === "positive").length;
    const negative = current.filter((r) => r.polarity === "negative").length;
    res.json({ success: true, data: { score, positive, negative, records: current, hasActiveSession: !!session } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Transport & hostel summary for a student.
export async function studentTransport(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const baseFilters = [["eq", "school_id", school.id], ["eq", "student_id", req.params.id], ["eq", "status", "active"]];
    const { data: transport } = await store.select("student_transport", {
      columns: "id, pickup_point, fee, status, route_id, vehicle_id", filters: baseFilters, maybeSingle: true,
    });
    const { data: hostel } = await store.select("hostel_allocations", {
      columns: "id, allocated_on, room_id", filters: baseFilters, maybeSingle: true,
    });

    let route = null, vehicle = null, room = null;
    if (transport?.route_id) { const { data } = await store.select("transport_routes", { columns: "name, start_point, end_point", filters: [["eq", "id", transport.route_id]], maybeSingle: true }); route = data; }
    if (transport?.vehicle_id) { const { data } = await store.select("vehicles", { columns: "plate_no, driver_name, driver_phone", filters: [["eq", "id", transport.vehicle_id]], maybeSingle: true }); vehicle = data; }
    if (hostel?.room_id) {
      const { data: r } = await store.select("hostel_rooms", { columns: "room_no, hostel_id", filters: [["eq", "id", hostel.room_id]], maybeSingle: true });
      room = r;
      if (r?.hostel_id) { const { data: h } = await store.select("hostels", { columns: "name", filters: [["eq", "id", r.hostel_id]], maybeSingle: true }); if (h) room = { ...room, hostel_name: h.name }; }
    }
    res.json({
      success: true,
      data: {
        transport: transport ? { ...transport, route_name: route?.name || null, vehicle_plate: vehicle?.plate_no || null, driver_name: vehicle?.driver_name || null, driver_phone: vehicle?.driver_phone || null } : null,
        hostel: hostel ? { ...hostel, room_no: room?.room_no || null, hostel_name: room?.hostel_name || null } : null,
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Attendance for one month (calendar view).
export async function studentAttendance(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : new Date().toISOString().slice(0, 7);
    const from = `${month}-01`;
    const to = new Date(new Date(`${from}T00:00:00Z`).getFullYear(), new Date(`${from}T00:00:00Z`).getMonth() + 1, 0).toISOString().slice(0, 10);
    const { data } = await store.select("student_attendance", {
      columns: "date, status, note",
      filters: [["eq", "school_id", school.id], ["eq", "student_id", req.params.id], ["gte", "date", from], ["lte", "date", to]],
      orderBy: "date", asc: true,
    });
    const byDate = Object.fromEntries((data || []).map((d) => [d.date, d]));
    res.json({
      success: true,
      data: {
        month,
        records: byDate,
        stats: {
          present: (data || []).filter((d) => d.status === "present").length,
          absent: (data || []).filter((d) => d.status === "absent").length,
          late: (data || []).filter((d) => d.status === "late").length,
          excused: (data || []).filter((d) => d.status === "excused").length,
        },
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Exams: list exams with marks for this student.
export async function studentExams(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: student } = await store.select("students", {
      columns: "id, class_id", filters: [["eq", "id", req.params.id], ["eq", "school_id", school.id]], maybeSingle: true,
    });
    if (!student) return res.status(404).json({ error: "Student not found" });

    const { data: scheds } = student.class_id
      ? await store.select("exam_schedules", {
        columns: "id, exam_id", filters: [["eq", "school_id", school.id], ["eq", "class_id", student.class_id]],
      })
      : { data: [] };
    const schedIds = (scheds || []).map((s) => s.id);
    const { data: marks } = schedIds.length
      ? await store.select("exam_marks", {
        columns: "schedule_id",
        filters: [["eq", "student_id", student.id], ["in", "schedule_id", schedIds]],
      })
      : { data: [] };
    const markedSchedIds = new Set((marks || []).map((m) => m.schedule_id));
    const examIds = [...new Set((scheds || []).filter((s) => markedSchedIds.has(s.id)).map((s) => s.exam_id))];
    const { data: exams } = examIds.length
      ? await store.select("exams", { columns: "id, name", filters: [["in", "id", examIds]] })
      : { data: [] };

    const { data: uploads } = student.class_id
      ? await store.select("marksheet_uploads", {
        columns: "id, title, file_url, note, created_at",
        filters: [["eq", "school_id", school.id], ["eq", "class_id", student.class_id]],
        orderBy: "created_at", asc: false,
      })
      : { data: [] };

    res.json({ success: true, data: { exams: exams || [], uploads: uploads || [] } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// One exam's scores for this student.
export async function studentExamDetail(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: student } = await store.select("students", {
      columns: "id, class_id", filters: [["eq", "id", req.params.id], ["eq", "school_id", school.id]], maybeSingle: true,
    });
    if (!student) return res.status(404).json({ error: "Student not found" });
    const { data: scheds } = await store.select("exam_schedules", {
      columns: "id, subject_id, max_marks, pass_marks",
      filters: [["eq", "school_id", school.id], ["eq", "exam_id", req.params.examId], ["eq", "class_id", student.class_id]],
    });
    if (!scheds?.length) return res.json({ success: true, data: { subjects: [], total: 0, maxTotal: 0, percent: 0 } });
    const subjIds = scheds.map((s) => s.subject_id);
    const { data: subjects } = await store.select("subjects", {
      columns: "id, name", filters: [["eq", "school_id", school.id], ["in", "id", subjIds]],
    });
    const subjName = Object.fromEntries((subjects || []).map((s) => [s.id, s.name]));
    const { data: marks } = await store.select("exam_marks", {
      columns: "schedule_id, marks",
      filters: [["eq", "student_id", student.id], ["in", "schedule_id", scheds.map((s) => s.id)]],
    });
    const markOf = Object.fromEntries((marks || []).map((m) => [m.schedule_id, Number(m.marks)]));
    const { data: remark } = await store.select("teacher_remarks", {
      columns: "remark",
      filters: [["eq", "school_id", school.id], ["eq", "student_id", student.id], ["eq", "exam_id", req.params.examId]], maybeSingle: true,
    });

    let total = 0, maxTotal = 0;
    const subjectRows = scheds.map((s) => {
      const score = markOf[s.id]; const max = Number(s.max_marks || 100);
      if (score !== undefined) total += score;
      maxTotal += max;
      return { subject: subjName[s.subject_id] || "?", score: score ?? null, max, pass: s.pass_marks != null && score !== undefined ? score >= Number(s.pass_marks) : null };
    });
    res.json({ success: true, data: { subjects: subjectRows, total, maxTotal, percent: maxTotal ? Math.round((total / maxTotal) * 100) : 0, remark: remark?.remark || null } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Admission wizard: suggest the next admission number + roll number.
export async function studentsNextCodes(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: rows } = await store.select("students", {
      columns: "admission_no, roll_no, class_id", filters: [["eq", "school_id", school.id]],
    });
    const all = rows || [];
    const maxAdm = all.reduce((max, r) => {
      const n = parseInt(String(r.admission_no || "").replace(/\D/g, ""), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    const classId = req.query.class_id || null;
    const rollPool = classId ? all.filter((r) => r.class_id === classId) : all;
    const maxRoll = rollPool.reduce((max, r) => {
      const n = parseInt(String(r.roll_no || "").replace(/\D/g, ""), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    res.json({ success: true, data: { admission_no: String(maxAdm + 1), roll_no: String(maxRoll + 1) } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Admission wizard: assign fee groups (+ optional opening balance).
export async function studentAssignFeeGroups(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: student } = await store.select("students", {
      columns: "id", filters: [["eq", "id", req.params.id], ["eq", "school_id", school.id]], maybeSingle: true,
    });
    if (!student) return res.status(404).json({ error: "Student not found" });

    const groupIds = Array.isArray(req.body.group_ids) ? req.body.group_ids : [];
    const openingBalance = Number(req.body.opening_balance) || 0;
    const { data: session } = await store.select("academic_sessions", {
      columns: "id", filters: [["eq", "school_id", school.id], ["eq", "is_active", true]], maybeSingle: true,
    });
    const sessionId = session?.id || null;

    const rows = [];
    if (groupIds.length) {
      const { data: types } = await store.select("fee_types", {
        columns: "id, default_amount, group_id",
        filters: [["eq", "school_id", school.id], ["in", "group_id", groupIds]],
      });
      for (const t of types || []) rows.push({ school_id: school.id, student_id: student.id, fee_type_id: t.id, amount: Number(t.default_amount) || 0, session_id: sessionId });
    }
    if (openingBalance > 0) {
      let { data: obType } = await store.select("fee_types", {
        columns: "id", filters: [["eq", "school_id", school.id], ["eq", "name", "Opening Due Balance"]], maybeSingle: true,
      });
      if (!obType) {
        const { data: created, error: ctErr } = await store.insert("fee_types",
          { school_id: school.id, name: "Opening Due Balance" }, { columns: "id", single: true });
        if (ctErr) throw new Error(ctErr.message);
        obType = created;
      }
      rows.push({ school_id: school.id, student_id: student.id, fee_type_id: obType.id, amount: openingBalance, session_id: sessionId });
    }

    let assigned = 0;
    if (rows.length) {
      const { error } = await store.insert("fee_assignments", rows);
      if (error) throw new Error(error.message);
      assigned = rows.length;
    }
    res.json({ success: true, assigned });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Collect a fee payment.
export async function feesCollect(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { student_id, assignment_id, amount, method = "cash", reference, note } = req.body;
    if (!student_id || !amount) return res.status(400).json({ error: "student_id and amount are required" });
    const { data, error } = await store.insert("fee_payments", {
      school_id: school.id, student_id, assignment_id: assignment_id || null,
      amount, method, reference: reference || `RCPT-${Date.now().toString(36).toUpperCase()}`,
      note: note || null, received_by: req.user.fullName || req.user.email,
    }, { columns: "*", single: true });
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Generate due slips for a class (one per student with a balance).
export async function feesDueSlipsGenerate(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { class_id, period_label } = req.body;
    if (!class_id) return res.status(400).json({ error: "class_id is required" });
    const dues = (await computeDues(school.id, { class_id })).filter((d) => d.due > 0);
    if (!dues.length) return res.json({ success: true, generated: 0, message: "No outstanding dues in that class." });
    const stamp = Date.now().toString(36).toUpperCase();
    const rows = dues.map((d, i) => ({
      school_id: school.id, student_id: d.student_id, slip_no: `DS-${stamp}-${i + 1}`,
      period_label: period_label || null, amount_due: d.due,
    }));
    const { error } = await store.insert("due_slips", rows);
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, generated: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Carry unpaid balances into a new session.
export async function feesCarryForward(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { from_session_id, to_session_id } = req.body;
    if (!from_session_id || !to_session_id) return res.status(400).json({ error: "from_session_id and to_session_id are required" });
    const dues = (await computeDues(school.id)).filter((d) => d.due > 0);
    if (!dues.length) return res.json({ success: true, carried: 0, message: "No outstanding balances to carry forward." });
    const { error } = await store.insert("fee_carry_forwards", dues.map((d) => ({
      school_id: school.id, student_id: d.student_id, from_session_id, to_session_id, amount: d.due,
    })));
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, carried: dues.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Bulk delete students.
export async function studentsBulkDelete(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: "ids[] is required" });
    const { error } = await store.remove("students", [["eq", "school_id", school.id], ["in", "id", ids]]);
    if (error) throw new Error(error.message);
    res.json({ success: true, deleted: ids.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Bulk status/class update.
export async function studentsBulkUpdate(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: "ids[] is required" });
    const allowed = ["class_id", "section_id", "status", "category_id", "house_id"];
    const patch = {};
    for (const k of allowed) if (req.body[k] !== undefined && req.body[k] !== "") patch[k] = req.body[k];
    if (!Object.keys(patch).length) return res.status(400).json({ error: "No fields to update" });
    const { error } = await store.update("students", patch, [["eq", "school_id", school.id], ["in", "id", ids]]);
    if (error) throw new Error(error.message);
    res.json({ success: true, updated: ids.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
