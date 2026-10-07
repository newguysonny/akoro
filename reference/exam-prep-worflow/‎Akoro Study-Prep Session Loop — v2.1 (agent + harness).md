‎You're right, and this is the correction that matters. My v2 built a very disciplined workflow engine and then dressed it in thinking-block clothing. That's not an agent. The difference you named is exactly right: the agent chooses what to do next based on what it just observed; the harness decides whether that choice is allowed. deliberate() was pretending to be the first when it was actually the second.
‎
‎Below is the revised v2 with the architecture you described. Unchanged sections are marked so you can see the diff at a glance.
‎
‎---
‎
‎Akoro Study-Prep Session Loop — v2.1 (agent + harness)
‎
‎Supersedes v2. The safety/state discipline from v2 survives intact. What changes is who decides the next step: an LLM Study Agent reasons and proposes; a deterministic Harness validates and executes; a deterministic Education Engine scores and records. The agent loop is Goal → Reason → Act → Observe → Reason → … → verified outcome. deliberate() is rescoped from "the system's thinking" to "the harness's narration of what it just did or refused."
‎
‎---
‎
‎0. What changed from v1
‎
‎(unchanged)
‎
‎---
‎
‎1. Three layers, and who triggers what
‎
‎(structure unchanged — one addition)
‎
‎Layer Lifetime Owns Exists?
‎Study session Minutes–days, many requests Which topics, in what order, what to do after a miss New
‎Agent loop Within one session step — bounded iterations What information to fetch next, which tool to call, when to propose a plan / advance / defer New (this revision)
‎Topic workflow One topic, several requests One topic's practice run Exists (exam-prep)
‎Chat turn One request Streaming one reply Exists
‎
‎```
‎Study session (harness-owned state)
‎   ├─ topic 1 ── agent loop (bounded) ── exam-prep run ── workflow row
‎   ├─ topic 2 ── agent loop ── exam-prep run ── workflow row
‎   └─ …
‎Every iteration inside the agent loop is a reason→act→observe step. Every
‎tool call goes through the harness. The LLM never writes state.
‎```
‎
‎Rule: the harness is the only writer of session and run rows. The agent proposes; the harness approves or rejects. The Education Engine is the only thing that scores and transitions — the agent cannot compute a score, only observe one.
‎
‎---
‎
‎2. State models
‎
‎(unchanged)
‎
‎---
‎
‎3. End-to-end trace (agent activity log)
‎
‎The trace is no longer a fixed research → draft → verification → action. It is the sequence of agent intents, tool calls, harness decisions, and observations that actually occurred. The agent may research twice in a row, draft, verify, then research again — the log reflects the real path.
‎
‎Learner prompt: "I have a test covering the whole term for Basic Science, can we prepare for that?"
‎
‎Step 0 — Goal formed
‎
‎```json
‎{ "goal": "Prepare learner for whole-term Basic Science exam",
‎  "subject": "Basic Science", "class_level": "JSS1", "entry_mode": "syllabus" }
‎```
‎
‎No state, no spend, no research yet.
‎
‎Step 1 — Agent loop, iteration 1
‎
‎```text
‎[agent intent]  "I need to know what the syllabus covers. I'll resolve it."
‎[tool call]     syllabus.resolve({subject, class_level, scope: "whole_term"})
‎[harness]       ✓ authn · ✓ tool permitted · ✓ read-only · EXECUTE
‎[observation]   6 topics returned.
‎```
‎
‎Step 2 — Agent loop, iteration 2
‎
‎```text
‎[agent intent]  "I know the topics, but I don't know where the learner stands."
‎[tool call]     learner.get_state({topics: [...6 ids]})
‎[harness]       ✓ owner check · ✓ read-only · EXECUTE
‎[observation]   water-cycle 0.42 · photosynthesis 0.61 · human-body 0.82
‎                matter 0.71 · energy 0.55 · force-motion 0.76
‎```
‎
‎Step 3 — Agent loop, iteration 3
‎
‎```text
‎[agent intent]  "Lowest isn't necessarily first — prerequisites matter. Checking the graph."
‎[tool call]     concept.get_prerequisites({topics: [...]})
‎[harness]       ✓ read-only · EXECUTE
‎[observation]   water-cycle → photosynthesis ; matter → energy
‎```
‎
‎Step 4 — Agent loop, iteration 4
‎
‎```text
‎[agent intent]  "Enough information. I'll propose an ordered plan."
‎[agent action]  propose_plan({
‎                  topics: [water-cycle, photosynthesis, matter, energy,
‎                           force-motion, human-body]
‎                })
‎[harness]       ✓ all topics from approved syllabus
‎                ✓ water-cycle before photosynthesis
‎                ✓ matter before energy
‎                ✓ 6 ≤ 12 max
‎                ✓ estimate 18 coins · wallet 25
‎                → APPROVED · session: awaiting_confirmation
‎```
‎
‎Step 5 — Human gate
‎
‎```text
‎┌─ Your Basic Science plan ──────────────────────────────┐
‎│ 6 topics · 18 coins                                     │
‎│ 1. Water Cycle   2. Photosynthesis   3. Matter          │
‎│ 4. Energy        5. Force & Motion   6. Human Body      │
‎│                                   [ Approve ] [ Adjust ]│
‎└─────────────────────────────────────────────────────────┘
‎```
‎
‎Learner taps Approve. Harness does one conditional update awaiting_confirmation → topic_active. The LLM never approves spend.
‎
‎Step 6 — Agent loop for Water Cycle
‎
‎```text
‎[agent intent]  "Low evidence (0.42). I need a diagnostic, not an assumption."
‎[tool call]     practice.generate({topic: water-cycle, mode: diagnostic, n: 5})
‎[harness]       ✓ session confirmed · ✓ topic active · ✓ budget ok
‎                ✓ attempt limit ok · ✓ topic belongs to session → EXECUTE
‎[observation]   Practice shown to learner.
‎```
‎
‎Step 7 — Learner submits. Education Engine scores.
‎
‎```text
‎[engine]        score = 3/5 (60%) · threshold 70% · attempts 1/3
‎[observation to agent]
‎                { topic: water-cycle, percentage: 60, threshold: 70,
‎                  attempts_remaining: 2 }
‎```
‎
‎The agent never sees the answer key, and never computes the score.
‎
‎Step 8 — Agent loop, reflection
‎
‎```text
‎[agent intent]  "Below threshold with attempts left. A retest now without
‎                 intervention likely repeats the miss. Offering teach-back."
‎[agent action]  offer_strategy({topic: water-cycle, strategy: "teach_back"})
‎[harness]       ✓ score below threshold · ✓ attempts remaining
‎                ✓ strategy in curated list · ✓ learner-gated → APPROVED
‎[UI]            "You scored 3/5. Let's strengthen this before the retest."
‎                [ Teach it back ]
‎```
‎
‎Step 9 — Human gate (teach-back)
‎
‎Learner opens TeachAgentModal, teaches, presses I've taught it back. This sends learnerConfirmedReady: true. The harness records the confirmation; it does not infer teach-back success.
‎
‎Step 10 — Agent loop, iteration after retest
‎
‎```text
‎[agent intent]  "Intervention done. Fresh retest."
‎[tool call]     practice.generate({topic: water-cycle, mode: retest, fresh: true})
‎[harness]       ✓ learnerConfirmedReady · ✓ attempts remaining → EXECUTE
‎[observation]   retest shown
‎[learner]       5/5
‎[engine]        score 100% ≥ 70% · status passed
‎[observation to agent]
‎                { topic: water-cycle, status: "passed" }
‎```
‎
‎Step 11 — Agent loop, advance
‎
‎```text
‎[agent intent]  "Water Cycle settled. Advancing to next planned topic."
‎[agent action]  advance_topic({next: photosynthesis})
‎[harness]       ✓ current topic settled · ✓ next in session
‎                ✓ session active · ✓ budget ok
‎                → water-cycle: understood ; photosynthesis: active
‎```
‎
‎Step 12 — Improvise at Human Body (cap-out)
‎
‎```text
‎[observation]   diagnostic 1/5 · retest 3/5 · attempts exhausted
‎[agent intent]  "Cap reached. No instructor assigned, so escalation isn't
‎                 available. Deferring and finishing lighter topics first;
‎                 one retry afterward."
‎[agent action]  defer_topic({topic: human-body, retry_after: force-motion,
‎                             reason_code: "attempt_cap_reached"})
‎[harness]       ✓ one deferred retry available · ✓ budget · ✓ transition legal
‎                → APPROVED · topic: deferred
‎```
‎
‎Step 13 — Synthesis
‎
‎```text
‎[agent action]  conclude_session()
‎[harness]       ✓ all topics settled (understood | flagged | capped) → completed
‎[summary]       5 of 6 understood · Human Body Systems flagged for instructor
‎                Covers generated practice only. Human Body Systems still needs work.
‎```
‎
‎UI render: each block shows [agent intent] as the model's stated reason (a schema-validated field, not a CoT transcript), [tool call]/[harness]/[observation] as deterministic records. This is what makes it read like a coding-agent trace: an alternating intent/act/observe log, not a canned sequence.
‎
‎---
‎
‎4. Roles
‎
‎No concurrent agents against one session. One agent, one harness, sequential.
‎
‎Role Kind Writes state? v2.1 scope
‎Study Agent LLM, stateless per loop No Receives goal + observation log + tool schemas. Emits one structured action per iteration.
‎Harness Deterministic code Yes (session + run rows) Validates agent actions, enforces state machine, permissions, budget, concurrency, policy. Executes approved tool calls. Narrates rejections via deliberate().
‎Education Engine Deterministic pure functions Only via harness Scoring, threshold comparison, mastery evidence write-back, concept policy.
‎Tools Deterministic adapters Via harness only syllabus.resolve, learner.get_state, concept.get_prerequisites, practice.generate, practice.submit, content.search, session.get_state, …
‎Learn UI Existing modal No Learner-gated teach-back, unchanged.
‎Chat Existing LLM No Calls plan-only tools; never owns session state.
‎
‎4.1 Curated strategy library (unchanged)
‎
‎```
‎teach_back · different_analogy · interleave · space_out · escalate_human
‎```
‎
‎The agent chooses which strategy to offer, from this list. The harness rejects anything not on it. The agent cannot invent educational policy (attempt caps, thresholds, cost rules).
‎
‎4.2 deliberate() — rescoped
‎
‎deliberate() is not the agent's thinking. It is the harness's narration of its own deterministic decisions and of tool results. The agent's stated intent comes from the LLM's action schema (intent field), which is stored separately and labeled as an unverified intent.
‎
‎Signature (unchanged). Purpose (changed).
‎
‎```js
‎// Narrates a HARNESS decision or an OBSERVATION. Never narrates the LLM.
‎deliberate("harness_rejection", { reason_code: "insufficient_balance",
‎                                  attempted: "practice.generate",
‎                                  balance: 0, cost: 3 })
‎// → "Cannot generate practice: wallet balance is 0, cost is 3. Pausing session."
‎
‎deliberate("observation", { tool: "learner.get_state",
‎                            below_threshold: 3,
‎                            labels: ["Water Cycle", "Energy", "Photosynthesis"] })
‎// → "3 topics below 70% — Water Cycle, Energy, Photosynthesis."
‎
‎deliberate("harness_approval", { action: "advance_topic",
‎                                 from: "water-cycle", to: "photosynthesis" })
‎// → "Water Cycle settled at 5/5. Advancing to Photosynthesis."
‎```
‎
‎Guardrails (same as v2, restated):
‎
‎· Input is a decision_node enum + a typed facts struct. No free-text argument exists.
‎· Facts are the numbers the harness already acted on.
‎· Never claims what the learner understands; only what was scored, counted, chosen, or refused.
‎· Renders from policy_version-tagged templates. Snapshot-tested.
‎
‎4.3 Agent intent field
‎
‎The LLM emits, alongside each action, one bounded field:
‎
‎```json
‎{
‎  "tool": "learner.get_state",
‎  "intent": "I need to know where the learner stands before proposing an order.",
‎  "arguments": { "topics": ["water-cycle", "..."] }
‎}
‎```
‎
‎Rules:
‎
‎· Stored with origin: "agent_stated_intent". Never treated as fact.
‎· Length-capped, profanity-filtered, rendered in a visually distinct style from harness narration.
‎· The UI says "agent says:" — not "the system found:". This is the honest version of "thinking out loud."
‎· This is the only LLM-origin string that leaves the loop.
‎
‎---
‎
‎5. Topic resolvers (unchanged)
‎
‎---
‎
‎6. Learner repo and tools
‎
‎6.1 Repo — now exposed as read tools to the agent
‎
‎Tool Reads Notes
‎syllabus.resolve §5 resolver Primary
‎learner.get_state learner_concept_state (0–1) → fallback knowledge_confidence (0–100, converted) Scale conversion explicit
‎learner.get_history Prior learner_exam_prep_attempts missed-objective notes Bounded, factual
‎concept.get_prerequisites concept_edges (status approved) Empty for material scope
‎content.search getSyllabusGrounding, getPastQuestionGrounding (verified only) Internal stores only
‎session.get_state Session + topic rows Agent sees the same state the harness does
‎
‎6.2 Grounded content (unchanged)
‎
‎6.3 Chat tools (unchanged surface)
‎
‎Tool Effect Gate
‎start_study_prep_session Creates session, runs one agent loop iteration to produce a plan + cost. No generation, no spend. AKORO_STUDY_PREP_ENABLED
‎get_study_prep_session Read-only status same
‎
‎No model-callable confirm. No model-callable advance_topic, defer_topic, practice.generate, practice.submit. Those live inside the session loop, not in chat.
‎
‎6.4 REST (unchanged surface)
‎
‎(unchanged from v2)
‎
‎6.5 Tool permission levels (new)
‎
‎Level Example tools Who can call
‎read syllabus.resolve, learner.get_state, concept.get_prerequisites, content.search, session.get_state Chat tool + agent, inside a session
‎propose plan.propose, offer_strategy, advance_topic, defer_topic, conclude_session Agent only; harness validates
‎execute practice.generate, practice.submit, wallet.charge, session transitions Harness only; the agent can request these via propose actions, never call them
‎
‎Rule: if a tool changes state or spends money, it is execute and unreachable by the LLM.
‎
‎---
‎
‎7. Data model (additive)
‎
‎```sql
‎study_prep_events                       -- append-only agent activity log
‎  id, session_id, topic_id null,
‎  iteration int,                        -- loop counter within a session step
‎  event_type text,                      -- agent_tool_call | agent_action
‎                                        -- | harness_decision | observation
‎                                        -- | human_gate | engine_result
‎  tool text null,                       -- tool name when applicable
‎  action text null,                     -- propose_plan | advance_topic | …
‎  agent_intent text null,               -- LLM-stated intent. origin-tagged.
‎  origin text not null,                 -- 'agent_stated_intent' | 'harness' | 'engine'
‎  decision_node text null,              -- deliberate() node, when narrated
‎  narrative text null,                  -- rendered by deliberate(); cache only
‎  facts jsonb,                          -- bounded, no raw chat, no answer keys
‎  policy_version text,
‎  created_at
‎```
‎
‎facts holds observable data only (scores, states, strategy ids, counts). agent_intent is the only LLM-origin field, explicitly labeled.
‎
‎Example rows for the Water Cycle diagnostic step:
‎
‎```json
‎[
‎  { "event_type": "agent_tool_call", "origin": "agent_stated_intent",
‎    "tool": "practice.generate",
‎    "agent_intent": "Low evidence (0.42). I need a diagnostic, not an assumption.",
‎    "facts": { "mode": "diagnostic", "question_count": 5 } },
‎  { "event_type": "harness_decision", "origin": "harness",
‎    "decision_node": "approve_generate",
‎    "facts": { "checks": ["session_active","topic_active","budget_ok","attempt_limit_ok"],
‎               "outcome": "approved" },
‎    "narrative": "Session active, topic active, budget sufficient. Generating." },
‎  { "event_type": "observation", "origin": "engine",
‎    "facts": { "score": 3, "total": 5, "percentage": 60,
‎               "threshold": 70, "attempts_remaining": 2 },
‎    "narrative": "3/5 — below the 70% bar. 2 attempts remaining." }
‎]
‎```
‎
‎Additive columns on existing tables:
‎
‎· adaptive_workflow_runs.study_prep_session_id uuid null (unchanged)
‎· learner_exam_prep_runs.max_attempts — unchanged; cram override at creation
‎
‎---
‎
‎8. Changes to existing code
‎
‎8.1–8.6
‎
‎(unchanged)
‎
‎8.7 Tool registry (new)
‎
‎```js
‎// tools/registry.js
‎export const TOOLS = {
‎  "syllabus.resolve":        { level: "read",    handler: resolveSyllabus },
‎  "learner.get_state":       { level: "read",    handler: getLearnerState },
‎  "concept.get_prerequisites":{ level: "read",   handler: getPrerequisites },
‎  "content.search":          { level: "read",    handler: searchContent },
‎  "session.get_state":       { level: "read",    handler: getSessionState },
‎  "practice.generate":       { level: "execute", handler: generatePractice, cost: true },
‎  "practice.submit":         { level: "execute", handler: submitAttempt,   cost: false },
‎  // agent proposal actions are handled by the harness, not called directly
‎  "propose_plan":            { level: "propose", handler: harness.proposePlan },
‎  "offer_strategy":          { level: "propose", handler: harness.offerStrategy },
‎  "advance_topic":           { level: "propose", handler: harness.advanceTopic },
‎  "defer_topic":             { level: "propose", handler: harness.deferTopic },
‎  "conclude_session":        { level: "propose", handler: harness.concludeSession },
‎};
‎```
‎
‎The agent receives only read schemas + propose action schemas. execute tools are not in the agent's tool list — they are effects of approved proposals.
‎
‎8.8 Agent loop runner (new)
‎
‎```js
‎// study-prep/agent-loop.js
‎export async function runAgentStep({ sessionId, topicId, goal, maxIterations = 6 }) {
‎  for (let i = 0; i < maxIterations; i++) {
‎    const obs = await buildObservationLog(sessionId, topicId);
‎    const action = await studyAgent.reason({ goal, obs, tools: AGENT_TOOL_SCHEMAS });
‎    await recordEvent({ event_type: "agent_tool_call"|"agent_action",
‎                        origin: "agent_stated_intent", ...action });
‎    const result = await harness.dispatch({ sessionId, topicId, action });
‎    await recordEvent({ event_type: "harness_decision", origin: "harness", ...result });
‎    if (result.terminal) return result;   // plan proposed, topic settled, or paused
‎  }
‎  return { terminal: true, reason: "max_iterations_reached" };  // fail-safe
‎}
‎```
‎
‎· Bounded. maxIterations per step is a harness constant, not a model choice.
‎· Terminal actions: propose_plan (returns plan to caller), advance_topic, defer_topic, conclude_session, or a harness pause due to 402.
‎· If the agent loops without reaching a terminal action, the harness stops it and surfaces agent_loop_cap — never silently continues.
‎
‎8.9 deliberate() rescope (new)
‎
‎· Keep the function. Change its callers: only harness decisions and engine observations call it. The agent's stated intent never routes through it.
‎· Snapshot tests updated to cover harness_rejection nodes (insufficient_balance, attempt_cap_exceeded, prerequisite_violation, tool_not_permitted).
‎
‎---
‎
‎9. Cost, billing, concurrency, autonomy
‎
‎(unchanged in substance; reframed as harness policy)
‎
‎· Agent cannot override policy. Attempt caps, thresholds, per-session topic caps, coin cost, and autonomy boundaries are harness-enforced. When the agent proposes a disallowed action, the harness returns a structured rejection the agent observes on the next iteration. The agent's job is to adapt, not to argue.
‎· One LLM call per loop iteration. Cost model accounts for this separately from generation cost. Loop cap bounds worst-case spend per step.
‎· 402 mid-loop: harness returns insufficient_balance; agent observes; its next action should be pause. If the agent tries anything else, harness refuses. Session → paused with topic intact.
‎· Everything else (wallet-first charge, single-writer, conditional updates, teach-back gate, no answer key on client) unchanged.
‎
‎---
‎
‎10. Decisions to make (new + carried)
‎
‎# Decision Recommendation
‎1 Max agent iterations per step 6. Enough for research → draft → verify → act; low enough to bound cost.
‎2 Agent intent display in UI Show as "agent says:", visually distinct from harness narration. Never bolded, never factual-styled.
‎3 Agent proposes outside curated strategy list Harness rejects with strategy_not_permitted. Agent sees rejection and must pick from the list.
‎4 Agent proposes valid-but-suboptimal plan (e.g., ignores prerequisites but satisfiable) Harness enforces hard constraints only (prereqs, caps, budget). Soft ordering is the agent's call. Education Engine records the outcome so we can review.
‎5 Retry of capped topic One deferred retry per session, attempts reset. (unchanged)
‎6 Cram mode max_attempts = 1 + depth: diagnostic_only. (unchanged)
‎7 Session topic cap 12. (unchanged)
‎8 Loop cap reached without terminal action Session → paused with reason: agent_loop_cap. Learner sees "I got stuck — tap to retry or adjust." Never silent continuation.
‎9 Replaying a session Events table is the source of truth. The UI can replay the agent activity log exactly; it does not re-run the LLM.
‎
‎---
‎
‎11. Suggested build order (revised)
‎
‎1. Extract the exam-prep service + fix the submit race (§8.1–8.2). (unchanged)
‎2. Session tables + harness skeleton + tool registry (§7, §8.7). Deterministic. No LLM yet. Every transition is a conditional update with a unit test, including concurrent-confirm no-op and double-submit.
‎3. deliberate() + harness narration + event log (§4.2, §7). Snapshot-tested over harness decisions only. Still no LLM.
‎4. Syllabus resolver on the DB tables for JSS1 Basic Science. Ingest the data first.
‎5. Education Engine as pure functions — score, threshold, mastery evidence write-back. Deterministic. Unit tests with fixed fixtures.
‎6. Study Agent loop, one iteration at a time (§8.8). Start with a stub agent that just calls syllabus.resolve then propose_plan. Ship that end-to-end. Then add the observation log and real reasoning.
‎7. Plan-only chat tool + plan card + confirm (§6.3–6.4). No generation yet.
‎8. Topic loop in the UI driven by the harness's sessionNext, rendering the agent activity log.
‎9. Course resolver, then material resolver.
‎
‎Acceptance tests (deterministic fixtures; no LLM in the test path except a stubbed agent):
‎
‎· Stub agent emitting propose_plan with a prereq-violating order → harness rejects, agent re-proposes valid order. Snapshot both harness_decision rows.
‎· Stub agent emitting practice.generate when attempts_remaining = 0 → rejected with attempt_cap_exceeded; agent observes and picks offer_strategy or defer_topic. No generation cost charged.
‎· Stub agent looping past maxIterations → session pauses with agent_loop_cap; no partial state.
‎· Concurrent confirm → one transition, one winner.
‎· 402 mid-loop → paused, resumable, no lost topic.
‎· Teach-back gate unchanged: practice.generate(mode:retest) without learnerConfirmedReady → rejected.
‎· Six-topic session leaves other workflows visible (§8.3).
‎· No coins spent before confirm.
‎· Summary contains only recorded facts, never agent intent.
‎· Every agent_intent field is length-capped and origin-tagged; a schema test fails if any other LLM-origin string appears in events.
‎
‎---
‎
‎12. Still open
‎
‎· Agent intent quality. The intent field can drift toward CoT. Cap its length hard (e.g., ≤240 chars), schema-validate it, and audit a sample. If it starts narrating step-by-step reasoning, tighten until it's a one-sentence stated purpose.
‎· Per-loop LLM cost. A 6-iteration loop for a plan is 6 LLM calls before any spend. Price it into estimate_session_cost or accept it as fixed overhead. Recommendation: count it in the cost estimate shown on the plan card, at a rounded value, so the learner isn't surprised.
‎· Agent choice of defer_topic vs flag_and_skip. Both are valid for a cap-out. The agent picks; the Education Engine records which. Decide after we have data which reads better to learners.
‎· Whether the agent should ever call content.search during the loop. It's read-only and useful, but adds latency and tokens. Start without it (syllabus + learner state is enough for a plan). Add only if plans are visibly worse.
‎· narrative_facts label vs id. (carried from v2) Store both; render label, fall back to id.
‎· UI pacing. Real elapsed time per iteration, not fabricated. If a loop iteration takes 80ms because the harness short-circuited, show 80ms. Trust comes from honesty here, not padding.
‎· Guardian Angel. (carried) Still unresolved — nothing verifies teach-back claims against approved sources.
‎· JSS1 Basic Science rows in the DB. (carried) Confirm before building the resolver against it.
‎
‎---
‎
‎The short version of the change: v2 asked "what would the system say if it were thinking?" v2.1 asks "what did the agent just do, what did the harness decide, and what did it observe?" The first is theatre. The second is the coding-agent harness you're actually studying.
‎
