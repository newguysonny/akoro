# Chat commands

What to type into the AI chat to reach each tool. Every command here is checked
by `akoro-api/scripts/golden-path/gp-commands.mjs` — it asserts the phrasing
lands on the right task type, because the task type decides which tools the
model is even shown. A mis-routed example isn't a typo, it's a command that
cannot work.

**Name the specifics.** "Create a battle for JSS1" is not something the system
can act on — the past-questions bank is searched by **subject**, so without one
there is nothing to draw from. Say the class, the subject, and the topic.

---

## Battles

A battle is agent vs agent: each learner's agent answers from what that learner
actually knows. It needs **at least two learners**. One learner is a study
review (below).

| Type | What it is | Questions come from |
|---|---|---|
| Class battle | Everyone in a class | Past-questions bank for the subject |
| Course battle | Everyone enrolled on a course | That course's own question bank |
| Named learners | Two or more you pick | As above, by class or course |

```
Set JSS1 a Mathematics battle on fractions — 10 questions, medium
Create a class battle for JSS1: Basic Science, photosynthesis, 15 questions
Battle between priya and amaka in JSS1 on Mathematics — long division
Set a challenge for everyone on JSS Mathematics, topic simple interest
Schedule a Basic Science battle for JSS1 on Friday at 2pm, topic water cycle
```

**Required:** a title (it will write one), the class **and** subject — or the
course. **Optional, with defaults:** 15 questions, 15 minutes, 200 XP,
intermediate difficulty, questions from the bank topped up by AI.

Learners are *invited* — the battle starts once they have all answered, or at
the scheduled time. Nobody is entered without accepting.

## Study review

One learner, no opponent, no winner. Their agent works through a paper and the
teacher gets a **mark sheet**: every question, what was chosen, what was right,
and where the gaps cluster.

```
Study review for priya — JSS1 Mathematics, fractions, 8 questions
Review amaka on Basic Science, topic photosynthesis
Check what priya knows about simple interest
```

**Required:** the class, the subject, exactly one learner.

> "Review the submissions for essay 2" is marking, not a study review — that
> routes to grading, as it should.

## Self study

An AI topic the learner works through with their own agent. Class-scoped, not
course-scoped.

```
Assign self study on the water cycle to JSS1 — Basic Science, due Friday
Give JSS1 independent study on photosynthesis for Basic Science
Self study for priya and amaka: Mathematics, fractions
```

**Required:** topic, subject, and who (a class or named learners).

---

## Teaching tools

```
Make a podcast about photosynthesis for JSS1 Basic Science, 5 minutes
Common misconceptions about fractions for JSS1 Mathematics
Real-world connections for simple interest, JSS1 Mathematics
Lesson hooks for the water cycle, JSS1 Basic Science
Vocabulary list for photosynthesis, JSS1 Basic Science
Write a lesson plan on fractions for JSS1, 40 minutes
Grade this essay for Amaka out of 20 against the mark scheme
```

## Classroom admin

```
Make a quiz on fractions for JSS Mathematics — 10 MCQs with answers
Make a worksheet on the water cycle for JSS1 with an answer key
Build WAEC exam prep on simple interest for SS2 Mathematics
Turn my fractions lesson into interactive slides for JSS1
Write an end-of-term report comment for Priya — strong in algebra, weak on word problems
Take the register for JSS1 today
Schedule a live class for JSS Mathematics on Monday 10am — revision
Remind JSS Mathematics students that homework is due Friday
Export a progress report for JSS Mathematics this term
```

---

## Learners

```
Quiz me on fractions
Explain photosynthesis simply
Make me a study plan for Mathematics before my exam
Remind me to revise the water cycle tonight
Challenge amaka to a battle on fractions
```

---

## Recurring work

Any of these can be a schedule — that is what tasks are for:

```
Every Monday, set JSS1 a Mathematics battle on last week's topic — 10 questions
Every Sunday evening, assign JSS1 self study on the coming week's Basic Science topic
Every Friday, export a progress report for JSS Mathematics
```

A scheduled run has nobody to review the AI's draft before it goes out. That is
the trade for it being automatic, and each result says so.

---

## When a command doesn't work

The reply tells you what is missing rather than failing silently:

- *"Which subject? A class battle draws its questions from one"* — name it.
- *"Which class? Name it in the task, e.g. 'for JSS1'"* — name it.
- *"A battle needs two learners to compete. Name another, or ask for a study
  review of X instead"* — you named one learner.
- *"Only 4 Mathematics questions in the bank"* — ask for fewer, or say
  "generate with AI".
