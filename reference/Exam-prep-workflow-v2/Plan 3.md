‎Yes — you're very close. There are two separate concepts getting mixed together: the agent loop and the learning workflow.
‎
‎1. Does more context mean more loops?
‎
‎Not necessarily. This is the first small correction.
‎
‎Context files do not determine how many loops the LLM runs.
‎
‎They influence what the LLM considers and what it may decide to do next.
‎
‎Think:
‎
‎Context
‎   ↓
‎LLM decides what it needs
‎   ↓
‎Tool/action
‎   ↓
‎Observation
‎   ↓
‎LLM decides again
‎   ↓
‎Tool/action
‎   ↓
‎Observation
‎   ↓
‎...
‎
‎So if you give the agent more useful context, it may make better or more elaborate decisions, which can result in more tool calls/loops — but there is no rule:
‎
‎10 context files = 10 loops
‎
‎That's not how it works.
‎
‎Your understanding here is basically correct:
‎
‎The context can tell the agent:
‎
‎> "When trying to solve this kind of problem, consider X, Y and Z."
‎
‎
‎
‎Then the LLM looks at the available tools and decides:
‎
‎> "I need X. Which tool can give me X?"
‎
‎
‎
‎For example:
‎
‎INSPECTION.md
‎
‎Before selecting a learning action, consider:
‎
‎- learner's prior knowledge
‎- previous attempts
‎- prerequisites
‎- current mastery
‎- current session state
‎
‎The LLM sees that and thinks, effectively:
‎
‎I need prior knowledge.
‎
‎Available tools:
‎    learner.get_state()
‎    learner.get_history()
‎    syllabus.resolve()
‎    concept.get_prerequisites()
‎    ...
‎
‎Which one gives me the information I need?
‎
‎Then:
‎
‎learner.get_state()
‎
‎returns an observation.
‎
‎The LLM looks at the observation and reasons again.
‎
‎Maybe it now says:
‎
‎I know the mastery level,
‎but I don't know WHY the learner is struggling.
‎
‎I should inspect previous evidence.
‎
‎Then:
‎
‎learner.get_history()
‎
‎And so on.
‎
‎So:
‎
‎Context → influences reasoning
‎
‎Tools → provide capabilities/information
‎
‎Observations → change the next reasoning
‎
‎LLM → decides what to do next
‎
‎Harness → decides whether that proposed action is permitted
‎
‎That's the important relationship.
‎
‎
‎---
‎
‎2. But then... if there is no hardcoded sequence, are there no steps?
‎
‎There absolutely are steps.
‎
‎This is the key distinction.
‎
‎There is no hardcoded cognitive sequence, but there is a workflow/state structure.
‎
‎Those are different things.
‎
‎For Akoro:
‎
‎PLAN
‎ ↓
‎PRACTICE
‎ ↓
‎OBSERVE RESULT
‎ ↓
‎LEARN / INTERVENE
‎ ↓
‎PRACTICE AGAIN
‎ ↓
‎OBSERVE
‎ ↓
‎PASS / CHANGE APPROACH
‎ ↓
‎NEXT TOPIC
‎
‎Those are still real steps.
‎
‎But the LLM isn't forced to execute:
‎
‎1. research
‎2. draft
‎3. verification
‎4. action
‎5. reflection
‎6. synthesis
‎
‎every time.
‎
‎
‎---
‎
‎Think about it like driving
‎
‎You give a driver:
‎
‎> "Take me from Lagos to Abuja."
‎
‎
‎
‎There is a goal and there are road rules.
‎
‎But you don't hardcode:
‎
‎1. Turn left
‎2. Drive 400m
‎3. Turn right
‎4. Drive 2km
‎5. Turn left
‎...
‎
‎Instead, the driver observes the environment and chooses the next action.
‎
‎But there is still a journey:
‎
‎START
‎  ↓
‎ROAD
‎  ↓
‎INTERSECTION
‎  ↓
‎ROAD
‎  ↓
‎DESTINATION
‎
‎The journey structure exists.
‎
‎The exact actions within it are adaptive.
‎
‎
‎---
‎
‎Akoro works the same way
‎
‎Your workflow is something like:
‎
‎Study Session
‎│
‎├── Planning
‎│
‎├── Topic 1
‎│   ├── Diagnostic
‎│   ├── Intervention
‎│   ├── Retest
‎│   └── Outcome
‎│
‎├── Topic 2
‎│   ├── Diagnostic
‎│   ├── Intervention
‎│   ├── Retest
‎│   └── Outcome
‎│
‎└── Completion
‎
‎That's your education workflow.
‎
‎But inside:
‎
‎Topic 1
‎
‎the agent can behave adaptively.
‎
‎
‎---
‎
‎Example
‎
‎Suppose Water Cycle starts.
‎
‎The workflow says:
‎
‎Topic Active
‎
‎Now the agent has a job:
‎
‎> Determine whether Ada understands Water Cycle.
‎
‎
‎
‎The agent might reason:
‎
‎I need evidence.
‎
‎Then:
‎
‎practice.generate()
‎
‎That's one loop.
‎
‎Observation:
‎
‎3/5
‎
‎Now it reasons again.
‎
‎Maybe:
‎
‎The learner failed because of evaporation/transpiration confusion.
‎I should inspect previous evidence.
‎
‎Tool:
‎
‎learner.get_history()
‎
‎Observation:
‎
‎Same confusion appeared twice previously.
‎
‎Now it reasons again:
‎
‎Repeating the same practice isn't appropriate.
‎I should use teach-back.
‎
‎Tool/action:
‎
‎teachback.start()
‎
‎Observation:
‎
‎learner completed teach-back
‎
‎Agent:
‎
‎I need fresh evidence.
‎
‎Tool:
‎
‎practice.generate(retest)
‎
‎Observation:
‎
‎5/5
‎
‎Now the deterministic education engine says:
‎
‎PASS
‎
‎And the workflow moves:
‎
‎Water Cycle
‎    understood
‎        ↓
‎Photosynthesis
‎    active
‎
‎
‎---
‎
‎So there are actually TWO loops
‎
‎This is probably the missing piece.
‎
‎A. Agent reasoning loop
‎
‎This is:
‎
‎REASON
‎  ↓
‎ACT
‎  ↓
‎OBSERVE
‎  ↓
‎REASON
‎  ↓
‎ACT
‎  ↓
‎OBSERVE
‎  ↓
‎...
‎
‎It is adaptive.
‎
‎There is no fixed sequence.
‎
‎
‎---
‎
‎B. Education workflow
‎
‎This is:
‎
‎PLAN
‎  ↓
‎TOPIC
‎  ↓
‎DIAGNOSTIC
‎  ↓
‎INTERVENTION if needed
‎  ↓
‎RETEST if needed
‎  ↓
‎OUTCOME
‎  ↓
‎NEXT TOPIC
‎  ↓
‎...
‎  ↓
‎COMPLETE
‎
‎This has structure and states.
‎
‎It should not be left entirely to the LLM.
‎
‎
‎---
‎
‎Why shouldn't the LLM control the whole workflow?
‎
‎Imagine you tell the LLM:
‎
‎> "Do whatever is necessary to prepare Ada."
‎
‎
‎
‎The LLM could theoretically decide:
‎
‎practice
‎practice
‎practice
‎practice
‎practice
‎
‎Or:
‎
‎teach
‎teach
‎teach
‎
‎Or even incorrectly conclude:
‎
‎> "Ada understands the topic."
‎
‎
‎
‎You don't want that.
‎
‎Your deterministic education engine should enforce things like:
‎
‎diagnostic required
‎↓
‎score
‎↓
‎threshold
‎↓
‎pass/fail
‎↓
‎attempt limit
‎↓
‎appropriate state transition
‎
‎So:
‎
‎LLM decides how to navigate the problem
‎
‎Workflow defines what states and outcomes are possible
‎
‎Harness enforces what the LLM is allowed to do
‎
‎
‎---
‎
‎A very useful mental model
‎
‎Think of Akoro as a game.
‎
‎The game has rules:
‎
‎Session must be confirmed.
‎A topic must be active.
‎A diagnostic must be completed.
‎A score determines pass/fail.
‎Maximum attempts = 2.
‎A passed topic can advance.
‎A failed topic may require intervention.
‎
‎Those are the game rules.
‎
‎The player/agent then decides how to play within those rules.
‎
‎"What should I inspect?"
‎"What tool should I use?"
‎"Should I look at history?"
‎"Which approved strategy fits?"
‎"Do I need another observation?"
‎
‎That's the LLM.
‎
‎
‎---
‎
‎So your architecture becomes
‎
‎AKORO STUDY SESSION
‎                         │
‎                         ▼
‎                ┌─────────────────┐
‎                │ WORKFLOW STATES  │
‎                │                 │
‎                │ planning        │
‎                │ awaiting        │
‎                │ topic_active    │
‎                │ replanning      │
‎                │ completed       │
‎                │ paused          │
‎                └────────┬────────┘
‎                         │
‎                         ▼
‎                 ┌───────────────┐
‎                 │ AGENT LOOP    │
‎                 │               │
‎                 │ Reason        │
‎                 │ Act           │
‎                 │ Observe       │
‎                 │ Reason        │
‎                 │ Act           │
‎                 │ Observe       │
‎                 │ ...           │
‎                 └───────┬───────┘
‎                         │
‎              ┌──────────┴──────────┐
‎              ▼                     ▼
‎        Context Manager          Tools
‎              │                     │
‎              ▼                     ▼
‎       Workspace files          DB / APIs
‎       Dynamic context          Practice
‎                                Syllabus
‎                                History
‎                                etc.
‎                         │
‎                         ▼
‎                   HARNESS
‎                         │
‎                         ▼
‎              DETERMINISTIC ENGINE
‎                         │
‎                         ▼
‎                  STATE TRANSITION
‎
‎
‎---
‎
‎And this gives you a very powerful principle
‎
‎The workflow tells the agent where it is.
‎
‎The context tells the agent what it should consider.
‎
‎The tools tell the agent what it can inspect/do.
‎
‎The LLM decides what it should do next.
‎
‎The harness decides whether it may do it.
‎
‎The deterministic education engine decides what actually happened.
‎
‎That's the clean separation you've been looking for.
‎
‎And importantly, "Plan → Practice → Teach → Retest → Advance" doesn't disappear. It becomes the education state machine, while the agent's reasoning inside those states becomes adaptive rather than hardcoded.
‎
