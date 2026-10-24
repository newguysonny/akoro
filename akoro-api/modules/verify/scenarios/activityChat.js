/**
 * Suite "activity-chat" — assignments and self study set from the
 * instructor's chat, edited the way instructors edit them, assigned with their
 * class review battle, and checked where learners see them: the learner's
 * activity list and their Challenges list.
 *
 *   activity_chat.ask_missing         the agent asks for what's missing (who,
 *                                     subject) before it prepares anything,
 *                                     and a due date said only in words must be
 *                                     pinned down before it is assigned
 *   activity_chat.assignment_versions versions: make one question harder, add
 *                                     questions to Part B, go back to version 1
 *                                     and swap a question
 *   activity_chat.assignment_assign   instructions added in chat, questions
 *                                     switched in the preview, a chosen version
 *                                     assigned with its review → learners'
 *                                     copies, notifications, Challenges
 *   activity_chat.self_study_assign   the plan: a subtopic added, one removed,
 *                                     instructions added, an earlier round
 *                                     restored; assigned with its review →
 *                                     learners' copies and Challenges
 *
 * Writes on test accounts only; every draft, activity and review battle is
 * removed afterwards.
 */
import { battleClass, BATTLE_INSTRUCTOR } from "./instructorActivities.js";
import { teacherOf, toolsOf, lastCall, talk, cleanSlate, draftRow } from "./instructorTools.js";
import { cleanReviewedActivity } from "./activityReview.js";

const INSTRUCTOR = BATTLE_INSTRUCTOR;
const DAY = 86400_000;
const qText = (q) => String(q?.q ?? q?.text ?? "");
const inWords = (ms) => new Date(ms).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos" });
/** The reply asks the instructor something. */
const asks = (reply, about) => /\?|\b(send|tell|give) me\b|\blet me know\b|\bwhat i need\b/i.test(String(reply || "")) && about.test(String(reply || ""));
const prepared = (turn) => (turn.tools || []).some((t) => t.tool === "prepare_activity" && t.result?.prepared);

/** A class of the test instructor's with two test learners who have agents (the review battle needs agents). */
async function classOf(ctx) {
  const teacher = await teacherOf(ctx, INSTRUCTOR);
  await cleanSlate(ctx, teacher);
  const found = await battleClass(ctx, INSTRUCTOR, 2);
  if (!found) ctx.expect.blocked(`${INSTRUCTOR} has no class with 2 test learners who have an agent`);
  const p = { instructor: INSTRUCTOR };
  return { teacher, ...found, p, say: talk(ctx, p, teacher), who: found.learners.map((l) => `@${l.username}`).join(" and ") };
}

/** Version n of an assignment draft, once it has finished drafting (ready or failed). */
async function versionOf(ctx, draftId, n, timeoutMs = 180_000) {
  return ctx.until(async () => {
    const v = ((await draftRow(ctx, INSTRUCTOR, draftId))?.payload?.versions || []).find((x) => x.n === n);
    return v && v.status !== "drafting" ? v : null;
  }, { timeoutMs, everyMs: 5_000 });
}

/** The paper's parts: [{ title, questions: [...] }] in order (questions without a part come last). */
function partsOf(paper) {
  const sections = paper?.sections || [];
  const qs = paper?.questions || [];
  const parts = sections.map((s, i) => ({ title: s.title || "", questions: qs.filter((q) => q.section === i) }));
  const loose = qs.filter((q) => !Number.isInteger(q.section) || !sections[q.section]);
  return loose.length ? [...parts, { title: "", questions: loose }] : parts;
}
const partB = (paper) => partsOf(paper).find((x) => /^Part B\b/i.test(x.title)) || partsOf(paper)[1] || null;

/** One revise turn that must build version `n` on `base`: → the ready version, or null. */
async function reviseVersion(ctx, say, draftId, { prompt, label, n, base }) {
  const t = await say(prompt, label);
  const rev = lastCall(t, "revise_activity_draft");
  ctx.expect.ok(`${label}: the agent revised the same draft`, rev?.input?.draftId === draftId && rev?.result?.revised === true, { tools: toolsOf(t), input: rev?.input, result: rev?.result });
  ctx.expect.toolNotCalled(t, "prepare_activity");
  ctx.expect.eq(`${label}: it becomes version ${n}`, rev?.result?.version, n);
  const v = await versionOf(ctx, draftId, n);
  ctx.expect.eq(`${label}: version ${n} is ready`, v?.status, "ready");
  if (v?.status !== "ready") return null;
  ctx.expect.eq(`${label}: built on version ${base}`, v.basedOn, base);
  return v;
}

