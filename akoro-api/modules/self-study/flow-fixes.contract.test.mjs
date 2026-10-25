import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * The assignment flow review (create → assign → answer → hand in → grade →
 * results): each fix it called for, pinned.
 */
process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
const { cleanQuestionMarks } = await import("./submissionView.js");
const { expireStaleVersions, isStaleDrafting, STALE_DRAFTING_MS } = await import("./draftVersions.js");
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [routes, drafts, versions, createA, chat, chatPage, panel, form, modal, subs, marker, learner, socket, api, answerPaper, answerPaperT] = await Promise.all([
  read("./routes.js"), read("./drafts.js"), read("./draftVersions.js"), read("./createAssignment.js"), read("../adaptive-learning/chat.js"),
  read("../../../akoro-instructor/src/pages/ChatPage.jsx"), read("../../../akoro-instructor/src/components/ActivityPreviewPanel.jsx"),
  Promise.all([   // the Activities page and the parts it was split into
    "../../../akoro-instructor/src/pages/ActivitiesPage.jsx", "../../../akoro-instructor/src/components/activities/ActivityForm.jsx",
    "../../../akoro-instructor/src/pages/activities-page/ActivitiesHome.jsx", "../../../akoro-instructor/src/pages/activities-page/DetailPage.jsx",
    "../../../akoro-instructor/src/pages/activities-page/DraftsStrip.jsx",
  ].map(read)).then((parts) => parts.join("\n")), read("../../../akoro-instructor/src/components/grading/GradeSubmissionModal.jsx"),
  read("../../../akoro-instructor/src/pages/SubmissionsPage.jsx"), read("../../../akoro-instructor/src/components/grading/QuestionMarker.jsx"),
  read("../../../akoro-learner/src/pages/ActivityDetailPage.jsx"), read("../../../akoro-learner/src/services/activitySocket.js"),
  read("../../../akoro-learner/src/services/activityApi.js"),
  read("../../../akoro-learner/src/components/activity/AnswerPaper.jsx"), read("../../../akoro-instructor/src/components/paper/AnswerPaper.jsx"),
]);

test("create: V2+ cards reach the chat; a cut-off version fails instead of drafting forever", () => {
  assert.ok(chatPage.includes("x.tool === 'revise_activity_draft' && x.success && x.draft"));
  const old = new Date(Date.now() - STALE_DRAFTING_MS - 1000).toISOString();
  const fresh = new Date().toISOString();
  const p = { versions: [{ n: 1, status: "ready" }, { n: 2, status: "drafting", createdAt: old }, { n: 3, status: "drafting", createdAt: fresh }] };
  assert.equal(isStaleDrafting(p.versions[1]), true);
  const out = expireStaleVersions(p);
  assert.deepEqual(out.versions.map((v) => v.status), ["ready", "failed", "drafting"]);
  assert.equal(expireStaleVersions({ versions: [{ n: 1, status: "drafting", createdAt: fresh }] }), null);
  assert.ok(drafts.includes("if (data.status === \"draft\" && expireStaleVersions(data.payload))"), "every read recovers it");
  assert.ok(drafts.includes("startedAt: new Date().toISOString()"), "Try again restarts the clock");
  assert.ok(versions.includes('p.versions[i].status !== "drafting"'), "a timed-out version never flips back to ready");
  assert.ok(drafts.includes("couldn't be drafted — press Try again"), "a failed V1 says so");
});

test("assign: the due date is pinned, Edit details keeps it and resolves the card, 30 questions, figures, no orphans", () => {
  assert.ok(drafts.includes("Set the exact due date for"));
  assert.ok(panel.includes("dueAt: datetimeLocal(payload.due_at)"));
  assert.ok(panel.includes("onAssigned={(count) => markResolved('assigned', count)}"));
  assert.ok(panel.includes("const needsFigure =") && panel.includes("disabled={phase === 'assigning' || vEditing || (shown && shown.status !== 'ready') || !!assignBlock || reviewWriting}"));
  assert.ok(form.includes(".slice(0, 30);"));
  assert.ok(chat.includes('due_at: { type: "string", description: "A new exact due instant') && drafts.includes('applied.push("audience")'));
  assert.ok(createA.includes('await edu().from("self_study_assignments").delete().eq("id", assignment.id)'));
});

test("hand in: once only, answers checked, late flagged, free text on the server, live grade", () => {
  assert.ok(routes.includes('router.put("/:id/draft-text"'));
  assert.ok(routes.includes("const c = cleanAnswer(questions, k, v);"));
  assert.ok(routes.includes("lateByMinutes"));
  assert.ok(learner.includes("saveActivityText(") && api.includes("export async function saveActivityText"));
  assert.ok(learner.includes("const atCap = old && others + 1 >= PER_QUESTION_FILES;"), "re-saving at 3 files makes room first");
  assert.ok(learner.includes("disabled={submitting || uploading !== null}"), "no hand-in mid-upload");
  assert.ok(socket.includes("socket.on('activity_graded'") && learner.includes("onActivityGraded("));
  assert.ok(api.includes("async function authFetch(url)"), "file downloads survive an expired sign-in");
});

test("grading: unmarked stays unmarked; re-grading keeps its mode; the queue follows the learner; unpublish", () => {
  const qs = [{ q: "a", max_points: 2 }, { q: "b", max_points: 3 }];
  const { marks } = cleanQuestionMarks(qs, [{ index: 0, awarded: null, comment: "" }, { index: 1, awarded: "", comment: "see me" }]);
  assert.deepEqual(marks.map((m) => m.awarded), [null, null]);
  assert.equal(cleanQuestionMarks(qs, [{ index: 0, awarded: 0 }]).marks[0].awarded, 0, "a real 0 stays 0");
  assert.ok(modal.includes(".filter((m) => (m.awarded != null && m.awarded !== '') || m.comment.trim())"));
  assert.ok(subs.includes("feedbackMode: t.feedback?.mode || null") && modal.includes("current.feedbackMode"));
  assert.ok(modal.includes("const [sid, setSid] = useState(") && subs.includes("queue.findIndex(s => s.student.id === grading.studentId)"));
  assert.ok(routes.includes('router.delete("/:id/targets/:studentId/grade"') && modal.includes("const unpublish = async"));
  assert.ok(routes.includes("Drafting was interrupted — draft again.") && modal.includes("e?.status === 409"));
  assert.ok(marker.includes("onOpen={openSubmittedFile}"), "a .docx downloads for the teacher");
  assert.ok(routes.includes("if (sentFeedback != null && (typeof sentFeedback !== \"object\""), "feedback: null is not a 500");
});

test("results: comments show under unanswered questions; whole-assignment files show after hand-in", () => {
  assert.equal(answerPaper, answerPaperT);
  assert.ok(answerPaper.includes("showLoose = true") && answerPaper.includes("Attached to the whole assignment"));
  assert.ok(/Not answered[\s\S]{0,900}mark\?\.comment/.test(answerPaper));
});
