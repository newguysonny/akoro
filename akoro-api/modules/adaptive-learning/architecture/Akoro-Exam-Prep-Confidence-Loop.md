# Akoro Exam-Prep Confidence Loop

The concrete workflow tying together [[akoro-research-plan-act-pattern]], [[akoro-agent-upgrade-plan]] (Tools/Skills/Workflows), and [[akoro-protege-soul-stack]]'s Concept Tracker. This is the first real workflow to build per the "pick one, wire it fully" build order already agreed — this doc is that one.

## The big finding: most of the pieces already exist

Checked the real code before designing anything new:

| Piece needed | Status |
|---|---|
| Diagnostic quiz generation | ✅ `generate_quiz` / `quiz_me` tools exist |
| "Exam-style" assessment | ✅ `exam_prep` tool exists — but single-shot (one assessment, no loop, no branching) |
| Curriculum/syllabus structure | ✅ `data/syllabus/*.json` — topic → subtopics → objectives |
| Per-topic confidence/mastery | ✅ `knowledge.js` — confidence per topic, decay-aware |
| Concept-level status (not just a float) | ✅ Just specced — [[akoro-protege-soul-stack]] Concept Tracker |
| **The "Teach" experience itself** | ✅✅ **Already fully built** — `TeachAgentModal.jsx`, real-time WebSocket, voice+text, live confidence scoring per block |
| Learner pace/speed personalization | ⚠️ Exists for the *teaching guide's* style (`pacing_style` in `agentOrchestration.js`), but that profiles how a **teacher** teaches — there's no equivalent per-**student** pace profile yet |
| Real past-exam-question corpus | ❌ Doesn't exist — `exam_prep` LLM-generates "exam-style" questions on the fly; nothing is sourced from actual historical WAEC/JAMB papers |

So the actual build here is thinner than it looks: **wire existing pieces into a stateful loop**, fill the two real gaps (student pace profile, past-question grounding), and add the orchestration logic deciding when the Teach button appears.

## The loop, end to end

**Research** (read-only, cheap):
- Concept Tracker rollup for the topics in scope (from [[akoro-protege-soul-stack]]) — what's `not_started`, `confused`, `mastered`.
- Current mastery/retention from `knowledge.js`'s decay-aware state.
- Learner pace profile (see gap below) — how many attempts/how much explanation this specific student typically needs before confidence rises, so the loop doesn't over- or under-shoot for a fast vs. slow learner.

**Plan** (a Skill call):
- `TopicPrioritization` + `DifficultyCalibration`, scoped by the Concept Tracker rollup — full diagnostic only for `not_started`, targeted re-test for `confused` (using its logged `confusion_notes` to pick sharper questions, not generic ones).
- Set the **pass threshold** explicitly — a concrete number the loop branches on. `70%` is a reasonable default (matches the branch threshold in the original phased-loop pattern), but this should be configurable per exam board/subject rather than hardcoded once.

**Act — the loop itself:**

```
for each topic in plan:
  1. TEST — generate_quiz / exam_prep scoped to this topic's remaining objectives
  2. Evaluate → confidence score
  3. BRANCH:
     IF confidence >= pass_threshold:
        → Concept Tracker: mark objective(s) "understood" or "mastered"
        → move to next topic
     ELSE:
        → Concept Tracker: mark "confused", log what was missed into confusion_notes
        → render the Teach button in chat, scoped to this specific topic/subtopic
          (not a generic "teach me something" session)
        → student teaches the agent via the EXISTING TeachAgentModal flow
        → session ends → read back agentBlock.confidence from that session
        → write that confidence into knowledge.js's state AND Concept Tracker
        → RETEST same topic with new questions (not the same ones — avoids the
          student just memorizing the diagnostic itself)
        → loop back to BRANCH
  4. After all topics: Concept Tracker resume_point + rollup are now accurate
     for whatever comes next (Monday's class, a follow-up review session, etc.)
```

