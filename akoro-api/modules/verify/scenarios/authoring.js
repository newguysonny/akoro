/**
 * Authoring an assignment the way teachers do it: a conversation, not one
 * prompt. The first ask drafts Version 1; every follow-up ("add a part with
 * true or false", "make question 2 harder", "add a diagram question", "go
 * back to version 1 and…") becomes the next version, changing only what was
 * asked. The teacher's own edits to a version are kept by the next one.
 *
 * Each turn is a live chat turn (the history carried as the app does); each
 * version is read back from the draft and checked against what was asked.
 */

const isMcq = (q) => Array.isArray(q?.options) && q.format !== "true_false";
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
const texts = (paper) => (paper?.questions || []).map((q) => norm(q.q));
const shape = (paper) => (paper?.questions || []).map((q, i) => ({
  n: i + 1, type: q.type, format: q.format || null, space: q.answer_space || null, pts: q.max_points ?? null,
  part: Number.isInteger(q.section) ? q.section : null, fig: !!q.figure, q: String(q.q || "").slice(0, 70),
}));

/** The conversation: say() sends a turn and waits for the version it starts. */
function conversation(ctx, p, teacher, learner) {
  const history = [];
  let draftId = null;
  let lastN = 0;
  const versions = new Map();

  async function draftRow() {
    const r = await ctx.http({ as: p.instructor, path: `/api/self-study/drafts/${draftId}` });
    return r.body?.data?.draft || null;
  }

  return {
    get draftId() { return draftId; },
    version: (n) => versions.get(n) || null,
    async say(prompt, label) {
      const turn = await ctx.agent.chat({ as: p.instructor, mode: "live", prompt, history: [...history] });
      ctx.expect.eq(`${label}: turn answered`, turn.status, 200);
      history.push({ role: "user", content: prompt }, { role: "assistant", content: String(turn.reply || "") });
      const tools = (turn.tools || []).map((t) => t.tool);
      // Any draft a turn prepares is the gate's to remove, the stray ones too.
      for (const t of turn.tools || []) {
        const id = t.tool === "prepare_activity" ? t.result?.draftId : null;
        if (id && id !== draftId) ctx.cleanup(() => ctx.db.deleteOwned("activity_drafts", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id } }));
      }
      if (!draftId) {
        const prep = (turn.tools || []).filter((t) => t.tool === "prepare_activity").at(-1);
        ctx.expect.ok(`${label}: the agent called prepare_activity`, !!prep, tools);
        draftId = prep?.result?.draftId || null;
        ctx.expect.ok(`${label}: a draft was prepared`, !!draftId, prep?.result);
        if (!draftId) return null;
      } else {
        const rev = (turn.tools || []).filter((t) => t.tool === "revise_activity_draft").at(-1);
        ctx.expect.ok(`${label}: the agent revised the same draft`, rev?.input?.draftId === draftId && rev?.success !== false, { tools, input: rev?.input, result: rev?.result });
        ctx.note(`${label}: question_request "${rev?.input?.question_request || "—"}" · base_version ${rev?.input?.base_version ?? "latest"}`);
      }
      // The version this turn started, once it has drafted.
      const v = await ctx.until(async () => {
        const list = (await draftRow())?.payload?.versions || [];
        const next = list.find((x) => x.n > lastN);
        return next && next.status !== "drafting" ? next : null;
      }, { timeoutMs: 180_000, everyMs: 5_000 });
      ctx.expect.eq(`${label}: the new version is ready`, v?.status, "ready");
      if (!v) return null;
      lastN = v.n;
      versions.set(v.n, v);
      ctx.note(`${label} → V${v.n}${v.basedOn ? ` (from V${v.basedOn})` : ""}: ${v.note || ""}${v.warning ? ` · warning: ${v.warning}` : ""} · ${JSON.stringify(shape(v.paper))}`);
      return v.status === "ready" ? v : null;
    },
    /** The teacher edits a version in place (the preview's editor). */
    async edit(n, mutate) {
      const v = versions.get(n);
      const paper = structuredClone(v.paper);
      mutate(paper);
      const r = await ctx.http({ as: p.instructor, method: "PUT", path: `/api/self-study/drafts/${draftId}/versions/${n}`, body: paper });
      ctx.expect.eq(`the teacher's edit to V${n} is saved`, r.status, 200);
      const saved = r.body?.data?.version;
      ctx.expect.ok(`V${n} is marked edited`, saved?.edited === true, saved && { edited: saved.edited });
      if (saved) versions.set(n, saved);
      return saved;
    },
    async assign(n, title) {
      const r = await ctx.http({ as: p.instructor, method: "POST", path: `/api/self-study/drafts/${draftId}/assign`, body: { title, version: n } });
      ctx.expect.eq(`V${n} assigned`, r.status, 201);
      const id = r.body?.data?.id;
      if (id) {
        ctx.cleanup(() => ctx.db.deleteOwned("edu.self_study_assignments", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id } }));
        ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: learner.id, filters: { related_id: id } }));
      }
      return id;
    },
  };
}

