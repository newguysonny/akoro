---
title: Plan and complete a Study Prep session
status: beta
doc_status: overview
tier: 2
audience: [learner, developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
workflow_id: learning.study_prep
capabilities: []
---

# Plan and complete a Study Prep session

## Objective

Create a Study Prep session, approve the plan, practise a topic, submit answers,
and let the learning engine decide the next transition.

## Required context

- Authenticated learner session.
- Goal, subject, class level and exam board.
- Available coins/credits and the `AKORO_STUDY_PREP_ENABLED` flag.

## Steps

| Step | API | Success condition |
| --- | --- | --- |
| 1 | `POST /api/adaptive/study-prep/sessions` `{goal,subject,classLevel,examBoard}` | 201, planning session |
| 2 | `GET /api/adaptive/study-prep/sessions` | Active session or null |
| 3 | `POST /api/adaptive/study-prep/sessions/:id/confirm` | Plan approved |
| 4 | `POST /api/adaptive/study-prep/sessions/:id/topics/:topicId/practice` `{mode:"diagnostic"}` | 201, practice run |
| 5 | Collect answers, then `POST .../topics/:topicId/submit` `{answers}` | Score + outcome |
| 6 | `POST /api/adaptive/study-prep/sessions/:id/next` | Next eligible action |
| 7 | If a teach-back is required, `POST .../teach-back-done` | Human gate satisfied |
| 8 | Continue, defer or conclude via the session action routes | Engine transition |

## Decision rules

| Condition | Action |
| --- | --- |
| No active session | Create one |
| Plan needs adjustment | `POST .../adjust` before confirming |
| Plan exceeds coins | Ask the learner to approve more or adjust |
| Practice not started | Start `diagnostic`; use `retest` only after study |
| Score not passing | Follow the engine's next action; do not skip mastery |
| 409/422 | Read the returned code/message; do not guess a transition |

## Failure and retry

- `study_prep_disabled` — stop; the feature is off.
- 409 invalid state — refresh the session view before retrying.
- Never submit answers twice; the engine owns scoring.
- Do not retry a rejected transition without changing the cause.

## Verification

- The session view shows the expected status.
- The outcome includes score/correct/total.
- The next action comes from the engine, not the agent.

## Prohibited

- Do not mark mastery from a conversational claim.
- Do not bypass teach-back or confirmation gates.
- Do not create a second active session for the same goal.
- Do not spend coins without learner approval.

## Related

- [Study Prep state machine](../../04-learning/README.md) (content planned)
- [Learning methodology](../../04-learning/README.md)
- [Learner concept model](../../05-data-models/concept.md)
