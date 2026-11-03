/**
 * Grading settings and instant scores — deterministic scenarios (no AI model calls, so a verdict means the
 * server's rules held, not that a model behaved):
 *   grading.answer_format_enforced  how learners may answer (photos only / text only) is enforced by the server
 *   grading.mark_scheme_private     the mark scheme is stored with the assignment and never reaches a learner
 *   grading.instant_score           auto-grading on: the score reaches the learner within seconds (MCQ-only paper →
 *                                   the answer key marks it, no model); "review" holds it as the teacher's draft
 *   grading.draft_paper_review      the Review step's paper (draft.html) works before hand-in, for the learner only
 */
import { createCanvas } from "@napi-rs/canvas";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const png = () => {
  const c = createCanvas(40, 40);
  const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, 40, 40); x.fillStyle = "#111"; x.fillRect(8, 8, 24, 6);
  return c.toBuffer("image/png");
};

const OPEN = { q: "Explain why the sky is blue.", type: "short_answer", max_points: 4 };
const MCQ = { q: "Which is a noble gas?", options: ["Oxygen", "Neon", "Iron", "Sodium"], correct: 1, max_points: 2, type: "mcq" };

/** Assign a paper to the learner; returns { id, target } and registers cleanup. */
async function assign(ctx, p, teacher, learner, label, details) {
  const made = await ctx.http({ as: p.instructor, method: "POST", path: "/api/self-study", body: {
    type: "assignment", title: `${ctx.marker} ${label}`, subject: "Chemistry", topic: "Gases",
    usernames: [learner.username], details,
  } });
  ctx.expect.eq(`${label}: assigned`, made.status, 201);
  const id = made.body?.data?.id;
  if (!id) return {};
  ctx.cleanup(() => ctx.db.deleteOwned("edu.self_study_assignments", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id } }));
  ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: learner.id, filters: { related_id: id } }));
  return { id };
}

async function people(ctx, p) {
  const teacher = await ctx.as(p.instructor);
  if (teacher.role !== "instructor") ctx.expect.blocked(`${p.instructor} isn't an instructor (seed 2026-seed-instructor-testers.sql)`);
  return { teacher, learner: await ctx.as(p.learner) };
}

const PARAMS = { instructor: { default: "@tester51" }, learner: { default: "@tester19" } };

export const answerFormatEnforced = {
  name: "grading.answer_format_enforced", area: "activities", risk: "write",
  description: "An assignment's answer format is enforced by the server: photos-only refuses typed answers to open questions (but not choosing an option) and takes a photo; text-only refuses a photo and takes typing.",
  params: PARAMS,
  async run(ctx, p) {
    const { teacher, learner } = await people(ctx, p);
    const photos = await assign(ctx, p, teacher, learner, "Photos only", { questions: [OPEN, MCQ], answer_format: "images", ai_auto_grade: false });
    const typed = await assign(ctx, p, teacher, learner, "Text only", { questions: [OPEN, MCQ], answer_format: "text", ai_auto_grade: false });
    if (!photos.id || !typed.id) return;

    // The learner's copy says how to answer.
    const mine = await ctx.http({ as: p.learner, path: "/api/self-study/mine" });
    const row = (id) => (mine.body?.data || []).find((r) => r.id === id);
    ctx.expect.eq("photos-only is carried to the learner", row(photos.id)?.details?.answer_format, "images");
    ctx.expect.eq("text-only is carried to the learner", row(typed.id)?.details?.answer_format, "text");

    // Photos only.
    const t1 = await ctx.http({ as: p.learner, method: "PUT", path: `/api/self-study/${photos.id}/draft/0`, body: { value: "Because of scattering." } });
    ctx.expect.eq("photos-only: a typed answer to an open question is refused", t1.status, 400);
    const m1 = await ctx.http({ as: p.learner, method: "PUT", path: `/api/self-study/${photos.id}/draft/1`, body: { value: "B" } });
    ctx.expect.eq("photos-only: choosing an option is still allowed", m1.status, 200);
    const f1 = await ctx.http({ as: p.learner, method: "POST", path: `/api/self-study/${photos.id}/files`, body: { name: "answer-q1.png", data: png().toString("base64"), question: 0 } });
    ctx.expect.eq("photos-only: a photo is accepted", f1.status, 200);

    // Text only.
    const f2 = await ctx.http({ as: p.learner, method: "POST", path: `/api/self-study/${typed.id}/files`, body: { name: "answer-q1.png", data: png().toString("base64"), question: 0 } });
    ctx.expect.eq("text-only: a photo is refused", f2.status, 400);
    const t2 = await ctx.http({ as: p.learner, method: "PUT", path: `/api/self-study/${typed.id}/draft/0`, body: { value: "Because of scattering." } });
    ctx.expect.eq("text-only: typing is accepted", t2.status, 200);
  },
};

