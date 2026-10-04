AKORO ADAPTIVE LEARNING & AGENT WORKFLOW

END-TO-END MASTER IMPLEMENTATION PLAN

Document purpose: Implementation specification for the Akoro engineering agent.

Primary goal: Refactor and extend Akoro into a production-ready, durable, multi-workflow adaptive learning system in which Study Prep, Teaching, and Decay Review are first-class workflows with their own states, operations, controllers, and agent loops, while sharing common infrastructure for context, tools, permissions, evidence, mastery, and adaptive strategy selection.

---

1. IMPLEMENTATION OBJECTIVE

Build the following architecture:

                              AKORO
                                │
                         WORKFLOW ENGINE
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
             ▼                  ▼                  ▼
       STUDY PREP          TEACHING          DECAY REVIEW
        WORKFLOW            WORKFLOW            WORKFLOW
             │                  │                  │
       states + ops       states + ops       states + ops
       controller         controller         controller
       agent loop         agent loop         agent loop
             │                  │                  │
             └──────────────────┼──────────────────┘
                                ▼
                   ADAPTIVE LEARNING ENGINE
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
             Evidence        Strategy         Mastery
                │               │               │
                └───────────────┼───────────────┘
                                ▼
                       EDUCATION ENGINE
                                │
                                ▼
                         LEARNER MODEL


       All workflow agent loops use:

       Context Manager
             ↓
          LLM
             ↓
          Harness
             ↓
           Tools
             ↓
        Observation
             ↓
       Agent Loop continues

The system must preserve the following architectural guarantees:

1. LLM output is an observation/proposal, not authoritative truth.
2. Database state transitions are deterministic.
3. Sensitive state changes are controlled by the Harness.
4. Scoring remains server-side and authoritative.
5. Answer keys never enter the LLM context unnecessarily.
6. Wallet/coin charging is deterministic and guarded.
7. Learner confirmation is required before Study Prep begins billable learning work.
8. Teaching and Decay can be launched directly from the Dashboard.
9. Study Prep can create a Teaching Workflow when teach-back is required.
10. A Teaching Workflow created by Study Prep is the same Teaching Workflow used by direct Dashboard teaching.
11. Workflows persist independently of the UI that launched them.
12. Leaving the Dashboard or closing a modal does not destroy a workflow.
13. "Continue" means resume an existing workflow; it does not create a new workflow.
14. No hidden chain-of-thought is persisted or exposed.
15. Observable agent activity may be persisted as bounded event metadata.
16. Adaptive strategy selection is constrained by approved/versioned strategies.
17. No autonomous background workflow should start spending coins without learner authorization.
18. The system must remain compatible with the existing Akoro teaching WebSocket while the transport is gradually refactored.

---

2. CORE TERMINOLOGY

Use these terms consistently throughout the codebase.

Workflow

A durable learning experience with:

- identity
- lifecycle
- state machine
- operations
- controller
- agent loop
- context
- events
- persistence
- outcome

Primary workflows:

study_prep
teaching
decay_review

Practice may become a first-class workflow later if standalone Practice develops its own durable lifecycle. For now, Practice should be treated primarily as a learning/assessment capability used by workflows.

---

Workflow Instance

A persisted instance of a workflow.

Example:

workflow_id = SP123
workflow_type = study_prep

or:

workflow_id = TS456
workflow_type = teaching

---

Workflow State

The durable lifecycle state of the workflow.

Example:

study_prep:
planning
awaiting_confirmation
topic_active
replanning
paused
completed
abandoned
cancelled

---

Operation

The current kind of work the workflow/controller is performing.

Examples:

research
inspection
diagnostic
assessment
strategy_selection
intervention
retest

Operations are NOT workflow states.

---

Agent Loop

The adaptive execution loop used by the workflow controller:

Context
→ Reason
→ Propose Action
→ Harness Validation
→ Execute
→ Observe
→ Update State
→ Reason Again

The exact operations available depend on the workflow.

---

Adaptive Learning Engine

Shared domain logic for:

- evidence interpretation
- strategy selection
- mastery/knowledge evaluation
- learning adaptation
- concept evidence
- retention/decay
- strategy history

It does not own workflow lifecycle.

---

Education Engine

Authoritative deterministic education logic:

- question scoring
- pass/fail thresholds
- answer validation
- evidence generation
- mastery updates
- concept state transitions
- assessment rules

The LLM must never replace this layer.

---

3. HIGH-LEVEL WORKFLOW MODEL

3.1 Study Prep

Purpose:

«Prepare a learner for an exam or syllabus scope through adaptive diagnostics, interventions, practice, retesting, and topic progression.»

Entry:

Study Prep UI
→ Create Study Prep Workflow

Can create:

Teaching Workflow

when a teach-back intervention is required.

---

3.2 Teaching

Purpose:

«Allow the learner to teach their AI agent and generate evidence of understanding.»

Teaching has two entry paths:

Direct

Dashboard
→ Teach Agent
→ Start Session
→ Teaching Workflow

Study Prep

Study Prep
→ Diagnostic gap
→ Teach-back required
→ Create Teaching Workflow
→ Dashboard Teaching Session
→ Continue Teaching
→ Complete
→ Return outcome to Study Prep

Both are the same workflow type:

workflow_type = teaching

Only the origin metadata differs.

---

3.3 Decay Review

Purpose:

«Revisit knowledge whose retention has weakened or whose decay alert requires learner attention.»

Entry:

Dashboard
→ Decay Alert
→ Start Decay Session
→ Decay Review Workflow

It is independent of Study Prep.

---

4. GENERIC WORKFLOW ENGINE

Create a shared workflow infrastructure.

Suggested:

modules/workflows/
├── workflow-engine.js
├── workflow-registry.js
├── workflow-store.js
├── workflow-events.js
├── workflow-errors.js
├── workflow-policy.js
└── controllers/

Generic interface:

createWorkflow()
resumeWorkflow()
pauseWorkflow()
completeWorkflow()
abandonWorkflow()
cancelWorkflow()
emitWorkflowOutcome()

The generic engine should NOT contain Study Prep-specific logic.

Instead:

workflowRegistry.register("study_prep", studyPrepController)
workflowRegistry.register("teaching", teachingController)
workflowRegistry.register("decay_review", decayReviewController)

---

5. GENERIC WORKFLOW DATABASE MODEL

Introduce a common workflow identity.

Recommended:

workflow_instances
------------------
id
learner_id
workflow_type
status
entry_mode
parent_workflow_id
parent_topic_id
source_workflow_id
source_reason
policy_version
created_by
created_at
updated_at
completed_at
abandoned_at
cancelled_at
metadata

Important:

"parent_workflow_id" and "source_workflow_id" may refer to another workflow.

For example:

Study Prep SP123
      │
      └── creates
            │
            ▼
       Teaching TS456

Teaching:

parent_workflow_id = SP123
source_workflow_id = SP123
source_reason = teach_back

A direct Dashboard Teaching session:

parent_workflow_id = null
source_workflow_id = null
entry_mode = direct

