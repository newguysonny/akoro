/**
 * grading.photo_answer — Option B (2026-11-08): a learner answers written questions with photos of their
 * handwriting (the camera button), and the AI marker reads the photos itself — one call reads and marks.
 *
 *   learner 1: Q2 and Q3 answered with photos of correct answers; Q3's photo has a crossed-out word
 *   learner 2: Q2 typed (weak), Q3 answered with a photo about a DIFFERENT topic — proves the marker reads it
 * Checks per learner: the score arrives within scoreSeconds; the marker's reading of each photo (`read`,
 * teacher-only) matches the handwriting; the crossed-out word is marked ~~like this~~ and not credited;
 * the right photo answer earns marks, the off-topic one doesn't. Reports which model marked and its time.
 * Handwriting samples: modules/verify/fixtures/handwriting/ (truth.json).
 */
import { readFile } from "node:fs/promises";
import { teacherOf } from "./instructorTools.js";
import { wordRecall } from "./handwritingRead.js";

const DIR = new URL("../fixtures/handwriting/", import.meta.url);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const photo = async (id) => (await readFile(new URL(`${id}.jpg`, DIR))).toString("base64");

const PAPER = [
  { q: "Which gas do plants take in for photosynthesis?", options: ["Oxygen", "Carbon dioxide", "Nitrogen", "Hydrogen"], correct: 1, max_points: 2, type: "mcq" },
  { q: "Explain osmosis.", type: "short_answer", max_points: 4, answer: "The movement of water from a dilute solution to a more concentrated solution through a partially permeable membrane." },
  { q: "What is respiration, and where in the cell does it happen?", type: "short_answer", max_points: 4, answer: "Respiration releases energy from glucose using oxygen, giving carbon dioxide and water; it happens in the mitochondria." },
];

