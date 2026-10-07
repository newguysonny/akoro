‎Full structure 1
‎
‎Yes — and after inspecting the codebase, I think this is actually the right direction for Akoro.
‎
‎But there is an important distinction:
‎
‎> Adaptive learning should become a workflow at the system level, while the AI remains an adaptive agent operating inside that workflow.
‎
‎
‎
‎Your codebase is already halfway there. In fact, you currently have three different pieces that are being called “workflow”, and we can unify them cleanly.
‎
‎What you already have
‎
‎I found:
‎
‎adaptive-workflows.js — durable adaptive workflow records
‎
‎workflow-state.js — a state machine: researching → planned → diagnostic_ready → teach_back_required → retest_ready → passed/change_approach
‎
‎teaching-workflow/runner.js — a fixed server-owned teaching-turn workflow
‎
‎study-prep/agent-loop.js — the actual LLM agent loop
‎
‎lessonLadder.js — adaptive lesson/subtopic resolution
‎
‎NaNa Esumai + Sargeant — guide/control agents
‎
‎Student Agent — learner-model / knowledge behavior
‎
‎cognitive state, confusion, decay, teaching evidence, concept tracking, etc.
‎
‎
‎So I wouldn't throw this away.
‎
‎I would reorganize it into a clearer architecture.
‎
‎
‎---
‎
‎1. The big picture
‎
‎I would make Akoro's adaptive learning architecture look like this:
‎
‎AKORO ADAPTIVE LEARNING SYSTEM
‎                              │
‎                              ▼
‎                 ┌─────────────────────────┐
‎                 │ ADAPTIVE LEARNING       │
‎                 │ WORKFLOW                │
‎                 │                         │
‎                 │ Determines WHAT         │
‎                 │ learning journey        │
‎                 │ should happen           │
‎                 └────────────┬────────────┘
‎                              │
‎             ┌────────────────┼────────────────┐
‎             ▼                ▼                ▼
‎        DIAGNOSTIC       INTERVENTION       RETEST
‎             │                │                │
‎             │                │                │
‎             ▼                ▼                ▼
‎       assess learner   teach / explain   reassess
‎             │                │                │
‎             └────────────────┼────────────────┘
‎                              ▼
‎                         OBSERVATION
‎                              │
‎                              ▼
‎                   ┌─────────────────────┐
‎                   │ ADAPTIVE DECISION   │
‎                   │                     │
‎                   │ What should happen  │
‎                   │ next?               │
‎                   └──────────┬──────────┘
‎                              │
‎                 ┌────────────┼─────────────┐
‎                 ▼            ▼             ▼
‎              advance     change strategy   gap
‎                 │            │             │
‎                 ▼            ▼             ▼
‎             next topic   intervention   flag/replan
‎
‎And inside those stages, the agent loop operates:
‎
‎Context
‎   ↓
‎LLM
‎   ↓
‎Proposed action
‎   ↓
‎Harness
‎   ↓
‎Tool
‎   ↓
‎Observation
‎   ↓
‎LLM
‎   ↓
‎...
‎
‎This is the same separation we established for Study-Prep.
‎
‎
‎---
‎
‎2. Adaptive learning is NOT the same workflow as Study-Prep
‎
‎This is the most important architectural distinction.
‎
‎You would have:
‎
‎STUDY-PREP SESSION STATE MACHINE
‎
‎which answers:
‎
‎> What is the learner doing at the session level?
‎
‎
‎
‎For example:
‎
‎planning
‎   ↓
‎awaiting_confirmation
‎   ↓
‎topic_active
‎   ↓
‎replanning
‎   ↓
‎completed
‎
‎Then:
‎
‎ADAPTIVE LEARNING WORKFLOW
‎
‎answers:
‎
‎> What should happen to the learner's knowledge for this topic?
‎
‎
‎
‎For example:
‎
‎research
‎   ↓
‎diagnose
‎   ↓
‎interpret evidence
‎   ↓
‎choose intervention
‎   ↓
‎teach/practice
‎   ↓
‎observe
‎   ↓
‎reassess
‎   ↓
‎evaluate
‎   ↓
‎advance / intervene again / flag gap
‎
‎So:
‎
‎STUDY-PREP SESSION
‎        │
‎        ├── Topic 1
‎        │      │
‎        │      └── Adaptive Learning Workflow
‎        │
‎        ├── Topic 2
‎        │      │
‎        │      └── Adaptive Learning Workflow
‎        │
‎        ├── Topic 3
‎        │      │
‎        │      └── Adaptive Learning Workflow
‎        │
‎        └── Topic 4
‎               │
‎               └── Adaptive Learning Workflow
‎
‎That's much cleaner.
‎
‎
‎---
‎
‎3. Your existing adaptive_workflow_runs is already pointing in this direction
‎
‎Your migration currently has:
‎
‎adaptive_workflow_runs
‎
‎with:
‎
‎researching
‎planned
‎diagnostic_ready
‎teach_back_required
‎retest_ready
‎passed
‎change_approach
‎cancelled
‎
‎That is already a workflow state machine.
‎
‎The problem isn't that you need another workflow.
‎
‎The problem is that this workflow currently represents mostly the exam-prep assessment path.
‎
‎It's essentially:
‎
‎research
‎  ↓
‎plan
‎  ↓
‎diagnostic
‎  ↓
‎teach-back
‎  ↓
‎retest
‎  ↓
‎pass/change approach
‎
‎That's useful, but adaptive learning in Akoro is bigger than exam-prep assessment.
‎
‎
‎---
‎
‎4. I would make Adaptive Learning the parent workflow
‎
‎I'd evolve it toward:
‎
‎ADAPTIVE_LEARNING_WORKFLOW
‎
‎with states roughly like:
‎
‎INITIALIZING
‎      ↓
‎CONTEXT_RESOLUTION
‎      ↓
‎DIAGNOSTIC
‎      ↓
‎EVIDENCE_ANALYSIS
‎      ↓
‎STRATEGY_SELECTION
‎      ↓
‎INTERVENTION
‎      ↓
‎PRACTICE
‎      ↓
‎OBSERVATION
‎      ↓
‎EVALUATION
‎      │
‎      ├───────────────┐
‎      │               │
‎      ▼               ▼
‎   UNDERSTOOD      NOT_READY
‎      │               │
‎      ▼               ▼
‎   ADVANCE       CHANGE_STRATEGY
‎                      │
‎                      ▼
‎                  INTERVENTION
‎
‎And eventually:
‎
‎┌──────────────┐
‎                 │ ADAPTIVE     │
‎                 │ LEARNING     │
‎                 │ WORKFLOW     │
‎                 └──────┬───────┘
‎                        │
‎          ┌─────────────┼──────────────┐
‎          ▼             ▼              ▼
‎      DIAGNOSIS     INTERVENTION     RETRIEVAL
‎          │             │              │
‎          ▼             ▼              ▼
‎      ASSESSMENT     TEACHING        PRACTICE
‎          │             │              │
‎          └─────────────┼──────────────┘
‎                        ▼
‎                     EVIDENCE
‎                        │
‎                        ▼
‎                   DECISION ENGINE
‎                        │
‎          ┌─────────────┼─────────────┐
‎          ▼             ▼             ▼
‎       ADVANCE      RETRY/CHANGE      GAP
‎
‎
‎---
‎
‎5. But don't make the workflow too rigid
‎
‎This is where your agent engineering becomes important.
‎
‎I would NOT do this:
‎
‎DIAGNOSTIC
‎↓
‎TEACH
‎↓
‎PRACTICE
‎↓
‎RETEST
‎↓
‎PASS
‎
‎for every learner.
‎
‎Because then it isn't really adaptive.
‎
‎Instead:
‎
‎ADAPTIVE WORKFLOW
‎                         │
‎                         ▼
‎                     OBSERVE
‎                         │
‎                         ▼
‎                 DECISION POINT
‎                         │
‎          ┌──────────────┼──────────────┐
‎          ▼              ▼              ▼
‎       practice        teach-back     different
‎       again           intervention   analogy
‎          │              │              │
‎          └──────────────┼──────────────┘
‎                         ▼
‎                      OBSERVE
‎                         │
‎                         ▼
‎                   DECISION POINT
‎
‎The states are deterministic.
‎
‎The path through them is adaptive.
‎
‎That's the key.
‎
‎
‎---
‎
‎6. This fits your existing agent architecture perfectly
‎
‎Your current study-prep/agent-loop.js already has:
‎
‎context
‎   ↓
‎LLM
‎   ↓
‎ONE structured action
‎   ↓
‎harness
‎   ↓
‎validate
‎   ↓
‎execute
‎   ↓
‎observation
‎   ↓
‎LLM
‎
‎That's excellent.
‎
‎I'd reuse that pattern.
‎
‎The adaptive-learning agent could receive:
‎
‎{
‎  workflowState: "evidence_analysis",
‎
‎  learner: {
‎    mastery: 0.42,
‎    confusion: 0.61,
‎    recentAttempts: [...]
‎  },
‎
‎  topic: {
‎    id: "...",
‎    concept: "...",
‎    prerequisites: [...]
‎  },
‎
‎  evidence: {
‎    diagnosticScore: 0.60,
‎    misconceptions: [
‎      "confuses evaporation and transpiration"
‎    ]
‎  },
‎
‎  availableStrategies: [
‎    "teach_back",
‎    "different_analogy",
‎    "interleave"
‎  ]
‎}
‎
‎The LLM doesn't directly change state.
‎
‎It proposes:
‎
‎{
‎  "action": "select_strategy",
‎  "strategy": "teach_back",
‎  "intent": "address_misconception"
‎}
‎
‎Then:
‎
‎LLM
‎                  │
‎                  ▼
‎        proposed strategy
‎                  │
‎                  ▼
‎              HARNESS
‎                  │
‎        ┌─────────┴─────────┐
‎        │                   │
‎      allowed            rejected
‎        │                   │
‎        ▼                   ▼
‎   execute strategy      observation
‎        │
‎        ▼
‎     evidence
‎        │
‎        ▼
‎ deterministic engine
‎        │
‎        ▼
‎  workflow transition
‎
‎This is exactly the architecture you've been trying to build.
‎
‎
‎---
‎
‎7. Your NaNa + Sargeant architecture becomes much cleaner
‎
‎Right now you have things like:
‎
‎NaNa Esumai
‎Sargeant
‎Student Agent
‎
‎I would not make these the workflow themselves.
‎
‎Instead:
‎
‎Adaptive Learning Workflow
‎
‎owns:
‎
‎state
‎transitions
‎evidence
‎strategy selection
‎limits
‎progression
‎
‎NaNa
‎
‎is a learning intervention/guide capability:
‎
‎explain
‎coach
‎ask questions
‎give analogy
‎guide teach-back
‎
‎Sargeant
‎
‎is a control/assessment capability:
‎
‎assess
‎detect drift
‎gate progression
‎evaluate
‎
‎Student Agent
‎
‎is a learner model / knowledge representation:
‎
‎knowledge
‎understanding
‎confusion
‎memory
‎decay
‎misconceptions
‎
‎So:
‎
‎ADAPTIVE WORKFLOW
‎                           │
‎              ┌────────────┼────────────┐
‎              │            │            │
‎              ▼            ▼            ▼
‎            NaNa        Sargeant    Student Agent
‎           Guide          Control      Learner Model
‎              │            │            │
‎              └────────────┼────────────┘
‎                           ▼
‎                         Evidence
‎                           │
‎                           ▼
‎                   Education Engine
‎                           │
‎                           ▼
‎                    State Transition
‎
‎That's a much more powerful architecture.
‎
‎
‎---
‎
‎8. Your teaching-workflow is then a child workflow/operation
‎
‎This is another important distinction.
‎
‎You currently have:
‎
‎TEACHING_TURN_WORKFLOW
‎
‎with:
‎
‎load_session_state
‎observe_teaching_evidence
‎generate_protege_discussion
‎assess_protege_understanding
‎persist_cognitive_state
‎record_verified_learning
‎coach_teaching_dialogue
‎gate_teaching_progress
‎
‎I actually like this.
‎
‎Keep it.
‎
‎But conceptually make it a sub-workflow executed when Adaptive Learning chooses a teaching intervention.
‎
‎For example:
‎
‎ADAPTIVE LEARNING WORKFLOW
‎        │
‎        ▼
‎   STRATEGY_SELECTION
‎        │
‎        ▼
‎   "teach_back"
‎        │
‎        ▼
‎┌───────────────────────────────┐
‎│ TEACHING WORKFLOW             │
‎│                               │
‎│ load state                    │
‎│ observe evidence              │
‎│ generate protege discussion   │
‎│ assess understanding          │
‎│ persist state                 │
‎│ record learning               │
‎│ coach                         │
‎│ gate progression              │
‎└───────────────────────────────┘
‎        │
‎        ▼
‎     OBSERVATION
‎        │
‎        ▼
‎ADAPTIVE LEARNING WORKFLOW
‎        │
‎        ▼
‎    EVALUATION
‎
‎This gives you workflow composition.
‎
‎
‎---
‎
‎9. Then Exam Prep becomes another consumer
‎
‎This is where I think the architecture becomes really interesting.
‎
‎Instead of:
‎
‎Study Prep
‎    ↓
‎Exam Prep
‎
‎being tightly coupled, you can have:
‎
‎ADAPTIVE LEARNING ENGINE
‎                             │
‎          ┌──────────────────┼──────────────────┐
‎          ▼                  ▼                  ▼
‎      STUDY PREP         FREE LEARNING       TEACHING
‎          │                  │                  │
‎          ▼                  ▼                  ▼
‎      EXAM PREP          EXPLORATION        TEACH-BACK
‎
‎For example, exam prep can say:
‎
‎"I need this learner to demonstrate understanding
‎of Photosynthesis."
‎
‎Adaptive Learning handles:
‎
‎diagnose
‎→ identify gap
‎→ choose strategy
‎→ intervene
‎→ reassess
‎→ update learner state
‎
‎Exam Prep doesn't need to know all of the internal adaptive-learning machinery.
‎
‎
‎---
‎
‎10. Even decay/review can use the same workflow
‎
‎Your code already has:
‎
‎decayEngine
‎decay_review
‎
‎That could become another entry point.
‎
‎For example:
‎
‎DECAY DETECTED
‎      ↓
‎ADAPTIVE LEARNING WORKFLOW
‎      ↓
‎retrieve old knowledge
‎      ↓
‎diagnose retention
‎      ↓
‎choose retrieval strategy
‎      ↓
‎practice
‎      ↓
‎observe
‎      ↓
‎update strength
‎
‎So the same adaptive engine can support:
‎
‎Exam preparation
‎
‎Goal = pass exam
‎
‎Normal learning
‎
‎Goal = understand concept
‎
‎Decay review
‎
‎Goal = restore forgotten knowledge
‎
‎Teach-to-learn
‎
‎Goal = demonstrate understanding by teaching
‎
‎Remediation
‎
‎Goal = resolve persistent misconception
‎
‎That's much more reusable than building separate AI logic for each feature.
‎
‎
‎---
‎
‎11. The workflow should therefore be data-driven
‎
‎I'd eventually want something like:
‎
‎const ADAPTIVE_WORKFLOW = {
‎  type: "adaptive_learning",
‎  version: "v1",
‎
‎  states: [
‎    "initializing",
‎    "context_resolution",
‎    "diagnostic",
‎    "evidence_analysis",
‎    "strategy_selection",
‎    "intervention",
‎    "practice",
‎    "observation",
‎    "evaluation",
‎    "completed",
‎    "flagged_gap",
‎    "paused",
‎  ],
‎
‎  strategies: [
‎    "direct_explanation",
‎    "teach_back",
‎    "different_analogy",
‎    "guided_practice",
‎    "interleaving",
‎    "retrieval_practice",
‎    "spaced_review",
‎    "escalate_human",
‎  ]
‎};
‎
‎Then transitions are controlled by code:
‎
‎canTransition(
‎  "evidence_analysis",
‎  "strategy_selection"
‎); // true
‎
‎But:
‎
‎canTransition(
‎  "evidence_analysis",
‎  "completed"
‎); // false
‎
‎The LLM can't invent its own state.
‎
‎
‎---
‎
‎12. And this gives us a very clean hierarchy
‎
‎I think this is the architecture we should work toward:
‎
‎AKORO
‎│
‎├── STUDY-PREP SESSION STATE MACHINE
‎│
‎│   ├── planning
‎│   ├── awaiting_confirmation
‎│   ├── topic_active
‎│   ├── replanning
‎│   ├── paused
‎│   └── completed
‎│
‎│          │
‎│          ▼
‎│
‎├── ADAPTIVE LEARNING WORKFLOW
‎│
‎│   ├── diagnose
‎│   ├── analyze evidence
‎│   ├── select strategy
‎│   ├── intervene
‎│   ├── practice
‎│   ├── observe
‎│   ├── evaluate
‎│   └── advance / retry / gap
‎│
‎│          │
‎│          ▼
‎│
‎├── AGENT LOOP
‎│
‎│   Context
‎│      ↓
‎│   LLM
‎│      ↓
‎│   Action
‎│      ↓
‎│   Harness
‎│      ↓
‎│   Tool
‎│      ↓
‎│   Observation
‎│      ↓
‎│   LLM
‎│
‎│          │
‎│          ▼
‎│
‎├── SUB-WORKFLOWS / CAPABILITIES
‎│
‎│   ├── Teaching Workflow
‎│   ├── Assessment Workflow
‎│   ├── Practice
‎│   ├── Teach-back
‎│   ├── Retrieval
‎│   ├── Decay Review
‎│   └── Human Escalation
‎│
‎│          │
‎│          ▼
‎│
‎├── DETERMINISTIC EDUCATION ENGINE
‎│
‎│   ├── scoring
‎│   ├── mastery
‎│   ├── confidence
‎│   ├── misconception evidence
‎│   ├── concept state
‎│   └── transitions
‎│
‎└── LEARNER MODEL
‎    ├── knowledge
‎    ├── memory
‎    ├── decay
‎    ├── confusion
‎    ├── strengths
‎    ├── weaknesses
‎    └── learning history
‎
‎So yes — I strongly recommend it.
‎
‎And importantly, your current code already contains most of the ingredients. We don't need to rewrite adaptive learning from scratch.
‎
‎The next step I'd suggest is to map the existing adaptive-learning codebase onto this architecture: identify exactly which current files belong to Adaptive Workflow, Agent Loop, Context, Tools, Sub-workflows, Education Engine, and Learner Model, then identify what should be merged, renamed, or left alone. That will tell us whether we need a new workflow engine or simply need to promote and reorganize what you already have.
‎
