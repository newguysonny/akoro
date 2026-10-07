‎Concrete step by step session v2:
‎
‎Yes. Let's rebuild the earlier JSS1 Basic Science exam-prep session, but this time we'll expose the full machinery: workspace → context manager → LLM reasoning → tool → harness validation → execution → observation → next reasoning loop.
‎
‎The key is that we'll distinguish what is configured, what is dynamic learner data, what the LLM decides, and what the harness/deterministic engine is allowed to decide.
‎
‎
‎---
‎
‎Akoro — Complete Exam-Prep Session
‎
‎Learner
‎
‎Name: Ada
‎Class: JSS1
‎Subject: Basic Science
‎Goal: Prepare for the whole-term examination
‎Available balance: 25 coins
‎
‎Syllabus
‎
‎Water Cycle
‎Photosynthesis
‎Human Body
‎Matter
‎Energy
‎Force & Motion
‎
‎Current concept mastery:
‎
‎Water Cycle       0.42
‎Photosynthesis    0.61
‎Human Body        0.82
‎Matter            0.71
‎Energy            0.55
‎Force & Motion    0.76
‎
‎Previous evidence shows that Ada frequently confuses:
‎
‎evaporation
‎transpiration
‎condensation
‎
‎
‎---
‎
‎0. Akoro Workspace
‎
‎Before Ada even starts the session, Akoro has its configurable workspace.
‎
‎/akoro-agent/
‎
‎├── AGENT.md
‎│
‎├── identity/
‎│   ├── IDENTITY.md
‎│   └── SOUL.md
‎│
‎├── learning/
‎│   ├── LEARNING.md
‎│   ├── TEACHING.md
‎│   ├── ASSESSMENT.md
‎│   └── MASTERY.md
‎│
‎├── reasoning/
‎│   ├── REASONING.md
‎│   ├── RESEARCH.md
‎│   ├── INSPECTION.md
‎│   └── PLANNING.md
‎│
‎├── policies/
‎│   ├── EDUCATION_RULES.md
‎│   ├── TOOL_RULES.md
‎│   └── SAFETY.md
‎│
‎├── strategies/
‎│   └── STRATEGIES.md
‎│
‎└── memory/
‎    └── MEMORY.md
‎
‎These are not the student's database records.
‎
‎They are Akoro's configurable operating context.
‎
‎
‎---
‎
‎1. What is inside those files?
‎
‎We don't need to make every file huge. Let's use simplified versions.
‎
‎AGENT.md
‎
‎# Akoro Study Agent
‎
‎You are Akoro, an adaptive exam-preparation agent.
‎
‎Your job is to help the learner prepare effectively while
‎respecting the learner's confirmed goal and session boundaries.
‎
‎Before taking meaningful action, inspect the information
‎necessary to make the decision.
‎
‎Use tools rather than assuming information.
‎
‎Never claim mastery without evidence.
‎
‎
‎---
‎
‎LEARNING.md
‎
‎# Learning Principles
‎
‎When helping a learner:
‎
‎1. Consider prior knowledge.
‎2. Check prerequisites.
‎3. Use previous evidence.
‎4. Do not confuse exposure with mastery.
‎5. Prefer retrieval and teach-back when appropriate.
‎6. Change strategy when repeated attempts reveal a gap.
‎7. Use evidence rather than intuition to determine mastery.
‎
‎
‎---
‎
‎RESEARCH.md
‎
‎# Research Policy
‎
‎When information is needed:
‎
‎1. Inspect the approved syllabus.
‎2. Inspect learner state when relevant.
‎3. Inspect previous evidence when relevant.
‎4. Inspect prerequisite relationships.
‎5. Search approved educational content when necessary.
‎6. Prefer verified educational sources.
‎7. Do not use arbitrary web content unless policy permits it.
‎
‎
‎---
‎
‎INSPECTION.md
‎
‎# Inspection Policy
‎
‎Before choosing a learning action, consider:
‎
‎- current goal
‎- current topic
‎- prior knowledge
‎- mastery
‎- previous mistakes
‎- prerequisites
‎- available attempts
‎- session state
‎- available learning strategies
‎
‎
‎---
‎
‎TEACHING.md
‎
‎# Teaching Policy
‎
‎When a learner demonstrates a knowledge gap:
‎
‎- explain the missing concept
‎- connect it to existing knowledge
‎- use an appropriate analogy when useful
‎- ask the learner to retrieve or teach it back
‎- verify understanding with fresh evidence
‎
‎
‎---
‎
‎MASTERY.md
‎
‎# Mastery Policy
‎
‎The LLM may interpret evidence.
‎
‎The deterministic education engine determines
‎official mastery transitions.
‎
‎Never mark a learner as mastered solely because
‎the LLM believes they understand something.
‎
‎
‎---
‎
‎STRATEGIES.md
‎
‎# Approved Strategies
‎
‎Available strategies:
‎
‎teach_back
‎different_analogy
‎interleave
‎space_out
‎escalate_human
‎
‎Strategies are selected from the approved strategy library.
‎
‎The LLM may recommend a strategy.
‎The harness determines whether that strategy
‎is permitted in the current state.
‎
‎This is the important part.
‎
‎We have now created an editable agent brain/context layer.
‎
‎
‎---
‎
‎2. Ada says:
‎
‎> "Prepare me for my Basic Science exam."
‎
‎
‎
‎The system receives:
‎
‎{
‎  "intent": "exam_prep",
‎  "subject": "Basic Science",
‎  "classLevel": "JSS1",
‎  "scope": "whole_term"
‎}
‎
‎But we don't immediately generate questions.
‎
‎The agent first needs to understand the task.
‎
‎
‎---
‎
‎LOOP 1 — Understand the Goal
‎
‎Step 1 — Harness creates the goal
‎
‎The application creates:
‎
‎GOAL
‎
‎Prepare Ada for her JSS1 Basic Science
‎whole-term examination.
‎
‎Session:
‎
‎planning
‎
‎No money spent.
‎
‎No questions generated.
‎
‎
‎---
‎
‎Step 2 — Context Manager
‎
‎The harness asks:
‎
‎> What context is relevant for planning?
‎
‎
‎
‎It doesn't load everything.
‎
‎It selects:
‎
‎AGENT.md
‎LEARNING.md
‎INSPECTION.md
‎PLANNING.md
‎EDUCATION_RULES.md
‎TOOL_RULES.md
‎
‎Then it adds dynamic session context:
‎
‎subject = Basic Science
‎class = JSS1
‎scope = whole_term
‎wallet = 25
‎
‎Notice something important:
‎
‎We didn't load TEACHING.md.
‎
‎Why?
‎
‎Because we're planning, not teaching.
‎
‎This is the job of the context manager.
‎
‎
‎---
‎
‎Step 3 — LLM receives context
‎
‎Conceptually:
‎
‎SYSTEM CONTEXT
‎
‎[AGENT.md]
‎
‎You are Akoro...
‎
‎[LEARNING.md]
‎
‎Consider prior knowledge...
‎
‎[INSPECTION.md]
‎
‎Before choosing an action consider...
‎
‎[PLANNING.md]
‎
‎...
‎
‎CURRENT GOAL
‎
‎Prepare Ada for JSS1 Basic Science whole-term examination.
‎
‎CURRENT SESSION
‎
‎Status: planning
‎Balance: 25 coins
‎
‎
‎---
‎
‎Step 4 — LLM reasoning
‎
‎The important part here is not exposing a hidden chain-of-thought.
‎
‎Internally, the model reasons.
‎
‎The observable activity can be:
‎
‎[inspection]
‎
‎I need to inspect the syllabus and learner state
‎before proposing a preparation plan.
‎
‎Notice that this is not pretending to expose private reasoning.
‎
‎It is an activity trace.
‎
‎
‎---
‎
‎Step 5 — LLM requests a tool
‎
‎It decides:
‎
‎{
‎  "tool": "syllabus.resolve",
‎  "arguments": {
‎    "subject": "Basic Science",
‎    "classLevel": "JSS1",
‎    "scope": "whole_term"
‎  }
‎}
‎
‎
‎---
‎
‎Step 6 — Harness intercepts
‎
‎The LLM does not directly execute the tool.
‎
‎The harness checks:
‎
‎Is this tool allowed?
‎Is the session authenticated?
‎Does Ada own this session?
‎Are arguments valid?
‎Is syllabus.resolve permitted during planning?
‎
‎Everything passes.
‎
‎HARNESS
‎
‎✓ tool permitted
‎✓ session valid
‎✓ arguments valid
‎✓ no cost
‎
‎
‎---
‎
‎Step 7 — Tool executes
‎
‎syllabus.resolve()
‎
‎Returns:
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
‎
‎---
‎
‎Step 8 — Observation
‎
‎The harness records:
‎
‎{
‎  "event_type": "tool_result",
‎  "thought_type": "research",
‎  "tool": "syllabus.resolve",
‎  "facts": {
‎    "topic_count": 6
‎  }
‎}
‎
‎The agent now has a new observation.
‎
‎
‎---
‎
‎LOOP 2 — Inspect Prior Knowledge
‎
‎The LLM receives the observation.
‎
‎It now decides:
‎
‎[inspection]
‎
‎I know the exam scope.
‎
‎I need to inspect Ada's current knowledge
‎before deciding which topics require more attention.
‎
‎It requests:
‎
‎{
‎  "tool": "learner.get_state",
‎  "arguments": {
‎    "learnerId": "ada",
‎    "subject": "Basic Science"
‎  }
‎}
‎
‎
‎---
‎
‎Harness
‎
‎Checks:
‎
‎✓ learner access
‎✓ read-only operation
‎✓ valid session
‎
‎Then executes.
‎
‎
‎---
‎
‎Observation
‎
‎{
‎  "Water Cycle": 0.42,
‎  "Photosynthesis": 0.61,
‎  "Human Body": 0.82,
‎  "Matter": 0.71,
‎  "Energy": 0.55,
‎  "Force & Motion": 0.76
‎}
‎
‎Agent activity:
‎
‎[research]
‎
‎Inspecting learner mastery to identify
‎where preparation should focus.
‎
‎
‎---
‎
‎LOOP 3 — Inspect Previous Evidence
‎
‎Now the LLM notices:
‎
‎Water Cycle = 0.42
‎Energy = 0.55
‎Photosynthesis = 0.61
‎
‎But mastery alone isn't enough.
‎
‎The context policy says:
‎
‎> Check previous evidence.
‎
‎
‎
‎So it requests:
‎
‎{
‎  "tool": "learner.get_history",
‎  "arguments": {
‎    "learnerId": "ada",
‎    "subject": "Basic Science",
‎    "topics": [
‎      "Water Cycle",
‎      "Photosynthesis",
‎      "Energy"
‎    ]
‎  }
‎}
‎
‎
‎---
‎
‎Observation
‎
‎Previous evidence:
‎
‎Water Cycle
‎
‎3 previous mistakes involving:
‎
‎- evaporation
‎- transpiration
‎- condensation
‎
‎Photosynthesis:
‎
‎Understands basic definition.
‎Struggles with factors affecting photosynthesis.
‎
‎Energy:
‎
‎Previously confused potential and kinetic energy.
‎
‎Now the agent knows much more.
‎
‎
‎---
‎
‎LOOP 4 — Inspect Prerequisites
‎
‎The LLM now asks:
‎
‎> What concepts need to come before others?
‎
‎
‎
‎Tool:
‎
‎{
‎  "tool": "concept.get_prerequisites",
‎  "arguments": {
‎    "topics": [
‎      "Water Cycle",
‎      "Photosynthesis",
‎      "Matter",
‎      "Energy",
‎      "Force & Motion",
‎      "Human Body"
‎    ]
‎  }
‎}
‎
‎Observation:
‎
‎Water Cycle
‎   ↓
‎Photosynthesis
‎
‎Matter
‎   ↓
‎Energy
‎
‎
‎---
‎
‎LOOP 5 — Plan
‎
‎Now the LLM has enough information to propose a plan.
‎
‎It produces a structured proposal, not a direct database mutation:
‎
‎{
‎  "action": "propose_plan",
‎  "topics": [
‎    {
‎      "topic": "Water Cycle",
‎      "reason": "low mastery + repeated confusion"
‎    },
‎    {
‎      "topic": "Photosynthesis",
‎      "reason": "prerequisite relationship + moderate mastery"
‎    },
‎    {
‎      "topic": "Matter",
‎      "reason": "prerequisite for Energy"
‎    },
‎    {
‎      "topic": "Energy",
‎      "reason": "low mastery"
‎    },
‎    {
‎      "topic": "Force & Motion",
‎      "reason": "moderate mastery"
‎    },
‎    {
‎      "topic": "Human Body",
‎      "reason": "high mastery"
‎    }
‎  ]
‎}
‎
‎
‎---
‎
‎LOOP 6 — Harness Validates the Plan
‎
‎This is where your deterministic system becomes extremely important.
‎
‎The LLM proposed something.
‎
‎It does not become truth.
‎
‎The harness asks:
‎
‎Does every topic belong to the syllabus?
‎Are prerequisites respected?
‎Are there ≤ 12 topics?
‎Is the plan allowed by session policy?
‎What will it cost?
‎
‎Planner/harness computes:
‎
‎6 topics
‎Prerequisites valid
‎Estimated generations: 6
‎Estimated cost: 18 coins
‎Wallet: 25 coins
‎
‎Everything passes.
‎
‎
‎---
‎
‎Agent Activity
‎
‎The UI can show:
‎
‎✓ Syllabus checked
‎
‎✓ Prior knowledge checked
‎
‎✓ Previous learning evidence checked
‎
‎✓ Prerequisites checked
‎
‎✓ Study plan prepared
‎
‎Estimated cost: 18 coins
‎
‎Notice how much more meaningful this is than:
‎
‎"Thought for 2 seconds..."
‎
‎
‎---
‎
‎LOOP 7 — Human Gate
‎
‎The system changes:
‎
‎planning
‎      ↓
‎awaiting_confirmation
‎
‎Ada sees:
‎
‎Your Study Plan
‎
‎1. Water Cycle
‎2. Photosynthesis
‎3. Matter
‎4. Energy
‎5. Force & Motion
‎6. Human Body
‎
‎Estimated cost: 18 coins
‎
‎[ Start Preparation ]
‎
‎Ada presses:
‎
‎Start Preparation
‎
‎This is important.
‎
‎The agent cannot simply spend Ada's credits because it thinks the plan is good.
‎
‎
‎---
‎
‎LOOP 8 — Confirm
‎
‎REST:
‎
‎POST /api/adaptive/study-prep/sessions/:id/confirm
‎
‎Harness checks:
‎
‎✓ authenticated
‎✓ owner
‎✓ session = awaiting_confirmation
‎✓ plan exists
‎✓ balance sufficient
‎
‎Then:
‎
‎session.status = topic_active
‎active_topic = Water Cycle
‎
‎Now the learner has authorized execution.
‎
‎
‎---
‎
‎LOOP 9 — Start Water Cycle
‎
‎The LLM receives the current state.
‎
‎Context Manager now changes the context.
‎
‎For topic learning, it loads:
‎
‎AGENT.md
‎LEARNING.md
‎TEACHING.md
‎ASSESSMENT.md
‎MASTERY.md
‎EDUCATION_RULES.md
‎STRATEGIES.md
‎
‎Plus dynamic:
‎
‎Current topic: Water Cycle
‎Mastery: 0.42
‎Previous confusion:
‎evaporation vs transpiration
‎condensation
‎
‎It doesn't need the entire planning context anymore.
‎
‎
‎---
‎
‎Agent
‎
‎Observable activity:
‎
‎[inspection]
‎
‎Before teaching Water Cycle,
‎I need current evidence of what Ada can recall.
‎
‎It requests:
‎
‎{
‎  "tool": "practice.generate",
‎  "arguments": {
‎    "topic": "Water Cycle",
‎    "purpose": "diagnostic",
‎    "difficulty": "adaptive"
‎  }
‎}
‎
‎
‎---
‎
‎Harness
‎
‎Checks:
‎
‎✓ session active
‎✓ topic active
‎✓ diagnostic permitted
‎✓ generation permitted
‎✓ estimated cost within confirmed budget
‎
‎Then charges the appropriate amount and executes generation.
‎
‎
‎---
‎
‎Diagnostic
‎
‎Ada receives five questions.
‎
‎She answers:
‎
‎3 / 5 correct
‎
‎
‎---
‎
‎LOOP 10 — Observation
‎
‎Server scores the attempt.
‎
‎This is critical.
‎
‎The LLM doesn't decide:
‎
‎> "She got 60%."
‎
‎
‎
‎The server knows:
‎
‎score = 60%
‎threshold = 70%
‎
‎The deterministic education engine determines:
‎
‎below_threshold = true
‎
‎
‎---
‎
‎LLM sees observation
‎
‎[reflection]
‎
‎Diagnostic evidence indicates that the learner
‎has not yet met the topic threshold.
‎
‎Previous evidence also shows confusion involving
‎evaporation and transpiration.
‎
‎The LLM now has to decide what to do next.
‎
‎
‎---
‎
‎LOOP 11 — Agent chooses strategy
‎
‎Available strategies:
‎
‎teach_back
‎different_analogy
‎interleave
‎space_out
‎escalate_human
‎
‎The LLM proposes:
‎
‎{
‎  "action": "recommend_strategy",
‎  "strategy": "teach_back",
‎  "reason_code": "repeated_concept_confusion"
‎}
‎
‎Notice:
‎
‎It does not directly say:
‎
‎topic.status = teach_back_required
‎
‎That belongs to the deterministic engine.
‎
‎
‎---
‎
‎Harness
‎
‎Checks:
‎
‎Is teach_back allowed?
‎
‎✓ yes
‎
‎Does learner have attempts remaining?
‎
‎✓ yes
‎
‎Does policy permit teach-back after diagnostic failure?
‎
‎✓ yes
‎
‎So the deterministic engine transitions:
‎
‎diagnostic_ready
‎       ↓
‎teach_back_required
‎
‎Topic:
‎
‎active
‎
‎
‎---
‎
‎LOOP 12 — Teach-back
‎
‎Akoro says:
‎
‎> "You seem to be mixing up evaporation and transpiration. Let's work on that first. Teach it back to me in your own words."
‎
‎
‎
‎Ada explains:
‎
‎> "Evaporation is when water changes into vapor, while transpiration is when plants release water vapor..."
‎
‎
‎
‎She presses:
‎
‎I've taught it back
‎
‎This is the human-confirmed gate.
‎
‎Akoro does not simply infer that pressing a button means mastery.
‎
‎It means:
‎
‎Learner completed teach-back activity.
‎
‎
‎---
‎
‎LOOP 13 — Retest
‎
‎LLM now receives:
‎
‎teach-back completed
‎
‎Context Manager loads:
‎
‎LEARNING.md
‎TEACHING.md
‎ASSESSMENT.md
‎MASTERY.md
‎
‎Agent proposes:
‎
‎{
‎  "action": "generate_retest",
‎  "topic": "Water Cycle"
‎}
‎
‎Harness checks:
‎
‎✓ retest allowed
‎✓ attempts remaining
‎✓ topic still active
‎✓ cost within confirmed budget
‎
‎Then:
‎
‎practice.generate()
‎
‎
‎---
‎
‎LOOP 14 — Retest
‎
‎Ada answers:
‎
‎5 / 5
‎
‎Server:
‎
‎score = 100%
‎threshold = 70%
‎
‎Deterministic engine:
‎
‎PASS
‎
‎Then:
‎
‎retest_ready
‎      ↓
‎passed
‎      ↓
‎topic = understood
‎
‎And concept evidence is written:
‎
‎Water Cycle
‎new evidence = successful retrieval after intervention
‎
‎The concept tracker updates mastery according to its deterministic policy.
‎
‎The LLM never directly writes:
‎
‎mastery = 1.0
‎
‎
‎---
‎
‎LOOP 15 — Agent Decides What's Next
‎
‎Observation:
‎
‎Water Cycle = passed
‎
‎Agent:
‎
‎[reflection]
‎
‎The learner has produced successful fresh evidence
‎after the teach-back intervention.
‎
‎The next planned topic is Photosynthesis.
‎
‎It requests:
‎
‎{
‎  "action": "advance_topic",
‎  "topic": "Photosynthesis"
‎}
‎
‎Harness checks:
‎
‎✓ Water Cycle settled
‎✓ Photosynthesis exists in session
‎✓ prerequisite relationship satisfied
‎✓ session active
‎
‎Then state changes:
‎
‎Water Cycle
‎    understood
‎
‎Photosynthesis
‎    active
‎
‎
‎---
‎
‎LOOP 16 — Photosynthesis
‎
‎Context Manager changes again.
‎
‎The LLM now receives:
‎
‎LEARNING.md
‎TEACHING.md
‎ASSESSMENT.md
‎MASTERY.md
‎INSPECTION.md
‎
‎Dynamic state:
‎
‎Photosynthesis mastery: 0.61
‎
‎Previous evidence:
‎struggles with factors affecting photosynthesis
‎
‎Agent doesn't blindly repeat the Water Cycle strategy.
‎
‎It decides it needs a diagnostic.
‎
‎[inspection]
‎
‎I need to determine whether the learner's weakness
‎is the concept itself or specifically the factors
‎affecting photosynthesis.
‎
‎Tool:
‎
‎practice.generate(diagnostic)
‎
‎Ada scores:
‎
‎4 / 5
‎80%
‎
‎Threshold:
‎
‎70%
‎
‎Deterministic engine:
‎
‎PASS
‎
‎Topic becomes:
‎
‎understood
‎
‎
‎---
‎
‎LOOP 17 — Matter
‎
‎Agent advances.
‎
‎Matter mastery:
‎
‎0.71
‎
‎Agent sees:
‎
‎already above threshold
‎
‎But policy says exposure ≠ mastery.
‎
‎So it still needs evidence.
‎
‎Diagnostic:
‎
‎4 / 5
‎
‎Pass.
‎
‎Matter:
‎
‎understood
‎
‎
‎---
‎
‎LOOP 18 — Energy
‎
‎Now something interesting happens.
‎
‎Energy:
‎
‎mastery = 0.55
‎
‎Previous confusion:
‎
‎potential vs kinetic energy
‎
‎Diagnostic:
‎
‎2 / 5
‎
‎Server:
‎
‎40%
‎
‎Below threshold.
‎
‎Agent inspects history.
‎
‎learner.get_history()
‎
‎Observation:
‎
‎Previous attempts:
‎- confused potential and kinetic energy
‎- repeated same error
‎
‎Now the agent chooses:
‎
‎different_analogy
‎
‎instead of immediately repeating the same explanation.
‎
‎Why?
‎
‎Because STRATEGIES.md tells the agent that repeated failure should trigger a different approach.
‎
‎It proposes:
‎
‎{
‎  "action": "recommend_strategy",
‎  "strategy": "different_analogy"
‎}
‎
‎Harness validates it.
‎
‎Then Akoro teaches Energy using a new analogy.
‎
‎
‎---
‎
‎LOOP 19 — Fresh Evidence
‎
‎New practice:
‎
‎4 / 5
‎
‎80%.
‎
‎Deterministic engine:
‎
‎PASS
‎
‎Energy:
‎
‎understood
‎
‎This demonstrates something important:
‎
‎The agent changed its behavior based on observation.
‎
‎It wasn't:
‎
‎always:
‎
‎research
‎draft
‎verification
‎action
‎reflection
‎synthesis
‎
‎It was:
‎
‎Observe
‎   ↓
‎What do I need?
‎   ↓
‎Inspect
‎   ↓
‎Observe
‎   ↓
‎Choose strategy
‎   ↓
‎Act
‎   ↓
‎Observe
‎   ↓
‎Change strategy if necessary
‎
‎That's the agentic loop you were looking for.
‎
‎
‎---
‎
‎LOOP 20 — Force & Motion
‎
‎Mastery:
‎
‎0.76
‎
‎Diagnostic:
‎
‎5 / 5
‎
‎Pass.
‎
‎Force & Motion = understood
‎
‎
‎---
‎
‎LOOP 21 — Human Body
‎
‎Mastery:
‎
‎0.82
‎
‎Diagnostic:
‎
‎5 / 5
‎
‎Pass.
‎
‎
‎---
‎
‎LOOP 22 — Session Completion
‎
‎All six topics are settled.
‎
‎The LLM receives the final observations.
‎
‎Context Manager loads:
‎
‎AGENT.md
‎ASSESSMENT.md
‎MASTERY.md
‎REASONING.md
‎
‎It does not need:
‎
‎TEACHING.md
‎RESEARCH.md
‎
‎because teaching/research are finished.
‎
‎The agent proposes:
‎
‎{
‎  "action": "complete_session",
‎  "summary": {
‎    "understood": 6,
‎    "flagged": 0,
‎    "capped": 0
‎  }
‎}
‎
‎Harness verifies the facts against the database.
‎
‎Only then:
‎
‎session.status = completed
‎
‎
‎---
‎
‎Final learner-facing result
‎
‎Akoro can now tell Ada:
‎
‎Study session complete.
‎
‎Topics successfully demonstrated:
‎✓ Water Cycle
‎✓ Photosynthesis
‎✓ Matter
‎✓ Energy
‎✓ Force & Motion
‎✓ Human Body
‎
‎The session also identified and worked on:
‎• evaporation vs transpiration
‎• potential vs kinetic energy
‎
‎You completed the planned preparation session.
‎
‎Notice the language:
‎
‎It says successfully demonstrated.
‎
‎It doesn't say:
‎
‎> "You now completely know Basic Science."
‎
‎
‎
‎Because the evidence doesn't justify that claim.
‎
‎
‎---
‎
‎Now let's zoom out
‎
‎The entire session was essentially:
‎
‎USER
‎                          │
‎                          ▼
‎                    ┌───────────┐
‎                    │   GOAL    │
‎                    └─────┬─────┘
‎                          │
‎                          ▼
‎               ┌────────────────────┐
‎               │  CONTEXT MANAGER   │
‎               │                    │
‎               │ Workspace files    │
‎               │ + dynamic context  │
‎               └─────────┬──────────┘
‎                         │
‎                         ▼
‎                  ┌──────────────┐
‎                  │     LLM      │
‎                  │   REASON     │
‎                  └──────┬───────┘
‎                         │
‎                         │ proposes action
‎                         ▼
‎                  ┌──────────────┐
‎                  │   HARNESS    │
‎                  │              │
‎                  │ permissions  │
‎                  │ schema       │
‎                  │ policy       │
‎                  │ budget       │
‎                  │ state        │
‎                  └──────┬───────┘
‎                         │
‎                         ▼
‎                       TOOL
‎                         │
‎                         ▼
‎                    OBSERVATION
‎                         │
‎                         │
‎                         └─────────────┐
‎                                       │
‎                                       ▼
‎                               ┌──────────────┐
‎                               │     LLM      │
‎                               │ REASON AGAIN │
‎                               └──────────────┘
‎
‎And this repeats.
‎
‎
‎---
‎
‎The really important distinction
‎
‎You now have four different things working together.
‎
‎1. Workspace
‎
‎Static/configurable:
‎
‎AGENT.md
‎LEARNING.md
‎RESEARCH.md
‎TEACHING.md
‎MASTERY.md
‎...
‎
‎Answers:
‎
‎> "What principles should guide the agent?"
‎
‎
‎
‎
‎---
‎
‎2. Context Manager
‎
‎Dynamic selector:
‎
‎planning → planning context
‎
‎research → research context
‎
‎teaching → teaching context
‎
‎assessment → assessment context
‎
‎Answers:
‎
‎> "Which context is relevant right now?"
‎
‎
‎
‎
‎---
‎
‎3. LLM Agent
‎
‎Adaptive reasoning:
‎
‎What do I need to know?
‎
‎What should I inspect?
‎
‎Which tool should I use?
‎
‎What should I do next?
‎
‎Did the previous action work?
‎
‎Should I change strategy?
‎
‎Answers:
‎
‎> "Given what I know right now, what should happen next?"
‎
‎
‎
‎
‎---
‎
‎4. Harness + Education Engine
‎
‎Authority:
‎
‎Can the agent do this?
‎
‎Is this tool allowed?
‎
‎Is the session valid?
‎
‎Can we spend credits?
‎
‎Is the learner allowed another attempt?
‎
‎Did they actually pass?
‎
‎Can the state transition?
‎
‎What gets written to DB?
‎
‎Answers:
‎
‎> "Is this action actually permitted and valid?"
‎
‎
‎
‎
‎---
‎
‎This is the architecture I think you were trying to reach
‎
‎Your original v2 had:
‎
‎research
‎   ↓
‎draft
‎   ↓
‎verification
‎   ↓
‎action
‎   ↓
‎reflection
‎   ↓
‎synthesis
‎
‎The problem was that this was basically a predefined cognitive workflow.
‎
‎The new design is:
‎
‎┌─────────────┐
‎                 │ WORKSPACE   │
‎                 │ instructions│
‎                 └──────┬──────┘
‎                        │
‎                        ▼
‎                 CONTEXT MANAGER
‎                        │
‎                        ▼
‎              ┌─────────────────┐
‎              │      LLM        │
‎              │                 │
‎              │ decide next     │
‎              │ information /   │
‎              │ action needed   │
‎              └────────┬────────┘
‎                       │
‎                       ▼
‎                    HARNESS
‎                       │
‎                ┌──────┴──────┐
‎                ▼             ▼
‎              TOOL         POLICY
‎                │             │
‎                └──────┬──────┘
‎                       ▼
‎                  OBSERVATION
‎                       │
‎                       ▼
‎                      LLM
‎                       │
‎                      ...
‎
‎And research / inspection / planning / reflection / action are no longer mandatory stages.
‎
‎They are things the agent can do when the situation calls for them.
‎
‎That is the major conceptual upgrade.
‎
‎
‎---
‎
‎One more thing I would add to Akoro
‎
‎I'd make the workspace itself versioned.
‎
‎For example:
‎
‎workspace/
‎├── v1/
‎│   ├── LEARNING.md
‎│   ├── REASONING.md
‎│   └── ...
‎│
‎├── v2/
‎│   ├── LEARNING.md
‎│   ├── REASONING.md
‎│   └── ...
‎
‎And each session stores:
‎
‎policy_version = "akoro-study-v2.3"
‎workspace_version = "2026-10-01"
‎strategy_version = "1.4"
‎
‎That way, if you change LEARNING.md tomorrow, you know exactly which agent configuration produced a learner's session.
‎
‎For a production education platform, that becomes very valuable for debugging, reproducibility, experiments, and auditing.
‎
