Absolutely. The latest architecture can support this UI very well. In fact, I would make the streaming activity system a first-class part of the master plan, rather than something added later.

The key is that the UI is not inventing the activity. The workflow + agent loop + context manager + harness emit structured events, and the UI renders those events into the collapsible interface you showed.

Below is the updated master implementation plan.

Akoro Agent & Learning Workflow

Master End-to-End Implementation Plan — v3

Purpose

This document defines the production architecture and implementation plan for Akoro's learning-agent system.

The system consists of:

1. Study Prep Workflow
2. Teaching Workflow
3. Decay Review Workflow
4. Practice Workflow
5. Shared Adaptive Learning Engine
6. Shared Agent Loop
7. Context Manager
8. Workflow Engine
9. Harness / Policy Engine
10. Education Engine
11. Tool System
12. Persistent Learner Model
13. Unified Activity/Event Stream
14. Learner Dashboard / Chat UI

The goal is to allow these workflows to operate independently while sharing the same underlying agent infrastructure.

---

1. Core Architectural Principle

Akoro must distinguish between:

Workflow

A durable learner experience.

Examples:

Study Prep
Teaching
Decay Review
Practice

Workflow State

Where that workflow currently is.

Example:

planning
awaiting_confirmation
topic_active
paused
completed

Operation

What the agent is currently doing inside that workflow.

Example:

research
inspection
planning
assessment
strategy_selection
teaching
reflection
synthesis

Agent Loop

How the agent decides what to do next:

OBSERVE
   ↓
INTERPRET
   ↓
DECIDE
   ↓
ACT
   ↓
OBSERVE
   ↓
...

This is adaptive and does not follow a fixed cognitive sequence.

Context Manager

Determines what information/instructions the agent should receive for the current decision.

workflow state
+
operation
+
goal
+
current data
+
learner context
+
relevant workspace files
↓
Context Manager
↓
LLM context

Harness

Controls what the agent is allowed to do.

LLM proposes action
        ↓
Harness validates
        ↓
Policy check
        ↓
Tool execution
        ↓
Observation

Education Engine

Determines authoritative educational outcomes.

The LLM does not decide whether the learner passed.

For example:

5/5
↓
Education Engine
↓
passed
↓
topic understood

---

2. Critical Safety/Observability Rule

The UI may display:

- what the agent is checking
- what context set was loaded
- what decision it is making
- why an action was selected
- what tool was executed
- what the tool returned
- what workflow state changed
- what the learner needs to do next

The UI must NOT expose private model chain-of-thought.

Therefore the system should use:

Observable Decision Narration

rather than raw hidden reasoning.

For example, this is acceptable:

«"Ada scored below the pass mark and has repeatedly confused evaporation with transpiration. A teach-back intervention is appropriate."»

This is not a raw internal reasoning trace.

The event should contain a concise, safe rationale generated specifically for presentation.

---

3. Overall Architecture

                         AKORO
                           │
                           ▼
                    WORKFLOW ENGINE
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
   STUDY PREP          TEACHING          DECAY REVIEW
   WORKFLOW            WORKFLOW           WORKFLOW
        │                  │                  │
        └──────────────┬───┴──────────────────┘
                       │
                       ▼
                PRACTICE WORKFLOW
                       │
                       ▼
             ADAPTIVE LEARNING ENGINE
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       Evidence     Strategy      Mastery
          │            │            │
          └────────────┼────────────┘
                       ▼
                  AGENT LOOP
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
      CONTEXT MANAGER         HARNESS
             │                   │
             ▼                   ▼
       Selected Context        Tools
             │                   │
             └─────────┬─────────┘
                       ▼
                    LLM
                       │
                       ▼
                Structured Events
                       │
                       ▼
                 EVENT STREAM
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
          Chat UI             Dashboard

---

4. Workflow Inventory

Akoro should have four first-class workflows.

4.1 Study Prep Workflow

Purpose:

Prepare a learner for an examination across one or more syllabus topics.

Triggered by:

- Study Prep chat
- Study Prep dashboard
- learner selecting exam preparation

Example:

Prepare me for my JSS1 Basic Science exam.

---

4.2 Teaching Workflow

Purpose:

A dedicated session where the learner teaches their AI agent.

It can be created from multiple places.

Entry point A — Dashboard

Learner presses:

Teach Agent
→ Start Session
→ Teaching Modal

This creates a new Teaching Workflow.

Entry point B — Study Prep

Study Prep detects:

teach_back_required

It creates a Teaching Workflow.

The learner can leave Study Prep, go to the dashboard, and continue the Teaching Workflow.

Entry point C — Continue Existing Teaching Session

The learner selects an existing teaching session.

That is not a new workflow.

It is:

resumeWorkflow(teachingWorkflowId)

---

5. Decay Review Workflow

Purpose:

Review knowledge that has decayed over time.

Triggered by:

- dashboard decay alert
- Decay Session button
- learner selecting a decay notification

The workflow owns its own state and agent loop.

It should no longer be treated conceptually as merely:

mode: "decay"

Instead:

Decay Review Workflow

---

6. Practice Workflow

Purpose:

Perform standalone practice.

Examples:

Practice
Past questions
Generated questions
Topic practice
Exam simulation

Practice can use the Adaptive Learning Engine but does not become Study Prep.

---

7. Workflow Relationships

The important relationship is:

                    STUDY PREP
                        │
                        │ detects gap
                        ▼
                  TEACHING WORKFLOW
                        │
                        │ completed
                        ▼
                    STUDY PREP
                        │
                        ▼
                      RETEST

Separately:

DECAY ALERT
    ↓
DECAY REVIEW WORKFLOW
    ↓
evidence
    ↓
learner model updated

And:

PRACTICE
    ↓
evidence
    ↓
learner model

All of them feed the shared Adaptive Learning Engine.

---