/** Assign with the review on, wait for the class review to be sent; → { id, battleId } */
async function assignWithReview(ctx, { draftId, body, learners }) {
  const at = new Date(Date.now() + DAY).toISOString();
  const made = await ctx.http({ as: INSTRUCTOR, method: "POST", path: `/api/self-study/drafts/${draftId}/assign`, body: { ...body, review: { on: true, at, questions: 5 } } });
  ctx.expect.status("assigned", made, 201);
  const id = made.body?.data?.id;
  if (!id) return {};
  cleanReviewedActivity(ctx, id);
  ctx.expect.eq("the draft is closed as assigned", (await draftRow(ctx, INSTRUCTOR, draftId))?.status, "assigned");
  // The worker sends it on assign; the gate makes sure (once per activity either way). Sent =
  // recorded on the activity, which happens after the seats are in (the battle row comes first).
  let battleId = await ctx.until(async () => (await ctx.db.rows("edu.self_study_assignments", { id }, { columns: "details" }))[0]?.details?.review?.battle_id || null, { timeoutMs: 60_000, everyMs: 3_000 });
  if (!battleId) battleId = (await (await import("../../self-study/activityReview.js")).runActivityReview(id)).battleId || null;
  ctx.expect.ok("its class review battle was sent", !!battleId);
  for (const l of learners) {
    const card = ((await ctx.http({ as: `@${l.username}`, path: "/api/battle/my-challenges" })).body?.data || []).find((c) => c.id === battleId);
    ctx.expect.ok(`@${l.username}'s Challenges list has the class review`, !!card && card.battleType === "review" && card.reviewHost === "teacher" && card.maxParticipants === learners.length, card);
  }
  return { id, battleId, at };
}

/** The learner's copy on their activity list, and the notification. */
async function learnerCopy(ctx, learner, id) {
  const copy = ((await ctx.http({ as: `@${learner.username}`, path: "/api/self-study/mine" })).body?.data || []).find((a) => a.id === id);
  ctx.expect.ok(`it is on @${learner.username}'s activity list`, !!copy, id);
  ctx.expect.gte(`@${learner.username} was notified`, await ctx.db.count("notifications", { user_id: learner.id, related_id: id }), 1);
  return copy || null;
}

/* ── The agent asks for what's missing ──────────────────────────────────── */

