/**
 * The instructor app's Activity Creator, end to end with a class — the calls the form
 * makes (akoro-instructor/src/components/activities/ActivityForm.jsx), in its order:
 *
 *   1. plan          POST /api/self-study/plan                          (the task breakdown)
 *   2. questions     POST /api/self-study/assignment-draft/questions    (marked paper, real model)
 *   3. rubric        POST /api/self-study/assignment-draft/rubric       (criteria + points, real model)
 *   4. edit          the teacher changes a criterion and re-balances the points (form rows)
 *   5. assign        POST /api/self-study  — auto-grading ON, the whole class
 *   6. hand-ins      several learners of the class answer and hand in at the same time
 *   7. scores        each learner's score must reach them within `scoreSeconds` (default 20)
 *   8. teacher view  GET /api/self-study/:id — the marks are on the teacher's list
 *
 * Instructor @tester51 owns "Tester Class A" (tester01–05, seed 2026-seed-instructor-testers.sql).
 * Everything made is deleted afterwards.
 */
import db from "../../../db.js";
import { teacherOf } from "./instructorTools.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isMcq = (q) => Array.isArray(q?.options) && q.options.length >= 2;
const maxOf = (q) => Number(q?.max_points ?? q?.points) || 0;

const GOOD = "Plants use light energy, water and carbon dioxide to make glucose and oxygen. Chlorophyll in the chloroplasts absorbs the light; the glucose is the plant's food and oxygen is released through the stomata.";
const WEAK = "Plants need sun.";