8. Generic Workflow Engine

Create a generic workflow infrastructure.

Recommended interface:

createWorkflow()
getWorkflow()
resumeWorkflow()
pauseWorkflow()
completeWorkflow()
cancelWorkflow()
abandonWorkflow()
emitWorkflowOutcome()

Workflow instance:

workflow_instances
------------------
id
learner_id
workflow_type
status
parent_workflow_id
created_by
entry_point
created_at
updated_at
completed_at

Possible types:

study_prep
teaching
decay_review
practice

---

9. Workflow State Machine

Study Prep

PLANNING
    ↓
AWAITING_CONFIRMATION
    ↓
TOPIC_ACTIVE
    │
    ├── DIAGNOSTIC
    ├── INTERVENTION
    ├── RETEST
    └── OUTCOME
    │
    ├───────────────┐
    ▼               ▼
NEXT TOPIC       REPLANNING
    │               │
    └───────┬───────┘
            ▼
         COMPLETED

Exceptional states:

PAUSED
ABANDONED
CANCELLED

Persisted session states:

planning
awaiting_confirmation
topic_active
replanning
paused
completed
abandoned
cancelled

---

10. Study Prep Topic State Machine

queued
  ↓
active
  ↓
diagnostic_ready
  ↓
diagnostic
  │
  ├── passed ─────────────→ understood
  │
  └── failed
          ↓
   teach_back_required
          ↓
   awaiting_teaching
          ↓
   teaching_completed
          ↓
      retest_ready
          ↓
        retest
       /     \
   passed    failed
     ↓          ↓
understood   strategy change
                ↓
          another bounded attempt
                │
                ├── passed → understood
                └── cap → flagged_gap/capped_out

Possible topic states:

queued
active
diagnostic_ready
teach_back_required
awaiting_teaching
retest_ready
passed
flagged_gap
capped_out
deferred

---

11. Teaching Workflow State Machine

Teaching must have its own state machine.

CREATED
   ↓
PREPARING
   ↓
READY
   ↓
TEACHING_ACTIVE
   ↓
EVIDENCE_CAPTURE
   ↓
ASSESSING
   │
   ├── objective met
   │       ↓
   │    COMPLETED
   │
   └── objective not met
           ↓
      ADAPT_STRATEGY
           ↓
      TEACHING_ACTIVE

Exceptional:

PAUSED
ABANDONED
CANCELLED

Persisted states:

created
preparing
ready
teaching_active
evidence_capture
assessing
adapt_strategy
paused
completed
abandoned
cancelled

---

12. Teaching Workflow Operations

Teaching operations include:

initialize
inspect_learner_state
inspect_topic
load_learning_context
select_teaching_strategy
start_teaching
receive_learner_explanation
ask_followup
evaluate_explanation
identify_gap
adapt_strategy
request_clarification
record_evidence
complete

Example:

TEACHING_ACTIVE

operation:
receive_learner_explanation

The agent loop can then decide:

observe learner explanation
↓
evaluate evidence
↓
ask follow-up

or:

observe explanation
↓
gap detected
↓
select strategy
↓
continue teaching

---

13. Dashboard Teaching Session

The dashboard's existing:

Teach Agent
→ Start Session

must now create a real Teaching Workflow.

The modal should not create an anonymous WebSocket session outside the workflow system.

Instead:

Dashboard
   ↓
createTeachingWorkflow()
   ↓
workflow_id
   ↓
Teaching Modal
   ↓
resumeWorkflow(workflow_id)

The WebSocket becomes a transport mechanism.

It is NOT the workflow itself.

---

14. Teaching Workflow Source Relationships

A teaching session can originate from:

dashboard
study_prep
decay_review
manual

Teaching record:

teaching_sessions

id
workflow_id
learner_id
topic_id
subject
source_workflow_id
source_workflow_type
source_topic_id
source_reason
strategy
status
current_phase
block_history
teaching_evidence
created_at
updated_at
completed_at

For Study Prep:

source_workflow_type = study_prep
source_reason = teach_back
source_topic_id = ...

For dashboard:

source_workflow_type = dashboard
source_reason = learner_started

---

15. Teaching Completion Contract

When teaching completes:

{
  "workflowId": "TS456",
  "status": "completed",
  "outcome": {
    "objectiveEvidence": [],
    "strategyUsed": "teach_back",
    "conceptEvidence": [],
    "recommendedNextAction": "retest"
  },
  "source": {
    "workflowId": "SP123",
    "topicId": "TOP789"
  }
}

Study Prep consumes:

TEACHING_COMPLETED

and transitions:

awaiting_teaching
      ↓
retest_ready

---

16. Decay Review Workflow State Machine

CREATED
   ↓
INSPECTING
   ↓
DIAGNOSTIC
   ↓
EVALUATING
   │
   ├── retained
   │      ↓
   │   COMPLETED
   │
   └── decayed
          ↓
      INTERVENTION
          ↓
       RETEST
          │
          ├── passed → COMPLETED
          │
          └── failed
                 ↓
            ADAPT_STRATEGY
                 ↓
             INTERVENTION

Exceptional:

PAUSED
ABANDONED
CANCELLED

Persisted states:

created
inspecting
diagnostic
evaluating
intervention
retest
adapt_strategy
paused
completed
abandoned
cancelled

---

17. Decay Review Operations

inspect_decay
inspect_history
inspect_concept
generate_diagnostic
evaluate_retention
select_strategy
intervene
generate_retest
score_retest
record_evidence
complete

Example:

Decay detected
↓
inspect previous evidence
↓
generate short diagnostic
↓
learner scores poorly
↓
select strategy
↓
intervention
↓
retest
↓
update learner model

---

18. Practice Workflow

Practice can have:

created
preparing
ready
attempt_active
submitted
scoring
evaluated
completed

Operations:

prepare
generate
present
submit
score
evaluate
record_evidence
complete

