/**
 * modules/school/mgmt-rules.js — pure constants, predicates and normalisers
 * for the Management + Facilities & Services API.
 *
 * No database import, no Express import. The resource registry and the
 * read/write allowlists live here because they are data, not queries.
 */

import { SCHOOL_ROLES } from "./rules.js";

export { SCHOOL_ROLES };

export const MGMT_ROLES = [...SCHOOL_ROLES, "instructor"];
export const isSchoolAdmin = (req) => SCHOOL_ROLES.includes(req.user?.role);

// Extract {{placeholder}} tokens from a document-template body into the
// {key,label} shape the Generate form expects, so uploaded / AI-built templates
// have fillable fields instead of rendering as-is.
export function extractDocVariables(html) {
  const seen = new Set(); const out = [];
  String(html || "").replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => {
    if (!seen.has(k)) { seen.add(k); out.push({ key: k, label: k.replace(/[_.-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim() }); }
    return _;
  });
  return out;
}

// Instructors may write only the classroom-relevant resources (student info +
// academics). School admins may write everything. Reads are school-scoped.
export const INSTRUCTOR_WRITABLE = new Set([
  "students", "student-attendance", "behavior-records", "student-categories", "student-houses",
  "subjects", "classes", "sections", "periods", "academic-sessions", "academic-levels", "academic-calendar",
  "timetable-slots", "timetable-meta", "curriculum", "subject-syllabus", "scheme-of-work",
]);

// What an approved TEACHER may read over the generic list (audit 2026-10-25, F-item 1): the resources they
// can write plus the classroom ones they need to see. Everything else — fees and finance, payroll, staff and
// HR, health records, admissions, complaints, assets, transport, hostels, inventory, the website — is the
// school admin's.
export const TEACHER_READABLE = new Set([...INSTRUCTOR_WRITABLE,
  "class-subjects", "class-teachers", "section-types", "exam-types", "exams", "exam-schedules", "exam-marks",
  "grade-scales", "teacher-remarks", "lesson-plans", "syllabus-items", "classwork-logs", "homework-assignments",
  "learning-resources", "live-classes", "forecast-weeks", "notices", "school-events",
]);

export const studentLabel = (s) => [s.first_name, s.last_name].filter(Boolean).join(" ");

function parseCsvText(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && next === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] || "").trim()])));
}
export { parseCsvText };

function mimeForFile(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return {
    pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }[ext] || "application/octet-stream";
}
export { mimeForFile };

export const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

export const mediaTypeOf = (mime = "") =>
  mime.startsWith("image/") ? "image"
    : mime.startsWith("video/") ? "video"
      : /pdf|word|document|sheet|excel|powerpoint|presentation|text|csv|zip/.test(mime) ? "document" : "other";

// Empty strings from <select>/<input> become NULL so uuid/date columns accept them.
export function cleanBody(cfg, body) {
  const out = {};
  for (const f of cfg.fields) {
    if (body[f] === undefined) continue;
    out[f] = body[f] === "" ? null : body[f];
  }
  return out;
}

/* ── Resource registry ──────────────────────────────────────────────
   fields: writable columns. refs: fk → {table, label} used to attach
   `<key minus _id>_name` on list rows. filters: query params allowed on list. */