---

6. WORKFLOW EVENTS

Create durable workflow events.

workflow_events
---------------
id
workflow_id
sequence
event_type
operation
state_before
state_after
actor_type
actor_id
payload
created_at

Use conditional sequence enforcement:

UNIQUE(workflow_id, sequence)

Events should contain bounded observable information.

Do NOT store hidden model reasoning.

Allowed:

strategy_selected
strategy = teach_back
reason_code = prerequisite_gap

Not allowed:

raw_chain_of_thought
private_model_reasoning
hidden scratchpad

---

7. STUDY PREP WORKFLOW

7.1 States

Canonical persisted states:

planning
awaiting_confirmation
topic_active
replanning
paused
completed
abandoned
cancelled

Flow:

planning
    ↓
awaiting_confirmation
    ↓
topic_active
    │
    ├──→ replanning
    │       ↓
    │   topic_active
    │
    ├──→ paused
    │
    └──→ completed

paused
    ↓
topic_active

planning
    ↓
abandoned / cancelled

awaiting_confirmation
    ↓
abandoned / cancelled

---

8. STUDY PREP TOPIC STATE

Each topic has its own state.

Recommended:

queued
active
understood
flagged_gap
capped_out
deferred
awaiting_teaching

At the assessment/run level:

diagnostic_ready
teach_back_required
retest_ready
passed
change_approach
flagged_gap
capped_out

Do not confuse these with the parent workflow state.

---

9. STUDY PREP OPERATIONS

Operations:

planning
inspection
research
diagnostic
assessment
strategy_selection
intervention
teach_back_creation
retest
outcome_evaluation
topic_advance
replanning
session_completion

---

10. STUDY PREP PLAN CREATION

User asks:

«Prepare me for my JSS1 Basic Science exam.»

Agent/harness process:

1. Resolve syllabus.
2. Resolve requested scope.
3. Load learner knowledge.
4. Load learner history/evidence.
5. Resolve prerequisites.
6. Build candidate topic list.
7. Determine ordering.
8. Estimate learning cost.
9. Validate plan.
10. Present plan.
11. Wait for learner confirmation.

Required tools:

syllabus.resolve
learner.get_state
learner.get_history
concept.get_prerequisites
plan.propose
plan.validate

The plan is not billable learning.

No AI learning session should start before confirmation.

---

11. STUDY PREP CONFIRMATION

Persist:

status = awaiting_confirmation

Example:

Topics: 6
Estimated cost: 18 coins
Wallet: 25 coins

Only the learner's explicit confirmation changes:

awaiting_confirmation
→ topic_active

No LLM output can substitute for confirmation.

---

12. STUDY PREP TOPIC LOOP

Inside "topic_active":

prepare topic
    ↓
diagnostic
    ↓
score
    ↓
evaluate evidence
    ↓
┌─────────────────────────────┐
│                             │
PASS                       FAIL/GAP
│                             │
↓                             ↓
passed                    strategy_selection
│                             │
↓                             ↓
next topic              intervention
                              │
                    ┌─────────┴──────────┐
                    │                    │
               teach-back          other strategy
                    │
                    ▼
             Teaching Workflow
                    │
                    ▼
              completed
                    │
                    ▼
                retest
                    │
                    ▼
                  score

---

13. STUDY PREP + TEACHING HANDOFF

When Study Prep determines:

teach_back_required

do NOT teach inside the Study Prep chat.

Instead:

Study Prep Harness
      ↓
createTeachingWorkflow()
      ↓
Teaching Workflow
      ↓
Study Prep topic = awaiting_teaching

Teaching workflow metadata:

{
  "entryMode": "study_prep",
  "sourceWorkflowId": "SP123",
  "sourceTopicId": "TOP789",
  "sourceReason": "teach_back",
  "strategy": "teach_back"
}

The Study Prep workflow remains persisted.

The learner can leave the Study Prep screen.

---

14. TEACHING COMPLETION HANDOFF

Teaching produces a formal outcome:

{
  "workflowId": "TS456",
  "status": "completed",
  "outcome": {
    "objectiveEvidence": [],
    "strategyUsed": "teach_back",
    "recommendedNextAction": "retest"
  },
  "source": {
    "workflowId": "SP123",
    "topicId": "TOP789"
  }
}

Study Prep receives:

TEACHING_COMPLETED

The Study Prep controller validates the event and transitions:

awaiting_teaching
→ retest_ready

Then:

retest_ready
→ retest
→ score
→ passed / change_approach

Do not allow Teaching Workflow to directly mutate arbitrary Study Prep state.

It emits an outcome; Study Prep owns its own state transition.

---

15. TEACHING WORKFLOW

Teaching is a first-class workflow.

It must support:

Dashboard direct teaching

and:

Study Prep-generated teaching

using the same implementation.

---

16. TEACHING WORKFLOW STATES

Persisted states:

created
preparing
active
paused
assessing
completed
abandoned
cancelled

Lifecycle:

created
   ↓
preparing
   ↓
active
   │
   ├── paused
   │     ↓
   │   active
   │
   └── assessing
          ↓
      completed

Alternative terminal outcomes:

abandoned
cancelled

---

17. TEACHING OPERATIONS

prepare
load_context
start_teaching
receive_teaching
inspect_explanation
ask_question
detect_gap
request_clarification
challenge_understanding
record_teaching_evidence
assess
evaluate
complete

The operation changes depending on the current learner interaction.

---

18. DIRECT TEACHING FLOW

Existing UI:

Dashboard
→ Teach Agent
→ Start Session
→ TeachAgentModal

New backend behavior:

TeachAgentModal
      ↓
createTeachingWorkflow()
      ↓
workflow_type = teaching
entry_mode = direct
      ↓
Teaching Controller
      ↓
Agent Loop
      ↓
WebSocket / transport

The WebSocket is transport.

It must not be treated as the workflow itself.

---

19. STUDY PREP TEACHING FLOW

Study Prep
   ↓
diagnostic
   ↓
gap
   ↓
strategy_selection
   ↓
teach_back_required
   ↓
createTeachingWorkflow()
   ↓
Dashboard card appears

Dashboard:

Teaching Session
Water Cycle
Focus: Evaporation vs Transpiration
Created from: Basic Science Study Prep

[Continue Teaching]

When learner selects Continue:

resumeWorkflow({
    workflowType: "teaching",
    workflowId: TS456
})

Do NOT create a new teaching session.

---

20. TEACHING AGENT LOOP

Teaching's loop:

LOAD CONTEXT
      ↓
OBSERVE learner teaching
      ↓
REASON
      ↓
SELECT OPERATION
      ↓
HARNESS VALIDATION
      ↓
ACTION
      ↓
OBSERVE response
      ↓
UPDATE evidence
      ↓
REASON AGAIN

Example:

Learner explanation
      ↓
inspect_explanation
      ↓
concept appears incomplete
      ↓
ask_question
      ↓
learner responds
      ↓
inspect response
      ↓
evidence update
      ↓
