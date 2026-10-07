# Akoro Protégé Agent — Complete Soul Stack Specification

**What this covers:** the AI "protégé" the student teaches — not Amara's tutor-agent (which quizzes/explains/plans, covered in [[akoro-agent-upgrade-plan]] and [[akoro-research-plan-act-pattern]]). This is the other half of the positioning: *"Udemy teaches you. Akoro lets you teach an AI that learns with you."* Consolidated from several prior planning passes into one complete reference — every component, engine, layer, and tracker mentioned across those passes is accounted for below, de-duplicated.

## The Complete Component Inventory (26 components, 4 tiers + supporting)

| Tier | Components | Count |
|---|---|---|
| **Tier 1: Cognitive Engine** | Knowledge Graph + Mastery, Understanding Tracking Rate, Forgetting Curves, Learner Profile, **Attention Span Engine**, **Reasoning Quality Tracker**, **Fatigue Decay Curve** | 10* |
| **Tier 2: Soul** | Emotion, Social, Drive, Noise, Identity, Narrative Memory, Relationship | 7 |
| **Tier 3: Experience** | Prompt Builder, Response Generator, Expression | 3 |
| **Supporting** | LLM Judge, Profile Inference, Concept Conflict Detection | 3 |
| **Teaching Validation** (cross-cutting, not counted in the 23) | Guardian Angel — see below | 6 |
| **Concept Tracker** (cross-cutting, formalizes Tier 1's Knowledge Graph component) | Status Classification, Objective-Level Granularity, Resume Point Capture, Confusion Log, Cross-Session Rollup — see below | 5 |

*\*Tier 1 count of 10 as given in the original spec; only 7 named explicitly plus the 3 newly-added trackers below — if a full accounting is wanted later, the remaining 3 need to be named.*

### Tier 1 detail — the 3 components added in the most recent pass

**Attention Span Engine** — tracks `current_focus` (0-1), session-elapsed minutes, a personalized `attention_decay_rate` (~0.05/min), a `fatigue_threshold` (0.4) below which the protégé signals wanting a break, plus distraction signals (shorter answers, repeated questions, missed details, hesitation) and a rolling `attention_history` across sessions to infer `preferred_session_length` and `recovery_rate`.

**Reasoning Quality Tracker** — goes beyond *whether* the protégé reasons (already tracked via Tier 2 Identity's deep/surface processing) to *how well*: five components scored per response — `causal_reasoning`, `analogical_reasoning`, `deductive_reasoning`, `inductive_reasoning`, `critical_thinking` — plus a `reasoning_trajectory` across sessions, a running list of `common_reasoning_errors` (conflating correlation/causation, overgeneralizing from one example, unsupported leaps), and a `reasoning_style` label (analogical / step-by-step / intuitive).

**Fatigue Decay Curve** — the mechanism linking the two above: `effective_learning_rate = base_rate × (0.3 + attention×0.7) × (1 − difficulty/10)`. Concretely: 90% attention barely dents learning (0.40→0.36 effective); 40% attention nearly halves it (0.40→0.16). This is what makes "high mastery, low attention" produce a realistically degraded response instead of a perfect one.

### Tier 1 — the pattern to notice: **this already exists in your real backend**

`decayEngine.js` (from `modules/adaptive-learning/agents/student/`) already implements an Ebbinghaus-style forgetting curve with a nightly 03:00 sweep — this is the same concept as "Forgetting Curves" here, and the "high mastery but low retention → hesitant, not confident" behavior in the 5-Day-Gap test scenario below is exactly what that engine is meant to produce. **Don't build a second forgetting-curve system** — wire the Soul Stack's dialogue-generation layer to read from the same decay state your tutor-agent already tracks, rather than maintaining a parallel mastery/retention model for the protégé. One knowledge-state store, two personas reading from it (tutor-agent explains/quizzes off it; protégé's Soul Stack narrates emotional/identity reactions to it).

### Tier 2 (Soul) and Tier 3 (Experience) — as specified, unchanged
Tier 2: Emotion, Social, Drive, Noise, Identity, Narrative Memory (kernels — short first-person memory snippets tagged with emotional valence, retrieved by *emotional* match not just topical match), Relationship (trust level, sentiment, inside jokes, shared history references).
Tier 3: Prompt Builder, Response Generator, Expression.
Supporting: LLM Judge (scores attention/reasoning/teaching-quality per turn), Profile Inference (teacher_pace, explanation_preference), Concept Conflict Detection (flags when two taught concepts appear contradictory, as in the Breakthrough scenario's photosynthesis↔respiration resolution).

## Teaching Validation Layer ("Guardian Angel")

The problem this solves: if a human teaches the protégé something false, a naive implementation lets the protégé confidently learn and repeat it — actively spreading misinformation while looking like a feature. The design rejects a simpler alternative (assessing only at context-window boundaries) because it's too slow (errors persist for thousands of tokens), too coarse (misses single-sentence errors), and visibly breaks immersion.

**6 layers, in order:**

1. **Real-Time Fact Checking** (per utterance) — extracts claims from what the human just taught, checks them against the knowledge graph, falls back to an LLM/external check if the knowledge graph has no match.
2. **Teaching Quality Scoring** (per session) — tracks the human's own `teaching_accuracy_score` over time, a running list of their common errors, and how often their corrections get accepted.
3. **Misconception Injection Prevention** — the protégé must never actually adopt a false claim into its knowledge state, but should still *appear* to grapple with it realistically rather than robotically rejecting it.
4. **Disagreement Signal Generation** — the correction strategy is chosen by the protégé's own mastery/confidence: high mastery+confidence → "I thought it was different... did I get that wrong?"; mid → "I'm a bit confused, can you explain the difference?"; low → plain clarification request. Also modulated by the human's own teaching-accuracy score — a human who errs often gets more direct pushback; one who rarely errs gets a subtler "pretend confusion."
5. **Post-Session Consistency Check** — after the session, scan for contradictions across everything taught, flag for human review if found, and fold the result into the ongoing teaching-quality score.
6. **Multi-Source Validation** (critical topics only) — cross-checks a claim against knowledge graph + external source + LLM verification + curriculum database; only flags as confidently correct/incorrect on consensus, else marks `uncertain` and routes for human review.

**One design choice worth flagging explicitly before this ships as specified:** the plan states the protégé "should never admit it's validating" and should "maintain the illusion" through "stealth correction" — i.e., the performed confusion isn't just a UX choice, it's designed to conceal from the user that a fact-checking system is running underneath. Given your actual userbase includes minors (JSS1-2 shown in the app screenshots), undisclosed persuasive/corrective AI behavior aimed at children is worth a deliberate decision, not a default. The mechanism itself (protégé expresses realistic confusion rather than robotically rejecting) is good design — the part worth reconsidering is specifically the *non-disclosure* framing ("never admit," "stealth"). A middle path that keeps the pedagogical value without the concealment: the protégé can genuinely be written to ask clarifying questions when it detects a mismatch — that's honest behavior, not a performance — without needing to be framed internally as deception the system is proud of hiding. Worth a founder-level call, not something to silently implement either way.

## Concept Tracker Layer

The problem this solves: right now, "knowledge" in the Soul Stack is tracked as a mastery/retention *number* per topic (Tier 1's Knowledge Graph + Mastery). That's enough to drive decay curves and confidence, but it can't answer "where exactly did we leave off?" — a number doesn't distinguish *never introduced* from *taught but confused* from *understood but not yet tested*. The Concept Tracker is the structured state that fills that gap, so a session that starts cold can resume precisely instead of re-diagnosing from scratch every time.

**This is not a new knowledge store — it formalizes an existing stub.** `knowledge.js` in your real backend already does "subject/topic grouping, confidence per topic, decay-aware retrieval, session delta tracking" per its own file header, and your syllabus data (`data/syllabus/wassce-physics.sample.json`) already has the exact hierarchy this needs: `topic → subtopics[] → objectives[]`. The Concept Tracker is what sits on top of that existing topic/subtopic structure, per student, tracking a richer status than a single confidence float.

**Structure — one record per (student, subtopic):**

```
concept_state = {
  topic: "Motion",
  subtopic: "Equations of uniformly accelerated motion",
  status: "confused",   // not_started | introduced | learning | confused | understood | mastered | needs_review
  objectives_covered: ["Define displacement, velocity and acceleration"],   // from the syllabus objectives[] list — which specific ones have actually come up
  objectives_remaining: ["Apply the equations of motion to solve problems", "Interpret velocity–time and displacement–time graphs"],
  first_introduced: "2026-08-14T...",
  last_touched: "2026-08-27T...",
  confusion_notes: ["mixed up v=u+at with s=ut+½at² twice"],   // short, specific — not a re-derivation of mastery, just what tripped them up
  resume_point: "was mid-way through applying the equations to word problems when session ended"
}
```

**5 layers, mirroring how Guardian Angel is structured:**

1. **Status Classification** (per turn) — after each exchange touching a subtopic, the LLM judge (the same one scoring attention/reasoning) also classifies status: did this turn *introduce* the subtopic for the first time, move it from `introduced`→`learning`, surface `confused` (a wrong answer, a "wait I don't get this"), resolve to `understood` (correct application, not just recitation), or reach `mastered` (correct under a harder/transfer question)? This reuses the judge call already planned for attention/reasoning scoring rather than adding a separate LLM pass.
2. **Objective-Level Granularity** — status is tracked per *objective* within a subtopic, not just per subtopic. A student can have `objectives_covered` for "define velocity" while `objectives_remaining` still has "interpret velocity-time graphs" — this is what lets a review session target the specific gap instead of re-teaching a subtopic the student is 80% fine on.
3. **Resume Point Capture** — at the end of any session (explicit end, or timeout), write a short `resume_point` string capturing exactly where the thread was left, not just which subtopic. This is what makes "let's continue where we left off" actually specific ("you were applying the equations to word problems") instead of generic ("you were on Motion").
4. **Confusion Log** (not a re-derivation of mastery) — `confusion_notes` is a short, specific, append-only list of *what* tripped the student up, in plain terms, not a score. This is the thing a review session actually needs to read before re-teaching — "mixed up v=u+at with s=ut+½at² twice" tells the tutor-agent exactly what to re-explain differently, where a bare 0.42 mastery number doesn't.
5. **Cross-Session Rollup** — a lightweight view over all `concept_state` records for a student: what's `mastered` (don't touch unless review-triggered by decay), what's `confused`/`needs_review` (surface first next session), what's fully `not_started` (still ahead). This is the direct answer to "what have we learned, not learned, understood, confused" as you framed it — one query away instead of inferred from raw mastery numbers.

**How it's different from the existing Knowledge Graph + Mastery component, concretely:** mastery/retention answer *how well* and *how strongly retained*; Concept Tracker answers *what stage this specific concept is at* and *exactly where the last session left off*. Both should exist and read/write the same underlying per-student-per-subtopic row — mastery is a derived score, status/resume_point/confusion_notes are the qualitative record a human (or the tutor-agent) actually needs to pick a session back up sensibly.

**Where this plugs into the Research phase** (per [[akoro-research-plan-act-pattern]]): "check the learner's knowledge before continuing" — the exact instruction from your example prompt — is now a single Concept Tracker rollup query, not a fresh diagnostic quiz every time. A diagnostic quiz is still useful for topics that are `not_started` or long-decayed, but for anything already `learning`/`confused`, the Research phase can skip straight to "here's exactly what was confusing last time" instead of re-discovering it.

## Validation Test Suite

**7 lifecycle scenarios** (full dialogues + 7-8 assertions each already built as an interactive HTML test runner — not reproduced here, this is the index):

| # | Scenario | Sessions | Tests | Result type |
|---|---|---|---|---|
| 1 | Cold Start | 1 | First contact, no memory/profile yet | PASS |
| 2 | Session 3 | 3 | Narrative memory + forgetting curves active | PASS |
| 3 | 5-Day Gap | 4 | Ebbinghaus decay + metacognitive awareness of forgetting | EDGE CASE |
| 4 | Frustration Threshold | 5 | Cognitive overload + emotional threshold breach | STRESS TEST |
| 5 | Breakthrough | 6 | Serendipity + spontaneous cross-domain transfer | PASS — "magic" |
| 6 | Mature (12 sessions) | 12 | Relationship arc, inside jokes, realistic (imperfect) recall | PASS — relationship |
| 7 | Misconception Relapse | 8 | Stubborn misconception resurfacing under fatigue, self-correction | BEHAVIORAL |

**Additional edge cases to add**, per the plan: rapid-fire questioning (5 questions in one turn → cognitive load spike → "can we slow down?"), wrong teaching (theory-of-mind pushback, covered by Guardian Angel above), abrupt topic switch (knowledge-boundary honesty — "I don't think I've heard of that"), extended silence (curiosity queue self-injects a question), aggressive/repeated correction (frustration → possible disengagement, tests emotional realism under pressure), praise overdose (checks for Dunning-Kruger-style overconfidence drift).

**The "Clone or Simulation?" acceptance test:** given the same prompt ("I thought you'd never get past the soil thing"), a *simulation* responds like a textbook ("I initially had a misconception... corrected through experimental evidence"); a *clone* responds with genuine narrative texture, self-deprecating humor, and an acknowledgment of how the correction felt, not just that it happened. The stated thesis: the difference is narrative memory + emotional coupling + relationship arc, not a bigger prompt — worth keeping as the standard you test every new component against.

## Build order (integrating with the other 3 docs)

Per the "pick one thing, wire it fully" principle already established in [[akoro-agent-upgrade-plan]]:

1. **Attention (Week 1, "quick win")** — LLM judge outputs a 0-1 attention score per turn; simple linear decay; inject a break-request below 0.4 threshold.
2. **Reasoning Quality (Week 2)** — add the 5-component scoring to the judge prompt; start tracking trajectory.
3. **Full integration (Week 3)** — attention-weighted learning rate, fatigue-aware pacing, reasoning-conditioned response style.
4. **Guardian Angel Layer 1-2 first** (real-time fact checking + teaching quality scoring) — these are the ones with actual safety stakes; layers 3-6 (misconception handling, disagreement signals, consistency check, multi-source validation) are refinements on top, not blockers.
5. Wire the forgetting-curve piece to the **existing** `decayEngine.js` rather than building a second one — this is the one place a "new" Tier 1 component is actually just a persona-layer read of state you already compute.

## Worked example: your prompt

> *"Let's study ahead and prepare for next week's topics on science during this weekend so we'll be prepared by Monday."*

This is a tutor-agent request (Amara's Agent side, not the protégé), but it's the cleanest place to show how all four docs connect:

**Research phase** (per [[akoro-research-plan-act-pattern]]) — read-only, no LLM needed yet:
- Pull next week's syllabus topics (science) — needs a syllabus/curriculum source per topic.
- Pull the student's current mastery + retention for each of those topics from the shared knowledge-state store (the same one `decayEngine.js` maintains).
- Pull the **Concept Tracker rollup** for those topics — which subtopics are `not_started` (need a real diagnostic), which are `confused`/`needs_review` (skip straight to the logged `confusion_notes` instead of rediscovering the gap), which are already `mastered` (skip entirely unless decay flags them). This is what turns "check the learner's knowledge" from a fresh diagnostic every time into a targeted one.
- Pull `Attention Span Engine` state — `preferred_session_length`, recent `attention_history` — to size the weekend plan realistically rather than assuming unlimited focus.

**Plan phase** (a Skill call, per [[akoro-agent-upgrade-plan]]):
- `TopicPrioritization` ranks next week's topics by (curriculum weight × (1 − current mastery)) — weakest, most-important-first.
- `DifficultyCalibration` sets question difficulty per topic based on current mastery, not a flat default.
- Output: a concrete weekend plan — e.g. "Saturday: 25-min diagnostic quiz covering all 4 upcoming topics (checks what you already half-know) → review the 2 weakest → Sunday: retest + light review of the other 2, sized to your usual ~15-minute focus window with a break built in."

**Act phase**:
- `generate_quiz` runs, but now scoped by the Concept Tracker rollup from Research: a real diagnostic only for `not_started` subtopics, a targeted few questions re-testing the specific `confusion_notes` for anything `confused`, and nothing at all for `mastered` subtopics unless decay flagged them — this is the "check the learner's knowledge" step you asked for, now precise instead of a blanket re-quiz.
- Score-based branch: topics scoring high get a light Sunday touch; weak ones get the Saturday deep-review slot. Every status change (a subtopic moving `confused`→`understood`, or newly `introduced`) writes back to the Concept Tracker, and each `confusion_note` gets appended with what actually tripped the student up this round.
- Each step streams into the todo-trace UI already built (`akoro-chat-workflow.html`), same pattern as the quiz/explain workflows already prototyped there.
- End of session: `resume_point` gets written for whatever subtopic was mid-thread — so if Monday's actual class runs long and Tuesday's review has to pick this back up, it starts from the specific word-problem the student was stuck on, not "Motion, generally."

**Where the Soul Stack enters, if the protégé is present in this flow too:** the protégé (if the student is teaching it alongside their own studying) would react to the same diagnostic results through its own Emotion/Drive layers — e.g. showing its own "curiosity spike" about an upcoming topic neither of them has covered yet — while Guardian Angel Layer 1 silently validates anything the student explains to it during review, exactly as specified above. The tutor-agent and the protégé are reading the same underlying mastery data, expressed through two different personas for two different purposes (one drills you, one learns alongside you).
