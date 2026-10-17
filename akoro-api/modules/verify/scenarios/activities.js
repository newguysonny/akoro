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
    ctx.expect.eq("the paper matches the request (no warning)", paper.warning || null, null);
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

/*
 * From the instructor's chat to a learner's submission, one prompt per
 * scenario — different subjects, topics and question mixes. Each: a live
 * chat turn calls prepare_activity, the paper drafts in the background in
 * the structured output, it is checked against what was asked, assigned,
 * answered by a test learner (a choice, typed text, a whiteboard drawing)
 * and read back as the submission template.
 */
const isMcq = (q) => Array.isArray(q?.options);
const CHAT_CASES = [
  {
    key: "maths_equations", subject: "Mathematics",
    prompt: (who) => `Create an assignment for ${who} in Mathematics on simple equations (JSS2): 5 questions — 3 MCQ and 2 calculations, 10 marks in total. No diagrams.`,
    check(ctx, qs) {
      ctx.expect.eq("5 questions", qs.length, 5);
      ctx.expect.eq("3 multiple choice", qs.filter(isMcq).length, 3);
      ctx.expect.eq("2 working spaces (calculations)", qs.filter((q) => q.answer_space === "working").length, 2);
      ctx.expect.eq("10 marks", qs.reduce((s, q) => s + (Number(q.max_points) || 0), 0), 10);
    },
  },
  {
    key: "science_photosynthesis", subject: "Basic Science",
    prompt: (who) => `Prepare a Basic Science assignment on photosynthesis for ${who}: 4 questions — 2 true or false, 1 fill in the gap and 1 short answer.`,
    check(ctx, qs) {
      ctx.expect.eq("4 questions", qs.length, 4);
      const tf = qs.filter((q) => q.format === "true_false");
      ctx.expect.eq("2 true or false", tf.length, 2);
      ctx.expect.ok("true or false is answered True / False", tf.every((q) => q.answer_space === "true_false" && q.options?.join() === "True,False"), tf);
      const gap = qs.filter((q) => q.answer_space === "blank");
      ctx.expect.eq("1 fill in the gap", gap.length, 1);
      ctx.expect.ok("the gap is written as ____ in the sentence", /_{3,}/.test(gap[0]?.q || ""), gap[0]?.q);
      ctx.expect.ok("the short answer has lines", qs.some((q) => q.answer_space === "lines"), qs.map((q) => q.answer_space));
    },
  },
  {
    key: "economics_case_study", subject: "Economics", instructor: "@tester52",
    prompt: (who) => `Set an Economics assignment for ${who} on demand and supply (SS1): one case study with 2 questions about it, plus 2 objective questions with 5 options each (A–E).`,
    check(ctx, qs, paper) {
      ctx.expect.eq("4 questions", qs.length, 4);
      const cs = qs.filter((q) => q.format === "case_study");
      ctx.expect.eq("2 case-study questions", cs.length, 2);
      ctx.expect.ok("the case study is written once and both questions point at it", (paper.passages || []).length >= 1 && cs.every((q) => Number.isInteger(q.passage) && paper.passages[q.passage]?.text), { passages: paper.passages?.length, cs });
      const mcq = qs.filter(isMcq);
      ctx.expect.eq("2 objective questions", mcq.length, 2);
      ctx.expect.ok("5 options each", mcq.every((q) => q.options.length === 5), mcq.map((q) => q.options.length));
    },
  },
  {
    key: "biology_cell", subject: "Biology", instructor: "@tester52",
    prompt: (who) => `Biology assignment for ${who} on the cell (SS1): 3 questions — 1 labelling question on a diagram of an animal cell, 1 assertion and reason, and 1 essay.`,
    check(ctx, qs) {
      ctx.expect.eq("3 questions", qs.length, 3);
      const lab = qs.find((q) => q.format === "label");
      ctx.expect.ok("a labelling question with parts to name", lab?.answer_space === "labels" && (lab.labels || []).length >= 2, lab && { labels: lab.labels, space: lab.answer_space });
      ctx.expect.ok("the labelling question has a figure, or a note of the one to add", !!(lab?.figure || lab?.figure_note), lab && { figure: !!lab.figure, note: lab.figure_note });
      const ar = qs.find((q) => q.format === "assertion_reason");
      ctx.expect.ok("an assertion and reason with the 4 standard options", ar?.answer_space === "options" && ar.options?.length === 4 && ar.assertion && ar.reason, ar);
      ctx.expect.ok("the essay has lines", qs.some((q) => /essay/i.test(q.type || "") && q.answer_space === "lines"), qs.map((q) => [q.type, q.answer_space]));
    },
  },
];