Practice should remain independently usable.

---

19. Shared Adaptive Learning Engine

The Adaptive Learning Engine is NOT itself a learner workflow.

It provides reusable intelligence and education logic.

Responsibilities:

evidence interpretation
mastery calculation
strategy selection
attempt policy
concept progression
decay interpretation
learning history
strategy effectiveness

It can be called by:

Study Prep
Teaching
Decay Review
Practice

---

20. Adaptive Decision Cycle

The internal adaptive cycle is:

OBSERVE
   ↓
INTERPRET EVIDENCE
   ↓
SELECT STRATEGY
   ↓
ACT
   ↓
OBSERVE
   ↓
EVALUATE
   ↓
ADAPT

This is NOT another workflow.

It operates inside workflows.

---

21. Generic Agent Loop

Every workflow can use the same underlying agent-loop infrastructure.

while workflow requires agent decision:

    observe current state

    determine operation

    build context

    ask LLM for structured decision

    validate proposed action

    execute permitted tool/action

    receive observation

    emit activity events

    update workflow state

    repeat

The loop terminates when:

workflow completed
workflow paused
workflow abandoned
workflow cancelled
learner action required
external workflow required

---

22. Context Manager

Context is selected dynamically.

The Context Manager receives:

{
  workflowType,
  workflowState,
  operation,
  learnerId,
  sessionId,
  topicId,
  goal
}

Example:

contextManager.build({
  workflowType: "study_prep",
  workflowState: "topic_active",
  operation: "strategy_selection",
  learnerId,
  topicId
});

---

23. Workspace Context

Recommended structure:

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
│   ├── RESEARCH.md
│   ├── INSPECTION.md
│   └── PLANNING.md
│
├── workflows/
│   ├── STUDY_PREP.md
│   ├── TEACHING.md
│   ├── DECAY_REVIEW.md
│   └── PRACTICE.md
│
├── policies/
│   ├── EDUCATION_RULES.md
│   ├── TOOL_RULES.md
│   └── SAFETY.md
│
└── strategies/
    └── STRATEGIES.md

---

24. Context Registry

Context relevance should be metadata-driven.

Example:

{
  planning: [
    "reasoning/PLANNING.md",
    "reasoning/INSPECTION.md",
    "policies/EDUCATION_RULES.md"
  ],

  teaching: [
    "learning/LEARNING.md",
    "learning/TEACHING.md",
    "learning/MASTERY.md"
  ],

  assessment: [
    "learning/ASSESSMENT.md",
    "learning/MASTERY.md"
  ],

  strategy_selection: [
    "learning/LEARNING.md",
    "learning/TEACHING.md",
    "strategies/STRATEGIES.md"
  ]
}

---

25. Dynamic Learner Context

Static MD files are not enough.

The Context Manager also retrieves:

current learner mastery
concept state
past attempts
previous misconceptions
recent evidence
prerequisites
session state
workflow state
wallet/cost state where relevant

Therefore:

WORKSPACE FILES
+
DATABASE STATE
+
RETRIEVED MEMORY
+
CURRENT OBSERVATIONS
=
AGENT CONTEXT

---

26. Tool Architecture

Tools are capabilities exposed through the harness.

Examples:

syllabus.resolve
learner.get_state
learner.get_history
concept.get_prerequisites
content.search

practice.generate
practice.submit
practice.score

teaching.create
teaching.resume
teaching.get_state

session.get_state
session.advance
session.replan

topic.complete
topic.defer

Sensitive operations must remain harness-controlled.

The LLM should not directly:

charge wallet
modify mastery
mark topic passed
change workflow state
access answer keys

Instead it requests a high-level action.

---

27. Harness Responsibilities

The harness validates:

Is this action allowed?
Is this operation allowed in this state?
Are arguments valid?
Does learner own the resource?
Is the workflow active?
Is spending permitted?
Are attempt limits respected?
Is the transition legal?

Example:

LLM:
create teaching workflow

Harness:
✓ Study Prep is active
✓ topic requires teach-back
✓ learner has permission
✓ topic exists
✓ teaching workflow allowed

→ create workflow

---

28. Study Prep → Teaching Handoff

When:

diagnostic < threshold

the education engine determines:

teach_back_required

The agent may recommend:

teach_back

The harness then creates:

Teaching Workflow

Study Prep changes:

topic_active
→ awaiting_teaching

The learner sees:

«I created a teaching session for Water Cycle. You can continue it from your dashboard.»

The learner can leave the Study Prep chat.

---

29. Dashboard Continuation

Dashboard displays:

Teaching Session
Water Cycle

Focus:
Evaporation vs Transpiration

Created from:
Basic Science Study Prep

[Continue Teaching]

Clicking it:

resumeWorkflow(teachingWorkflowId)

NOT:

start_adaptive_session(mode="fresh")

---

30. Teaching Completion → Study Prep

Teaching completes.

Teaching emits:

workflow.completed

with:

source_workflow_id
source_topic_id
outcome

Study Prep receives:

TEACHING_COMPLETED

Then:

awaiting_teaching
        ↓
retest_ready

The next Study Prep operation can be:

generate_retest

---

31. Event / Activity Stream

This is a major new part of the architecture.

Every workflow should emit structured events.

The UI should consume these events.

The event stream becomes the bridge between:

Agent
Workflow
Harness
Tools
Learner UI

---

32. Three-Element UI Stream Pattern

The primary conversational stream should follow:

THINKING
   ↓
TOOL GROUP
   ↓
ACTIVITY

Repeated as needed:

Thinking
Tool
Activity

Thinking
Tool
Activity

Thinking
Tool
Activity

This is a presentation pattern.

The backend should emit structured events, not HTML.

---

33. Event Types

Recommended event types:

workflow.started
workflow.state_changed

operation.started
operation.completed

context.loaded

agent.narration

