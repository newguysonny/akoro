# Activity + Review battle — Plan

*2026-10-24. Status: plan, awaiting decisions (below). Builds on
`reference/Akoro Battles — Model.md` (reviews) and the activity drafts
(`modules/self-study/drafts.js`).*

## The goal

When an instructor assigns an **assignment** or a **self study** (or any
activity), a **review battle** tailored to its topic and concepts comes with it,
automatically:

- **Assignment + review:** the assignment's instructions say "after you submit,
  teach your agent this topic; a review is scheduled." Each learner's
  **submission** schedules their review.
- **Self study + review:** a self study is a teaching session whose plan
  (topic, concepts, objectives, goals) the instructor configures and assigns.
  Finishing it schedules the learner's review.

The review is the protégé kind (Model.md "Reviews"): the learner's **agent
answers** what the learner taught it, a teacher hosts, the result is a mark
sheet. No opponent, no HP, no XP.

## One mechanism, not one tool per pairing

Three ways to build it:

| Option | What it is | Verdict |
|---|---|---|
| A. A tool per pairing (`assignment_with_battle`, `self_study_with_battle`, …) | a new tool for every combination | **No.** It multiplies tools and prompts, and each new activity type needs another. The model also has to pick between near-duplicates. |
| B. One chaining tool (the existing `multi_stage` journey) | ordered stages that unlock one after another | **Keep it for real journeys** (several stages in order), but not for this. A review isn't a stage the learner unlocks. It belongs to the activity: same audience, same topic, triggered by that learner's own submission. |
| **C. A review attached to any activity** | `prepare_activity` gets a `review` field; the draft carries the review; assigning the activity sets the review up | **Recommended.** It's one tool and one draft, with one preview and one Assign. It works for assignments, self study and projects alike, and it comes as a suggestion that's on by default and that the instructor can turn off. |

So: **option C**. In practice:

1. **Drafting (chat):** `prepare_activity` for an assignment or self study
   suggests the review by default (`review: { on: true, when, questions }`). The
   agent mentions it in one line ("I've paired it with a review: your learners'
   agents get reviewed 24h after they submit"). The instructor can say "no
   review" or change when it runs.
2. **The instructions:** the assignment's instructions gain the line
   *"After you submit, teach your agent this topic: a review with your agent is
   scheduled for {when}."*
3. **Assigning:** the review's questions are prepared **once per activity**,
   from its topic, concepts and objectives (and, for an assignment, its own
   questions as the source). The review shows as **Scheduled after you
   submit** on every learner's copy straight away.
4. **The trigger:** `POST /api/self-study/:id/complete` (the one completion
   path for assignments, self study and projects) schedules **that learner's**
   review at submission + the delay. It runs on the Agent Check machinery
   (`createCheckBattle`, `review_host: 'teacher'`). The wait sits in Postgres
   (`lib/deferredJobs.js`), and the review lands in the learner's Battles tab.
5. **Results:** the mark sheet goes to the learner and to the instructor's
   activity view, next to the submission.

## Previews (side by side with chat)

These look like the assignment preview we already have:

- **Self study preview:** the plan (topic, concepts, objectives, goals),
  editable, with a **Review battle** section underneath.
- **Assignment preview:** the paper (versions), with the same **Review battle**
  section.
- **Review battle section:**
  - on/off;
  - when it runs (after submission + delay, or a fixed date);
  - number of questions;
  - the generated review questions (Version 1, regenerate like the
    assignment's);
  - the line added to the instructions.
- **Battle draft preview:** the battle form opens prefilled (this was built
  today).

Preview first: screenshots of the self study and assignment previews with the
review section, then build.

## Decisions needed

1. **When the review runs after submission:** immediately, after a set delay
   (suggested **24 hours**, so the learner has time to teach their agent), or
   a time the instructor sets per activity (with 24h as the default)?
2. **The review's questions:** new questions from the topic and objectives, or
   variants of the assignment's own questions?
3. **Learners who never submit:** no review, or run it at the due date anyway?
4. **Default:** on for every assignment and self study (instructor turns it
   off), or offered as a suggestion the instructor ticks?
5. **Does the review count?** Shown beside the grade only, or part of it?

## Build order (after the decisions)

1. Preview screenshots: the review section in the self study and assignment previews.
2. Backend:
   - the `review` on drafts and activities;
   - prepare the questions on assign;
   - schedule the review on completion;
   - mark sheet on the instructor's view.
3. Chat: the `review` field on `prepare_activity`, and the one-line suggestion.
4. Learner: "Review scheduled after you submit" on the activity card, then the
   review in Battles.
5. Gate scenarios: assignment → submit → review scheduled → runs; self study →
   finish → review.