export const activityChatAskMissing = {
  name: "activity_chat.ask_missing", area: "instructor-chat", risk: "write", regression: false, timeoutMs: 540_000,
  description: "Strict: the agent prepares nothing until the teacher has SAID who it's for, the subject and the topic — it asks for each, even when the topic makes the subject look obvious; learners the teacher never named are asked about; a due date said only in words must be pinned down before assigning.",
  async run(ctx) {
    const { classroom, learners, say, who } = await classOf(ctx);
    const noDraft = (label, turn) => ctx.expect.ok(`${label}: nothing is prepared`, !prepared(turn), { tools: toolsOf(turn), results: (turn.tools || []).map((t) => t.result?.unsaid || t.result?.error || null) });

    // 1. No audience, no subject (fractions — the subject "looks obvious"): ask, prepare nothing.
    const t1 = await say("Prepare an assignment on fractions: 5 questions, 3 MCQ and 2 short answer.", "no audience, no subject");
    noDraft("no audience, no subject", t1);
    ctx.expect.ok("the agent asks who it is for (or the subject too)", asks(t1.reply, /\b(who|which|class|learners?|students?|subject)\b/i), t1.reply);

    // 2. Only the audience given: still no subject said → it asks for the subject.
    const t2 = await say(`It's for ${who} in ${classroom.name}.`, "audience given");
    noDraft("audience given, subject still unsaid", t2);
    ctx.expect.ok("…it asks which subject (never assumed from \"fractions\")", asks(t2.reply, /subject/i), t2.reply);

    // 3. The subject said: prepared, exactly as said.
    const t3 = await say("Mathematics.", "subject given");
    const prep = lastCall(t3, "prepare_activity");
    ctx.expect.ok("now it prepares the assignment", prep?.result?.prepared === true, { tools: toolsOf(t3), result: prep?.result });
    const d1 = prep?.result?.draftId ? await draftRow(ctx, INSTRUCTOR, prep.result.draftId) : null;
    ctx.expect.eq("an assignment in Mathematics", [d1?.type, d1?.subject || d1?.payload?.subject], ["assignment", "Mathematics"]);
    const names = (d1?.audience?.names || []).map((n) => String(n).replace(/^@/, ""));
    ctx.expect.ok("for exactly the learners named", learners.every((l) => names.includes(l.username) || (d1?.payload?.usernames || []).includes(l.username)) && names.length <= learners.length, d1?.audience);

    // 4. A new conversation: a self study whose subject the teacher never says ("measurement").
    const fresh = talk(ctx, { instructor: INSTRUCTOR }, await ctx.as(INSTRUCTOR));
    const t4 = await fresh(`Set a self study on measurement for ${who} in ${classroom.name}.`, "no subject");
    noDraft("no subject", t4);
    ctx.expect.ok("the agent asks which subject", asks(t4.reply, /subject/i), t4.reply);
    const t5 = await fresh("Basic Science, due Friday.", "subject given");
    const p5 = lastCall(t5, "prepare_activity");
    ctx.expect.ok("now it prepares the self study", p5?.result?.prepared === true, { tools: toolsOf(t5), result: p5?.result });
    const d5 = p5?.result?.draftId ? await draftRow(ctx, INSTRUCTOR, p5.result.draftId) : null;
    ctx.expect.eq("a self study in Basic Science", [d5?.type, d5?.subject || d5?.payload?.subject], ["self_study", "Basic Science"]);
    // "Friday" with no time: kept as said, and assigning asks for the exact time first.
    if (d5?.payload?.due_hint && !d5?.payload?.due_at) {
      const a = await ctx.http({ as: INSTRUCTOR, method: "POST", path: `/api/self-study/drafts/${d5.id}/assign`, body: {} });
      ctx.expect.ok("a due date said only in words must be pinned down before assigning", [400, 409].includes(a.status) && /exact due date/i.test(a.body?.error || ""), { status: a.status, body: a.body });
      ctx.expect.eq("…and the draft stays pending", (await draftRow(ctx, INSTRUCTOR, d5.id))?.status, "draft");
    } else ctx.note(`"due Friday" was resolved to ${d5?.payload?.due_at || "nothing"} (no words-only due date to pin)`);

    // 5. A new conversation: learners the teacher never named ("my best learners") — asked, not picked.
    const third = talk(ctx, { instructor: INSTRUCTOR }, await ctx.as(INSTRUCTOR));
    const t6 = await third(`Prepare a Mathematics assignment on fractions for my two best learners in ${classroom.name}: 4 MCQ.`, "unnamed learners");
    const p6 = lastCall(t6, "prepare_activity");
    if (prepared(t6)) {
      const d6 = await draftRow(ctx, INSTRUCTOR, p6.result.draftId);
      ctx.expect.ok("if prepared, it is for the class the teacher named — never two learners the agent chose", !(d6?.payload?.usernames || []).length && !(d6?.payload?.user_ids || []).length, d6?.audience);
    } else {
      ctx.expect.ok("the agent asks which learners", asks(t6.reply, /\b(which|who|learners?|students?|names?)\b/i), t6.reply);
    }
  },
};

/* ── Battles and self study ask too ─────────────────────────────────────── */

