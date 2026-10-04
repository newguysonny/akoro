‎Full structure 2
‎
‎I mapped the uploaded akoro-api codebase against the architecture we discussed. The conclusion is quite clear:
‎
‎> You do not need to build a new workflow engine from scratch.
‎
‎You already have the beginnings of one in study-prep/state-machine.js, study-prep/harness.js, study-prep/agent-loop.js, study-prep/events.js, and study-prep/store.js.
‎
‎What you need is to promote those pieces into a reusable Adaptive Workflow Engine, then make Study-Prep, Teaching, Decay Review, and eventually other learning experiences use it.
‎
‎
‎
‎There is also an important issue: the codebase currently has two overlapping adaptive workflow systems. That's what we should clean up.
‎
‎
‎---
‎
‎1. Current architecture I found
‎
‎Right now the adaptive-learning module roughly looks like this:
‎
‎modules/adaptive-learning/
‎│
‎├── adaptive-workflows.js              ← Workflow projection
‎├── workflow-state.js                  ← Older/simple workflow state machine
‎│
‎├── study-prep/
‎│   ├── state-machine.js               ← Strong session/topic state machine
‎│   ├── harness.js                     ← Strong execution/authority layer
‎│   ├── agent-loop.js                  ← Agent loop
‎│   ├── llm-agent.js                   ← LLM adapter
‎│   ├── context-manager.js             ← SHIM → platform Context Manager
‎│   ├── education-engine.js            ← Deterministic learning engine
‎│   ├── events.js                      ← Observable events
‎│   ├── store.js                       ← Persistence
‎│   ├── read-tools.js                  ← Read tools
‎│   ├── wiring.js                      ← Composition root
‎│   ├── syllabus-resolver.js           ← Curriculum tool
‎│   └── workflow-grouping.js           ← UI projection
‎│
‎├── teaching-workflow/
‎│   ├── runner.js                      ← Fixed sub-workflow
‎│   ├── catalog.js
‎│   └── tools.js
‎│
‎├── agents/
‎│   ├── student/
‎│   │   ├── agent.js                   ← Student/Protégé LLM
‎│   │   ├── knowledge.js               ← Knowledge/RAG
‎│   │   ├── decayEngine.js             ← Decay/review
‎│   │   └── orchestrator.js
‎│   │
‎│   ├── nana-esumai/
‎│   │   ├── guide.js                   ← Teaching guide
‎│   │   └── orchestrator.js
‎│   │
‎│   └── sargeant/
‎│       ├── assessment.js               ← Assessment
‎│       └── proctor.js                 ← Boundary/proctoring
‎│
‎├── student-state.js                   ← Older cognitive state
‎├── teaching-evidence.js               ← Teaching evidence policy
‎├── lessonLadder.js                    ← Curriculum ladder
‎├── exam-prep-service.js               ← Exam-specific workflow
‎└── assessmentGateway.js
‎
‎And separately:
‎
‎modules/agent-context/
‎├── context-manager.js
‎├── manifest.mjs
‎└── personas/
‎
‎That Context Layer is already in a good position.
‎
‎
‎---
‎
‎2. The most important finding: you already have an engine
‎
‎Your strongest implementation is currently here:
‎
‎study-prep/
‎├── state-machine.js
‎├── harness.js
‎├── agent-loop.js
‎├── events.js
‎├── store.js
‎├── education-engine.js
‎└── wiring.js
‎
‎These aren't merely Study-Prep features.
‎
‎They are generic workflow infrastructure disguised as Study-Prep infrastructure.
‎
‎For example:
‎
‎agent-loop.js
‎
‎Already implements:
‎
‎Context
‎   ↓
‎LLM
‎   ↓
‎ONE structured action
‎   ↓
‎Harness
‎   ↓
‎Tool
‎   ↓
‎Observation
‎   ↓
‎LLM
‎
‎That's your Adaptive Agent Loop.
‎
‎
‎---
‎
‎harness.js
‎
‎Already implements:
‎
‎LLM proposes
‎     ↓
‎validate
‎     ↓
‎permission
‎     ↓
‎state check
‎     ↓
‎execute
‎     ↓
‎persist
‎     ↓
‎event
‎
‎That's your Workflow Harness.
‎
‎
‎---
‎
‎state-machine.js
‎
‎Already implements:
‎
‎valid states
‎+
‎valid transitions
‎+
‎policy
‎+
‎attempt limits
‎+
‎gates
‎
‎That's your Workflow State Engine.
‎
‎
‎---
‎
‎events.js
‎
‎Already implements:
‎
‎agent intent
‎harness decision
‎observation
‎human gate
‎engine result
‎
‎That's your Observable Workflow Event System.
‎
‎
‎---
‎
‎store.js
‎
‎Already implements:
‎
‎durable state
‎conditional writes
‎events
‎topics
‎mastery evidence
‎coins
‎
‎That's your Workflow Persistence Layer.
‎
‎So the architecture is already emerging.
‎
‎
‎---
‎
‎3. What is currently wrong
‎
‎The biggest problem isn't missing code.
‎
‎It's responsibility fragmentation.
‎
‎You currently have:
‎
‎adaptive-workflows.js
‎        +
‎workflow-state.js
‎        +
‎exam-prep-service.js
‎        +
‎study-prep/state-machine.js
‎        +
‎study-prep/harness.js
‎        +
‎adaptive_sessions
‎        +
‎student-state.js
‎        +
‎teaching-workflow/runner.js
‎
‎all participating in different pieces of "adaptive learning."
‎
‎That makes the architecture harder to reason about.
‎
‎
‎---
‎
‎4. Current adaptive-workflows.js should NOT remain the main engine
‎
‎Current:
‎
‎modules/adaptive-learning/adaptive-workflows.js
‎
‎contains:
‎
‎startExamPrepWorkflow()
‎transitionExamPrepWorkflow()
‎listLearnerWorkflows()
‎
‎and states:
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
‎This is actually a workflow projection specifically for exam prep.
‎
‎It should eventually become something like:
‎
‎workflow/projections.js
‎
‎or be absorbed into the new workflow persistence layer.
‎
‎Keep
‎
‎Its idea of:
‎
‎durable public workflow status
‎workflow steps
‎learner-owned projection
‎
‎is good.
‎
‎Change
‎
‎Don't let it own the actual workflow transition logic.
‎
‎The authoritative transition should happen in the workflow engine.
‎
‎
‎---
‎
‎5. workflow-state.js is the older state machine
‎
‎Current:
‎
‎modules/adaptive-learning/workflow-state.js
‎
‎has:
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
‎This is essentially the old exam-prep workflow state machine.
‎
‎Meanwhile:
‎
‎study-prep/state-machine.js
‎
‎has the newer:
‎
‎SESSION_STATES
‎TOPIC_STATES
‎POLICY
‎validatePlan()
‎canTransitionSession()
‎canTransitionTopic()
‎...
‎
‎The second one is much more mature.
‎
‎Recommendation
‎
‎Don't keep two generic-looking workflow state machines.
‎
‎Eventually:
‎
‎workflow-state.js
‎
‎should be deprecated/absorbed.
‎
‎The reusable engine should own the state-transition mechanism.
‎
‎The actual workflow definition should provide the states.
‎
‎
‎---
‎
‎6. The future should look like this
‎
‎Instead of hardcoding:
‎
‎const SESSION_STATES = [...]
‎
‎inside Study-Prep infrastructure, move toward:
‎
‎workflow/
‎├── engine.js
‎├── state-machine.js
‎├── harness.js
‎├── events.js
‎├── registry.js
‎├── store.js
‎└── definitions/
‎    ├── study-prep.js
‎    ├── adaptive-learning.js
‎    ├── teaching.js
‎    └── decay-review.js
‎
‎Conceptually:
‎
‎const adaptiveLearningWorkflow = {
‎  id: "adaptive_learning",
‎  version: "v1",
‎
‎  states: [
‎    "context_resolution",
‎    "diagnostic",
‎    "evidence_analysis",
‎    "strategy_selection",
‎    "intervention",
‎    "practice",
‎    "observation",
‎    "evaluation",
‎    "completed",
‎    "flagged_gap"
‎  ],
‎
‎  transitions: {
‎    context_resolution: ["diagnostic"],
‎    diagnostic: ["evidence_analysis"],
‎    evidence_analysis: ["strategy_selection"],
‎    strategy_selection: ["intervention", "practice"],
‎    intervention: ["observation"],
‎    practice: ["observation"],
‎    observation: ["evaluation"],
‎    evaluation: [
‎      "completed",
‎      "strategy_selection",
‎      "flagged_gap"
‎    ]
‎  }
‎};
‎
‎The engine executes this definition.
‎
‎
‎---
‎
‎7. Study-Prep should become one workflow definition
‎
‎Your canonical Study-Prep state machine remains:
‎
‎planning
‎    ↓
‎awaiting_confirmation
‎    ↓
‎topic_active
‎    ↓
‎replanning
‎    ↓
‎completed
‎
‎So:
‎
‎workflow/definitions/study-prep.js
‎
‎would own those states.
‎
‎But when:
‎
‎topic_active
‎
‎starts, it invokes:
‎
‎Adaptive Learning Workflow
‎
‎
‎---
‎
‎8. This gives us workflow composition
‎
‎This is probably the most important architectural improvement.
‎
‎Instead of:
‎
‎Study Prep = everything
‎
‎you get:
‎
‎STUDY PREP WORKFLOW
‎        │
‎        ├── Topic 1
‎        │      │
‎        │      └── ADAPTIVE LEARNING WORKFLOW
‎        │
‎        ├── Topic 2
‎        │      │
‎        │      └── ADAPTIVE LEARNING WORKFLOW
‎        │
‎        └── Topic 3
‎               │
‎               └── ADAPTIVE LEARNING WORKFLOW
‎
‎Then Adaptive Learning can invoke sub-workflows:
‎
‎Adaptive Learning
‎       │
‎       ├── diagnostic
‎       │
‎       ├── teaching workflow
‎       │
‎       ├── practice
‎       │
‎       ├── teach-back
‎       │
‎       ├── retrieval
‎       │
‎       └── decay review
‎
‎
‎---
‎
‎9. teaching-workflow/runner.js should remain
‎
‎This one is actually good.
‎
‎Current:
‎
‎modules/adaptive-learning/teaching-workflow/runner.js
‎
‎defines:
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
‎This is a legitimate sub-workflow.
‎
‎I would keep it.
‎
‎But I'd eventually move it conceptually under:
‎
‎workflow/subflows/teaching.js
‎
‎or:
‎
‎workflows/teaching/
‎
‎because it isn't the top-level adaptive workflow.
‎
‎
‎---
‎
‎10. StudentAgent is NOT the workflow
‎
‎This file:
‎
‎agents/student/agent.js
‎
‎should remain an agent/persona/capability.
‎
‎It does:
‎
‎RAG
‎LLM response
‎teaching evidence observation
‎understanding analysis
‎knowledge extraction
‎
‎That's appropriate.
‎
‎It should NOT decide:
‎
‎"Now move the workflow to passed."
‎
‎Instead:
‎
‎StudentAgent
‎    ↓
‎observation
‎    ↓
‎Education Engine / Evidence Validator
‎    ↓
‎workflow transition
‎
‎Exactly as your architecture audit says:
‎
‎> LLM output is observation, not ground truth.
‎
‎
‎
‎
‎---
‎
‎11. knowledge.js belongs to Learner Model / Memory
‎
‎This:
‎
‎agents/student/knowledge.js
‎
‎belongs here:
‎
‎LEARNER MODEL
‎
‎It handles:
‎
‎agent knowledge
‎student knowledge
‎teacher material
‎embeddings
‎retrieval
‎knowledge persistence
‎subject mastery
‎
‎I would leave most of it alone for now.
‎
‎But eventually separate:
‎
‎learner/
‎├── knowledge-store.js
‎├── concept-state.js
‎├── evidence-store.js
‎├── retrieval.js
‎└── profile.js
‎
‎because knowledge.js is becoming too broad.
‎
‎
‎---
‎
‎12. decayEngine.js is Education Engine + Workflow Trigger
‎
‎This one is interesting.
‎
‎Current:
‎
‎agents/student/decayEngine.js
‎
‎does several different jobs:
‎
‎Education logic
‎
‎calculateDecayedConfidence()
‎getPriority()
‎getNextReviewDate()
‎reinforceKnowledge()
‎
‎Workflow triggering
‎
‎generateDecaySession()
‎
‎Automation
‎
‎runDecayScheduler()
‎
‎Notification delivery
‎
‎sendDecayAlert()
‎
‎Those should eventually separate.
‎
‎I'd map it like this:
‎
‎education/
‎    retention-engine.js
‎        calculateDecayedConfidence()
‎        getPriority()
‎        getNextReviewDate()
‎        reinforcement rules
‎
‎automation/
‎    decay-scheduler.js
‎        runDecayScheduler()
‎
‎workflow/
‎    triggers/
‎        decay-review-trigger.js
‎
‎notifications/
‎    decay-notifications.js
‎
‎But don't rewrite it all immediately.
‎
‎First extract the pure decay functions.
‎
‎
‎---
‎
‎13. student-state.js is legacy adaptive state
‎
‎This file is important:
‎
‎modules/adaptive-learning/student-state.js
‎
‎It currently has:
‎
‎cognitive.understanding
‎cognitive.confusion
‎cognitive.engagement
‎knowledge[topic]
‎session.phase
‎session.mustKnowIndex
‎session.turnCount
‎
‎and:
‎
‎decideNextAction()
‎
‎This is a major architectural overlap.
‎
‎Because we now also have:
‎
‎learner_concept_state
‎learner_concept_evidence
‎
‎and:
‎
‎knowledge_confidence
‎
‎and:
‎
‎teaching_evidence
‎
‎So there are too many representations of "what the learner knows."
‎
‎This should eventually be reduced.
‎
‎Especially:
‎
‎decideNextAction()
‎
‎should not remain an independent adaptive brain.
‎
‎Its logic:
‎
‎if misconception → CLEAR_MISTAKE
‎if low understanding → DIG_DEEPER
‎if high confusion → USE_ANALOGY
‎...
‎
‎is exactly the sort of decision policy that belongs in the Adaptive Learning Decision/Education Engine.
‎
‎Otherwise you'll have:
‎
‎student-state.js
‎      ↓
‎decideNextAction()
‎
‎AND
‎
‎adaptive workflow
‎      ↓
‎strategy selection
‎
‎AND
‎
‎LLM
‎      ↓
‎strategy selection
‎
‎Three competing decision-makers.
‎
‎We want one authoritative policy layer.
‎
‎
‎---
‎
‎14. teaching-evidence.js is very valuable
‎
‎Keep:
‎
‎modules/adaptive-learning/teaching-evidence.js
‎
‎This is actually one of the strongest pieces.
‎
‎It defines:
‎
‎coreExplanation
‎application
‎reasoning
‎correction
‎misconception
‎masteryStatus
‎dialogue move
‎pace
‎
‎That is an evidence model.
‎
‎I would eventually rename the conceptual area:
‎
‎education/evidence/teaching-evidence.js
‎
‎but don't change it yet.
‎
‎This should feed:
‎
‎Adaptive Learning Workflow
‎
‎rather than directly controlling it.
‎
‎
‎---
‎
‎15. lessonLadder.js belongs to Curriculum/Context
‎
‎This:
‎
‎lessonLadder.js
‎
‎should NOT be inside the adaptive decision engine.
‎
‎It answers:
‎
‎> What should this topic contain and in what pedagogical order?
‎
‎
‎
‎That's curriculum resolution.
‎
‎So:
‎
‎curriculum/
‎├── syllabus.js
‎├── lesson-ladder.js
‎└── resolver.js
‎
‎Adaptive Learning consumes it.
‎
‎Curriculum
‎     ↓
‎Lesson Ladder
‎     ↓
‎Adaptive Workflow
‎
‎Good separation.
‎
‎
‎---
‎
‎16. exam-prep-service.js is currently doing too much
‎
‎This is another important one.
‎
‎It currently owns:
‎
‎question generation
‎attempt creation
‎submission
‎scoring hookup
‎status transition
‎retest creation
‎workflow projection
‎
‎Some of that belongs in the exam feature.
‎
‎But:
‎
‎nextRunStatus()
‎
‎and the workflow calls:
‎
‎startExamPrepWorkflow()
‎transitionExamPrepWorkflow()
‎
‎show that Exam Prep is currently acting as a workflow engine.
‎
‎Eventually:
‎
‎Exam Prep Service
‎
‎should become a domain adapter:
‎
‎ExamPrep
‎├── generateAttempt()
‎├── submitAttempt()
‎├── getRun()
‎└── retest()
‎
‎while:
‎
‎Adaptive Workflow
‎
‎decides:
‎
‎diagnostic
‎→ intervention
‎→ retest
‎→ evaluation
‎
‎That is a significant improvement.
‎
‎
‎---
‎
‎17. The Education Engine needs to become bigger — but carefully
‎
‎Current:
‎
‎study-prep/education-engine.js
‎
‎contains:
‎
‎scoreAttempt()
‎applyThreshold()
‎topicOutcome()
‎masteryWriteBack()
‎estimateSessionCost()
‎strategy library
‎
‎This is already a good foundation.
‎
‎I'd promote it:
‎
‎modules/adaptive-learning/education/
‎├── assessment-engine.js
‎├── mastery-engine.js
‎├── strategy-policy.js
‎├── retention-engine.js
‎├── evidence-policy.js
‎└── education-engine.js
‎
‎But don't split it into six files prematurely.
‎
‎For now, its conceptual role is:
‎
‎DETERMINISTIC EDUCATION ENGINE
‎
‎and that's exactly what we want.
‎
‎
‎---
‎
‎18. The tools are already in the right direction
‎
‎Current:
‎
‎study-prep/read-tools.js
‎
‎contains things like:
‎
‎learner.get_state
‎learner.get_history
‎learner.get_relevant_memory
‎concept.get_prerequisites
‎syllabus.resolve
‎session.get_state
‎
‎And:
‎
‎tools/registry.js
‎
‎controls what the model can access.
‎
‎That's good.
‎
‎Eventually the registry becomes workflow-aware:
‎
‎Workflow
‎   ↓
‎Operation
‎   ↓
‎Allowed tools
‎   ↓
‎Harness
‎   ↓
‎Execution
‎
‎For example:
‎
‎adaptive_learning / diagnostic
‎    ↓
‎learner.get_state
‎concept.get_prerequisites
‎practice.generate
‎
‎while:
‎
‎adaptive_learning / evaluation
‎    ↓
‎practice.submit
‎learner.get_state
‎
‎And internal things such as:
‎
‎wallet.charge
‎practice.score
‎session.transition
‎evidence.append
‎
‎remain hidden from the model.
‎
‎Keep that boundary.
‎
‎
‎---
‎
‎19. Context is already correctly separated
‎
‎This part is actually ahead of the rest.
‎
‎You already have:
‎
‎modules/agent-context/
‎
‎with:
‎
‎manifest.mjs
‎context-manager.js
‎
‎and sets:
‎
‎planning
‎research
‎teaching
‎reflection
‎strategies
‎safety
‎
‎That's exactly the Context Manager architecture we discussed.
‎
‎And:
‎
‎study-prep/context-manager.js
‎
‎is now only a shim.
‎
‎Keep this.
‎
‎Don't move the context manager back into adaptive-learning.
‎
‎Instead, adaptive workflows should call:
‎
‎contextManager.build(...)
‎
‎with:
‎
‎workflowState
‎operation
‎goal
‎learner
‎topic
‎
‎
‎---
‎
‎20. So the target architecture becomes
‎
‎I would aim for:
‎
‎modules/adaptive-learning/
‎│
‎├── workflows/
‎│   │
‎│   ├── engine.js
‎│   ├── registry.js
‎│   ├── state-machine.js
‎│   ├── harness.js
‎│   ├── events.js
‎│   ├── store.js
‎│   │
‎│   ├── definitions/
‎│   │   ├── adaptive-learning.js
‎│   │   ├── study-prep.js
‎│   │   ├── decay-review.js
‎│   │   └── teaching.js
‎│   │
‎│   └── projections.js
‎│
‎├── agent/
‎│   ├── loop.js
‎│   ├── llm-agent.js
‎│   └── tool-router.js
‎│
‎├── context/
‎│   └── ← use modules/agent-context instead
‎│
‎├── tools/
‎│   ├── registry.js
‎│   ├── syllabus.js
‎│   ├── learner.js
‎│   ├── concepts.js
‎│   ├── practice.js
‎│   └── memory.js
‎│
‎├── education/
‎│   ├── education-engine.js
‎│   ├── evidence.js
‎│   ├── mastery.js
‎│   ├── strategy-policy.js
‎│   └── retention.js
‎│
‎├── curriculum/
‎│   ├── syllabus.js
‎│   └── lesson-ladder.js
‎│
‎├── learner/
‎│   ├── knowledge.js
‎│   ├── concept-state.js
‎│   ├── evidence.js
‎│   └── profile.js
‎│
‎└── subflows/
‎    ├── teaching/
‎    ├── assessment/
‎    ├── practice/
‎    └── retrieval/
‎
‎That's the target.
‎
‎I wouldn't physically move everything yet.
‎
‎
‎---
‎
‎21. Exact migration map
‎
‎Here is how I would classify the current files.
‎
‎Current fileTarget responsibilityAction
‎
‎study-prep/agent-loop.jsAgent LoopPromote/reuse
‎study-prep/llm-agent.jsLLM Agent adapterPromote/reuse
‎study-prep/harness.jsWorkflow HarnessGeneralize
‎study-prep/state-machine.jsWorkflow State MachineGeneralize
‎study-prep/events.jsWorkflow EventsPromote/reuse
‎study-prep/store.jsWorkflow persistenceGeneralize
‎study-prep/education-engine.jsEducation EnginePromote + expand
‎study-prep/read-tools.jsLearning toolsGeneralize
‎study-prep/wiring.jsStudy-Prep compositionKeep
‎study-prep/syllabus-resolver.jsCurriculum toolKeep/move later
‎study-prep/workflow-grouping.jsUI projectionKeep
‎adaptive-workflows.jsOld workflow projectionMerge/deprecate
‎workflow-state.jsOld exam workflow stateDeprecate/merge
‎exam-prep-service.jsExam domain serviceKeep, reduce workflow responsibility
‎teaching-workflow/runner.jsTeaching sub-workflowKeep
‎teaching-workflow/tools.jsTeaching sub-workflow toolsKeep
‎teaching-evidence.jsEvidence modelPromote
‎student-state.jsLegacy learner state/decision logicGradually retire
‎agents/student/agent.jsStudent AgentKeep
‎agents/student/knowledge.jsLearner knowledge/RAGKeep, later split
‎agents/student/decayEngine.jsRetention + automationSplit later
‎agents/student/orchestrator.jsLegacy session orchestratorRefactor toward workflows
‎agents/nana-esumai/guide.jsLearning GuideKeep
‎agents/nana-esumai/orchestrator.jsLegacy orchestrationRefactor
‎agents/sargeant/assessment.jsAssessment JudgeKeep
‎agents/sargeant/proctor.jsBoundary/proctorKeep
‎lessonLadder.jsCurriculumKeep/move later
‎assessmentGateway.jsAssessment domainKeep
‎modules/agent-context/*Context ManagerKeep as platform layer
‎
‎
‎
‎---
‎
‎22. What I would merge
‎
‎There are three major merges.
‎
‎Merge 1
‎
‎adaptive-workflows.js
‎+
‎workflow-state.js
‎
‎into the new workflow infrastructure.
‎
‎But don't just merge their code blindly.
‎
‎The important thing to preserve is:
‎
‎durable workflow status
‎+
‎workflow events
‎+
‎legal transitions
‎
‎
‎---
‎
‎Merge 2
‎
‎Promote:
‎
‎study-prep/state-machine.js
‎study-prep/harness.js
‎study-prep/events.js
‎study-prep/store.js
‎
‎into reusable infrastructure.
‎
‎This is the biggest architectural move.
‎
‎
‎---
‎
‎Merge 3
‎
‎Unify the adaptive decision logic currently spread across:
‎
‎student-state.js
‎exam-prep-service.js
‎teaching-evidence.js
‎decayEngine.js
‎
‎behind the Education Engine.
‎
‎Not necessarily one giant file.
‎
‎Rather:
‎
‎Education Engine
‎      │
‎      ├── assessment policy
‎      ├── mastery policy
‎      ├── evidence policy
‎      ├── strategy policy
‎      └── retention policy
‎
‎
‎---
‎
‎23. What I would NOT merge
‎
‎This is equally important.
‎
‎Don't merge these into the workflow engine:
‎
‎StudentAgent
‎NaNa
‎Sargeant
‎lessonLadder
‎knowledge retrieval
‎OpenAI prompts
‎decay notifications
‎WebSocket handling
‎
‎They are different responsibilities.
‎
‎The workflow engine should orchestrate them.
‎
‎Not become them.
‎
‎
‎---
‎
‎24. The final runtime flow
‎
‎After the refactor, a real learning interaction could look like this:
‎
‎Learner
‎   │
‎   ▼
‎Study-Prep Workflow
‎   │
‎   ▼
‎Topic Active
‎   │
‎   ▼
‎Adaptive Learning Workflow
‎   │
‎   ▼
‎Context Manager
‎   │
‎   ├── learning doctrine
‎   ├── assessment doctrine
‎   ├── learner state
‎   ├── relevant memory
‎   └── topic context
‎   │
‎   ▼
‎Agent Loop
‎   │
‎   ▼
‎LLM proposes:
‎"diagnose learner understanding"
‎   │
‎   ▼
‎Harness
‎   │
‎   ▼
‎Assessment Tool
‎   │
‎   ▼
‎Sargeant / Assessment Engine
‎   │
‎   ▼
‎OBSERVATION
‎   │
‎   ▼
‎Education Engine
‎   │
‎   ├── score
‎   ├── evidence
‎   ├── mastery
‎   └── misconception
‎   │
‎   ▼
‎Adaptive Decision
‎   │
‎   ├── understood
‎   │
‎   ├── teach_back
‎   │
‎   ├── different_analogy
‎   │
‎   └── flag_gap
‎   │
‎   ▼
‎Workflow transition
‎   │
‎   ▼
‎Next agent loop
‎
‎That's the architecture you were originally trying to reach.
‎
‎
‎---
‎
‎25. One particularly important correction
‎
‎I would not make the Adaptive Learning Workflow itself:
‎
‎diagnose
‎→ analyze
‎→ select strategy
‎→ intervene
‎→ practice
‎→ observe
‎→ evaluate
‎
‎as a completely rigid sequence.
‎
‎Instead:
‎
‎ADAPTIVE LEARNING
‎                         │
‎                  ┌──────▼──────┐
‎                  │   DECISION  │
‎                  │    POINT    │
‎                  └──────┬──────┘
‎                         │
‎             ┌───────────┼────────────┐
‎             ▼           ▼            ▼
‎          practice    teach-back   analogy
‎             │           │            │
‎             └───────────┼────────────┘
‎                         ▼
‎                      evidence
‎                         │
‎                         ▼
‎                    DECISION POINT
‎
‎The workflow defines legal states and boundaries.
‎
‎The agent loop chooses the next permitted operation.
‎
‎The Education Engine determines learning outcomes.
‎
‎That's the clean separation.
‎
‎
‎---
‎
‎26. What we should build first
‎
‎I would not start by moving files around.
‎
‎First create the abstraction around what already works:
‎
‎modules/adaptive-learning/workflows/
‎    definition.js
‎    engine.js
‎    registry.js
‎
‎Then make Study-Prep use it.
‎
‎Something like:
‎
‎const workflow = workflowRegistry.get("study_prep");
‎
‎await workflowEngine.run({
‎  workflow,
‎  sessionId,
‎  learnerId,
‎  operation: "planning"
‎});
‎
‎Then define:
‎
‎workflowRegistry.register({
‎  id: "adaptive_learning",
‎  definition: adaptiveLearningDefinition
‎});
‎
‎workflowRegistry.register({
‎  id: "study_prep",
‎  definition: studyPrepDefinition
‎});
‎
‎workflowRegistry.register({
‎  id: "teaching",
‎  definition: teachingDefinition
‎});
‎
‎workflowRegistry.register({
‎  id: "decay_review",
‎  definition: decayReviewDefinition
‎});
‎
‎Only after Study-Prep successfully runs through the generalized engine should we migrate Teaching and Decay.
‎
‎That gives us a low-risk migration path:
‎
‎CURRENT
‎Study-Prep-specific engine
‎        ↓
‎GENERALIZED WORKFLOW ENGINE
‎        ↓
‎Study-Prep still works
‎        ↓
‎Adaptive Learning uses it
‎        ↓
‎Teaching uses it
‎        ↓
‎Decay Review uses it
‎        ↓
‎Other learning workflows
‎
‎Bottom line
‎
‎Your codebase is actually in a better position than it might look.
‎
‎We don't need a second workflow engine. We need to recognize that the existing Study-Prep infrastructure is the prototype of the real workflow engine, extract its generic pieces, and stop the older adaptive-workflows.js / workflow-state.js / student-state.js paths from becoming competing sources of truth.
‎
‎The three most valuable pieces to promote are:
‎
‎study-prep/harness.js
‎study-prep/state-machine.js
‎study-prep/agent-loop.js
‎
‎with:
‎
‎events.js
‎store.js
‎education-engine.js
‎
‎as their supporting infrastructure.
‎
‎And the first migration target should be Study-Prep itself, because it already has the strongest contracts and tests. Once that generalized engine passes the existing Study-Prep tests without behavioral change, we can plug the existing NaNa/Sargeant/Student Agent adaptive-learning experience into it rather than rewriting those agents.
‎
