/**
 * agent-tool-coverage.contract.test.mjs — every surface the agent should
 * reach, and the ones it must NEVER reach.
 *
 * Coverage: goals (list / create / progress), the proposal inbox (read-only),
 * and learner blogs (list / draft / publish) all dispatch to the SAME
 * service functions the REST routes use — one write path, no forked
 * validation. Writes carry explicit-ask semantics (create_task style).
 * Negative pins: proposal approval and the autonomy/planner toggle stay
 * human-only — no tool may exist for them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const API = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(API, ...p), "utf8");

const chatJs = read("modules/adaptive-learning/chat.js");
const goalService = read("modules/learner-goals/service.js");
const goalRoutes = read("modules/learner-goals/routes.js");
const blogService = read("modules/blogs/service.js");
const proposalsRoutes = read("modules/agent-proposals/routes.js");
const gateway = read("modules/agent-tools/routes.js");
const pyClient = read("..", "akoro-python-agent", "src", "agent", "tools", "akoro_api.py");

const TOOL_NAMES = ["list_my_goals", "create_goal", "update_goal_progress", "list_my_proposals",
  "list_my_blogs", "save_blog_draft", "publish_blog"];

test("coverage · goals, proposals and blogs are all in the toolkit", () => {
  for (const name of TOOL_NAMES) {
    assert.match(chatJs, new RegExp(`name: "${name}",`), `${name} missing from CHAT_TOOLS`);
  }
  // dispatch cases exist for every new tool
  for (const name of TOOL_NAMES) {
    assert.match(chatJs, new RegExp(`case "${name}": \\{`), `${name} has no execution case`);
  }
});

test("coverage · writes are explicit-ask; reads are free", () => {
  for (const name of ["create_goal", "update_goal_progress", "save_blog_draft", "publish_blog"]) {
    assert.match(chatJs, new RegExp(`name: "${name}",[\\s\\S]*?"[^"]*ONLY (when they explicitly ask|on an explicit ask)`), `${name} lacks the explicit-ask guard`);
  }
  // save-before-publish honesty: the editor's publish rule is quoted in chat too
  assert.match(chatJs, /an empty post can't be published/);
  // missing ids clarify instead of guessing (no-guess rule)
  assert.match(chatJs, /case "update_goal_progress": \{[\s\S]*?return clarify\("goalId"/);
  assert.match(chatJs, /case "publish_blog": \{[\s\S]*?return clarify\("body"/);
});

test("coverage · one write path — chat dispatches to the services the routes use", () => {
  assert.match(chatJs, /import \{ listGoals, createGoal, updateGoal \} from "\.\.\/learner-goals\/service\.js";/);
  assert.match(chatJs, /import \{ listMyBlogs, createBlogPost, updateBlogPost \} from "\.\.\/blogs\/service\.js";/);
  assert.match(goalRoutes, /import \{ listGoals, createGoal, updateGoal \} from "\.\/service\.js";/);
  // goals provenance: explicit chat asks are 'learner'-sourced; the agent never self-inserts
  assert.match(chatJs, /provenance is 'learner' — the agent/);
  assert.match(goalService, /\{ source = "learner" \}/);
  // the blog mirror rides the shared service (published posts reach the public blog from chat too)
  assert.match(blogService, /if \(data\.status === "published"\) await mirrorBlog\(userId, data\);/);
  // proposals tool is a pure read of the inbox table
  assert.match(chatJs, /case "list_my_proposals": \{[\s\S]*?from\("agent_proposals"\)/);
  assert.match(chatJs, /never execute them\./);
});

test("coverage · HITL stays human-only — no approval or autonomy-toggle tools", () => {
  // the proposal decision verbs must never appear as tools
  for (const banned of ["approve_proposal", "dismiss_proposal", "execute_proposal", "set_autonomy", "toggle_autonomy", "enable_planner"]) {
    assert.doesNotMatch(chatJs, new RegExp(`name: "${banned}"`), `${banned} must not be a tool`);
  }
  // the approval logic lives only in the inbox routes (claim-first, HITL)
  assert.match(proposalsRoutes, /router\.post\("\/:id\/approve", authenticateToken/);
  assert.match(proposalsRoutes, /router\.post\("\/:id\/dismiss", authenticateToken/);
  // the capabilities card teaches the new organisation powers
  assert.match(chatJs, /Save, update and track study goals when explicitly asked/);
  assert.match(chatJs, /Show the suggestions from its background reviews waiting in the inbox/);
  assert.match(chatJs, /Draft, save and publish the learner\\u2019s blog posts when explicitly asked/);
});

test("python gateway · catalogue flows, writes keep the confirmation HITL, cap raised", () => {
  // the student catalogue is DERIVED from getLearnerChatTools — new tools flow automatically
  assert.match(gateway, /return getLearnerChatTools\(\)\.map\(\(tool\) => publicTool\(tool, STUDENT_WRITE_TOOLS\.has\(tool\.name\)\)\);/);
  // the Python path's HITL: every new write rides the confirmation flow
  for (const w of ["create_goal", "update_goal_progress", "save_blog_draft", "publish_blog"]) {
    assert.match(gateway, new RegExp(`"${w}",`), `${w} missing from STUDENT_WRITE_TOOLS`);
  }
  // argument validation: without a case the gateway 404s the tool
  for (const t of ["consult_peer_agents", "search_blog_posts", "read_blog_post", "list_my_goals",
    "create_goal", "update_goal_progress", "list_my_proposals", "list_my_blogs", "save_blog_draft", "publish_blog"]) {
    assert.match(gateway, new RegExp(`case "${t}":`), `${t} missing from validateStudentArguments`);
  }
  // the review card says WHAT is approved — never a bare {kind}
  assert.match(gateway, /public blog under Community/);
  // the Python client must not silently truncate the grown catalogue
  assert.match(pyClient, /_MAX_CATALOGUE_TOOLS = 48/);
});

test("capability awareness · the card and the prompt must match the runtime gates", () => {
  // the memory card line consults the REAL default-on gate — never a strict
  // env-equality check that turns "unset" into "the agent can't remember"
  assert.match(chatJs, /\(durableAgentChatContextEnabled \? \["Remember across chats/);
  assert.match(chatJs, /Never claim you cannot remember while this memory section is present/);
  // the guide is injected only where memory actually loaded (durable && student)
  assert.match(chatJs, /\(durable && role === "student" \? DURABLE_MEMORY_GUIDE : ""\)/);
});