tool.started
tool.completed
tool.failed

decision.proposed
decision.accepted
decision.rejected

learner.action_required
learner.action_received

assessment.started
assessment.completed

strategy.selected

topic.state_changed

workflow.handoff_created
workflow.handoff_completed

workflow.paused
workflow.completed

---

34. Thinking Event

Example:

{
  "type": "agent.narration",
  "category": "thinking",
  "operation": "planning",
  "contextSet": "planning",
  "narration": "I'm checking the topic order against the syllabus and prerequisite relationships.",
  "visibility": "learner"
}

The UI renders:

⚙ Thought for 2 seconds   planning

Expanded:

context: planning

I'm checking the topic order against the syllabus
and prerequisite relationships.

---

35. Context Line

The exact UI requested should be supported.

Collapsed:

⚙ Thought for 2 seconds   planning   ›

Expanded:

context: planning

I'm checking the topic order against the syllabus
and prerequisite relationships.

The context label should be rendered in muted blue.

This tells the learner:

Which context set was active
+
What observable decision narration resulted

---

36. Tool Event

Backend should never expose ugly internal names as the primary learner-facing description.

Instead of:

edu.syllabus.resolve()

show:

Checking the Basic Science syllabus ✓ 142ms

Expanded:

research
Checking the Basic Science syllabus
Scanning all topics covered in JSS1 Basic Science this term

✓ 6 topics found for the term

---

37. Descriptive Tool Row Format

Each tool row:

TYPE

Headline
Description

Result

Actor

Example:

research

Reviewing where Ada stands right now

Looking at mastery levels across all six topics

✓ 3 topics are below the 70% threshold

agent

The learner does not need to see:

learner.get_state

unless developer/debug mode explicitly enables it.

---

38. Actor Labels

Use:

agent
system

Example:

agent
Checking Ada's history

system
Score recorded successfully

Do not use internal service names as the actor.

---

39. Narration Templates

The harness should provide reusable narration templates.

Examples:

Planning

«I'm checking the syllabus, prerequisite order, and your current progress before building the plan.»

Verification

«Checked the plan against the syllabus, prerequisite order and your coin balance — everything lines up.»

Diagnostic

«Starting a short diagnostic to see what you already know before deciding what to teach.»

Scoring

«Scored 3 of 5 (60%). Below the 70% pass mark.»

Teach-back

«Your result shows a gap here, so I'm switching to a teach-back exercise.»

Teaching handoff

«I created a teaching session for Water Cycle. You can continue it from your dashboard.»

Teaching completion

«You confirmed the teach-back for Water Cycle. A fresh retest is unlocked — same standard, new questions.»

Strategy change

«The previous explanation didn't resolve the confusion, so I'm trying a different approach.»

Completion

«All six topics have been worked through. I'm compiling the summary from the recorded results.»

---

40. Narration Generator

Create a dedicated component:

ActivityNarrator

Responsibilities:

convert structured backend events
→ learner-friendly narration

It should support:

narrate(event, context)

Example:

narrate({
  type: "assessment.completed",
  score: 3,
  total: 5,
  threshold: 0.7
});

Returns:

Scored 3 of 5 (60%). Below the 70% pass mark.

Narration should be deterministic where possible.

---

41. Event Schema

Recommended:

{
  "id": "evt_123",
  "workflowId": "SP123",
  "workflowType": "study_prep",
  "sequence": 42,
  "timestamp": "...",
  "type": "agent.narration",
  "category": "thinking",
  "operation": "strategy_selection",
  "workflowState": "topic_active",
  "contextSet": "strategies",
  "actor": "agent",
  "visibility": "learner",
  "payload": {
    "narration": "The previous explanation did not resolve the confusion, so I'm switching approaches."
  }
}

Sequence must be monotonic per workflow.

This allows:

reconnect
resume
replay
audit

---

42. Streaming Transport

The existing WebSocket can remain as the transport.

But the architecture should change from:

WebSocket = session

to:

WebSocket = event transport

Workflow state remains persisted in the database.

Therefore:

workflow
   ↓
agent loop
   ↓
event
   ↓
WebSocket
   ↓
UI

If WebSocket disconnects:

workflow continues/persists according to policy

and the UI can reconnect and request:

events after sequence N

---

43. Event Replay

Every important workflow event should be persisted.

Recommended:

workflow_events

id
workflow_id
sequence
event_type
category
operation
workflow_state
actor
visibility
payload
created_at

The UI can:

GET /workflows/:id/events?after=42

or receive the same stream through WebSocket.

This prevents lost UI activity during reconnects.

---

44. Thinking Block Rendering

Frontend should have a generic component:

<ThinkingBlock />

Input:

{
  contextSet,
  narration,
  duration,
  operation
}

Render:

⚙ Thought for 2 seconds   planning   ›

Expanded:

context: planning

I'm checking the prerequisite order before
finalizing the study plan.

The component should remain reusable across:

Study Prep
Teaching
Decay
Practice

---

45. Tool Group Rendering

Generic component:

<ToolGroup />

Input:

{
  label,
  tools: [...]
}

Example:

>_ Ran commands 4 ✓

Expanded rows:

research   Checking syllabus
            Scanning JSS1 topics
            ✓ 6 topics found

research   Reviewing learner state
            Checking current mastery
            ✓ 3 topics below threshold

research   Reviewing history
            Looking for repeated misconceptions
            ✓ 2 recurring gaps found

---

46. Activity Message

Generic component:

<ActivityMessage />

Used for learner-facing narrative between tool blocks.

Examples:

Water Cycle is your weakest topic, so we'll start there.

or:

Your first result is below the pass mark. I'll use your previous mistakes to choose the next step.

---

47. Stream Controller

Create a frontend stream reducer.

Example:

event
 ↓
streamReducer
 ↓
UI message model

Messages:

{
  type: "thinking",
  ...
}

{
  type: "tool_group",
  ...
}

{
  type: "activity",
  ...
}

The UI should not need to understand backend workflow internals.

---

48. Example Study Prep Stream

Actual runtime:

USER
"I have a test covering the whole term."

Then:

THINKING
context: research

I'm checking the syllabus, your current progress,
previous mistakes, and topic dependencies.

Then:

TOOL GROUP
Ran commands 4 ✓

Then:

ACTIVITY

I found six topics. Water Cycle and Energy need
the most attention based on your recorded results.

Then:

THINKING
context: planning

I'm arranging the topics while respecting their
prerequisite relationships.

Then:

TOOL GROUP
Drafting the study plan ✓
Checking the plan ✓

Then:

ACTIVITY

I've built the plan. It is estimated at 18 coins
and fits your current limit.

Then:

PLAN CARD
[Approve & Start]

---

49. Example Failed Planning Stream

THINKING
context: planning

I'm checking the proposed topic order.

Tool:

verification

Checking the plan is safe to run

Verifying prerequisite order and cost

✕ Energy must come after Matter

Then:

THINKING
context: planning

The dependency check caught an ordering problem.
I'm correcting it before showing you the plan.

Tool:

draft
Fixing the topic ordering

Moving Matter ahead of Energy

✓ Revised plan ready

This demonstrates that the UI reflects the actual harness loop.

---

50. Study Prep Teach-Back Stream

Diagnostic:

Scored 3 of 5 (60%). Below the 70% pass mark.

Then:

THINKING
context: strategies

Your previous attempts show the same evaporation
and transpiration confusion, so a teach-back is
the most appropriate next intervention.

Tool:

action

Creating a teaching session

Opening a dedicated teaching workflow for Water Cycle

✓ Teaching session created

Activity:

I've created a teaching session for Water Cycle.
You can continue it from your dashboard.

Study Prep state:

awaiting_teaching

---

51. Dashboard Teaching Stream

Learner presses:

Teach Agent

Backend:

createTeachingWorkflow()

Events:

workflow.started

operation.started: inspect_topic

context.loaded

agent.narration

operation.started: teaching

activity

The modal displays the same stream system.

Therefore the direct dashboard Teaching Session uses the exact same Teaching Workflow as Study Prep-created teaching.

---

52. Teaching Agent Loop

Example:

OBSERVE
learner has started teaching Water Cycle

↓
operation = inspect_learner_explanation

↓
Context Manager

↓
LLM produces structured action:

ask_followup

↓
Harness validates

↓
Teaching tool executes

↓
Event:
agent.narration

↓
Learner answers

↓
OBSERVE again

It can continue until the teaching objective is satisfied or bounded intervention is required.

---

53. Teaching Evidence

Teaching should record structured evidence.

Examples:

concept demonstrated
concept explained incorrectly
misconception detected
follow-up answered
example generated
confidence demonstrated

Store evidence separately from narration.

The UI narration is not the source of truth.

---

54. Decay UI Stream

Example:

THINKING
context: decay_review

I'm checking how recently this concept was demonstrated
and whether there is evidence that the knowledge has weakened.

Tool:

research

Reviewing recent learning evidence

✓ Knowledge has not been demonstrated recently

Activity:

Let's do a short check before deciding whether you need a review.

Diagnostic:

Scored 2 of 5 (40%). The concept needs a refresh.

Then:

strategy selection
→ intervention
→ retest
→ evidence
→ completion

---

55. Practice UI Stream

Practice can use the same system:

THINKING
context: assessment

I'm selecting questions that test the target concept
without repeating the previous set.

Tool:

Generating a fresh practice set ✓

Activity:

Here are five questions focused on the areas you missed.

After submission:

Scored 4 of 5 (80%). Above the 70% pass mark.

---

56. No Hardcoded Thought Sequence

The implementation must NOT force:

research
→ draft
→ verification
→ action
→ reflection
→ synthesis

as a mandatory cognitive sequence.

Those are observable operation/narration categories.

Actual execution may be:

research
→ planning
→ tool
→ planning
→ verification
→ action

or:

assessment
→ strategy_selection
→ teaching
→ assessment

The workflow state machine determines what is legal.

The agent loop determines what is needed next.

---

57. Thought / Operation Taxonomy

Use controlled categories:

research
inspection
planning
draft
verification
assessment
strategy_selection
teaching
action
reflection
synthesis

These are UI/telemetry categories.

They do not represent hidden cognition.

---

58. Workflow State + Operation

Every agent event should identify both:

workflowState
operation

Example:

{
  "workflowState": "topic_active",
  "operation": "strategy_selection"
}

This makes the stream explainable.

---

59. Context Set

Every thinking event should optionally identify:

contextSet

Example:

context: strategies

This directly supports the UI requested.

---

60. Complete Event Relationship

The runtime becomes:

WORKFLOW STATE
       +
OPERATION
       +
CURRENT DATA
       ↓
CONTEXT MANAGER
       ↓
CONTEXT SET
       ↓
AGENT LOOP
       ↓
LLM DECISION
       ↓
SAFE NARRATION EVENT
       ↓
HARNESS
       ↓
TOOL
       ↓
TOOL RESULT
       ↓
WORKFLOW / EDUCATION ENGINE
       ↓
NEW STATE
       ↓
NEXT LOOP

And simultaneously:

EVENT
 ↓
EVENT STORE
 ↓
WebSocket/SSE
 ↓
Chat/Dashboard UI

---

61. Database Architecture

Recommended eventual structure:

workflow_instances

study_prep_sessions
study_prep_topics

teaching_sessions

decay_review_sessions

practice_sessions

workflow_events

learner_concept_state
learner_concept_evidence

adaptive_workflow_runs

Existing tables should be migrated incrementally rather than rewritten unnecessarily.

---

62. Existing Adaptive Session Migration