continue / assess

The model does not blindly follow:

ask → ask → ask → assess

It adapts according to observed evidence.

---

21. TEACHING CONTEXT

For teaching operations, Context Manager may load:

core/AGENT.md
core/IDENTITY.md

learning/LEARNING.md
learning/TEACHING.md
learning/MASTERY.md

policies/EDUCATION_RULES.md
policies/TOOL_RULES.md

strategies/STRATEGIES.md

Dynamic context:

learner knowledge
concept
prerequisites
previous teaching history
previous misconceptions
current teaching objective
current workflow state
current operation

---

22. TEACHING EVIDENCE

Teaching should produce structured evidence.

Examples:

concept_explained
concept_distinguished
example_generated
misconception_corrected
prerequisite_missing
retrieval_success
retrieval_failure
confidence_signal

The LLM can propose evidence.

The deterministic Education Engine validates/normalizes it.

---

23. TEACHING ASSESSMENT

When appropriate:

active
→ assessing

Assessment may use Practice Engine/question generation.

The answer key remains server-side.

Scoring:

learner answer
→ server-held answer key
→ deterministic score
→ evidence
→ learner model

Then:

assessing
→ completed

or:

assessing
→ active

if more teaching is required.

---

24. DECAY REVIEW WORKFLOW

Decay is a first-class workflow.

Entry:

Decay alert
→ Dashboard
→ Start Decay Session

---

25. DECAY STATES

Persist:

created
preparing
active
paused
assessing
completed
abandoned
cancelled

Do not use:

mode = decay

as the primary architectural representation.

The old WebSocket "mode: "decay"" should eventually become a transport compatibility mechanism only.

---

26. DECAY OPERATIONS

prepare
load_decay_context
inspect_knowledge_state
select_review_target
review
retrieve
revisit
assess
evaluate_retention
record_evidence
complete

---

27. DECAY AGENT LOOP

LOAD DECAY CONTEXT
       ↓
INSPECT KNOWLEDGE STATE
       ↓
SELECT REVIEW TARGET
       ↓
REASON
       ↓
SELECT REVIEW ACTION
       ↓
HARNESS VALIDATION
       ↓
REVIEW / RETRIEVAL / QUESTION
       ↓
OBSERVE RESPONSE
       ↓
EVALUATE RETENTION
       ↓
REASON AGAIN

Possible result:

retained

or:

weakened

If weakened:

review
→ revisit
→ reassess

---

28. DECAY CONTEXT

Context Manager should load:

core/AGENT.md

learning/LEARNING.md
learning/MASTERY.md

reasoning/INSPECTION.md

policies/EDUCATION_RULES.md

strategies/STRATEGIES.md

And:

decay state
last demonstrated evidence
time since evidence
concept state
prior errors
previous review history
current retention estimate

---

29. ADAPTIVE LEARNING ENGINE

Create a shared service:

modules/adaptive-learning/
├── engine.js
├── evidence/
├── strategies/
├── mastery/
├── decay/
└── policies/

Responsibilities:

interpretEvidence()
selectStrategy()
evaluateMastery()
evaluateRetention()
recordEvidence()
getStrategyHistory()

It does NOT own:

workflow lifecycle
workflow UI
workflow state
wallet
WebSocket transport

---

30. APPROVED STRATEGY LIBRARY

Strategies must be curated and versioned.

Initial library:

teach_back
different_analogy
interleave
space_out
escalate_human

The LLM may recommend a strategy.

The strategy engine/harness validates whether it is allowed.

The model must not invent arbitrary strategy IDs.

Example:

{
  "strategy": "different_analogy",
  "version": "1.0"
}

---

31. STRATEGY SELECTION RULE

The system should use:

Evidence
+
Learner history
+
Concept state
+
Previous strategy outcomes
+
Workflow constraints
      ↓
Adaptive Learning Engine
      ↓
Approved strategy

Example:

Repeated confusion:
potential vs kinetic energy

Previous explanation failed.

→ select different_analogy

Do not simply repeat the same intervention indefinitely.

---

32. LEARNER MODEL

Primary concept tracker:

concept_catalog
concept_edges
learner_concept_state
learner_concept_evidence

Feature flag:

AKORO_CONCEPT_TRACKER_ENABLED

When enabled, use concept state as the preferred source.

---

33. LEGACY KNOWLEDGE COMPATIBILITY

Legacy:

edu.knowledge_confidence

uses:

0–100

New concept state:

0–1

If fallback is necessary:

legacy / 100

Never silently mix scales.

---

34. EDUCATION ENGINE

Create/maintain a deterministic Education Engine.

Responsibilities:

scoreAttempt()
evaluateDiagnostic()
evaluateRetest()
determinePass()
determineGap()
updateConceptEvidence()
updateKnowledgeState()
evaluateDecay()

The LLM cannot declare:

student passed

It may recommend an action.

The Education Engine determines whether the learner passed.

---

35. PRACTICE ENGINE

Practice remains a shared capability.

Tools:

practice.generate
practice.submit
practice.score

Past-question policy:

- verified past questions are allowed
- generated questions are allowed
- generated questions must not be represented as official past questions
- answer key stays server-side

Existing verified "/practice" infrastructure should be reused.

---

36. PRACTICE AND WORKFLOW RELATIONSHIP

Study Prep:

Study Prep
→ diagnostic
→ Practice Engine

Teaching:

Teaching
→ assessment
→ Practice Engine

Decay:

Decay Review
→ retrieval/assessment
→ Practice Engine where appropriate

Standalone Practice can remain a separate UI capability.

Only create "practice" as a workflow if the standalone product later requires:

pause
resume
persistent lifecycle
workflow events
workflow-level agent loop

---

37. CONTEXT MANAGER

Use a centralized Context Manager.

Suggested:

modules/agent-context/
├── context-manager.js
├── context-registry.js
├── context-builder.js
├── context-loader.js
├── context-policy.js
└── workspace/

Context selection formula:

WORKFLOW
+
STATE
+
OPERATION
+
CURRENT GOAL
+
CURRENT DATA
+
RELEVANT MEMORY
+
PERMISSIONS
      ↓
CONTEXT MANAGER
      ↓
LLM CONTEXT

---

38. WORKSPACE STRUCTURE

Recommended:

workspace/
├── core/
│   ├── AGENT.md
│   ├── IDENTITY.md
│   └── SOUL.md
│
├── learning/
│   ├── LEARNING.md
│   ├── TEACHING.md
│   ├── ASSESSMENT.md
│   └── MASTERY.md
│
├── reasoning/
│   ├── REASONING.md
│   ├── RESEARCH.md
│   ├── INSPECTION.md
│   └── PLANNING.md
│
├── policies/
│   ├── EDUCATION_RULES.md
│   ├── TOOL_RULES.md
│   └── SAFETY.md
│
├── strategies/
│   └── STRATEGIES.md
│
└── workflows/
    ├── STUDY_PREP.md
    ├── TEACHING.md
    └── DECAY_REVIEW.md

Do not automatically load every file.

