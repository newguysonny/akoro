# Adaptive-learning architecture audit — 2026-09-07

## Scope and verdict

This audit reviewed every document in this directory and compared its proposals
with the current `akoro-api/modules/adaptive-learning` implementation and the
additive `akoro-python-agent` service.

**Verdict: the folder contains a strong product and systems direction, but it
is an aspirational, overlapping architecture set—not an implementation-ready
spec.** The right overhaul is to adopt its core discipline:

> **Curriculum-grounded, concept-level state is the learner/protégé brain;
> language models render and assess bounded evidence, rather than becoming the
> source of truth for knowledge or durable state.**

Do **not** copy the sketches directly. They contain mutually incompatible data
models, duplicate responsibilities, local-file persistence examples, and some
behaviour that conflicts with Akoro's established safety and autonomy rules.
The project should first collapse them into one versioned, testable contract.

## Documents reviewed

| Document | Main contribution | Audit finding |
|---|---|---|
| `Cognitive-Engine-and-soul.md` | Cognitive-state-first protégé; concept mastery, decay, profiles, soul layers | Valuable product thesis, but it repeats/extends itself several times and mixes vision with unvalidated pseudo-code. |
| `REFINED ARCHITECTURE - COMPARISON WITH TEXT TO SPEECH.md` | Bounded `ProtegeCond`, encoder/render seam, validated judge output, eval harness | The strongest technical design in the folder. Its bounded typed interface should become the basis of the implementation. |
| `akoro-protege-agent-adaptive-learning(cognitive,complete-soul-stack, tracking).md` | Consolidated inventory, Concept Tracker, Guardian Angel, staged build order | Good decomposition, but calls a 26-component design "complete" before data contracts, evidence policy, and calibration are specified. |
| `Updated tracking dimensions.md` | Attention, reasoning-quality, and fatigue proposals | Worth adding later, only after a reliable concept-state baseline and calibrated signals exist. |
| `Soul-Stack-Validation-Suite.md` | Seven lifecycle/product scenarios and regression ideas | Excellent acceptance-test source; current HTML-style examples must be converted to deterministic fixtures plus model evaluations. |
| `Akoro-Exam-Prep-Confidence-Loop.md` | First useful vertical workflow: diagnostic → teach-back → retest | Correct first end-user workflow once concept-state and assessment records are real. |
| `akoro-agent-upgrade-plan(tools,skills,workflow).md` | Research/Plan/Act, workflow runs, skills, prompt assembly | Correctly identifies stateful workflows and real progress events as missing. |
| `akoro-autonomous-agent-architecture(research,plan,act pattern).md` | Right-sized read-only research, explicit plan/act gate | Good execution pattern. It must use status visibility, not a hidden reasoning trace. |
| `akoro-autonomous-agent-architecture(automations,heartbeat,lanes).md` | Deterministic automations, lanes, notification suppression, authority boundaries | Strong operating model, but its broad autonomous actions exceed Akoro's current learner-autonomy contract. |

## What exists today

### Useful foundation already in Akoro API

- **Curriculum and ladders:** provenance-aware lesson ladders use a school
  scheme of work first, then syllabus grounding, then AI fallback. They are
  cached and can be teacher-reviewed.
- **Learning/knowledge stores:** `edu.student_knowledge`,
  `edu.agent_knowledge`, `edu.knowledge_confidence`, session deltas, adaptive
  sessions, and decay events exist. The knowledge retrieval functions already
  use hybrid lexical/vector retrieval for personal knowledge stores.
- **Adaptive experience:** Student Agent, NaNa guide, phase/subtopic
  progression, session reference handling, streaming callbacks, trained
  teacher orchestration, and assessment/proctoring modules already exist.
- **Decay foundation:** `decayEngine.js` implements current confidence decay,
  due-review selection, reinforcement, notifications, and review payloads.
- **Durable Python conversation context:** Akoro owns exact conversation
  history, compact summaries, learner-clearable memory, scratchpad state, and
  semantic retrieval of compact relevant memory. This is additive and should
  remain separate from cognitive mastery state.

### Important current limitations

- `student_states.state` is a broad JSON document with global cognitive values
  and topic-keyed aggregates, not a canonical per-concept state model.
- `knowledge_confidence` is per learner/topic/subtopic and is a useful starting
  point, but it does not implement objective-level status, resume points,
  evidence records, prerequisite gating, or a calibrated tracing algorithm.
- There are already **two intentional confidence scales**: retrieval-note
  confidence in `student_knowledge` is a fraction (`0..1`), whereas
  assessment-derived `knowledge_confidence` is a percentage (`0..100`). The
  new architecture must never silently merge them.
- `knowledge_confidence.student_id` is currently text while most user identity
  keys are UUIDs. A new canonical state contract must either safely migrate the
  column or contain this boundary behind a typed API adapter.
