‎Yes — with one important distinction, your understanding is correct.
‎
‎The Dashboard “Teach Agent → Start Session” is a direct entry into the Teaching Workflow. It doesn't need to go through Study Prep.
‎
‎So the architecture becomes:
‎
‎AKORO WORKFLOW ENGINE
‎                           │
‎          ┌────────────────┼─────────────────┐
‎          │                │                 │
‎          ▼                ▼                 ▼
‎   STUDY PREP          TEACHING           DECAY REVIEW
‎    WORKFLOW           WORKFLOW            WORKFLOW
‎          │                │                 │
‎          │                │                 │
‎          │          ┌─────┴─────┐           │
‎          │          │           │           │
‎          │       Direct       From        Direct
‎          │       Teach       Study       Decay
‎          │       Session     Prep        Session
‎          │          │           │           │
‎          │          └─────┬─────┘           │
‎          │                │                 │
‎          ▼                ▼                 ▼
‎       Planning        Teaching            Review
‎       Topics          Session             Session
‎          │                │
‎          │                │
‎          └───────┐  ┌─────┘
‎                  ▼  ▼
‎             ADAPTIVE LEARNING
‎                  ENGINE
‎
‎1. Teaching Workflow has two entry points
‎
‎This is the key clarification.
‎
‎A. Direct teaching
‎
‎From Dashboard:
‎
‎Dashboard
‎   ↓
‎Teach Agent
‎   ↓
‎Start Session
‎   ↓
‎Create Teaching Workflow
‎   ↓
‎Teaching Session
‎
‎This is a normal, standalone teaching workflow.
‎
‎For example:
‎
‎> Student chooses Physics → Motion → Start Session
‎
‎
‎
‎The system creates:
‎
‎workflow_type = teaching
‎entry_mode = direct
‎
‎
‎---
‎
‎B. Study Prep creates teaching
‎
‎Study Prep can also create the exact same type of Teaching Workflow when it determines that teach-back is required:
‎
‎Study Prep
‎   ↓
‎Diagnostic
‎   ↓
‎Gap detected
‎   ↓
‎Teach-back required
‎   ↓
‎Create Teaching Workflow
‎   ↓
‎Learner leaves Study Prep
‎   ↓
‎Dashboard
‎   ↓
‎Continue Teaching
‎   ↓
‎Teaching completed
‎   ↓
‎Return to Study Prep
‎   ↓
‎Retest
‎
‎The difference is simply:
‎
‎entry_mode = direct
‎
‎versus
‎
‎entry_mode = study_prep
‎
‎And for the second one:
‎
‎source_workflow_id = study_prep_workflow
‎source_topic_id    = water_cycle_topic
‎source_reason      = teach_back
‎
‎That gives you a single Teaching Workflow implementation, rather than two different teaching systems.
‎
‎
‎---
‎
‎So your workflow structure
‎
‎I would define it as:
‎
‎1. Study Prep Workflow
‎
‎Purpose:
‎
‎> Prepare the learner for an exam across a planned set of topics.
‎
‎
‎
‎Example:
‎
‎Plan
‎ ↓
‎Diagnostic
‎ ↓
‎Pass → Next Topic
‎ ↓
‎Gap → Create Teaching Workflow
‎ ↓
‎Teaching completes
‎ ↓
‎Retest
‎ ↓
‎Pass → Next Topic
‎
‎
‎---
‎
‎2. Teaching Workflow
‎
‎Purpose:
‎
‎> Let the learner teach their AI agent and produce learning evidence.
‎
‎
‎
‎It has two entry modes:
‎
‎DIRECT
‎Dashboard → Teach Agent → Start Session
‎
‎STUDY_PREP
‎Study Prep → Teach-back required → Teaching Session
‎
‎But both become:
‎
‎Teaching Workflow
‎
‎That's important because you don't want:
‎
‎DirectTeachingSystem
‎StudyPrepTeachingSystem
‎
‎You want:
‎
‎TeachingWorkflow
‎
‎with different origins.
‎
‎
‎---
‎
‎3. Decay Review Workflow
‎
‎Purpose:
‎
‎> Revisit knowledge that has decayed or is due for reinforcement.
‎
‎
‎
‎Flow:
‎
‎Decay Alert
‎   ↓
‎Dashboard
‎   ↓
‎Start Decay Session
‎   ↓
‎Create Decay Review Workflow
‎   ↓
‎Review / Re-teach
‎   ↓
‎Evidence
‎   ↓
‎Complete
‎
‎Your existing DecaySessionModal becomes the UI for this workflow.
‎
‎
‎---
‎
‎4. Practice
‎
‎Here's the one thing I'd be careful about.
‎
‎I would not immediately make Practice a top-level workflow unless Practice has its own persistent lifecycle.
‎
‎Practice is primarily an activity/tool/capability that can be invoked by multiple workflows:
‎
‎Study Prep
‎   └── Practice
‎
‎Teaching
‎   └── Practice / assessment if needed
‎
‎Direct Practice
‎   └── Practice
‎
‎So I'd model it more like:
‎
‎Practice Engine / Practice Service
‎
‎rather than automatically:
‎
‎Practice Workflow
‎
‎unless your standalone Practice feature has things like:
‎
‎its own persistent session
‎
‎pause/resume
‎
‎history
‎
‎goals
‎
‎adaptive strategy
‎
‎completion state
‎
‎workflow events
‎
‎dashboard continuation
‎
‎
‎If it does, then yes, make it a first-class Practice Workflow.
‎
‎
‎---
‎
‎The clean architecture I'd use
‎
‎WORKFLOW ENGINE
‎                       │
‎       ┌───────────────┼────────────────┐
‎       │               │                │
‎       ▼               ▼                ▼
‎  STUDY PREP       TEACHING        DECAY REVIEW
‎   WORKFLOW         WORKFLOW         WORKFLOW
‎       │               │                │
‎       │               │                │
‎       │          ┌────┴────┐           │
‎       │          │         │           │
‎       │       DIRECT    FROM STUDY     │
‎       │       START       PREP        │
‎       │          │         │           │
‎       └──────────┼─────────┘           │
‎                  │                     │
‎                  ▼                     ▼
‎             PRACTICE / ASSESSMENT / EVIDENCE
‎                         │
‎                         ▼
‎              ADAPTIVE LEARNING ENGINE
‎                         │
‎              ┌──────────┼──────────┐
‎              ▼          ▼          ▼
‎           Strategy    Evidence   Mastery
‎
‎And underneath that:
‎
‎AGENT RUNTIME
‎                   │
‎          ┌────────┴────────┐
‎          ▼                 ▼
‎    CONTEXT MANAGER       HARNESS
‎          │                 │
‎          ▼                 ▼
‎       LLM LOOP           TOOLS
‎
‎The really important separation
‎
‎Don't confuse these four things:
‎
‎LayerQuestion it answers
‎
‎WorkflowWhat learning experience is happening?
‎Adaptive Learning EngineHow should learning adapt to evidence?
‎Agent LoopWhat should the AI do next?
‎Practice/Education EngineWhat actually happened / what is the score/evidence?
‎
‎
‎So yes, your main workflow inventory should be:
‎
‎STUDY_PREP
‎TEACHING
‎DECAY_REVIEW
‎
‎and potentially:
‎
‎PRACTICE
‎
‎only if standalone Practice genuinely behaves like a durable workflow.
‎
‎The Dashboard "Start Teaching Session" absolutely belongs to TEACHING, and Study Prep's teach-back should create the same workflow rather than creating a special teaching implementation.
‎
