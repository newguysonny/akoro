/**
 * modules/school/mgmt-service-academics.js — timetable, forecast, exams and
 * sample-data seeding for the Management API.
 */

import * as store from "./mgmt-store.js";
import { getMySchool } from "./mgmt-service.js";
import { studentLabel, SAMPLE_CORE, SAMPLE_TERMS } from "./mgmt-rules.js";
import { PERIOD_DEFS, TEACH_PERIOD_NAMES, TEMPLATE_SUBJECTS, JUNIOR_GRID, SENIOR_GRID } from "./timetableTemplate.js";

/* ═══════════════ Exam marks ═══════════════════════════════════════════════ */

export async function examsMarksRegister(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { schedule_id } = req.query;
    if (!schedule_id) return res.status(400).json({ error: "schedule_id is required" });
    const { data: sched } = await store.select("exam_schedules", {
      columns: "id, class_id, max_marks, pass_marks",
      filters: [["eq", "id", schedule_id], ["eq", "school_id", school.id]], maybeSingle: true,
    });
    if (!sched) return res.status(404).json({ error: "Schedule not found" });
    const { data: students } = await store.select("students", {
      columns: "id, admission_no, roll_no, first_name, last_name",
      filters: [["eq", "school_id", school.id], ["eq", "class_id", sched.class_id], ["eq", "status", "active"]],
      orderBy: "roll_no", asc: true,
    });
    const ids = (students || []).map((s) => s.id);
    const { data: marks } = ids.length
      ? await store.select("exam_marks", {
        columns: "student_id, marks",
        filters: [["eq", "schedule_id", schedule_id], ["in", "student_id", ids]],
      })
      : { data: [] };
    const markOf = Object.fromEntries((marks || []).map((m) => [m.student_id, m.marks]));
    res.json({ success: true, maxMarks: sched.max_marks, passMarks: sched.pass_marks,
      data: (students || []).map((s) => ({ ...s, name: studentLabel(s), marks: markOf[s.id] ?? null })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function examsMarksSave(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { schedule_id, entries } = req.body;
    if (!schedule_id || !Array.isArray(entries) || !entries.length) return res.status(400).json({ error: "schedule_id and entries[] are required" });
    const rows = entries.filter((e) => e.student_id && e.marks !== "" && e.marks !== null && e.marks !== undefined)
      .map((e) => ({ school_id: school.id, schedule_id, student_id: e.student_id, marks: Number(e.marks) }));
    const { error } = await store.upsert("exam_marks", rows, { onConflict: "schedule_id,student_id" });
    if (error) throw new Error(error.message);
    res.json({ success: true, saved: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Marksheet matrix: students × subjects for an exam/class.
export async function examsMarksheet(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { exam_id, class_id } = req.query;
    if (!exam_id || !class_id) return res.status(400).json({ error: "exam_id and class_id are required" });
    const { data: scheds } = await store.select("exam_schedules", {
      columns: "id, subject_id, max_marks",
      filters: [["eq", "school_id", school.id], ["eq", "exam_id", exam_id], ["eq", "class_id", class_id]],
    });
    if (!scheds?.length) return res.json({ success: true, subjects: [], data: [] });
    const subjIds = scheds.map((s) => s.subject_id);
    const { data: subjects } = await store.select("subjects", {
      columns: "id, name", filters: [["eq", "school_id", school.id], ["in", "id", subjIds]],
    });
    const subjName = Object.fromEntries((subjects || []).map((s) => [s.id, s.name]));
    const { data: students } = await store.select("students", {
      columns: "id, admission_no, first_name, last_name",
      filters: [["eq", "school_id", school.id], ["eq", "class_id", class_id], ["eq", "status", "active"]],
      orderBy: "admission_no", asc: true,
    });
    const { data: marks } = await store.select("exam_marks", {
      columns: "schedule_id, student_id, marks",
      filters: [["eq", "school_id", school.id], ["in", "schedule_id", scheds.map((s) => s.id)]],
    });
    const schedSubj = Object.fromEntries(scheds.map((s) => [s.id, s.subject_id]));
    const cell = {};
    for (const m of marks || []) cell[`${m.student_id}:${schedSubj[m.schedule_id]}`] = Number(m.marks);
    const maxTotal = scheds.reduce((s, x) => s + (x.max_marks || 100), 0);
    res.json({
      success: true,
      subjects: scheds.map((s) => ({ id: s.subject_id, name: subjName[s.subject_id] || "?", maxMarks: s.max_marks })),
      data: (students || []).map((st) => {
        const scores = scheds.map((s) => cell[`${st.id}:${s.subject_id}`] ?? null);
        const total = scores.reduce((a, b) => a + (b || 0), 0);
        return { student_id: st.id, admission_no: st.admission_no, name: studentLabel(st), scores, total,
          percent: maxTotal ? Math.round((total / maxTotal) * 100) : 0 };
      }),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/* ═══════════════ Timetable ════════════════════════════════════════════════ */

// Seed periods + subjects + a starter timetable for a class. Reused by both
// "Load starter template" and the sample-class seeder. Returns the subject-id
// map so callers can attach scheme-of-work / materials to the same subjects.
export async function seedStarterTimetable(school, { class_id, section_id = null, replace = false, variant } = {}) {
  const { data: cls } = await store.select("classes", {
    columns: "name", filters: [["eq", "id", class_id], ["eq", "school_id", school.id]], maybeSingle: true,
  });
  if (!cls) return { error: "Class not found", status: 404 };
  const v = variant || (/^(jss|grade|primary|basic|junior)/i.test(cls.name) ? "junior" : "senior");
  const grid = v === "senior" ? SENIOR_GRID : JUNIOR_GRID;

  const slotFilters = [["eq", "school_id", school.id], ["eq", "class_id", class_id]];
  if (section_id) slotFilters.push(["eq", "section_id", section_id]);
  else slotFilters.push(["is", "section_id", null]);
  const { data: existing } = await store.select("timetable_slots", { columns: "id", filters: slotFilters });
  if (existing?.length && !replace) return { exists: true, count: existing.length, variant: v, created: 0, subjIdByCode: {} };
  if (existing?.length && replace) {
    await store.remove("timetable_slots", slotFilters);
  }

  // Ensure template subjects exist (match by name — school_id+name is unique).
  const { data: existingSubs } = await store.select("subjects", {
    columns: "id, name, code", filters: [["eq", "school_id", school.id]],
  });
  const byName = new Map((existingSubs || []).map((s) => [s.name.toLowerCase(), s]));
  const byCode = new Map((existingSubs || []).filter((s) => s.code).map((s) => [s.code, s]));
  for (const [name, code] of TEMPLATE_SUBJECTS) {
    const ex = byName.get(name.toLowerCase());
    if (ex && ex.code !== code && !byCode.has(code)) { await store.update("subjects", { code }, [["eq", "id", ex.id]]); byCode.set(code, ex); ex.code = code; }
  }
  const toAdd = TEMPLATE_SUBJECTS
    .filter(([name, code]) => !byName.has(name.toLowerCase()) && !byCode.has(code))
    .map(([name, code, type]) => ({ school_id: school.id, name, code, subject_type: type }));
  if (toAdd.length) await store.insert("subjects", toAdd);
  const codes = TEMPLATE_SUBJECTS.map((s) => s[1]);
  const { data: subs } = await store.select("subjects", {
    columns: "id, code", filters: [["eq", "school_id", school.id], ["in", "code", codes]],
  });
  const subjIdByCode = Object.fromEntries((subs || []).map((s) => [s.code, s.id]));

  // Ensure the periods (by name) and map name → id.
  let { data: pers } = await store.select("periods", {
    columns: "id, name", filters: [["eq", "school_id", school.id], ["in", "name", PERIOD_DEFS.map((p) => p.name)]],
  });
  const havePer = new Set((pers || []).map((p) => p.name));
  const addPer = PERIOD_DEFS.filter((p) => !havePer.has(p.name)).map((p) => ({ school_id: school.id, ...p }));
  if (addPer.length) {
    await store.insert("periods", addPer);
    ({ data: pers } = await store.select("periods", {
      columns: "id, name", filters: [["eq", "school_id", school.id], ["in", "name", PERIOD_DEFS.map((p) => p.name)]],
    }));
  }
  const perIdByName = Object.fromEntries((pers || []).map((p) => [p.name, p.id]));

  const rows = [];
  grid.forEach((day, di) => {
    day.forEach((cell, ci) => {
      const [code, alt] = Array.isArray(cell) ? cell : [cell, null];
      const period_id = perIdByName[TEACH_PERIOD_NAMES[ci]];
      const subject_id = subjIdByCode[code];
      if (!period_id || !subject_id) return;
      rows.push({ school_id: school.id, class_id, section_id, day_of_week: di + 1, period_id, subject_id, alt_subject_id: alt ? (subjIdByCode[alt] || null) : null });
    });
  });
  if (rows.length) {
    const { error } = await store.insert("timetable_slots", rows);
    if (error) throw new Error(error.message);
  }
  return { variant: v, created: rows.length, subjIdByCode };
}

export async function timetableLoadTemplate(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { class_id, section_id = null, replace = false, variant } = req.body;
    if (!class_id) return res.status(400).json({ error: "class_id is required" });
    const r = await seedStarterTimetable(school, { class_id, section_id, replace, variant });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    if (r.exists) return res.status(409).json({ error: "This class already has a timetable.", code: "exists", count: r.count });
    res.json({ success: true, variant: r.variant, created: r.created });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// POST /academics/seed-sample — one-click sample data for a class.
export async function academicsSeedSample(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { class_id, section_id = null } = req.body;
    if (!class_id) return res.status(400).json({ error: "class_id is required" });

    // 1) periods + subjects + timetable (replace so the demo is consistent).
    const tt = await seedStarterTimetable(school, { class_id, section_id, replace: true });
    if (tt.error) return res.status(tt.status || 400).json({ error: tt.error });
    const subjIdByCode = tt.subjIdByCode || {};

    const summary = { timetable: tt.created, subjects_assigned: 0, scheme: 0, materials: 0 };

    for (const core of SAMPLE_CORE) {
      const subjectId = subjIdByCode[core.code];
      if (!subjectId) continue;

      // 2) assign the subject to the class (idempotent via unique class+subject).
      const { error: csErr } = await store.insert("class_subjects", { school_id: school.id, class_id, subject_id: subjectId, is_elective: false });
      if (!csErr) summary.subjects_assigned += 1;

      // 3) scheme of work — 2 weeks per term across 3 terms.
      const { data: haveScheme } = await store.select("scheme_of_work", {
        columns: "id",
        filters: [["eq", "school_id", school.id], ["eq", "class_id", class_id], ["eq", "subject_id", subjectId]],
        limit: 1,
      });
      if (!haveScheme?.length) {
        const rows = [];
        SAMPLE_TERMS.forEach((term, ti) => {
          for (let w = 0; w < 2; w++) {
            const topic = core.topics[(ti * 2 + w) % core.topics.length];
            rows.push({ school_id: school.id, class_id, subject_id: subjectId, term, week: `Week ${w + 1}`, topic,
              objectives: `Students should be able to understand and apply the key ideas of ${topic.toLowerCase()}.`,
              activities: "Guided discussion, worked examples, group work and a short class exercise.",
              resources: "Course textbook, worksheets and the teaching materials for this subject.",
              status: "planned" });
          }
        });
        if (rows.length) { const { error } = await store.insert("scheme_of_work", rows); if (!error) summary.scheme += rows.length; }
      }

      // 4) teaching materials — a note, a document link and a video per subject.
      const { data: haveMat } = await store.select("learning_resources", {
        columns: "id",
        filters: [["eq", "school_id", school.id], ["eq", "class_id", class_id], ["eq", "subject_id", subjectId]],
        limit: 1,
      });
      if (!haveMat?.length) {
        const first = core.topics[0];
        const mats = [
          { title: `${first} — Lesson Notes`, resource_type: "document", url: "", note: `Comprehensive notes covering ${first.toLowerCase()}.` },
          { title: `${first} — Worksheet (PDF)`, resource_type: "link", url: "https://example.com/worksheet.pdf", note: "Practice questions with answers." },
          { title: `${first} — Video Lesson`, resource_type: "video", url: "https://www.youtube.com/results?search_query=" + encodeURIComponent(first), note: "Introductory video lesson." },
        ].map((m) => ({ school_id: school.id, class_id, subject_id: subjectId, ...m }));
        const { error } = await store.insert("learning_resources", mats); if (!error) summary.materials += mats.length;
      }
    }

    res.json({ success: true, data: summary });
  } catch (e) { console.error("[academics/seed-sample]", e.message); res.status(500).json({ error: e.message }); }
}

// A teacher's own weekly timetable.
export async function timetableMy(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const me = req.user.id;

    const { data: cs } = await store.select("class_subjects", {
      columns: "class_id, subject_id",
      filters: [["eq", "school_id", school.id], ["eq", "teacher_id", me]],
    });
    const pairs = new Set((cs || []).map((c) => `${c.class_id}:${c.subject_id}`));
    const myClassIds = [...new Set((cs || []).map((c) => c.class_id))];

    // Slots: assigned directly to me, or scheduling a subject I teach.
    const bySlot = new Map();
    const { data: direct } = await store.select("timetable_slots", {
      filters: [["eq", "school_id", school.id], ["eq", "teacher_id", me]],
    });
    (direct || []).forEach((s) => bySlot.set(s.id, s));
    if (myClassIds.length) {
      const { data: cslots } = await store.select("timetable_slots", {
        filters: [["eq", "school_id", school.id], ["in", "class_id", myClassIds]],
      });
      (cslots || []).forEach((s) => { if (pairs.has(`${s.class_id}:${s.subject_id}`)) bySlot.set(s.id, s); });
    }

    // Enrichment maps.
    const [{ data: classes }, { data: subjects }, { data: periods }] = await Promise.all([
      store.select("classes", { columns: "id, name", filters: [["eq", "school_id", school.id]] }),
      store.select("subjects", { columns: "id, name, code", filters: [["eq", "school_id", school.id]] }),
      store.select("periods", { columns: "id, name, starts_at, ends_at, sort_order, type, class_id", filters: [["eq", "school_id", school.id]] }),
    ]);
    const cName = Object.fromEntries((classes || []).map((c) => [c.id, c.name]));
    const sMap = Object.fromEntries((subjects || []).map((s) => [s.id, s]));

    const cells = [...bySlot.values()].map((s) => ({
      day_of_week: s.day_of_week, period_id: s.period_id,
      class_name: cName[s.class_id] || "", subject: sMap[s.subject_id]?.code || sMap[s.subject_id]?.name || "",
      alt: s.alt_subject_id ? (sMap[s.alt_subject_id]?.code || sMap[s.alt_subject_id]?.name || "") : null,
    }));
    // Periods to display: school-wide teaching set (fall back to any).
    const teaching = (periods || []).filter((p) => !p.class_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    res.json({ success: true, data: { periods: teaching.length ? teaching : (periods || []), cells, teaches: (cs || []).length > 0 || cells.length > 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/* ═══════════════ Weekly forecast ══════════════════════════════════════════ */

export async function forecastGet(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { class_id, section_id = null, week_start } = req.query;
    if (!class_id || !week_start) return res.status(400).json({ error: "class_id and week_start are required" });
    const filters = [["eq", "school_id", school.id], ["eq", "class_id", class_id], ["eq", "week_start", week_start]];
    if (section_id) filters.push(["eq", "section_id", section_id]);
    else filters.push(["is", "section_id", null]);
    const { data: week } = await store.select("forecast_weeks", { filters, maybeSingle: true });
    let cells = [];
    if (week) {
      const { data } = await store.select("forecast_cells", {
        columns: "day_of_week, period_id, activity, notes", filters: [["eq", "week_id", week.id]],
      });
      cells = data || [];
    }
    res.json({ success: true, data: { week: week || null, cells } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function forecastSave(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const b = req.body || {};
    if (!b.class_id || !b.week_start) return res.status(400).json({ error: "class_id and week_start are required" });
    const section_id = b.section_id || null;

    // Upsert the week header.
    const filters = [["eq", "school_id", school.id], ["eq", "class_id", b.class_id], ["eq", "week_start", b.week_start]];
    if (section_id) filters.push(["eq", "section_id", section_id]);
    else filters.push(["is", "section_id", null]);
    let { data: week } = await store.select("forecast_weeks", { columns: "id", filters, maybeSingle: true });
    const header = { week_end: b.week_end || null, theme: b.theme ?? null, notes: b.notes ?? null, prepared_by: b.prepared_by ?? null, updated_at: new Date() };
    if (week) {
      await store.update("forecast_weeks", header, [["eq", "id", week.id]]);
    } else {
      const { data: created, error } = await store.insert("forecast_weeks",
        { school_id: school.id, class_id: b.class_id, section_id, week_start: b.week_start, ...header },
        { columns: "id", single: true });
      if (error) throw new Error(error.message);
      week = created;
    }

    // Upsert each provided cell (empty activity clears it).
    let saved = 0;
    for (const c of Array.isArray(b.cells) ? b.cells : []) {
      if (!c.period_id || !c.day_of_week) continue;
      const row = { school_id: school.id, week_id: week.id, day_of_week: c.day_of_week, period_id: c.period_id, activity: c.activity ?? null, notes: c.notes ?? null };
      const { data: ex } = await store.select("forecast_cells", {
        columns: "id",
        filters: [["eq", "week_id", week.id], ["eq", "day_of_week", c.day_of_week], ["eq", "period_id", c.period_id]], maybeSingle: true,
      });
      if (ex) await store.update("forecast_cells", { activity: row.activity, notes: row.notes }, [["eq", "id", ex.id]]);
      else await store.insert("forecast_cells", row);
      saved++;
    }
    res.json({ success: true, weekId: week.id, saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Mirror the scheme of work onto the timetable.
export async function forecastGenerate(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const b = req.body || {};
    if (!b.class_id || !b.week_start || !b.term || !b.week) {
      return res.status(400).json({ error: "class_id, week_start, term and week are required" });
    }
    const section_id = b.section_id || null;
    const overwrite  = b.overwrite !== false;

    // 1) Timetable slots for this class/section → (day, period, subject).
    // Timetables may be stored per-section OR class-wide (section_id NULL).
    // Try the exact section first, then fall back to any of the class's slots.
    const fetchRows = async (filters) => (await store.select("timetable_slots", {
      columns: "day_of_week, period_id, subject_id, alt_subject_id",
      filters: [["eq", "school_id", school.id], ["eq", "class_id", b.class_id], ...filters],
    })).data || [];
    let raw = [];
    if (section_id) raw = await fetchRows([["eq", "section_id", section_id]]);
    if (!raw.length) raw = await fetchRows([]);   // fall back to all sections / class-wide
    if (!raw.length) return res.status(409).json({ error: "This class has no timetable yet. Build the timetable first.", code: "no_timetable" });
    const seen = new Set();
    const slots = raw.filter((s) => {
      const k = `${s.day_of_week}_${s.period_id}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    // 2) Scheme-of-work topics for the chosen term + week → subject_id → topic.
    const { data: scheme } = await store.select("scheme_of_work", {
      columns: "subject_id, topic",
      filters: [["eq", "school_id", school.id], ["eq", "class_id", b.class_id], ["eq", "term", b.term], ["eq", "week", b.week]],
    });
    const topicBySubject = Object.fromEntries((scheme || []).map((s) => [s.subject_id, s.topic]));
    if (!Object.keys(topicBySubject).length) {
      return res.status(409).json({ error: `No scheme of work for ${b.term} · ${b.week}. Add topics first.`, code: "no_scheme" });
    }

    // 3) Upsert the week header (default the theme to the term · week label).
    const filters = [["eq", "school_id", school.id], ["eq", "class_id", b.class_id], ["eq", "week_start", b.week_start]];
    if (section_id) filters.push(["eq", "section_id", section_id]);
    else filters.push(["is", "section_id", null]);
    let { data: week } = await store.select("forecast_weeks", { columns: "id, theme", filters, maybeSingle: true });
    const header = {
      week_end: b.week_end || null,
      theme: (week?.theme?.trim() || `${b.term} · ${b.week}`),
      updated_at: new Date(),
    };
    if (week) {
      await store.update("forecast_weeks", header, [["eq", "id", week.id]]);
    } else {
      const { data: created, error } = await store.insert("forecast_weeks",
        { school_id: school.id, class_id: b.class_id, section_id, week_start: b.week_start, ...header },
        { columns: "id", single: true });
      if (error) throw new Error(error.message);
      week = created;
    }

    // 4) Build one highlight per teaching slot: the subject's topic (plus the
    //    alt subject's topic when the period is shared).
    const rows = [];
    for (const s of slots) {
      const t   = topicBySubject[s.subject_id];
      const alt = s.alt_subject_id ? topicBySubject[s.alt_subject_id] : null;
      const activity = alt ? `${t || "—"} / ${alt}` : t;
      if (!activity) continue;   // no topic for this subject this week — leave blank
      rows.push({ day_of_week: s.day_of_week, period_id: s.period_id, activity });
    }

    // 5) Write the cells. Overwrite → rebuild the week; else only fill blanks.
    if (overwrite) await store.remove("forecast_cells", [["eq", "week_id", week.id]]);
    let filled = 0;
    for (const r of rows) {
      const { data: ex } = await store.select("forecast_cells", {
        columns: "id, activity",
        filters: [["eq", "week_id", week.id], ["eq", "day_of_week", r.day_of_week], ["eq", "period_id", r.period_id]], maybeSingle: true,
      });
      if (ex) {
        if (!overwrite && ex.activity?.trim()) continue;   // keep manual entry
        await store.update("forecast_cells", { activity: r.activity }, [["eq", "id", ex.id]]);
      } else {
        await store.insert("forecast_cells", { school_id: school.id, week_id: week.id, ...r });
      }
      filled++;
    }

    res.json({ success: true, weekId: week.id, filled, term: b.term, week: b.week });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