- The Python service's teaching profile, cognitive state, and extracted
  learning knowledge still use `InMemoryLearningRepository`; only its
  conversation/memory attachment is durable in Akoro. The Python service is
  therefore not yet the owner of production adaptive intelligence.
- Current state writes are best-effort and some flows write state twice per
  turn. That is acceptable for the existing experience, but insufficient for
  auditable concept-state transitions and retries.

## Reconciled architecture: one source of truth per concern

The following target keeps the best portions of the documents without creating
a second learning platform.

```text
Approved curriculum / teacher material / learner action
                         │
              Research (owned, read-only data)
                         │
  typed judge observation ──► schema + evidence validation
                         │                 │
                         │                 ▼
                 deterministic state policy / idempotent commit
                         │
                bounded ProtegeCondition encoder
                         │
  role-correct recent transcript + clearable compact memory + condition
                         │
                 student/protégé response generation
```

### Data ownership and persistence

Use PostgreSQL in Akoro as the system of record. Do not introduce Neo4j,
Memgraph, or local JSON files for the first version; current hierarchy,
provenance, and `pgvector` capabilities are sufficient and a second database
would multiply permission, recovery, and consistency concerns.

A future additive schema should separate:

1. **`concept_catalog` and `concept_edges`** — approved curriculum concepts,
   stable IDs, subject/class/board scope, prerequisite/related edges, source
   provenance and version. Curriculum facts are not learner-owned memories.
2. **`learner_concept_state`** — one row per learner/protégé and concept:
   mastery, retention, status, current confusion labels, last demonstrated
   evidence, last review, and a version for optimistic concurrency. Store all
   normalized scores as fractions (`0..1`) in this new contract.
3. **`learner_concept_events` / `assessment_attempts`** — immutable,
   idempotent evidence that supports a transition. A model judgment must not
   overwrite state with an untraceable number.
4. **`learner_teaching_profile`** — slow-moving, consented, bounded inferred
   preferences such as preferred explanation format, pace band, and scaffolding
   band. It needs confidence/provenance and decay, not a permanent claim from
   one conversation.
5. **Optional `learner_learning_episodes`** — short, learner-clearable,
   factual milestones such as a resolved misconception or useful analogy. This
   is not a raw dialogue diary and must never contain secrets, raw tool output,
   or hidden reasoning. Embed only this compact content if semantic retrieval is
   later useful.
6. **`adaptive_workflow_runs` / `workflow_steps`** — durable Research/Plan/Act
   state for exam preparation and other multi-turn workflows. This is separate
   from the agent's private scratchpad.

Existing raw chat history remains the conversation record. Existing structured
scratchpads remain compact operational state. Neither is a replacement for
concept evidence, and neither should be vectorized.

### Bounded conditioning contract

Adopt the `ProtegeCond` *principle*, with a production TypeScript/Python schema
and one encoder. It should contain the active concept, at most three relevant
supporting concepts, capped confusion signals, retention/mastery, a bounded
teaching-profile view, and optional one compact episode.

There is one necessary correction to the refined document: it says no response
stage may see raw history. Akoro deliberately needs role-correct recent chat
messages to maintain a real conversation, and the user selected durable Akoro
history. The safe split is:

- the **state encoder** never receives or emits an unbounded transcript;
- the **conversation channel** supplies only the existing bounded,
  role-labelled recent transcript; and
- the generator receives both channels with memory/condition clearly marked as
  untrusted reference data.

This preserves conversational coherence without allowing raw history to leak
into the state model or become an accidental source of instructions.

## Required design decisions before implementation

### 1. Treat LLM output as observation, never ground truth

The proposed LLM judge can classify an observed protégé response, but cannot by
itself establish that a human's teaching is factually correct. A production
judge result needs:

- a closed set of known concept IDs supplied by the active curriculum slice;
- strict JSON-schema validation, enum/range caps, and retry/no-op behaviour;
- cited/approved source context for factual validation, with `uncertain` when
  evidence is absent or conflicts;
- separate fields for **response demonstration**, **claim validity**, and
  **model confidence**; and
- deterministic policy code that converts valid evidence into bounded state
  changes.

The Guardian Angel should initially prevent a false claim from becoming durable
knowledge and ask a natural clarification question. It must not claim certainty
or silently perform deceptive correction. Multi-source checking should be
limited to approved curriculum/school material—never autonomous open-web
self-teaching.

### 2. Do not manufacture mistakes, emotion, or consciousness

The documents propose noise, relapse, inside jokes, and emotional language to
make the protégé feel alive. These should not cause the system to knowingly
state false academic content, pretend it has human feelings, or manipulate a
learner (especially a minor).

