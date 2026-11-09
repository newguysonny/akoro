# Akoro Creator Agent — Custom Learning Sessions

**What this covers:** the *Creator Agent* — the natural-language layer that lets a learner describe how they want to learn and have Akoro compose, save, and run a reusable learning session from that description. This is the "Learning Session Creator" that turns Akoro from a platform with predefined AI learning features into a learner-configurable learning environment.

**Inspiration:** DeepSeek Harness *Creator Mode* (idea → tool) and `dsh-superagent-prototype` (autonomous coding agent). We adapt the *idea* — "you describe it, the agent builds it" — but **not** the mechanism of generating arbitrary executable code. See §6 for the design decision.

**Reads alongside:** [[akoro-protege-agent-adaptive-learning]], [[akoro-agent-upgrade-plan]], [[akoro-research-plan-act-pattern]], [[Cognitive-Engine-and-soul]].

---

## 1. Positioning

> *"Describe how you want to learn. Akoro builds your learning experience."*

Today Akoro has **one** prescribed learning experience: *learning by teaching* — the learner teaches a Student AI Agent (Nexus), NaNa Esumai coaches teaching quality, and Sargeant gates progression between subtopics.

The Creator Agent adds a second axis: the learner can now **construct their own methodology** by combining reusable learning components into a custom workflow, in natural language:

> *"Create a session where I teach the agent Physics. After every concept, quiz me on five JAMB past questions on that concept. I must score 80% before the next concept unlocks."*

The result is a saved, reusable session — not a one-off conversation — that appears in the learner's session manager alongside the default *Learning by Teaching*.

## 2. The three levels of agent intelligence

This feature sits at **Level 2**. The three levels, which share one harness but may use different models/specialists:

| Level | Name | Responsibility |
|---|---|---|
| 1 | **Agent Operator** | Uses existing tools, memory, APIs, and workflows to do a task. |
| 2 | **Agent Creator** | Creates new tools, plugins, interfaces, and workflows. |
| 3 | **Agent Orchestrator** | Coordinates multiple agents/creators/tools toward larger objectives. |

The Creator Agent is Level 2. It does **not** replace the existing learning engine (Level 1 operators: NaNa Esumai, Nexus, Sargeant); it *configures* them into new combinations.

## 3. What already exists in the backend

The hard parts are already built. The Creator Agent is a configurable shell around them.

| Existing capability | Where | Role in this feature |
|---|---|---|
| Learning-by-teaching phase engine | `agents/student/orchestrator.js` (`STUDENT_PHASES`, fixed 4 phases) | The execution engine that will consume blueprints |
| Live session + assessment gate | `modules/adaptive-learning/websocket.js`, Sargeant | The `quiz_gate` component — already implemented, currently hardcoded |
| Session configure / list / history | `modules/adaptive-learning/teachingSession.js` | Blueprint persistence + resume endpoints reuse |
| Verified past-questions bank | `modules/past-questions/routes.js` (`search_past_questions`, `/practice` verified-only, `verified` flag) | The `past_questions` assessment source — JAMB/WAEC/NECO already queryable |
| School-reviewed subtopic ladders | `lesson_ladders` table (`provenance`, review flow) | Precedent for a *configured, not hardcoded* workflow |
| Per-subtopic knowledge state | `knowledge_confidence`, `decayEngine.js`, Concept Tracker ([[akoro-protege-agent-adaptive-learning]]) | Adaptive scheduling, spaced review, and "what did I miss" feedback |
| Session + concept tracking | `adaptive_sessions`, `concept_state` | Persist progress independently of the chat transcript |

## 4. The gap

The **sequence** of phases is hardcoded in `STUDENT_PHASES` (`orchestrator.js:28`). There is no learner-level configuration, no natural-language → blueprint pipeline, and no persistence of a *chosen methodology*. Closing that gap is the entire scope of the Creator Agent.

## 5. Core concept: a composable learning system

Rather than teaching the model to invent every learning operation, we give it a **library of reusable components** and let it *combine* them.

> Learning by Teaching + Active Recall + JAMB Quiz Gate + Spaced Repetition = a brand-new learning experience, even though none of the underlying components is new.

