‎Yes. Let's make it concrete with one complete Akoro exam-prep session, but slow it down so we can see exactly what the agent/harness is doing at every loop.
‎
‎We'll use:
‎
‎> Learner: JSS1 student
‎Subject: Basic Science
‎Goal: Prepare for a whole-term examination
‎Topics: Water Cycle, Photosynthesis, Human Body, Matter, Energy, Force & Motion
‎
‎
‎
‎The important thing is that we won't assume a fixed research → draft → verification → action sequence. We'll let the hypothetical Study Agent decide what it needs next, while the harness controls what it is actually allowed to do.
‎
‎
‎---
‎
‎Step 0 — The learner gives the prompt
‎
‎LEARNER
‎
‎"I have a test covering the whole term for Basic Science.
‎Can you help me prepare?"
‎
‎The system turns that into an agent goal:
‎
‎{
‎  "goal": "Prepare learner for whole-term Basic Science examination",
‎  "subject": "Basic Science",
‎  "class_level": "JSS1",
‎  "entry_mode": "syllabus"
‎}
‎
‎At this point:
‎
‎No research yet.
‎No practice generated.
‎No coins spent.
‎No state changed.
‎
‎
‎---
‎
‎Step 1 — AGENT LOOP #1: Understand the goal
‎
‎The Study Agent receives:
‎
‎SYSTEM
‎You are Akoro Study Agent.
‎
‎Your goal is to help the learner prepare for an examination.
‎
‎You can use approved study tools.
‎
‎You cannot:
‎- spend coins without confirmation
‎- change protected learner state directly
‎- bypass attempt limits
‎- invent syllabus content
‎- expose answer keys
‎
‎And:
‎
‎USER GOAL
‎
‎Prepare me for my whole-term JSS1 Basic Science exam.
‎
‎LLM reasoning
‎
‎Conceptually:
‎
‎REASON
‎
‎The learner wants examination preparation.
‎
‎I need to know:
‎1. What topics are in the relevant syllabus?
‎2. What does the learner already know?
‎3. Are there prerequisite relationships?
‎4. What previous evidence exists?
‎
‎I should research the syllabus first.
‎
‎Notice something important:
‎
‎The LLM has not yet decided what the final study plan should be.
‎
‎It first decides:
‎
‎> "I need information."
‎
‎
‎
‎
‎---
‎
‎Step 2 — AGENT ACTION: Research the syllabus
‎
‎The LLM requests a tool:
‎
‎{
‎  "tool": "syllabus.resolve",
‎  "arguments": {
‎    "subject": "Basic Science",
‎    "class_level": "JSS1",
‎    "scope": "whole_term"
‎  }
‎}
‎
‎The harness receives this.
‎
‎Harness checks
‎
‎✓ User authenticated
‎✓ Subject allowed
‎✓ JSS1 exists
‎✓ Tool permitted
‎✓ Session has not spent anything
‎
‎The harness executes the tool.
‎
‎
‎---
‎
‎Step 3 — OBSERVATION #1
‎
‎The syllabus tool returns:
‎
‎{
‎  "topics": [
‎    {
‎      "id": "water-cycle",
‎      "label": "Water Cycle"
‎    },
‎    {
‎      "id": "photosynthesis",
‎      "label": "Photosynthesis"
‎    },
‎    {
‎      "id": "human-body",
‎      "label": "Human Body Systems"
‎    },
‎    {
‎      "id": "matter",
‎      "label": "Matter"
‎    },
‎    {
‎      "id": "energy",
‎      "label": "Energy"
‎    },
‎    {
‎      "id": "force-motion",
‎      "label": "Force and Motion"
‎    }
‎  ]
‎}
‎
‎The agent now observes reality.
‎
‎OBSERVATION
‎
‎6 topics found.
‎
‎The loop goes back to the LLM.
‎
‎
‎---
‎
‎Step 4 — AGENT LOOP #2: Decide what information it needs next
‎
‎The LLM sees:
‎
‎Goal:
‎Prepare learner for whole-term exam.
‎
‎Observation:
‎6 syllabus topics found.
‎
‎It reasons:
‎
‎REASON
‎
‎I know what needs to be studied.
‎
‎But I shouldn't treat all six topics equally.
‎
‎I need the learner's current mastery/evidence so I can determine
‎where practice should begin.
‎
‎I'll inspect learner state.
‎
‎Again:
‎
‎The agent chooses the next tool based on the observation.
‎
‎
‎---
‎
‎Step 5 — AGENT ACTION: Research learner state
‎
‎Tool:
‎
‎{
‎  "tool": "learner.get_state",
‎  "arguments": {
‎    "learner_id": "current",
‎    "topics": [
‎      "water-cycle",
‎      "photosynthesis",
‎      "human-body",
‎      "matter",
‎      "energy",
‎      "force-motion"
‎    ]
‎  }
‎}
‎
‎Harness:
‎
‎✓ Learner authenticated
‎✓ Agent can read learner state
‎✓ Read-only operation
‎
‎Tool executes.
‎
‎
‎---
‎
‎Step 6 — OBSERVATION #2
‎
‎Suppose Akoro gets:
‎
‎{
‎  "water-cycle": 0.42,
‎  "photosynthesis": 0.61,
‎  "human-body": 0.82,
‎  "matter": 0.71,
‎  "energy": 0.55,
‎  "force-motion": 0.76
‎}
‎
‎The agent now observes:
‎
‎Water Cycle        42%
‎Photosynthesis     61%
‎Human Body         82%
‎Matter             71%
‎Energy             55%
‎Force & Motion     76%
‎
‎Back to the LLM.
‎
‎
‎---
‎
‎Step 7 — AGENT LOOP #3: Research more
‎
‎The LLM reasons:
‎
‎REASON
‎
‎The learner has weaker evidence for Water Cycle, Energy,
‎and Photosynthesis.
‎
‎But I shouldn't simply sort by confidence.
‎
‎Prerequisites may affect the correct order.
‎
‎I need to inspect the concept graph.
‎
‎This is exactly like a coding agent saying:
‎
‎> "I found the bug, but I need to inspect how this module connects to the others."
‎
‎
‎
‎
‎---
‎
‎Step 8 — AGENT ACTION: Research prerequisites
‎
‎{
‎  "tool": "concept.get_prerequisites",
‎  "arguments": {
‎    "topics": [
‎      "water-cycle",
‎      "photosynthesis",
‎      "human-body",
‎      "matter",
‎      "energy",
‎      "force-motion"
‎    ]
‎  }
‎}
‎
‎Harness validates and executes.
‎
‎
‎---
‎
‎Step 9 — OBSERVATION #3
‎
‎Result:
‎
‎Water Cycle
‎    ↓
‎Photosynthesis
‎
‎Matter
‎    ↓
‎Energy
‎
‎Force & Motion
‎    independent
‎
‎Human Body
‎    independent
‎
‎Now the LLM has:
‎
‎SYLLABUS
‎6 topics
‎
‎LEARNER STATE
‎Water Cycle       42%
‎Energy            55%
‎Photosynthesis    61%
‎Matter            71%
‎Force & Motion    76%
‎Human Body        82%
‎
‎PREREQUISITES
‎Water Cycle → Photosynthesis
‎Matter → Energy
‎
‎
‎---
‎
‎Step 10 — AGENT LOOP #4: Draft a plan
‎
‎Now the LLM has enough information.
‎
‎It reasons:
‎
‎REASON
‎
‎I should prioritize lower-confidence topics,
‎but prerequisite order must be respected.
‎
‎Water Cycle should come before Photosynthesis.
‎
‎Matter should come before Energy.
‎
‎I'll propose an ordered study plan.
‎
‎It produces a structured action:
‎
‎{
‎  "action": "propose_plan",
‎  "topics": [
‎    "water-cycle",
‎    "photosynthesis",
‎    "matter",
‎    "energy",
‎    "force-motion",
‎    "human-body"
‎  ]
‎}
‎
‎This is not yet executed.
‎
‎It is a proposal.
‎
‎
‎---
‎
‎Step 11 — HARNESS VERIFICATION
‎
‎Now the harness takes over.
‎
‎It checks:
‎
‎Is Water Cycle before Photosynthesis?
‎        YES
‎
‎Is Matter before Energy?
‎        YES
‎
‎Are all topics from the approved syllabus?
‎        YES
‎
‎Maximum session topics = 12
‎        6 ≤ 12
‎
‎Estimated cost?
‎        18 coins
‎
‎Learner wallet?
‎        25 coins
‎
‎Everything passes.
‎
‎
‎---
‎
‎Step 12 — OBSERVATION #4
‎
‎The harness gives the agent:
‎
‎PLAN VALIDATION
‎
‎✓ 6 valid syllabus topics
‎✓ Prerequisites satisfied
‎✓ Estimated cost: 18 coins
‎✓ Wallet: 25 coins
‎✓ Plan can proceed to learner confirmation
‎
‎Now the agent doesn't need to keep researching.
‎
‎It can conclude:
‎
‎REASON
‎
‎The plan satisfies the available constraints.
‎
‎I should present the plan to the learner.
‎
‎No practice should be generated yet because confirmation
‎has not occurred.
‎
‎
‎---
‎
‎Step 13 — AGENT ACTION: Present plan
‎
‎Akoro shows:
‎
‎┌──────────────────────────────────────────┐
‎│         YOUR BASIC SCIENCE PLAN          │
‎│                                          │
‎│  6 topics                                │
‎│  Estimated cost: 18 coins                │
‎│                                          │
‎│  1. Water Cycle                          │
‎│  2. Photosynthesis                       │
‎│  3. Matter                               │
‎│  4. Energy                               │
‎│  5. Force & Motion                       │
‎│  6. Human Body Systems                   │
‎│                                          │
‎│  [ Approve & Start ]  [ Adjust ]         │
‎└──────────────────────────────────────────┘
‎
‎Still no coins spent.
‎
‎
‎---
‎
‎Step 14 — HUMAN GATE
‎
‎The learner presses:
‎
‎> Approve & Start
‎
‎
‎
‎This is important.
‎
‎The LLM didn't approve the spending.
‎
‎The learner did.
‎
‎The harness performs:
‎
‎awaiting_confirmation
‎        ↓
‎topic_active
‎
‎Now the agent has permission to begin.
‎
‎
‎---
‎
‎Step 15 — AGENT LOOP #5: Start the first topic
‎
‎Current state:
‎
‎Active topic:
‎Water Cycle
‎
‎The LLM receives:
‎
‎SESSION STATE
‎
‎Goal:
‎Prepare learner for Basic Science exam.
‎
‎Current topic:
‎Water Cycle
‎
‎Mastery:
‎42%
‎
‎Attempts:
‎0
‎
‎Budget:
‎18 estimated
‎
‎It reasons:
‎
‎REASON
‎
‎The learner has low existing evidence for Water Cycle.
‎
‎I need a diagnostic rather than assuming what they know.
‎
‎I'll generate a short diagnostic assessment.
‎
‎Action:
‎
‎{
‎  "tool": "practice.generate",
‎  "arguments": {
‎    "topic_id": "water-cycle",
‎    "mode": "diagnostic",
‎    "question_count": 5
‎  }
‎}
‎
‎
‎---
‎
‎Step 16 — HARNESS
‎
‎Before generating:
‎
‎✓ Session confirmed
‎✓ Topic active
‎✓ Budget available
‎✓ Attempt limit not exceeded
‎✓ Topic belongs to session
‎✓ Question generation permitted
‎
‎Then:
‎
‎Generate practice
‎
‎The LLM/content generator produces questions.
‎
‎The learner sees:
‎
‎Question 1:
‎What happens during evaporation?
‎
‎Question 2:
‎...
‎
‎5 questions
‎
‎
‎---
‎
‎Step 17 — LEARNER ANSWERS
‎
‎Suppose:
‎
‎3 / 5 correct
‎
‎The learner submits.
‎
‎Now comes an important architectural point.
‎
‎The LLM should not decide the score.
‎
‎The server scores it.
‎
‎answers
‎   ↓
‎server answer key
‎   ↓
‎score = 3/5
‎   ↓
‎deterministic evaluation
‎
‎
‎---
‎
‎Step 18 — OBSERVATION #5
‎
‎The agent receives:
‎
‎{
‎  "topic": "Water Cycle",
‎  "score": 3,
‎  "total": 5,
‎  "percentage": 60,
‎  "threshold": 70,
‎  "attempts_used": 1,
‎  "attempts_remaining": 2
‎}
‎
‎Now the loop starts again.
‎
‎
‎---
‎
‎Step 19 — AGENT LOOP #6: Reflection
‎
‎The LLM sees:
‎
‎60%
‎Required: 70%
‎Attempts remaining: 2
‎
‎It reasons:
‎
‎REASON
‎
‎The learner did not reach the required threshold.
‎
‎Another practice test immediately may not address
‎the underlying gap.
‎
‎I should provide a learning intervention before retesting.
‎
‎Available strategies:
‎- teach_back
‎- different_analogy
‎- interleave
‎- space_out
‎
‎It proposes:
‎
‎{
‎  "action": "offer_strategy",
‎  "strategy": "teach_back",
‎  "topic": "water-cycle"
‎}
‎
‎
‎---
‎
‎Step 20 — HARNESS CHECK
‎
‎Harness:
‎
‎Score below threshold?
‎    YES
‎
‎Attempts remaining?
‎    YES
‎
‎Teach-back allowed by policy?
‎    YES
‎
‎Learner must initiate/confirm teach-back?
‎    YES
‎
‎Approved.
‎
‎Akoro displays:
‎
‎Water Cycle
‎
‎You scored 3/5.
‎
‎Let's strengthen this topic before the next test.
‎
‎[ Teach it back ]
‎
‎
‎---
‎
‎Step 21 — LEARNER TEACHES THE AGENT
‎
‎This is where Akoro becomes interesting.
‎
‎The learner explains:
‎
‎> "Water evaporates when the sun heats it. Then it becomes clouds..."
‎
‎
‎
‎The teaching interface works.
‎
‎But Akoro doesn't automatically declare the learner successful just because the LLM liked the answer.
‎
‎The learner presses:
‎
‎> I've taught it back
‎
‎
‎
‎That satisfies your current gate.
‎
‎
‎---
‎
‎Step 22 — AGENT OBSERVES NEW STATE
‎
‎The harness now records:
‎
‎learner_confirmed_ready = true
‎
‎The agent receives:
‎
‎OBSERVATION
‎
‎Teach-back completed.
‎Learner confirmed readiness.
‎Retest is permitted.
‎
‎The agent reasons:
‎
‎REASON
‎
‎The learner has completed the intervention.
‎
‎I should generate a fresh retest rather than repeat
‎the previous questions.
‎
‎Action:
‎
‎{
‎  "tool": "practice.generate",
‎  "arguments": {
‎    "topic_id": "water-cycle",
‎    "mode": "retest",
‎    "question_count": 5,
‎    "fresh_questions": true
‎  }
‎}
‎
‎
‎---
‎
‎Step 23 — RETEST
‎
‎Learner answers:
‎
‎5 / 5
‎
‎Server evaluates:
‎
‎100%
‎
‎Observation:
‎
‎{
‎  "topic": "water-cycle",
‎  "score": 5,
‎  "total": 5,
‎  "percentage": 100,
‎  "threshold": 70,
‎  "attempts_used": 2,
‎  "status": "passed"
‎}
‎
‎
‎---
‎
‎Step 24 — AGENT REASONS AGAIN
‎
‎The LLM sees:
‎
‎Water Cycle
‎PASSED
‎
‎It reasons:
‎
‎REASON
‎
‎Water Cycle has passed the current assessment threshold.
‎
‎The next planned topic is Photosynthesis.
‎
‎I should advance to that topic.
‎
‎Action:
‎
‎{
‎  "action": "advance_topic",
‎  "next_topic": "photosynthesis"
‎}
‎
‎
‎---
‎
‎Step 25 — HARNESS
‎
‎Harness checks:
‎
‎Current topic settled?
‎    YES
‎
‎Next topic exists?
‎    YES
‎
‎Next topic belongs to session?
‎    YES
‎
‎Session still active?
‎    YES
‎
‎Budget available?
‎    YES
‎
‎Then:
‎
‎Water Cycle
‎     ↓
‎understood
‎
‎Photosynthesis
‎     ↓
‎active
‎
‎
‎---
‎
‎And now the loop continues
‎
‎Photosynthesis might produce:
‎
‎Research
‎   ↓
‎Generate diagnostic
‎   ↓
‎Observe score
‎   ↓
‎Reason
‎   ↓
‎Teach-back
‎   ↓
‎Retest
‎   ↓
‎Observe
‎   ↓
‎Reason
‎   ↓
‎Pass
‎
‎Then Matter.
‎
‎Then Energy.
‎
‎And so on.
‎
‎
‎---
‎
‎Here's the whole pipeline in one picture
‎
‎This is the architecture I think you were looking for:
‎
‎USER PROMPT
‎                         │
‎                         ▼
‎                  ┌─────────────┐
‎                  │     GOAL    │
‎                  └──────┬──────┘
‎                         │
‎                         ▼
‎              ┌────────────────────┐
‎              │        REASON      │
‎              │ LLM decides what   │
‎              │ information/action │
‎              │ it needs next      │
‎              └─────────┬──────────┘
‎                        │
‎                        ▼
‎                  ┌───────────┐
‎                  │   TOOL    │
‎                  └─────┬─────┘
‎                        │
‎                        ▼
‎              ┌────────────────────┐
‎              │      HARNESS       │
‎              │                    │
‎              │ permission         │
‎              │ validation         │
‎              │ budget             │
‎              │ state              │
‎              │ policy             │
‎              │ concurrency        │
‎              └─────────┬──────────┘
‎                        │
‎                        ▼
‎                    EXECUTE
‎                        │
‎                        ▼
‎                  OBSERVATION
‎                        │
‎                        ▼
‎              ┌────────────────────┐
‎              │        REASON      │
‎              │                    │
‎              │ What did I learn? │
‎              │ What do I need?   │
‎              │ What next?        │
‎              └─────────┬──────────┘
‎                        │
‎                        ▼
‎                      TOOL
‎                        │
‎                        ▼
‎                       ...
‎                        │
‎                        ▼
‎                 VERIFIED OUTCOME
‎
‎And this is the key:
‎
‎The loop is not:
‎
‎research
‎↓
‎draft
‎↓
‎verification
‎↓
‎action
‎↓
‎reflection
‎
‎Those are possible types of activity.
‎
‎The actual loop is:
‎
‎┌──────────────┐
‎                │     GOAL     │
‎                └──────┬───────┘
‎                       ↓
‎                    REASON
‎                       ↓
‎                     ACT
‎                       ↓
‎                   OBSERVE
‎                       ↓
‎                    REASON
‎                       ↓
‎                     ACT
‎                       ↓
‎                   OBSERVE
‎                       ↓
‎                      ...
‎
‎And what the agent does next is determined by what it just observed.
‎
‎That's the fundamental thing I would change in your v2.
‎
‎Your deterministic controller then sits around that loop as the guardrail, not as the thing pretending to be the LLM's thinking.
‎
‎So the final Akoro architecture becomes:
‎
‎> Goal → LLM Reason → Tool → Harness → Observation → LLM Reason → Tool → Harness → Observation → … → Verified learning outcome.
‎
‎
‎
‎That is essentially taking the coding-agent harness pattern and adapting it to a learning agent.
‎