export const RESOURCES = {
  // Academics
  "academic-sessions": { table: "academic_sessions", fields: ["name","starts_on","ends_on","is_active"], required: ["name"], orderBy: "starts_on", asc: false },
  "academic-levels": { table: "academic_levels", fields: ["code","name","sort_order","status"], required: ["name"], filters: ["status"], orderBy: "sort_order", asc: true },
  "academic-calendar": { table: "academic_calendar", fields: ["session_id","term","title","event_type","starts_on","ends_on","notes"], required: ["title","starts_on"], refs: { session_id: ["academic_sessions","name"] }, filters: ["session_id","term","event_type"], orderBy: "starts_on", asc: true },
  "classes":  { table: "classes",  fields: ["name","sort_order","level_id","teacher","status"], required: ["name"], refs: { level_id: ["academic_levels","name"] }, filters: ["level_id","status"], orderBy: "sort_order", asc: true },
  "sections": { table: "sections", fields: ["class_id","name","teacher","capacity","status"], required: ["class_id","name"], refs: { class_id: ["classes","name"] }, filters: ["class_id","status"], orderBy: "name", asc: true },
  "subjects": { table: "subjects", fields: ["name","code","subject_type"], required: ["name"], orderBy: "name", asc: true },
  "section-types": { table: "section_types", fields: ["name","description","sort_order","status"], required: ["name"], filters: ["status"], orderBy: "sort_order", asc: true },
  "class-subjects": { table: "class_subjects", fields: ["class_id","subject_id","teacher_id","is_elective"], required: ["class_id","subject_id"], refs: { class_id: ["classes","name"], subject_id: ["subjects","name"] }, filters: ["class_id","is_elective"] },
  "class-teachers": { table: "class_teachers", fields: ["class_id","section_id","teacher_id"], required: ["class_id","teacher_id"], refs: { class_id: ["classes","name"], section_id: ["sections","name"] }, filters: ["class_id"] },
  "periods": { table: "periods", fields: ["name","starts_at","ends_at","sort_order","class_id","type"], required: ["name"], refs: { class_id: ["classes","name"] }, filters: ["class_id","type"], orderBy: "sort_order", asc: true },
  "timetable-slots": { table: "timetable_slots", fields: ["class_id","section_id","day_of_week","period_id","subject_id","alt_subject_id","teacher_id"], required: ["class_id","day_of_week","period_id"], refs: { class_id: ["classes","name"], section_id: ["sections","name"], period_id: ["periods","name"], subject_id: ["subjects","name"], alt_subject_id: ["subjects","name"] }, filters: ["class_id","section_id","day_of_week"], orderBy: "day_of_week", asc: true },
  "timetable-meta": { table: "timetable_meta", fields: ["class_id","section_id","title","prepared_by","approved_by","head_of_curriculum","approved","approved_on"], required: ["class_id"], refs: { class_id: ["classes","name"], section_id: ["sections","name"] }, filters: ["class_id","section_id"], orderBy: "updated_at", asc: false },
  "promotion-logs": { table: "promotion_logs", fields: [], refs: { from_class_id: ["classes","name"], to_class_id: ["classes","name"] }, readOnly: true },
  // Curriculum (school-wide) · Scheme of Work (per class) · Syllabus (per subject)
  "curriculum": { table: "curricula", fields: ["name","framework","level_id","session_id","description","document_url","status"], required: ["name"], refs: { level_id: ["academic_levels","name"], session_id: ["academic_sessions","name"] }, filters: ["level_id","session_id","status"], orderBy: "created_at", asc: false },
  "scheme-of-work": { table: "scheme_of_work", fields: ["class_id","subject_id","term","week","topic","objectives","activities","resources","status"], required: ["class_id","topic"], refs: { class_id: ["classes","name"], subject_id: ["subjects","name"] }, filters: ["class_id","subject_id","term","status"], orderBy: "created_at", asc: false },
  "subject-syllabus": { table: "subject_syllabus", fields: ["subject_id","class_id","title","term","description","document_url","status"], required: ["subject_id","title"], refs: { subject_id: ["subjects","name"], class_id: ["classes","name"] }, filters: ["subject_id","class_id","term","status"], orderBy: "created_at", asc: false },

  // Student Information
  "student-categories": { table: "student_categories", fields: ["name"], required: ["name"], orderBy: "name", asc: true },
  "student-houses": { table: "student_houses", fields: ["name","color"], required: ["name"], orderBy: "name", asc: true },
  "students": { table: "students",
    fields: ["admission_no","roll_no","first_name","last_name","gender","dob","class_id","section_id","category_id","house_id","guardian_name","guardian_phone","guardian_email","address","photo_url","blood_group","is_disabled","disability_note","status","admitted_on",
      "biometric_id","place_of_birth","nationality","religion","caste","sub_caste","mother_tongue","quota",
      "student_email","student_phone","aadhaar_no","pen_no",
      "father_name","father_phone","father_occupation","father_qualification","father_income","father_aadhaar",
      "mother_name","mother_phone","mother_occupation","mother_qualification","mother_aadhaar",
      "emergency_name","emergency_phone","height_cm","weight_kg","medical_history",
      "bank_name","bank_account_no","bank_ifsc","permanent_address","previous_school","extra_fields"],
    required: ["admission_no","first_name","last_name"],
    refs: { class_id: ["classes","name"], section_id: ["sections","name"], category_id: ["student_categories","name"], house_id: ["student_houses","name"] },
    filters: ["class_id","section_id","status","is_disabled","category_id","house_id","created_by"] },
  "student-transport": { table: "student_transport", fields: ["student_id","route_id","vehicle_id","pickup_point","fee","status"], required: ["student_id"], refs: { student_id: ["students", studentLabel], route_id: ["transport_routes","name"], vehicle_id: ["vehicles","plate_no"] }, filters: ["student_id","status"] },
  "student-attendance": { table: "student_attendance", fields: ["student_id","date","status","note"], required: ["student_id","date"], refs: { student_id: ["students", studentLabel] }, filters: ["date","student_id","status"], orderBy: "date", asc: false },
  "behavior-records": { table: "behavior_records", fields: ["student_id","incident_type","severity","polarity","points","description","action_taken","recorded_on"], required: ["student_id","incident_type"], refs: { student_id: ["students", studentLabel] }, filters: ["student_id","severity","polarity"], orderBy: "recorded_on", asc: false },
  "health-records": { table: "health_records", fields: ["student_id","record_type","title","details","recorded_on"], required: ["student_id","title"], refs: { student_id: ["students", studentLabel] }, filters: ["student_id","record_type"] },
  "student-documents": { table: "student_documents", fields: ["student_id","title","url"], required: ["student_id","title","url"], refs: { student_id: ["students", studentLabel] }, filters: ["student_id"], orderBy: "uploaded_at", asc: false },

  // Finance & Fees
  "fee-groups": { table: "fee_groups", fields: ["name","description"], required: ["name"], orderBy: "name", asc: true },
  "fee-types": { table: "fee_types", fields: ["group_id","name","code","default_amount"], required: ["name"], refs: { group_id: ["fee_groups","name"] }, orderBy: "name", asc: true },
  "fee-discounts": { table: "fee_discounts", fields: ["name","discount_type","amount"], required: ["name"], orderBy: "name", asc: true },
  "fee-assignments": { table: "fee_assignments", fields: ["session_id","fee_type_id","class_id","student_id","amount","due_date","discount_id"], required: ["fee_type_id","amount"], refs: { fee_type_id: ["fee_types","name"], class_id: ["classes","name"], student_id: ["students", studentLabel], discount_id: ["fee_discounts","name"], session_id: ["academic_sessions","name"] }, filters: ["class_id","student_id","session_id","fee_type_id"] },
  "fee-payments": { table: "fee_payments", fields: ["student_id","assignment_id","amount","method","reference","note","paid_on","received_by"], required: ["student_id","amount"], refs: { student_id: ["students", studentLabel] }, filters: ["student_id","method"], orderBy: "paid_on", asc: false },
  "fee-challans": { table: "fee_challans", fields: ["student_id","challan_no","amount","status","due_date"], required: ["student_id","challan_no","amount"], refs: { student_id: ["students", studentLabel] }, filters: ["student_id","status"] },
  "due-slips": { table: "due_slips", fields: [], refs: { student_id: ["students", studentLabel] }, filters: ["student_id"], orderBy: "generated_at", asc: false, readOnly: true },
  "fee-carry-forwards": { table: "fee_carry_forwards", fields: [], refs: { student_id: ["students", studentLabel], from_session_id: ["academic_sessions","name"], to_session_id: ["academic_sessions","name"] }, readOnly: true },

  // Accounts
  "income-heads":  { table: "income_heads",  fields: ["name"], required: ["name"], orderBy: "name", asc: true },
  "expense-heads": { table: "expense_heads", fields: ["name"], required: ["name"], orderBy: "name", asc: true },
  "incomes":  { table: "incomes",  fields: ["head_id","amount","source","reference","note","received_on"], required: ["amount"], refs: { head_id: ["income_heads","name"] }, filters: ["head_id"], orderBy: "received_on", asc: false },
  "expenses": { table: "expenses", fields: ["head_id","amount","paid_to","reference","note","spent_on"], required: ["amount"], refs: { head_id: ["expense_heads","name"] }, filters: ["head_id"], orderBy: "spent_on", asc: false },
  "bank-accounts": { table: "bank_accounts", fields: ["name","bank_name","account_no","balance"], required: ["name"], orderBy: "name", asc: true },

  // Human Resource
  "departments":  { table: "departments",  fields: ["name"], required: ["name"], orderBy: "name", asc: true },
  "designations": { table: "designations", fields: ["name"], required: ["name"], orderBy: "name", asc: true },
  "staff": { table: "staff",
    fields: ["staff_no","first_name","last_name","gender","phone","email","photo_url","department_id","designation_id","employment_type","monthly_salary","joined_on","status","staff_class","staff_group","duty","qualification","experience_years","year_of_graduation"],
    required: ["staff_no","first_name","last_name"],
    refs: { department_id: ["departments","name"], designation_id: ["designations","name"] },
    filters: ["department_id","designation_id","status","staff_class","staff_group"] },
  "staff-attendance": { table: "staff_attendance", fields: ["staff_id","date","status","note"], required: ["staff_id","date"], refs: { staff_id: ["staff", studentLabel] }, filters: ["date","staff_id","status"], orderBy: "date", asc: false },
  "leave-types": { table: "leave_types", fields: ["name","days_allowed"], required: ["name"], orderBy: "name", asc: true },
  "leave-requests": { table: "leave_requests", fields: ["staff_id","leave_type_id","from_date","to_date","reason","status","decided_by"], required: ["staff_id","from_date","to_date"], refs: { staff_id: ["staff", studentLabel], leave_type_id: ["leave_types","name"] }, filters: ["status","staff_id"] },
  "payroll-records": { table: "payroll_records", fields: ["staff_id","month","gross","deductions","net","status","paid_on"], required: ["staff_id","month"], refs: { staff_id: ["staff", studentLabel] }, filters: ["month","status","staff_id"] },
  "staff-loans": { table: "staff_loans", fields: ["staff_id","amount","monthly_deduction","balance","status","issued_on"], required: ["staff_id","amount"], refs: { staff_id: ["staff", studentLabel] }, filters: ["status"] },
  "salary-templates": { table: "salary_templates", fields: ["name","basic","housing","transport","other"], required: ["name"], orderBy: "name", asc: true },
  "appraisal-cycles": { table: "appraisal_cycles", fields: ["name","starts_on","ends_on","status"], required: ["name"] },
  "appraisal-criteria": { table: "appraisal_criteria", fields: ["title","weight"], required: ["title"] },
  "appraisals": { table: "appraisals", fields: ["staff_id","cycle_id","score","strengths","improvements","status"], required: ["staff_id"], refs: { staff_id: ["staff", studentLabel], cycle_id: ["appraisal_cycles","name"] }, filters: ["cycle_id","status"] },

  // QR Attendance
  "qr-events": { table: "qr_attendance_events", fields: ["person_type","staff_id","student_id","person_name","direction","method"], required: ["person_name"], refs: { staff_id: ["staff", studentLabel], student_id: ["students", studentLabel] }, filters: ["person_type","direction"], orderBy: "happened_at", asc: false },

  // Offline Examinations
  "exam-types": { table: "exam_types", fields: ["name"], required: ["name"], orderBy: "name", asc: true },
  "exams": { table: "exams", fields: ["name","exam_type_id","session_id","starts_on","ends_on","status"], required: ["name"], refs: { exam_type_id: ["exam_types","name"], session_id: ["academic_sessions","name"] }, filters: ["status","session_id"] },
  "exam-schedules": { table: "exam_schedules", fields: ["exam_id","class_id","subject_id","exam_date","max_marks","pass_marks"], required: ["exam_id","class_id","subject_id"], refs: { exam_id: ["exams","name"], class_id: ["classes","name"], subject_id: ["subjects","name"] }, filters: ["exam_id","class_id"], orderBy: "exam_date", asc: true },
  "exam-marks": { table: "exam_marks", fields: ["schedule_id","student_id","marks"], required: ["schedule_id","student_id"], refs: { student_id: ["students", studentLabel] }, filters: ["schedule_id","student_id"] },
  "cocurricular-areas": { table: "cocurricular_areas", fields: ["name"], required: ["name"], orderBy: "name", asc: true },
  "cocurricular-grades": { table: "cocurricular_grades", fields: ["grade","min_score","max_score","remark"], required: ["grade"] },
  "grade-scales": { table: "grade_scales", fields: ["grade","min_percent","max_percent","remark"], required: ["grade"] },
  "report-card-setups": { table: "report_card_setups", fields: ["name","description"], required: ["name"] },
  "marksheet-uploads": { table: "marksheet_uploads", fields: ["title","exam_id","class_id","file_url","note"], required: ["title"], refs: { exam_id: ["exams","name"], class_id: ["classes","name"] } },
  "teacher-remarks": { table: "teacher_remarks", fields: ["student_id","exam_id","remark"], required: ["student_id","remark"], refs: { student_id: ["students", studentLabel], exam_id: ["exams","name"] }, filters: ["exam_id","student_id"] },

  // CBC Academics
  "cbc-strands": { table: "cbc_strands", fields: ["subject_id","strand","sub_strand","outcome"], required: ["strand"], refs: { subject_id: ["subjects","name"] }, filters: ["subject_id"] },
  "core-competencies": { table: "core_competencies", fields: ["name","description"], required: ["name"], orderBy: "name", asc: true },
  "cbc-pathways": { table: "cbc_pathways", fields: ["name","track","description"], required: ["name"], orderBy: "name", asc: true },
  "cbc-assessments": { table: "cbc_assessments", fields: ["student_id","strand_id","level","note","assessed_on"], required: ["student_id","level"], refs: { student_id: ["students", studentLabel], strand_id: ["cbc_strands","strand"] }, filters: ["level","student_id"] },

  // Online Examinations
  "online-exams": { table: "online_exams", fields: ["title","class_id","subject_id","exam_date","duration_minutes","status"], required: ["title"], refs: { class_id: ["classes","name"], subject_id: ["subjects","name"] }, filters: ["status","class_id"] },
  "question-bank": { table: "question_bank", fields: ["subject_id","question","option_a","option_b","option_c","option_d","correct_option","marks"], required: ["question"], refs: { subject_id: ["subjects","name"] }, filters: ["subject_id"] },

  // PTM Meetings
  "ptm-meetings": { table: "ptm_meetings", fields: ["title","meeting_date","venue","agenda","class_id","status"], required: ["title"], refs: { class_id: ["classes","name"] }, filters: ["status"] },
  "ptm-attendance": { table: "ptm_attendance", fields: ["meeting_id","student_id","guardian_name","attended","remarks"], required: ["meeting_id"], refs: { meeting_id: ["ptm_meetings","title"], student_id: ["students", studentLabel] }, filters: ["meeting_id"] },
  "ptm-followups": { table: "ptm_followups", fields: ["meeting_id","student_id","note","due_on","status"], required: ["note"], refs: { meeting_id: ["ptm_meetings","title"], student_id: ["students", studentLabel] }, filters: ["status"] },

  // Lesson Planner
  "lesson-plans": { table: "lesson_plans", fields: ["teacher_id","class_id","subject_id","week_label","topic","objectives","activities","resources","feedback","status"], required: ["topic"], refs: { teacher_id: ["users","full_name","public"], class_id: ["classes","name"], subject_id: ["subjects","name"] }, filters: ["status","class_id","teacher_id"] },
  "forecast-weeks": { table: "forecast_weeks", fields: ["class_id","section_id","week_start","week_end","theme","notes","prepared_by"], required: ["class_id","week_start"], refs: { class_id: ["classes","name"], section_id: ["sections","name"] }, filters: ["class_id","section_id","week_start"], orderBy: "week_start", asc: false },

  // OSM
  "osm-sessions": { table: "osm_sessions", fields: ["teacher_id","observer_name","session_date","focus_area","status"], required: [], refs: { teacher_id: ["users","full_name","public"] }, filters: ["status"] },
  "osm-evaluations": { table: "osm_evaluations", fields: ["session_id","score","strengths","improvements","status"], required: ["session_id"], refs: { session_id: ["osm_sessions","focus_area"] }, filters: ["status"] },

  // Study Center
  "syllabus-items": { table: "syllabus_items", fields: ["class_id","subject_id","term","topic","description","status"], required: ["topic"], refs: { class_id: ["classes","name"], subject_id: ["subjects","name"] }, filters: ["class_id","subject_id","status"] },
  "classwork-logs": { table: "classwork_logs", fields: ["class_id","subject_id","teacher_id","log_date","topic","notes"], required: ["topic"], refs: { class_id: ["classes","name"], subject_id: ["subjects","name"], teacher_id: ["users","full_name","public"] }, filters: ["class_id","subject_id"], orderBy: "log_date", asc: false },
  "learning-resources": { table: "learning_resources", fields: ["title","class_id","section_id","subject_id","resource_type","url","note"], required: ["title"], refs: { class_id: ["classes","name"], section_id: ["sections","name"], subject_id: ["subjects","name"] }, filters: ["class_id","section_id","subject_id","resource_type"] },
  "homework-assignments": { table: "homework_assignments", fields: ["class_id","subject_id","title","description","due_on","status"], required: ["title"], refs: { class_id: ["classes","name"], subject_id: ["subjects","name"] }, filters: ["class_id","status"] },
  "live-classes": { table: "live_classes", fields: ["title","class_id","subject_id","platform","meeting_url","starts_at","status"], required: ["title"], refs: { class_id: ["classes","name"], subject_id: ["subjects","name"] }, filters: ["status"] },

  // Certificates
  "certificate-templates": { table: "certificate_templates", fields: ["name","description","body"], required: ["name"], orderBy: "name", asc: true },
  "generated-documents": { table: "generated_documents", fields: [], refs: { template_id: ["certificate_templates","name"], student_id: ["students", studentLabel] }, readOnly: true, orderBy: "issued_on", asc: false },

  // Document / form template engine (renders like a real printed file)
  "document-templates": { table: "document_templates", fields: ["name","description","category","page_size","orientation","body","css","variables"], required: ["name"], filters: ["category"], orderBy: "created_at", asc: false },
  "document-records": { table: "document_records", fields: [], refs: { template_id: ["document_templates","name"], student_id: ["students", studentLabel], staff_id: ["staff", studentLabel] }, filters: ["template_id"], orderBy: "issued_on", asc: false, readOnly: true },

  // Communicate
  "notices": { table: "notices", fields: ["title","body","audience","publish_on","expires_on","pinned"], required: ["title"], filters: ["audience"] },
  "school-events": { table: "school_events", fields: ["title","description","event_type","starts_on","ends_on"], required: ["title"], filters: ["event_type"], orderBy: "starts_on", asc: false },
  "broadcasts": { table: "broadcasts", fields: ["title","message","channel","audience","status","sent_at"], required: ["title","message"], filters: ["status","channel"] },
  "gallery-images": { table: "gallery_images", fields: ["title","image_url","album","taken_on"], required: ["title"], filters: ["album"] },

  // Library
  "book-categories": { table: "book_categories", fields: ["name"], required: ["name"], orderBy: "name", asc: true },
  "books": { table: "books", fields: ["title","author","isbn","shelf","category_id","copies_total","copies_available"], required: ["title"], refs: { category_id: ["book_categories","name"] }, filters: ["category_id"], orderBy: "title", asc: true },
  "book-loans": { table: "book_loans", fields: ["book_id","student_id","borrower_name","issued_on","due_on","returned_on","status"], required: ["book_id"], refs: { book_id: ["books","title"], student_id: ["students", studentLabel] }, filters: ["status","book_id"] },

  // Inventory
  "item-categories": { table: "item_categories", fields: ["name"], required: ["name"], orderBy: "name", asc: true },
  "inventory-items": { table: "inventory_items", fields: ["name","unit","category_id","quantity","reorder_level","unit_price"], required: ["name"], refs: { category_id: ["item_categories","name"] }, filters: ["category_id"], orderBy: "name", asc: true },
  "inventory-suppliers": { table: "inventory_suppliers", fields: ["name","phone","email","address"], required: ["name"], orderBy: "name", asc: true },
  "stock-entries": { table: "stock_entries", fields: [], refs: { item_id: ["inventory_items","name"], supplier_id: ["inventory_suppliers","name"] }, readOnly: true, orderBy: "received_on", asc: false },
  "item-issues": { table: "item_issues", fields: [], refs: { item_id: ["inventory_items","name"] }, readOnly: true, orderBy: "issued_on", asc: false },
  "pos-sales": { table: "pos_sales", fields: [], refs: { item_id: ["inventory_items","name"] }, readOnly: true, orderBy: "sold_on", asc: false },
  "purchase-orders": { table: "purchase_orders", fields: ["order_no","supplier_id","total_amount","status","ordered_on"], required: ["order_no"], refs: { supplier_id: ["inventory_suppliers","name"] }, filters: ["status"] },
  "goods-receipts": { table: "goods_receipts", fields: ["purchase_order_id","received_on","note"], required: [], refs: { purchase_order_id: ["purchase_orders","order_no"] } },
  "supplier-payments": { table: "supplier_payments", fields: ["supplier_id","amount","method","reference","paid_on"], required: ["amount"], refs: { supplier_id: ["inventory_suppliers","name"] } },

  // Transport
  "vehicles": { table: "vehicles", fields: ["plate_no","model","capacity","driver_name","driver_phone","status"], required: ["plate_no"], filters: ["status"], orderBy: "plate_no", asc: true },
  "transport-routes": { table: "transport_routes", fields: ["name","start_point","end_point","fare","vehicle_id"], required: ["name"], refs: { vehicle_id: ["vehicles","plate_no"] }, orderBy: "name", asc: true },
  "vehicle-locations": { table: "vehicle_locations", fields: ["vehicle_id","location","note"], required: ["vehicle_id","location"], refs: { vehicle_id: ["vehicles","plate_no"] }, filters: ["vehicle_id"], orderBy: "reported_at", asc: false },

  // Hostel
  "hostels": { table: "hostels", fields: ["name","hostel_type","warden_name","warden_phone"], required: ["name"], orderBy: "name", asc: true },
  "room-types": { table: "room_types", fields: ["name","capacity","cost_per_term"], required: ["name"], orderBy: "name", asc: true },
  "hostel-rooms": { table: "hostel_rooms", fields: ["hostel_id","room_type_id","room_no","capacity"], required: ["room_no"], refs: { hostel_id: ["hostels","name"], room_type_id: ["room_types","name"] }, filters: ["hostel_id"], orderBy: "room_no", asc: true },
  "hostel-allocations": { table: "hostel_allocations", fields: ["room_id","student_id","allocated_on","vacated_on","status"], required: ["room_id","student_id"], refs: { room_id: ["hostel_rooms","room_no"], student_id: ["students", studentLabel] }, filters: ["status","room_id"] },

  // Help Center
  "help-categories": { table: "help_categories", fields: ["name"], required: ["name"], orderBy: "name", asc: true },
  "help-articles": { table: "help_articles", fields: ["category_id","title","body","published"], required: ["title"], refs: { category_id: ["help_categories","name"] }, filters: ["category_id","published"] },

  // Asset Management
  "asset-categories": { table: "asset_categories", fields: ["name"], required: ["name"], orderBy: "name", asc: true },
  "assets": { table: "assets", fields: ["name","asset_tag","category_id","purchase_cost","purchase_date","depreciation_rate","location","status"], required: ["name","asset_tag"], refs: { category_id: ["asset_categories","name"] }, filters: ["category_id","status"], orderBy: "asset_tag", asc: true },
  "asset-assignments": { table: "asset_assignments", fields: ["asset_id","assigned_to","assigned_on","returned_on","note"], required: ["asset_id","assigned_to"], refs: { asset_id: ["assets","name"] } },
  "asset-maintenance": { table: "asset_maintenance", fields: ["asset_id","maintenance_type","cost","performed_on","note"], required: ["asset_id"], refs: { asset_id: ["assets","name"] } },
  "asset-disposals": { table: "asset_disposals", fields: ["asset_id","disposal_type","amount","disposed_on","note"], required: ["asset_id"], refs: { asset_id: ["assets","name"] } },
  "asset-audits": { table: "asset_audits", fields: ["audit_date","auditor","findings","status"], required: [], filters: ["status"], orderBy: "audit_date", asc: false },

  // Website Builder (public-site media / pages / menus)
  "site-media": { table: "site_media", fields: ["title","media_type","url","alt_text"], required: ["title","url"], filters: ["media_type"], orderBy: "created_at", asc: false },
  "site-pages": { table: "site_pages", fields: ["title","slug","content","blocks","status","sort_order"], required: ["title"], filters: ["status"], orderBy: "sort_order", asc: true },
  "menus": { table: "site_menus", fields: ["name","location"], required: ["name"], filters: ["location"], orderBy: "created_at", asc: true },
  "menu-items": { table: "site_menu_items", fields: ["menu_id","label","url","page_id","parent_label","target","sort_order"], required: ["menu_id","label"], refs: { page_id: ["site_pages","title"] }, filters: ["menu_id","parent_label"], orderBy: "sort_order", asc: true },

  // Public portal (online admissions / payments / result PINs)
  "admission-applications": { table: "admission_applications", fields: ["status","note"], required: [], filters: ["status","fee_status"], orderBy: "created_at", asc: false, readOnlyCreate: true },
  "result-pins": { table: "result_pins", fields: [], refs: { student_id: ["students", studentLabel], exam_id: ["exams","name"] }, filters: ["exam_id","student_id"], readOnly: true },
  "online-payments": { table: "online_payments", fields: [], refs: { student_id: ["students", studentLabel] }, filters: ["status","purpose"], readOnly: true },

  // Front Office
  "enquiries": { table: "enquiries", fields: ["name","phone","email","class_interest","source","status","note","follow_up_on"], required: ["name"], filters: ["status"] },
  "visitors": { table: "visitors", fields: ["name","phone","purpose","to_meet","id_proof","check_in","check_out"], required: ["name"], orderBy: "check_in", asc: false },
  "complaints": { table: "complaints", fields: ["complainant","phone","category","description","status","action_note"], required: ["complainant"], filters: ["status"] },
  "postal-records": { table: "postal_records", fields: ["direction","reference_no","from_name","to_name","item","note","record_date"], required: ["item"], filters: ["direction"], orderBy: "record_date", asc: false },
};