## 6. Design decision: configuration-based, not code-generation

This is the most important architectural choice, and it is a deliberate divergence from DeepSeek Creator Mode.

- **Approach A (chosen): configuration-based.** The Creator Agent emits a validated JSON **blueprint** over a fixed **component registry**. The existing learning engine executes it.
- **Approach B (rejected for now): code-generating.** The agent writes React components / plugin code, sandboxed and loaded at runtime.

**Why A, not B:**

1. **The learning runtime already exists.** The phase engine, assessment gate, past-questions bank, and knowledge state are live. The gap is *configuration*, not *missing capability*.
2. **Safety.** Generated executable code must never receive Supabase credentials, unrestricted network access, or the learner's auth tokens. On a platform whose userbase includes minors, arbitrary code execution is an unacceptable default.
3. **Assessment integrity.** Gates must be enforced by backend logic, not by whatever the generated code happens to do.
4. **Maintainability.** Configurations are reviewable, versionable, and shareable; generated UIs are not.

**When to revisit B:** only if a learner needs an interface that *no registered component can render*. Even then, the recommended middle path is a **hybrid** — JSON defines the workflow; a *small, vetted* set of renderers handles the UI. Full arbitrary code-gen is a separate, later, higher-risk project.

## 7. The Learning Component Registry

The canonical list of components the Creator Agent may reference. Every blueprint stage must resolve to one of these (or a composition of them). Each maps to an existing capability.

