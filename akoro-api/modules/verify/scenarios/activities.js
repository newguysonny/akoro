/**
 * Activities on paper (reference/question-layout-for-activity/submission-crop):
 * the AI writes an assignment in the paper template's structured output, a
 * learner answers it with a whiteboard drawing (stored cropped to the
 * handwriting), and the submission reads back as the submission template.
 */
import { createCanvas } from "@napi-rs/canvas";

const SPACES = ["options", "true_false", "lines", "working", "blank", "labels"];

/** A board-sized drawing with a little handwriting in one corner. */
function boardDrawing() {
  const c = createCanvas(1200, 1600);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, 1200, 1600);
  ctx.strokeStyle = "#1E1B4B"; ctx.lineWidth = 8; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(150, 200); ctx.lineTo(420, 260); ctx.moveTo(150, 320); ctx.lineTo(380, 330); ctx.stroke();
  return c.toBuffer("image/png");
}

export const paperStructured = {
  name: "activity.paper_structured", area: "activities", risk: "write",
  description: "An AI-drafted assignment comes back in the paper's structured output (answer space and marking line per question, the requested mix); a learner's whiteboard drawing is stored cropped; the submission reads back as the submission template.",
  params: { instructor: { default: "@tester51" }, learner: { default: "@tester19" } },
  async run(ctx, p) {
    const teacher = await ctx.as(p.instructor);
    if (teacher.role !== "instructor") ctx.expect.blocked(`${p.instructor} isn't an instructor (seed 2026-seed-instructor-testers.sql)`);
    const learner = await ctx.as(p.learner);

    // 1. The paper, drafted from the teacher's words.
    const draft = await ctx.http({ as: p.instructor, method: "POST", path: "/api/self-study/assignment-draft/questions", body: {
      topic: "Simple equations", subject: "Mathematics", class_level: "JSS1",
      request: "4 questions: 2 MCQ, 1 calculation and 1 fill in the gap",
    } });
    ctx.expect.eq("draft status", draft.status, 200);
    const paper = draft.body?.data || {};
    const qs = Array.isArray(paper.questions) ? paper.questions : [];
    ctx.note(`warning: ${paper.warning || "none"} · ${JSON.stringify(qs.map((q) => ({ type: q.type, space: q.answer_space, marking: !!q.marking })))}`);
    ctx.expect.eq("4 questions", qs.length, 4);
    ctx.expect.ok("every question has an answer space", qs.every((q) => SPACES.includes(q.answer_space)), qs.map((q) => q.answer_space));
    ctx.expect.ok("every question has a marking-scheme line", qs.every((q) => typeof q.marking === "string" && q.marking.trim()), qs.map((q) => q.marking));
    const mcq = qs.filter((q) => Array.isArray(q.options));
    ctx.expect.eq("2 multiple choice", mcq.length, 2);
    ctx.expect.ok("multiple choice is answered on options", mcq.every((q) => q.answer_space === "options"), mcq.map((q) => q.answer_space));
    const calc = qs.find((q) => /calculation/i.test(q.type || ""));
    ctx.expect.ok("the calculation has a working space", calc?.answer_space === "working", calc);
    const gap = qs.find((q) => /fill/i.test(q.type || ""));
    ctx.expect.ok("the gap question has a blank, written as ____", gap?.answer_space === "blank" && /_{3,}/.test(gap?.q || ""), gap);
    if (qs.length < 2) return;

    // 2. Assigned to a test learner.
    const made = await ctx.http({ as: p.instructor, method: "POST", path: "/api/self-study", body: {
      type: "assignment", title: `${ctx.marker} Simple equations`, subject: "Mathematics", topic: "Simple equations",
      usernames: [learner.username], details: { instructions: paper.instructions, questions: qs, ai_auto_grade: false },
    } });
    ctx.expect.eq("assigned", made.status, 201);
    const id = made.body?.data?.id;
    if (!id) return;
    ctx.cleanup(() => ctx.db.deleteOwned("edu.self_study_assignments", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id } }));
    ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: learner.id, filters: { related_id: id } }));

    // 3. The learner answers: a choice on the first MCQ, a drawing on the calculation.
    const mcqAt = qs.findIndex((q) => Array.isArray(q.options));
    const drawAt = calc ? qs.indexOf(calc) : qs.findIndex((q) => !Array.isArray(q.options));
    const saved = await ctx.http({ as: p.learner, method: "PUT", path: `/api/self-study/${id}/draft/${mcqAt}`, body: { value: "B" } });
    ctx.expect.eq("answer saved", saved.status, 200);
    const png = boardDrawing();
    const up = await ctx.http({ as: p.learner, method: "POST", path: `/api/self-study/${id}/files`, body: { name: `drawing-q${drawAt + 1}.png`, data: png.toString("base64"), question: drawAt } });
    ctx.expect.eq("drawing uploaded", up.status, 200);
    const row = (await ctx.db.rows("edu.self_study_files", { id: up.body?.data?.id }, { columns: "id, size" }))[0];
    ctx.expect.ok(`the stored drawing is cropped (${row?.size} bytes, the board was ${png.length})`, row && row.size < png.length * 0.6, row);

    // 4. Handed in, and read back as the submission template.
    const done = await ctx.http({ as: p.learner, method: "POST", path: `/api/self-study/${id}/complete`, body: {} });
    ctx.expect.eq("handed in", done.status, 200);
    const target = (await ctx.db.rows("edu.self_study_targets", { assignment_id: id, student_id: learner.id }, { columns: "id" }))[0];
    const doc = await ctx.http({ as: p.learner, path: `/api/self-study/targets/${target?.id}/submission.json` });
    ctx.expect.eq("submission document", doc.status, 200);
    const d = doc.body?.data?.document || {};
    ctx.expect.eq("badge", d.header?.badge, "LEARNER SUBMISSION");
    ctx.expect.eq("answered", d.summary?.answered, 2);
    ctx.expect.eq("drawings", d.summary?.attachments?.drawings, 1);
    const all = (d.parts || []).flatMap((part) => part.questions || []);
    ctx.expect.eq("numbered 1..n", all.map((q) => q.number).join(","), qs.map((_, i) => i + 1).join(","));
    ctx.expect.eq("the chosen option", all[mcqAt]?.answer?.selected, "B");
    ctx.expect.eq("the drawing sits under its question", all[drawAt]?.answer?.drawings?.[0]?.name, `drawing-q${drawAt + 1}.png`);
    ctx.expect.ok("no answer key in the learner's copy", !JSON.stringify(d).includes('"correct"'));
  },
};
