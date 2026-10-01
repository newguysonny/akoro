‎Yes. I think I see the part you're struggling with.
‎
‎Your v2 design is very well engineered as a deterministic workflow, but it is not really using the coding-agent harness model yet.
‎
‎You have taken the appearance of coding-agent thinking and implemented it as deterministic deliberate() functions.
‎
‎That gives you:
‎
‎> research → draft → verification → action → reflection → synthesis
‎
‎
‎
‎But a real agent harness is closer to:
‎
‎> Observe → Reason → Choose tool/action → Execute → Observe result → Reason again → ...
‎
‎
‎
‎The difference is important.
‎
‎
‎---
‎
‎1. The key change I'd make
‎
‎Your current architecture says:
‎
‎Controller
‎   ↓
‎deliberate()
‎   ↓
‎deterministic Thought
‎   ↓
‎action
‎
‎I would instead make it:
‎
‎┌──────────────────────┐
‎                 │    STUDY AGENT       │
‎                 │       LLM            │
‎                 │                      │
‎                 │ Understand           │
‎                 │ Reason               │
‎                 │ Plan                 │
‎                 │ Choose next action   │
‎                 └──────────┬───────────┘
‎                            │
‎                       tool call
‎                            ↓
‎                 ┌──────────────────────┐
‎                 │    AGENT HARNESS     │
‎                 │                      │
‎                 │ permissions          │
‎                 │ state machine        │
‎                 │ validation           │
‎                 │ budget               │
‎                 │ tool execution       │
‎                 └──────────┬───────────┘
‎                            │
‎              ┌─────────────┼─────────────┐
‎              ↓             ↓             ↓
‎          syllabus       learner       practice
‎           tool           state          tool
‎              ↓             ↓             ↓
‎              └─────────────┼─────────────┘
‎                            ↓
‎                       OBSERVATION
‎                            ↓
‎                           LLM
‎                            ↓
‎                         REASON
‎                            ↓
‎                         ACTION
‎                            ↓
‎                          LOOP
‎
‎That is much closer to the coding-agent architecture you're trying to reproduce.
‎
‎
‎---
‎
‎2. Think about your exam-prep agent exactly like a coding agent
‎
‎Take a coding agent.
‎
‎User says:
‎
‎> "Fix authentication."
‎
‎
‎
‎The coding agent doesn't have a hardcoded sequence saying:
‎
‎research
‎draft
‎verification
‎action
‎reflection
‎
‎Instead, it has a goal and a collection of tools.
‎
‎It might decide:
‎
‎I need to inspect the authentication code.
‎
‎Tool:
‎
‎read_file("AuthContext.tsx")
‎
‎Observation:
‎
‎AuthContext uses Supabase.
‎
‎Then:
‎
‎I need to inspect the Supabase configuration.
‎
‎Tool:
‎
‎read_file("supabase.ts")
‎
‎Observation:
‎
‎...
‎
‎Then perhaps:
‎
‎I need documentation.
‎
‎Tool:
‎
‎search_web(...)
‎
‎Then:
‎
‎I can implement the change.
‎
‎Tool:
‎
‎edit_file(...)
‎
‎Then:
‎
‎I need to verify it.
‎
‎Tool:
‎
‎run_tests()
‎
‎Then the test result becomes another observation.
‎
‎
‎---
‎
‎3. Akoro can do exactly the same thing
‎
‎Learner says:
‎
‎> "I have a test covering the whole term. Help me prepare."
‎
‎
‎
‎Your Study Agent receives:
‎
‎GOAL:
‎Prepare learner for Basic Science JSS1 term examination.
‎
‎And gets tools such as:
‎
‎resolve_syllabus()
‎get_learner_state()
‎get_concept_prerequisites()
‎get_past_attempts()
‎get_approved_content()
‎create_practice()
‎score_attempt()
‎record_learning_evidence()
‎
‎Now the LLM can reason over those observations.
‎
‎For example:
‎
‎AGENT
‎
‎I need to understand what the learner needs to study.
‎
‎→ resolve_syllabus()
‎
‎Observation:
‎
‎6 topics found.
‎
‎Then:
‎
‎→ get_learner_state()
‎
‎Observation:
‎
‎Water Cycle       0.42
‎Photosynthesis    0.61
‎Human Body        0.82
‎Force & Motion    0.76
‎Matter            0.71
‎Energy            0.55
‎
‎Then:
‎
‎→ get_concept_prerequisites()
‎
‎Observation:
‎
‎Water Cycle → Photosynthesis
‎
‎Now the LLM can determine:
‎
‎Water Cycle should precede Photosynthesis.
‎The learner also has lower mastery there.
‎
‎I should create a plan.
‎
‎And produce a structured plan, not an uncontrolled piece of text.
‎
‎{
‎  "action": "propose_plan",
‎  "topics": [
‎    "water_cycle",
‎    "photosynthesis",
‎    "energy",
‎    "matter",
‎    "force_motion",
‎    "human_body"
‎  ]
‎}
‎
‎The harness validates it.
‎
‎
‎---
‎
‎4. This is where your deterministic controller remains extremely important
‎
‎This is the part of your v2 that I would not throw away.
‎
‎The LLM should not own your state machine.
‎
‎Instead:
‎
‎LLM
‎                  │
‎             proposes action
‎                  ↓
‎        ┌─────────────────────┐
‎        │   AKORO HARNESS     │
‎        │                     │
‎        │ Is this action      │
‎        │ permitted?          │
‎        │                     │
‎        │ Is state correct?   │
‎        │                     │
‎        │ Is learner owner?   │
‎        │                     │
‎        │ Is budget enough?   │
‎        │                     │
‎        │ Is transition legal?│
‎        └──────────┬──────────┘
‎                   │
‎             APPROVE / DENY
‎                   ↓
‎                execute
‎
‎So:
‎
‎LLM decides
‎
‎> "I think the learner should study Water Cycle first."
‎
‎
‎
‎Harness decides
‎
‎> "Is the agent allowed to do that?"
‎
‎
‎
‎Database decides
‎
‎> "Did the transition actually succeed?"
‎
‎
‎
‎This is a much stronger architecture.
‎
‎
‎---
‎
‎5. Your deliberate() is currently doing something different
‎
‎This:
‎
‎function deliberate(decision_node, facts) {
‎   ...
‎}
‎
‎is essentially a deterministic explanation generator.
‎
‎That's useful.
‎
‎But it isn't the agent's actual cognition.
‎
‎For example:
‎
‎case 'check_constraints':
‎
‎if (facts.prerequisites.requiresReordering) {
‎   return {
‎      thought_type: "verification",
‎      ...
‎      resolution: {
‎         action: "reorder"
‎      }
‎   }
‎}
‎
‎The code has already decided:
‎
‎if prerequisite → reorder
‎
‎The model didn't discover that.
‎
‎The controller did.
‎
‎That's why it can feel like you're simulating thinking rather than building an agent.
‎
‎
‎---
‎
‎6. I'd separate three things
‎
‎This is probably the cleanest architecture for Akoro.
‎
‎A. Agent reasoning
‎
‎LLM:
‎
‎"What should I do next?"
‎
‎It sees:
‎
‎Goal
‎Current state
‎Previous observations
‎Available tools
‎Tool results
‎Constraints
‎
‎and produces a structured action.
‎
‎
‎---
‎
‎B. Harness enforcement
‎
‎Code:
‎
‎"Can you do that?"
‎
‎Checks:
‎
‎Authentication
‎Authorization
‎Session state
‎Wallet
‎Tool permissions
‎Schema
‎State transition
‎Concurrency
‎Maximum attempts
‎Maximum autonomy
‎
‎
‎---
‎
‎C. Deterministic evaluation
‎
‎Code:
‎
‎"What actually happened?"
‎
‎For example:
‎
‎Score = 3/5
‎Threshold = 70%
‎Attempts remaining = 2
‎
‎There is no LLM deciding whether 3/5 is 70%.
‎
‎Your code does that.
‎
‎
‎---
‎
‎7. Then your six cognitive operations become observations/actions, not the agent's brain
‎
‎You can still keep:
‎
‎research
‎draft
‎verification
‎action
‎reflection
‎synthesis
‎
‎But I would change their meaning.
‎
‎Instead of forcing:
‎
‎research → draft → verification → action
‎
‎allow the agent to naturally perform:
‎
‎research
‎   ↓
‎research
‎   ↓
‎draft
‎   ↓
‎verification
‎   ↓
‎research
‎   ↓
‎draft
‎   ↓
‎action
‎   ↓
‎reflection
‎   ↓
‎research
‎   ↓
‎action
‎
‎Just like a coding agent.
‎
‎For example, the agent might discover:
‎
‎I don't have enough information about the learner's
‎previous confusion with Photosynthesis.
‎
‎So it searches learner evidence.
‎
‎Then:
‎
‎I need to understand whether Water Cycle is a prerequisite.
‎
‎So it queries the concept graph.
‎
‎Then:
‎
‎I have enough information.
‎I'll create the plan.
‎
‎That is much more agentic.
‎
‎
‎---
‎
‎8. Your Study Agent's tools could look like this
‎
‎I'd actually design the Akoro harness around tools.
‎
‎Read tools
‎
‎syllabus.resolve
‎learner.get_state
‎learner.get_history
‎concept.get_prerequisites
‎content.search
‎session.get_state
‎
‎Planning tools
‎
‎plan.propose
‎plan.validate
‎
‎Learning tools
‎
‎practice.generate
‎practice.submit
‎practice.score
‎teachback.start
‎
‎State tools
‎
‎session.advance
‎topic.complete
‎topic.defer
‎session.replan
‎
‎But importantly:
‎
‎the LLM shouldn't necessarily get direct access to all of these.
‎
‎For example:
‎
‎practice.score
‎wallet.charge
‎session.transition
‎
‎should be harness-controlled operations.
‎
‎The LLM can request:
‎
‎start_practice
‎
‎but your backend controls the actual charging and transition.
‎
‎
‎---
‎
‎9. Now imagine a real Akoro agent loop
‎
‎This is what I think you're trying to build.
‎
‎USER
‎"I have an exam on the whole term."
‎        ↓
‎┌──────────────────────────┐
‎│       AKORO AGENT        │
‎│                          │
‎│ Goal: prepare learner    │
‎│ for upcoming examination │
‎└────────────┬─────────────┘
‎             ↓
‎       REASON / PLAN
‎             ↓
‎      get_syllabus()
‎             ↓
‎         OBSERVE
‎             ↓
‎      get_learner_state()
‎             ↓
‎         OBSERVE
‎             ↓
‎   get_prerequisites()
‎             ↓
‎         OBSERVE
‎             ↓
‎       LLM REASONS
‎             ↓
‎       propose_plan()
‎             ↓
‎    ┌─────────────────┐
‎    │ HARNESS CHECKS  │
‎    └────────┬────────┘
‎             ↓
‎       PLAN CREATED
‎             ↓
‎      learner confirms
‎             ↓
‎         LLM / Agent
‎             ↓
‎     start_topic()
‎             ↓
‎       generate_exam()
‎             ↓
‎         OBSERVE
‎             ↓
‎      learner answers
‎             ↓
‎        score_answers()
‎             ↓
‎         OBSERVE
‎             ↓
‎       LLM REASONS
‎             ↓
‎     "What next?"
‎             ↓
‎       ┌─────┴──────┐
‎       ↓            ↓
‎     PASS          FAIL
‎       ↓            ↓
‎ next topic    teach-back
‎                    ↓
‎                learner
‎                    ↓
‎                 retest
‎                    ↓
‎                 OBSERVE
‎                    ↓
‎                LLM REASONS
‎                    ↓
‎                  ...
‎
‎That's the coding-agent harness applied to education.
‎
‎
‎---
‎
‎10. And this solves your "Improve" problem
‎
‎Your current v2 says:
‎
‎> If capped → deterministic planner chooses defer/replan/escalate.
‎
‎
‎
‎Instead, you can let the agent evaluate the situation.
‎
‎Suppose:
‎
‎Topic: Human Body
‎Diagnostic: 1/5
‎Retest: 3/5
‎Attempts exhausted
‎Remaining topics: 3
‎
‎The LLM gets:
‎
‎Current session state
‎+
‎learner evidence
‎+
‎available strategies
‎+
‎remaining budget
‎+
‎policy constraints
‎
‎It could propose:
‎
‎{
‎  "action": "defer_topic",
‎  "topic_id": "...",
‎  "reason_code": "attempt_cap_reached"
‎}
‎
‎The harness says:
‎
‎Allowed?
‎YES
‎
‎One deferred retry already used?
‎NO
‎
‎Budget sufficient?
‎YES
‎
‎Remaining topics?
‎YES
‎
‎Therefore:
‎
‎EXECUTE
‎
‎And later the agent observes the new state.
‎
‎
‎---
‎
‎11. But don't let the LLM invent educational policy
‎
‎This is another important distinction.
‎
‎The LLM should be allowed to reason, but not to redefine your rules.
‎
‎For example:
‎
‎Policy
‎
‎Maximum attempts = 3
‎
‎The LLM cannot say:
‎
‎> "Let's try 7 times."
‎
‎
‎
‎Harness:
‎
‎REJECTED
‎attempt_cap_exceeded
‎
‎Likewise:
‎
‎Wallet = 0
‎
‎LLM:
‎
‎> "Generate another practice."
‎
‎
‎
‎Harness:
‎
‎REJECTED
‎insufficient_balance
‎
‎The LLM can then observe:
‎
‎Tool result:
‎insufficient_balance
‎
‎and reason:
‎
‎> "I can't generate another exercise. I'll pause the session."
‎
‎
‎
‎That's agentic behavior inside deterministic boundaries.
‎
‎
‎---
‎
‎12. This is the architecture I'd use
‎
‎I'd simplify your current design into:
‎
‎AKORO STUDY AGENT
‎                           │
‎                 ┌─────────▼─────────┐
‎                 │       LLM         │
‎                 │                   │
‎                 │ Reason            │
‎                 │ Plan              │
‎                 │ Select next tool  │
‎                 └─────────┬─────────┘
‎                           │
‎                    tool/action
‎                           ↓
‎                 ┌───────────────────┐
‎                 │   AGENT HARNESS   │
‎                 │                   │
‎                 │ State machine     │
‎                 │ Policy            │
‎                 │ Permissions       │
‎                 │ Budget            │
‎                 │ Validation        │
‎                 │ Concurrency       │
‎                 │ Tool execution    │
‎                 └─────────┬─────────┘
‎                           │
‎             ┌─────────────┼─────────────┐
‎             ↓             ↓             ↓
‎          Syllabus       Learner       Practice
‎           Tools          Tools         Tools
‎             │             │             │
‎             └─────────────┼─────────────┘
‎                           ↓
‎                       OBSERVATION
‎                           ↓
‎                          LLM
‎                           ↺
‎
‎And then separately:
‎
‎DETERMINISTIC EDUCATION ENGINE
‎                    │
‎          ┌─────────┼─────────┐
‎          ↓         ↓         ↓
‎       scoring    mastery    transitions
‎       threshold  evidence   state guards
‎
‎The agent uses this engine.
‎
‎It doesn't replace it.
‎
‎
‎---
‎
‎13. One major change I'd make to your v2
‎
‎I would not delete your study_prep_events table or thought types.
‎
‎They're useful.
‎
‎But rename their conceptual purpose from:
‎
‎> "the system's thinking"
‎
‎
‎
‎to:
‎
‎> "agent activity / decision trace."
‎
‎
‎
‎For example:
‎
‎{
‎  "event_type": "tool_call",
‎  "thought_type": "research",
‎  "tool": "get_learner_state"
‎}
‎
‎Then:
‎
‎{
‎  "event_type": "tool_result",
‎  "thought_type": "reflection",
‎  "facts": {
‎    "below_threshold": 3
‎  }
‎}
‎
‎Then:
‎
‎{
‎  "event_type": "agent_action",
‎  "thought_type": "draft",
‎  "action": "propose_plan"
‎}
‎
‎This is much closer to how a coding-agent activity log works.
‎
‎And do not store the LLM's private chain-of-thought.
‎
‎You can expose:
‎
‎> "Checking prerequisite relationships"
‎
‎
‎
‎without exposing:
‎
‎> the model's hidden reasoning transcript.
‎
‎
‎
‎
‎---
‎
‎14. The deepest mental model
‎
‎I think this is the piece that will make the whole thing click for you:
‎
‎Coding agent
‎
‎Goal
‎ ↓
‎LLM decides what information it needs
‎ ↓
‎Tool
‎ ↓
‎Observation
‎ ↓
‎LLM decides what to do
‎ ↓
‎Tool
‎ ↓
‎Observation
‎ ↓
‎LLM decides what to do
‎ ↓
‎...
‎ ↓
‎Verified result
‎
‎Akoro Study Agent
‎
‎Learning Goal
‎ ↓
‎LLM decides what information it needs
‎ ↓
‎Syllabus / learner-state tool
‎ ↓
‎Observation
‎ ↓
‎LLM decides what to do
‎ ↓
‎Practice tool
‎ ↓
‎Learner result
‎ ↓
‎Observation
‎ ↓
‎LLM decides what to do
‎ ↓
‎Teach-back / practice / reorder / defer
‎ ↓
‎Learner result
‎ ↓
‎Observation
‎ ↓
‎...
‎ ↓
‎Verified learning outcome
‎
‎That is the bridge between the coding agent you are studying and Akoro.
‎
‎Your current v2 has already solved the hard safety/state-management side extremely well. What it's missing is the other half: an actual agent loop that can decide what information/action it needs next instead of deliberate() deterministically deciding the sequence in advance.
‎
‎The ideal Akoro architecture is therefore not "LLM instead of controller." It is:
‎
‎> LLM Agent + deterministic Harness + deterministic Education Engine + tools + observation loop.
‎
‎
‎
‎That is the architecture I would build around.
‎