This is exactly the Diagnostic → Plan → Loop(Test→Branch→Retest) → done structure from the earliest phased-loop framework you'd sketched — the difference now is every step names a real file/tool instead of a placeholder, and the "Learn This Topic" button from that original sketch is `TeachAgentModal.jsx`, which turns out to already be more sophisticated (voice, live confidence, a coaching "guide" persona) than what was originally scoped.

## Why teach-back specifically works for retention

This isn't arbitrary — having the student *teach the agent* (protégé effect / Feynman technique) rather than just re-reading an explanation is well-supported for retention specifically because it forces active retrieval and exposes gaps a passive re-read hides. The existing `TeachAgentModal` architecture already fits this well: the student explains, the agent (protégé) responds with genuine confusion where warranted (tie-in to Guardian Angel from the Soul Stack doc), and `cogState.understanding` gives you a live, per-block confidence readout of whether the teaching is actually landing — which is exactly the signal this loop needs to decide when to stop.

## The two real gaps, and what to do about them

**1. No per-student pace profile.** The existing `pacing_style` field profiles how a *teacher* teaches (fed into the guide persona). There's nothing equivalent tracking how a given *student* learns — how many teach-back rounds they typically need, whether they're a "fast learner" who passes on attempt 1 most of the time or needs 3+ rounds consistently. Build this the same way the teacher-style profile was built: infer it from actual session history (retest counts, time-to-pass-threshold, confidence trajectory across attempts) rather than asking the student to self-report "I'm a slow learner." Feed it back into the Plan phase to set realistic session sizing and question difficulty — a student who reliably needs 3 rounds shouldn't be handed a 5-topic Saturday plan sized for someone who passes on the first try.

**2. No real past-question corpus.** `exam_prep` currently produces LLM-generated "exam-style" questions — plausible-looking, but not grounded in what WAEC/JAMB/NECO have actually asked. This matters for exam-prep credibility specifically (the whole pitch is "prepared for the real thing"), more than it matters for ordinary practice quizzes. Two honest options, not a false choice: (a) build a real ingestion pipeline — actual past papers, OCR'd/parsed, tagged against the same topic/subtopic taxonomy the syllabus JSON already uses, queryable by topic — or (b) keep LLM generation but say so plainly in the product ("exam-style practice questions" rather than implying real past questions) rather than let the framing overpromise. (a) is more work but is the actual differentiator if exam success is the core pitch; (b) is honest but weaker. Worth a deliberate choice, not a default.

## Loop safety: don't let it spin forever

The original design didn't specify a stop condition beyond "until confidence is enough." Add one explicitly: a **max-attempts cap** (e.g. 3 teach-back rounds per topic) before the loop hands off instead of continuing — if a student hasn't crossed the threshold after several honest attempts, more of the same isn't the fix. On cap-out: flag the topic for the tutor-agent to try a different explanation style (not just repeat the same teach-back), or surface it to an instructor if one exists for that student. This also connects to the Attention/Frustration trackers from the Soul Stack — a loop that keeps failing should be read as a signal to change approach, not as "student needs to try harder," especially for a userbase that includes younger students who can plausibly get discouraged by a wall of repeated failure.

## What to build first, concretely

1. Add the pass-threshold branch + retest loop to `exam_prep` (currently single-shot) — this is the actual state-machine work, matches the "make one workflow truly phased" item already queued in [[akoro-agent-upgrade-plan]].
2. Wire the Teach-button trigger: when a topic's post-test confidence is below threshold, render it in the chat UI (the trace-card pattern already built in `akoro-chat-workflow.html` can show this as a step outcome, not just a plain message) scoped to that specific topic — reuses existing UI patterns, no new component needed.
3. Wire `TeachAgentModal`'s session-end confidence back into `knowledge.js` + the Concept Tracker (may already partially happen via `agentBlock.confidence` → `cogState` — confirm whether that already persists server-side or is currently UI-local state only).
4. Add the max-attempts cap and the "change approach" fallback.
5. Punt the two real gaps (pace profile, past-question corpus) to their own build items — don't block the loop working end-to-end on either; a sensible default pass threshold and LLM-generated questions are enough to ship and test the loop mechanics first.