export const markSchemePrivate = {
  name: "grading.mark_scheme_private", area: "activities", risk: "write",
  description: "A mark scheme saved on an assignment is stored for the AI marker but never appears in anything a learner can fetch.",
  params: PARAMS,
  async run(ctx, p) {
    const { teacher, learner } = await people(ctx, p);
    const scheme = { criteria: [{ id: "c1", title: "Reason", marking_points: [{ id: "c1m1", looks_for: "Names scattering", model_answer: "SECRET-MODEL-ANSWER", points: 4, levels: [{ points: 0, label: "None", descriptor: "x" }, { points: 4, label: "Full", descriptor: "y" }] }], questions: [0] }] };
    const a = await assign(ctx, p, teacher, learner, "Mark scheme", { questions: [OPEN], ai_auto_grade: true, mark_scheme: scheme });
    if (!a.id) return;
    const stored = (await ctx.db.rows("edu.self_study_assignments", { id: a.id }, { columns: "id, details" }))[0];
    if (!stored?.details?.mark_scheme) ctx.expect.blocked("the server did not store details.mark_scheme on create — nothing to hide");
    const mine = await ctx.http({ as: p.learner, path: "/api/self-study/mine" });
    ctx.expect.eq("learner list", mine.status, 200);
    const text = JSON.stringify(mine.body || {});
    ctx.expect.ok("the mark scheme is not in the learner's list", !/mark_scheme|SECRET-MODEL-ANSWER/.test(text));
  },
};

export const instantScore = {
  name: "grading.instant_score", area: "activities", risk: "write",
  description: "With auto-grading on, a hand-in is marked at once and the learner gets the score within seconds (an MCQ-only paper is marked from the key, no model); with the score held for review it stays the teacher's draft.",
  params: { ...PARAMS, waitSeconds: { default: 25 } },
  async run(ctx, p) {
    const { teacher, learner } = await people(ctx, p);
    const paper = { questions: [MCQ, { ...MCQ, q: "Which metal is liquid at room temperature?", options: ["Iron", "Mercury", "Gold", "Zinc"], correct: 1 }], ai_auto_grade: true };
    const instant = await assign(ctx, p, teacher, learner, "Instant score", paper);
    const held = await assign(ctx, p, teacher, learner, "Held for review", { ...paper, ai_release: "review" });
    if (!instant.id || !held.id) return;

    for (const id of [instant.id, held.id]) {
      // One right, one wrong.
      ctx.expect.eq("answer 1", (await ctx.http({ as: p.learner, method: "PUT", path: `/api/self-study/${id}/draft/0`, body: { value: "B" } })).status, 200);
      ctx.expect.eq("answer 2", (await ctx.http({ as: p.learner, method: "PUT", path: `/api/self-study/${id}/draft/1`, body: { value: "A" } })).status, 200);
      ctx.expect.eq("handed in", (await ctx.http({ as: p.learner, method: "POST", path: `/api/self-study/${id}/complete`, body: {} })).status, 200);
    }

    // Instant: the score lands within seconds.
    const t0 = Date.now();
    let row = null;
    while (Date.now() - t0 < Number(p.waitSeconds) * 1000) {
      const mine = await ctx.http({ as: p.learner, path: "/api/self-study/mine" });
      row = (mine.body?.data || []).find((r) => r.id === instant.id);
      if (row?.graded) break;
      await wait(1500);
    }
    const secs = Math.round((Date.now() - t0) / 100) / 10;
    ctx.note(`score reached the learner after ${secs}s`);
    ctx.expect.ok(`the score reaches the learner within ${p.waitSeconds}s`, !!row?.graded, { aiMarking: row?.aiMarking, grade: row?.grade });
    ctx.expect.eq("1 of 2 marks → 50%", row?.grade, 50);
    ctx.expect.ok("flagged as AI-marked", row?.feedbackAi === true, row?.feedbackAi);
    ctx.expect.eq("a mark per question", (row?.feedbackQuestions || []).map((m) => `${m.index}:${m.awarded}/${m.max}`).join(","), "0:2/2,1:0/2");
    ctx.expect.eq("no longer marking", row?.aiMarking, false);
    ctx.expect.ok("the AI's draft itself is never in the learner's list", row && !("ai_grade" in row) && !/mark_scheme/.test(JSON.stringify(row)));

    // Held: the draft exists for the teacher, the learner has no score.
    let draft = null;
    for (let i = 0; i < 12; i++) {
      draft = (await ctx.db.rows("edu.self_study_targets", { assignment_id: held.id, student_id: learner.id }, { columns: "grade, ai_grade" }))[0];
      if (draft?.ai_grade?.status === "ready") break;
      await wait(1500);
    }
    ctx.expect.eq("held: the AI's draft is ready for the teacher", draft?.ai_grade?.status, "ready");
    ctx.expect.eq("held: no grade is published", draft?.grade ?? null, null);
    const mine2 = await ctx.http({ as: p.learner, path: "/api/self-study/mine" });
    const heldRow = (mine2.body?.data || []).find((r) => r.id === held.id);
    ctx.expect.eq("held: the learner sees no score", heldRow?.graded, false);
    ctx.expect.eq("held: the learner is not told it's being marked", heldRow?.aiMarking, false);
  },
};

