# Akoro Context Layer Adoption — Mini-Plan (All Agentic Surfaces)

This is the follow-up phase recorded in the Study-Prep Master Plan §4.6 ("Adoption by existing features —
explicit later phase, not automatic"), extended per the product decision from "chat + persona agents" to
**every agentic surface in the platform**. The study-prep loop shipped the workspace
(`akoro-api/akoro-agent/`, 15 files) and the Context Manager
(`study-prep/context-manager.js`); this plan promotes them from study-prep-private to platform
infrastructure and migrates every agent onto them.

**The one-sentence goal:** every LLM call site in Akoro loads its doctrine from the same configurable
workspace through the same Context Manager, so Akoro's educational philosophy evolves by editing files —
never by redeploying prompt literals — while the database stays the only dynamic truth and tools stay the
only access to it.

Grounded in a full survey (2026-10-01): **41 LLM call sites** in `akoro-api` (41 files import
`openai.chat.completions.create`), plus the python agent's reasoning/loop modules, plus the chat tool
catalogues. Every one is inventoried in §2.

---

## 1. The Model

### 1.1 What changes

```
TODAY (per surface)                      AFTER (every surface)
─────────────────────────                ─────────────────────────
JS template literal         ──┐          modules/agent-context/
  "You are …" + rules         │    ──►     contextManager.load("chat_student")
hardcoded addenda/guides      │            → doctrine files (akoro-agent/)
DB config (trained teachers) ─┘          + dynamic truth (grounding, time,
                                           memory — still code-assembled)
```

- **Doctrine moves to files**: persona, tone, formatting contracts, teaching philosophy, safety rules —
  the stable "how to behave" text that today lives in JS/Python string literals.
- **Dynamic truth stays code**: syllabus/past-question grounding, current time, wallet, scratchpads,
  conversation summaries, learner state. The manager's `buildAgentContext` seam already separates these.
- **One workspace, many selection sets**: shared doctrine files (AGENT.md, LEARNING.md, SAFETY.md …) are
  composed per operation. Surfaces share doctrine; they never fork it.

### 1.2 What never changes (standing guarantees)

- **Files are never authoritative state** — no mastery numbers, wallet balances, learner ids, or policy
  values that belong in `exam_prep_confidence_policies`-style tables (already contract-tested).
- **Tool schemas and descriptions stay in code** (Decision D2): the model-facing tool catalogue is API
  surface versioned with its handler; only the *guides about using tools* (observation rules, HITL rules)
  are doctrine and move to files.
- **Trained-teacher config stays in the DB** (`agentPromptBuilder.js` + orchestration config + pgvector
  chunks): the context layer composes platform doctrine AROUND a teacher's own style, never replaces it.
- **No dual paths, no per-surface runtime flags**: once a surface loads from files, its legacy literal is
  deleted in the same commit. The golden snapshot tests are the safety, not a feature flag.
- One response envelope, stable 4xx `code`s, 500 genuine only, statuses hardcoded English,
  `gateway_authorization` never exposed — untouched by this plan.

---

## 2. Inventory & Status — every agentic surface

Legend: Prompt source today — `literal` (JS/Python string) · `db-config` · `files` (already adopted) ·
`none` (no doctrine text). Phase → §4. Tier: **A** learner-facing doctrine · **B** content generators ·
**C** auxiliary/agent infra · **D** python agent.

| # | Surface | File(s) | Source today | Target selection set | Tier / Phase |
|---|---|---|---|---|---|
| 1 | Study-prep loop (reference impl) | `study-prep/*`, `akoro-agent/` | `files` | `planning`/`research`/`teaching`/`reflection` | A / done |
| 2 | Agent Chat (student + instructor) | `chat.js` — `tutorSystemPrompt`, `THINK/RESEARCH_ADDENDUM`, `TOOL_OBSERVATION_GUIDE`, `INSTRUCTOR_HITL_GUIDE`, `DURABLE_MEMORY_GUIDE`, capability list | `literal` | `chat_student`, `chat_instructor` | A / **P1** |
| 3 | Voice session bootstrap | `voice/routes.js` (imports `tutorSystemPrompt`) | `literal` (via #2) | inherits #2 | A / P1 (free) |
| 4 | NaNa Esumai guide pair | `agents/nana-esumai/{guide,orchestrator}.js` | `literal` | `persona_nana` | A / **P2** |
| 5 | Sargeant (assessment + proctor) | `agents/sargeant/{assessment,proctor}.js` | `literal` | `persona_sargeant` | A / P2 |
| 6 | Student session agent | `agents/student/{agent,orchestrator}.js` | `literal` | `persona_student` | A / P2 |
| 7 | Decay engine / knowledge merge | `agents/student/{decayEngine,mergeKnowledge}.js` | `literal` | `reflection` + `persona_student` | A / P2 |
| 8 | Trained teacher agents | `agents/trained/{guide,control,orchestrator}.js` + `training/*` | `db-config` + literal shell | `persona_trained` (doctrine wraps DB style) | A / P2 |
| 9 | Base orchestrator | `agents/base-orchestrator.js` | `literal` | shared `persona_*` header | A / P2 |
| 10 | Teaching session phases | `teachingSession.js`, `teaching/tools.js` | `literal` | `teaching` | A / **P5** |
| 11 | Exam-prep practice generation | `exam-prep-service.js` | `literal` | `practice_generation` | B / **P3** |
| 12 | Syllabus/grounding generator | `syllabus.js` | `literal` | `research` | B / P3 |
| 13 | Draw (interpret/mermaid/svg/excalidraw) | `draw.js` — 4 prompts | `literal` | `draw` | B / P3 |
| 14 | Task tools (quiz-me, generate-quiz, explain-concept, study-plan, dynamic, challenge-peer, grade-submissions, export-report, ocr) | `tasks/tools/*.js`, `tasks/lib/_llm.js` | `literal` | `practice_generation` / `assessment` | B / P3 |
| 15 | Battle question source + agent recall | `battle/{questionSource,agentRecall,routes}.js` | `literal` | `practice_generation` | B / P3 |
| 16 | Curriculum + past-questions + instructor helpers | `curriculum/routes.js`, `past-questions/routes.js`, `instructor/{routes,tools}.js` | `literal` | `research` / `assessment` | B / P3 |
| 17 | Autonomy planner (THE LOOP) | `autonomy/cycle.js`, `adaptive-learning/learner-autonomy.js` | `literal` | `autonomy_planner` | C / **P4** |
| 18 | Peer consult | `peerConsult.js` | `literal` | `peer_consult` | C / P4 |
| 19 | Chat follow-ups + intent classifiers | `chat-follow-ups.js`, `agent-chat-intent.js`, `agent-tool-request-intent.js` | verify (rules or LLM) | `autonomy_planner` if LLM | C / P4 |
| 20 | Teacher task agent loop | `tasks/lib/agentLoop.js` + `tasks/lib/context.js` | `literal` | `teaching` | C / P5 |
| 21 | School AI (concierge, mgmt, website sync) | `school/{aiConcierge,mgmt,websiteAiSync}.js` | `literal` | `school_ai` (SAFETY + own files) | C / **P6** |
| 22 | Eval harness | `lib/evals/routing.js` | `literal` | mirrors target surface | C / P6 |
| 23 | Blog writing / research | via chat loop (#2) + `blogResearch.js` (search only, `none`) | via #2 | `chat_student` | A / free |
| 24 | Python agent reasoning | `akoro-python-agent/src/agent/reasoning/{decision,planner,teaching}.py` | `literal` (Python) | same files, `py_*` sets | D / **P7** |
| 25 | Python agent loops | `src/agent/loop/{agent_loop,tool_calling,adaptive_teaching_loop,remote_teaching_workflow}.py` | `literal` | same files | D / P7 |

---

## 3. Architecture changes (Phase 0 deliverables)

### 3.1 Promote the Context Manager to platform infrastructure

- New module `modules/agent-context/` — the manager moves from
  `modules/adaptive-learning/study-prep/context-manager.js` (which becomes a re-export shim so study-prep
  imports keep working; the shim is deleted in P7).
- The workspace stays at `akoro-api/akoro-agent/` (ships with the API deploy; already the case).

### 3.2 Workspace extension (new files, doctrine only)

```
akoro-agent/
├── (existing 15 files — shared doctrine, unchanged)
├── channels/CHAT.md              the chat formatting contract (markdown subset rules)
├── channels/VOICE.md             voice-specific brevity rules
├── agents/NANA_ESUMAI.md         persona pair voices
├── agents/SARGEANT.md            assessor + proctor persona
├── agents/STUDENT_AGENT.md       student-session agent persona
├── agents/TRAINED_SHELL.md       platform shell around DB teacher config
├── teaching/PHASES.md            teaching-session phase doctrine
├── practice/GENERATION.md        generated-practice rules (never a past paper, MCQ shape)
├── practice/ASSESSMENT.md        grading/rubric doctrine
├── practice/DRAWING.md           draw/sketch/mermaid/svg rules
├── policies/AUTONOMY_RULES.md    THE LOOP's planner boundaries
├── policies/TOOL_OBSERVATIONS.md the structured-observation guide
├── policies/HITL_DRAFTS.md       instructor human-in-the-loop rules
├── consult/PEER_CONSULT.md       peer-consult privacy framing
└── school/AI_CONCIERGE.md        school-scope doctrine (no learner doctrine leakage)
```

### 3.3 Manifest, preflight and budgets

- **`modules/agent-context/manifest.mjs`** — the registry of selection sets (machine-readable): each set
  names its files, marks them `required` or `optional`, and declares its budget.
- **Required vs optional semantics**: a missing *optional* file is silence (current behaviour); a missing
  *required* file **throws** — and a boot-time preflight (wired into `scripts/boot-smoke.mjs` + a contract
  test) fails the deploy before agent behaviour can silently change.
- **Budgets** (already enforced): ≤ 8 KB per file, ≤ 24 KB per assembled set — extended to every new set.
- **Drift audit**: the manifest hashes file contents; `context_version` (short hash) is logged at boot and
  available to surfaces that already version policy (`study_prep_events.policy_version` pattern). Doctrine
  changes become observable, not invisible.

### 3.4 The single-source rule

A source-contract test (extended each phase) asserts that the migrated files contain **no** `const … =
\`You are …\`` prompt literals — the only place "You are Akoro" may live is `akoro-agent/AGENT.md` (and
persona files for their own names). Tool descriptions, JSON schemas and grounding builders are exempt
(§1.2).

---

## 4. Build order (each phase is byte-identical-first)

Every phase follows the same three-step gate, in ONE commit per surface:

1. **Golden snapshot**: capture the surface's exact assembled system prompt today (from the live code
   path — the existing eval/golden-path harnesses in `scripts/evals/` + `lib/evals/` are the pattern).
2. **Extract verbatim**: move the text into workspace files UNCHANGED; route the call site through
   `contextManager.load(setName)`; the golden test must pass **byte-for-byte**.
3. **Delete the literal** in the same commit. Wording improvements happen LATER, as file edits with their
   own updated snapshots — never mixed into a migration commit.

**P0 — Platform promotion + preflight.** `modules/agent-context/` (manager + manifest + hashing), the
study-prep shim, boot-smoke wiring, and the manifest contract test. No surface migrated yet.
*Exit:* suite green; boot smoke proves every registered set resolves within budget or the boot fails.

**P1 — Agent Chat (+ voice, free).** `tutorSystemPrompt` student/instructor blocks, the three addenda,
the tool-observation/HITL/durable-memory guides and the capability list into
`channels/CHAT.md` + `policies/*.md` (+ existing shared doctrine). Sets: `chat_student`,
`chat_instructor`. *Exit:* the `/agent` route's assembled system content is byte-identical pre/post
migration (golden test over the real route assembly); voice boots on the same files.

**P2 — Persona agents.** NaNa Esumai, Sargeant, student agent, decay/merge, trained shell,
base-orchestrator. Trained agents compose `agents/TRAINED_SHELL.md` + shared doctrine FIRST, then the
DB-configured teacher style + pgvector chunks (unchanged) — order asserted by test. *Exit:* every
orchestrator's prompt is file-sourced; teacher-specific content still comes only from the DB.

**P3 — Content generators.** Exam-prep practice, syllabus grounding, draw (4 prompts), task tools,
battle sources, curriculum/past-questions/instructor helpers → `practice/*.md`. *Exit:* the
"generated exam-style practice, never a historical past paper" rule lives in exactly one file and every
generator loads it (today it is restated per call site).

**P4 — Autonomy + peer consult + classifiers.** THE LOOP's planner
(`policies/AUTONOMY_RULES.md` — the no-autonomous-action boundaries), peer consult, and the
follow-up/intent modules (first VERIFY which are LLM-driven; rule-based ones are documented in the
manifest as `none` and skipped — no cosmetic migration).

**P5 — Teaching sessions + teacher task loop.** Phase engine + `tasks/lib/context.js` doctrine →
`teaching/PHASES.md`.

**P6 — School AI + evals.** School-scoped sets (deliberately separate from learner doctrine; the
contract test asserts school sets never include learner-teaching files and vice versa). Eval harness
mirrors its target surface's set so evals measure the real prompt.

**P7 — Python agent + cleanup.** A ~60-line loader in `akoro-python-agent` reads the same
`akoro-agent/` files (plain `pathlib`, no new deps); reasoning/loop modules swap their literals for set
loads. Both runtimes now share ONE philosophy. Then: delete the study-prep shim and every legacy literal;
the single-source rule test goes repo-wide; `MEMORY.md` curation documented in AGENT.md.

---

## 5. Decision register

| # | Decision | Rationale |
|---|---|---|
| D1 | Byte-identical migration gates; wording changes only later | Doctrine moves with ZERO behaviour change; improvements are reviewable diffs in files |
| D2 | Tool descriptions/schemas stay in code | They are API surface versioned with handlers; moving them to files invites schema/doc drift |
| D3 | Trained-teacher config stays DB-side | It is per-teacher content, not platform doctrine; the layer wraps it, never replaces it |
| D4 | No dual paths, no per-surface runtime flags | Dual paths drift; the golden tests are the safety |
| D5 | Shared doctrine, per-operation sets — no per-feature forks | S3's core pitch: evolve philosophy without rewriting loops; 41 surfaces must not become 41 dialects |
| D6 | Required files fail the boot; optional files fail soft | A missing doctrine file must never silently change agent behaviour |
| D7 | Budgets: 8 KB/file, 24 KB/set, repo-wide | S3's explicit trap — giant prompts cost money and degrade reasoning |
| D8 | `context_version` hash logged at boot + available per surface | Doctrine changes become observable (drift audit) |
| D9 | School sets are walled off from learner doctrine | Different audience, different safety surface; no leakage either way |
| D10 | Python agent reads the same files | One philosophy across runtimes; no Node/Python prompt dialects |
| D11 | Rule-based "prompt-ish" modules are verified, not cosmetically migrated | Migration has a cost; only LLM call sites get sets |
| D12 | Context layer itself has no kill switch | It is infrastructure like `lib/aiModel.js`; a flag would imply a second prompt path exists |

---

## 6. Contract tests (repo convention, per phase)

- `agentContext.manifest.contract.test.mjs` — every set resolves; required files present; budgets hold;
  no state in files (extends the existing `contextLayer.contract.test.mjs`); school/learner wall (D9);
  hash stability (`context_version` changes only when file content changes).
- `agentContext.golden.chat.test.mjs` (P1) — the assembled `systemContent` of the real `/agent` route is
  byte-identical to the captured golden, pre- and post-migration.
- `agentContext.golden.personas.test.mjs` (P2) — same for each orchestrator; trained order
  (doctrine → DB style) asserted.
- `agentContext.golden.generators.test.mjs` (P3) — same for each generator's prompt; the
  never-a-past-paper rule asserted to come from the file.
- `agentContext.singleSource.contract.test.mjs` — no prompt literals left in migrated files; grows each
  phase; repo-wide at P7.
- `agentContext.boot.contract.test.mjs` — boot smoke fails when a required file is missing/over budget.
- Python (P7): `akoro-python-agent/tests/test_context_files.py` — loader resolves the same manifest sets;
  content hashes match the Node-side manifest.

## 7. Acceptance tests (end of plan)

1. `grep -r "You are" akoro-api/modules akoro-python-agent/src` returns only tool-description strings and
   file-loading code — no prompt literals.
2. Editing `akoro-agent/learning/LEARNING.md` changes study-prep planning, chat tutoring, persona
   teaching and the python agent's teaching reasoning — one file, one philosophy — with no code deploys.
3. Deleting a required file fails boot smoke before any learner request can be served with changed
   behaviour.
4. Every assembled set stays ≤ 24 KB with the real workspace on disk.
5. Trained-teacher sessions still speak with the teacher's DB-configured style, wrapped in platform
   doctrine (before/after transcripts compared).
6. The 41 inventoried call sites each appear in the manifest as a set (or documented `none`), and each
   migrated one has a green golden test.
7. School AI surfaces cannot load learner-teaching doctrine files, and vice versa.

## 8. Still open

- **Set granularity for the task tools** — one `practice_generation` set vs per-tool sets; decide after
  P3 golden captures (start coarse, split only if a set exceeds budget).
- **`context_version` propagation depth** — boot log only vs per-turn/per-event recording everywhere;
  start with boot log + `study_prep_events` (already versioned), extend only where drift is observable.
- **Workspace authoring workflow** — who may edit doctrine files and what review they need (a CODEOWNERS
  entry + the D1 snapshot discipline is the minimum).
- **Translation** — doctrine files are English (statuses/guarantees stay English); whether personas ever
  need translated doctrine is a product call, not assumed.
- **MEMORY.md curation cadence** — it accretes agent wisdom; needs an owner and a pruning rule.
