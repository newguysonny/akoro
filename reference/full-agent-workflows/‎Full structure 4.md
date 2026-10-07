‎Full structure 4
‎
‎Yes. With this upgrade, I would change the architecture again slightly, because your actual learner app reveals something important that the previous abstraction hid.
‎
‎I reviewed the learner frontend and the backend flow in the uploaded project. The current app confirms what you're describing:
‎
‎TeachAgentModal currently opens a live teaching session directly through start_adaptive_session.
‎
‎DecaySessionModal does the same, with mode: "decay".
‎
‎The dashboard already has a Sessions/Revisions surface and can reopen/continue teaching.
‎
‎The backend currently has a unified WebSocket handler where fresh, continuation, and decay all enter start_adaptive_session.
‎
‎adaptive_sessions already persists teaching transcripts/progress for continuation. 
‎
‎
‎So your proposed change is actually a better separation of concerns.
‎
‎The key change
‎
‎I would make:
‎
‎> A Teaching Session and a Study-Prep Session two separate durable workflows.
‎
‎
‎
‎And when Study Prep decides:
‎
‎> "This learner needs teach-back."
‎
‎
‎
‎it doesn't perform the teaching itself.
‎
‎It asks the Workflow Engine to:
‎
‎> Create a Teaching Session.
‎
‎
‎
‎Then the learner can leave Study Prep, go to the Dashboard, and continue that Teaching Session.
‎
‎When the Teaching Session eventually finishes, it writes its outcome back to the Study-Prep session.
‎
‎That gives us this:
‎
‎AKORO WORKFLOW ENGINE
‎                                  │
‎             ┌────────────────────┼────────────────────┐
‎             │                    │                    │
‎             ▼                    ▼                    ▼
‎       STUDY-PREP            TEACHING             DECAY-REVIEW
‎        WORKFLOW              WORKFLOW              WORKFLOW
‎             │                    │                    │
‎             │                    │                    │
‎             └──────────────┐     │     ┌──────────────┘
‎                            ▼     ▼     ▼
‎                       ADAPTIVE LEARNING
‎                            ENGINE
‎
‎But there is one more important relationship:
‎
‎Study Prep
‎    │
‎    │ "teach-back required"
‎    ▼
‎CREATE TEACHING SESSION
‎    │
‎    ▼
‎Teaching Session persisted
‎    │
‎    ├── learner leaves Study Prep
‎    │
‎    ├── goes Dashboard
‎    │
‎    └── continues Teaching Session
‎                │
‎                ▼
‎          Teaching complete
‎                │
‎                ▼
‎       outcome returned to
‎       original Study-Prep
‎                │
‎                ▼
‎             RETEST
‎                │
‎                ▼
‎        Study Prep continues
‎
‎That is the architecture I would use.
‎
‎
‎---
‎
‎1. The most important concept: Study Prep owns the learning journey
‎
‎Suppose the learner starts:
‎
‎> Prepare me for my JSS1 Basic Science exam.
‎
‎
‎
‎That's:
‎
‎STUDY PREP WORKFLOW #SP123
‎
‎It goes:
‎
‎planning
‎   ↓
‎awaiting_confirmation
‎   ↓
‎topic_active
‎   ↓
‎diagnostic
‎   ↓
‎evaluation
‎
‎Suppose Water Cycle gets:
‎
‎3 / 5
‎60%
‎
‎The Study-Prep Education Engine says:
‎
‎NOT PASSED
‎
‎The adaptive decision says:
‎
‎teach_back
‎
‎Now instead of opening a teaching chat inside Study Prep:
‎
‎❌ Study Prep
‎      ↓
‎      Teach Back UI
‎      ↓
‎      continue inside same chat
‎
‎we do:
‎
‎✅ Study Prep
‎      ↓
‎      create Teaching Session
‎      ↓
‎      pause/block topic
‎      ↓
‎      wait for teaching completion
‎
‎
‎---
‎
‎2. The Study-Prep state becomes something like this
‎
‎Your current:
‎
‎topic_active
‎
‎isn't enough once the learner can leave the study workflow.
‎
‎I'd make the topic/run state explicit:
‎
‎TOPIC_ACTIVE
‎    │
‎    ├── diagnostic_ready
‎    │
‎    ├── practice
‎    │
‎    ├── evaluation
‎    │
‎    └── intervention_required
‎              │
‎              ▼
‎        TEACHING_REQUIRED
‎              │
‎              ▼
‎        TEACHING_SESSION_CREATED
‎              │
‎              ▼
‎        AWAITING_TEACHING
‎              │
‎              ▼
‎        TEACHING_COMPLETED
‎              │
‎              ▼
‎        RETEST_READY
‎              │
‎              ▼
‎        RETEST
‎              │
‎              ▼
‎        EVALUATION
‎
‎The important state is:
‎
‎awaiting_teaching
‎
‎It means:
‎
‎> Study Prep cannot proceed until the external Teaching Session produces its required outcome.
‎
‎
‎
‎
‎---
‎
‎3. The Study-Prep chat can remain alive
‎
‎This is where your idea gets really interesting.
‎
‎Suppose the learner is chatting with the Study-Prep agent:
‎
‎Learner:
‎"Prepare me for my exam."
‎
‎Study Prep Agent:
‎"Let's start with Water Cycle..."
‎
‎Then diagnostic fails.
‎
‎The agent might say:
‎
‎> "I found that evaporation and transpiration are still getting mixed up. I've created a short teaching session for you. You can complete it from your Teaching dashboard."
‎
‎
‎
‎Now the Study-Prep chat session remains associated with SP123.
‎
‎It does not need to remain actively streaming.
‎
‎It's a durable workflow.
‎
‎STUDY PREP #SP123
‎status = awaiting_teaching
‎
‎The learner can leave.
‎
‎
‎---
‎
‎4. Dashboard creates the UI entry
‎
‎The Teaching Session should become a first-class dashboard object.
‎
‎For example:
‎
‎┌─────────────────────────────────────┐
‎│ 🧠 Teaching Session                 │
‎│                                     │
‎│ Water Cycle                         │
‎│ Focus: Evaporation vs Transpiration │
‎│                                     │
‎│ Created from: Basic Science Study   │
‎│ Prep                                │
‎│                                     │
‎│ [Continue Teaching]                 │
‎└─────────────────────────────────────┘
‎
‎This is much better than making the learner stay inside the Study-Prep chat.
‎
‎
‎---
‎
‎5. This means we need a relationship between workflows
‎
‎This is the architectural upgrade.
‎
‎The Teaching Session needs to know:
‎
‎created_by_workflow
‎
‎and:
‎
‎source_workflow_id
‎
‎For example:
‎
‎Teaching Session
‎----------------
‎id: TS456
‎
‎workflow_type:
‎    teaching
‎
‎source:
‎    study_prep
‎
‎source_workflow_id:
‎    SP123
‎
‎source_topic_id:
‎    TOP789
‎
‎source_reason:
‎    teach_back
‎
‎strategy:
‎    teach_back
‎
‎Then when Teaching completes:
‎
‎TS456
‎   │
‎   ▼
‎Study Prep SP123
‎   │
‎   ▼
‎TOP789
‎   │
‎   ▼
‎retest_ready
‎
‎That's the missing relationship.
‎
‎
‎---
‎
‎6. This is better than making Teaching a "sub-workflow"
‎
‎I want to slightly correct something from our previous discussion.
‎
‎Previously we said:
‎
‎Study Prep
‎   ↓
‎Teaching sub-workflow
‎
‎That works if teaching happens synchronously inside the same execution.
‎
‎But your new requirement makes Teaching independently resumable.
‎
‎Therefore I would now treat it as a:
‎
‎> First-class workflow with a parent/source relationship.
‎
‎
‎
‎So:
‎
‎Study Prep Workflow
‎       │
‎       │ creates
‎       ▼
‎Teaching Workflow
‎       │
‎       │ learner may leave
‎       │
‎       │ learner returns later
‎       ▼
‎Teaching Workflow completes
‎       │
‎       ▼
‎Study Prep resumes
‎
‎That's much cleaner.
‎
‎
‎---
‎
‎7. And Decay becomes the same kind of first-class workflow
‎
‎Your current frontend confirms decay is directly UI-triggered.
‎
‎DecaySessionModal currently does:
‎
‎start_adaptive_session
‎mode = "decay"
‎
‎and then immediately starts the live WebSocket experience.
‎
‎I would change that.
‎
‎Instead:
‎
‎Decay alert
‎    ↓
‎[Review]
‎    ↓
‎Create Decay Review Workflow
‎    ↓
‎Dashboard / active sessions
‎    ↓
‎Continue Review
‎
‎So:
‎
‎DECAY REVIEW #DR456
‎
‎status:
‎ready
‎
‎topic:
‎Photosynthesis
‎
‎reason:
‎knowledge_decay
‎
‎target:
‎photosynthesis
‎
‎priority:
‎high
‎
‎Then learner presses:
‎
‎> Start Review
‎
‎
‎
‎and the workflow runs.
‎
‎
‎---
‎
‎8. But there is an important distinction between Teaching and Decay
‎
‎Teaching is often created by another workflow.
‎
‎For example:
‎
‎Study Prep
‎   ↓
‎Teach Back Required
‎   ↓
‎Teaching Session
‎
‎Decay is normally triggered by the learner/decay system:
‎
‎Decay Engine
‎   ↓
‎Decay Alert
‎   ↓
‎Learner clicks Review
‎   ↓
‎Decay Review Workflow
‎
‎So the origins differ.
‎
‎But both become first-class durable workflows.
‎
‎
‎---
‎
‎9. Continue becomes extremely simple
‎
‎Now "Continue Session" is no longer ambiguous.
‎
‎The dashboard receives:
‎
‎workflow_type
‎workflow_id
‎status
‎
‎For example:
‎
‎SP123
‎workflow_type = study_prep
‎status = awaiting_teaching
‎
‎or:
‎
‎TS456
‎workflow_type = teaching
‎status = active
‎
‎or:
‎
‎DR789
‎workflow_type = decay_review
‎status = paused
‎
‎The dashboard simply says:
‎
‎Continue
‎   ↓
‎workflow engine
‎   ↓
‎load workflow
‎   ↓
‎restore state
‎   ↓
‎open appropriate UI
‎
‎It doesn't ask:
‎
‎> "Is this adaptive learning?"
‎
‎
‎
‎It asks:
‎
‎> "What workflow is this?"
‎
‎
‎
‎
‎---
‎
‎10. This also solves your current frontend problem
‎
‎Right now you have logic like:
‎
‎if (decay) {
‎    setDecaySession(decay);
‎} else if (s.hasHistory && s.type === "agent") {
‎    setTeachSession({
‎        ...s,
‎        mode: "continuation"
‎    });
‎} else {
‎    ...
‎}
‎
‎That's essentially the frontend trying to infer workflow type from session properties.
‎
‎I'd eventually replace that with a proper workflow descriptor:
‎
‎{
‎  id: "TS456",
‎
‎  workflowType: "teaching",
‎
‎  status: "active",
‎
‎  topic: "Water Cycle",
‎
‎  source: {
‎    type: "study_prep",
‎    workflowId: "SP123",
‎    topicId: "TOP789"
‎  },
‎
‎  continuation: {
‎    available: true
‎  }
‎}
‎
‎Then:
‎
‎switch (session.workflowType) {
‎  case "study_prep":
‎    openStudyPrep(session);
‎    break;
‎
‎  case "teaching":
‎    openTeaching(session);
‎    break;
‎
‎  case "decay_review":
‎    openDecayReview(session);
‎    break;
‎}
‎
‎Much cleaner.
‎
‎
‎---
‎
‎11. Your current adaptive_sessions becomes a problem
‎
‎This is one thing I would change carefully.
‎
‎Currently your teaching and decay flows are heavily tied to:
‎
‎edu.adaptive_sessions
‎
‎And the current WebSocket handler even says:
‎
‎start_adaptive_session — UNIFIED handler for all 3 modes
‎mode: fresh | continuation | decay
‎
‎That was convenient.
‎
‎But under your new architecture, I would stop treating those as three modes of one workflow.
‎
‎Instead:
‎
‎edu.workflow_instances
‎
‎could become the generic workflow identity.
‎
‎Then domain-specific tables hold details.
‎
‎For example:
‎
‎workflow_instances
‎------------------
‎id
‎learner_id
‎workflow_type
‎status
‎parent_workflow_id
‎created_by
‎created_at
‎updated_at
‎
‎Then:
‎
‎study_prep_sessions
‎-------------------
‎workflow_id
‎scope
‎active_topic
‎plan
‎...
‎
‎teaching_sessions
‎-----------------
‎workflow_id
‎topic
‎subject
‎source_workflow_id
‎source_topic_id
‎strategy
‎...
‎
‎decay_review_sessions
‎---------------------
‎workflow_id
‎topic
‎subject
‎decay_reason
‎confidence_before
‎...
‎
‎You don't necessarily need to do this immediately, but this is the direction I'd design toward.
‎
‎
‎---
‎
‎12. The workflow hierarchy now becomes very powerful
‎
‎Imagine:
‎
‎STUDY PREP #SP123
‎│
‎├── Topic: Water Cycle
‎│   │
‎│   ├── Diagnostic
‎│   │
‎│   └── Teaching Session #TS001
‎│       │
‎│       └── completed
‎│   │
‎│   └── Retest
‎│
‎├── Topic: Photosynthesis
‎│   │
‎│   └── Diagnostic → passed
‎│
‎└── Topic: Energy
‎    │
‎    ├── Diagnostic
‎    │
‎    └── Teaching Session #TS002
‎        │
‎        └── learner continues later
‎
‎And independently:
‎
‎DECAY REVIEW #DR001
‎│
‎└── Photosynthesis
‎    │
‎    └── Retrieval Practice
‎
‎This is much closer to a real learning operating system.
‎
‎
‎---
‎
‎13. Where the Adaptive Learning Engine sits now
‎
‎It becomes even cleaner.
‎
‎It doesn't own the sessions.
‎
‎It provides decision intelligence to workflows.
‎
‎For example:
‎
‎Study Prep asks
‎
‎"Diagnostic = 60%.
‎Previous misconception exists.
‎What intervention is appropriate?"
‎
‎Adaptive Learning Engine:
‎
‎teach_back
‎
‎Study Prep then:
‎
‎create Teaching Workflow
‎
‎
‎---
‎
‎Decay Review asks
‎
‎"Confidence dropped from 82% → 49%.
‎What should we do?"
‎
‎Adaptive Learning Engine:
‎
‎retrieval_practice
‎
‎Decay Review executes it.
‎
‎
‎---
‎
‎Teaching asks
‎
‎"Student repeatedly fails to explain this concept."
‎
‎Adaptive Learning Engine:
‎
‎different_analogy
‎
‎Teaching Workflow executes it.
‎
‎So:
‎
‎WORKFLOW
‎                │
‎                ▼
‎       ADAPTIVE DECISION
‎                │
‎                ▼
‎         selected strategy
‎                │
‎                ▼
‎       workflow executes it
‎
‎Not:
‎
‎Adaptive Engine
‎     ↓
‎owns everything
‎
‎
‎---
‎
‎14. And the Agent Loop remains inside each workflow
‎
‎For Study Prep:
‎
‎Study Prep Workflow
‎       ↓
‎operation = planning
‎       ↓
‎Context Manager
‎       ↓
‎Agent Loop
‎       ↓
‎Harness
‎
‎For Teaching:
‎
‎Teaching Workflow
‎       ↓
‎operation = teaching
‎       ↓
‎Context Manager
‎       ↓
‎Agent Loop
‎       ↓
‎Teaching tools
‎
‎For Decay:
‎
‎Decay Review Workflow
‎       ↓
‎operation = retrieval
‎       ↓
‎Context Manager
‎       ↓
‎Agent Loop
‎       ↓
‎Retrieval tools
‎
‎So the same Agent Loop infrastructure can be reused.
‎
‎
‎---
‎
‎15. Your new architecture
‎
‎I would now lock the architecture as:
‎
‎AKORO
‎                           │
‎                           ▼
‎                    WORKFLOW ENGINE
‎                           │
‎       ┌───────────────────┼────────────────────┐
‎       │                   │                    │
‎       ▼                   ▼                    ▼
‎  STUDY PREP           TEACHING            DECAY REVIEW
‎   WORKFLOW             WORKFLOW             WORKFLOW
‎       │                   │                    │
‎       │                   │                    │
‎       │                   │                    │
‎       ▼                   ▼                    ▼
‎  diagnostics          teach learner       retrieve/review
‎  planning             teach-back          restore knowledge
‎  retest               assessment          retention
‎       │                   │                    │
‎       └───────────────────┼────────────────────┘
‎                           ▼
‎                 ADAPTIVE LEARNING ENGINE
‎                           │
‎                 ┌─────────┼──────────┐
‎                 ▼         ▼          ▼
‎              evidence  strategy    mastery
‎                 │         │          │
‎                 └─────────┼──────────┘
‎                           ▼
‎                      AGENT LOOP
‎                           │
‎                    ┌──────┴──────┐
‎                    ▼             ▼
‎                 CONTEXT       HARNESS
‎                 MANAGER          │
‎                                  ▼
‎                                TOOLS
‎
‎And underneath:
‎
‎LEARNER MODEL
‎                      ▲
‎                      │
‎             Education Engine
‎                      ▲
‎                      │
‎                 Workflows
‎
‎
‎---
‎
‎16. The really important new relationship
‎
‎Your new design introduces:
‎
‎workflow → creates workflow
‎
‎But not arbitrary workflow creation by the LLM.
‎
‎For example:
‎
‎Study Prep
‎     │
‎     │ deterministic policy says:
‎     │ intervention = teach_back
‎     ▼
‎Workflow Engine
‎     │
‎     ▼
‎createTeachingSession({
‎    sourceWorkflowId: SP123,
‎    sourceTopicId: TOP789,
‎    reason: "teach_back",
‎    strategy: "teach_back"
‎})
‎
‎The LLM can recommend:
‎
‎{
‎  "strategy": "teach_back"
‎}
‎
‎but the Study-Prep harness decides whether creating a teaching session is allowed.
‎
‎That's very important for your production architecture.
‎
‎
‎---
‎
‎17. When Teaching completes
‎
‎This is the part I'd make extremely explicit.
‎
‎Teaching shouldn't just say:
‎
‎status = complete
‎
‎It should produce a workflow outcome.
‎
‎Something like:
‎
‎{
‎  "workflowId": "TS456",
‎  "status": "completed",
‎
‎  "outcome": {
‎    "objectiveEvidence": [
‎      {
‎        "conceptId": "evaporation",
‎        "status": "demonstrated"
‎      },
‎      {
‎        "conceptId": "transpiration",
‎        "status": "demonstrated"
‎      }
‎    ],
‎
‎    "strategyUsed": "teach_back",
‎
‎    "recommendedNextAction": "retest"
‎  },
‎
‎  "source": {
‎    "workflowId": "SP123",
‎    "topicId": "TOP789"
‎  }
‎}
‎
‎Then the Workflow Engine emits:
‎
‎TEACHING_COMPLETED
‎
‎Study Prep receives that event:
‎
‎Study Prep
‎   ↓
‎TEACHING_COMPLETED
‎   ↓
‎validate outcome
‎   ↓
‎RETEST_READY
‎
‎Now the learner can continue the Study-Prep session.
‎
‎
‎---
‎
‎18. The user experience becomes excellent
‎
‎The learner experience becomes:
‎
‎Start
‎
‎Prepare me for my exam
‎        ↓
‎Study Prep
‎        ↓
‎Water Cycle
‎        ↓
‎Diagnostic
‎        ↓
‎"You need a little more work here."
‎        ↓
‎"Teaching session created."
‎
‎They can leave.
‎
‎Dashboard:
‎
‎📚 Study Prep
‎Basic Science
‎Waiting for teaching session
‎
‎🧠 Teaching
‎Water Cycle
‎Teach-back required
‎
‎[Continue]
‎
‎They tap:
‎
‎Continue Teaching
‎
‎Teaching UI opens.
‎
‎They teach their AI.
‎
‎Teaching completes.
‎
‎Dashboard:
‎
‎🧠 Teaching
‎Water Cycle
‎✓ Complete
‎
‎📚 Study Prep
‎Basic Science
‎Retest ready
‎
‎[Continue Study]
‎
‎They tap:
‎
‎Continue Study
‎
‎Study Prep opens:
‎
‎Retest: Water Cycle
‎
‎Then:
‎
‎5/5
‎100%
‎
‎→ Next Topic
‎
‎That is a very coherent product experience.
‎
‎
‎---
‎
‎19. What happens to the Study-Prep chat?
‎
‎It stays.
‎
‎But its role changes slightly.
‎
‎It becomes the Study-Prep workflow's conversational interface, not the place where every learning activity must physically happen.
‎
‎So the chat can say:
‎
‎> "I've created a teaching session for Water Cycle. Continue it from your Dashboard."
‎
‎
‎
‎And later:
‎
‎> "Your teaching session is complete. You're ready for the Water Cycle retest."
‎
‎
‎
‎The chat is therefore connected to the workflow, but doesn't own the Teaching UI.
‎
‎That's exactly the separation I think you are looking for.
‎
‎
‎---
‎
‎20. Final terminology I would now lock
‎
‎I would use these terms from now on:
‎
‎Workflow Engine
‎
‎Runs durable user-facing learning journeys.
‎
‎Study Prep
‎Teaching
‎Decay Review
‎Practice
‎
‎Study-Prep Workflow
‎
‎Owns the exam-preparation journey.
‎
‎Teaching Workflow
‎
‎Owns a learner-created/learner-completed teaching session.
‎
‎Decay Review Workflow
‎
‎Owns knowledge-retention/review sessions.
‎
‎Adaptive Learning Engine
‎
‎Shared decision/evidence/strategy machinery.
‎
‎Agent Loop
‎
‎LLM execution cycle inside a workflow operation.
‎
‎Context Manager
‎
‎Builds context for that agent decision.
‎
‎Education Engine
‎
‎Determines authoritative educational outcomes.
‎
‎Workflow Relationship
‎
‎Connects workflows:
‎
‎Study Prep
‎    │
‎    └── creates ──→ Teaching
‎                         │
‎                         └── outcome ──→ Study Prep
‎
‎
‎---
‎
‎And this changes our implementation priority
‎
‎I would not generalize the existing start_adaptive_session(mode: fresh|continuation|decay) as-is.
‎
‎That's now the old architecture.
‎
‎Instead, I'd first introduce a generic concept:
‎
‎createWorkflow()
‎resumeWorkflow()
‎pauseWorkflow()
‎completeWorkflow()
‎emitWorkflowOutcome()
‎
‎Then:
‎
‎createStudyPrepWorkflow()
‎createTeachingWorkflow()
‎createDecayReviewWorkflow()
‎
‎And the existing WebSocket start_adaptive_session becomes a transport mechanism for opening a Teaching Workflow, rather than being the workflow itself.
‎
‎That is the upgrade I would make to your current codebase. It aligns the backend with what the learner frontend is actually trying to do, while preserving your existing WebSocket teaching experience and allowing Study Prep to remain alive in the background waiting for the Teaching Workflow to finish.
‎