Use actual uncertainty, retention, misconception evidence, and optionally a
transparent fictional protégé persona. Any variability must be bounded,
seedable/testable, and incapable of overriding content safety. "Stubborn
misconception" should mean a known misconception receives extra retrieval and
assessment, not that the model fabricates a false answer for effect.

### 3. Separate two profiles that the documents conflate

The person teaching the protégé may be the learner, but these are distinct data
uses:

- **Teaching-partner interaction preferences:** how somebody explains to their
  protégé in this experience.
- **Learner study preferences/progress:** how the account learns and what it
  needs for tutoring/exam prep.

They need distinct names, scope, consent/deletion controls, and uncertainty.
Do not infer sensitive traits, diagnoses, age, personality, or emotional state
from short messages. Prefer user-editable low-risk preferences to hidden,
permanent profiling.

### 4. Preserve current autonomy boundaries

The autonomous-worker document proposes broad proactive work, self-practice,
battles, and task creation. That conflicts with the selected Akoro rule:
learner autonomy is opt-in while Online, disabled Offline, due-time-only, and
may send one proactive chat without modifying/completing tasks or doing other
actions.

For this overhaul, automated state updates may compute *eligible review
signals*, but product-facing proactive action must remain within the current
policy. Per-agent lanes, idempotency, quiet hours, and notification suppression
are good future infrastructure; they do not authorize broader autonomy.

### 5. Do not expose chain of thought as workflow progress

The Research/Plan/Act documents correctly want a real status trace. Akoro's
implementation must expose only observable workflow state—e.g. `researching`,
`awaiting_confirmation`, `quiz_ready`, `assessment_recorded`—not hidden model
reasoning, raw tool results, or an unbounded scratchpad dump. The current
structured scratchpad already follows this rule and is not the public
`todowrite`/workflow-run model proposed for task workflows.

## Prioritized delivery plan

### Phase 0 — contract and measurement (required first)

1. Publish a short canonical state/schema contract: identities, stable concept
   IDs, score units, statuses, transition ownership, deletion/retention, and
   idempotency keys.
2. Define the authoritative source order: school scheme of work → approved
   syllabus/curriculum → reviewed content → clearly-labelled AI fallback.
3. Select measurable success criteria: assessment calibration, concept-state
   transition accuracy, safe no-op rate, retention/retest outcomes, and learner
   completion—not "human-like" language alone.
4. Convert the seven Soul Stack scenarios to fixtures. Assertions must inspect
   structured state and policy decisions; model wording is evaluated separately
   with rubrics, not brittle substring checks.

### Phase 1 — one cognitive vertical slice

Build one subject/topic flow with a limited approved concept graph:

1. Add versioned concept catalogue/edge/state/event tables and a migration plan
   from current `knowledge_confidence` without changing its meaning in place.
2. Implement a strict, bounded turn-observation schema and a deterministic
   transition policy. Start with conservative simple tracing; do not introduce
   BKT/DKT until baseline data proves the added complexity is worthwhile.
3. Build a single condition encoder and inject it into the existing Student
   Agent prompt.
4. Add replayable unit tests for retries, invalid judge output, unknown concept
   IDs, no-evidence/no-op, incorrect teaching, prerequisite gaps, and a
   five-day decay review.
5. Expose learner-readable progress as concept status/evidence summaries, not
   hidden scores or simulated emotions.

### Phase 2 — grounding and Guardian Angel

1. Add approved-source claim checks for the narrow vertical slice.
2. Record `verified`, `contradicted`, or `uncertain` separately from the
   protégé's apparent answer.
3. Add a safe clarification/review path and human/instructor escalation for
   unresolved material.
4. Evaluate false-positive/false-negative rates before broadening subjects.

### Phase 3 — bounded personalisation and episode retrieval

Add only features demonstrated to improve learning outcomes: explanation-style
preference, pace/session-length signals, concise resolved-misconception or
analogy episodes, and retention-aware response phrasing. Each feature needs a
clearable record, provenance, bounds, and regression test.

### Phase 4 — first workflow, not all workflows

Implement the Exam-Prep Confidence Loop as the proof:

`Research → plan → diagnostic → teach-back branch → new-question retest →
recorded result / capped handoff`.

It needs a maximum attempt count, alternative-explanation handoff, real
workflow state/events, and no misleading claim that generated questions are
historical exam questions until a licensed, tagged past-paper corpus exists.

## Audit conclusion

The architecture is worth using, especially its separation of curriculum
knowledge, concept-state policy, bounded conditioning, and response rendering.
The immediate next milestone should **not** be a wholesale Soul Stack or a
Python database port. It should be the Phase 0/Phase 1 concept-state vertical
slice, designed as an Akoro-owned, capability-served source of truth. Once that
is measured and safe, Python can consume the same contract through an API-backed
`LearningRepository`, while the JavaScript production path can migrate
incrementally instead of being replaced.