The existing:

adaptive_sessions

and:

start_adaptive_session
mode:
fresh
continuation
decay

should be refactored.

The target architecture is:

workflow_instance
        ↓
teaching_session
        ↓
WebSocket transport

rather than:

WebSocket mode
        ↓
implicitly determines workflow

"continuation" becomes:

resume existing workflow

"decay" becomes:

Decay Review Workflow

"fresh" becomes:

create Teaching Workflow

---

63. API Direction

Generic:

POST /api/workflows
GET /api/workflows/:id
POST /api/workflows/:id/resume
POST /api/workflows/:id/pause
POST /api/workflows/:id/cancel
GET /api/workflows/:id/events

Study Prep:

POST /api/study-prep/sessions
POST /api/study-prep/sessions/:id/confirm
GET  /api/study-prep/sessions/:id
POST /api/study-prep/sessions/:id/continue

Teaching:

POST /api/teaching/workflows
GET  /api/teaching/workflows/:id
POST /api/teaching/workflows/:id/resume
GET  /api/teaching/workflows/:id/history

Decay:

POST /api/decay/workflows
GET  /api/decay/workflows/:id
POST /api/decay/workflows/:id/resume

Practice:

POST /api/practice/workflows
POST /api/practice/workflows/:id/submit

Exact routes may adapt to the existing codebase.

---

64. Wallet / Cost Rules

Only the harness can authorize spending.

Study Prep:

estimate
→ learner confirmation
→ lock budget
→ spend

If budget is exhausted:

topic_active
↓
paused

No further paid tool call is allowed.

Resume only after valid budget increase/top-up.

Teaching and Decay can have their own cost policies.

---

65. Concurrency / Single Writer

All state transitions must be deterministic and guarded.

Example:

UPDATE study_prep_topics
SET status = 'retest_ready'
WHERE id = ?
AND status = 'awaiting_teaching'

If zero rows update:

transition rejected

This prevents duplicate transitions caused by:

double clicks
reconnects
duplicate WebSocket messages
parallel agent loops

---

66. Learner Action Gates

Some actions require explicit learner interaction.

Examples:

Approve study plan
Confirm teach-back
Start teaching
Submit answer
Continue after pause
Top up
Resume workflow

The agent cannot silently bypass these.

---

67. Study Prep Chat Persistence

The Study Prep chat is a conversational interface to the Study Prep Workflow.

It is NOT the workflow itself.

Therefore the learner may:

start Study Prep
↓
leave chat
↓
teach from dashboard
↓
return later
↓
Study Prep continues

The workflow state remains persisted.

---

68. Dashboard as Workflow Launcher

Dashboard buttons map to workflows:

Teach Agent
    ↓
Teaching Workflow

Decay Session
    ↓
Decay Review Workflow

Practice
    ↓
Practice Workflow

Study Prep
    ↓
Study Prep Workflow

This gives Akoro a clean mental model.

---

69. Implementation Phases

Phase 1 — Workflow Infrastructure

Build:

workflow_instances
workflow_events
WorkflowEngine
WorkflowStateMachine
WorkflowRepository

Implement:

create
resume
pause
complete
cancel
abandon

---

Phase 2 — Event Streaming Infrastructure

Build:

WorkflowEventBus
ActivityNarrator
EventStore
StreamController

Implement:

workflow events
operation events
thinking/narration events
tool events
activity events

Add WebSocket replay.

---

Phase 3 — Context Manager

Implement:

context registry
context resolver
workspace MD loader
dynamic learner context
operation context
workflow context

Add:

contextSet

to agent events.

---

Phase 4 — Generic Agent Loop

Implement:

observe
→ context
→ decide
→ validate
→ act
→ observe

with:

bounded iterations
timeouts
tool limits
cost limits
state validation

---

70. Phase 5 — Study Prep

Finalize:

Study Prep state machine
Topic state machine
planning
confirmation
diagnostic
strategy selection
teaching handoff
retest
defer
cap
pause
completion

Integrate event stream.

---

71. Phase 6 — Teaching Workflow

Convert existing Teaching implementation into:

Teaching Workflow

Keep existing WebSocket functionality where useful, but place it underneath the workflow.

Implement:

create
prepare
ready
teaching_active
assessment
adapt_strategy
completed

Integrate:

dashboard start
Study Prep handoff
resume
history
event stream

---

72. Phase 7 — Decay Workflow

Convert current decay session logic into:

Decay Review Workflow

Remove conceptual dependence on:

mode: decay

Implement:

create
inspect
diagnostic
evaluate
intervention
retest
complete

---

73. Phase 8 — Practice Workflow

Move standalone practice into the same workflow/event infrastructure.

Keep:

practice generation
submission
scoring
evidence

but expose it through:

Practice Workflow

---

74. Phase 9 — Learner Model

Ensure all workflows write evidence through the same learner model.

Preferred:

learner_concept_state
learner_concept_evidence

Fallback:

edu.knowledge_confidence

with explicit conversion.

Never silently mix:

0–1

and:

0–100

---

75. Phase 10 — UI

Build reusable components:

ThinkingBlock
ToolGroup
ToolRow
ActivityMessage
WorkflowCard
WorkflowStateBadge
ScoreCard
PlanCard
TeachingHandoffCard
WorkflowResumeCard

All workflow UIs consume the same event model.

---

76. UI Stream Model

The frontend should receive:

EVENT

and transform it into:

ThinkingBlock
ToolGroup
Activity
Card
Gate

For example:

agent.narration
→ ThinkingBlock

tool.started/tool.completed
→ ToolGroup

activity
→ ActivityMessage

learner.action_required
→ Button/Card

assessment.completed
→ ScoreCard

---

77. Streaming Example

The complete Study Prep experience can therefore look exactly like the supplied simulation:

USER
I have a test covering the whole term.

THINKING
context: research