export const draftPaperReview = {
  name: "grading.draft_paper_review", area: "activities", risk: "write",
  description: "The Review step's paper (draft.html) renders the learner's answers so far on the paper template before hand-in — for the learner only; the handed-in copy still isn't there until they submit.",
  params: { ...PARAMS, other: { default: "@tester20" } },
  async run(ctx, p) {
    const { teacher, learner } = await people(ctx, p);
    const a = await assign(ctx, p, teacher, learner, "Review paper", { questions: [OPEN, MCQ], ai_auto_grade: false });
    if (!a.id) return;
    ctx.expect.eq("typed answer saved", (await ctx.http({ as: p.learner, method: "PUT", path: `/api/self-study/${a.id}/draft/0`, body: { value: "Light scatters." } })).status, 200);
    ctx.expect.eq("photo uploaded", (await ctx.http({ as: p.learner, method: "POST", path: `/api/self-study/${a.id}/files`, body: { name: "work.png", data: png().toString("base64"), question: 0 } })).status, 200);
    const target = (await ctx.db.rows("edu.self_study_targets", { assignment_id: a.id, student_id: learner.id }, { columns: "id" }))[0];
    if (!target) ctx.expect.blocked("the learner's target row wasn't found");

    const draft = await ctx.http({ as: p.learner, path: `/api/self-study/targets/${target.id}/draft.html?embed=1` });
    ctx.expect.eq("the learner's draft paper", draft.status, 200);
    ctx.expect.ok("it's an HTML page", /html/i.test(draft.headers["content-type"] || "") && /<html|<!doctype/i.test(String(draft.body)), draft.headers);
    const early = await ctx.http({ as: p.learner, path: `/api/self-study/targets/${target.id}/submission.html` });
    ctx.expect.eq("the handed-in copy doesn't exist before hand-in", early.status, 400);
    const teach = await ctx.http({ as: p.instructor, path: `/api/self-study/targets/${target.id}/draft.html` });
    ctx.expect.ok("the teacher can't read a learner's unsubmitted draft", teach.status === 403, teach.status);
    const other = await ctx.as(p.other).catch(() => null);
    if (other) {
      const o = await ctx.http({ as: p.other, path: `/api/self-study/targets/${target.id}/draft.html` });
      ctx.expect.eq("another learner can't read it", o.status, 403);
    }
  },
};

export const gradingScenarios = [answerFormatEnforced, markSchemePrivate, instantScore, draftPaperReview];
