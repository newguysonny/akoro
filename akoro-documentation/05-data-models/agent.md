---
title: Agent model
status: beta
doc_status: draft
tier: 2
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Agent model

## What it represents

An agent is not one row. The learner's AI protégé and the platform's
tool-using runtime are spread across identity, learning state, knowledge,
configuration, tools and invocation tables, mostly in `edu`:

- `public.user_agents` — the learner-facing agent identity (name, look, XP).
- `edu.student_agents` — the learning agent trained by/with the learner.
- `edu.agent_knowledge` — what that agent has been taught.
- `edu.agent_tools` — tools a learner built for their agent (self-tooling).
- Runtime records — invocations, episodes and network tables below.

## Identifier

- `public.user_agents.id` — UUID; unique per `user_id` (one agent identity
  per learner).
- `edu.student_agents.id` — UUID; `UNIQUE(student_id)` (one learning agent
  per student).
- `edu.agent_tools` rows are owner-scoped by their learner owner column.

## Important fields

`public.user_agents` includes `user_id`, `agent_name`, `agent_emoji`,
`agent_color`, `agent_bg`, `total_xp`, `is_active`, timestamps.

`edu.student_agents` includes `student_id`, `name` (default
`My Learning Agent`), `level`, `total_sessions`, `total_turns`,
`knowledge_score` (grows with every session), `subjects_learned` (text
array), timestamps.

`edu.agent_knowledge` includes `agent_id`, `student_id`, `topic`,
`subject`, `content`, `chunk_type`
(`taught|corrected|recalled|reinforced`), `confidence`, `times_seen`,
`last_seen_at`, `session_id`, and an `embedding` vector for retrieval.

`edu.agent_tool_invocations` records capability-bound tool calls:
`capability_jti`, `idempotency_key` (unique together), `principal_id`,
`tool_name`, `status` (`running|completed`), `response` (JSONB),
`completed_at`.

`edu.agent_tools` holds learner-built tools; the domain migration adds
`domain` and `actions` (JSONB), and self-tooling migrations add areas,
grants and disabled actions. Platform tools (`scope = 'platform'`) enter
every learner's catalogue.

Also present: `edu.agent_orchestration_config` (runtime configuration),
`edu.agent_capability_seen` (capability keys and first-seen time),
`edu.agent_episodes` (evaluation episodes: `source` `synthetic|real`,
`surface`, `verdict` `pass|fail`, `failure_class`, `capabilities`,
`episode` JSONB), and the agent-network tables `edu.agent_messages`,
`edu.agent_friends`, `edu.agent_network_settings`.

## Relationships

```text
learner -> public.user_agents
        -> edu.student_agents -> edu.agent_knowledge
        -> edu.agent_tools -> edu.agent_tool_invocations
        -> edu.adaptive_sessions (student_agent_id)
        -> edu.teacher_profiles (teacher_agent_id on sessions)
learner <-> learner: edu.agent_messages / edu.agent_friends
```

## Ownership and access

- Owner: the learner, for their agent identity, learning agent, knowledge
  and built tools.
- Readers: the owner; other learners only see the public agent profile the
  agent network exposes, never knowledge, memory or tools.
- Writers: the agent runtime (knowledge, invocations, episodes); the
  learner (identity, tool enable/disable); admins (platform tools).
- Training consent is recorded on the user (`agent_training_consent`,
  `agent_training_opt_out`).

## Lifecycle

- Agent identity: created at onboarding -> active; XP accumulates.
- Learning agent: level and knowledge score grow with sessions; knowledge
  chunks gain confidence and `times_seen` as they are reinforced.
- Tool invocation: `running` -> `completed`; idempotency keys prevent
  duplicate execution.
- Learner-built tool: draft -> kept/active -> disabled or deleted
  (enforced at run time).

## Agent guidance

- Never read another learner's agent knowledge or built tools.
- Never widen a tool's access beyond its capability.
- Do not treat agent knowledge chunks as learner mastery; mastery lives in
  concept state and is written only from evidence.
- Respect training consent/opt-out flags before using episodes.

## Related

- [AI and agent runtime](../01-features/ai/overview.md)
- [Agent capabilities](../06-agents/agent-capabilities.md)
- [Memory model](memory.md)
- [Learner model](learner.md)