I'm checking the syllabus, your current progress,
previous mistakes and topic dependencies.

TOOL GROUP

research
Checking the Basic Science syllabus
Scanning JSS1 topics
✓ 6 topics found

research
Reviewing learner progress
Checking mastery levels
✓ 3 topics below threshold

research
Reviewing learning history
Looking for recurring misconceptions
✓ 2 recurring gaps found

ACTIVITY

I've checked your syllabus and learning history.
I'm ready to build the study order.

THINKING
context: planning

I'm arranging the topics while respecting their
prerequisite relationships.

TOOL GROUP

draft
Building the study plan
✓ Plan ready

verification
Checking the plan
✓ Syllabus and prerequisites match
✓ Cost fits the current limit

ACTIVITY

Your plan is ready. Estimated cost: 18 coins.

PLAN CARD

Water Cycle       42%
Photosynthesis    61%
Matter            71%
Energy            55%
Force & Motion    76%
Human Body        82%

18 coins estimated
25 coin limit

[Approve & Start]

---

78. Tool / Thinking / Activity Ordering

The backend should support the exact visual pattern:

THINKING
↓
TOOL GROUP
↓
ACTIVITY

but it must not require that every operation always contains all three.

Valid:

Thinking
→ Tool

Valid:

Tool
→ Activity

Valid:

Activity
→ learner action

Valid:

Thinking
→ learner action

The workflow determines which events occur.

---

79. Learner Interaction Events

The learner is also part of the stream.

Examples:

plan.approved
teach_back.confirmed
answer.submitted
workflow.resumed
workflow.paused
topup.completed

The UI can render:

You confirmed the teach-back.

rather than exposing raw API events.

---

80. Backend Names vs Learner Language

Never make the learner UI dependent on backend names.

Backend:

learner.get_history

UI:

Reviewing your learning history

Backend:

concept.get_prerequisites

UI:

Checking which topics need to come first

Backend:

practice.generate

UI:

Generating a fresh practice set

Backend:

workflow.transition

UI:

Moving to the next stage

---

81. Developer Mode

For development/debugging, optionally expose:

workflow type
workflow state
operation
tool name
event ID
sequence
latency
context set

But learner mode should remain human-readable.

Example:

Developer:
strategy_selection
tool=learner.get_history
workflow_state=topic_active
event=evt_123

Learner:

Reviewing your previous attempts

---

82. Agent Decision Contract

LLM responses should be structured.

Example:

{
  "operation": "strategy_selection",
  "action": "create_teaching_workflow",
  "strategy": "teach_back",
  "reason": "Repeated confusion between evaporation and transpiration.",
  "narration": "Your previous attempts show the same confusion, so I'm switching to a teach-back exercise."
}

The "reason" is bounded and observable.

It is not a hidden chain-of-thought field.

---

83. Harness Decision Contract

The harness evaluates:

action allowed?
state valid?
policy valid?
resource valid?
budget valid?
attempt limit valid?

Then:

accepted

or:

rejected

If rejected, emit:

decision.rejected

and generate learner-safe narration.

---

84. Strategy Library

Strategies remain curated and versioned.

Examples:

teach_back
different_analogy
interleave
space_out
escalate_human

The LLM may recommend.

The strategy engine/harness selects or validates the actual strategy.

No arbitrary strategy generation.

---

85. Education Engine

The Education Engine remains authoritative.

It handles:

score
threshold
attempt count
topic outcome
mastery update
evidence
concept state

Example:

3/5
↓
60%
↓
threshold = 70%
↓
failed
↓
teach_back_required

The LLM cannot override this.

---

86. Final Study Prep Example

Study Prep
   ↓
planning
   ↓
confirmation
   ↓
Water Cycle
   ↓
diagnostic 3/5
   ↓
Education Engine
   ↓
teach_back_required
   ↓
Study Prep creates Teaching Workflow
   ↓
awaiting_teaching
   ↓
learner leaves
   ↓
Dashboard
   ↓
Continue Teaching
   ↓
Teaching Workflow
   ↓
teaching completed
   ↓
TEACHING_COMPLETED
   ↓
Study Prep
   ↓
retest_ready
   ↓
retest 5/5
   ↓
understood
   ↓
next topic

Every significant transition produces events for the UI.

---

87. Required Guarantees

The implementation must guarantee:

State safety

No illegal workflow transitions.

Cost safety

No unauthorized spending.

Attempt safety

No attempts beyond configured caps.

Answer safety

Answer keys remain server-side.

Learner confirmation

Required gates cannot be bypassed.

Evidence integrity

LLM output is not ground truth.

Single writer

Deterministic database transitions.

Reconnection

Events and workflow state survive WebSocket reconnects.

Resume

Learners can leave and return later.

Auditability

Workflow events are persisted.

UI consistency

All workflows use the same event/stream architecture.

Context integrity

Only appropriate context is supplied to each operation.

---

88. Recommended Implementation Order

The agent implementing this should follow this order:

1. Audit existing workflow/session code

2. Introduce generic workflow instance model

3. Introduce workflow event model

4. Build Workflow Engine

5. Build state-machine infrastructure

6. Build Event Bus/Event Store

7. Build Activity Narrator

8. Build Context Manager integration

9. Build generic Agent Loop

10. Refactor Study Prep onto infrastructure

11. Refactor Teaching onto infrastructure

12. Refactor Decay onto infrastructure

13. Refactor Practice onto infrastructure

14. Implement Study Prep → Teaching handoff

15. Implement Teaching → Study Prep completion callback

16. Implement dashboard workflow launchers

17. Implement workflow resume

18. Implement event replay/reconnect

19. Implement unified UI stream components

20. Implement developer/debug event view

21. Add concurrency guards

22. Add cost/attempt guards

23. Add integration tests

24. Run full end-to-end simulations

---

89. End-to-End Acceptance Tests

