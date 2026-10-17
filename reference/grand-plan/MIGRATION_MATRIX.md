# Akoro Learning Agent — Phase 0 Migration Matrix

**Status:** Phase 0 output for `reference/Grand Plan.md` §17 (audited 2026-10-17
against `arena/e9efe0e4-akoro`). Read-only audit, with no behaviour changed. The
one exception is a read-only gate check (`curriculum.syllabus_coverage`) added
to answer Q1 from production data.

Paths are relative to `akoro-api/modules/` unless they start with
`akoro-learner/`. "AL" means `adaptive-learning/`. Line numbers are as of the
audit date.

---

## 1. Headline findings

These change what Phase 1 and later phases must do first.

| # | Finding | Evidence | Impact |
|---|---|---|---|
| F1 | **The Study Prep planning loop is very likely broken in production.** Tool names such as `syllabus.resolve` are sent as OpenAI function names. OpenAI only accepts `^[a-zA-Z0-9_-]{1,64}$`, so it answers 400. Nothing catches the error, so the session stays in `planning` with no plan. | `AL/study-prep/llm-agent.js:23-27`, `agent-loop.js:63` (no try/catch around `agent.next`). The "zombie planning session" workaround in `chat.js:2355-2378` matches. | Fix before promoting the loop (Phase 2). Map dotted names to `syllabus_resolve`-style names at the adapter, and catch provider errors as observations. **Inferred from code and the API rule; confirm with one gate run.** |
| F2 | **Production has no syllabus or concept data.** `edu.syllabus_subjects`, `syllabus_topics` and `concept_catalog` returned 0 rows for every subject tried (JSS1 Basic Science, JSS1 Mathematics, SS2 Biology, and an empty filter). | Gate `curriculum.syllabus_coverage`, target production, build 2666f0a0. | Every Study Prep plan so far had no syllabus behind it. D30 (generate an outline when missing, §8.7) moves from "nice to have" to a **prerequisite** for Study Prep. Ingesting real syllabi (`syllabus.js` `ingestSubject`, `scripts/ingest-syllabus.mjs`) is a parallel data task. |
| F3 | **Study Prep practice is charged twice.** The harness debits a flat 2 coins, then the question generation also bills real tokens through the metered client. Every signed-in request carries the learner as payer. | `harness.js:225-228` (flat `COINS_PER_PRACTICE: 2`, `education-engine.js:75`); `exam-prep-service.js:83` → `lib/aiModel.js` `meteredCreate`; `auth/routes.js:560` `runWithAiContext({userId})`. | Learners pay about 4 coins per practice, not 2. Either drop the flat charge or run the generation with `__payer: "platform"`. Answers **Q2** (§2). |
| F4 | **The phase gate can be bypassed.** `NaNaEsumaiOrchestrator` and `TrainedOrchestrator` set `phase` and `mustKnowIndex` straight from the guide's output, with no evidence gate and without the 8-step runner. They are reachable through `start_session` / `getOrchestrator` with an `agentPairId`. | `agents/nana-esumai/orchestrator.js:66-88`, `trained/orchestrator.js:239,245`, `registry.js:37-50,71-82`. | D17 ("phase changes only by `applyTeachingProgress`") holds only for `StudentSessionOrchestrator`. Phase 6 must retire these paths or send them through the gate. |
| F5 | **Native teaching and decay never write the learner concept model.** `learner_concept_state` and `learner_concept_evidence` are written only by the Python-agent rpc routes and by one Study Prep upsert, which bypasses the rpc and doesn't update state. There are **three separate decay models**: `agent_knowledge` (JS), `knowledge_confidence` (JS, 0-100) and `learner_concept_state` retention (SQL, 0-1). | §8 below. | Phase 4a (evidence everywhere) and Phase 10 (one writer) are bigger than the plan says. The scale mismatch (0-100 vs 0-1) is real. |
| F6 | **A second teaching transport is missing from the plan.** An HTTP bridge, `agent-tools/teaching-workflow-routes.js` (`/api/internal/agent-tools/v1/teaching-workflow`), is used by `akoro-python-agent`. It has its own in-memory session Map, writes no `adaptive_sessions` row, and its `decay`/`continuation` modes load nothing. | `teaching-workflow-routes.js:25,33,154,199,230,243`. | Two in-memory session stores (`websocket.js:35` and this one) must move onto `workflow_instances` together. |
| F7 | **Several Study Prep state rules are advisory only.** | `harness.js:107,463-471,489,509-514`; `state-machine.js:21`. | The Phase 1 generic transition helper must be enforced, not decorative. See §3.1. |

---

### 1.1 Fixed since the audit (2026-10-17)