/** Every question of `before` except those at `except` (1-based) is in `after`, word for word. */
function kept(before, after, except = []) {
  const now = new Set(texts(after));
  return texts(before).filter((t, i) => !except.includes(i + 1) && !now.has(t));
}

/** The assignment's details as the learner gets them. */
async function learnerCopy(ctx, p, id) {
  const mine = await ctx.http({ as: p.learner, path: "/api/self-study/mine" });
  return (Array.isArray(mine.body?.data) ? mine.body.data : []).find((a) => a.id === id)?.details || {};
}

async function setUp(ctx, p) {
  const teacher = await ctx.as(p.instructor);
  if (teacher.role !== "instructor") ctx.expect.blocked(`${p.instructor} isn't an instructor (seed 2026-seed-instructor-testers.sql)`);
  const learner = await ctx.as(p.learner);
  return { teacher, learner };
}

export const authoringVersionsParts = {
  name: "activity.authoring_versions_parts", area: "activities", risk: "write",
  description: "A Mathematics assignment built over a conversation: V1 as asked, a new part added, specific questions edited (harder, a new type, new marks), then back to V1 for a different change — each a new version that changes only what was asked.",
  params: { instructor: { default: "@tester51" }, learner: { default: "@tester19" } },
  async run(ctx, p) {
    const { teacher, learner } = await setUp(ctx, p);
    const c = conversation(ctx, p, teacher, learner);

    // V1 — the first ask.
    const v1 = await c.say(`Create an assignment for @${learner.username} in Mathematics on linear equations (JSS3): 4 multiple choice questions, then 2 calculation questions where they show their working.`, "create");
    if (!v1) return;
    const q1 = v1.paper.questions || [];
    ctx.expect.eq("V1: 6 questions", q1.length, 6);
    ctx.expect.eq("V1: 4 multiple choice", q1.filter(isMcq).length, 4);
    ctx.expect.eq("V1: 2 working spaces", q1.filter((q) => q.answer_space === "working").length, 2);
    ctx.expect.eq("V1: two parts (choice, then working)", (v1.paper.sections || []).length, 2);
    ctx.expect.eq("V1: no warning", v1.warning || null, null);

    // V2 — a new part.
    const v2 = await c.say("Add a new part with 2 true or false questions.", "add a part");
    if (!v2) return;
    const q2 = v2.paper.questions || [];
    ctx.expect.eq("V2 is built on V1", v2.basedOn, v1.n);
    ctx.expect.eq("V2: 8 questions", q2.length, 8);
    const tf = q2.filter((q) => q.format === "true_false");
    ctx.expect.eq("V2: 2 true or false", tf.length, 2);
    ctx.expect.eq("V2: three parts", (v2.paper.sections || []).length, 3);
    ctx.expect.ok("V2: the true or false questions have a part of their own", tf.length && new Set(tf.map((q) => q.section)).size === 1 && !q2.some((q) => q.format !== "true_false" && q.section === tf[0].section), shape(v2.paper));
    ctx.expect.eq("V2: V1's questions are all kept, word for word", kept(v1.paper, v2.paper), []);

    // V3 — edit specific questions: one harder, one turned into a fill in the gap.
    const before2 = q2[1], before5 = q2[4];
    const v3 = await c.say("Make question 2 harder, and change question 5 into a fill in the gap question.", "edit questions");
    if (!v3) return;
    const q3 = v3.paper.questions || [];
    ctx.expect.eq("V3: still 8 questions", q3.length, 8);
    ctx.expect.ok("V3: question 2 was rewritten", !texts(v3.paper).includes(norm(before2?.q)), { before: before2?.q });
    ctx.expect.ok("V3: question 5 is now a fill in the gap (____)", !texts(v3.paper).includes(norm(before5?.q)) && q3.some((q) => q.answer_space === "blank" && /_{3,}/.test(q.q || "")), shape(v3.paper));
    ctx.expect.eq("V3: every other question is kept, word for word", kept(v2.paper, v3.paper, [2, 5]), []);

    // V4 — marks on one question.
    const target = q3[6];
    const v4 = await c.say("Give question 7 5 marks.", "change marks");
    if (!v4) return;
    const q4 = v4.paper.questions || [];
    const same = q4.find((q) => norm(q.q) === norm(target?.q));
    ctx.expect.ok("V4: question 7 carries 5 marks", Number(same?.max_points) === 5, same && { q: same.q, pts: same.max_points });
    ctx.expect.eq("V4: nothing else changed", kept(v3.paper, v4.paper), []);

    // V5 — back to V1, a different change.
    const v5 = await c.say("Go back to version 1 and add one essay question at the end.", "back to V1");
    if (!v5) return;
    const q5 = v5.paper.questions || [];
    ctx.expect.eq("V5 is built on V1", v5.basedOn, v1.n);
    ctx.expect.eq("V5: 7 questions", q5.length, 7);
    ctx.expect.eq("V5: V1's questions are all there", kept(v1.paper, v5.paper), []);
    ctx.expect.ok("V5: no true or false from V2", !q5.some((q) => q.format === "true_false"), shape(v5.paper));
    ctx.expect.ok("V5: an essay with lines to write on", q5.some((q) => /essay/i.test(q.type || "") && q.answer_space === "lines"), shape(v5.paper));

    // The teacher picks V3 to send: what's assigned is V3.
    const id = await c.assign(v3.n, `${ctx.marker} Linear equations`);
    if (!id) return;
    const html = await ctx.http({ as: p.instructor, path: `/api/self-study/${id}/paper.html?copy=both` });
    ctx.expect.ok("the paper renders", html.status === 200 && /text\/html/.test(html.headers["content-type"] || ""), html.status);
    const details = await learnerCopy(ctx, p, id);
    ctx.expect.eq("the learner gets V3's questions, not V5's", (details.questions || []).map((q) => norm(q.q)).join("|"), texts(v3.paper).join("|"));
  },
};

