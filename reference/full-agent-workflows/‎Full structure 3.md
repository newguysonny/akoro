‎Full structure 3
‎
‎Yes — your confusion is valid. The previous architecture can sound like “everything uses the Adaptive Learning Workflow,” but I would correct that.
‎
‎The clean architecture is:
‎
‎> Different user actions start different top-level workflows. They can all use the same Adaptive Learning Engine underneath.
‎
‎
‎
‎So Adaptive Learning is not necessarily the workflow for every session type.
‎
‎
‎---
‎
‎The three cases
‎
‎User actionTop-level workflowUses Adaptive Learning?
‎
‎Start Study SessionStudy Prep Workflow✅ Yes, for each active topic
‎Decay SessionDecay Review Workflow✅ Yes, for the actual learning/review
‎Continue SessionResume existing workflow✅ Yes, if that workflow was using it
‎Teach AgentTeaching WorkflowCan use adaptive engine
‎Practice onlyPractice WorkflowCan use adaptive engine
‎
‎
‎So think:
‎
‎AKORO WORKFLOW ENGINE
‎                           │
‎          ┌────────────────┼─────────────────┐
‎          │                │                 │
‎          ▼                ▼                 ▼
‎    STUDY PREP       DECAY REVIEW       TEACHING
‎     WORKFLOW         WORKFLOW          WORKFLOW
‎          │                │                 │
‎          └────────────────┼─────────────────┘
‎                           ▼
‎                 ADAPTIVE LEARNING
‎                      ENGINE
‎                           │
‎          ┌────────────────┼────────────────┐
‎          ▼                ▼                ▼
‎       diagnose        strategy          evidence
‎       learner         selection         evaluation
‎
‎That's the distinction I want you to keep.
‎
‎
‎---
‎
‎1. When frontend clicks "Start Session"
‎
‎Suppose the learner selects:
‎
‎> JSS1 Basic Science → Whole Term → Start Session
‎
‎
‎
‎The frontend should initiate:
‎
‎START SESSION
‎     ↓
‎Study Prep Workflow
‎
‎Not:
‎
‎Start Session
‎     ↓
‎Adaptive Learning Workflow
‎
‎The Study Prep workflow handles things like:
‎
‎planning
‎   ↓
‎awaiting_confirmation
‎   ↓
‎topic_active
‎
‎Then once a topic becomes active:
‎
‎Study Prep
‎    │
‎    ▼
‎Topic: Water Cycle
‎    │
‎    ▼
‎Adaptive Learning Engine
‎
‎The adaptive engine can then determine:
‎
‎diagnostic
‎     ↓
‎evidence
‎     ↓
‎strategy
‎     ↓
‎intervention
‎     ↓
‎practice
‎     ↓
‎evaluation
‎
‎So:
‎
‎START SESSION
‎     │
‎     ▼
‎┌──────────────────────┐
‎│ STUDY PREP WORKFLOW  │
‎└──────────┬───────────┘
‎           │
‎           ▼
‎       Topic Active
‎           │
‎           ▼
‎┌──────────────────────┐
‎│ ADAPTIVE LEARNING    │
‎│ ENGINE               │
‎└──────────────────────┘
‎
‎
‎---
‎
‎2. What about a Decay Session?
‎
‎This should be different.
‎
‎Imagine the learner gets:
‎
‎> "Your understanding of Photosynthesis has weakened. Review now?"
‎
‎
‎
‎They click:
‎
‎> Review
‎
‎
‎
‎That should start:
‎
‎Decay Review Workflow
‎
‎Not Study Prep.
‎
‎And not directly create a generic Adaptive Learning Workflow as the top-level workflow.
‎
‎For example:
‎
‎DECAY REVIEW WORKFLOW
‎
‎identify decayed concepts
‎        ↓
‎prioritize concepts
‎        ↓
‎select review target
‎        ↓
‎review
‎        ↓
‎observe evidence
‎        ↓
‎evaluate retention
‎        ↓
‎reinforce / escalate / complete
‎
‎During the actual review:
‎
‎Decay Review Workflow
‎          │
‎          ▼
‎Adaptive Learning Engine
‎          │
‎          ▼
‎diagnose retention
‎          ↓
‎choose retrieval strategy
‎          ↓
‎practice
‎          ↓
‎evaluate
‎          ↓
‎update learner model
‎
‎So decay has its own workflow, while reusing the same adaptive learning machinery.
‎
‎
‎---
‎
‎3. What about "Continue Session"?
‎
‎This one is different again.
‎
‎If the learner started:
‎
‎Study Prep Session #123
‎
‎and left halfway through:
‎
‎Topic Active
‎Water Cycle
‎Diagnostic completed
‎Teach-back required
‎
‎When they click:
‎
‎> Continue Session
‎
‎
‎
‎you do not start a new workflow.
‎
‎You resume:
‎
‎Study Prep Workflow #123
‎
‎at its persisted state.
‎
‎For example:
‎
‎STUDY PREP #123
‎
‎status:
‎topic_active
‎
‎active topic:
‎Water Cycle
‎
‎adaptive state:
‎teach_back_required
‎
‎Then:
‎
‎Continue
‎   ↓
‎load workflow state
‎   ↓
‎load adaptive state
‎   ↓
‎restore context
‎   ↓
‎continue agent loop
‎
‎So:
‎
‎CONTINUE SESSION
‎       │
‎       ▼
‎RESUME EXISTING WORKFLOW
‎       │
‎       ▼
‎existing state
‎       │
‎       ▼
‎continue from there
‎
‎No new Adaptive Learning Workflow is created just because the learner clicked Continue.
‎
‎
‎---
‎
‎4. This gives us an important distinction
‎
‎There are actually three different concepts:
‎
‎A. Workflow
‎
‎Answers:
‎
‎> What kind of learning experience is this?
‎
‎
‎
‎Examples:
‎
‎Study Prep
‎Decay Review
‎Teaching
‎Practice
‎Free Learning
‎
‎
‎---
‎
‎B. Adaptive Learning Engine
‎
‎Answers:
‎
‎> How should Akoro adapt what happens next based on evidence about this learner?
‎
‎
‎
‎Examples:
‎
‎learner struggling
‎       ↓
‎different analogy
‎
‎learner understands
‎       ↓
‎advance
‎
‎knowledge decayed
‎       ↓
‎retrieval practice
‎
‎repeated misconception
‎       ↓
‎teach-back
‎
‎
‎---
‎
‎C. Agent Loop
‎
‎Answers:
‎
‎> What does the AI need to do right now to execute the current operation?
‎
‎
‎
‎Context
‎   ↓
‎LLM
‎   ↓
‎Action
‎   ↓
‎Harness
‎   ↓
‎Tool
‎   ↓
‎Observation
‎   ↓
‎LLM
‎
‎These are not the same thing.
‎
‎
‎---
‎
‎5. The architecture I recommend
‎
‎I'd actually rename our previous idea from:
‎
‎> "Adaptive Learning Workflow"
‎
‎
‎
‎to:
‎
‎> Adaptive Learning Engine
‎
‎
‎
‎This will eliminate a lot of your confusion.
‎
‎Then your architecture becomes:
‎
‎AKORO
‎                           │
‎                    WORKFLOW ENGINE
‎                           │
‎          ┌────────────────┼────────────────┐
‎          │                │                │
‎          ▼                ▼                ▼
‎     STUDY PREP       DECAY REVIEW      TEACHING
‎      WORKFLOW          WORKFLOW        WORKFLOW
‎          │                │                │
‎          └────────────────┼────────────────┘
‎                           │
‎                           ▼
‎                  ADAPTIVE LEARNING
‎                       ENGINE
‎                           │
‎                 ┌─────────┼─────────┐
‎                 ▼         ▼         ▼
‎              Evidence   Strategy   Mastery
‎                 │         │         │
‎                 └─────────┼─────────┘
‎                           ▼
‎                      Agent Loop
‎                           │
‎                           ▼
‎                       Harness
‎                           │
‎                           ▼
‎                         Tools
‎
‎That's much clearer.
‎
‎
‎---
‎
‎6. Then what is the "adaptive workflow" we were discussing?
‎
‎It isn't necessarily a user-facing workflow.
‎
‎It's better understood as the adaptive decision cycle inside the engine:
‎
‎OBSERVE
‎   ↓
‎INTERPRET EVIDENCE
‎   ↓
‎SELECT STRATEGY
‎   ↓
‎ACT
‎   ↓
‎OBSERVE
‎   ↓
‎EVALUATE
‎   ↓
‎ADAPT
‎
‎It can happen inside any learning workflow.
‎
‎For example:
‎
‎Study Prep
‎
‎Study Prep Workflow
‎       ↓
‎Adaptive cycle
‎       ↓
‎next topic
‎
‎Decay Review
‎
‎Decay Review Workflow
‎       ↓
‎Adaptive cycle
‎       ↓
‎knowledge restored
‎
‎Teaching
‎
‎Teaching Workflow
‎       ↓
‎Adaptive cycle
‎       ↓
‎learner demonstrates understanding
‎
‎
‎---
‎
‎7. And this answers your "same workflow?" question
‎
‎No.
‎
‎Not all three should use the same top-level workflow.
‎
‎They share the same workflow infrastructure and same adaptive learning engine.
‎
‎Think of it like this:
‎
‎WORKFLOW ENGINE
‎                       │
‎          ┌────────────┼─────────────┐
‎          │            │             │
‎          ▼            ▼             ▼
‎       Study          Decay       Teaching
‎        Prep          Review
‎       Workflow      Workflow     Workflow
‎          │            │             │
‎          └────────────┼─────────────┘
‎                       │
‎                       ▼
‎               Adaptive Learning
‎                    Engine
‎                       │
‎                       ▼
‎                 Agent Loop
‎                       │
‎                       ▼
‎                   Harness
‎                       │
‎                       ▼
‎                    Tools
‎
‎And Continue isn't another workflow at all:
‎
‎Continue
‎   ↓
‎find existing workflow
‎   ↓
‎restore state
‎   ↓
‎resume it
‎
‎
‎---
‎
‎The terminology I'd lock in now
‎
‎To avoid us getting confused again, I'd use these terms going forward:
‎
‎1. Workflow
‎
‎The user-facing/domain learning journey.
‎
‎Study Prep
‎Decay Review
‎Teaching
‎Practice
‎
‎2. Workflow Engine
‎
‎The generic infrastructure that runs all those workflows.
‎
‎3. Adaptive Learning Engine
‎
‎The shared intelligence/policy layer that adapts learning based on evidence.
‎
‎4. Agent Loop
‎
‎The LLM's context → action → observation execution cycle.
‎
‎5. Context Manager
‎
‎Determines what the LLM sees for the current operation.
‎
‎6. Education Engine
‎
‎Deterministically determines things like score, evidence, mastery, thresholds, and valid learning outcomes.
‎
‎That separation is, in my view, much cleaner than calling the whole adaptive layer another workflow.
‎