export const activityChatBattleSelfStudyAsk = {
  name: "activity_chat.battle_self_study_ask", area: "instructor-chat", risk: "write", regression: false, timeoutMs: 540_000,
  description: "The strict rule for battles and self study: a battle or a self study with no audience is asked about, learners the teacher never named are asked for (never picked), a self study's subject is asked for; each is prepared once the teacher has said it.",
  async run(ctx) {
    const { classroom, learners, who } = await classOf(ctx);
    const teacher = await ctx.as(INSTRUCTOR);
    const fresh = () => talk(ctx, { instructor: INSTRUCTOR }, teacher);
    const noDraft = (label, turn) => ctx.expect.ok(`${label}: nothing is prepared`, !prepared(turn), { tools: toolsOf(turn), results: (turn.tools || []).map((t) => t.result?.unsaid || t.result?.error || null) });

    // Battle: no audience → asked; then the class named → prepared for it.
    let say = fresh();
    const b1 = await say("Set up a battle on fractions, 10 questions.", "battle, no audience");
    noDraft("battle, no audience", b1);
    ctx.expect.ok("the agent asks who the battle is for", asks(b1.reply, /\b(who|which|class|learners?|students?)\b/i), b1.reply);
    const b2 = await say(`For ${who} in ${classroom.name}.`, "battle, audience given");
    const pb = lastCall(b2, "prepare_activity");
    ctx.expect.ok("now it prepares the battle", pb?.result?.prepared === true && pb?.input?.type === "battle", { tools: toolsOf(b2), input: pb?.input, result: pb?.result });
    const db2 = pb?.result?.draftId ? await draftRow(ctx, INSTRUCTOR, pb.result.draftId) : null;
    const bn = (db2?.audience?.names || []).map((n) => String(n).replace(/^@/, ""));
    ctx.expect.ok("for exactly the learners named", learners.every((l) => bn.includes(l.username) || (db2?.payload?.usernames || []).includes(l.username)) && bn.length <= learners.length, db2?.audience);

    // Battle: learners the teacher didn't name → asked for, never picked.
    say = fresh();
    const b3 = await say(`Set a fractions battle for my three strongest learners in ${classroom.name}.`, "battle, unnamed learners");
    // Neither learners it picks nor the whole class instead: "three strongest" is the teacher's to name.
    noDraft("battle, three unnamed learners", b3);
    ctx.expect.ok("the agent asks which learners", asks(b3.reply, /\b(which|who|learners?|students?|names?)\b/i), b3.reply);

    // Self study: no audience → asked; then no subject → asked; then prepared as said.
    say = fresh();
    const s1 = await say("Set a self study on the water cycle.", "self study, no audience");
    noDraft("self study, no audience", s1);
    ctx.expect.ok("the agent asks who it is for (or the subject too)", asks(s1.reply, /\b(who|which|class|learners?|students?|subject)\b/i), s1.reply);
    const s2 = await say(`For ${who} in ${classroom.name}.`, "self study, audience given");
    noDraft("self study, subject still unsaid", s2);
    ctx.expect.ok("…it asks which subject (never assumed from \"the water cycle\")", asks(s2.reply, /subject/i), s2.reply);
    const s3 = await say("Basic Science.", "self study, subject given");
    const ps = lastCall(s3, "prepare_activity");
    ctx.expect.ok("now it prepares the self study", ps?.result?.prepared === true && ps?.input?.type === "self_study", { tools: toolsOf(s3), result: ps?.result });
    const ds = ps?.result?.draftId ? await draftRow(ctx, INSTRUCTOR, ps.result.draftId) : null;
    ctx.expect.eq("in Basic Science", ds?.subject || ds?.payload?.subject, "Basic Science");

    // Self study: changing who it's for to someone never named is asked about too.
    const s4 = await say("Actually, give it to my weakest learner instead.", "self study, unnamed new audience");
    const rv = lastCall(s4, "revise_activity_draft");
    const after = ds ? await draftRow(ctx, INSTRUCTOR, ds.id) : null;
    ctx.expect.ok("the audience isn't changed to a learner the agent picked", JSON.stringify(after?.audience) === JSON.stringify(ds?.audience) || rv?.result?.revised !== true, { revise: rv?.result, before: ds?.audience, after: after?.audience });
    ctx.expect.ok("the agent asks which learner", asks(s4.reply, /\b(which|who|learners?|students?|names?)\b/i), s4.reply);
  },
};

/* ── Assignment: versions, parts, going back ────────────────────────────── */

