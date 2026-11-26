---
title: Memory model
status: beta
doc_status: draft
tier: 2
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Memory model

## What it represents

Memory is what Akoro retains about a learner between sessions so the agent
can continue work coherently. It is several stores with different jobs —
not one table — and none of them is mastery: memory informs the agent,
evidence (see [Evidence model](evidence.md)) drives concept state.

## Identifier

- `edu.learner_agent_memories.id` — UUID.
- `edu.learner_soul_preferences.learner_id` — one preferences row per
  learner (primary key is the learner).
- `edu.learner_agent_conversation_summaries.chat_session_id` — one summary
  per chat session (primary key is the session).

## Important fields

`edu.learner_agent_memories` — durable, kind-tagged memories written from
agent turns: `user_id`, `chat_session_id`, `agent_session_id`,
`agent_turn_id`, `kind` (`learning_summary|study_preference|learner_goal`),
`content` (bounded to 1500 characters), `subject`, `topic`, `status`
(`active|forgotten`), timestamps. Unique per
`(chat_session_id, agent_session_id, agent_turn_id, kind)`.

`edu.learner_agent_conversation_summaries` — rolling per-session summary:
`user_id`, `summary` (bounded to 4000 characters), `source_message_count`.

`edu.learner_agent_conversation_turns` — turn bookkeeping: `status`
(`writing|completed|failed`), `error_code`, links to the user and agent
`chat_messages` rows.

`edu.learner_soul_preferences` — how the learner wants to be taught:
`interaction_style` (`balanced|collaborative|independent|socratic`),
`response_tone` (`calm|curious|direct|celebratory`), `challenge_level`
(`gentle|adaptive|stretch`), `encouragement_level`
(`minimal|balanced|frequent`), `policy_version`.

`edu.learner_soul_checkins` — short-lived state: `feeling`
(`steady|energised|tired|stuck|celebrating`), `study_context`,
`study_intent`, `requested_support`, keyed per
`(learner_id, source_session_id)` and expiring after 8 hours.

Earlier stores still present: `edu.student_knowledge` and
`edu.agent_knowledge` hold content chunks with `confidence` and
`embedding` vectors (sources `manual|session|teacher|upload`; chunk types
`taught|corrected|recalled|reinforced`), and `edu.session_knowledge_delta`
and `edu.decay_events` track per-session knowledge change and forgetting.

## Relationships

```text
learner -> edu.learner_agent_memories (kind-tagged, from agent turns)
        -> edu.learner_agent_conversation_summaries -> chat session
        -> edu.learner_soul_preferences (one row)
        -> edu.learner_soul_checkins (per session, expiring)
        -> edu.agent_knowledge / edu.student_knowledge (content chunks)
```

## Ownership and access

- Owner: the learner. All memory stores are learner-scoped and cascade on
  account deletion.
- Readers: the learner's own agent runtime, through the Context Manager.
  No other learner, instructor or school reads raw memory.
- Writers: the agent runtime (memories, summaries, turns); the learner
  (soul preferences, check-ins, forgetting a memory).

## Lifecycle

- Memory: written from a completed turn -> `active` -> `forgotten` when the
  learner forgets it; forgotten memories are not used.
- Check-ins expire after 8 hours and are replaced by the next check-in.
- Summaries are rewritten as a session grows; they are a compression of
  the transcript, not a replacement for it.

## Agent guidance

- Never read or use another learner's memory.
- Never treat a memory or a learner's self-report as mastery evidence.
- Respect `forgotten` status absolutely; do not resurrect forgotten
  content from summaries.
- Keep written memories short and factual; memory content is bounded in
  the schema for a reason.

## Related

- [Learner model](learner.md)
- [Agent model](agent.md)
- [Evidence model](evidence.md)
- [Context Manager contract](../06-agents/context-manager.md)