| Finding | Fix | Proof |
|---|---|---|
| F1 planning loop | Provider-safe tool names mapped back (`llm-agent.js`); provider errors logged as `agent_error` events; call labelled `study_prep_planning`, 45 s timeout. Two more causes surfaced once the 400 was gone: tools had **no argument schemas** (`TOOL_ARGS` in `tools/registry.js` now), and the planner spent its 6 iterations reading (it now knows its budget; the last planning iteration offers only `propose_plan`). | Gate `studyprep.plan_completes` PASS 3/3 on the sandbox (with a sandbox-only JSS1 Basic Science seed, F2 still open for production) |
| F3 double charge | Generation is platform-paid when Study Prep already took the flat price (`prepaid` in `exam-prep-service.js`); the standalone exam-prep route stays metered. | Gate `studyprep.practice_charged_once` PASS: one debit, `study_prep_practice`, −2 |
| **F8 (new)** every `/study-prep/sessions/:id` route and `getOwnedExamPrepRun` rejected real UUIDs (13 hex digits required in the last group) — the plan card could never be confirmed; practice could never be submitted or retested | Both patterns now 8-4-4-4-12, tested against real UUIDs. | Same gate run: confirm and practice succeed |

| F2 empty syllabus | `syllabus.generate` (§8.7): when the platform syllabus is empty the planner drafts an outline, checked in code, saved to `edu.generated_syllabi` as provisional, reused per scope, labelled "AI-drafted outline" on the plan card and in narration; refused while a real syllabus exists. Real syllabi still to be uploaded. | Gate `studyprep.generated_outline` PASS on the sandbox and on production |
| §7 test gaps | Seam tests on an in-memory db (`lib/testing/fakeDb.mjs`) for the Study Prep store, read tools, resolver, generator, chat handlers and routes; teaching lifecycle, context, the 8-step turn and the workflow projection; decay math, exam prep, lesson ladders, syllabus reads and battle questions (~215 tests). | 1,074 API tests pass |

**Bugs those tests found, all fixed (2026-10-17):**
- `listEvents` returned the oldest events, so "recent activity" showed the session start.
- Mastery evidence was dropped for topic labels with a comma (`or()` filter).
- An SS1 learner got the JSS1 syllabus (class substring match).
- `getRelevantMemory` ignored the subject.
- `GET /study-prep/sessions` turned a database error into "no session".
- The lesson ladder cache never matched learners without a school/class (`eq(null)`), so the ladder was regenerated each session.
- Battle questions marked a correct answer wrong when an empty option was dropped.
- Two simultaneous teaching completions both awarded XP.
- Starting a retest overwrote the diagnostic score with 0.

| F4 ungated phase paths (D42) | `getOrchestrator` always builds the gated student session; a guide pair / trained agent / saved preference only picks the guide. NaNa / Trained orchestrators no longer run turns. Legacy socket starts retired. `switch_agent_pair` keeps the whole session (it used to rebuild a decay session as free teaching); `start_adaptive_session` honours the chosen guide. | `agents/registry.d42.test.mjs`; regression PASS |
| F6 Python teaching bridge (D43) | One shared session start (`teaching-session/start.js`) for the socket and the bridge; the bridge saves the session (recordId), every turn, completes on end; continuation/decay run in Akoro with `previousSessionId` / `notificationId`; the Python agent no longer falls back to its local loop on an outage. | Gate `teaching.bridge_persists` PASS; 79 Python tests |

| D44 one forgetting curve (part of F5) | `agents/student/retention.js`: per-concept curve (learned × e^(−days ÷ stability), stability 45 days, ×2 per good review), recomputed nightly from the last review (the old pass compounded). Teaching files knowledge under the lesson topic + concept; topic health from its concepts; one alert per topic naming faded concepts; concept-led review sessions; per-concept reinforcement. `knowledge_confidence` and `learner_concept_state` retention are still separate (folded in Phases 8/10). | `retention.d44.test.mjs`; gate `decay.concept_curve` PASS (sandbox); columns present on production |

Still open: F5 (the other two retention models and the single-writer rule), F7, plus the `resolve_class` / `resolve_school` steps of §8.7 (school syllabi from `mgmt.*`). Python sessions using Python-only features (attached conversation, concept-state / insights / soul-state flags) still run on its local loop until those contracts are unified.

## 2. Open questions (§20)

| # | Answer |
|---|---|
| **Q1** JSS1 Basic Science rows | **None.** Production has 0 rows in `edu.syllabus_subjects`, `edu.syllabus_topics` and `edu.concept_catalog` (any subject). See F2. Re-check with gate scenario `curriculum.syllabus_coverage` (suite `curriculum`, pin `"target":"production"`; params `subject`, `classLevel`, `exam`). |
| **Q2** Real per-generation coin cost | **About 2 coins metered + 2 flat = about 4 per practice today.** The generation prompt is ~150 tokens in, ~1,000-1,500 tokens out on gpt-4o-mini ($0.15 / $0.60 per 1M). The cost is ≈ $0.0006-0.0009, × markup 2 (`AI_COIN_MARKUP`) ÷ $0.001 per coin (`COIN_USD`), giving 2 coins (min 1). The ceiling is 5 coins at `max_tokens: 3500`. The flat charge (`COINS_PER_PRACTICE: 2`) is added on top (F3). The plan estimate's `loopCoins` is shown to the learner but never charged; the loop's own LLM calls are metered separately under the ambient feature label. Recommendation: one charge per practice, the metered one, and estimates computed from `lib/aiPricing.js`. |
| Q3-Q5, Q8-Q10 | Unchanged; they belong to later phases. |

