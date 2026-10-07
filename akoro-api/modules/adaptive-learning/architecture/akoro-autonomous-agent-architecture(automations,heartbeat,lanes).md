‎Udemy teaches you.
‎Akoro lets you teach an AI that learns with you.
‎
‎Akoro doesn't wait for you to ask what to learn next. It identifies what it is forgetting, what it is weak at, and what it should practice next.
‎
‎Yes. Moving the agent to a cloud server is part of the solution, but the important change is architectural, not simply “put it on a server.”
‎
‎Right now Akoro is essentially:
‎
‎> User → asks → Agent responds
‎
‎
‎
‎To genuinely become proactive, you want:
‎
‎> Agent → continuously monitors its state → decides what it should do → schedules work → acts → records the result → repeats
‎
‎
‎
‎That is much closer to the autonomous behavior you're describing.
‎
‎What I would build
‎
‎Your existing architecture can evolve into four layers:
‎
‎1. Agent brain
‎
‎Current knowledge
‎
‎Knowledge confidence
‎
‎Memory decay
‎
‎Learning gaps
‎
‎XP/level
‎
‎Battle history
‎
‎Learning goals
‎
‎
‎2. Agent scheduler A background service periodically asks:
‎
‎> “What does this agent need to do right now?”
‎
‎
‎
‎For example:
‎
‎Photosynthesis memory is fading → schedule review
‎
‎Student hasn't taught the agent for 5 days → send learning prompt
‎
‎Agent lost its last biology battle → identify weak concepts
‎
‎Agent has mastered algebra → find a harder challenge
‎
‎Agent hasn't battled recently → find an opponent
‎
‎School released a new lesson → recommend it to the student
‎
‎
‎3. Agent worker
‎
‎This actually performs the work.
‎
‎For example:
‎
‎Scheduler
‎   ↓
‎Agent needs to improve Biology
‎   ↓
‎Create learning task
‎   ↓
‎Retrieve relevant memory
‎   ↓
‎Generate lesson/review
‎   ↓
‎Challenge itself / another agent
‎   ↓
‎Judge result
‎   ↓
‎Update memory
‎   ↓
‎Schedule next action
‎
‎4. Notification/event layer
‎
‎The agent can then proactively communicate:
‎
‎> “Mary, I noticed I'm getting weaker at Photosynthesis. Can you reteach me?”
‎
‎
‎
‎Or:
‎
‎> “I haven't battled another Biology agent recently. I found an opponent around my level. Want me to challenge them?”
‎
‎
‎
‎Or eventually:
‎
‎> “Your school just added a lesson on Genetics. I think it would help strengthen one of my weak areas.”
‎
‎
‎
‎That's the important distinction.
‎
‎
‎---
‎
‎Do you need to run it on a terminal?
‎
‎No.
‎
‎A terminal is just where you launch the process. You need a persistent backend/worker.
‎
‎For example, you could have:
‎
‎AKORO CLOUD
‎                         │
‎             ┌───────────┴───────────┐
‎             │                       │
‎        API Server              Agent Worker
‎        Express.js              Node.js
‎             │                       │
‎             └───────────┬───────────┘
‎                         │
‎                      Postgres
‎                         │
‎                    Agent Memory
‎
‎Your Express server handles things like:
‎
‎POST /agents
‎POST /learning/ingest
‎POST /battles
‎GET  /agents/:id
‎
‎while the Agent Worker runs independently:
‎
‎every minute
‎     ↓
‎find agents with pending tasks
‎     ↓
‎execute tasks
‎     ↓
‎update database
‎     ↓
‎schedule next task
‎
‎You could deploy both on something like Render, Railway, Fly.io, AWS, etc. The important thing is that the worker remains alive.
‎
‎
‎---
‎
‎But there's an even better architecture for Akoro
‎
‎I wouldn't make the agent wake up every minute and ask an LLM:
‎
‎> “What should I do?”
‎
‎
‎
‎That would become ridiculously expensive at scale.
‎
‎Instead, make the database/event system determine when something needs attention.
‎
‎For example:
‎
‎Knowledge confidence < 0.3
‎        ↓
‎learning_task created
‎
‎Battle lost
‎        ↓
‎learning_task created
‎
‎Memory decay threshold reached
‎        ↓
‎review_task created
‎
‎New school lesson
‎        ↓
‎recommendation_task created
‎
‎Then the worker only calls OpenAI when there is actual work.
‎
‎That gives you:
‎
‎Cheap idle agents
‎
‎An agent that doesn't need anything isn't constantly consuming tokens.
‎
‎
‎---
‎
‎Your autonomous loop could look like this
‎
‎┌──────────────┐
‎                 │ Agent Memory │
‎                 └──────┬───────┘
‎                        ↓
‎                Memory Decay Engine
‎                        ↓
‎                 Detect Weakness
‎                        ↓
‎                Create Learning Task
‎                        ↓
‎              ┌─────────┴─────────┐
‎              ↓                   ↓
‎        Ask Student           Self Practice
‎              ↓                   ↓
‎        New Knowledge        Generate Challenge
‎              └─────────┬─────────┘
‎                        ↓
‎                      Battle
‎                        ↓
‎                     Judge
‎                        ↓
‎                 Update Memory
‎                        ↓
‎                  Update XP/Stats
‎                        ↓
‎                Schedule Next Task
‎                        ↓
‎                       ↻
‎
‎That loop is much more interesting for Akoro than simply giving the agent tools.
‎
‎
‎---
‎
‎And this changes your OpenClaw comparison
‎
‎You don't need to claim:
‎
‎> “Akoro is OpenClaw for education.”
‎
‎
‎
‎I'd actually make the distinction sharper:
‎
‎Udemy teaches you.
‎Akoro lets you teach an AI that learns with you.
‎
‎Then the autonomous component becomes:
‎
‎> Your AI doesn't wait for you to ask what to learn next. It identifies what it is forgetting, what it is weak at, and what it should practice next.
‎
‎
‎
‎That is a much stronger product story.
‎
‎And your battle system gives the autonomous agent something meaningful to do in the background:
‎
‎Agent notices weakness
‎       ↓
‎Practices
‎       ↓
‎Finds comparable agent
‎       ↓
‎Sends challenge
‎       ↓
‎General Judge evaluates
‎       ↓
‎Agent discovers new weaknesses
‎       ↓
‎Learns again
‎
‎Now you have a genuine autonomous learning loop, rather than just an AI chatbot.
‎
‎One important correction to our previous architecture
‎
‎I would not have the autonomous worker directly generate arbitrary knowledge from the internet and teach itself. That can create a self-reinforcing hallucination loop:
‎
‎> AI learns something wrong → AI battles using wrong information → AI confirms itself → confidence increases.
‎
‎
‎
‎For Akoro, autonomous learning should initially mean autonomous learning behavior, not unrestricted autonomous knowledge acquisition.
‎
‎The agent can decide:
‎
‎> “I need to learn Photosynthesis.”
‎
‎
‎
‎But the student, school curriculum, approved course material, or trusted knowledge source should provide/validate the actual knowledge.
‎
‎That distinction could become one of Akoro's strongest educational safety features.


