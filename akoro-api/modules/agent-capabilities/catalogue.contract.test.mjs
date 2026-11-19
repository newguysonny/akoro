// Admin → Agent capabilities: every built-in chat tool is listed with its
// audience, and every one has example prompts (a new tool without them fails
// here, and shows "No example yet" on the page).
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.OPENAI_API_KEY ||= "test-key";
process.env.AI_TELEMETRY_DB = "off";
process.env.AI_TELEMETRY = "off";
process.env.JWT_SECRET ||= "stub-jwt-secret";
process.env.JWT_ISSUER ||= "https://api.akoro.app";
process.env.JWT_AUDIENCE ||= "https://akoro.app";
process.env.GOOGLE_CLIENT_ID ||= "stub-google-id";
process.env.GOOGLE_CLIENT_SECRET ||= "stub-google-secret";

const chat = await import("../adaptive-learning/index.js");
const { builtInRows, SHARED_TOOLS } = await import("./catalogue.js");
const { AREAS, TOOL_EXAMPLES } = await import("./examples.js");
const { AGENT_FEATURES } = await import("./features.js");

test("every built-in tool is listed once, with the right audience", () => {
  const rows = builtInRows({ learnerTools: chat.CHAT_TOOLS, learnerOn: chat.getLearnerChatTools(), instructorTools: chat.INSTRUCTOR_TOOLS, instructorOn: true });
  assert.equal(rows.length, chat.CHAT_TOOLS.length + chat.INSTRUCTOR_TOOLS.length);
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length);
  assert.equal(rows.find((r) => r.ref === "create_tool").who, "shared");
  assert.equal(rows.find((r) => r.ref === "prepare_activity").who, "instructor");
  assert.equal(rows.find((r) => r.ref === "get_weak_topics").who, "learner");
  for (const s of SHARED_TOOLS) assert.ok(chat.CHAT_TOOLS.some((t) => t.name === s), `${s} is a chat tool`);
});

test("a switched-off feature gate shows the tool as off, with the switch named", () => {
  const rows = builtInRows({ learnerTools: chat.CHAT_TOOLS, learnerOn: [], instructorTools: chat.INSTRUCTOR_TOOLS, instructorOn: false });
  const r = rows.find((x) => x.ref === "start_study_prep_session");
  assert.deepEqual([r.status, r.switch], ["off", "Study Prep"]);
  assert.equal(rows.find((x) => x.ref === "prepare_activity").switch, "AKORO_ACTIVITY_DRAFTS_ENABLED");
});

test("every built-in tool has example prompts and a known area", () => {
  const missing = [...chat.CHAT_TOOLS, ...chat.INSTRUCTOR_TOOLS].map((t) => t.name).filter((n) => !TOOL_EXAMPLES[n]?.examples?.length);
  assert.deepEqual(missing, [], "add these to modules/agent-capabilities/examples.js");
  for (const [n, x] of Object.entries(TOOL_EXAMPLES)) assert.ok(AREAS[x.area], `${n}: area ${x.area}`);
});

test("features: unique keys, a known audience and area, examples", () => {
  assert.equal(new Set(AGENT_FEATURES.map((f) => f.key)).size, AGENT_FEATURES.length);
  for (const f of AGENT_FEATURES) {
    assert.ok(["learner", "instructor", "shared"].includes(f.who), f.key);
    assert.ok(AREAS[f.area], f.key);
    assert.ok(f.examples?.length && f.what, f.key);
  }
});

// chat.js keeps a db client open (the root after-hook only runs once the loop
// drains), so end the process once the last test has reported.
test("done", () => { setTimeout(() => process.exit(process.exitCode ?? 0), 300); });