**New questions raised by the audit:**

| # | Question | Phase |
|---|---|---|
| Q22 | Retire or gate the NaNa and Trained orchestrator paths (F4), and the legacy socket starts `start_session`, `start_student_session` and `start_decay_session`? The last two never persist a session. | 6 |
| Q23 | Keep, migrate or retire the Python-agent teaching bridge (F6)? | 1 / 6 |
| Q24 | Which retention model wins: `learner_concept_state` (SQL), `knowledge_confidence` or `agent_knowledge`? The plan says the Education Engine; that means migrating two JS decay passes. | 8 / 10 |
| Q25 | Proctored `AssessmentRoom` / `assessmentGateway.js` is in neither §6.1 nor §6.2. Confirm that it is the Practice workflow's base (D29) and add it to the map. | 9 |
| Q26 | Fix the double charge (F3) now, ahead of Phase 5? | now |

---

## 3. Backend matrix

### 3.1 Study Prep — `AL/study-prep/` (mounted `/api/adaptive/study-prep`, `index.js:80`)

There is no Socket.IO, no SSE and no cron. It is reached through REST and through two chat tools inside `POST /api/adaptive/chat/agent`.

| File | Exports (key) | Callers → runtime entry | DB (R/W) | Tests | Plan target (§6.2) / notes |
|---|---|---|---|---|---|
| `state-machine.js` | `SESSION_STATES`, `TOPIC_STATES`, `canTransitionSession/Topic`, `POLICY`, `REJECTION_CODES` (17), `DECISION_NODES` (14), `validatePlan`, `teachBackGate`, `attemptCapGate` | harness, events, narration, agent-loop, llm-agent | — | `state-machine.contract` (6) | → generic transition + definition. **`canTransitionSession` is only used by `pauseSession`.** |
| `harness.js` | `createHarness` (19 ops), `HarnessRejection`, `InsufficientBalanceError` | wiring, store (**circular**), routes | via store | `harness.contract` (15), `agent-loop.contract` (6) | → generic harness + Study Prep checks. Known bugs are below. |
| `agent-loop.js` | `runAgentStep`, `TERMINAL_ACTIONS`, `observationFor`, `replayableEvents` | wiring only | W `study_prep_events`, R sessions (via store) | `agent-loop.contract` (6) | → `agent-runtime/`. `contextSetName` param is accepted but unused. **`SESSION_TOOL_CALL_CAP` (40) never fires** (per-step counter, 6 < 40). |
| `llm-agent.js` | `makeLlmAgent` | wiring | — (metered, no `__feature`, no timeout: SDK default 10 min + 2 retries) | **none** | → `agent-runtime/`. **F1.** Planning sees all 16 tools, including `conclude_session`. |
| `events.js` | `makeEvent`, `EVENT_TYPES` (6), `ORIGINS` (3), `publicEvent`, … | harness, agent-loop, routes | — | `events.contract` (7) | → v3 envelope. The SQL CHECK lists on event_type/origin/thought_type block v3 until migrated. |
| `narration.js` | `deliberate`, `pauseCopy`, `NARRATION_POLICY_VERSION` | harness, wiring, routes | — | snapshot (4) | → `ActivityNarrator`. UI tests pin `pauseCopy`. |
| `store.js` | `supabaseStore` (13 methods) | wiring, routes, chat-tool-handlers | RW `edu.study_prep_sessions`, `study_prep_topics`, `study_prep_events` (append-only; sequence = max+1 with 3 retries, **non-atomic**); R `concept_catalog`; W `learner_concept_evidence` (direct upsert, F5); wallet via `lib/coins.js` | **none** | → generic store + Study Prep store. Break the store↔harness cycle first. |
| `education-engine.js` | `scoreAttempt`, `applyThreshold`, `topicOutcome` (unused), `masteryWriteBack`, `STUDY_PREP_COST`, `estimateSessionCost`, `STRATEGY_LIBRARY` | harness, **`exam-prep-service.js:24`** (outside consumer) | — | via `exam-prep-service.contract` | → Education Engine. `estimateSessionCost` hard-codes 12/6 instead of `POLICY`. |
| `read-tools.js` | `getLearnerState`, `getLearnerHistory`, `getRelevantMemory`, `getPrerequisites`, `resolveSyllabusTool`, `makeSessionStateReader` | wiring → registry | R `knowledge_confidence`, `learner_concept_state`, `learner_exam_prep_runs`, `learner_concept_evidence` | **none** | → per-workflow registry. |
| `syllabus-resolver.js` | `resolveTopics`, `prerequisiteEdges`, `shapeSyllabus`, `topicSlug` | wiring, read-tools; gate `curriculum.syllabus_coverage` | R `syllabus_subjects`, `syllabus_topics`, `concept_edges`, `concept_catalog` | **none** (gate check only) | Keep. Returns `[]` today (F2). |
| `wiring.js` | `getHarness`, `runStudyPrepPlanningStep`, `startStudyPrepSession`, `studyPrepEnabled` | routes; `chat.js:2347,2375`; chat-tool-handlers | indirect | **none** | Keep as composition root. **Hard-codes `setName`/`contextSetName: "planning"` (:59, :71).** |
| `routes.js` | router (17 routes) | `index.js:34,80` | via harness | 2 source-regex contracts | No `/flag` route (the comment at :175 lists one). |
| `chat-tool-handlers.js` | `getStudyPrepSessionSummary` | `chat.js` tools `start_study_prep_session`, `get_study_prep_session` | R sessions/topics/events | static checks | **Not in §6.2.** |
| `workflow-grouping.js` | `groupWorkflowRows`, `publicGroupedWorkflows` | `adaptive-workflows.js` | — | contract (4) | **Not in §6.2.** A no-op in practice: nothing writes `adaptive_workflow_runs.study_prep_session_id`. |
| `context-manager.js` | re-export shim of `agent-context/context-manager.js` | wiring | — | `contextLayer.contract` (5) | Not in §6.2; drop with Phase 4. |
| `../tools/registry.js` | `TOOL_DEFINITIONS` (17), `TOOL_LEVELS`, `HARNESS_ONLY_OPERATIONS` (4, a deny-list), `buildRegistry`, `llmFacingTools` | wiring, llm-agent | via handlers | `tools/registry.contract` (5) | Confirmed: read 8 / propose 7 / execute 2. `content.search` is hidden and stubbed. `session.replan` is an alias of `proposePlan`. |

