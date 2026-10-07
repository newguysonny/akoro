‎Final structure 
‎
‎Yes. Each first-class workflow should have its own state machine, operations, and agent loop, but they should share the same underlying infrastructure.
‎
‎The important distinction is that the states and operations are workflow-specific, while the Agent Loop, Context Manager, Harness, tools, and Adaptive Learning Engine are shared architectural capabilities.
‎
‎I would define the three workflows like this.
‎
‎
‎---
‎
‎1. Study Prep Workflow
‎
‎This is already the most developed one.
‎
‎Session states
‎
‎PLANNING
‎    ↓
‎AWAITING_CONFIRMATION
‎    ↓
‎TOPIC_ACTIVE
‎    │
‎    ├──→ REPLANNING
‎    │       ↓
‎    │   TOPIC_ACTIVE
‎    │
‎    ├──→ PAUSED
‎    │
‎    └──→ COMPLETED
‎
‎TOPIC_ACTIVE
‎    │
‎    ├── diagnostic
‎    ├── intervention
‎    ├── retest
‎    └── outcome
‎
‎Topic states
‎
‎QUEUED
‎  ↓
‎ACTIVE
‎  ↓
‎┌───────────────┬──────────────┬─────────────┐
‎UNDERSTOOD   FLAGGED_GAP   CAPPED_OUT   DEFERRED
‎
‎Or, at the run/operation level:
‎
‎diagnostic_ready
‎      ↓
‎teach_back_required
‎      ↓
‎retest_ready
‎      ↓
‎passed
‎
‎Operations
‎
‎planning
‎inspection
‎research
‎diagnostic
‎assessment
‎strategy_selection
‎intervention
‎retest
‎outcome_evaluation
‎topic_advance
‎replanning
‎session_completion
‎
‎Agent loop
‎
‎Context
‎   ↓
‎Reason
‎   ↓
‎Select operation/action
‎   ↓
‎Harness validates
‎   ↓
‎Tool / Education Engine
‎   ↓
‎Observation
‎   ↓
‎Reason again
‎
‎The Study Prep agent is deciding things like:
‎
‎> Which topic should I inspect?
‎
‎
‎
‎> Does this evidence indicate a gap?
‎
‎
‎
‎> Should I request teaching?
‎
‎
‎
‎> Which approved strategy is appropriate?
‎
‎
‎
‎> Should I retest?
‎
‎
‎
‎
‎---
‎
‎2. Teaching Workflow
‎
‎This should absolutely have its own state machine.
‎
‎But it should be different from Study Prep because the objective is different.
‎
‎The Teaching Workflow's fundamental question is:
‎
‎> Can the learner successfully teach the concept to their AI agent, and what evidence did that teaching produce?
‎
‎
‎
‎Teaching session states
‎
‎I recommend:
‎
‎CREATED
‎   ↓
‎PREPARING
‎   ↓
‎TEACHING_ACTIVE
‎   │
‎   ├── PAUSED
‎   │     ↓
‎   │   TEACHING_ACTIVE
‎   │
‎   ├── NEEDS_CLARIFICATION
‎   │     ↓
‎   │   TEACHING_ACTIVE
‎   │
‎   └── READY_FOR_ASSESSMENT
‎            ↓
‎        ASSESSING
‎            ↓
‎       ┌────┴─────┐
‎       ↓          ↓
‎   COMPLETED   TEACHING_ACTIVE
‎
‎But I would simplify the persisted workflow states to:
‎
‎created
‎preparing
‎active
‎paused
‎assessing
‎completed
‎abandoned
‎cancelled
‎
‎Then use operations to represent what is happening inside active.
‎
‎That avoids creating a giant state machine.
‎
‎
‎---
‎
‎Teaching operations
‎
‎prepare
‎load_context
‎start_teaching
‎receive_teaching
‎inspect_explanation
‎ask_question
‎detect_gap
‎request_clarification
‎record_teaching_evidence
‎assess
‎evaluate
‎complete
‎
‎For example:
‎
‎TEACHING_ACTIVE
‎       │
‎       ▼
‎receive_teaching
‎       │
‎       ▼
‎inspect_explanation
‎       │
‎       ├── clear
‎       │
‎       └── unclear
‎             ↓
‎       ask_question
‎             ↓
‎       receive_teaching
‎
‎Eventually:
‎
‎TEACHING_ACTIVE
‎       ↓
‎assessment
‎       ↓
‎evidence
‎       ↓
‎evaluation
‎       ↓
‎COMPLETED
‎
‎The Teaching Agent Loop
‎
‎It might look like:
‎
‎LOAD CONTEXT
‎     ↓
‎REASON
‎     ↓
‎What should I ask/do next?
‎     ↓
‎ACTION
‎     ↓
‎ask_question / acknowledge / challenge / assess
‎     ↓
‎OBSERVE LEARNER RESPONSE
‎     ↓
‎REASON
‎     ↓
‎next action
‎
‎So the Teaching Agent is not simply following a predetermined script.
‎
‎For example:
‎
‎Learner:
‎
‎> Evaporation is when water turns into vapor because of heat.
‎
‎
‎
‎Agent:
‎
‎observe
‎  ↓
‎concept appears partially correct
‎  ↓
‎identify missing distinction
‎  ↓
‎ask targeted question
‎
‎Agent:
‎
‎> What is different about transpiration?
‎
‎
‎
‎Learner responds.
‎
‎Agent evaluates the response and continues.
‎
‎
‎---
‎
‎3. Decay Review Workflow
‎
‎Decay is also its own workflow because its entry condition and objective are different.
‎
‎The purpose is:
‎
‎> Knowledge that was previously demonstrated is showing signs of decay, so the learner should revisit it.
‎
‎
‎
‎Decay workflow states
‎
‎I recommend:
‎
‎CREATED
‎   ↓
‎PREPARING
‎   ↓
‎REVIEW_ACTIVE
‎   │
‎   ├── PAUSED
‎   │     ↓
‎   │   REVIEW_ACTIVE
‎   │
‎   └── READY_FOR_ASSESSMENT
‎            ↓
‎        ASSESSING
‎            ↓
‎       ┌────┴─────┐
‎       ↓          ↓
‎   COMPLETED    REVIEW_ACTIVE
‎
‎Persisted states:
‎
‎created
‎preparing
‎active
‎paused
‎assessing
‎completed
‎abandoned
‎cancelled
‎
‎Notice something important:
‎
‎The states can look similar to Teaching.
‎
‎That's okay.
‎
‎The workflow's meaning is different.
‎
‎
‎---
‎
‎Decay operations
‎
‎prepare
‎load_decay_context
‎inspect_knowledge_state
‎select_review_target
‎review
‎retrieve
‎revisit
‎assess
‎evaluate_retention
‎record_evidence
‎complete
‎
‎For example:
‎
‎DECAY ALERT
‎     ↓
‎load_decay_context
‎     ↓
‎inspect_knowledge_state
‎     ↓
‎select_review_target
‎     ↓
‎review
‎     ↓
‎retrieval question
‎     ↓
‎observe answer
‎     ↓
‎evaluate retention
‎     ↓
‎      ┌───────────────┐
‎      │               │
‎ retained          weakened
‎      │               │
‎      ↓               ↓
‎ reinforce       revisit concept
‎      │               │
‎      └───────┬───────┘
‎              ↓
‎          assessment
‎              ↓
‎          COMPLETED
‎
‎
‎---
‎
‎4. The three Agent Loops are different
‎
‎This is an important architectural point.
‎
‎We don't want one universal:
‎
‎agentLoop()
‎
‎that pretends every learning experience is the same.
‎
‎Instead, we have a shared Agent Loop Runtime, with workflow-specific policies.
‎
‎Conceptually:
‎
‎AGENT LOOP RUNTIME
‎                           │
‎             ┌─────────────┼─────────────┐
‎             │             │             │
‎             ▼             ▼             ▼
‎       Study Prep      Teaching       Decay
‎       Controller      Controller     Controller
‎             │             │             │
‎             ▼             ▼             ▼
‎       Study Prep      Teaching       Decay
‎       operations      operations     operations
‎
‎The generic loop is:
‎
‎while workflow_can_continue:
‎
‎    context = contextManager.build(...)
‎
‎    decision = LLM(context)
‎
‎    action = harness.validate(decision)
‎
‎    observation = execute(action)
‎
‎    workflowController.process(observation)
‎
‎    repeat
‎
‎But each controller supplies different rules.
‎
‎
‎---
‎
‎5. Context Manager also becomes workflow-aware
‎
‎This fits directly with what we discussed earlier.
‎
‎For Study Prep:
‎
‎workflow = study_prep
‎state = topic_active
‎operation = assessment
‎
‎Context Manager might load:
‎
‎AGENT.md
‎LEARNING.md
‎ASSESSMENT.md
‎MASTERY.md
‎EDUCATION_RULES.md
‎
‎For Teaching:
‎
‎workflow = teaching
‎state = active
‎operation = inspect_explanation
‎
‎It might load:
‎
‎AGENT.md
‎TEACHING.md
‎LEARNING.md
‎MASTERY.md
‎EDUCATION_RULES.md
‎
‎For Decay:
‎
‎workflow = decay_review
‎state = active
‎operation = inspect_knowledge_state
‎
‎It might load:
‎
‎AGENT.md
‎LEARNING.md
‎DECAY.md
‎MASTERY.md
‎EDUCATION_RULES.md
‎
‎So your Context Manager becomes:
‎
‎WORKFLOW
‎   +
‎STATE
‎   +
‎OPERATION
‎   +
‎CURRENT DATA
‎   +
‎RELEVANT MEMORY
‎        ↓
‎CONTEXT MANAGER
‎        ↓
‎SELECTED CONTEXT
‎        ↓
‎LLM
‎
‎
‎---
‎
‎6. Adaptive Learning Engine sits underneath all three
‎
‎This is where the architecture becomes really clean.
‎
‎WORKFLOW ENGINE
‎                       │
‎       ┌───────────────┼────────────────┐
‎       ▼               ▼                ▼
‎  STUDY PREP       TEACHING         DECAY REVIEW
‎       │               │                │
‎       │               │                │
‎       └───────────────┼────────────────┘
‎                       ▼
‎             ADAPTIVE LEARNING ENGINE
‎                       │
‎          ┌────────────┼────────────┐
‎          ▼            ▼            ▼
‎       Evidence      Strategy     Mastery
‎          │            │            │
‎          └────────────┼────────────┘
‎                       ▼
‎               Education Engine
‎
‎The Adaptive Learning Engine doesn't say:
‎
‎> "You are currently in a Teaching Workflow."
‎
‎
‎
‎That's the Workflow Engine's responsibility.
‎
‎Instead it answers things like:
‎
‎> What does this evidence tell us?
‎
‎
‎
‎> Is the learner's knowledge weakening?
‎
‎
‎
‎> Is the learner demonstrating understanding?
‎
‎
‎
‎> Which approved strategy should be considered?
‎
‎
‎
‎
‎---
‎
‎7. And this solves your direct Teaching Session perfectly
‎
‎Your Dashboard:
‎
‎[ Teach Agent ]
‎      ↓
‎[ Start Session ]
‎      ↓
‎createWorkflow({
‎    type: "teaching",
‎    entryMode: "direct"
‎})
‎
‎Study Prep:
‎
‎diagnostic
‎   ↓
‎gap detected
‎   ↓
‎harness decides teach-back required
‎   ↓
‎createWorkflow({
‎    type: "teaching",
‎    entryMode: "study_prep",
‎    parentWorkflowId: studyPrep.id
‎})
‎
‎Decay:
‎
‎decay alert
‎   ↓
‎[ Start Decay Session ]
‎   ↓
‎createWorkflow({
‎    type: "decay_review",
‎    entryMode: "decay_alert"
‎})
‎
‎All three get their own workflow instance.
‎
‎
‎---
‎
‎8. Final architecture
‎
‎I would now define Akoro's learning architecture as:
‎
‎AKORO
‎                           │
‎                    WORKFLOW ENGINE
‎                           │
‎        ┌──────────────────┼──────────────────┐
‎        │                  │                  │
‎        ▼                  ▼                  ▼
‎   STUDY PREP          TEACHING          DECAY REVIEW
‎   WORKFLOW             WORKFLOW           WORKFLOW
‎        │                  │                  │
‎        │                  │                  │
‎   States              States             States
‎   Operations          Operations         Operations
‎   Controller          Controller         Controller
‎   Agent Loop          Agent Loop         Agent Loop
‎        │                  │                  │
‎        └──────────────────┼──────────────────┘
‎                           ▼
‎                ADAPTIVE LEARNING ENGINE
‎                           │
‎             ┌─────────────┼─────────────┐
‎             ▼             ▼             ▼
‎          Evidence      Strategy       Mastery
‎                           │
‎                           ▼
‎                   EDUCATION ENGINE
‎                           │
‎                           ▼
‎                    LEARNER MODEL
‎
‎And surrounding every agent loop:
‎
‎CONTEXT MANAGER
‎                           │
‎                           ▼
‎                    LLM / AGENT
‎                           │
‎                           ▼
‎                       HARNESS
‎                           │
‎                           ▼
‎                        TOOLS
‎                           │
‎                           ▼
‎                     OBSERVATION
‎                           │
‎                           └──────→ Agent Loop
‎
‎One final naming recommendation
‎
‎I would not call these:
‎
‎> Study Prep Agent
‎Teaching Agent
‎Decay Agent
‎
‎
‎
‎at the architectural level.
‎
‎Call them:
‎
‎Study Prep Workflow
‎Teaching Workflow
‎Decay Review Workflow
‎
‎And each workflow has a workflow controller + agent loop.
‎
‎The existing "Student AI Agent" that the learner teaches can remain the AI learner/agent inside the Teaching Workflow.
‎
‎That distinction will prevent the codebase from becoming confusing as Akoro grows.
‎
