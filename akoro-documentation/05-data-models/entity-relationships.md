---
title: Entity relationships
status: beta
doc_status: draft
tier: 2
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Entity relationships

The main relationship chains across Akoro's data model. Each chain names the
documented entity pages; the plan's example chain — Learner → Learning
Session → Concept → Assessment → Evidence → Learner Knowledge State — is the
first one.

## Learning chain

```text
Learner (public.users)
  -> Learning session (edu.study_prep_sessions / edu.adaptive_sessions)
       -> Concept (edu.concept_catalog, via syllabus topics)
       -> Assessment (edu.assessment_sessions)
       -> Evidence (edu.learner_concept_evidence, append-only)
       -> Learner concept state (edu.learner_concept_state, derived)
  -> Memory (edu.learner_agent_memories, soul preferences/check-ins)
  -> Records (edu.records -> chunks, artifacts)
  -> Goals (edu.learner_goals)
```

See [Learner](learner.md), [Learning session](learning-session.md),
[Concept and mastery](concept.md), [Assessment](assessment.md),
[Evidence](evidence.md), [Memory](memory.md).

## Teaching and content chain

```text
Instructor / Teacher (public.users, role instructor)
  -> Courses -> course_modules -> lessons -> videos
  -> Enrollments -> Learners -> lesson/video progress
  -> Classrooms -> classroom_students
Programme -> Courses (curriculum organisation, e.g. PharmD)
```

See [Teacher](teacher.md), [Course](course.md), [Programme](programme.md).

## School chain

```text
School (public.school_profiles)
  -> school_teachers -> Teacher (public.users)
  -> mgmt.classes -> mgmt.sections
  -> mgmt.students (optional user_id -> Learner account)
  -> mgmt.staff -> departments / designations / payroll
  -> mgmt.class_teachers (teacher_id is a public.users id)
  -> fees, exams, timetable, library, transport, hostel, assets (mgmt.*)
```

See [School](school.md).

## Agent chain

```text
Learner -> public.user_agents (the learner-facing agent identity)
        -> edu.student_agents (learning agent: level, knowledge score)
             -> edu.agent_knowledge (what the agent has been taught)
        -> edu.agent_tools (tools the learner built; platform tools shared)
        -> edu.agent_tool_invocations (capability-bound tool calls)
        -> edu.adaptive_sessions (student_agent_id, teacher_agent_id)
Learner <-> Learner via edu.agent_messages / edu.agent_friends (agent network)
```

See [Agent](agent.md).

## Rules these chains imply

- Evidence is the only bridge from activity to mastery: sessions produce
  evidence; the learning engine derives state from evidence.
- A school student and a learner account are different entities joined by
  an optional link, never the same row.
- An agent is not one table: identity, learning state, knowledge, tools and
  invocations are separate entities with separate owners and lifecycles.

## Related

- [Data architecture](data-architecture.md)
- [Database conventions](database-conventions.md)