**Persisted states.**
- **Session:** `planning`, `awaiting_confirmation`, `topic_active`, `replanning`, `paused`, `completed`, `abandoned`, `cancelled`. There is one active session per learner (partial unique index).
- **Pause reasons:** `agent_loop_cap`, `insufficient_balance`, `learner_requested`.
- **Topic:** `queued`, `active`, `understood`, `flagged_gap`, `capped_out`, `deferred`. `retest_offered` exists in memory only.

**Policy.**
- `POLICY`: MAX_TOPICS 12, DEFAULT_MAX_ATTEMPTS 3, CRAM 1, PASS 0.70, MAX_ITERATIONS_PER_STEP 6, SESSION_TOOL_CALL_CAP 40, DEFERRED_RETRIES 1, INTENT 240, FAN_OUT 4.
- The live attempt cap and threshold come from `examPrepPolicyFor`, not from `POLICY`. CRAM, FAN_OUT and PASS are unused.

**Study Prep bugs to fix before or while generalising it:**
1. `replanning` is never written. `POST /plan` on `topic_active` always returns 409. `abandoned` is never written either.
2. `harness.pause()` writes planning→paused, which the table forbids.
3. `concludeSession` has no state guard.
4. `cancelSession` can overwrite `completed`.
5. The planning agent can call `conclude_session`.
6. `sessionNext` re-publicises an already-public topic (`harness.js:558`), which blanks `attemptsUsed`, `examPrepRunId` and readiness.
7. `masteryWriteBack` reads `topic.mastery`, a column that doesn't exist, so every attempt counts as a first attempt (`harness.js:299`).
8. `submitExamPrepAttempt`'s `{notFound:true}` return is not handled.
9. `tool_calls_used` is never written.
10. The "already settled" branch in `advanceTopic` is unreachable. `flagTopic` is unreachable at runtime.
11. `AKORO_STUDY_PREP_ENABLED` is read at load in `chat.js:157`, but per call in `wiring.js:23`.

### 3.2 Teaching — `AL/teaching-workflow/`, `AL/teaching-session/`, `AL/websocket.js`

| File | Exports (key) | Callers → runtime entry | DB (R/W) | Tests | Plan target / notes |
|---|---|---|---|---|---|
| `teaching-workflow/runner.js` | `TEACHING_TURN_WORKFLOW`, `executeTeachingTurnWorkflow`, `runTeachingWorkflowTools` | `agents/student/orchestrator.js:311` (`processTeachingMessage`) ← socket `teacher_message`; HTTP bridge `…/teaching-workflow/sessions/:id/turns` | — | `runner.test` (2), bridge contract (2) | Retire after Phase 6. Emits `teaching_workflow_step` started/completed. |
| `teaching-workflow/tools.js` | `createTeachingTurnTools` | runner only | RW `edu.student_states` (+ Redis), W `student_knowledge` (every turn), W `agent_knowledge` (buffered, flushed at end) | **none** | Keep and split into fixed steps vs agent tools. **`updateStudentState` runs twice per turn** (:108, :224) and is not idempotent. |
| `teaching-workflow/catalog.js` | `TEACHING_TURN_TOOL_CATALOG` | runner, tools | — | — | **Not in §6.2.** Move with tools.js. |
| `teaching-session/state-machine.js` | `STUDENT_PHASES` (PHASE_1-4, MASTERY), `ACTION_FOR_DIALOGUE_MOVE` (7 moves), `applyTeachingProgress` | tools, student orchestrator | — | `state-machine.test` (5) | Keep as-is (the gate). |
| `teaching-session/lifecycle.js` | `createSessionRecord`, `ensureSessionRecord`, `readSessionBlocks`, `appendSessionBlocks`, `completeSessionRecord` | websocket.js | RW `edu.adaptive_sessions` (incl. `teaching_evidence` JSONB) | **none** | Keep and link to `workflow_id`. **`completeSessionRecord` awards ranking XP.** That must stay exactly-once. |
| `teaching-session/context.js` | `carryForward`, `loadContinuationContext`, `loadDecayPriorLesson` | websocket.js | R `adaptive_sessions` | source-regex only | **Not in §6.2.** |
| `websocket.js` (985 lines) | `setupWebSocket`, `activeSessions` (in-memory) | `AL/index.js:137` ← `app.js:265` | via lifecycle/context | identity contract (4, regex), grounding (5) | Thin to a transport adapter. The full event list is in §5. |