function chatToSubmission(c) {
  return {
    name: `activity.chat_${c.key}`, area: "activities", risk: "write",
    description: `Instructor chat → assignment → learner submission (${c.subject}): the paper drafts in the structured output and matches the request; the learner's work reads back as the submission template.`,
    params: { instructor: { default: c.instructor || "@tester51" }, learner: { default: "@tester19" } },
    async run(ctx, p) {
      const teacher = await ctx.as(p.instructor);
      if (teacher.role !== "instructor") ctx.expect.blocked(`${p.instructor} isn't an instructor (seed 2026-seed-instructor-testers.sql)`);
      const learner = await ctx.as(p.learner);

      // 1. The instructor asks in chat; the agent prepares the draft.
      const turn = await ctx.agent.chat({ as: p.instructor, mode: "live", prompt: c.prompt(`@${learner.username}`) });
      ctx.expect.eq("turn answered", turn.status, 200);
      const prep = (turn.tools || []).filter((t) => t.tool === "prepare_activity").at(-1);
      ctx.expect.ok("the agent called prepare_activity", !!prep, (turn.tools || []).map((t) => t.tool));
      const draftId = prep?.result?.draftId;
      ctx.expect.ok("a draft was prepared", !!draftId, prep?.result);
      if (!draftId) return;
      ctx.cleanup(() => ctx.db.deleteOwned("activity_drafts", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id: draftId } }));
      ctx.note(`question_request: ${prep.input?.question_request || "—"} · plan: ${JSON.stringify(prep.input?.question_plan || null)}`);
      ctx.expect.eq("the subject", prep.input?.subject, c.subject);

      // 2. Version 1 drafts in the background.
      const v1 = await ctx.until(async () => {
        const r = await ctx.http({ as: p.instructor, path: `/api/self-study/drafts/${draftId}` });
        const v = (r.body?.data?.draft?.payload?.versions || [])[0];
        return v && v.status !== "drafting" ? v : null;
      }, { timeoutMs: 150_000, everyMs: 5_000 });
      ctx.expect.eq("version 1 is ready", v1?.status, "ready");
      if (v1?.status !== "ready") { ctx.note(`version 1: ${v1?.error || "still drafting"}`); return; }
      const paper = v1.paper || {};
      const qs = paper.questions || [];
      ctx.note(`warning: ${v1.warning || "none"} · ${JSON.stringify(qs.map((q) => ({ type: q.type, format: q.format || null, space: q.answer_space || null, pts: q.max_points })))}`);
      ctx.expect.ok("every question has an answer space", qs.every((q) => SPACES.includes(q.answer_space)), qs.map((q) => q.answer_space));
      ctx.expect.ok("every question has a marking-scheme line", qs.every((q) => typeof q.marking === "string" && q.marking.trim()), qs.map((q) => q.marking || null));
      ctx.expect.ok("multiple choice keeps its key", qs.filter(isMcq).every((q) => Number.isInteger(q.correct)));
      ctx.expect.eq("the paper matches the request (no warning for the teacher)", v1.warning || null, null);
      c.check(ctx, qs, paper);
      if (!qs.length) return;

      // 3. The instructor assigns it.
      const made = await ctx.http({ as: p.instructor, method: "POST", path: `/api/self-study/drafts/${draftId}/assign`, body: { title: `${ctx.marker} ${c.subject}` } });
      ctx.expect.eq("assigned", made.status, 201);
      const id = made.body?.data?.id;
      if (!id) return;
      ctx.cleanup(() => ctx.db.deleteOwned("edu.self_study_assignments", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id } }));
      ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: learner.id, filters: { related_id: id } }));

      // The paper template, rendered by the server: the teacher's paper + marking scheme, the learner's paper.
      const html = (r) => r.status === 200 && /text\/html/.test(r.headers["content-type"] || "");
      ctx.expect.ok("the teacher's paper renders (template)", html(await ctx.http({ as: p.instructor, path: `/api/self-study/${id}/paper.html?copy=both` })));
      ctx.expect.ok("the draft's paper renders", html(await ctx.http({ as: p.instructor, path: `/api/self-study/drafts/${draftId}/paper.html?version=${v1.n}&key=1&embed=1` })));
      ctx.expect.ok("the learner's paper renders", html(await ctx.http({ as: p.learner, path: `/api/self-study/${id}/paper.html?copy=teacher` })));

      // The learner's copy: no answer key, no marking scheme.
      const mine = await ctx.http({ as: p.learner, path: "/api/self-study/mine" });
      const brief = JSON.stringify((Array.isArray(mine.body?.data) ? mine.body.data : []).find((a) => a.id === id)?.details || {});
      ctx.expect.ok("the learner sees the paper", brief.includes(String(qs[0].q).slice(0, 20)), brief.slice(0, 200));
      ctx.expect.ok("the learner's copy has no marking scheme or key", !/"marking"|"correct"/.test(brief));

      // 4. The learner answers: a choice, typed text, and a whiteboard drawing.
      const at = { mcq: qs.findIndex(isMcq), open: qs.findIndex((q) => !isMcq(q) && q.format !== "label") };
      let answered = 0;
      if (at.mcq >= 0) {
        const r = await ctx.http({ as: p.learner, method: "PUT", path: `/api/self-study/${id}/draft/${at.mcq}`, body: { value: "B" } });
        ctx.expect.eq("choice saved", r.status, 200); answered++;
      }
      if (at.open >= 0) {
        const r = await ctx.http({ as: p.learner, method: "PUT", path: `/api/self-study/${id}/draft/${at.open}`, body: { value: "My answer, with working below." } });
        ctx.expect.eq("typed answer saved", r.status, 200); answered++;
        const png = boardDrawing();
        const up = await ctx.http({ as: p.learner, method: "POST", path: `/api/self-study/${id}/files`, body: { name: `drawing-q${at.open + 1}.png`, data: png.toString("base64"), question: at.open } });
        ctx.expect.eq("drawing uploaded", up.status, 200);
        const row = (await ctx.db.rows("edu.self_study_files", { id: up.body?.data?.id }, { columns: "id, size" }))[0];
        ctx.expect.ok(`the stored drawing is cropped (${row?.size} of ${png.length} bytes)`, row && row.size < png.length * 0.6, row);
      }
      const done = await ctx.http({ as: p.learner, method: "POST", path: `/api/self-study/${id}/complete`, body: {} });
      ctx.expect.eq("handed in", done.status, 200);

      ctx.expect.ok("the submission paper renders", html(await ctx.http({ as: p.learner, path: `/api/self-study/targets/${(await ctx.db.rows("edu.self_study_targets", { assignment_id: id, student_id: learner.id }, { columns: "id" }))[0]?.id}/submission.html` })));

      // 5. Read back as the submission template.
      const target = (await ctx.db.rows("edu.self_study_targets", { assignment_id: id, student_id: learner.id }, { columns: "id" }))[0];
      const doc = await ctx.http({ as: p.learner, path: `/api/self-study/targets/${target?.id}/submission.json` });
      ctx.expect.eq("submission document", doc.status, 200);
      const d = doc.body?.data?.document || {};
      const all = (d.parts || []).flatMap((part) => part.questions || []);
      ctx.expect.eq("numbered 1..n", all.map((q) => q.number).join(","), qs.map((_, i) => i + 1).join(","));
      ctx.expect.eq("answered", d.summary?.answered, answered);
      ctx.expect.eq("unanswered listed", (d.summary?.unanswered || []).length, qs.length - answered);
      if (at.mcq >= 0) ctx.expect.eq("the chosen option", all[at.mcq]?.answer?.selected, "B");
      if (at.open >= 0) {
        ctx.expect.eq("the typed answer under its question", all[at.open]?.answer?.text, "My answer, with working below.");
        ctx.expect.eq("the drawing under its question", all[at.open]?.answer?.drawings?.[0]?.name, `drawing-q${at.open + 1}.png`);
      }
      if ((paper.passages || []).length) ctx.expect.ok("the case study prints once in its part", (d.parts || []).some((part) => part.passages?.length), d.parts?.map((x) => x.passages?.length));
      ctx.expect.eq("total points", d.totalPoints, qs.reduce((s, q) => s + (Number(q.max_points) || 0), 0) || null);
      ctx.expect.ok("no answer key or marking in the learner's document", !/"correct"|"marking"/.test(JSON.stringify(d)));
    },
  };
}

export const chatToSubmissionScenarios = CHAT_CASES.map(chatToSubmission);