export const activityChatAssignmentVersions = {
  name: "activity_chat.assignment_versions", area: "instructor-chat", risk: "write", regression: false, timeoutMs: 600_000,
  description: "An assignment's questions revised in chat, each follow-up a new version: make Q2 harder (V2), add two short-answer questions to Part B (V3), go back to V1 and replace Q3 (V4) — each changing only what was asked.",
  async run(ctx) {
    const { classroom, say, who } = await classOf(ctx);
    const t1 = await say(`Prepare a Mathematics assignment on fractions for ${who} in ${classroom.name}: 6 questions — 4 MCQ and 2 short answer.`, "prepare");
    const prep = lastCall(t1, "prepare_activity");
    ctx.expect.ok("prepared as an assignment", prep?.result?.prepared === true && prep?.input?.type === "assignment", { tools: toolsOf(t1), input: prep?.input });
    const draftId = prep?.result?.draftId;
    if (!draftId) return;
    const v1 = await versionOf(ctx, draftId, 1);
    ctx.expect.eq("version 1 is ready", v1?.status, "ready");
    if (v1?.status !== "ready") return;
    const q1 = v1.paper.questions;
    ctx.expect.eq("6 questions", q1.length, 6);
    ctx.expect.eq("4 multiple choice", q1.filter((q) => Array.isArray(q.options)).length, 4);
    const parts1 = partsOf(v1.paper);
    ctx.expect.ok("laid out in parts: Part A multiple choice, Part B short answers", parts1.length >= 2 && /^Part A/i.test(parts1[0].title) && /^Part B/i.test(parts1[1].title), parts1.map((x) => [x.title, x.questions.length]));

    // V2: one question harder — the rest kept.
    const v2 = await reviseVersion(ctx, say, draftId, { prompt: "Make question 2 harder.", label: "Q2 harder", n: 2, base: 1 });
    if (v2) {
      const q2 = v2.paper.questions;
      ctx.expect.eq("V2: still 6 questions", q2.length, 6);
      ctx.expect.ok("V2: question 2 changed", qText(q2[1]) !== qText(q1[1]), [qText(q1[1]), qText(q2[1])]);
      const same = q2.filter((q, i) => i !== 1 && qText(q) === qText(q1[i])).length;
      ctx.expect.gte("V2: the other questions are kept", same, 4);
    }

    // V3: two more questions into Part B — Part A untouched.
    const base = v2 || v1;
    const v3 = await reviseVersion(ctx, say, draftId, { prompt: "Add 2 more short-answer questions to Part B.", label: "Part B +2", n: 3, base: base.n });
    if (v3) {
      const a0 = partsOf(base.paper)[0], b0 = partB(base.paper);
      const a3 = partsOf(v3.paper)[0], b3 = partB(v3.paper);
      ctx.expect.eq("V3: 8 questions", v3.paper.questions.length, base.paper.questions.length + 2);
      ctx.expect.eq("V3: Part B has two more", b3?.questions.length, (b0?.questions.length || 0) + 2);
      ctx.expect.eq("V3: Part A is unchanged", a3?.questions.map(qText), a0?.questions.map(qText));
      ctx.expect.ok("V3: the new Part B questions are short answers (no options)", (b3?.questions || []).every((q) => !Array.isArray(q.options)), b3?.questions.map(qText));
    }

    // V4: back to version 1, one question swapped.
    const v4 = await reviseVersion(ctx, say, draftId, { prompt: "Go back to version 1 and replace question 3 with a question on equivalent fractions.", label: "back to V1", n: 4, base: 1 });
    if (v4) {
      const q4 = v4.paper.questions;
      ctx.expect.eq("V4: 6 questions, as version 1", q4.length, q1.length);
      ctx.expect.ok("V4: question 3 is now on equivalent fractions", qText(q4[2]) !== qText(q1[2]) && /equivalent/i.test(qText(q4[2]) + JSON.stringify(q4[2].options || [])), [qText(q1[2]), qText(q4[2])]);
      ctx.expect.ok("V4: question 2 is version 1's (V2's harder one is not carried)", qText(q4[1]) === qText(q1[1]), [qText(q1[1]), qText(q4[1])]);
    }
    const all = (await draftRow(ctx, INSTRUCTOR, draftId))?.payload?.versions || [];
    ctx.expect.eq("every version is kept", all.map((v) => v.n), [1, 2, 3, 4]);
  },
};

/* ── Assignment: an added instruction, a diagram question into Part A ──── */

