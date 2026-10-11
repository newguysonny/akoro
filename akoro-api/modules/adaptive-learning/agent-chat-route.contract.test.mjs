import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./chat.js", import.meta.url), "utf8");
const agentChatDoctrine = await readFile(
  new URL("../../akoro-agent/policies/AGENT_CHAT.md", import.meta.url), "utf8");
const instructorChatPage = await readFile(
  new URL("../../../akoro-instructor/src/pages/ChatPage.jsx", import.meta.url), "utf8",
);
const learnerChatTab = await readFile(
  new URL("../../../akoro-learner/src/components/tabs/AgentChatTab.jsx", import.meta.url), "utf8",
);
const toolObservationsDoctrine = await readFile(
  new URL("../../akoro-agent/policies/TOOL_OBSERVATIONS.md", import.meta.url), "utf8");
const studyPrepDoctrine = await readFile(
  new URL("../../akoro-agent/channels/STUDY_PREP.md", import.meta.url), "utf8");

test("the sole Agent Chat response authority is the unified /agent route", () => {
  assert.match(source, /router\.post\("\/agent", async \(req, res\) =>/);
  assert.doesNotMatch(source, /router\.post\("\/tutor"/);
  assert.doesNotMatch(source, /router\.post\("\/chat"/);
});

test("the unified route assembles study grounding and invokes the authorised tool loop", () => {
  const route = source.slice(source.indexOf('router.post("/agent"'));
  assert.match(route, /getSyllabusGrounding\(userMessage/);
  assert.match(route, /getPastQuestionGrounding\(userMessage/);
  assert.match(route, /processAttachments\(rawAttachments\)/);
  assert.match(route, /runAgentToolLoop\(/);
  assert.match(route, /requiresAgentCapabilitiesTool\(userMessage\)/);
  assert.match(route, /requiredTool:.*get_agent_capabilities/s);
  assert.match(route, /toolChoice: "none"/);
});

test("durable Agent Chat context stays server-owned and uses an idempotent turn", () => {
  const route = source.slice(source.indexOf('router.post("/agent"'));
  assert.match(route, /loadLearnerAgentConversationContext/);
  assert.match(route, /retrieveLearnerAgentMemory/);
  assert.match(route, /completedLearnerAgentConversationTurn/);
  assert.match(route, /persistLearnerAgentConversationTurn/);
  assert.match(route, /sessionId: agentSessionId\(conversationId\)/);
  assert.match(route, /turnId,/);
});

test("a failed history load is surfaced with a retry — never silent", () => {
  // Regression of the 2026-10-01 aftermath: loadSessions and openSession
  // both swallowed errors, so a FAILED load was pixel-identical to an EMPTY
  // history — learners concluded their chats were gone. The tab must set a
  // visible error state for both failure kinds and offer the matching retry.
  assert.match(learnerChatTab, /setHistoryError\(\{ kind: "sessions" \}\)/,
    "sessions-list failure must set the history error state");
  assert.match(learnerChatTab, /setHistoryError\(\{ kind: "messages", sessionId: id \}\)/,
    "per-conversation message-load failure must set the history error state");
  assert.match(learnerChatTab, /function retryHistoryLoad|const retryHistoryLoad/,
    "a retry action must exist");
  assert.match(learnerChatTab, /agent\.history_load_error/);
  assert.match(learnerChatTab, /agent\.history_retry/);
});

test("every completed turn persists — the save is never gated on client socket state", () => {
  const route = source.slice(source.indexOf('router.post("/agent"'));
  // Regression (2026-10-01, observed live): the old save gate
  // `conversationId && !req.destroyed && !res.destroyed` meant NO turn ever
  // persisted behind Cloudflare + Render, where the socket reads destroyed
  // the instant the last delta flushes — 4/4 turns logged saved=false with
  // the turn line 2ms after the stream (no DB round-trip ever ran), and
  // every learner's chat history silently vanished on reload. The durable
  // write is turn-keyed idempotent, so persisting a fully-generated reply is
  // always safe even for an abandoned stream.
  assert.doesNotMatch(route, /!req\.destroyed && !res\.destroyed/,
    "the save block must not be skipped on destroyed sockets");
  assert.match(route, /let turnSaved = false;/);
  assert.match(route, /if \(conversationId\) \{/);
});

test("learner study projections remain bounded tools and product feedback needs explicit consent", () => {
  for (const tool of [
    "get_learning_overview", "get_knowledge_map", "search_my_study_knowledge",
    "get_concept_tracker_summary", "get_learning_insights_summary", "get_exam_prep_status",
    "get_chat_memory", "get_agent_preferences", "get_autonomy_status", "submit_tool_request",
  ]) assert.match(source, new RegExp(`name: "${tool}"`));
  assert.match(source, /hasExplicitToolRequestConsent\(userMessage\)/);
  // P1: the agent-chat operating doctrine loads from the workspace.
  assert.match(agentChatDoctrine, /never submit one automatically/);
  assert.match(source, /assembleChatDoctrine/);
  assert.match(source, /Never expose a raw transcript, internal scratchpad, hidden reasoning, or raw tool output/);
});

test("the instructor chat is durable and uses the shared Fortizo composer", () => {
  // Same session store as learners: lazily created owned session, resume on
  // mount, and both transports carry the durable turn key + chat mode.
  assert.match(instructorChatPage, /ensureChatSession/);
  assert.match(instructorChatPage, /openChatSession\(list\[0\]\.id\)/);
  assert.match(instructorChatPage, /role: 'instructor', conversationId: sid, turnId, mode: chatMode/);
  // The composer is the learner app's Fortizo one; modes mirror its trio.
  assert.match(instructorChatPage, /<FortizoChatComposer/);
  assert.match(instructorChatPage, /const CHAT_MODES = \[/);
  assert.match(instructorChatPage, /id: 'research', label: 'Research'/);
  // Prompt chips fill the composer — they never auto-send.
  assert.match(instructorChatPage, /setInput\(chip\.fill\)/);
  assert.doesNotMatch(instructorChatPage, /onClick=\{\(\) => send\(chip/);
  // The learner chat's durable-turn contract: the turn key is created ONCE
  // per send and the one quiet retry REUSES it — the server repairs a
  // partial write instead of writing the exchange twice.
  assert.match(instructorChatPage, /const turnId = newTurnId\(\);/);
  assert.match(instructorChatPage, /const attemptTurn = async \(\) =>/);
  assert.match(instructorChatPage, /data = await attemptTurn\(\);\s*\n\s*\} catch \(e\) \{/);
  // A failed session create STOPS the send — a null conversationId never
  // rides through (that exchange used to be silently never persisted).
  assert.match(instructorChatPage, /if \(!sid\) \{/);
  // Learner history window: the last 24 mapped turns ride as history; the
  // new message itself rides in `message`, never duplicated into history.
  assert.match(instructorChatPage, /\.slice\(-24\);/);
  assert.doesNotMatch(instructorChatPage, /\[\.\.\.messages, \{ from: 'me', text: bodyText \}\]/);
  // The learner chat's header row: the hamburger opens the sessions drawer
  // with a FRESH list (never stale), and quick commands send directly.
  assert.match(instructorChatPage, /onClick=\{\(\) => \{ loadChatSessions\(\); setDrawerOpen\(true\); \}\}/);
  assert.match(instructorChatPage, /onClick=\{\(\) => sendText\(p\)\}/);
  assert.match(instructorChatPage, /const QUICK_COMMANDS = \[/);
});

test("school/class/teacher directory tools are privacy-bounded and forced for identity questions", () => {
  // The 2026-10-01 live hallucination: "What subjects do we have in the
  // class?" was answered from general knowledge (tools=0) with an invented
  // subject list. The directory tools answer identity questions from the
  // school's own records, and the route FORCES the matching read tool on
  // iteration 0 — exactly like the capabilities force.
  for (const tool of ["get_my_school", "list_school_subjects", "list_my_teachers", "find_teacher"]) {
    assert.match(source, new RegExp(`name: "${tool}"`), `${tool} missing from the learner catalogue`);
    assert.match(source, new RegExp(`case "${tool}":`), `${tool} missing from executeChatTool`);
  }
  assert.match(source, /requiredLearnerDataTool\(userMessage\)/,
    "the identity-question force is not wired into the /agent route");
  // The doctrine owns the rule: no tool result, no school/class/teacher facts.
  assert.match(toolObservationsDoctrine, /FACT questions about data you cannot see in this conversation/);
  assert.match(toolObservationsDoctrine, /never guess, and never fill the gap with generic school facts/);
  // Public identity only: every column the directory block selects must stay
  // in the public-directory allowlist — contact details and internal school
  // records are never selected.
  const directory = source.slice(
    source.indexOf('case "get_my_school"'),
    source.indexOf('case "create_task"'),
  );
  assert.ok(directory.includes('case "find_teacher"'), "directory slice did not capture all four tools");
  const selects = directory.match(/\.select\("([^"]*)"\)/g) ?? [];
  assert.ok(selects.length >= 6, "directory tool selects not found");
  for (const sel of selects) {
    assert.doesNotMatch(sel, /email|phone|username|password|guardian/i, `directory selects private columns: ${sel}`);
  }
  // The school profile query is exactly the published-identity allowlist —
  // it lives in the shared resolver, not in a case body.
  const resolver = source.slice(
    source.indexOf("async function resolveLearnerSchoolContext"),
    source.indexOf("export async function executeChatTool"),
  );
  assert.ok(resolver.length > 200, "the learner school-context resolver was not found");
  assert.match(resolver, /name, description, website, logo_url, address, is_active/);
  for (const sel of resolver.match(/\.select\("([^"]*)"\)/g) ?? []) {
    assert.doesNotMatch(sel, /email|phone|username|password|guardian/i, `resolver selects private columns: ${sel}`);
  }
  // An honest empty is an empty list — never a fabricated one.
  assert.match(directory, /subjects: \(schoolSubjects \?\? \[\]\)\.map/);
});

test("test/exam preparation forces the study-prep session tool — the questionnaire detour is closed", () => {
  const route = source.slice(source.indexOf('router.post("/agent"'));
  // The 2026-10-01 live transcript: "let's plan for a test" twice, tools=0
  // both times, a generic four-question planning questionnaire instead of
  // the study-prep workflow that was already in the tool list.
  assert.match(route, /requiredStudyPrepTool\(userMessage, dialogue\)/,
    "the study-prep force is not wired into the /agent route");
  assert.match(route, /studyPrepEnabled \? requiredStudyPrepTool/,
    "the force must respect the AKORO_STUDY_PREP_ENABLED feature gate");
  // Repeated asks must never stack unconfirmed sessions on top of each other.
  // (2026-10-03: reuse applies only when a plan actually exists — a plan-less
  // "planning" zombie from a failed planning step is re-planned, not echoed.)
  assert.match(source, /session\.status === "awaiting_confirmation" \|\| \(session\.status === "planning" && hasPlan\(session\)\)/,
    "start_study_prep_session must reuse an unconfirmed PLANNED session instead of creating another");
  assert.match(source, /runStudyPrepPlanningStep\(\{ sessionId: stalled\.sessionId, learnerId: studentId \}\)/,
    "a stalled plan-less planning session must be re-planned, never echoed as a dead card");
  // The doctrine owns the rule: test preparation is a session, never a chat
  // questionnaire, and the plan card is where the learner approves the cost.
  assert.match(studyPrepDoctrine, /never a questionnaire in chat/);
  assert.match(studyPrepDoctrine, /Nothing is charged until they approve the card/);
  assert.match(studyPrepDoctrine, /generated exam-style practice/);
  // The 2026-10-01 outage transcript: when the tool failed, the model fell
  // back to interviewing the learner (topics? format? duration? count?) —
  // the exact behaviour the doctrine exists to prevent.
  assert.match(studyPrepDoctrine, /never fall back to interviewing/);
});

test("learning-session history is its own tool — never answered with the school catalogue", () => {
  // Live 2026-10-01: "What subjects have I learnt so far with my protégé…"
  // was answered with the school's subject catalogue framed as "subjects you
  // have learned". The learner's teaching history and the school catalogue
  // are different questions with different tools, and both descriptions own
  // the distinction so the model can never conflate them.
  assert.match(source, /name: "get_my_learning_sessions"/, "missing from the learner catalogue");
  assert.match(source, /case "get_my_learning_sessions":/, "missing from executeChatTool");
  const catalogueDef = source.slice(
    source.indexOf('name: "list_school_subjects"'),
    source.indexOf('name: "list_my_teachers"'),
  );
  assert.match(catalogueDef, /NOT what the learner has learnt/);
  const historyDef = source.slice(
    source.indexOf('name: "get_my_learning_sessions"'),
    source.indexOf("input_schema", source.indexOf('name: "get_my_learning_sessions"')),
  );
  assert.match(historyDef, /NOT the school's subject catalogue/);
  // The history case reads only the learner's own learning records — bounded
  // and free of any contact details.
  const historyCase = source.slice(
    source.indexOf('case "get_my_learning_sessions"'),
    source.indexOf('case "create_task"'),
  );
  for (const table of ["student_agents", "agent_knowledge", "adaptive_sessions", "session_knowledge_delta"]) {
    assert.match(historyCase, new RegExp(table), `the history case must read ${table}`);
  }
  for (const sel of historyCase.match(/\.select\("([^"]*)"\)/g) ?? []) {
    assert.doesNotMatch(sel, /email|phone|username|password|guardian/i, `history case selects private columns: ${sel}`);
  }
});

test("draft cards survive a reload — tool previews ride the persisted message meta", async () => {
  // The migration exists and ships in the schema group (applies at boot).
  const manifest = JSON.parse(
    await readFile(new URL("../../migrations/manifest.json", import.meta.url), "utf8"),
  );
  assert.ok(manifest.schema.includes("2026-chat-message-meta.sql"), "meta migration must be in the schema group");
  const migration = await readFile(new URL("../../migrations/2026-chat-message-meta.sql", import.meta.url), "utf8");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS meta jsonb/);
  // The server derives preview meta from the turn's tool executions …
  assert.match(source, /function previewMetaFrom\(/);
  assert.match(source, /prepare_activity|revise_activity_draft/);
  // … saves it beside the trace …
  assert.match(source, /trace: traceBlocks, meta: previewMetaFrom\(prepared\.toolExecutions\)/);
  assert.match(source, /update\(\{ trace, \.\.\.\(meta \? \{ meta \} : \{\}\) \}\)/);
  // … and serves it with a rolling-deploy fallback.
  assert.match(source, /loadMessages\("id, role, text, created_at, trace, meta"\)/);
  assert.match(source, /\/meta\/i\.test\(String\(error\.message \|\| ""\)\)/);
  // The instructor client rebuilds the cards from that meta on restore.
  assert.match(instructorChatPage, /previews: m\.meta\.previews/);
});

test("the instructor chat opts out of the mobile TopBar — the conversation gets the room", () => {
  assert.match(instructorChatPage, /hideTopBarOnMobile>/);
  assert.match(instructorChatPage, /height: isMobile \? 'calc\(100vh - 86px\)' : 'calc\(100vh - 150px\)'/);
});