**The 8 fixed steps, in order** (`runner.js:15-22`). 5 of them are LLM calls.

| # | Step | What it does |
|---|---|---|
| 1 | `load_session_state` | |
| 2 | `observe_teaching_evidence` | LLM |
| 3 | `generate_protege_discussion` | LLM, streamed |
| 4 | `assess_protege_understanding` | LLM |
| 5 | `persist_cognitive_state` | |
| 6 | `record_verified_learning` | LLM extraction |
| 7 | `coach_teaching_dialogue` | NaNa `getTip`, LLM, streamed |
| 8 | `gate_teaching_progress` | `applyTeachingProgress` |

**`start_adaptive_session`** (`websocket.js:468-658`).

| Mode | Session type | Extra setup |
|---|---|---|
| `fresh` | `free_teaching` | — |
| `continuation` | `continuation` | `loadContinuationContext` |
| `decay` | `decay_review` | `generateDecaySession` → `markNotificationRead` → `loadDecayPriorLesson` |

Every mode then runs `getOrchestrator` → `resolveLadder` → `initialize` → `session_ready`, followed by a background `createSessionRecord` → `session_saved`.

**Legacy starts that are still live:**
- `start_session` (:351), which reaches the ungated NaNa and Trained orchestrators (F4).
- `start_student_session` (:387) and `start_decay_session` (:417). These never persist a session.

### 3.3 Decay — `AL/agents/student/decayEngine.js` (812 lines; its own Supabase client, not `db.js`)

| Function | Pure? | Tables | Notes |
|---|---|---|---|
| `calculateDecayedConfidence`, `getPriority`, `getNextReviewDate`, `_build*` helpers | **pure** (already exported) | — | The §6.2 "extract pure functions first" step is half done. |
| `applyDecay`, `reinforceKnowledge` | IO | RW `agent_knowledge`, W `decay_events` | Protégé confidence, not learner. |
| `generateDecaySession` (+ monkey-patched wrapper :773) | IO + LLM (`_getMustKnowForTopic`, gpt-4.1-mini) | R `agent_knowledge`, `knowledge_confidence` | `subject` null → silently uses the default 0.30. |
| `sendDecayAlert` | IO | W `decay_notifications`, `notifications`; socket `knowledge_decay_alert` | |
| `applySubtopicDecay`, `getSubtopicAlerts` | IO | RW `knowledge_confidence` (0-100), upsert `decay_notifications` | Prototype. |
| `runDecayScheduler` | IO | R `student_agents` → the above | Started in `AL/index.js:145-157` (`registerTick("decay-scheduler")`, node-cron 03:00 or the Cloudflare tick); manual `POST /api/adaptive/chat/decay/run`. |

**Tests:** no behavioural tests of the decay math.

### 3.4 Learner state, exam prep, personas, curriculum, practice