export const activityChatPartsInstructions = {
  name: "activity_chat.assignment_parts_instructions", area: "instructor-chat", risk: "write", regression: false, timeoutMs: 600_000,
  description: "An assignment's follow-ups land where the teacher said: an added instruction keeps the paper's own and shows on every version (no new version); \"add a diagram question to Part A\" puts it at the end of Part A (not in a Diagrams part); \"add a question with a diagram\" adds one more with a diagram, everything else kept.",
  async run(ctx) {
    const { classroom, say, who } = await classOf(ctx);
    const t1 = await say(`Prepare a Basic Science assignment on photosynthesis for ${who} in ${classroom.name}: 4 MCQ and 2 short answer questions.`, "prepare");
    const prep = lastCall(t1, "prepare_activity");
    ctx.expect.ok("prepared as an assignment", prep?.result?.prepared === true && prep?.input?.type === "assignment", { tools: toolsOf(t1), input: prep?.input });
    const draftId = prep?.result?.draftId;
    if (!draftId) return;
    const v1 = await versionOf(ctx, draftId, 1);
    ctx.expect.eq("version 1 is ready", v1?.status, "ready");
    if (v1?.status !== "ready") return;
    const before = String(v1.paper.instructions || "");

    // 1. An instruction added: kept with the paper's own, on the paper, no new version.
    const t2 = await say("Add to the instructions: Do not spend too much time on one question.", "instructions");
    const rev = lastCall(t2, "revise_activity_draft");
    ctx.expect.ok("the agent added to the instructions", rev?.result?.revised === true && (rev?.result?.applied || []).includes("instructions"), { input: rev?.input, result: rev?.result });
    const d2 = await draftRow(ctx, INSTRUCTOR, draftId);
    const p1 = (d2?.payload?.versions || [])[0]?.paper?.instructions || "";
    ctx.expect.ok("the paper's instructions now carry the line", /too much time on one question/i.test(p1), p1);
    ctx.expect.ok("…and keep what the paper said before", !before || p1.toLowerCase().includes(before.toLowerCase().replace(/[.!?]$/, "")), { before, after: p1 });
    ctx.expect.eq("no new version for an instructions change", (d2?.payload?.versions || []).length, 1);

    // 2. A diagram question into Part A: at the end of Part A.
    const aBefore = partsOf(v1.paper)[0]?.questions.map(qText) || [];
    const bBefore = partB(v1.paper)?.questions.map(qText) || [];
    const v2 = await reviseVersion(ctx, say, draftId, { prompt: "Add a diagram question to Part A.", label: "diagram → Part A", n: 2, base: 1 });
    if (v2) {
      const parts = partsOf(v2.paper);
      const a = parts[0];
      ctx.expect.ok("V2: Part A has one more question, the new one at its end", a && /^Part A/i.test(a.title) && a.questions.length === aBefore.length + 1 && aBefore.every((t, i) => qText(a.questions[i]) === t), parts.map((x) => [x.title, x.questions.map(qText)]));
      const added = a?.questions.at(-1);
      ctx.expect.ok("V2: the new Part A question has a diagram", !!(added?.figure || added?.figure_note), added);
      ctx.expect.ok("V2: no separate Diagrams part was made for it", !parts.some((x) => /Diagrams/i.test(x.title)), parts.map((x) => x.title));
      ctx.expect.eq("V2: Part B unchanged", partB(v2.paper)?.questions.map(qText), bBefore);
      ctx.expect.ok("V2 keeps the added instruction", /too much time on one question/i.test(v2.paper.instructions || ""), v2.paper.instructions);
    }

    // 3. A question with a diagram, no part named: one more, with a diagram; the rest kept.
    const base = v2 || v1;
    const v3 = await reviseVersion(ctx, say, draftId, { prompt: "Add a question with a diagram.", label: "question with a diagram", n: 3, base: base.n });
    if (v3) {
      const was = new Set(base.paper.questions.map(qText));
      const fresh = v3.paper.questions.filter((q) => !was.has(qText(q)));
      ctx.expect.eq("V3: one more question", v3.paper.questions.length, base.paper.questions.length + 1);
      ctx.expect.ok("V3: the new one has a diagram", fresh.length === 1 && !!(fresh[0].figure || fresh[0].figure_note), fresh);
      ctx.expect.ok("V3: every earlier question kept", base.paper.questions.every((q) => v3.paper.questions.some((x) => qText(x) === qText(q))));
      ctx.expect.ok("V3 keeps the added instruction", /too much time on one question/i.test(v3.paper.instructions || ""), v3.paper.instructions);
    }
  },
};

/* ── Assignment: instructions, switched questions, assigned with its review ── */

