// Guide reviews (battle/guideReview.js): the guide asks, the protégé answers,
// a mark sheet; never a battle against the guide or a teacher.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.OPENAI_API_KEY ||= "test-openai-key";
const { partName, reviewFocus, GUIDE_REVIEW } = await import("./guideReview.js");
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");

test("the questions cover the topic, narrowed to the parts that were taught", () => {
  assert.equal(reviewFocus("Photosynthesis"), "Photosynthesis");
  assert.equal(reviewFocus("Photosynthesis", ["Light reactions", { name: "Chlorophyll" }, { title: "Glucose" }, "Light reactions"]),
    "Photosynthesis (Light reactions, Chlorophyll, Glucose)");
  assert.equal(partName({ label: "Stomata" }), "Stomata");
  assert.equal(partName(null), "");
  assert.ok(reviewFocus("x".repeat(300), ["a"]).length <= 180);
});

test("a guide review is an Agent Check the learner asked for: marked, limited, no opponent", async () => {
  const [src, check, routes, chat] = await Promise.all([read("./guideReview.js"), read("./agentCheck.js"), read("./routes.js"), read("../adaptive-learning/chat.js")]);
  assert.match(src, /createCheckBattle\(\{/);
  assert.match(src, /review_host: "guide", requested_by: learnerId, teaching_session_id/);
  assert.match(src, /if \(!data \|\| data\.student_id !== learnerId\) throw fail\("That teaching session isn't yours\."/);
  assert.match(src, /if \(used >= GUIDE_REVIEW\.PER_DAY\)/);
  assert.ok(GUIDE_REVIEW.PER_DAY >= 1);
  assert.match(check, /\.\.\.extra,/);                         // the check carries who asked
  assert.match(routes, /router\.post\("\/guide-reviews", authenticateToken/);
  assert.match(chat, /name: "request_guide_review"/);
  assert.match(chat, /case "request_guide_review": \{\s*if \(role === "instructor"\)/);
});
