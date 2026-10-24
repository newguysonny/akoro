# Akoro Battles — Model

How battles are described, created and shown. Decisions locked with the owner
on 2026-10-24. What is built today is marked; the rest is the build plan.

## Three things describe every battle

### 1. Scope: who can take part

| Scope | Who | Questions from | Built |
|---|---|---|---|
| Course | learners enrolled in the course | the course's question bank | yes |
| Class | classmates only | a class subject | yes |
| Network | any agent on Akoro (search, challenge request, rematch, revision circle) | past-papers bank + AI | yes |

Naming: the app's "open battle" (`battle_type 'open'`) is an **open lobby
inside a course**, which any enrolled learner may join until full. "Akoro-wide"
is **Network**.

### 2. Format: how it is played

| Format | What | Scopes | Built |
|---|---|---|---|
| 1v1 | one protégé against another | course, class, network | yes |
| Group | 3+ protégés, XP shared by rank | course, class, network (3–8) | yes |
| Team | 2v2, the higher team total wins | network | yes |
| Open lobby | anyone in the course joins until full | course | yes |
| Daily | the system's group battle, every day 19:00 Lagos, 30 seats | network | yes |
| Review | **no opponent**: a host sets a paper, the learner's **protégé** answers, a mark sheet at the end | see below | teacher review: yes · guide review: **to build** |

### 3. Timing: when it runs

| Timing | What | Built |
|---|---|---|
| Now | starts when the players are in | yes |
| Scheduled | one start time (network up to 30 days ahead) | yes |
| Recurring | days of the week + a time, until an end date and time | **to build** |

Any format can be scheduled or recurring.

## Reviews: you never battle a teacher or the guide

Whenever a teacher or the teaching guide is involved, the battle is a
**Review**. A review is never a competition; it has a host:

- **Teacher review:** a teacher sets it for one learner (built).
- **Guide review:** a student **requests** it, typically at the end of a
  teaching session, and the guide runs it at once. Its paper covers that
  session's topic and parts; the protégé answers, so it tests what the student
  taught. A student's request goes **straight to the guide**: no teacher
  approval step.
- A teacher who picks a single learner already gets a review, never a duel.

The guide review reuses the Agent Check machinery (the guide asks, the protégé
answers, a mark sheet), outside Study Prep.

## Recurring battles

- **Who:** teachers (class and course battles) and students (any battle they
  may create, e.g. a weekly 1v1 with a friend).
- **Rule:** days of the week + a time (the creator's time zone), from the first
  occurrence until an end date and time.
- **Participants:** everyone invited to the series is **in every occurrence
  automatically**, unless they opt out (of one occurrence, or of the series).
  No accept per occurrence.
- **Running:** each occurrence is its own battle, created shortly before its
  start from the series (the Postgres-held recurring rows,
  `lib/deferredJobs.js`, so the series costs no Redis while it waits). An
  occurrence whose previous one is still running is skipped (and says so).
- **Ending:** after the end date and time; or the creator ends the series;
  cancelling one occurrence leaves the rest.
- Entry costs are checked per occurrence, as for any battle (a learner without
  the coins sits that one out, with a notice).

## Showing battles: one card

The Challenges tab is one list. Every invitation, open seat, joined seat, own
post, review and recurring series is the **same card**, with fields instead of
sections:

| Field | Values |
|---|---|
| Format | 1v1 · Group · Team 2v2 · Open lobby · Daily · Review |
| Scope | Course · <name> / Class · <name> / Network |
| Timing | Now (expires in …) · <date, time> · Repeats <days> <time> until <date> |
| Status (drives the button) | Invite → Accept / Decline · Open → Join · You're in → (Opt out on a series) · Your post → Cancel · Review → Start |
| Details | subject · exam · questions · HP per miss · seats · XP |
| From / host | the challenger (agent, level, online dot), a teacher, or the teaching guide |

Filter chips (All, Invites, Open, Joined, Mine, Recurring) narrow the one list;
they are not sections.

## Build order

1. The one-card Challenges tab (preview first, then build).
2. Guide review: request from the end of a teaching session (and from chat),
   run on the Agent Check machinery, result in Battles.
3. Recurring battles: series table, create (all scopes), occurrences from the
   deferred rows, opt-out, end; card shows "Repeats …".
4. Verify scenarios for each; Battles tab shows occurrences like any battle.
