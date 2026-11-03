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
import { teacherOf, toolsOf, lastCall, talk, cleanSlate } from "./instructorTools.js";

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

/* ── The model-dependent path: rubric written by the AI, answers marked against it ───────────────────────────── */

const draftOf = async (ctx, as, id) => (await ctx.http({ as, path: `/api/self-study/drafts/${id}` })).body?.data?.draft || null;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export const rubricToInstantScore = {
  name: "grading.rubric_to_instant_score", area: "activities", risk: "write",
  description: "Uses the real model. An assignment drafted in chat; auto-grading switched on → the AI writes a mark scheme whose points add up to every question's marks; Assign waits for it; the teacher edits it; assigned, the learner never sees it; a typed answer handed in is marked against it and the score reaches the learner in seconds (a good answer beats a blank one).",
  params: { instructor: { default: "@tester51" }, learner: { default: "@tester19" }, markSeconds: { default: 90 } },
  async run(ctx, p) {
    const teacher = await teacherOf(ctx, p.instructor);
    await cleanSlate(ctx, teacher);
    const learner = await ctx.as(p.learner);
    const say = talk(ctx, p, teacher);

    // 1. A draft from chat: one multiple choice, two written answers.
    const t1 = await say(`Prepare a Basic Science assignment on photosynthesis for @${learner.username} (JSS1): 3 questions — 1 MCQ and 2 short answer questions, 10 marks in total.`, "prepare");
    const prep = lastCall(t1, "prepare_activity");
    ctx.expect.ok("the agent called prepare_activity", !!prep, toolsOf(t1));
    const draftId = prep?.result?.draftId;
    if (!draftId) return;
    const v1 = await ctx.until(async () => {
      const v = ((await draftOf(ctx, p.instructor, draftId))?.payload?.versions || [])[0];
      return v && v.status !== "drafting" ? v : null;
    }, { timeoutMs: 150_000, everyMs: 5_000 });
    ctx.expect.eq("version 1 is ready", v1?.status, "ready");
    if (v1?.status !== "ready") return;
    const qs = v1.paper?.questions || [];
    const mcqAt = qs.findIndex((q) => Array.isArray(q.options));
    const openAt = qs.map((q, i) => i).filter((i) => !Array.isArray(qs[i].options));
    if (mcqAt < 0 || openAt.length < 2) ctx.expect.blocked(`the paper didn't come back as 1 MCQ + 2 written (got ${qs.length} questions)`);
    const maxOf = (q) => Number(q.max_points ?? q.points) || 0;

    // 2. Switch auto-grading on (and set the answer format): the rubric starts being written.
    const set = await ctx.http({ as: p.instructor, method: "PUT", path: `/api/self-study/drafts/${draftId}/settings`, body: { ai_auto_grade: true, answer_format: "images_text", version: 1 } });
    ctx.expect.eq("settings saved", set.status, 200);
    ctx.expect.eq("auto-grading on", set.body?.data?.details?.ai_auto_grade, true);
    ctx.expect.eq("answer format kept", set.body?.data?.details?.answer_format, "images_text");
    const early = (await draftOf(ctx, p.instructor, draftId))?.payload?.versions?.[0];
    if (early?.rubric?.status === "drafting") {
      const gate = await ctx.http({ as: p.instructor, method: "POST", path: `/api/self-study/drafts/${draftId}/assign`, body: { title: `${ctx.marker} Photosynthesis`, version: 1 } });
      ctx.expect.eq("Assign waits while the rubric is being written", gate.status, 409);
    } else ctx.note(`the rubric was already ${early?.rubric?.status} when Assign was tried — the wait wasn't observable`);

    // 3. The rubric lands, and it adds up.
    const ready = await ctx.until(async () => {
      const v = (await draftOf(ctx, p.instructor, draftId))?.payload?.versions?.[0];
      return v?.rubric && v.rubric.status !== "drafting" ? v : null;
    }, { timeoutMs: 150_000, everyMs: 4_000 });
    ctx.expect.eq("the rubric is written", ready?.rubric?.status, "ready");
    const scheme = ready?.rubric?.scheme;
    ctx.expect.ok("it has criteria", scheme?.criteria?.length > 0, ready?.rubric);
    if (!scheme?.criteria?.length) return;
    for (const i of openAt) {
      const cs = scheme.criteria.filter((c) => c.question === i);
      const pts = sum(cs.flatMap((c) => (c.marking_points || []).map((m) => Number(m.points) || 0)));
      ctx.expect.ok(`question ${i + 1} is covered`, cs.length > 0, scheme.criteria.map((c) => c.question));
      ctx.expect.eq(`question ${i + 1}: marking points add up to its marks`, pts, maxOf(qs[i]));
      ctx.expect.ok(`question ${i + 1}: every marking point has levels from none to full`, cs.every((c) => (c.marking_points || []).every((m) => (m.levels || []).length >= 2 && m.levels.some((l) => l.points === 0) && m.levels.some((l) => l.points === m.points))));
    }
    ctx.expect.ok("a keyed multiple choice gets no rubric rows", !scheme.criteria.some((c) => c.question === mcqAt), scheme.criteria.map((c) => c.question));

    // 4. The teacher edits one marking point; it is kept and flagged as edited.
    const edited = JSON.parse(JSON.stringify(scheme));
    const mp = edited.criteria.find((c) => c.question === openAt[0])?.marking_points?.[0];
    if (mp) mp.looks_for = "EDITED-BY-TEACHER names the role of light";
    const put = await ctx.http({ as: p.instructor, method: "PUT", path: `/api/self-study/drafts/${draftId}/versions/1/rubric`, body: { scheme: edited } });
    ctx.expect.eq("the edit is saved", put.status, 200);
    const after = (await draftOf(ctx, p.instructor, draftId))?.payload?.versions?.[0]?.rubric;
    ctx.expect.eq("flagged as edited", after?.edited, true);
    ctx.expect.ok("the edit is in the scheme", JSON.stringify(after?.scheme || {}).includes("EDITED-BY-TEACHER"));
    ctx.expect.eq("points still add up after the edit", sum(after?.scheme?.criteria?.map((c) => Number(c.points) || 0) || []), sum(openAt.map((i) => maxOf(qs[i]))));

    // 5. Assigned: the scheme goes with it, to the marker only.
    const made = await ctx.http({ as: p.instructor, method: "POST", path: `/api/self-study/drafts/${draftId}/assign`, body: { title: `${ctx.marker} Photosynthesis`, version: 1 } });
    ctx.expect.eq("assigned", made.status, 201);
    const id = made.body?.data?.id;
    if (!id) return;
    ctx.cleanup(() => ctx.db.deleteOwned("edu.self_study_assignments", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id } }));
    ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: learner.id, filters: { related_id: id } }));
    const stored = (await ctx.db.rows("edu.self_study_assignments", { id }, { columns: "id, details" }))[0];
    ctx.expect.ok("the scheme is stored with the assignment", !!stored?.details?.mark_scheme?.criteria?.length);
    ctx.expect.eq("answer format is on the assignment", stored?.details?.answer_format, "images_text");
    const mine = await ctx.http({ as: p.learner, path: "/api/self-study/mine" });
    ctx.expect.ok("the learner's copy carries no mark scheme", !/mark_scheme|EDITED-BY-TEACHER/.test(JSON.stringify(mine.body || {})));

    // 6. The learner answers: MCQ right, one good written answer, one left blank → handed in.
    const right = String.fromCharCode(65 + Number(qs[mcqAt].correct ?? 0));
    await ctx.http({ as: p.learner, method: "PUT", path: `/api/self-study/${id}/draft/${mcqAt}`, body: { value: right } });
    await ctx.http({ as: p.learner, method: "PUT", path: `/api/self-study/${id}/draft/${openAt[0]}`, body: { value: "Plants use light energy, water and carbon dioxide to make glucose and oxygen. Chlorophyll in the chloroplasts absorbs the light; the glucose is the plant's food and oxygen is released through the stomata." } });
    const t0 = Date.now();
    ctx.expect.eq("handed in", (await ctx.http({ as: p.learner, method: "POST", path: `/api/self-study/${id}/complete`, body: {} })).status, 200);

    // 7. Marked against the rubric; the score reaches the learner in seconds.
    let row = null;
    while (Date.now() - t0 < Number(p.markSeconds) * 1000) {
      row = ((await ctx.http({ as: p.learner, path: "/api/self-study/mine" })).body?.data || []).find((r) => r.id === id);
      if (row?.graded) break;
      await wait(2000);
    }
    const secs = Math.round((Date.now() - t0) / 100) / 10;
    ctx.note(`the score reached the learner after ${secs}s (typed answer, real model)`);
    ctx.expect.ok(`the score reaches the learner within ${p.markSeconds}s`, !!row?.graded, { aiMarking: row?.aiMarking });
    if (!row?.graded) return;
    ctx.expect.eq("flagged as AI-marked", row.feedbackAi, true);
    const marks = new Map((row.feedbackQuestions || []).map((m) => [m.index, m]));
    ctx.expect.eq("a mark for every question", marks.size, qs.length);
    ctx.expect.eq("the multiple choice is marked from the key", marks.get(mcqAt)?.awarded, maxOf(qs[mcqAt]));
    ctx.expect.ok("no mark goes over its question's maximum", [...marks.values()].every((m) => m.awarded <= m.max), [...marks.values()]);
    ctx.expect.eq("the blank answer scores nothing", marks.get(openAt[1])?.awarded, 0);
    ctx.expect.ok("the good written answer beats the blank one", (marks.get(openAt[0])?.awarded ?? 0) > 0, marks.get(openAt[0]));
    const pts = (row.feedbackMarking || []).find((m) => m.index === openAt[0])?.criteria?.flatMap((c) => c.points) || [];
    ctx.expect.ok("the marks are shown per marking point", pts.length > 0, row.feedbackMarking);
    ctx.expect.eq("the question's mark is the sum of its marking points", sum(pts.map((m) => m.awarded)), marks.get(openAt[0])?.awarded);
    ctx.expect.ok("the AI's draft and the scheme stay out of the learner's copy", !("ai_grade" in row) && !/mark_scheme/.test(JSON.stringify(row)));
  },
};

export const gradingScenarios = [answerFormatEnforced, markSchemePrivate, instantScore, draftPaperReview, rubricToInstantScore];