| Component | Function | Backs onto |
|---|---|---|
| `teach_agent` | Learner explains concepts to the AI protégé | Nexus + NaNa Esumai guide |
| `guided_learning` | AI teaches the learner | tutor-agent (Amara's agent) |
| `active_recall` | Learner reconstructs knowledge from memory | LLM judge vs. source material |
| `quiz_gate` | Requires passing assessment before progression | Sargeant gate |
| `past_questions` | Retrieves exam questions by topic/exam | `search_past_questions` / `/practice` |
| `flashcards` | Question-answer cards | generated from syllabus/subtopics |
| `spaced_review` | Schedules future revisions | `decayEngine.js` + scheduler |
| `feynman` | Explain simply; expose gaps | guide + follow-up questioning |
| `timed_practice` | Simulated exam conditions | past-questions + timer |
| `interleave` | Mixes topics/question types | question selection over `knowledge_confidence` |
| `concept_map` | Builds knowledge relationships | knowledge graph / Concept Tracker |
| `reflection` | Learner reflects on understanding | summary + self-assessment |
| `break_timer` | Focus/rest intervals (Pomodoro) | client timer + attention engine |

**Rule:** the Creator Agent composes from this registry. It may *parameterize* a component (question count, passing score, interval days, exam body) but may not invent a new operation.

## 8. Session Blueprint Schema

The single artifact the Creator Agent produces. Stored in a new `session_blueprints` table; executed by the (refactored) phase engine.

```json
{
  "name": "JAMB Physics Mastery",
  "subject": "physics",
  "method": "learning_by_teaching",
  "components": ["teach_agent", "quiz_gate", "past_questions"],
  "workflow": [
    { "stage": "concept_introduction", "action": "introduce_concept" },
    { "stage": "teach_agent",          "action": "learner_explains_concept" },
    { "stage": "understanding_check",  "action": "agent_evaluates_explanation" },
    {
      "stage": "past_questions",
      "action": "generate_related_questions",
      "question_source": "jamb_verified_bank",
      "question_count": 5
    },
    { "stage": "assessment", "action": "evaluate_answers", "passing_score": 80 },
    { "stage": "progression", "action": "unlock_next_concept", "condition": "assessment_passed" }
  ],
  "failure_policy": { "action": "reteach_and_retry" },
  "version": 1,
  "status": "draft"
}
```

### Schema field reference

| Field | Type | Notes |
|---|---|---|
| `name` | string | Human-editable; shown in the session manager |
| `subject` | string | Normalized to `SUBJECTS` mapping already used in `teachingSession.js` |
| `method` | enum | One of `learning_by_teaching`, `active_recall`, `feynman`, `spaced_repetition`, `interleaved`, `custom` |
| `components` | string[] | Must be a subset of the registry (§7) |
| `workflow` | array | Ordered stages; each `action` must be a registered operation |
| `failure_policy` | object | `reteach_and_retry` \| `proceed_with_warning` \| `end_session` |
| `version` | int | Incremented on every edit; enables rollback |
| `status` | enum | `draft` \| `active` \| `paused` \| `archived` |

## 9. The Creator Agent pipeline

Five primary stages, plus a fallback branch (Stage 6), mirroring Creator Mode but bounded by the registry:

```
LEARNER PROMPT
     │
     ▼
[1] INTERPRET ── identify method, subject, components, gate conditions
     │
     ▼
[2] COMPOSE ── assemble the workflow from the registry; parameterize
     │
     ├── expressible ──────────────▶ [3] VALIDATE ──▶ [4] PREVIEW ──▶ [5] SAVE
     │
     └── not expressible ──────────▶ [6] REQUEST ── structured feature request → triage queue
```

### Stage 1 — Interpret

The Creator Agent extracts a parameter table from the prompt. Example prompt → interpretation:

> *"Create a session where I teach the agent Physics. After every concept, quiz me on five JAMB past questions. I must score 80% before the next concept unlocks."*

| Parameter | Interpretation |
|---|---|
| Learning method | Learning by teaching |
| Subject | Physics |
| Interaction | Student teaches AI |
| Assessment | JAMB past questions |
| Frequency | After every concept |
| Question source | JAMB verified bank |
| Question count | 5 |
| Passing score | 80% |
| Progression | Locked until passed |
| Failure | Review and retry |

**Defaults are surfaced, never silently imposed.** The passing score (80%) and count (5) appear in the preview; the learner confirms or edits.

### Stage 2 — Compose

Maps the parameter table to a `workflow` array over the registry. This is a deterministic composition step, not free-form generation.

**If the request cannot be expressed with the registry, do not approximate it.** Route to Stage 6 (component request loop) instead of silently substituting a closest-fit workflow.

### Stage 3 — Validate

Hard checks, enforced server-side:
- Every `workflow[].action` is in the registry.
- Every `quiz_gate` / `past_questions` stage specifies a verified source.
- `passing_score` is in `[0, 100]`; `question_count` within platform limits.
- The blueprint is scoped to one learner (no shared mutable state across accounts).

### Stage 4 — Preview

Rendered as numbered steps for confirmation:

```
JAMB Physics Mastery
Your learning process:
1. Learn a concept.
2. Teach your AI protégé.
3. Receive feedback.
4. Answer five related JAMB questions.
5. Score at least 80%.
6. Unlock the next concept.
```

### Stage 5 — Save

Persist `session_blueprints` row → create `adaptive_sessions` row → register in the session manager. The learner lands in the preview-confirmed session.

### Stage 6 (fallback) — Component request loop

When composition fails — the learner wants something no registered component covers — the Creator Agent must say so explicitly rather than silently approximating. This is the bridge between learner creativity and the deliberate build process:

```
LEARNER PROMPT  (no component covers it)
        │
        ▼
CREATOR AGENT  →  "I can't express this with the current components"
        │
        ▼
[REQUEST]  POST /api/adaptive/components/request
        │        { prompt, intent, closest_components, missing_capability }
        ▼
TRIAGE QUEUE  →  engineering reviews, prioritizes
        │
        ▼
BUILD  →  TEST  →  REVIEW  →  REGISTER  →  available to all learners
```

**Who builds new components:** the **Akoro engineering team** — never the learner, and never generated at runtime. A new component is designed, coded, tested, reviewed, and registered exactly once; from then on every learner's Creator Agent can compose it.

- **Learner** → *requests* (expresses the idea, can't and shouldn't author code).
- **School admin** → configures *within* the platform (`lesson_ladders`, approvals); does not author components.
- **Engineering** → builds the component once, deliberately.

The request row records: the learner's prompt, the parsed intent, the closest components the registry offered, and the specific missing capability. This is what the team actually needs to build the right thing, in the learner's own words.

## 10. Integration with the existing engines

```
AKORO LEARNER
      │
      ▼
LEARNING SESSION UI
      │
  +---+---+
  |       |
  v       v
EXISTING   CREATE SESSION
SESSIONS      │
  |           ▼
  |      CREATOR AGENT  ──>  BLUEPRINT (validated)
  |           │
  +-----+-----+
        │
        ▼
LEARNING SESSION ENGINE   (refactored to consume blueprints)
        │
  +-----+-----+-----------+
  |           |           |
  v           v           v
LEARNING   ASSESSMENT   SCHEDULING
ENGINE     ENGINE       ENGINE
  |           |           |
  +-----+-----+-----------+
        │
        ▼
LEARNER PROGRESS ──> KNOWLEDGE MEMORY
```

**Key separation of concerns:**

| System | Purpose |
|---|---|
| **Learning Engine** | Executes the educational methodology |
| **Creator Engine** | Designs and generates learning experiences |
| **Assessment Engine** | Evaluates the learner, enforces gates server-side |
| **Scheduling Engine** | Decides *when* to revisit material |
| **Memory Engine** | Tracks what the learner knows (Concept Tracker) |

## 11. Refactoring the phase engine to consume blueprints

The one non-additive change. Today `STUDENT_PHASES` is a fixed 4-entry map and the guide advances by emitting `nextPhase`. The refactor:

1. Replace the fixed `STUDENT_PHASES` lookup with a blueprint-driven stage list.
2. `nextPhase` becomes `next_stage_index`; the orchestrator advances by the blueprint's `workflow` order and `progression.condition`.
3. The default blueprint reproduces today's 4 phases exactly, so existing sessions are unchanged (backward compatible).
4. `quiz_gate` stages are enforced by Sargeant server-side — the guide's prompt never decides pass/fail.

**Invariant:** the guide (NaNa Esumai) still *coaches*; it just no longer *owns* the workflow order.

## 12. Worked examples

### A. Learning by Teaching + JAMB Quiz Gate

Prompt → blueprint in §9. Maps to `teach_agent` + `quiz_gate` + `past_questions(source: jamb_verified_bank)`. The gate already exists as Sargeant; this makes it configurable.

### B. Active Recall

> *"Study a topic, then close the book and recall everything I learned without looking. The agent should evaluate what I remember and identify what I missed."*

```
1. Study   → read/watch the material
2. Recall  → hide the material
3. Reconstruct → explain/write everything remembered
4. Evaluate → AI compares against source material
5. Identify gaps → list missing concepts/misconceptions
6. Reinforce → review weak areas, repeat recall
```

**Critical:** evaluation compares against the *actual source material*, not "does this sound convincing."

### C. Spaced Repetition

> *"Learn Biology with spaced repetition — test me tomorrow, then after three days, one week, one month."*

The Creator Agent emits a `spaced_review` schedule (`1d, 3d, 7d, 30d`) driven by the **scheduling engine**, not the LLM. Struggled concepts get earlier reviews; remembered concepts get longer intervals. Reuses `decayEngine.js`.

### D. Feynman Technique

`feynman` component: select concept → study → explain in simple language → agent flags complicated explanations → follow-up questions → identify gaps → simplify → re-evaluate → advance.

### E. Interleaving

`interleave` component: question sequence alternates topics (`Algebra → Geometry → Statistics → Algebra …`), selected by difficulty from `knowledge_confidence`.

### F. Combined (the "go beyond" case)

> *"Teach my agent Physics. After each topic, close the book and recall it. Then JAMB questions. Below 80%, the agent re-teaches it. Schedule revision tomorrow and in three days."*

Composes: `teach_agent` + `active_recall` + `quiz_gate` + `past_questions` + `guided_learning` (reteach branch) + `spaced_review`. Six components, none new — a personalized methodology that the platform never had to prescribe.

## 13. Iterative session creation

Like Creator Mode's plugin editing, sessions are modified conversationally, not rebuilt:

> Learner: *"Create a session for Biology using active recall."*
> Akoro: *Active Recall workspace created — study material, recall canvas, AI evaluation.*
> Learner: *"Add flashcards after every topic."*
> Akoro: *Flashcards added.*
> Learner: *"Also quiz me on past questions before moving on."*
> Akoro: *Assessment gates added.*

Each edit increments `version`. For changes to an **active** session, preserve progress and ask whether the change applies immediately or from the next concept.

## 14. Session manager UI

Each session is independently manageable in the sidebar:

```
MY LEARNING SESSIONS
📚 Learning by Teaching   (default)
🎯 JAMB Physics Mastery   (in progress)
🧠 Active Recall          (scheduled)
🔬 Feynman Learning       (in progress)
🔀 Mathematics Interleave (paused)
➕ Create Learning Session
```

Session detail shows: instructions, selected method, current topic/concept, learning stages, assessment requirements, progress, history, and upcoming reviews (where applicable). Actions: edit, duplicate, pause, archive, delete.

## 15. Safeguards (non-negotiable)

1. **Verified questions only.** The Creator Agent may not invent JAMB questions and label them authentic. `past_questions` stages must source from the `verified` bank; AI-generated practice is labeled as such.
2. **Server-side gates.** Assessment pass/fail is decided by backend logic (Sargeant), never by the guide's instructions.
3. **Persisted progress.** Progress and results live in `adaptive_sessions` / `knowledge_confidence`, independent of the chat transcript.
4. **Registry validation.** Every blueprint is validated against the registry before save (reject, don't silently coerce).
5. **Editing preserves history.** Modifying an active session must not destroy prior progress.
6. **Enumeration-safe + rate-limited.** The creator endpoint follows the same `strictLimit` posture as other auth/LLM endpoints (see [[ENGINEERING_GUARANTEES]]).
7. **No arbitrary code execution.** The Creator Agent emits blueprints, not executable code (see §6).

## 16. Build order

| Phase | Deliverable | Notes |
|---|---|---|
| 1 | Component registry + blueprint schema | `session_blueprints` table; `component` registry module; validation |
| 2 | Creator Agent endpoint | `POST /api/adaptive/sessions/blueprint` — NL → validated blueprint; preview response; Stage 6 fallback → `POST /api/adaptive/components/request` |
| 3 | Phase-engine consumes blueprints | Refactor `orchestrator.js`; default blueprint = today's 4 phases (backward compatible) |
| 4 | Session manager + sidebar integration | CRUD, duplicate/pause/archive; preview UI |
| 5 | Adaptive scheduling | Spaced review + performance-based interval adjustment; interleaving |
| 6 | (Later) hybrid renderers | New UI renderers only if a component's UI is genuinely missing — not arbitrary code-gen |

**Phase 1–2 are the foundation.** The registry and blueprint schema determine how flexible the entire Creator Engine can become, so they are worth getting right before anything else.

## 17. Validation test suite

Acceptance scenarios to build before marking complete:

| # | Scenario | Assertions |
|---|---|---|
| 1 | Prompt → blueprint | "teach agent + 5 JAMB questions, 80% gate" produces the §9 blueprint |
| 2 | Preview & edit | 80% default surfaced; learner can change to 70% before save |
| 3 | Gate enforced server-side | 3/5 correct → blocked; guide prompt cannot override |
| 4 | Verified source only | `past_questions` stage returns only `verified` rows |
| 5 | Active Recall gap detection | Recall vs. source identifies a known omitted concept |
| 6 | Spaced schedule | Struggled concept gets earlier review; remembered gets longer interval |
| 7 | Iterative edit | "add flashcards" bumps `version` and preserves prior progress |
| 8 | Backward compat | A pre-refactor session still runs its 4 phases identically |
| 9 | Unsupported request | A prompt no component covers returns an explicit "unsupported" response + a triage request row, not a coerced blueprint |

## 18. Open design decisions

- **Model routing.** Creator Agent interpretation (Stage 1) is a strong-LLM task; validation (Stage 3) is deterministic. Optionally a smaller/specialized model runs the operator layer while a stronger coding/planning model does composition — consistent with the Level 1/2/3 split.
- **Sharing.** Should blueprints be shareable across learners (like a marketplace)? Deferred; scoped to one learner first.
- **Disclosure framing.** The Creator Agent is explicit ("I built you this session") — no concealment, consistent with the Guardian Angel note in [[akoro-protege-agent-adaptive-learning]].
- **Default-preservation.** Whether editing a *running* session forks it (new version) or mutates in place — needs a product call, not a silent default.