export const photoAnswer = {
  name: "grading.photo_answer", area: "activities", risk: "write", timeoutMs: 300_000,
  description: "Camera answers marked by the AI reading the photos itself (Option B): handwriting read back correctly, a crossed-out word not credited, a right photo answer earns marks and an off-topic one doesn't, each score within scoreSeconds; reports the marking model and time.",
  params: { instructor: { default: "@tester51" }, learners: { default: "@tester04,@tester05" }, scoreSeconds: { default: 20 }, minRecall: { default: 0.8 } },
  async run(ctx, p) {
    const teacher = await teacherOf(ctx, p.instructor);
    const [a, b] = String(p.learners).split(",").map((s) => s.trim());
    const A = await ctx.as(a), Bl = await ctx.as(b);
    const truth = JSON.parse(await readFile(new URL("truth.json", DIR), "utf8"));

    const made = await ctx.http({ as: p.instructor, method: "POST", path: "/api/self-study", body: {
      type: "assignment", title: `${ctx.marker} Cells — photo answers`, subject: "Basic Science", topic: "Cells",
      usernames: [A.username, Bl.username],
      details: { questions: PAPER, total_points: 10, ai_auto_grade: true, answer_format: "images_text" },
    } });
    ctx.expect.eq("assigned", made.status, 201);
    const id = made.body?.data?.id;
    if (!id) return;
    ctx.cleanup(() => ctx.db.deleteOwned("edu.self_study_assignments", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id } }));
    for (const u of [A, Bl]) ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: u.id, filters: { related_id: id } }).catch(() => 0));

    const as = (u) => `@${u.username}`;
    const put = (u, i, value) => ctx.http({ as: as(u), method: "PUT", path: `/api/self-study/${id}/draft/${i}`, body: { value } });
    const up = async (u, i, sample) => {
      const r = await ctx.http({ as: as(u), method: "POST", path: `/api/self-study/${id}/files`, body: { name: `${sample}.jpg`, data: await photo(sample), question: i } });
      ctx.expect.eq(`${as(u)}: photo for Q${i + 1} uploaded`, r.status, 200);
    };
    // Learner 1: MCQ right; Q2 + Q3 as photos of correct answers (Q3 has a crossed-out word).
    await put(A, 0, "B"); await up(A, 1, "fast-osmosis"); await up(A, 2, "crossed-out-respiration");
    // Learner 2: MCQ right; Q2 typed weak; Q3 a photo about photosynthesis — the wrong topic.
    await put(Bl, 0, "B"); await put(Bl, 1, "Water moves."); await up(Bl, 2, "neat-photosynthesis");

    const t0 = Date.now();
    const handed = await Promise.all([A, Bl].map((u) => ctx.http({ as: as(u), method: "POST", path: `/api/self-study/${id}/complete`, body: {} })));
    ctx.expect.ok("both handed in", handed.every((h) => h.status === 200), handed.map((h) => `${h.status} ${h.body?.error || ""}`));

    const rows = await Promise.all([A, Bl].map(async (u) => {
      let row = null;
      while (Date.now() - t0 < (Number(p.scoreSeconds) + 40) * 1000) {
        row = ((await ctx.http({ as: as(u), path: "/api/self-study/mine" })).body?.data || []).find((r) => r.id === id);
        if (row?.graded) break;
        await wait(1000);
      }
      return { u, row, secs: Math.round((Date.now() - t0) / 100) / 10 };
    }));
    const drafts = await ctx.db.rows("edu.self_study_targets", { assignment_id: id }, { columns: "student_id, ai_grade, graded_at, submission" });
    const draftOf = (u) => drafts.find((d) => d.student_id === u.id)?.ai_grade || null;

    for (const { u, row, secs } of rows) {
      const d = draftOf(u);
      const server = (() => { const t = drafts.find((x) => x.student_id === u.id); return t?.graded_at && t?.submission?.submittedAt ? Math.round((Date.parse(t.graded_at) - Date.parse(t.submission.submittedAt)) / 100) / 10 : null; })();
      ctx.note(`${as(u)}: ${row?.graded ? `${row.grade}% after ${secs}s` : `not marked after ${secs}s (draft: ${d?.status || "none"}${d?.error ? ` — ${d.error}` : ""})`} · model ${d?.model || "?"} · marking ${d?.timing?.totalMs ?? "?"}ms (model ${d?.timing?.modelMs ?? "?"}ms) · hand-in → grade ${server ?? "?"}s`);
      for (const q of d?.questions || []) if (q.read) ctx.note(`${as(u)} Q${q.index + 1} read: "${String(q.read).replace(/\s+/g, " ").slice(0, 170)}" → ${q.awarded}/${q.max}`);
      ctx.expect.ok(`${as(u)}: the score arrives within ${p.scoreSeconds}s`, !!row?.graded && secs <= Number(p.scoreSeconds), { graded: !!row?.graded, secs, draft: d?.status, error: d?.error });
    }

    const dA = draftOf(A), dB = draftOf(Bl);
    const q = (d, i) => (d?.questions || []).find((x) => x.index === i) || {};
    // The photos were read (by the marker itself).
    ctx.expect.ok(`learner 1's osmosis photo is read back (≥ ${Math.round(p.minRecall * 100)}% of the words)`, wordRecall(truth["fast-osmosis"], q(dA, 1).read) >= Number(p.minRecall), q(dA, 1).read);
    ctx.expect.ok(`learner 1's respiration photo is read back`, wordRecall(truth["crossed-out-respiration"], q(dA, 2).read) >= Number(p.minRecall), q(dA, 2).read);
    ctx.expect.ok("the crossed-out word is marked as crossed out", /~~\s*energy\s*~~/i.test(q(dA, 2).read || ""), q(dA, 2).read);
    // Marks follow what the photos say.
    ctx.expect.ok("a right photo answer earns marks (osmosis)", (q(dA, 1).awarded ?? 0) >= 2, q(dA, 1));
    ctx.expect.ok("a right photo answer earns marks (respiration)", (q(dA, 2).awarded ?? 0) >= 2, q(dA, 2));
    ctx.expect.ok("an off-topic photo earns little or nothing", (q(dB, 2).awarded ?? 99) <= 1, q(dB, 2));
    ctx.expect.ok("learner 1 scores above learner 2", (rows[0].row?.grade ?? -1) > (rows[1].row?.grade ?? 101), rows.map((r) => r.row?.grade));
  },
};