# Akoro Autonomous Agent Architecture — Refined from OpenClaw's Actual Source

The plan you were given (4-layer: brain / scheduler / worker / notification) is directionally right. Having now read OpenClaw's actual source and docs — not just commentary about it — here's where it's imprecise, and what to change.

## 1. The core fix: split "scheduler" into two different mechanisms

Your plan treats "the scheduler" as one thing: something that periodically asks "what does this agent need to do?" OpenClaw doesn't do this — it has **two distinct mechanisms**, and conflating them is exactly the trap your plan flags but doesn't fully escape.

**Automations (cron jobs)** — deterministic, scheduled, no LLM call to decide *whether* to run:
- "Every night at 3:00, run memory decay for all agents"
- "Every 5 minutes, check for agents whose knowledge confidence dropped below 0.3"
- These are plain scheduled jobs. No model is invoked to decide if they should fire — the trigger condition is a SQL query or a cron expression, full stop.

**Heartbeat** — a cheap, periodic *agent turn* (yes, this does call the LLM, but rarely and briefly), whose entire job is: check a small scratchpad of "things flagged for my attention" and reply `NO_REPLY` if there's nothing there. It does **not** infer new work, doesn't repeat stale context, and defers all actual recurring work to automations. Default cadence in OpenClaw is 30–60 minutes, and it explicitly does nothing if the scratch is empty.

**Why this matters for your plan:** you already correctly rejected "wake up every minute and ask an LLM what to do" as too expensive. OpenClaw's answer isn't to avoid the LLM check — it's to make the *routine* recurring stuff a zero-LLM-cost deterministic job (automations), and reserve the (cheap, infrequent) LLM check for a genuinely tiny "anything flagged?" scratchpad (heartbeat). Your original plan's `learning_task` / `review_task` creation via DB triggers **is** the automations layer — you had it right. What was missing was heartbeat as a *separate*, cheaper, LLM-touching layer sitting on top, for the stuff that's genuinely ambiguous enough to need a model glance (e.g., "is this student's pattern of losses worth surfacing, or just noise?").

## 2. Mapped onto Akoro

