‎Yes — and you're right to call out the inconsistency. I was using three different levels of description and calling all of them "workflow." Let's fix the terminology permanently for Akoro.
‎
‎1. Which one is the actual workflow?
‎
‎For Akoro, I recommend we make this the canonical Study-Prep workflow:
‎
‎STUDY SESSION
‎│
‎├── PLANNING
‎│
‎├── AWAITING_CONFIRMATION
‎│
‎├── TOPIC_ACTIVE
‎│   │
‎│   ├── DIAGNOSTIC
‎│   │
‎│   ├── INTERVENTION        ← only if needed
‎│   │
‎│   ├── RETEST              ← only if needed
‎│   │
‎│   └── OUTCOME
‎│
‎├── REPLANNING              ← only if needed
‎│
‎├── PAUSED                  ← exceptional state
‎│
‎├── COMPLETED
‎│
‎└── ABANDONED / CANCELLED
‎
‎That's the workflow/state machine.
‎
‎So from now on, when we say Akoro Study-Prep Workflow, that's what I mean.
‎
‎
‎---
‎
‎Then what was this?
‎
‎PLAN
‎ ↓
‎PRACTICE
‎ ↓
‎OBSERVE
‎ ↓
‎LEARN
‎ ↓
‎PRACTICE AGAIN
‎ ↓
‎OBSERVE
‎ ↓
‎PASS
‎
‎That's not another workflow.
‎
‎It's an example of what can happen inside TOPIC_ACTIVE.
‎
‎More precisely:
‎
‎TOPIC_ACTIVE
‎
‎is the workflow state.
‎
‎Inside that state, the agent may perform:
‎
‎inspect
‎→ generate diagnostic
‎→ practice
‎→ observe
‎→ inspect history
‎→ teach
‎→ retest
‎→ observe
‎→ outcome
‎
‎Those are agent activities/actions, not workflow states.
‎
‎That distinction should eliminate the confusion.
‎
‎
‎---
‎
‎2. So what are the actual states?
‎
‎I'd define the canonical state machine like this:
‎
‎┌───────────────┐
‎                    │   PLANNING    │
‎                    └───────┬───────┘
‎                            ↓
‎              ┌────────────────────────┐
‎              │ AWAITING_CONFIRMATION  │
‎              └────────────┬───────────┘
‎                           ↓
‎                    ┌──────────────┐
‎                    │ TOPIC_ACTIVE │◄─────────┐
‎                    └──────┬───────┘          │
‎                           │                   │
‎                 ┌─────────┴──────────┐        │
‎                 ↓                    ↓        │
‎             NEXT TOPIC           REPLANNING ──┘
‎                 │
‎                 ↓
‎          ┌─────────────┐
‎          │  COMPLETED  │
‎          └─────────────┘
‎
‎Exceptional states:
‎    PAUSED
‎    ABANDONED
‎    CANCELLED
‎
‎And inside TOPIC_ACTIVE, the topic/run has its own smaller state machine:
‎
‎DIAGNOSTIC_READY
‎       ↓
‎   PRACTICE
‎       ↓
‎    SCORE
‎    /   \
‎ PASS    FAIL
‎  │       │
‎  │       ↓
‎  │   INTERVENTION
‎  │       ↓
‎  │     RETEST
‎  │       ↓
‎  │     SCORE
‎  │      /  \
‎  │    PASS  FAIL
‎  │     │      │
‎  └─────┘      ↓
‎             CHANGE
‎             APPROACH /
‎             FLAG / CAP
‎
‎This is much cleaner.
‎
‎Two levels:
‎
‎Session state machine
‎
‎planning
‎awaiting_confirmation
‎topic_active
‎replanning
‎paused
‎completed
‎abandoned
‎cancelled
‎
‎Topic/run state machine
‎
‎diagnostic_ready
‎teach_back_required
‎retest_ready
‎passed
‎flagged_gap
‎capped_out
‎deferred
‎
‎The agent operates inside these states.
‎
‎
‎---
‎
‎3. Now your second question: Context Manager
‎
‎> "Does the harness decide that if workflow state 1, consider these context; workflow state 2, consider these context?"
‎
‎
‎
‎Yes — with one important refinement.
‎
‎The workflow state is one of the inputs to the Context Manager.
‎
‎But the context does not have to be loaded only once per workflow state.
‎
‎Instead:
‎
‎CURRENT STATE
‎                         │
‎                         ▼
‎                  Context Manager
‎                         │
‎          ┌──────────────┴──────────────┐
‎          │                             │
‎     State context                Operation context
‎          │                             │
‎          └──────────────┬──────────────┘
‎                         ▼
‎                  Selected Context
‎                         │
‎                         ▼
‎                       LLM
‎
‎So context selection can depend on:
‎
‎1. Current workflow state
‎
‎
‎2. Current operation
‎
‎
‎3. Current goal
‎
‎
‎4. Current topic
‎
‎
‎5. Relevant dynamic learner information
‎
‎
‎6. What the agent is currently trying to accomplish
‎
‎
‎
‎
‎---
‎
‎4. This answers your TEACHING.md question
‎
‎When I said:
‎
‎> "In planning, TEACHING.md might not be needed."
‎
‎
‎
‎I wasn't saying:
‎
‎> "The workflow decides which files exist."
‎
‎
‎
‎I meant:
‎
‎> The Context Manager doesn't need to inject every file into every LLM call.
‎
‎
‎
‎For example:
‎
‎State = PLANNING
‎
‎Context Manager might select:
‎
‎AGENT.md
‎LEARNING.md
‎PLANNING.md
‎INSPECTION.md
‎EDUCATION_RULES.md
‎TOOL_RULES.md
‎
‎No:
‎
‎TEACHING.md
‎
‎because the agent isn't teaching yet.
‎
‎
‎---
‎
‎State = TOPIC_ACTIVE
‎
‎Now suppose the agent is deciding how to intervene.
‎
‎Context Manager selects:
‎
‎AGENT.md
‎LEARNING.md
‎TEACHING.md
‎MASTERY.md
‎STRATEGIES.md
‎EDUCATION_RULES.md
‎
‎Now TEACHING.md matters.
‎
‎
‎---
‎
‎State = TOPIC_ACTIVE
‎
‎But suppose the agent is researching why the learner is struggling.
‎
‎The Context Manager could instead select:
‎
‎AGENT.md
‎LEARNING.md
‎RESEARCH.md
‎INSPECTION.md
‎MASTERY.md
‎
‎So even within the same workflow state, the context can change depending on what the LLM is doing.
‎
‎
‎---
‎
‎5. So is context appended per workflow state or per LLM loop?
‎
‎Potentially both — but for different reasons.
‎
‎This is the subtle point.
‎
‎The workflow state provides the baseline context.
‎
‎The LLM loop/operation provides the specific context needed for that particular decision.
‎
‎Think of it as:
‎
‎Workflow State
‎       │
‎       ▼
‎BASE CONTEXT
‎       │
‎       +
‎       │
‎       ▼
‎OPERATION CONTEXT
‎       │
‎       +
‎       │
‎       ▼
‎DYNAMIC DATA
‎       │
‎       ▼
‎FINAL LLM CONTEXT
‎
‎
‎---
‎
‎6. Concrete example
‎
‎We're in:
‎
‎TOPIC_ACTIVE
‎
‎Topic:
‎
‎Water Cycle
‎
‎Ada:
‎
‎mastery = 0.42
‎
‎Previous confusion:
‎
‎evaporation vs transpiration
‎
‎The agent needs to decide:
‎
‎> What should I do next?
‎
‎
‎
‎Context Manager receives:
‎
‎{
‎  "workflowState": "topic_active",
‎  "operation": "inspect",
‎  "topic": "Water Cycle",
‎  "goal": "determine appropriate next learning action"
‎}
‎
‎It selects:
‎
‎AGENT.md
‎LEARNING.md
‎INSPECTION.md
‎MASTERY.md
‎
‎Then dynamic context:
‎
‎Topic: Water Cycle
‎Mastery: 0.42
‎Previous confusion: evaporation/transpiration
‎
‎LLM sees that.
‎
‎It says:
‎
‎> I need to inspect previous evidence.
‎
‎
‎
‎Tool:
‎
‎learner.get_history()
‎
‎
‎---
‎
‎7. Then a NEW LLM loop happens
‎
‎Observation:
‎
‎Learner made the same mistake three times.
‎
‎Now the context manager is invoked again.
‎
‎But this time:
‎
‎{
‎  "workflowState": "topic_active",
‎  "operation": "strategy_selection",
‎  "topic": "Water Cycle",
‎  "goal": "select intervention"
‎}
‎
‎It might select:
‎
‎AGENT.md
‎LEARNING.md
‎TEACHING.md
‎MASTERY.md
‎STRATEGIES.md
‎
‎Now the LLM can decide:
‎
‎Recommend teach_back.
‎
‎Then the harness validates that action.
‎
‎
‎---
‎
‎8. This is the key architecture
‎
‎Don't think:
‎
‎> One workflow state = one giant prompt.
‎
‎
‎
‎Think:
‎
‎SESSION STATE
‎                       │
‎                       ▼
‎              ┌─────────────────┐
‎              │ CONTEXT MANAGER │
‎              └────────┬────────┘
‎                       │
‎                       │ determines
‎                       ▼
‎              BASE STATE CONTEXT
‎                       │
‎                       +
‎                 OPERATION
‎                       │
‎                       +
‎              DYNAMIC CONTEXT
‎                       │
‎                       ▼
‎                 LLM CONTEXT
‎                       │
‎                       ▼
‎                     LLM
‎                       │
‎                       ▼
‎                   ACTION
‎                       │
‎                       ▼
‎                   HARNESS
‎                       │
‎                       ▼
‎                  OBSERVATION
‎                       │
‎                       └───────────────┐
‎                                       │
‎                                       ▼
‎                              CONTEXT MANAGER
‎                                       │
‎                                       ▼
‎                                      LLM
‎
‎So every meaningful reasoning/tool decision can get an appropriately assembled context.
‎
‎
‎---
‎
‎9. But don't reload everything blindly
‎
‎There's another optimization we'll eventually want.
‎
‎Suppose:
‎
‎LEARNING.md
‎
‎hasn't changed.
‎
‎We don't necessarily need to physically resend it every time if you're using a system that supports persistent/cached context.
‎
‎Conceptually:
‎
‎Stable context
‎    ↓
‎cached
‎
‎Dynamic context
‎    ↓
‎updated each loop
‎
‎So:
‎
‎AGENT.md
‎LEARNING.md
‎POLICIES.md
‎
‎can be relatively stable.
‎
‎While:
‎
‎current score
‎current topic
‎previous observation
‎attempt count
‎
‎changes frequently.
‎
‎That distinction will matter for token cost.
‎
‎
‎---
‎
‎10. And now we can precisely define Akoro's layers
‎
‎I would lock this terminology into your architecture:
‎
‎┌─────────────────────────────────────────┐
‎│ 1. STUDY SESSION WORKFLOW              │
‎│                                         │
‎│ planning                                │
‎│ awaiting_confirmation                   │
‎│ topic_active                            │
‎│ replanning                              │
‎│ paused                                  │
‎│ completed                               │
‎│ abandoned                               │
‎│ cancelled                               │
‎└──────────────────┬──────────────────────┘
‎                   │
‎                   ▼
‎┌─────────────────────────────────────────┐
‎│ 2. TOPIC/RUN WORKFLOW                   │
‎│                                         │
‎│ diagnostic_ready                        │
‎│ teach_back_required                     │
‎│ retest_ready                            │
‎│ passed                                  │
‎│ flagged_gap                             │
‎│ capped_out                              │
‎│ deferred                                │
‎└──────────────────┬──────────────────────┘
‎                   │
‎                   ▼
‎┌─────────────────────────────────────────┐
‎│ 3. AGENT LOOP                           │
‎│                                         │
‎│ Reason → Act → Observe → Reason → ...  │
‎│                                         │
‎│ NO FIXED COGNITIVE SEQUENCE             │
‎└──────────────────┬──────────────────────┘
‎                   │
‎                   ▼
‎┌─────────────────────────────────────────┐
‎│ 4. CONTEXT MANAGER                      │
‎│                                         │
‎│ state context                           │
‎│ operation context                       │
‎│ learner context                         │
‎│ workspace files                         │
‎│ relevant memories                       │
‎└──────────────────┬──────────────────────┘
‎                   │
‎                   ▼
‎┌─────────────────────────────────────────┐
‎│ 5. HARNESS                              │
‎│                                         │
‎│ permissions                             │
‎│ schemas                                 │
‎│ budget                                  │
‎│ state validation                        │
‎│ tool execution                          │
‎│ concurrency                             │
‎└──────────────────┬──────────────────────┘
‎                   │
‎                   ▼
‎┌─────────────────────────────────────────┐
‎│ 6. DETERMINISTIC EDUCATION ENGINE      │
‎│                                         │
‎│ scoring                                │
‎│ thresholds                              │
‎│ mastery evidence                        │
‎│ state transitions                       │
‎│ attempt limits                          │
‎└─────────────────────────────────────────┘
‎
‎That is the model I'd use going forward.
‎
‎The shortest possible version:
‎
‎Workflow states tell us where we are.
‎
‎The topic state tells us what learning phase we're in.
‎
‎The agent loop determines what the agent needs to do next.
‎
‎The Context Manager determines what information/instructions the LLM should see for that decision.
‎
‎The Harness determines whether the proposed action is allowed.
‎
‎The deterministic education engine determines what actually happened.
‎
‎So yes: context is dynamically selected at the LLM decision/operation level, using the current workflow state as one of its strongest inputs. It isn't simply "append these files once per workflow state."
‎