export const classAutoGrade = {
  name: "grading.class_auto_grade", area: "activities", risk: "write", timeoutMs: 480_000,
  description: "Activity Creator → assignment for a whole class: AI questions, AI rubric, the teacher edits the rubric, auto-grading on, assigned; several learners hand in at once and each gets a score within scoreSeconds (default 20); the teacher sees the marks.",
  params: { instructor: { default: "@tester51" }, className: { default: "Tester Class A" }, learners: { default: 3 }, scoreSeconds: { default: 20 } },
  async run(ctx, p) {
    const teacher = await teacherOf(ctx, p.instructor);
    const T = p.instructor;

    // The class and who is in it.
    const { data: room } = await db.from("classrooms").select("id, name").eq("teacher_id", teacher.id).eq("name", p.className).maybeSingle();
    if (!room) ctx.expect.blocked(`${p.instructor} has no class "${p.className}" (seed 2026-seed-instructor-testers.sql)`);
    const { data: roster } = await db.from("classroom_students").select("user_id").eq("classroom_id", room.id).eq("status", "active");
    const { data: users } = await db.from("users").select("id, username").in("id", (roster || []).map((r) => r.user_id));
    const pupils = (users || []).filter((u) => /^tester\d+$/.test(u.username || "")).sort((a, b) => a.username.localeCompare(b.username));
    const n = Math.max(1, Math.min(Number(p.learners) || 3, pupils.length));
    if (pupils.length < n) ctx.expect.blocked(`"${p.className}" has ${pupils.length} test learners, ${n} needed`);
    const takers = pupils.slice(0, n);
    for (const u of takers) await ctx.as(`@${u.username}`);
    ctx.note(`class "${room.name}": ${pupils.length} learners; handing in: ${takers.map((u) => "@" + u.username).join(", ")}`);

    const topic = "Photosynthesis", subject = "Basic Science";

    // 1. The plan (the form's "Draft plan").
    const plan = await ctx.http({ as: T, method: "POST", path: "/api/self-study/plan", body: { topic, subject } });
    const subtopics = (plan.body?.data?.subtopics || plan.body?.data?.plan?.subtopics || []).map((s) => (typeof s === "string" ? s : s?.title)).filter(Boolean).slice(0, 4);
    ctx.note(`plan: ${plan.status} · ${subtopics.length} subtopics`);

    // 2. The questions (the form's "Draft questions"): 10 marks, MCQ + short answer.
    const t2 = Date.now();
    const qd = await ctx.http({ as: T, method: "POST", path: "/api/self-study/assignment-draft/questions", body: {
      topic, subject, request: "3 questions: 1 multiple choice and 2 short answer", total_points: 10,
      question_types: ["MCQ", "Short answer"], difficulty: "easy", subtopics,
    } });
    ctx.expect.eq("the questions are drafted", qd.status, 200);
    const questions = (qd.body?.data?.questions || []).filter((q) => String(q?.q || "").trim());
    ctx.note(`questions drafted in ${Math.round((Date.now() - t2) / 100) / 10}s: ${questions.map((q, i) => `${i + 1}:${isMcq(q) ? "MCQ" : q.type || "written"}(${maxOf(q)})`).join(" ")}`);
    const mcqAt = questions.findIndex(isMcq);
    const writtenAt = questions.map((_, i) => i).filter((i) => !isMcq(questions[i]));
    if (!questions.length || mcqAt < 0 || !writtenAt.length) ctx.expect.blocked(`the draft didn't come back with an MCQ and a written question (${questions.length} questions)`);
    const total = questions.reduce((s, q) => s + maxOf(q), 0) || 10;

    // 3. The rubric (the form's "Draft rubric").
    const rd = await ctx.http({ as: T, method: "POST", path: "/api/self-study/assignment-draft/rubric", body: {
      topic, subject, total_points: total, question_types: ["MCQ", "Short answer"],
    } });
    ctx.expect.eq("the rubric is drafted", rd.status, 200);
    let rubric = (rd.body?.data?.rubric || []).map((r) => ({ criterion: String(r?.criterion || "").trim(), points: Number(r?.points) || 0 })).filter((r) => r.criterion);
    ctx.expect.ok("it has criteria with points", rubric.length > 0 && rubric.every((r) => r.points > 0), rd.body?.data?.rubric);
    ctx.note(`rubric: ${rubric.map((r) => `${r.criterion} (${r.points})`).join(" · ")}`);

    // 4. The teacher edits it: renames the first criterion and makes the points add up to the total.
    rubric[0] = { ...rubric[0], criterion: `${rubric[0].criterion} — names chlorophyll and light (teacher's edit)` };
    const sum = rubric.reduce((s, r) => s + r.points, 0);
    if (sum !== total && rubric.length) rubric[rubric.length - 1].points = Math.max(1, rubric[rubric.length - 1].points + (total - sum));
    ctx.note(`edited rubric adds to ${rubric.reduce((s, r) => s + r.points, 0)} of ${total}`);

    // 5. Assign — auto-grading on, the whole class (the form's payload).
    const made = await ctx.http({ as: T, method: "POST", path: "/api/self-study", body: {
      type: "assignment", title: `${ctx.marker} ${topic} — class check`, subject, topic,
      instructions: "Answer every question.", due_at: new Date(Date.now() + 3 * 864e5).toISOString(),
      details: { questions, total_points: total, ai_auto_allocate_points: true, ai_auto_grade: true, question_types: ["MCQ", "Short answer"], rubric },
      subtopics: subtopics.length ? subtopics : [topic], objectives: {}, difficulty: "easy",
      whole_class: true, classroom_id: room.id, user_ids: [], usernames: [],
    } });
    ctx.expect.eq("assigned to the class", made.status, 201);
    const id = made.body?.data?.id;
    if (!id) return;
    ctx.cleanup(() => ctx.db.deleteOwned("edu.self_study_assignments", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id } }));
    for (const u of pupils) ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: u.id, filters: { related_id: id } }).catch(() => 0));
    ctx.expect.eq("every learner in the class got it", made.body?.data?.assigned, pupils.length);
    const stored = (await ctx.db.rows("edu.self_study_assignments", { id }, { columns: "details" }))[0]?.details || {};
    ctx.expect.ok("auto-grading is on and the edited rubric is stored", stored.ai_auto_grade === true && JSON.stringify(stored.rubric || []).includes("teacher's edit"), { ai_auto_grade: stored.ai_auto_grade });

    // 6. Hand-ins, all at once: learner 1 everything right; the others mixed.
    const right = (q) => String.fromCharCode(65 + Number(q.correct ?? 0));
    const wrong = (q) => String.fromCharCode(65 + ((Number(q.correct ?? 0) + 1) % q.options.length));
    const answersFor = (k) => questions.map((q, i) => (isMcq(q) ? (k % 2 === 0 ? right(q) : wrong(q)) : (k === 0 ? GOOD : i === writtenAt[0] ? GOOD : WEAK)));
    await Promise.all(takers.map(async (u, k) => {
      const a = answersFor(k);
      for (let i = 0; i < a.length; i++) {
        const r = await ctx.http({ as: `@${u.username}`, method: "PUT", path: `/api/self-study/${id}/draft/${i}`, body: { value: a[i] } });
        if (r.status !== 200) ctx.note(`@${u.username} answer ${i + 1}: ${r.status} ${r.body?.error || ""}`);
      }
    }));
    const t0 = Date.now();
    const handed = await Promise.all(takers.map((u) => ctx.http({ as: `@${u.username}`, method: "POST", path: `/api/self-study/${id}/complete`, body: {} })));
    ctx.expect.ok("every hand-in is accepted", handed.every((h) => h.status === 200), handed.map((h) => h.status));

    // 7. Each score must reach its learner within scoreSeconds.
    const limit = Number(p.scoreSeconds) * 1000;
    const results = await Promise.all(takers.map(async (u) => {
      let row = null;
      while (Date.now() - t0 < limit + 40_000) {   // keep watching past the bar, to report how late it was
        row = ((await ctx.http({ as: `@${u.username}`, path: "/api/self-study/mine" })).body?.data || []).find((r) => r.id === id);
        if (row?.graded) break;
        await wait(1000);
      }
      return { u, row, secs: Math.round((Date.now() - t0) / 100) / 10 };
    }));
    for (const { u, row, secs } of results) {
      ctx.note(`@${u.username}: ${row?.graded ? `${row.grade}% after ${secs}s` : `not marked after ${secs}s`} · per question ${(row?.feedbackQuestions || []).map((m) => `${m.index + 1}:${m.awarded}/${m.max}`).join(" ")}`);
      ctx.expect.ok(`@${u.username}'s score arrives within ${p.scoreSeconds}s`, !!row?.graded && secs <= Number(p.scoreSeconds), { graded: !!row?.graded, secs });
      if (!row?.graded) continue;
      ctx.expect.ok(`@${u.username}: flagged as AI-marked, a mark for every question, none over its maximum`,
        row.feedbackAi === true && (row.feedbackQuestions || []).length === questions.length && row.feedbackQuestions.every((m) => m.awarded <= m.max), row.feedbackQuestions);
      ctx.expect.ok(`@${u.username}: no mark scheme or AI draft in the learner's copy`, !("ai_grade" in row) && !/mark_scheme/.test(JSON.stringify(row)));
    }
    const [best, ...rest] = results;
    if (best.row?.graded && rest.some((r) => r.row?.graded)) {
      ctx.expect.ok("the all-right answers score at least as well as the mixed ones", rest.filter((r) => r.row?.graded).every((r) => best.row.grade >= r.row.grade), results.map((r) => r.row?.grade));
      const mcqMark = (r) => (r.row.feedbackQuestions || []).find((m) => m.index === mcqAt);
      ctx.expect.eq("the multiple choice is marked from the key (right = full)", mcqMark(best)?.awarded, maxOf(questions[mcqAt]));
    }

    // 8. The teacher's view: the marks are on the activity.
    const view = await ctx.http({ as: T, path: `/api/self-study/${id}` });
    const targets = view.body?.data?.targets || view.body?.data?.assignment?.targets || [];
    const marked = targets.filter((t) => takers.some((u) => u.id === (t.student_id || t.studentId)) && (t.grade ?? t.score) != null);
    ctx.note(`teacher's view: ${view.status} · ${targets.length} learners · ${marked.length} with a mark`);
    ctx.expect.ok("the teacher sees each hand-in's mark", marked.length === takers.length, targets.slice(0, 5).map((t) => ({ s: t.student_id || t.studentId, grade: t.grade ?? t.score, status: t.status })));
  },
};

export const CLASS_GRADING = [classAutoGrade];