// Never expose credential secrets over the generic list; financial columns are
// admin-only (teachers resolve through getMySchool too, so a role gate matters).
export const ALWAYS_SECRET_COLS = ["password_hash", "student_password_hash", "parent_password_hash", "pin", "result_pin", "two_factor_secret", "access_token", "refresh_token"];
export const ADMIN_ONLY_COLS = ["monthly_salary", "salary", "bank_account_no", "bank_name", "account_number", "account_no",
  "gross", "net", "basic", "basic_salary", "gross_salary", "net_salary", "allowances", "deductions"];
export function sanitizeMgmtRow(row, isAdmin) {
  const out = { ...row };
  for (const k of ALWAYS_SECRET_COLS) delete out[k];
  if (!isAdmin) for (const k of ADMIN_ONLY_COLS) delete out[k];
  return out;
}

export const TPL_VISION_SYSTEM = `You convert a photographed or scanned document into a clean, self-contained, PRINTABLE HTML template.
Rules:
- Return ONLY valid HTML (inline CSS, sized for A4). No markdown, no code fences, no commentary.
- Faithfully reproduce the layout, headings, tables, sections, borders and overall structure you see.
- Replace the specific/variable VALUES (person names, dates, ID numbers, marks, amounts, addresses, signatures) with mustache placeholders like {{student_name}}, {{date}}, {{class}}, {{score}} — infer sensible field names. Keep fixed labels and headings as-is.
- Keep it clean and professional; use a system font stack. Do not invent content that isn't in the document.`;

export const SAMPLE_CORE = [
  { code: "MTH",     topics: ["Number & Numeration", "Basic Operations", "Fractions & Decimals", "Algebraic Expressions", "Geometry & Shapes", "Statistics & Data"] },
  { code: "ENG",     topics: ["Reading Comprehension", "Parts of Speech", "Essay Writing", "Oral English & Phonics", "Summary Writing", "Literature Appreciation"] },
  { code: "INT/SCI", topics: ["Living & Non-living Things", "Matter & Its States", "Energy & Forces", "The Human Body", "Environment & Ecosystems", "Simple Machines"] },
  { code: "SST",     topics: ["Family & Community", "Culture & Values", "Map Reading", "Government & Civics", "Nigeria & Its People", "National Symbols"] },
];
export const SAMPLE_TERMS = ["First Term", "Second Term", "Third Term"];
