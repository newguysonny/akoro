‎Yes. One small correction first: I would not make every context category a literal folder that the LLM automatically loads. The folders are an organizational structure; the Context Manager has a registry/policy that decides what to load based on workflow state + operation + task.
‎
‎Let's make this concrete with Akoro.
‎
‎1. Akoro Context Manager
‎
‎Imagine this project structure:
‎
‎akoro-agent/
‎│
‎├── workspace/
‎│   │
‎│   ├── core/
‎│   │   ├── AGENT.md
‎│   │   ├── IDENTITY.md
‎│   │   └── SOUL.md
‎│   │
‎│   ├── learning/
‎│   │   ├── LEARNING.md
‎│   │   ├── TEACHING.md
‎│   │   ├── ASSESSMENT.md
‎│   │   └── MASTERY.md
‎│   │
‎│   ├── reasoning/
‎│   │   ├── REASONING.md
‎│   │   ├── RESEARCH.md
‎│   │   ├── INSPECTION.md
‎│   │   └── PLANNING.md
‎│   │
‎│   ├── policies/
‎│   │   ├── EDUCATION_RULES.md
‎│   │   ├── TOOL_RULES.md
‎│   │   └── SAFETY.md
‎│   │
‎│   └── strategies/
‎│       └── STRATEGIES.md
‎│
‎├── context/
‎│   ├── context-manager.js
‎│   ├── context-registry.js
‎│   └── context-builder.js
‎│
‎├── harness/
‎│   ├── agent-loop.js
‎│   ├── tool-router.js
‎│   ├── state-machine.js
‎│   └── policy-engine.js
‎│
‎└── tools/
‎    ├── syllabus.js
‎    ├── learner.js
‎    ├── practice.js
‎    └── concepts.js
‎
‎Then the important thing is:
‎
‎MD files
‎   ↓
‎Context Registry
‎   ↓
‎Context Manager
‎   ↓
‎Context Builder
‎   ↓
‎LLM
‎
‎
‎---
‎
‎2. The MD files
‎
‎Let's take three concrete files.
‎
‎LEARNING.md
‎
‎# Learning Principles
‎
‎When helping a learner:
‎
‎1. Consider prior knowledge before introducing new material.
‎2. Check prerequisites when relevant.
‎3. Use previous evidence when selecting an intervention.
‎4. Do not assume exposure means mastery.
‎5. Prefer retrieval and teach-back when appropriate.
‎6. If repeated evidence shows the same misconception,
‎   consider changing the teaching strategy.
‎
‎The LLM may recommend a strategy.
‎
‎The deterministic education engine determines mastery.
‎
‎
‎---
‎
‎RESEARCH.md
‎
‎# Research Rules
‎
‎When information is missing:
‎
‎1. First inspect the approved syllabus.
‎2. Inspect learner knowledge when relevant.
‎3. Inspect previous learner evidence when relevant.
‎4. Inspect prerequisite relationships when relevant.
‎5. Use approved educational content for factual grounding.
‎6. Do not invent educational facts.
‎7. Do not use unrestricted web research unless the
‎   current policy explicitly permits it.
‎
‎
‎---
‎
‎TEACHING.md
‎
‎# Teaching Rules
‎
‎When an intervention is required:
‎
‎1. Identify the specific knowledge gap.
‎2. Connect the explanation to known concepts.
‎3. Prefer an approved teaching strategy.
‎4. Avoid repeating an unsuccessful explanation
‎   without a reason.
‎5. After intervention, seek fresh evidence.
‎
‎
‎---
‎
‎3. Now the Context Registry
‎
‎This is where we tell the system when files are relevant.
‎
‎For example:
‎
‎const contextRegistry = {
‎  core: [
‎    "core/AGENT.md",
‎    "core/IDENTITY.md"
‎  ],
‎
‎  workflow: {
‎    planning: [
‎      "reasoning/PLANNING.md",
‎      "reasoning/INSPECTION.md",
‎      "policies/EDUCATION_RULES.md"
‎    ],
‎
‎    awaiting_confirmation: [
‎      "policies/EDUCATION_RULES.md"
‎    ],
‎
‎    topic_active: [
‎      "learning/LEARNING.md",
‎      "reasoning/INSPECTION.md",
‎      "policies/EDUCATION_RULES.md"
‎    ],
‎
‎    replanning: [
‎      "reasoning/PLANNING.md",
‎      "reasoning/INSPECTION.md",
‎      "learning/LEARNING.md"
‎    ]
‎  },
‎
‎  operation: {
‎    research: [
‎      "reasoning/RESEARCH.md",
‎      "reasoning/INSPECTION.md"
‎    ],
‎
‎    teach: [
‎      "learning/LEARNING.md",
‎      "learning/TEACHING.md",
‎      "learning/MASTERY.md"
‎    ],
‎
‎    assess: [
‎      "learning/ASSESSMENT.md",
‎      "learning/MASTERY.md"
‎    ],
‎
‎    strategy_selection: [
‎      "learning/LEARNING.md",
‎      "learning/TEACHING.md",
‎      "strategies/STRATEGIES.md"
‎    ],
‎
‎    planning: [
‎      "reasoning/PLANNING.md",
‎      "reasoning/INSPECTION.md"
‎    ]
‎  }
‎};
‎
‎This is configuration, not the agent's reasoning.
‎
‎
‎---
‎
‎4. Now imagine we add a new MD file
‎
‎Suppose six months later you realize:
‎
‎> "Akoro should consider the learner's preferred language when teaching."
‎
‎
‎
‎You create:
‎
‎workspace/learning/LANGUAGE.md
‎
‎# Language Guidance
‎
‎When teaching:
‎
‎1. Consider the learner's selected language.
‎2. Use English terminology for curriculum concepts
‎   when required by the syllabus.
‎3. Explain difficult concepts using the learner's
‎   preferred language when appropriate.
‎4. Do not translate technical terms in a way that
‎   changes their educational meaning.
‎
‎Then add it to the registry:
‎
‎operation: {
‎  teach: [
‎    "learning/LEARNING.md",
‎    "learning/TEACHING.md",
‎    "learning/MASTERY.md",
‎    "learning/LANGUAGE.md"
‎  ]
‎}
‎
‎That's it.
‎
‎You don't need to rewrite the agent loop.
‎
‎
‎---
‎
‎5. Now let's actually run it
‎
‎Ada says:
‎
‎> "Prepare me for my Basic Science exam."
‎
‎
‎
‎The application creates:
‎
‎{
‎  "sessionId": "S123",
‎  "workflowState": "planning",
‎  "goal": "Prepare for JSS1 Basic Science examination"
‎}
‎
‎The harness starts the agent.
‎
‎
‎---
‎
‎6. Harness → Context Manager
‎
‎The harness says:
‎
‎const context = await contextManager.build({
‎  workflowState: "planning",
‎  operation: "planning",
‎  sessionId: "S123",
‎  learnerId: "ADA",
‎  goal: "Prepare for JSS1 Basic Science examination"
‎});
‎
‎The Context Manager now knows:
‎
‎workflowState = planning
‎operation = planning
‎
‎
‎---
‎
‎7. Context Manager selects files
‎
‎It starts with core:
‎
‎AGENT.md
‎IDENTITY.md
‎
‎Then workflow context:
‎
‎PLANNING.md
‎INSPECTION.md
‎EDUCATION_RULES.md
‎
‎Then operation context:
‎
‎PLANNING.md
‎INSPECTION.md
‎
‎Duplicates are removed.
‎
‎Final selection:
‎
‎AGENT.md
‎IDENTITY.md
‎PLANNING.md
‎INSPECTION.md
‎EDUCATION_RULES.md
‎
‎This is important.
‎
‎The Context Manager isn't saying:
‎
‎> "Load everything in workspace."
‎
‎
‎
‎It's saying:
‎
‎> "Given where we are and what we're doing, these are the relevant instructions."
‎
‎
‎
‎
‎---
‎
‎8. Dynamic learner context is added
‎
‎The Context Manager also asks the relevant repositories/tools for dynamic information.
‎
‎For planning:
‎
‎syllabus.resolve()
‎learner.get_state()
‎learner.get_history()
‎concept.get_prerequisites()
‎
‎Suppose they return:
‎
‎Topics:
‎Water Cycle
‎Photosynthesis
‎Human Body
‎Matter
‎Energy
‎Force & Motion
‎
‎Water Cycle mastery: 0.42
‎Photosynthesis mastery: 0.61
‎...
‎
‎Previous confusion:
‎evaporation/transpiration
‎
‎This isn't stored in the MD files.
‎
‎It's runtime context.
‎
‎
‎---
‎
‎9. Context Builder creates the LLM input
‎
‎Conceptually, the LLM receives:
‎
‎SYSTEM
‎────────────────────────────
‎
‎You are Akoro Study Agent.
‎
‎[AGENT.md]
‎
‎You are Akoro...
‎
‎[IDENTITY.md]
‎
‎...
‎
‎[PLANNING.md]
‎
‎When creating a study plan...
‎
‎[INSPECTION.md]
‎
‎Before selecting an action...
‎
‎[EDUCATION_RULES.md]
‎
‎...
‎
‎CURRENT WORKFLOW STATE
‎────────────────────────────
‎
‎planning
‎
‎CURRENT GOAL
‎────────────────────────────
‎
‎Prepare for JSS1 Basic Science examination.
‎
‎LEARNER CONTEXT
‎────────────────────────────
‎
‎Class: JSS1
‎Subject: Basic Science
‎
‎Mastery:
‎Water Cycle: 0.42
‎Photosynthesis: 0.61
‎Human Body: 0.82
‎Matter: 0.71
‎Energy: 0.55
‎Force & Motion: 0.76
‎
‎Previous evidence:
‎Water Cycle:
‎- evaporation/transpiration confusion
‎
‎AVAILABLE TOOLS
‎────────────────────────────
‎
‎syllabus.resolve
‎learner.get_state
‎learner.get_history
‎concept.get_prerequisites
‎plan.propose
‎
‎CURRENT TASK
‎────────────────────────────
‎
‎Create an appropriate preparation plan.
‎
‎Now the LLM has everything it needs.
‎
‎
‎---
‎
‎10. The LLM decides
‎
‎It might request:
‎
‎{
‎  "type": "tool_call",
‎  "tool": "syllabus.resolve",
‎  "arguments": {
‎    "subject": "Basic Science",
‎    "classLevel": "JSS1"
‎  }
‎}
‎
‎The important thing:
‎
‎The MD files did not tell it:
‎
‎> "Call syllabus.resolve() first."
‎
‎
‎
‎They told it:
‎
‎> "Before planning, understand the syllabus and inspect relevant information."
‎
‎
‎
‎The LLM decides how to satisfy that requirement.
‎
‎
‎---
‎
‎11. Harness receives the tool call
‎
‎The harness validates:
‎
‎workflowState = planning
‎
‎syllabus.resolve
‎        ↓
‎Allowed in planning? YES
‎
‎Arguments valid? YES
‎
‎Permission? YES
‎
‎Then executes the tool.
‎
‎
‎---
‎
‎12. Observation comes back
‎
‎{
‎  "topics": [
‎    "Water Cycle",
‎    "Photosynthesis",
‎    "Human Body",
‎    "Matter",
‎    "Energy",
‎    "Force & Motion"
‎  ]
‎}
‎
‎Now we have a new LLM loop.
‎
‎
‎---
‎
‎13. Context Manager runs again
‎
‎This is where your question about state vs loop becomes important.
‎
‎The workflow state is still:
‎
‎planning
‎
‎But the operation is now:
‎
‎inspection
‎
‎So:
‎
‎contextManager.build({
‎  workflowState: "planning",
‎  operation: "inspection",
‎  ...
‎});
‎
‎The Context Manager might select:
‎
‎AGENT.md
‎IDENTITY.md
‎PLANNING.md
‎INSPECTION.md
‎EDUCATION_RULES.md
‎RESEARCH.md
‎
‎Why RESEARCH.md now?
‎
‎Because this particular loop involves gathering information.
‎
‎
‎---
‎
‎14. The LLM gets the next context
‎
‎It receives:
‎
‎CURRENT STATE
‎planning
‎
‎CURRENT OPERATION
‎inspection
‎
‎PREVIOUS OBSERVATION
‎Syllabus contains 6 topics.
‎
‎RELEVANT GUIDANCE
‎
‎[INSPECTION.md]
‎Before choosing a learning action...
‎
‎[RESEARCH.md]
‎When information is missing...
‎
‎AVAILABLE TOOLS
‎
‎learner.get_state
‎learner.get_history
‎concept.get_prerequisites
‎...
‎
‎The LLM decides:
‎
‎I need learner state.
‎
‎Tool:
‎
‎learner.get_state()
‎
‎
‎---
‎
‎15. Another observation
‎
‎Water Cycle: 0.42
‎Energy: 0.55
‎...
‎
‎Another loop.
‎
‎Context Manager again.
‎
‎But now operation:
‎
‎planning
‎
‎The context may be:
‎
‎AGENT.md
‎PLANNING.md
‎LEARNING.md
‎INSPECTION.md
‎EDUCATION_RULES.md
‎
‎The LLM proposes:
‎
‎{
‎  "action": "propose_plan",
‎  "topics": [
‎    "Water Cycle",
‎    "Photosynthesis",
‎    "Matter",
‎    "Energy",
‎    "Force & Motion",
‎    "Human Body"
‎  ]
‎}
‎
‎
‎---
‎
‎16. The Harness takes over
‎
‎This is where we do not let the LLM decide state.
‎
‎Harness:
‎
‎Is Water Cycle in syllabus?       YES
‎Is Photosynthesis in syllabus?    YES
‎...
‎Are prerequisites valid?          YES
‎Maximum topics ≤ 12?              YES
‎Cost ≤ confirmed budget?          YES
‎
‎Then the deterministic planner/state machine writes:
‎
‎session.status = awaiting_confirmation
‎
‎The LLM did not do that.
‎
‎
‎---
‎
‎17. Now Ada confirms
‎
‎Ada clicks:
‎
‎> Start Preparation
‎
‎
‎
‎The workflow changes:
‎
‎awaiting_confirmation
‎        ↓
‎topic_active
‎
‎Current topic:
‎
‎Water Cycle
‎
‎Now the agent needs to perform a diagnostic.
‎
‎
‎---
‎
‎18. Context changes dramatically
‎
‎Harness:
‎
‎contextManager.build({
‎  workflowState: "topic_active",
‎  operation: "assessment",
‎  topic: "Water Cycle",
‎  learnerId: "ADA"
‎});
‎
‎Context Manager selects:
‎
‎AGENT.md
‎LEARNING.md
‎ASSESSMENT.md
‎MASTERY.md
‎EDUCATION_RULES.md
‎
‎It doesn't need:
‎
‎PLANNING.md
‎
‎because planning is finished.
‎
‎
‎---
‎
‎19. LLM gets this
‎
‎SYSTEM
‎
‎[AGENT.md]
‎
‎[LEARNING.md]
‎
‎[ASSESSMENT.md]
‎
‎[MASTERY.md]
‎
‎[EDUCATION_RULES.md]
‎
‎CURRENT STATE
‎
‎workflowState: topic_active
‎
‎topic: Water Cycle
‎
‎learner mastery: 0.42
‎
‎TASK
‎
‎Obtain evidence of current understanding.
‎
‎LLM:
‎
‎{
‎  "tool": "practice.generate",
‎  "arguments": {
‎    "topic": "Water Cycle",
‎    "purpose": "diagnostic"
‎  }
‎}
‎
‎Harness validates and executes.
‎
‎
‎---
‎
‎20. Ada gets 3/5
‎
‎Observation:
‎
‎score = 60%
‎threshold = 70%
‎
‎Now operation becomes:
‎
‎strategy_selection
‎
‎Context Manager:
‎
‎AGENT.md
‎LEARNING.md
‎TEACHING.md
‎MASTERY.md
‎STRATEGIES.md
‎
‎Now the LLM has the teaching/strategy context.
‎
‎It sees:
‎
‎Previous confusion:
‎evaporation vs transpiration
‎
‎It proposes:
‎
‎{
‎  "action": "recommend_strategy",
‎  "strategy": "teach_back"
‎}
‎
‎Harness validates.
‎
‎Then topic state changes:
‎
‎teach_back_required
‎
‎
‎---
‎
‎21. This is the important relationship
‎
‎Notice what happened:
‎
‎WORKFLOW STATE
‎      +
‎OPERATION
‎      +
‎CURRENT DATA
‎      +
‎WORKSPACE FILES
‎      ↓
‎CONTEXT MANAGER
‎      ↓
‎SELECTED CONTEXT
‎      ↓
‎LLM
‎      ↓
‎PROPOSED ACTION
‎      ↓
‎HARNESS
‎      ↓
‎TOOL / DETERMINISTIC ENGINE
‎      ↓
‎OBSERVATION
‎      ↓
‎NEXT LOOP
‎
‎That is the mechanism you were asking about.
‎
‎
‎---
‎
‎22. So where should new MD files go?
‎
‎Yes, essentially:
‎
‎workspace/
‎├── core/
‎├── learning/
‎├── reasoning/
‎├── policies/
‎└── strategies/
‎
‎If you create:
‎
‎learning/EXAM_TECHNIQUES.md
‎
‎you then register it for relevant operations:
‎
‎operation: {
‎  assessment: [
‎    "learning/ASSESSMENT.md",
‎    "learning/MASTERY.md",
‎    "learning/EXAM_TECHNIQUES.md"
‎  ]
‎}
‎
‎If you create:
‎
‎reasoning/PRIOR_KNOWLEDGE.md
‎
‎you could register it for:
‎
‎operation: {
‎  planning: [
‎    "reasoning/PLANNING.md",
‎    "reasoning/INSPECTION.md",
‎    "reasoning/PRIOR_KNOWLEDGE.md"
‎  ],
‎
‎  research: [
‎    "reasoning/RESEARCH.md",
‎    "reasoning/INSPECTION.md",
‎    "reasoning/PRIOR_KNOWLEDGE.md"
‎  ]
‎}
‎
‎The agent loop itself doesn't change.
‎
‎The workflow state machine doesn't change.
‎
‎You're simply teaching the Context Manager:
‎
‎> "When you're doing X under Y conditions, this additional knowledge is relevant."
‎
‎
‎
‎
‎---
‎
‎23. One final refinement I'd recommend
‎
‎Don't make the registry completely hardcoded forever.
‎
‎Eventually you can make the MD files have metadata.
‎
‎For example:
‎
‎---
‎id: prior_knowledge
‎category: reasoning
‎operations:
‎  - planning
‎  - research
‎  - strategy_selection
‎workflow_states:
‎  - planning
‎  - topic_active
‎priority: high
‎---
‎
‎Then your Context Manager can discover the file and understand:
‎
‎> This file is relevant during planning, research and strategy selection.
‎
‎
‎
‎That gets you much closer to the OpenClaw-style customizable workspace you originally asked about.
‎
‎So the eventual architecture becomes:
‎
‎WORKSPACE MD FILES
‎                      │
‎                      ▼
‎              CONTEXT REGISTRY
‎                      │
‎                      ▼
‎              CONTEXT MANAGER
‎                      ▲
‎                      │
‎       ┌──────────────┼──────────────┐
‎       │              │              │
‎ workflow state   operation      current goal
‎       │              │              │
‎       └──────────────┼──────────────┘
‎                      ▼
‎              SELECT RELEVANT
‎                  CONTEXT
‎                      │
‎                      ▼
‎             BUILD LLM PROMPT
‎                      │
‎                      ▼
‎                     LLM
‎                      │
‎                 tool/action
‎                      ▼
‎                   HARNESS
‎                      │
‎                 observation
‎                      │
‎                      └──────────► next LLM loop
‎
‎That's the concrete Context Manager model I would use for Akoro. The MD files become your easily tweakable "agent brain/context," while the harness, workflow state machine, database, scoring engine, and permissions remain the hard safety/authority layer.
‎