| File | Key facts | Tests | Plan target / notes |
|---|---|---|---|
| `AL/student-state.js` | RW `edu.student_states` + Redis; preferences tables; **`decideNextAction` has no callers** (dead) | none | §6.2 "fold in" becomes **"delete"**. The real decision-makers are `ACTION_FOR_DIALOGUE_MOVE`/`applyTeachingProgress` and the guide's `getTip` output (F4). |
| `AL/teaching-evidence.js` | pure; stored as `adaptive_sessions.teaching_evidence` | `teaching-evidence.test` (6) | Feeds Phase 4a backfill. |
| `AL/exam-prep-service.js` | **the deciding topic state machine is `learner_exam_prep_runs.status`** (`nextRunStatus`); RW `learner_exam_prep_runs/attempts`; R `exam_prep_confidence_policies`; LLM generation (F3) | contract (9) | Keep as attempt adapter. Router `/api/adaptive/exam-prep` (`exam-prep-confidence.js`). |
| `AL/adaptive-workflows.js` + `workflow-state.js` | projection only, behind `AKORO_ADAPTIVE_WORKFLOWS_ENABLED`; `researching`/`planned` **never written** (inserts `diagnostic_ready`); 8 states incl. `cancelled`; DB CHECK constraint | `workflow-state.test` (2) | Absorb after Phase 4. Also read by `learner-chat-read-tools.js:260` and `GET /api/adaptive/exam-prep/workflows`. |
| `agents/student` | `StudentSessionOrchestrator` (`initialize`, `processTeachingMessage`, `generateSummary`, `endSession`); `StudentAgent`; `knowledge.js` (20 exports) | golden persona tests | Persona tools (Phase 6). |
| `agents/nana-esumai` | `NaNaEsumai` guide (`generateSubtopics`, `getTip`, `evaluateSession`, …); **ungated orchestrator** (F4) | — | Persona tool; retire orchestrator. |
| `agents/sargeant` | `Sargeant` (`generateQuestions`, `evaluateAnswer`, `checkForDrift`); `SergeantProctor` | — | Assessor (lock model, Phase 9). |
| `AL/lessonLadder.js` | `resolveLadder`, `learnerContext`; R `mgmt.students`, `classroom_students`, `mgmt.scheme_of_work`; RW `edu.lesson_ladders` | none (golden-path script) | Keep. |
| `AL/syllabus.js` | `ingestSubject`, `searchSyllabus` (rpc `match_syllabus`), outline/grounding; routes `/api/adaptive/syllabus` (ingest = admin) | none | Keep. **This is the ingestion path that would fill F2.** |
| `AL/assessmentGateway.js` | proctored Sargeant over Socket.IO; RW `edu.assessment_sessions`; storage `training-assets` | none | **Not in §6.1/§6.2** (Q25). Practice base (Phase 9). |
| `battle/agentRecall.js`, `battle/questionSource.js` | recall via rpc `match_student_knowledge`; questions from past papers / bank / LLM (`chargeForAI`) | none | Agent Check source (Phase 5). |
| `agent-tools/teaching-workflow-routes.js` | the second teaching transport (F6) | contract (2) | **Not in plan** (Q23). |

---

## 4. Frontend entry points (`akoro-learner/src`)

Nothing uses `workflowId`, `workflow_id`, `open_workflow` or `teaching_workflow_step` today.

| Component | Mounted at | Starts / resumes | Session-id state a workflowId change touches |
|---|---|---|---|
| `components/teaching/TeachAgentModal.jsx` (1017) | Dashboard `:1316`, **plus** `RecordTeachSession.jsx:714`, `AgentSessionViewer.jsx:251`, `PharmDTopicSession.jsx:190` | own socket; `start_adaptive_session {topic, subject, mode, sessionId, teacherAgentId, reference, document}` or `resume_session`; mode = `config.mode \|\| session.mode \|\| "fresh"` | refs `sessionIdRef`, `parkedRef`; `onMinimize({sessionId, mode, …})`, `onSessionStarted(sid)`; **three sessionStorage keys** `akoro_teach_sid_${recordId}`, `…_lesson_${lessonId}`, `…_pharmd_${topicId}` (24 h) |
| `components/teaching/DecaySessionModal.jsx` (262) | Dashboard `:1340` | own socket; `start_adaptive_session {mode:"decay", notificationId}` (or `continuation` + `sessionId` after a failed resume) | `sessionIdRef = alert.resumeSessionId`; the "recording" control is fake (sends placeholder text) |
| `pages/LearnerDashboard.jsx` (1418) | `/app` | routes everything; type inferred by joining decay alerts to sessions (`decayBySession`, `:720-723`), synthetic decay cards (`:746-767`), and branching **duplicated** in SessionSheet `onStartTeach` (`:1395-1410`) and `openNowItem` (`:415-441`) | localStorage `akoro_nowstudying_${uid}` snapshots `{__restore:'teach'\|'decay', …}`; synthetic ids `teach-…`, `decay-…` |
| `components/sessions/SessionSheet.jsx` (204) | Dashboard `:1382` | none (CTA labels only) | — |
| `components/tabs/AgentChatTab.jsx` (1311) | Dashboard `tab==="agent"` | SSE `POST /api/adaptive/chat/agent?stream=1`; stop `POST …/agent/stop`; re-attaches the active Study Prep session | localStorage `ak_chat_model`, `ak.agentChat.devView`, `ak_read_aloud` |
| `components/tabs/studyPrep/StudyPrepChatCard.jsx` (341) + `services/studyPrepApi.js` | inside chat messages | REST gates (§5.2) | session id only in message state; **no polling/stream** (stuck on "still planning…") |
| `components/assessment/AssessmentRoom.jsx` (293) | Dashboard `:1351`; `/assessment` | own socket `start_assessment {studentId, …, userId}` (browser-supplied ids) | `assessIdRef` |
| `components/assessment/ExamPrepConfidenceModal.jsx` | — | `/api/adaptive/exam-prep/confidence-runs` | **unreachable** (`onStartExamPrep` is accepted but never used) |