| OpenClaw primitive | Akoro equivalent |
|---|---|
| Automation/cron job | DB-triggered task creation: `knowledge_confidence < 0.3` → `learning_task`, `battle_lost` → `review_task`, decay threshold → `review_task`. Pure SQL/deterministic, zero LLM cost, exactly as your original plan described. |
| Heartbeat | A per-agent lightweight check (not per-minute — more like every 30–60 min per active agent, matching OpenClaw's default) that looks at that agent's small scratch of flagged items and decides whether anything is worth a **proactive message to the student** right now, vs. just queueing quietly. Defaults to silence. |
| Lane queue (per-session serialization) | Per-agent-id serialization of task execution. This is the piece your plan is missing entirely, and it matters: if a decay-triggered review task and a battle-loss task both fire for the same agent within the same minute, you need them to execute serially against that agent's memory/XP state, not concurrently — otherwise you get race conditions corrupting confidence scores or XP (classic double-write bug). OpenClaw's rule: one active run per session, enforced with a FIFO lane keyed by session/agent id, before it ever hits a shared "main" concurrency pool. |
| Session transcript vs. curated memory file | Your `agent memory` layer should split the same way: raw battle/interaction history (append-only log, cheap to write, rarely re-read in full) vs. a small curated "current state" — knowledge confidence per topic, active weaknesses, recent goal — that's what the agent worker actually loads each cycle. Don't feed the full battle history into the model on every task; feed the curated summary, same as OpenClaw's memory.md vs. session JSONL split. |
| `NO_REPLY` default + active hours + no-repeat-stale-context | Bake this into your notification layer explicitly. Without it you'll get the failure mode OpenClaw's own docs warn about: an agent that pings the student every cycle because it's re-deriving the same "you're weak at X" conclusion from data that hasn't changed. Heartbeat-equivalent should suppress a repeat notification about the same weakness until either it's addressed or a cooldown passes. |

## 3. The one-line architecture, updated

Your original:
> Agent → continuously monitors its state → decides what it should do → schedules work → acts → records the result → repeats

Refined:
> DB state change → deterministic trigger creates a task row (no LLM) → per-agent lane serializes execution → worker picks up queued tasks, calls the model only when a task exists → periodic cheap heartbeat glances at a small "flagged" scratch to decide if anything's worth proactively telling the student → result recorded → next trigger

The distinction is subtle but real: your original implies the "decides what it should do" step involves the agent/LLM reasoning about its own state continuously. OpenClaw's actual design keeps that reasoning **out of the hot path** almost entirely — the database decides what needs doing; the model only ever gets invoked to *execute* a specific, already-identified task, or to make the much smaller judgment call of "is this worth a proactive nudge." That's the real reason OpenClaw agents don't rack up runaway costs — not smarter prompting, but architecturally minimizing how often the LLM is asked anything at all.

## 4. One safety pattern worth adopting directly

OpenClaw treats third-party skills as a supply-chain risk (400+ malicious skills were published to their marketplace in one week in Jan 2026) and evaluates every capability on three axes: **capability × autonomy × authority** — risk compounds when autonomy (how long it acts unsupervised) and authority (what it's allowed to touch/write) increase together, regardless of how smart the model is.

Applied to Akoro: the original plan already flags the right instinct — "the agent can decide what to learn, but the student/school/curriculum should provide the actual knowledge" — but frame it explicitly as an **authority boundary**, not just a content-quality concern:
- **High autonomy, low authority** (agent decides its own study schedule, but can only pull from approved curriculum content) → safe, this is most of what you want.
- **High autonomy + high authority** (agent freely fetches and teaches itself from the open internet, unsupervised) → this is the exact "hazard zone" combination OpenClaw's own framework flags as dangerous, and it's also literally the failure mode your plan already worried about (self-reinforcing hallucination loops). Keep internet/knowledge-acquisition tools out of the autonomous loop entirely — only the *decision to study X* should be autonomous, never the *sourcing of what X is*.

## What I'd change from the original plan, concretely

1. Split "Agent scheduler" into **automations** (deterministic DB triggers, no LLM) and **heartbeat** (cheap periodic LLM glance at a small flagged-items scratch, defaults to silence).
2. Add **per-agent task serialization** (lane queue) — not in the original plan at all, and it's a real correctness bug waiting to happen at scale without it.
3. Split agent memory into **append-only interaction log** vs. **curated current-state summary** — only the latter feeds the worker's prompts.
4. Make notification suppression explicit: no repeat nudges about unchanged weaknesses; respect something like active hours for a school-context product.
5. Treat "what the agent is allowed to source knowledge from" as a hard authority boundary, not a soft quality guideline — no open-internet self-teaching in the autonomous loop, ever.