---

39. CONTEXT REGISTRY

Example:

const contextRegistry = {
  core: [
    "core/AGENT.md",
    "core/IDENTITY.md"
  ],

  workflow: {
    study_prep: [
      "workflows/STUDY_PREP.md"
    ],

    teaching: [
      "workflows/TEACHING.md"
    ],

    decay_review: [
      "workflows/DECAY_REVIEW.md"
    ]
  },

  state: {
    planning: [
      "reasoning/PLANNING.md",
      "reasoning/INSPECTION.md"
    ],

    active: [
      "learning/LEARNING.md"
    ]
  },

  operation: {
    research: [
      "reasoning/RESEARCH.md",
      "reasoning/INSPECTION.md"
    ],

    planning: [
      "reasoning/PLANNING.md",
      "reasoning/INSPECTION.md"
    ],

    teach: [
      "learning/LEARNING.md",
      "learning/TEACHING.md",
      "learning/MASTERY.md"
    ],

    assess: [
      "learning/ASSESSMENT.md",
      "learning/MASTERY.md"
    ],

    strategy_selection: [
      "learning/LEARNING.md",
      "learning/TEACHING.md",
      "strategies/STRATEGIES.md"
    ]
  }
};

---

40. ADDING NEW MD CONTEXT

A developer should NOT modify the Agent Loop when adding a new context file.

Example:

workspace/reasoning/PRIOR_KNOWLEDGE.md

Register:

operations:
  - planning
  - research
  - strategy_selection

workflow_states:
  - planning
  - active

priority: high

Context Manager discovers/loads it when relevant.

---

41. FRONTMATTER

Allow workspace files to declare relevance:

---
id: prior_knowledge
category: reasoning

operations:
  - planning
  - research
  - strategy_selection

workflow_types:
  - study_prep
  - teaching

workflow_states:
  - planning
  - active

priority: high
---

This allows the workspace to become configurable without hardcoding every file into the agent loop.

---

42. DYNAMIC LEARNER CONTEXT

Learner context should generally come from runtime data, not static Markdown.

Examples:

learner profile
mastery
concept state
previous attempts
teaching history
decay history
confusion notes
recent evidence
session state

Use repositories/tools:

learner.get_state
learner.get_history
concept.get_prerequisites
session.get_state

---

43. HARNESS

The Harness is the security/control boundary.

Suggested:

modules/agent-runtime/
├── agent-loop.js
├── harness.js
├── tool-router.js
├── permission-engine.js
├── action-validator.js
├── budget-manager.js
└── observation-manager.js

Harness responsibilities:

validate workflow state
validate operation
validate tool
validate arguments
validate permissions
validate learner authorization
validate cost
validate concurrency
execute tool
normalize observation
request deterministic state transition

---

44. LLM ACTION CONTRACT

LLM should output structured proposals.

Example:

{
  "operation": "strategy_selection",
  "action": {
    "type": "request_strategy",
    "strategy": "teach_back",
    "reason_code": "diagnostic_below_threshold"
  }
}

The Harness validates this.

The model cannot directly execute:

charge_wallet
set_mastery
set_topic_passed
create_arbitrary_workflow

---

45. TOOL PERMISSIONS

Example:

planning
  allowed:
    syllabus.resolve
    learner.get_state
    learner.get_history
    concept.get_prerequisites
    plan.propose

assessment
  allowed:
    practice.generate
    practice.submit
    practice.score

strategy_selection
  allowed:
    strategy.get
    teaching.create

completion
  allowed:
    workflow.emit_outcome

Sensitive operations remain deterministic services.

---

46. AGENT LOOP RUNTIME

Generic:

async function runAgentLoop(runtime) {

  while (runtime.canContinue()) {

    const context =
      await contextManager.build(runtime.contextRequest());

    const decision =
      await llm.decide(context);

    const action =
      await harness.validate(decision, runtime);

    const observation =
      await harness.execute(action);

    await runtime.controller.observe(observation);

    if (runtime.controller.shouldTransition()) {
      await runtime.controller.transition();
    }
  }
}

Do not make this loop responsible for domain-specific state transitions.

---

47. WORKFLOW CONTROLLERS

Create:

StudyPrepController
TeachingController
DecayReviewController

Each implements:

getState()
getAllowedOperations()
buildContextRequest()
handleDecision()
handleObservation()
validateTransition()
getNextAction()
emitOutcome()

---

48. STUDY PREP CONTROLLER

Responsibilities:

create plan
validate plan
wait for confirmation
start topic
request diagnostic
evaluate result
select intervention
create Teaching Workflow
wait for Teaching outcome
request retest
advance topic
replan when allowed
complete session

---

49. TEACHING CONTROLLER

Responsibilities:

prepare teaching context
load topic/concept
start session
receive learner teaching
inspect explanation
ask targeted question
record evidence
assess understanding
complete session
emit outcome

If originating from Study Prep:

emit outcome → Study Prep

If direct:

emit standalone completion

---

50. DECAY CONTROLLER

Responsibilities:

load decay alert/context
identify decayed knowledge
select review target
retrieve/revisit
assess retention
record evidence
update learner model
complete review

---

51. CROSS-WORKFLOW EVENTS

Standardize events.

Examples:

WORKFLOW_CREATED
WORKFLOW_STARTED
WORKFLOW_PAUSED
WORKFLOW_RESUMED
WORKFLOW_COMPLETED
WORKFLOW_ABANDONED
WORKFLOW_CANCELLED

TEACHING_CREATED
TEACHING_COMPLETED

TEACH_BACK_REQUIRED
TEACHING_OUTCOME_READY

TOPIC_DIAGNOSTIC_COMPLETED
TOPIC_PASSED
TOPIC_GAP_FOUND
TOPIC_RETEST_READY

DECAY_REVIEW_COMPLETED

---

52. CROSS-WORKFLOW RULE

A child workflow cannot arbitrarily mutate its parent.

Correct:

Teaching
→ emits TEACHING_COMPLETED
→ Study Prep receives event
→ Study Prep validates
→ Study Prep changes its own state

Incorrect:

Teaching
→ UPDATE study_prep_topics SET status='retest_ready'

This preserves ownership boundaries.

---

53. WORKFLOW OWNERSHIP

Study Prep owns:
    study prep state
    plan
    topics
    progression

Teaching owns:
    teaching state
    teaching evidence
    teaching session

Decay owns:
    decay review state
    retention review

Education Engine owns:
    scoring
    evidence interpretation
    mastery rules

Adaptive Learning Engine owns:
    adaptive strategy logic

Workflow Engine owns:
    generic workflow lifecycle

---

54. EXISTING AKORO TEACHING SYSTEM MIGRATION

Current code includes:

adaptive-learning/teachingSession.js
adaptive-learning/websocket.js
adaptive-learning/teaching-workflow/
    catalog.js
    runner.js
    tools.js

Do not throw this away.

Refactor it.

Current:

start_adaptive_session
mode:
    fresh
    continuation
    decay

should eventually become:

workflowType:
    teaching
    decay_review

and:

entryMode:
    direct
    study_prep
    decay_alert

"continuation" should no longer be a workflow mode.

It is simply:

resume existing workflow

---

55. WEBSOCKET MIGRATION

The WebSocket should become transport.

Current:

start_adaptive_session
teacher_message
session_ready
session_resumed

Retain temporarily for compatibility.

Internally:

WebSocket event
      ↓
Workflow Service
      ↓
Teaching Controller
      ↓
Agent Loop

Do not let WebSocket handlers contain the complete business logic.

---

56. TEACHING SESSION DATABASE

Existing:

edu.adaptive_sessions

should remain usable during migration.

Add/link:

workflow_id
source_workflow_id
source_topic_id
entry_mode
strategy

Eventually:

teaching_sessions

may become the domain table.

Suggested:

teaching_sessions
-----------------
id
workflow_id
learner_id
topic
subject
entry_mode
source_workflow_id
source_topic_id
strategy
status
current_phase
current_subtopic_index
block_history
teaching_evidence
created_at
updated_at
completed_at

Do not duplicate history unnecessarily during migration.

---

57. STUDY PREP DATABASE

Existing:

study_prep_sessions
study_prep_topics
study_prep_events
adaptive_workflow_runs

Continue using these.

Add:

workflow_id

to establish generic workflow identity.

For topics:

teaching_workflow_id

when awaiting a Study Prep-created teaching session.

---

58. DECAY DATABASE

Create:

decay_review_sessions

Suggested:

decay_review_sessions
---------------------
id
workflow_id
learner_id
subject
topic
concept_id
decay_reason
confidence_before
retention_before
status
strategy_used
evidence
created_at
updated_at
completed_at

---

59. DASHBOARD

Dashboard becomes the workflow continuation surface.

It should show:

Study Prep
Teaching Sessions
Decay Reviews
Practice

Example:

CONTINUE LEARNING

Study Prep
Basic Science Exam
6 topics
[Continue]

Teaching Session
Water Cycle
Focus: Evaporation vs Transpiration
Created from Study Prep
[Continue Teaching]

Decay Review
Photosynthesis
Knowledge weakening
[Review]

---

60. DASHBOARD CONTINUATION RULE

Never infer workflow type purely from old session shape.

Current code does things such as:

if live...
else if decay...
else if hasHistory...

Replace this with explicit workflow metadata.

Frontend should receive:

{
  "workflowId": "TS456",
  "workflowType": "teaching",
  "status": "active",
  "entryMode": "study_prep",
  "sourceWorkflowId": "SP123"
}

Then route deterministically.

---

61. TEACH AGENT MODAL

"TeachAgentModal" should accept:

workflowId

when resuming.

For a new direct session:

create Teaching Workflow
→ receive workflowId
→ open modal

For an existing session:

workflowId
→ resume workflow
→ open modal

The modal is UI/transport.

It does not own teaching state.

---

62. DECAY SESSION MODAL

Same architecture:

Decay Alert
→ create/resume Decay Review Workflow
→ DecaySessionModal

The modal does not own the workflow lifecycle.

---

63. STUDY PREP CHAT

Study Prep Chat remains the conversational interface to the Study Prep Workflow.

It can:

inspect study prep state
explain current plan
show progress
explain next step
request read-only status

It must not bypass workflow rules.

Study Prep chat should NOT perform the actual external Teaching Session.

Instead:

Study Prep agent
→ request create teaching workflow
→ workflow created
→ dashboard becomes continuation point

---

64. STUDY PREP CHAT TOOL ACCESS

Existing:

get_exam_prep_status

Keep read-only.

Potential:

get_study_prep_status
get_current_topic
get_teaching_status

No direct arbitrary database mutation.

---

65. SESSION PERSISTENCE

All workflows must survive:

modal closed
browser refresh
logout/login
navigation
WebSocket disconnect
Dashboard navigation
mobile app backgrounding

State is persisted server-side.

---

66. WEBSOCKET RECONNECT

For Teaching:

disconnect
→ reconnect
→ authenticate
→ resume workflowId
→ restore current workflow state
→ restore bounded conversation/session state

Do not create a new workflow.

---

67. WALLET / COST CONTROL

Study Prep cost estimate:

plan creation
→ estimate cost
→ learner confirms
→ learning starts

Before every billable operation:

check balance
check authorization
check idempotency
charge
execute

Do not rely on UI counters.

---

68. ZERO-BALANCE BEHAVIOR

If a confirmed Study Prep session reaches zero balance:

topic_active
→ paused

UI:

Study paused

You've run out of learning coins.

[Get Coins]
[Exit]

Do not silently continue inference.

---

69. CONCURRENCY

Use conditional DB transitions.

Example:

UPDATE study_prep_sessions
SET status = 'topic_active'
WHERE id = ?
AND status = 'awaiting_confirmation';

Check affected rows.

This prevents two workers/tabs from advancing the same workflow.

---

70. IDEMPOTENCY

Workflow actions must be idempotent.

Example:

create Teaching Workflow

from Study Prep should not create two sessions if the request is retried.

Use:

source_workflow_id
source_topic_id
operation_id

with appropriate uniqueness.

---

71. EXAMPLE END-TO-END STUDY PREP

Learner:

«Prepare me for my Basic Science exam.»

System:

PLANNING

Resolve:

JSS1 Basic Science

Topics:

Water Cycle
Photosynthesis
Matter
Energy
Force & Motion
Human Body

Estimate:

18 coins

Wallet:

25 coins

Transition:

planning
→ awaiting_confirmation

Learner presses:

Start

Then:

awaiting_confirmation
→ topic_active

---

72. WATER CYCLE EXAMPLE

Diagnostic:

3/5 = 60%

Threshold:

70%

Education Engine:

GAP

Adaptive Engine:

previous confusion:
evaporation vs transpiration

Strategy:

teach_back

Study Prep:

awaiting_teaching

Create:

Teaching Workflow TS456

Dashboard:

Continue Teaching

Learner teaches.

Teaching completes:

TEACHING_COMPLETED

Study Prep:

retest_ready

Retest:

5/5 = 100%

Education Engine:

passed

Topic:

understood

Next topic.

---

73. ENERGY EXAMPLE

Diagnostic:

2/5

History:

potential vs kinetic confusion

Previous strategy:

standard explanation

Adaptive Engine:

different_analogy

Fresh practice:

4/5

Pass.

The system records:

previous strategy
new strategy
outcome

This allows future adaptation.

---

74. DECAY EXAMPLE

Knowledge:

Photosynthesis
previous evidence strong
time elapsed
retention estimate weakened

Dashboard:

Decay Review
Photosynthesis
[Review]

Start:

created
→ preparing
→ active

Agent retrieves:

«What is the role of sunlight in photosynthesis?»

Learner answers.

Education Engine evaluates.

If retained:

assessing
→ completed

If weak:

active
→ revisit
→ assess
→ completed

Evidence updates learner model.

---