The implementation is not complete until these scenarios work.

Scenario A — Direct Teaching

Dashboard
→ Teach Agent
→ Start Session
→ Teaching Workflow created
→ Teaching Modal opens
→ Agent loop runs
→ events stream
→ learner teaches
→ evidence recorded
→ session completes

Scenario B — Study Prep Teach-Back

Study Prep
→ diagnostic fails
→ teach_back_required
→ Teaching Workflow created
→ Study Prep pauses at awaiting_teaching
→ learner leaves
→ Dashboard shows teaching session
→ learner continues
→ teaching completes
→ Study Prep becomes retest_ready
→ learner continues
→ retest

Scenario C — Decay

Decay alert
→ Start Decay Session
→ Decay Review Workflow
→ diagnostic
→ intervention
→ retest
→ evidence
→ completion

Scenario D — Practice

Practice
→ Practice Workflow
→ generate
→ answer
→ score
→ evidence
→ completion

Scenario E — Reconnect

agent running
→ WebSocket disconnect
→ learner reconnects
→ workflow state restored
→ missing events replayed
→ session continues

Scenario F — Budget Exhaustion

wallet exhausted
→ harness blocks paid action
→ workflow paused
→ progress persisted
→ learner notified
→ top up
→ resume

Scenario G — Attempt Cap

topic fails
→ attempts exhausted
→ immediate retry blocked
→ strategy/defer policy invoked
→ topic deferred or flagged

---

90. Final Architecture

The final Akoro architecture should be understood as:

                         AKORO
                           │
                           ▼
                    WORKFLOW ENGINE
                           │
       ┌───────────────────┼────────────────────┐
       │                   │                    │
       ▼                   ▼                    ▼
  STUDY PREP           TEACHING            DECAY REVIEW
   WORKFLOW             WORKFLOW             WORKFLOW
       │                   │                    │
       └───────────────────┼────────────────────┘
                           │
                           ▼
                    PRACTICE WORKFLOW
                           │
                           ▼
                ADAPTIVE LEARNING ENGINE
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
         Evidence       Strategy        Mastery
                           │
                           ▼
                       AGENT LOOP
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
        CONTEXT MANAGER              HARNESS
              │                         │
              ▼                         ▼
       Workspace + Memory             Tools
              │                         │
              └────────────┬────────────┘
                           ▼
                          LLM
                           │
                           ▼
                  SAFE DECISION NARRATION
                           │
                           ▼
                     EVENT BUS
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
          Chat UI      Dashboard      Teaching UI

And the runtime relationship is:

WORKFLOW STATE
       +
OPERATION
       +
CURRENT OBSERVATION
       +
LEARNER DATA
       +
CONTEXT
       ↓
CONTEXT MANAGER
       ↓
AGENT LOOP
       ↓
LLM
       ↓
STRUCTURED DECISION
       ↓
SAFE NARRATION EVENT
       ↓
HARNESS
       ↓
TOOL / EDUCATION ENGINE
       ↓
OBSERVATION
       ↓
WORKFLOW STATE UPDATE
       ↓
EVENT STREAM
       ↓
UI
       ↓
NEXT AGENT LOOP

---

91. The Four Workflows — Final Mental Model

Akoro should ultimately have:

┌──────────────────────────────────────────┐
│              STUDY PREP                  │
│ Exam preparation journey                 │
│ Planning → Topics → Teaching → Retest   │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│              TEACHING                    │
│ Learner teaches AI agent                │
│ Teach → Evaluate → Adapt → Evidence     │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│            DECAY REVIEW                  │
│ Recover weakened knowledge               │
│ Diagnose → Intervene → Retest            │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│               PRACTICE                   │
│ Standalone assessment                   │
│ Generate → Attempt → Score → Evidence   │
└──────────────────────────────────────────┘

All four use:

Workflow Engine
Agent Loop
Context Manager
Harness
Adaptive Learning Engine
Education Engine
Learner Model
Tool System
Event Stream

That is the target architecture.

92. Most Important Refactor

The single most important conceptual change from the old implementation is:

Old

start_adaptive_session({
    mode: "fresh"
})

start_adaptive_session({
    mode: "continuation"
})

start_adaptive_session({
    mode: "decay"
})

New

createTeachingWorkflow()
resumeTeachingWorkflow()

createDecayReviewWorkflow()
resumeDecayReviewWorkflow()

createStudyPrepWorkflow()
resumeStudyPrepWorkflow()

createPracticeWorkflow()
resumePracticeWorkflow()

The WebSocket then simply transports events for whichever workflow is active.

This keeps workflow identity, state, agent loop, context, tools, evidence, and UI streaming separate from the transport layer.

93. Final Principle

Akoro should not be built as:

Chatbot + some adaptive features

It should be built as:

Durable Learning Workflows
        +
Adaptive Learning Engine
        +
Agent Harness
        +
Context System
        +
Education Engine
        +
Observable Event Stream

The learner sees a simple experience:

Agent is checking
↓
Agent is doing something
↓
Agent explains what happened
↓
Learner acts
↓
Agent adapts
↓
Progress is saved

while underneath, the system maintains deterministic workflow state, bounded agent autonomy, learner evidence, context selection, tool permissions, cost controls, and durable workflow relationships.One particularly important consequence of this plan is that the HTML simulation you posted is no longer just a UI mockup. Its think(), toolGroup(), toolSingle(), act(), score cards, gates, and session cards can become the frontend representation of real backend events.

So instead of simulating:

think(...)
toolGroup(...)
act(...)

the production system would actually receive:

agent.narration
tool.started
tool.completed
activity
assessment.completed
learner.action_required
workflow.state_changed

and render the same collapsible experience.

That gives you a very clean separation:

LLM → Agent Loop → Harness → real action → Event → UI

rather than the UI pretending that the agent thought or used a tool.
