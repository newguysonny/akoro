---
title: Terminology
doc_status: complete
audience: [developer, product, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# Terminology

Use these terms consistently in documentation, code comments and agent
instructions.

| Term | Meaning | Avoid |
| --- | --- | --- |
| Akoro | The platform and its applications | "the app" when the specific app matters |
| Learner | A person using Akoro to learn | Student, unless referring to a school record |
| Instructor | A person who creates or teaches courses | Teacher, unless referring to a school staff role |
| School | An institution with staff, students, classes and an ERP | Tenant, unless discussing isolation |
| Admin | A platform operator | Superuser |
| AI protégé | The learner-facing agent persona | Chatbot, tutor bot |
| Agent | A tool-using AI actor in the runtime | Bot, assistant, unless UI copy requires it |
| Record | A Library material: PDF, document, image, audio, video, paste or link | File, when the record is the domain object |
| Extraction | Text/OCR/transcript processing of a record | Parsing, when extraction is meant |
| Preview | A generated visual representation of a record | Thumbnail, for the record preview |
| Course | A structured learning product with modules and lessons | Class, unless referring to a school class |
| Programme | A collection of courses, such as a degree programme | Course |
| Lesson | A unit inside a course | Topic, unless it is a curriculum topic |
| Curriculum | The knowledge structure of subjects, topics and concepts | Syllabus, when the distinction matters |
| Topic | A curriculum or study unit | Lesson |
| Concept | A specific learnable idea with prerequisites and evidence | Topic |
| Evidence | A recorded signal that a learner did or did not demonstrate understanding | Score, when evidence is meant |
| Learner concept state | The learner's current mastery/confidence state for a concept | Grade |
| Study Prep | A planned study session over selected topics | Study plan, unless generic |
| Teaching session | An interactive agent-driven teaching flow | Lesson, when the agent is teaching |
| Assessment | A structured evaluation of learner work | Test, unless UI copy requires it |
| Attempt | One submission of an assessment | Assessment |
| Battle | A learner competition activity | Game, unless UI copy requires it |
| Capability | A stable, documented action Akoro can perform | Feature, when the registry entry is meant |
| Workflow | An ordered combination of capabilities | Process, when the formal workflow is meant |
| Capability registry | Machine-readable catalogue of available capabilities | Feature list |
| Documentation index | Compact discovery map from features to docs and capabilities | Search index |
| Context Manager | Runtime component that selects what enters the model context | Prompt builder |
| Tool registry | Runtime catalogue of callable tools | Capability registry, which is broader |
| Verification gate | Key-guarded system that drives Akoro through real scenarios | Test suite, when the gate is meant |
| Sandbox | Isolated environment at `sandbox.akoro.ng` | Staging, unless referring to deployment |
| Status | Availability state: implemented, beta, planned, deprecated, disabled | Stable, when status is meant |

## Naming rules

- Use sentence case for page titles and labels.
- Use "sign in" for the verb and "sign-in" for the noun/adjective.
- Use "email" not "e-mail".
- Use ISO dates (`2026-11-25`) and UTC timestamps.
- Use "organisation" in Akoro documentation.
- Do not use "AI" as a synonym for the agent runtime or the AI protégé.