75. DIRECT TEACHING EXAMPLE

Dashboard:

Teach Agent

Learner selects:

Physics
Motion

Presses:

Start Session

System:

createWorkflow({
  workflowType: "teaching",
  entryMode: "direct"
})

Then:

created
→ preparing
→ active

No Study Prep is involved.

On completion:

Teaching Workflow
→ completed
→ evidence
→ learner model

---

76. AGENT EVENT TRACE

Provide user-visible bounded events such as:

Preparing lesson
Checking previous learning evidence
Reviewing the concept
Identifying a possible gap
Selecting a different explanation
Assessing understanding
Updating learning evidence

Do not display hidden reasoning.

---

77. EVENT TYPES

Recommended:

context_loaded
tool_requested
tool_completed
observation_received
strategy_selected
intervention_started
assessment_started
assessment_completed
evidence_recorded
workflow_transitioned
workflow_created
workflow_completed

Payload should be bounded.

Example:

{
  "strategy": "teach_back",
  "reasonCode": "diagnostic_below_threshold"
}

---

78. SAFETY / AUTHORITY MODEL

Authority hierarchy:

DATABASE / DETERMINISTIC ENGINE
        ↑
      HARNESS
        ↑
       LLM

LLM is not the authority.

The LLM can:

recommend
interpret
select
propose
explain

The deterministic system decides:

score
pass
charge
transition
create authorized workflow
update mastery
complete

---

79. SYLLABUS

Continue using:

edu.syllabus_subjects
edu.syllabus_topics
edu.syllabus_subtopics
edu.syllabus_chunks

Build robust resolver:

syllabus.resolve

Need JSS1 Basic Science ingestion.

Do not hardcode syllabus into prompts.

---

80. CONTENT SEARCH

Approved content search:

content.search

Research should primarily use approved Akoro educational content.

Do not introduce unrestricted web research into learner workflows unless explicitly permitted by policy.

---

81. PREREQUISITES

Use:

concept_edges
concept.get_prerequisites

Planning and intervention should consider prerequisite relationships.

Example:

Water Cycle
→ evaporation
→ condensation
→ precipitation

If a learner repeatedly fails a prerequisite, adaptive strategy should be able to move backward or create an appropriate intervention.

---

82. REPLANNING

Study Prep may replan only under bounded conditions.

Examples:

unexpected prerequisite gap
topic repeatedly failed
scope unavailable
learner abandons topic
cost constraint

Do not allow infinite replanning.

Every replan must:

validate
respect scope
respect cost
respect topic limits
respect learner authorization

---

83. TOPIC LIMITS

Study Prep must retain bounded execution.

Recommended:

maximum topics
maximum attempts
maximum intervention cycles
maximum strategy changes
maximum cost

Use server-side policy.

Never let the LLM choose unlimited retries.

---

84. ATTEMPT SECURITY

Existing "generateAttempt" remains private.

Submit endpoint must enforce status.

For example:

attempt must belong to learner
attempt must belong to workflow
attempt must be active
attempt cannot be submitted twice
answer key stays server-side

Fix current submit race/status issue using conditional update.

---

85. ADAPTIVE WORKFLOW RUNS

Existing:

adaptive_workflow_runs

may remain as execution/run records.

Link them to:

study_prep_session_id
workflow_id
topic_id

Do not use "adaptive_workflow_runs" as the universal workflow identity if a new "workflow_instances" table is introduced.

---

86. CONTEXT CACHING

Stable workspace files can be cached.

Dynamic learner context should be refreshed when needed.

Do not reload every static Markdown file unnecessarily on every operation.

Conceptually:

stable context → cached
dynamic state → refreshed
operation context → rebuilt

---

87. API DESIGN

Create generic workflow APIs where useful:

POST /api/workflows
GET  /api/workflows/:id
POST /api/workflows/:id/resume
POST /api/workflows/:id/pause
POST /api/workflows/:id/complete
POST /api/workflows/:id/cancel

Domain APIs remain available:

/api/study-prep/*
/api/adaptive/teaching/*
/api/adaptive/decay/*

The generic workflow service sits underneath them.

---

88. STUDY PREP API

Maintain:

create plan
confirm session
get session
get topics
submit attempt
get status
resume

Add explicit:

create teaching workflow

through the backend service, not direct client mutation.

---

89. TEACHING API

Maintain:

GET /teaching/sessions
GET /teaching/sessions/:id/history

Add/standardize:

POST /teaching/workflows
GET /teaching/workflows/:id
POST /teaching/workflows/:id/resume

WebSocket handles live interaction.

---

90. DECAY API

Standardize:

GET /decay/alerts
POST /decay/workflows
GET /decay/workflows/:id
POST /decay/workflows/:id/resume

---

91. FRONTEND ROUTING MODEL

Frontend should route based on:

workflowType
workflowId
status

not inferred legacy session properties.

Example:

switch (workflow.workflowType) {
  case "study_prep":
    openStudyPrep(workflow.id);
    break;

  case "teaching":
    openTeaching(workflow.id);
    break;

  case "decay_review":
    openDecayReview(workflow.id);
    break;
}

---

92. WORKFLOW CARDS

Every durable workflow should have:

workflow type
title
subject
topic
status
progress
source
last updated
continue action

Example:

Teaching Session
Water Cycle

Status: Ready to continue
Source: Basic Science Study Prep

[Continue Teaching]

---

93. NOTIFICATION MODEL

Study Prep-generated Teaching:

Teaching Session Created

Decay:

Knowledge needs review

Completed Teaching:

Teaching complete — Study Prep retest is ready

These notifications should reference workflow IDs.

---

94. NO DUPLICATE TEACHING SESSIONS

If a Study Prep topic already has:

teaching_workflow_id

and status:

created
preparing
active
paused

do not create another one.

Resume existing workflow.

---

95. ABANDONMENT

If learner intentionally abandons:

active
→ abandoned

Study Prep parent receives a bounded outcome:

teaching_abandoned

Study Prep may:

pause
defer topic
flag gap

according to policy.

It must not automatically retry forever.

---

96. CANCELLATION

Cancellation is different from abandonment.

Use:

cancelled

for explicit system/user cancellation.

Use:

abandoned

for a workflow that ended without completion.

---

97. RESUME SEMANTICS

Resume means:

load existing workflow
load current state
load current operation
load required context
continue agent loop

Never:

create new workflow

unless the old workflow is terminal.

---

98. VERSIONING

Persist:

policy_version
strategy_version
workflow_version
context_version

This allows reproducibility.

Example:

study_prep_policy = 2
strategy_library = 1
teaching_workflow = 1

---

99. OBSERVABILITY

Log:

workflow_id
workflow_type
learner_id
operation
state
tool
latency
token usage
cost
result
error

Do not log:

passwords
answer keys
sensitive hidden reasoning
unbounded learner data

---

100. ERROR HANDLING

Every workflow must handle:

LLM timeout
LLM malformed output
tool failure
database conflict
WebSocket disconnect
insufficient coins
invalid transition
duplicate request
assessment failure
content unavailable

LLM failure must not corrupt workflow state.

---

101. MALFORMED LLM OUTPUT

If model proposes invalid action:

Harness rejects
→ return structured error
→ agent receives observation
→ agent can propose again

Never execute unvalidated action.

---

102. TOOL TIMEOUT

Tool timeout:

tool_failed

Agent can retry only if policy allows.

Retry count is bounded.

---

103. CONTEXT FAILURE

If Context Manager cannot build required context:

workflow remains unchanged

Do not guess missing learner state.

---

104. EDUCATION DATA INTEGRITY

All evidence updates should be transactional where possible.

For example:

score attempt
+
write evidence
+
update learner concept state
+
update topic outcome

must not leave partial state.

---

105. SINGLE-WRITER PRINCIPLE

For each workflow transition:

one authoritative service

owns the transition.

Example:

StudyPrepController

owns:

study_prep → retest_ready

Teaching Controller does not.

---

106. IMPLEMENTATION PHASE 1 — AUDIT

Before modifying behavior:

1. Map current Study Prep modules.
2. Map current teaching modules.
3. Map current decay modules.
4. Map current "adaptive_sessions".
5. Map current WebSocket events.
6. Map current dashboard session loading.
7. Map current agent-context modules.
8. Map current teaching-workflow catalog/runner/tools.
9. Map current adaptive workflow runs.
10. Map all database references.

Produce a migration matrix:

CURRENT
→ TARGET

Do not delete existing functionality before mapping dependencies.

---

107. PHASE 2 — GENERIC WORKFLOW INFRASTRUCTURE

Implement:

workflow_instances
workflow_events
workflow-engine
workflow-registry
workflow-store
workflow-policy

Register:

study_prep
teaching
decay_review

---

108. PHASE 3 — SHARED AGENT RUNTIME

Implement/standardize:

AgentLoop
Harness
ToolRouter
PermissionEngine
ActionValidator
ObservationManager
ContextManager
ContextRegistry

Ensure all three workflows can use the same runtime.

---

109. PHASE 4 — CONTEXT SYSTEM

Implement:

workspace/
context registry
frontmatter
dynamic learner context
workflow context
operation context

Build context using:

workflow
state
operation
goal
learner
memory
permissions

---

110. PHASE 5 — STUDY PREP MIGRATION

Preserve current functionality.

Add:

workflow_id
StudyPrepController
StudyPrepAgentLoop
explicit state transitions

Fix:

submit status guard
conditional transitions
bounded retries

Implement:

teach-back → Teaching Workflow

---

111. PHASE 6 — TEACHING MIGRATION

Refactor current:

teachingSession.js
websocket.js
teaching-workflow/catalog.js
teaching-workflow/runner.js
teaching-workflow/tools.js

into:

TeachingWorkflow
TeachingController
TeachingAgentLoop
TeachingTools

Keep WebSocket as transport.

Support:

direct
study_prep

entry modes.

---

112. PHASE 7 — DECAY MIGRATION

Convert current decay behavior into:

DecayReviewWorkflow
DecayReviewController
DecayReviewAgentLoop

Existing:

mode = decay

becomes compatibility metadata.

The canonical identity becomes:

workflow_type = decay_review

---

113. PHASE 8 — DASHBOARD

Replace inference-based session routing.

Dashboard consumes explicit:

workflowType
workflowId
status
entryMode
sourceWorkflowId

Implement:

Continue Study Prep
Continue Teaching
Continue Decay Review

---

114. PHASE 9 — STUDY PREP TEACHING HANDOFF

End-to-end test:

Study Prep
→ diagnostic fail
→ teaching workflow created
→ Dashboard card
→ learner leaves
→ learner returns
→ Continue Teaching
→ teaching complete
→ Study Prep retest ready
→ Continue Study Prep
→ retest
→ next topic

This is a critical acceptance test.

---

115. PHASE 10 — DIRECT TEACHING

End-to-end test:

Dashboard
→ Teach Agent
→ Start Session
→ Teaching Workflow created
→ active
→ learner teaches
→ assessment
→ evidence
→ completed

No Study Prep should be created.

---

116. PHASE 11 — DECAY

End-to-end test:

Decay Alert
→ Start
→ Decay Workflow created
→ review
→ assessment
→ evidence
→ completed

---

117. PHASE 12 — FAILURE TESTING

Test:

duplicate create
double confirmation
double submit
double transition
WebSocket disconnect
refresh
logout/login
insufficient coins
LLM malformed action
LLM timeout
tool timeout
database conflict
abandoned teaching
cancelled workflow

---

118. PHASE 13 — DATA MIGRATION

Existing sessions should be mapped.

Example:

existing adaptive_sessions
→ workflow_type = teaching
→ workflow_id generated

Existing decay sessions:

→ workflow_type = decay_review

Existing Study Prep sessions:

→ workflow_type = study_prep

Preserve historical IDs where possible.

---

119. PHASE 14 — FEATURE FLAGS

Use feature flags during migration.

Example:

WORKFLOW_ENGINE_ENABLED
TEACHING_WORKFLOW_V2_ENABLED
DECAY_WORKFLOW_ENABLED
CONTEXT_MANAGER_V2_ENABLED
ADAPTIVE_AGENT_LOOP_ENABLED
CONCEPT_TRACKER_ENABLED

Allow gradual rollout.

---

120. FINAL TARGET DIRECTORY

Suggested backend:

akoro-api/
└── modules/
    ├── workflows/
    │   ├── workflow-engine.js
    │   ├── workflow-registry.js
    │   ├── workflow-store.js
    │   └── workflow-events.js
    │
    ├── agent-runtime/
    │   ├── agent-loop.js
    │   ├── harness.js
    │   ├── tool-router.js
    │   ├── permission-engine.js
    │   └── observation-manager.js
    │
    ├── agent-context/
    │   ├── context-manager.js
    │   ├── context-registry.js
    │   ├── context-builder.js
    │   └── workspace/
    │
    ├── adaptive-learning/
    │   ├── engine.js
    │   ├── evidence/
    │   ├── mastery/
    │   ├── strategies/
    │   └── decay/
    │
    ├── education/
    │   ├── scoring.js
    │   ├── assessment.js
    │   └── evidence.js
    │
    ├── study-prep/
    │   ├── controller.js
    │   ├── agent-loop.js
    │   ├── tools.js
    │   ├── state-machine.js
    │   └── routes.js
    │
    ├── teaching/
    │   ├── controller.js
    │   ├── agent-loop.js
    │   ├── tools.js
    │   ├── state-machine.js
    │   └── routes.js
    │
    └── decay-review/
        ├── controller.js
        ├── agent-loop.js
        ├── tools.js
        ├── state-machine.js
        └── routes.js

Frontend:

akoro-learner/
└── src/
    ├── components/
    │   ├── teaching/
    │   ├── studyPrep/
    │   ├── decay/
    │   └── workflows/
    │
    ├── services/
    │   ├── workflowApi.js
    │   ├── studyPrepApi.js
    │   ├── teachingApi.js
    │   └── decayApi.js
    │
    └── hooks/
        ├── useWorkflow.js
        ├── useStudyPrep.js
        ├── useTeaching.js
        └── useDecayReview.js

---

121. FINAL ARCHITECTURAL CONTRACT

The implementation must preserve this model:

                    WORKFLOW ENGINE
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
     STUDY PREP       TEACHING        DECAY REVIEW
       states           states           states
       operations       operations       operations
       controller       controller       controller
       agent loop       agent loop       agent loop
          │               │                │
          └───────────────┼────────────────┘
                          ▼
               ADAPTIVE LEARNING ENGINE
                          │
                    EDUCATION ENGINE
                          │
                     LEARNER MODEL

Agent execution:

WORKFLOW
   +
STATE
   +
OPERATION
   +
CURRENT DATA
   +
RELEVANT MEMORY
        ↓
CONTEXT MANAGER
        ↓
LLM
        ↓
PROPOSED ACTION
        ↓
HARNESS
        ↓
VALIDATED TOOL/ACTION
        ↓
DETERMINISTIC ENGINE
        ↓
OBSERVATION
        ↓
WORKFLOW CONTROLLER
        ↓
NEXT STATE / OPERATION
        ↓
NEXT AGENT LOOP

---

122. NON-NEGOTIABLE RULES FOR THE IMPLEMENTATION AGENT

1. Do not make the LLM the source of truth.
2. Do not let the LLM directly mutate workflow state.
3. Do not expose hidden chain-of-thought.
4. Do not store hidden reasoning traces.
5. Do not let the client determine authoritative workflow state.
6. Do not let WebSocket transport become business logic.
7. Do not create duplicate workflows on reconnect/retry.
8. Do not treat "continuation" as a workflow type.
9. Do not create a separate teaching implementation for Study Prep.
10. Study Prep-generated teaching must use the same Teaching Workflow as direct Dashboard teaching.
11. Do not execute Study Prep teach-back inside Study Prep Chat.
12. Teaching completion must emit an outcome back to Study Prep.
13. Study Prep owns its own response to that outcome.
14. Decay Review must be a durable workflow, not merely "mode: decay".
15. Practice remains a shared capability unless/until standalone Practice needs its own durable workflow.
16. All billable Study Prep work requires prior learner confirmation.
17. Wallet charging must be server-side and idempotent.
18. Scoring must be deterministic/server-side.
19. Answer keys remain server-side.
20. All state transitions must be conditional/concurrency-safe.
21. All workflows must survive UI navigation and WebSocket disconnects.
22. All workflows must have bounded retries/autonomy.
23. Workspace Markdown is context, not executable authority.
24. Context Manager decides which workspace files are relevant.
25. Learner state and memory should come from runtime data, not be duplicated into Markdown.
26. Adaptive strategies must come from a versioned approved strategy library.
27. The Adaptive Learning Engine is shared infrastructure, not a workflow.
28. The Agent Loop is shared runtime infrastructure with workflow-specific controllers and policies.
29. Workflow states answer "where are we?"
30. Operations answer "what are we doing now?"
31. Agent Loop answers "what should happen next?"
32. Harness answers "is that action allowed?"
33. Education Engine answers "what actually happened?"
34. Adaptive Learning Engine answers "how should we adapt?"

---

123. DEFINITION OF DONE

The implementation is complete when all of the following are true:

Study Prep

[✓] Plan
[✓] Validate
[✓] Confirm
[✓] Start
[✓] Diagnostic
[✓] Adaptive intervention
[✓] Teaching handoff
[✓] Teaching completion
[✓] Retest
[✓] Topic progression
[✓] Replanning
[✓] Pause/resume
[✓] Completion

Teaching

[✓] Direct Dashboard start
[✓] Study Prep-created teaching
[✓] Persistent workflow
[✓] Pause/resume
[✓] Agent loop
[✓] Context Manager
[✓] Teaching operations
[✓] Evidence
[✓] Assessment
[✓] Completion
[✓] Outcome emission

Decay Review

[✓] Dashboard alert
[✓] Start review
[✓] Persistent workflow
[✓] Agent loop
[✓] Decay context
[✓] Retrieval/review
[✓] Assessment
[✓] Evidence
[✓] Learner model update
[✓] Completion

Shared Infrastructure

[✓] Workflow Engine
[✓] Workflow Registry
[✓] Workflow Events
[✓] Agent Loop Runtime
[✓] Harness
[✓] Tool Router
[✓] Permission Engine
[✓] Context Manager
[✓] Workspace Registry
[✓] Adaptive Learning Engine
[✓] Education Engine
[✓] Learner Model
[✓] Strategy Library
[✓] Cost Controls
[✓] Concurrency Controls
[✓] Idempotency
[✓] Observability

Critical end-to-end test

The following scenario must work without losing state:

Learner starts Study Prep
        ↓
Diagnostic finds gap
        ↓
Study Prep creates Teaching Workflow
        ↓
Learner leaves Study Prep
        ↓
Learner opens Dashboard
        ↓
Learner continues Teaching
        ↓
Learner closes app
        ↓
Learner returns later
        ↓
Teaching resumes
        ↓
Teaching completes
        ↓
Study Prep receives outcome
        ↓
Study Prep becomes Retest Ready
        ↓
Learner continues Study Prep
        ↓
Retest passes
        ↓
Next topic begins
        ↓
Study Prep eventually completes

This is the core proof that the architecture is correctly implemented.

---

124. FINAL SYSTEM MODEL

The final Akoro learning system should therefore be understood as:

                         AKORO LEARNING SYSTEM
                                  │
                                  ▼
                           WORKFLOW ENGINE
                                  │
        ┌─────────────────────────┼────────────────────────┐
        │                         │                        │
        ▼                         ▼                        ▼
   STUDY PREP                 TEACHING                DECAY REVIEW
   WORKFLOW                   WORKFLOW                 WORKFLOW
        │                         │                        │
        │                         │                        │
        │                         │                        │
        └───────────────┐         │         ┌──────────────┘
                        │         │         │
                        ▼         ▼         ▼
                    ADAPTIVE LEARNING ENGINE
                              │
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
              Evidence     Strategy     Mastery
                              │
                              ▼
                       EDUCATION ENGINE
                              │
                              ▼
                         LEARNER MODEL


Every workflow has:

    State Machine
         +
    Operations
         +
    Workflow Controller
         +
    Workflow-specific Agent Loop

Every Agent Loop uses:

    Context Manager
         +
    LLM
         +
    Harness
         +
    Tools
         +
    Observation

Every learning outcome goes through:

    Deterministic Education Engine
         +
    Adaptive Learning Engine
         +
    Learner Model

And workflows communicate through:

    Explicit Workflow Outcomes / Events

NOT direct cross-workflow database mutation.

This is the target architecture. Do not implement the three workflows as three unrelated systems. Build one shared workflow/agent runtime and three domain-specific workflow controllers on top of it.
