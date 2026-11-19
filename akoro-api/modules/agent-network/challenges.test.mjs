import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.OPENAI_API_KEY ||= "test-openai-key";
const { cleanBattleOptions, seatsFor, assignTeams, NETWORK_LIMITS } = await import("../battle/index.js");
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [worker, challenges, network, toolCatalogue] = await Promise.all([read("../battle/worker.js"), read("./challenges.js"), read("../adaptive-learning/chat/handlers-network-study.js"), read("../adaptive-learning/chat/tool-catalogue-core.js")]);

test("battle options: subject required, 5–30 questions, schedule in the future and within 30 days", () => {
  assert.throws(() => cleanBattleOptions({}), /Which subject/);
  const o = cleanBattleOptions({ subject: "Chemistry", total_questions: 99, kind: "team" });
  assert.equal(o.total, NETWORK_LIMITS.MAX_Q);
  assert.equal(o.kind, "team");
  assert.match(o.title, /Chemistry team battle/);
  assert.throws(() => cleanBattleOptions({ subject: "Maths", scheduled_for: "2020-01-01T10:00:00Z" }), /passed/);
  assert.throws(() => cleanBattleOptions({ subject: "Maths", scheduled_for: new Date(Date.now() + 40 * 86400_000).toISOString() }), /30 days/);
  assert.ok(cleanBattleOptions({ subject: "Maths", scheduled_for: new Date(Date.now() + 3600_000).toISOString() }).scheduledFor);
});

test("seats: 1v1 is two, team is four, group is 3–8", () => {
  assert.equal(seatsFor("1v1", ["b"]), 2);
  assert.throws(() => seatsFor("1v1", ["b", "c"]), /one other/);
  assert.equal(seatsFor("team", ["b", "c"], ["d"]), 4);
  assert.throws(() => seatsFor("team", ["b"]), /2v2/);
  assert.throws(() => seatsFor("group", ["b"]), /3 to 8/);
});

test("teams: creator on A, a named teammate joins A, the rest balance out", () => {
  assert.deepEqual(assignTeams("me", ["x", "y", "z"], { x: "A" }), { me: "A", x: "A", y: "B", z: "B" });
  assert.deepEqual(assignTeams("me", ["p", "q", "r"]), { me: "A", p: "B", q: "A", r: "B" });
});

test("team battles are scored by team; requests fill seats with a lock; challenges respect privacy", () => {
  assert.match(worker, /const isTeam = battleInfo\?\.battle_type === "team";/);
  assert.match(worker, /is_winner:  r == null \|\| isReview \? false : isTeam \?/);
  assert.match(challenges, /\.eq\("accepted_by", `\{\$\{\(r\.accepted_by \|\| \[\]\)\.join\(","\)\}\}`\)/);
  assert.match(challenges, /isn't taking challenges right now/);
  for (const name of ["find_competitors", "challenge_agent", "post_challenge_request", "search_challenge_requests", "accept_challenge_request", "cancel_challenge_request", "rematch_battle"]) {
    assert.match(toolCatalogue, new RegExp(`name: "${name}",`));
    assert.match(network, new RegExp(`async ${name}\\(input`));
  }
});