export const activityChatAssignmentAssign = {
  name: "activity_chat.assignment_assign", area: "instructor-chat", risk: "write", regression: false, timeoutMs: 600_000,
  description: "An assignment prepared in chat gets a line added to its instructions in chat and two questions switched in the preview; that version is assigned with its class review: each learner's copy has the switched order, the parts and both instruction lines, they're notified, and the review is in their Challenges.",
  async run(ctx) {
    const { classroom, learners, say, who } = await classOf(ctx);
    const due = Date.now() + 4 * DAY;
    const t1 = await say(`Prepare a Mathematics assignment on fractions for ${who} in ${classroom.name}: 5 questions — 3 MCQ and 2 short answer, due ${inWords(due)} at 5pm.`, "prepare");
    const prep = lastCall(t1, "prepare_activity");
    ctx.expect.ok("prepared as an assignment", prep?.result?.prepared === true && prep?.input?.type === "assignment", { tools: toolsOf(t1), input: prep?.input });
    const draftId = prep?.result?.draftId;
    if (!draftId) return;
    const v1 = await versionOf(ctx, draftId, 1);
    ctx.expect.eq("version 1 is ready", v1?.status, "ready");
    if (v1?.status !== "ready") return;

    // Instructions added in chat (not a new version).
    const t2 = await say("Add to the instructions: Show all your working.", "instructions");
    const rev = lastCall(t2, "revise_activity_draft");
    ctx.expect.ok("the agent revised the draft's instructions", rev?.result?.revised === true && (rev?.result?.applied || []).includes("instructions"), { tools: toolsOf(t2), input: rev?.input, result: rev?.result });
    const d2 = await draftRow(ctx, INSTRUCTOR, draftId);
    ctx.expect.ok("the line is in the instructions", /show all (your )?working/i.test(d2?.payload?.instructions || ""), d2?.payload?.instructions);
    ctx.expect.eq("no new version for an instructions change", (d2?.payload?.versions || []).length, 1);

    // Switched in the preview: Q1 and Q2 trade places (both in Part A), saved on version 1.
    const qs = v1.paper.questions.map((q) => ({ ...q }));
    [qs[0], qs[1]] = [qs[1], qs[0]];
    const saved = await ctx.http({ as: INSTRUCTOR, method: "PUT", path: `/api/self-study/drafts/${draftId}/versions/1`, body: { questions: qs, sections: v1.paper.sections, passages: v1.paper.passages, instructions: v1.paper.instructions } });
    ctx.expect.status("the switched order is saved", saved, 200);
    const v1e = ((await draftRow(ctx, INSTRUCTOR, draftId))?.payload?.versions || [])[0];
    ctx.expect.ok("version 1 is marked edited, in the new order", v1e?.edited === true && qText(v1e.paper.questions[0]) === qText(v1.paper.questions[1]), v1e?.paper?.questions?.map(qText));

    // Assigned (version 1, as edited) with the review on.
    const { id } = await assignWithReview(ctx, { draftId, learners, body: { title: `${ctx.marker} Fractions`, version: 1, due_at: new Date(due).toISOString() } });
    if (!id) return;
    for (const l of learners) {
      const copy = await learnerCopy(ctx, l, id);
      if (!copy) continue;
      const got = copy.details?.questions || [];
      ctx.expect.eq(`@${l.username}: the questions in the switched order`, got.map(qText), v1e.paper.questions.map(qText));
      ctx.expect.ok(`@${l.username}: in parts`, (copy.details?.sections || []).length >= 2, copy.details?.sections);
      ctx.expect.ok(`@${l.username}: no answer key in the learner's copy`, got.every((q) => q.correct === undefined && q.answer === undefined), got.map((q) => Object.keys(q)));
      ctx.expect.ok(`@${l.username}: the instructions have the teacher's line and the review line`, /show all (your )?working/i.test(copy.instructions || "") && /class review battle is on/i.test(copy.instructions || ""), copy.instructions);
    }
  },
};

/* ── Self study: plan edits, history, assigned with its review ──────────── */