**Frontend discrepancies vs the plan:**
1. **"Learning with guide" is UI-only, as §6.1 says.** Its note (`en.js:612`) also falsely says the message "is kept in this session".
2. There is no Study Prep → Teaching handoff in the UI. Teach-back is one confirm POST.
3. §13.1's dashboard "Study Prep" / "Practice" buttons don't exist. Study Prep starts only from chat (`startStudyPrepSession` is unused).
4. The modals do own state (refs, parked flag), contrary to §13.1.
5. There are no `teaching_workflow_step` labels to "keep" (§9.7). The frontend shows `cogState.phase` only.
6. The stop path is `/chat/agent/stop`, not `/chat/agent/turns/:turnId/stop` (§13.4).
7. AgentChatTab is 1311 lines (plan: ~990). Library records, course lessons and PharmD are missing from the §13.1 launcher table.
8. Dead hooks: `useWebSocket`, `useSessionAPI` and `useDecayAlerts` are imported by the dashboard but never called.

---

## 5. Transport inventory

### 5.1 Socket.IO (learning sessions)

| Event | Direction | Server | Client |
|---|---|---|---|
| `start_adaptive_session` | C→S | websocket.js:468 | Teach:264, Decay:71 |
| `resume_session` / `park_session` / `end_session` | C→S | :747 / :797 / :811 | Teach:283/587/572, Decay:82/188/176 |
| `teacher_message` | C→S | :661 | Teach:298,353,701; Decay:95,133,213 |
| `get_state`, `request_summary`, `switch_agent_pair` | C→S | :948, :729, :837 | Teach:397, 754, 743 |
| `get_knowledge_health`, `get_subject_topics`, `acknowledge_alert`, `get_agent_growth`, `list_agent_pairs`, `get_my_agents` | C→S | :922, :931, :940, :960, :324, :333 | (AgentStatsTab, others) |
| legacy `start_session`, `start_student_session`, `start_decay_session` | C→S | :351, :387, :417 | not emitted by the learner app |
| `session_preparing` → `session_ready` → `session_saved` (order is a contract) | S→C | :484, :601, :642-652 | Teach, Decay |
| `typing_start`, `student_token`, `guide_token`, `state_update`, `teaching_workflow_step`, `student_done`, `guide_done`, `turn_complete {blocks, currentPhase, workflow}` | S→C | :667-713 | Teach (Decay: subset; `teaching_workflow_step` unused) |
| `session_resumed`, `resume_failed`, `session_parked`, `session_ended {decayResult}`, `session_summary`, `summary_error`, `agent_pair_switching/switched`, `state_snapshot`, `error` | S→C | various | Teach |
| `knowledge_decay_alert`, `subtopic_decay_alert` | S→C (room `student:{id}`) | decayEngine.js:398, :477 | Dashboard:660, :671 |
| voice: `start/stop_voice_stream`, `voice_audio_chunk`; `voice_*` replies; TTS `start/stop_tts_stream`, `tts_*` | both | voice module | Teach, `useVoiceSession` |
| assessment: `register_reference`, `start_assessment`, `assessment_message`, `proctor_frame`, `resume_assessment`, `end_assessment`, `request_assessment_summary` / `assessment_*`, `proctor_result`, `reference_saved` | both | assessmentGateway.js:62-257 | AssessmentRoom:94-164 |
| `chat_follow_up_ready`, `agent:activity` | S→C | chat follow-ups | AgentChatTab:316, Dashboard:690 |

### 5.2 HTTP

| Area | Routes |
|---|---|
| Study Prep `/api/adaptive/study-prep` | POST `/sessions`; GET `/sessions`, `/sessions/:id`; POST `/sessions/:id/{plan, confirm, adjust, next, advance, defer, retry-deferred, conclude, pause, resume, cancel}`; POST `/sessions/:id/topics/:topicId/{practice, submit, teach-back-done}`. Frontend never calls create, `next`, `pause` or `cancel`. |
| Teaching | GET `/api/adaptive/teaching/sessions`; POST `/api/adaptive/teaching/{configure, reference}`; bridge `/api/internal/agent-tools/v1/teaching-workflow/*` (F6) |
| Decay | GET `/api/adaptive/chat/decay/{alerts, status, subjects}/:id`; POST `/api/adaptive/chat/decay/run`; tick `POST /api/internal/ticks/decay-scheduler`. (`chat.js:9` documents a non-existent `/decay/session/start`.) |
| Exam prep | `/api/adaptive/exam-prep/confidence-runs[/:id/{submit, retest}]`, GET `/workflows` |
| Agent Chat | POST `/api/adaptive/chat/agent[?stream=1]`, `/agent/stop`; `/api/adaptive/chat/sessions…` |
| Concept state (Python agent) | `/api/internal/agent-tools/v1/concept-state/{observations, snapshot}`, learning-insights rpc |

---

## 6. Every writer of learner concept state (Phase 10 inventory)