export const authoringDiagramsEdits = {
  name: "activity.authoring_diagrams_edits", area: "activities", risk: "write",
  description: "A Physics assignment built over a conversation: several question types, a diagram question added (labelled), the teacher's own edit kept by the next version, a calculation on a diagram, a question removed and one retyped — then assigned with its figures.",
  params: { instructor: { default: "@tester52" }, learner: { default: "@tester19" } },
  async run(ctx, p) {
    const { teacher, learner } = await setUp(ctx, p);
    const c = conversation(ctx, p, teacher, learner);

    const v1 = await c.say(`Prepare a Physics assignment for @${learner.username} on reflection of light (SS1): 2 multiple choice questions, 1 assertion and reason question and 1 short answer question. No diagrams for now.`, "create");
    if (!v1) return;
    const q1 = v1.paper.questions || [];
    ctx.expect.eq("V1: 4 questions", q1.length, 4);
    ctx.expect.eq("V1: 2 multiple choice", q1.filter((q) => isMcq(q) && q.format !== "assertion_reason").length, 2);
    const ar = q1.find((q) => q.format === "assertion_reason");
    ctx.expect.ok("V1: an assertion and reason, with its 4 options", ar && ar.assertion && ar.reason && ar.options?.length === 4, ar && { assertion: ar.assertion, reason: ar.reason, options: ar.options?.length });
    ctx.expect.ok("V1: a short answer with lines", q1.some((q) => q.answer_space === "lines"), shape(v1.paper));
    ctx.expect.ok("V1: no diagrams, as asked", !q1.some((q) => q.figure), shape(v1.paper));

    // V2 — a labelled diagram question.
    const v2 = await c.say("Add a diagram question: a ray diagram of light hitting a plane mirror, where the learners label the incident ray, the reflected ray and the normal.", "add a diagram");
    if (!v2) return;
    const q2 = v2.paper.questions || [];
    ctx.expect.eq("V2: 5 questions", q2.length, 5);
    const lab = q2.find((q) => q.format === "label" || q.answer_space === "labels");
    ctx.expect.ok("V2: a labelling question", !!lab, shape(v2.paper));
    ctx.expect.ok("V2: it carries its diagram (an SVG figure)", /<svg[\s>]/i.test(lab?.figure?.svg || ""), lab && { figure: !!lab.figure, note: lab.figure_note });
    ctx.expect.ok("V2: the three parts to label", (lab?.labels || []).length >= 3, lab?.labels);
    ctx.expect.ok("V2: the marking scheme names them", Object.keys(lab?.answer || {}).length >= 3 || /incident|reflected|normal/i.test(lab?.marking || ""), lab && { answer: lab.answer, marking: lab.marking });
    ctx.expect.eq("V2: V1's questions are kept", kept(v1.paper, v2.paper), []);

    // The teacher edits question 1 by hand on V2.
    const mine = `Which of these is the law of reflection? (${ctx.marker})`;
    await c.edit(v2.n, (paper) => { paper.questions[0].q = mine; });

    // V3 — a calculation on a diagram, built on the edited V2.
    const v3 = await c.say("Now add a calculation question with a diagram of a concave mirror: give the object distance and image distance, and they work out the focal length.", "diagram calculation");
    if (!v3) return;
    const q3 = v3.paper.questions || [];
    ctx.expect.eq("V3 is built on V2", v3.basedOn, v2.n);
    ctx.expect.eq("V3: 6 questions", q3.length, 6);
    ctx.expect.ok("V3: the teacher's edit is kept", texts(v3.paper).includes(norm(mine)), texts(v3.paper));
    const calc = q3.find((q) => q.answer_space === "working" && q.figure);
    ctx.expect.ok("V3: a working-space calculation with its own diagram", /<svg[\s>]/i.test(calc?.figure?.svg || ""), shape(v3.paper));
    ctx.expect.ok("V3: the labelled diagram is kept", q3.some((q) => q.figure && (q.format === "label" || q.answer_space === "labels")), shape(v3.paper));
    ctx.expect.ok("V3: the model answer is a focal length", /f\s*=|focal|cm|m\b/i.test(`${calc?.answer || ""} ${calc?.marking || ""}`), calc && { answer: calc.answer, marking: calc.marking });

    // V4 — remove one question.
    const gone = q3[2];
    const v4 = await c.say("Remove question 3.", "remove a question");
    if (!v4) return;
    ctx.expect.eq("V4: 5 questions", (v4.paper.questions || []).length, 5);
    ctx.expect.ok("V4: question 3 is gone", !texts(v4.paper).includes(norm(gone?.q)), { gone: gone?.q });
    ctx.expect.eq("V4: the rest are kept", kept(v3.paper, v4.paper, [3]), []);

    // V5 — retype one question.
    const v5 = await c.say("Change question 1 to a true or false question.", "change a type");
    if (!v5) return;
    const q5 = v5.paper.questions || [];
    ctx.expect.eq("V5: 5 questions", q5.length, 5);
    ctx.expect.eq("V5: one true or false", q5.filter((q) => q.format === "true_false").length, 1);
    ctx.expect.ok("V5: answered True / False", q5.filter((q) => q.format === "true_false").every((q) => q.answer_space === "true_false"), shape(v5.paper));
    ctx.expect.ok("V5: both diagrams are still there", q5.filter((q) => q.figure).length >= 2, shape(v5.paper));

    // Assigned: the figures print on the paper.
    const id = await c.assign(v5.n, `${ctx.marker} Reflection of light`);
    if (!id) return;
    const html = await ctx.http({ as: p.instructor, path: `/api/self-study/${id}/paper.html?copy=both` });
    ctx.expect.ok("the paper renders", html.status === 200 && /text\/html/.test(html.headers["content-type"] || ""), html.status);
    const details = await learnerCopy(ctx, p, id);
    const figs = (details.questions || []).filter((q) => /<svg[\s>]/i.test(q.figure?.svg || "")).length;
    ctx.expect.ok("the learner's paper carries both diagrams", figs >= 2, { figures: figs });
  },
};