export const activityChatSelfStudyAssign = {
  name: "activity_chat.self_study_assign", area: "instructor-chat", risk: "write", regression: false, timeoutMs: 600_000,
  description: "A self study prepared in chat: a subtopic added, one removed and a line added to its instructions in chat; an earlier round restored in the preview; assigned with its class review: each learner's copy has that plan and both instruction lines, and the review is in their Challenges.",
  async run(ctx) {
    const { classroom, learners, say, who } = await classOf(ctx);
    const due = Date.now() + 5 * DAY;
    const t1 = await say(`Set a Basic Science self study on the water cycle for ${who} in ${classroom.name}, due ${inWords(due)} at 4pm.`, "prepare");
    const prep = lastCall(t1, "prepare_activity");
    ctx.expect.ok("prepared as a self study", prep?.result?.prepared === true && prep?.input?.type === "self_study", { tools: toolsOf(t1), input: prep?.input });
    const draftId = prep?.result?.draftId;
    if (!draftId) return;
    const ready = await ctx.until(async () => {
      const d = await draftRow(ctx, INSTRUCTOR, draftId);
      return ["ready", "fallback"].includes(d?.payload?.plan_status) ? d : null;
    }, { timeoutMs: 120_000, everyMs: 4_000 });
    ctx.expect.eq("the study plan is written", ready?.payload?.plan_status, "ready");
    const plan = ready?.payload?.subtopics || [];
    ctx.expect.gte("several subtopics", plan.length, 3);
    if (plan.length < 3) return;

    // Add one.
    const t2 = await say("Add a subtopic on groundwater.", "add subtopic");
    ctx.expect.ok("revised, not prepared again", lastCall(t2, "revise_activity_draft")?.result?.revised === true && !prepared(t2), toolsOf(t2));
    const afterAdd = (await draftRow(ctx, INSTRUCTOR, draftId))?.payload?.subtopics || [];
    ctx.expect.ok("groundwater is in the plan", afterAdd.some((s) => /groundwater/i.test(s)), afterAdd);
    ctx.expect.eq("every earlier subtopic kept", plan.filter((s) => !afterAdd.includes(s)), []);

    // Remove one (named as the preview shows it).
    const gone = plan[1];
    const t3 = await say(`Remove the subtopic "${gone}".`, "remove subtopic");
    ctx.expect.ok("revised again", lastCall(t3, "revise_activity_draft")?.result?.revised === true, toolsOf(t3));
    const afterRemove = (await draftRow(ctx, INSTRUCTOR, draftId))?.payload?.subtopics || [];
    ctx.expect.ok(`"${gone}" is gone, the rest kept`, !afterRemove.includes(gone) && afterAdd.filter((s) => s !== gone).every((s) => afterRemove.includes(s)), afterRemove);

    // Instructions added.
    const t4 = await say("Add to the instructions: Teach your agent each stage of the water cycle in your own words.", "instructions");
    ctx.expect.ok("the instructions were revised", (lastCall(t4, "revise_activity_draft")?.result?.applied || []).includes("instructions"), toolsOf(t4));
    const d4 = await draftRow(ctx, INSTRUCTOR, draftId);
    ctx.expect.ok("the line is in the instructions", /in your own words/i.test(d4?.payload?.instructions || ""), d4?.payload?.instructions);
    const history = d4?.payload?.history || [];
    ctx.expect.gte("every round is kept (first draft + three follow-ups)", history.length, 4);

    // Back to the round before the removal (the preview's version tabs), then forward again.
    const roundAdd = history.find((h) => (h.snapshot?.subtopics || []).some((s) => /groundwater/i.test(s)) && (h.snapshot?.subtopics || []).includes(gone));
    ctx.expect.ok("the round with groundwater added (before the removal) is in the history", !!roundAdd, history.map((h) => [h.n, h.request]));
    if (roundAdd) {
      const back = await ctx.http({ as: INSTRUCTOR, method: "POST", path: `/api/self-study/drafts/${draftId}/history/${roundAdd.n}/restore` });
      ctx.expect.status("restored that round", back, 200);
      const now = (await draftRow(ctx, INSTRUCTOR, draftId))?.payload;
      ctx.expect.ok(`restored: "${gone}" is back`, (now?.subtopics || []).includes(gone), now?.subtopics);
      const latest = history.at(-1);
      const fwd = await ctx.http({ as: INSTRUCTOR, method: "POST", path: `/api/self-study/drafts/${draftId}/history/${latest.n}/restore` });
      ctx.expect.status("and forward to the latest round", fwd, 200);
    }
    const final = (await draftRow(ctx, INSTRUCTOR, draftId))?.payload;
    ctx.expect.ok("the latest round is current: groundwater in, the removed one out, the line in", (final?.subtopics || []).some((s) => /groundwater/i.test(s)) && !(final?.subtopics || []).includes(gone) && /in your own words/i.test(final?.instructions || ""), { subtopics: final?.subtopics, instructions: final?.instructions });

    const { id } = await assignWithReview(ctx, { draftId, learners, body: { title: `${ctx.marker} The water cycle`, due_at: new Date(due).toISOString() } });
    if (!id) return;
    for (const l of learners) {
      const copy = await learnerCopy(ctx, l, id);
      if (!copy) continue;
      ctx.expect.eq(`@${l.username}: a self study`, copy.type || "self_study", "self_study");
      const subs = copy.subtopics || copy.details?.subtopics || [];
      ctx.expect.ok(`@${l.username}: the plan as revised`, subs.some((s) => /groundwater/i.test(typeof s === "string" ? s : s?.title || "")) && !subs.some((s) => (typeof s === "string" ? s : s?.title) === gone), subs);
      ctx.expect.ok(`@${l.username}: the instructions have the teacher's line and the review line`, /in your own words/i.test(copy.instructions || "") && /class review battle is on/i.test(copy.instructions || ""), copy.instructions);
    }
  },
};

export const activityChatScenarios = [activityChatAskMissing, activityChatBattleSelfStudyAsk, activityChatPartsInstructions, activityChatAssignmentVersions, activityChatAssignmentAssign, activityChatSelfStudyAssign];