| Store | Scale | Writers |
|---|---|---|
| `edu.learner_concept_state` | 0-1 | SQL `record_learner_concept_evidence` (rpc ← `agent-tools/concept-state-routes.js:180`, Python agent); SQL `refresh_learner_concept_retention` (rpc ← `:134`) |
| `edu.learner_concept_evidence` | — | the same rpc; **direct upsert `study-prep/store.js:152`** (bypasses the rpc, no state update) |
| `edu.learner_concept_tracker`, `learner_learning_episodes` | — | rpcs from agent-tools routes (Python agent) |
| `edu.knowledge_confidence` (+ `misconceptions`) | **0-100** | `battle/knowledge.js:139,153` (battle worker); `decayEngine.js:693` (nightly) |
| `decay_notifications.misconceptions/confidence` | 0-1 | `decayEngine.js:721`; `battle/knowledge.js:262,277` |
| `edu.student_knowledge` (learner notes) | 0-1 | `agents/student/knowledge.js:344-369` (every teaching turn); `battle/knowledge.js:56,73` |
| `edu.agent_knowledge` (protégé) | 0-1 | `knowledge.js:180-227`; `decayEngine.js:160,316` |
| `edu.student_states` (cognitive, mistakes) | 0-1 | `student-state.js:93` via `updateStudentState` ← teaching tools (×2 per turn), NaNa and Trained orchestrators |
| `adaptive_sessions.teaching_evidence` | — | `teaching-session/lifecycle.js` |
| `learner_concept_confusion_notes` | — | delete at `chat.js:2623` |

A grep-enforced "only the Education Engine writes" contract (Phase 10 exit) must cover: the battle worker, the nightly decay pass, the Python-agent rpc routes, Study Prep `store.js:152` and the teaching tools.

---

## 7. Test coverage gaps (add seam tests before moving code)

There are **no behavioural tests** for:
- Study Prep `store.js`, `llm-agent.js`, `wiring.js`, `read-tools.js`, `syllabus-resolver.js`, `chat-tool-handlers.js` and `routes.js` behaviour. The route tests only regex the source.
- `teaching-workflow/tools.js`, `teaching-session/lifecycle.js` and `adaptive-workflows.js`.
- The decay math and scheduler, `lessonLadder.js` and `syllabus.js`.
- `assessmentGateway.js`, `battle/agentRecall.js` and `battle/questionSource.js`.

The Verification Gate (`/api/verify`) can now cover the live paths end to end. Suggested scenarios before Phases 1-2:
- `studyprep.plan_completes` (F1)
- `studyprep.practice_charged_once` (F3)
- `teaching.turn_gate_holds`
- `decay.session_starts`

---

## 8. Corrections to apply to the Grand Plan

1. **§6.1 Teaching row:**
   - Modes are `fresh | continuation | decay`.
   - Add the legacy start events and the Python-agent HTTP bridge (F6).
   - The phase gate holds only in `StudentSessionOrchestrator` (F4).
2. **§6.1 Study Prep topic attempts:**
   - `researching`/`planned` are never written.
   - The deciding machine is `learner_exam_prep_runs.status`; `adaptive_workflow_runs` is a kill-switched projection.
3. **§6.1 Learner state:** `decideNextAction` is dead code. Delete it rather than fold it in.
4. **§6.1 Context:** 67 MD files; the 5 non-planning joined sets have no runtime consumer.
5. **§6.2:** add these files:
   - `study-prep/chat-tool-handlers.js`
   - `study-prep/workflow-grouping.js`
   - `study-prep/context-manager.js` (shim)
   - `teaching-workflow/catalog.js`
   - `teaching-session/context.js`
   - `assessmentGateway.js`
   - `agent-tools/teaching-workflow-routes.js`
6. **§6.2 `decayEngine.js`:**
   - The pure helpers are already exported.
   - `generateDecaySession` is IO + LLM and monkey-patched.
   - The engine uses its own Supabase client.
   - The scheduler lives in `AL/index.js`.
7. **§9.7:** there are no `teaching_workflow_step` labels in the frontend to keep. They must be added.
8. **§13.1:**
   - Add the Library-record, course-lesson and PharmD launchers.
   - The modals own resume state today.
9. **§13.4:** the stop route today is `POST /chat/agent/stop`.
10. **§8.7 (D30):** with F2, generated syllabi are a prerequisite for Study Prep, not a fallback.
11. **§20:** Q1 and Q2 are answered (§2 above). Add Q22-Q26.

## 9. Recommended order before Phase 1

1. **Now (bugs that hurt learners today):** F3 (double charge) and F1 (planning loop names + error capture), each with a gate scenario.
2. **Data:**
   - Ingest at least the JSS1-SS3 core subjects into `edu.syllabus_*` / `concept_catalog`, **or** build D30 (`syllabus.generate`) early.
   - Re-check with `curriculum.syllabus_coverage`.
3. **Seam tests** for the untested Study Prep store/LLM adapter and teaching tools (§7).
4. **Decide Q22-Q25.**
5. **Then Phase 1** (workflow tables + Study Prep dual-write behind `WORKFLOW_ENGINE_ENABLED`).
