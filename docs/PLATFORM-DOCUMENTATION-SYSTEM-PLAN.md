# Akoro Platform Documentation System Plan

| Field | Value |
| --- | --- |
| Status | Implemented — Phases 0–3 complete; Phase 4 public surfaces live (redeployed 2026-11-26; public-content security remediation and the validator allow-list guard landed the same day, pending one further redeploy); Phase 5 expansion written 2026-11-26, with secret scanning and weekly docs-health checks in CI. Remaining: security-review sign-off, status monitors and the incident drill, the WCAG/Lighthouse pass, the `/api/v1` decision, and verification upgrades for the remaining beta capabilities |
| Scope | Complete platform knowledge system for humans and AI agents |
| Supersedes | Extends `docs/PUBLIC-DOCS-CHANGELOG-STATUS-PLAN.md` (public-surface plan) |
| Audience | Engineering, product, docs, security, operations, Akoro agents |
| Created | 2026-11-25 |
| Related | `AGENTS.md`, `reference/Grand Plan.md`, `docs/`, `akoro-api/modules/*/README.md` |

---

## 1. Executive summary

Akoro should not have "API documentation" as a side project. It should have a
**Platform Documentation System**: a structured, machine-readable and
self-validating knowledge base that explains:

- what Akoro is and why it exists;
- what every feature does, for whom, and under what rules;
- how the systems, data models and agents fit together;
- how to call the API correctly and safely;
- what an agent is allowed to do, how it should research a task and how it must
  verify success;
- what changed, what is deprecated and what must be migrated;
- whether the platform is healthy right now.

The system serves three audiences:

1. **Humans** — developers, instructors, schools, admins, partners.
2. **Akoro agents** — learner, teacher, school and coding agents that need
   reliable operational knowledge.
3. **Maintainers** — engineers and operators who need architecture, security,
   testing, deployment and incident knowledge.

The central design choices are:

- **Capability-centred, not endpoint-centred.** An agent should discover
  "create a learning session", not reconstruct the feature from 15 endpoints.
- **Three levels of knowledge.** Product knowledge, technical knowledge and
  operational knowledge.
- **One canonical documentation repository.** Public docs, API reference,
  agent knowledge, architecture, data models, learning methodology, governance,
  changelog and status live together.
- **Two connected API layers.** OpenAPI describes the contract; agent knowledge
  explains when, why and how to use it.
- **Progressive context loading.** Agents load tools first, then discover and
  retrieve only the documentation needed for the task. They never load the
  entire knowledge base on every request.
- **Documentation must be validated.** Endpoints, schemas, examples, links,
  workflows, permissions, capability status and agent instructions are checked
  in CI.
- **Documentation explains permissions; the backend enforces them.** Reading a
  document never grants access.

The first five deliverables are:

1. `AGENTS.md` — how agents research and operate Akoro.
2. `openapi.yaml` — the machine-readable API contract.
3. `capability-registry.yaml` — what Akoro can actually do.
4. Capability documentation — how each feature works.
5. Workflow documentation — how to combine capabilities to complete tasks.

Public docs, changelog and status are important surfaces of the same system,
not separate universes. The detailed public-site implementation remains in
`docs/PUBLIC-DOCS-CHANGELOG-STATUS-PLAN.md`; this document defines the larger
system that contains it.

---

## 2. Why API documentation alone is insufficient

Conventional API documentation assumes the reader already understands the
product and only needs endpoint details. That fails for:

- new developers who do not know Akoro's domain;
- instructors and school admins who need feature guidance, not HTTP;
- AI agents that must decide which capability to use, in what order, with what
  prerequisites, permissions and failure handling;
- maintainers who need to change a feature without breaking related systems;
- partners who need integration behaviour, not just schemas.

An endpoint page can say:

```text
POST /api/attempts/submit
Submits an assessment attempt.
```

That does not tell an agent:

- whether the attempt belongs to the learner;
- whether it can be submitted twice;
- whether submission means grading is complete;
- what to do on `ALREADY_SUBMITTED`;
- which workflow step comes next;
- whether a planned capability is actually available.

The Platform Documentation System fills that gap.

---

## 3. Scope and non-goals

### 3.1 In scope

- Platform identity, architecture, ecosystem and terminology.
- Feature documentation for every supported feature and app.
- API reference with parameters, fields, errors and examples.
- Agent-readable capability and workflow documentation.
- System, data, learning, agent and integration architecture.
- Engineering, security, governance and quality documentation.
- Changelog, releases, deprecations and migrations.
- Public docs, changelog and status surfaces.
- Capability registry, documentation index and context-loading contract.
- CI validation and documentation ownership.

### 3.2 Out of scope for the first release

- Documenting every internal/admin endpoint.
- Generating SDKs for every language.
- A public self-service developer portal or API key management.
- Fully automated documentation writing without human review.
- Localisation.
- Replacing OpenAPI with prose.
- Giving agents unrestricted API access because a capability is documented.
- Publishing planned features as if they already exist.

---

## 4. Design principles

1. **Capability-centred.** Organise around what users and agents can accomplish.
2. **One source of truth per fact.** OpenAPI for contracts, capability registry
   for availability, code for actual behaviour, changelog for history.
3. **Status is explicit.** Every feature and capability is `implemented`,
   `beta`, `planned`, `deprecated` or `disabled`.
4. **Progressive disclosure.** Humans navigate; agents retrieve on demand.
5. **Docs are executable knowledge.** Examples, workflows and permissions are
   validated.
6. **Docs are versioned with code.** A code change that affects behaviour
   updates documentation in the same change.
7. **Permissions are enforced by the backend.** Documentation is guidance, not
   authorisation.
8. **Public by allow-list.** Internal endpoints and secrets never leak into
   public docs.
9. **Agent-first writing.** Every capability doc answers when to use it, when
   not to use it, prerequisites, side effects, errors and verification.
10. **No dead knowledge.** Deprecated docs redirect, archive or explain the
    replacement.
11. **Human approval for high-impact changes.** Agents may propose docs updates;
    they may not silently rewrite official contracts.
12. **Measure the system.** Search misses, stale pages, failed examples and
    documentation gaps become tracked work.

---

## 5. The three-level model

| Level | Documentation | Main purpose | Primary readers |
| --- | --- | --- | --- |
| 1. Product knowledge | Platform overview, features, learning methodology, roadmap | Understand what Akoro does and why | Users, product, agents |
| 2. Technical knowledge | API, architecture, data models, integrations, engineering | Understand how Akoro works and how to build on it | Developers, coding agents |
| 3. Operational knowledge | Agent instructions, capabilities, permissions, testing, changelog, status | Operate, modify and maintain Akoro safely | Operators, maintainers, runtime agents |

A document should declare its level, audience and status. Level 1 is not
"marketing"; it is the conceptual model that makes the technical docs usable.

---

## 6. System architecture

```text
AKORO KNOWLEDGE BASE
        |
        +------------------+------------------+
        |                  |                  |
  API REFERENCE       AGENT KNOWLEDGE     DATA MODELS
        |                  |                  |
     OpenAPI            Workflows           Entities
     Schemas            Capabilities        Relations
     Endpoints          Instructions        Lifecycle
        |                  |                  |
        +------------------+------------------+
                           |
                  DOCUMENTATION INDEX
                           |
                    AGENT DISCOVERY
                           |
                   CONTEXT RETRIEVAL
                           |
                  AKORO AGENT RUNTIME
                           |
                     TOOL REGISTRY
                           |
                      AKORO APIs
                           |
                  DATABASE / SERVICES
```

The runtime separates four concerns:

- **Tool Registry:** which actions are available.
- **Documentation Registry:** which knowledge is available.
- **Context Manager:** which knowledge enters this task's context.
- **Agent Runtime:** which action happens next.

This separation is what allows many specialised agents to share one knowledge
base without every agent loading everything.

---

## 7. Canonical repository and folder structure

### 7.1 Recommended location

Use one canonical documentation repository/folder. For v1, keep it inside the
monorepo so documentation changes ship with code and can be reviewed in the
same pull request.

Recommended:

```text
akoro-documentation/
```

The public docs site (`akoro-docs/`) reads and curates a published subset. The
existing `docs/` folder becomes internal engineering notes or is migrated into
the appropriate numbered folders.

If the documentation later needs independent access control or a separate
publishing cadence, `akoro-documentation/` can become its own repository
without changing the content model.

### 7.2 Master structure

```text
akoro-documentation/
|
+-- README.md
+-- AGENTS.md
+-- llms.txt
+-- documentation-index.json
+-- capability-registry.yaml
+-- openapi.yaml
|
+-- 00-platform/
+-- 01-features/
+-- 02-api/
+-- 03-architecture/
+-- 04-learning/
+-- 05-data-models/
+-- 06-agents/
+-- 07-integrations/
+-- 08-engineering/
+-- 09-security-governance/
+-- 10-testing-quality/
+-- 11-changes-releases/
+-- 12-roadmap/
+-- 13-examples/
```

### 7.3 Root files

| File | Purpose |
| --- | --- |
| `README.md` | Entry point, navigation, contribution rules, status vocabulary |
| `AGENTS.md` | Agent operating guide: research order, source precedence, safety, update rules |
| `llms.txt` | Navigation convention for AI systems; not a substitute for OpenAPI |
| `documentation-index.json` | Compact discovery index for agents and search |
| `capability-registry.yaml` | Machine-readable catalogue of available capabilities |
| `openapi.yaml` | API contract; generated reference source |
| `CHANGELOG.md` | Human-readable change history, or a pointer into `11-changes-releases/` |

### 7.4 Category map

| Folder | Contents | Primary audience |
| --- | --- | --- |
| `00-platform` | Overview, architecture, ecosystem, terminology, principles, roadmap | Everyone |
| `01-features` | Feature docs by app/domain | Users, product, agents |
| `02-api` | OpenAPI, auth, endpoints, schemas, errors, limits, webhooks | Developers, agents |
| `03-architecture` | Frontend, backend, database, agents, memory, events, workers | Engineers |
| `04-learning` | Learning engine, methodologies, assessment, mastery | Educators, product, agents |
| `05-data-models` | Entities, relationships, lifecycle, ownership | Engineers, agents |
| `06-agents` | Operating principles, tools, permissions, memory, workflows, safety | Agents, engineers |
| `07-integrations` | Supabase, AI providers, payments, storage, email, content | Engineers, partners |
| `08-engineering` | Setup, repo, standards, testing, debugging, deployment | Engineers, coding agents |
| `09-security-governance` | Security, privacy, classification, isolation, AI governance | Security, compliance |
| `10-testing-quality` | QA strategy, API/agent/learning/security testing, release gates | QA, engineers |
| `11-changes-releases` | Changelog, releases, breaking changes, migrations, upgrades | Developers, partners |
| `12-roadmap` | Direction, priorities, planned work | Product, partners |
| `13-examples` | API, agent and workflow examples | Everyone |

---

## 8. Documentation categories

### 8.1 Platform overview and identity

| File | What it covers |
| --- | --- |
| `platform-overview.md` | What Akoro is, mission, audience, value proposition |
| `platform-architecture.md` | High-level architecture and system connections |
| `platform-ecosystem.md` | Learners, teachers, schools, AI protégés, administrators, partners |
| `terminology.md` | Akoro-specific concepts, synonyms and forbidden terms |
| `product-principles.md` | Principles guiding product and engineering decisions |
| `roadmap.md` | Current direction, priorities and planned development |

These documents are prerequisites for every other category. They should be
short, stable and linked from every top-level page.

### 8.2 Feature documentation

One document per feature, grouped by app or domain:

```text
01-features/
  learner/
    learner-dashboard.md
    learner-profile.md
    ai-protege.md
    learning-sessions.md
    study-prep.md
    practice-and-assessments.md
    learner-memory.md
    progress-tracking.md
  teacher/
    teacher-dashboard.md
    classroom-management.md
    assignment-creation.md
    learner-submissions.md
    ai-grading.md
    classroom-analytics.md
  school/
    school-registration.md
    school-dashboard.md
    school-agent.md
    student-management.md
    school-analytics.md
  ai/
    agent-system.md
    agent-memory.md
    agent-tools.md
    agent-orchestration.md
    agent-evaluation.md
  creator-studio/
    learning-studio.md
    session-creation.md
    workflow-generation.md
    dynamic-ui-generation.md
    plugin-runtime.md
```

The tree is illustrative. Phase 0 audits what actually exists. Planned features
are marked `planned`; they are never presented as available.

#### Feature document template

Every feature document contains:

1. Feature description and purpose.
2. Problem it solves.
3. Target users and permissions.
4. User journeys and interactions.
5. Functional requirements.
6. Business rules.
7. System behaviour.
8. Dependencies on other features.
9. Permissions and access restrictions.
10. Data created, updated or retrieved.
11. Edge cases and failure scenarios.
12. Current implementation status.

Recommended additional sections:

- Related capabilities and API endpoints.
- Related data models.
- Related learning or agent documents.
- Verification steps.
- Open questions and known limitations.

#### Status vocabulary

```text
implemented
beta
planned
deprecated
disabled
```

Every feature, capability and API page must display its status. An agent must
never infer that a planned feature exists.

### 8.3 API and integration documentation

Two layers:

#### Layer A: API reference

- OpenAPI 3.1 is the contract.
- Endpoints, methods, parameters, request/response schemas.
- Authentication and authorization.
- Errors, pagination, rate limits, idempotency.
- Webhooks and realtime.
- Generated reference pages.

#### Layer B: Agent knowledge

- When to use the capability.
- When not to use it.
- Prerequisites and ownership checks.
- Expected side effects.
- Related endpoints and workflows.
- Failure recovery.
- Verification steps.
- What must never be attempted.

Recommended structure:

```text
02-api/
  openapi.yaml
  authentication.md
  authorization.md
  endpoints/
  request-response-schemas.md
  error-codes.md
  pagination.md
  rate-limits.md
  webhooks.md
```

External integrations:

```text
07-integrations/
  supabase.md
  ai-providers.md
  payment-providers.md
  storage-providers.md
  email-notifications.md
  educational-content.md
```

Each integration document covers configuration, dependencies, failure handling,
fallbacks, rate limits, data shared, privacy impact and owning team.

### 8.4 System architecture documentation

```text
03-architecture/
  system-overview.md
  frontend-architecture.md
  backend-architecture.md
  database-architecture.md
  agent-architecture.md
  model-routing.md
  memory-architecture.md
  event-driven-architecture.md
  background-workers.md
  caching-strategy.md
  security-architecture.md
```

Special attention:

- Agent runtime and orchestration.
- Learner memory versus agent operational memory.
- Knowledge and concept tracking.
- Learning-session execution.
- Model routing and tool execution.
- Creator Engine and plugin runtime.

Architecture docs describe boundaries and invariants. They do not expose
secrets, credential values or exploitable internal details.

### 8.5 Learning methodology and educational documentation

Akoro is not a chatbot with content attached; its learning methodology is part
of the product.

```text
04-learning/
  learning-engine.md
  learning-methodologies.md
  active-recall.md
  spaced-repetition.md
  feynman-technique.md
  socratic-learning.md
  interleaving.md
  pomodoro.md
  teach-back-method.md
  assessment-framework.md
  mastery-framework.md
  knowledge-retention.md
  adaptive-learning.md
```

For example, `spaced-repetition.md` must explain:

- what spaced repetition means in Akoro;
- how review intervals are calculated;
- what learner evidence influences scheduling;
- how successful and unsuccessful recall are handled;
- how schedules interact with learner memory;
- which parts are deterministic and which involve AI;
- what the agent may decide and what only the learning engine may decide.

This gives every agent a consistent understanding of the educational rules it
must implement.

### 8.6 Data models and knowledge documentation

```text
05-data-models/
  data-architecture.md
  entity-relationships.md
  learner-model.md
  teacher-model.md
  school-model.md
  agent-model.md
  concept-model.md
  assessment-model.md
  learning-session-model.md
  memory-model.md
  database-conventions.md
```

Example relationship chain:

```text
Learner -> Learning Session -> Concept -> Assessment -> Evidence -> Learner Knowledge State
```

For every entity document:

1. What it represents.
2. Unique identifier.
3. Important fields.
4. Relationships.
5. Who owns it.
6. Who can read it.
7. Who can modify it.
8. Lifecycle and status transitions.

Example entity document shape:

```yaml
entity: Concept
description: >
  An identifiable learning concept within Akoro's educational knowledge
  structure.
primary_identifier: concept_id
relationships:
  - belongs_to: syllabus_topic
  - has_many: learning_materials
  - has_many: learner_concept_states
  - has_many: learner_concept_evidence
important_fields:
  - concept_id
  - title
  - description
  - subject_id
  - topic_id
  - difficulty
  - prerequisites
agent_guidance:
  - Retrieve concepts using their actual identifiers.
  - Do not assume topic titles are unique.
  - Check prerequisites before recommending progression.
  - Do not modify verified concept definitions.
```

### 8.7 Agent documentation

Agent documentation is a first-class category, not a subsection of API docs.

```text
06-agents/
  AGENTS.md
  agent-operating-principles.md
  agent-capabilities.md
  agent-tool-registry.md
  agent-permissions.md
  agent-memory-policy.md
  agent-workflows.md
  agent-handoffs.md
  agent-verification.md
  agent-error-recovery.md
  agent-safety.md
```

It answers:

- What can Akoro agents do?
- Which tools can they access?
- How should they choose tools?
- How should they recover from failures?
- When must they ask for clarification?
- Which actions require user confirmation?
- How do they verify that an action succeeded?
- How do they research a task using documentation?
- What must they never do?

Important: permissions are documented here but enforced only by the backend.

### 8.8 Changes, releases and migrations

```text
11-changes-releases/
  CHANGELOG.md
  releases/
    v1.0.0.md
    v1.1.0.md
    v1.2.0.md
  breaking-changes.md
  deprecations.md
  migrations/
    database-migrations.md
    api-migrations.md
  upgrade-guides/
```

Distinctions:

| Artifact | Question it answers |
| --- | --- |
| Changelog | What changed? |
| Release notes | What does this release mean for users and developers? |
| Migration guide | What must change to move to the new version? |
| Breaking changes | What previously working behaviour is no longer supported? |
| Deprecation | What is being phased out and when? |

Product and API changes are separate streams. API breaking changes require a
migration guide and a deprecation window.

### 8.9 Engineering documentation

```text
08-engineering/
  getting-started.md
  repository-structure.md
  development-environment.md
  coding-standards.md
  naming-conventions.md
  testing-strategy.md
  debugging-guide.md
  deployment-guide.md
  environment-variables.md
  observability.md
  contribution-guide.md
```

Include:

- how to run the project locally;
- how frontend and backend communicate;
- how to run tests;
- how to add a feature;
- how to add an API endpoint;
- how to change database schemas safely;
- how to deploy and roll back.

### 8.10 Security, privacy and governance

```text
09-security-governance/
  security-policy.md
  privacy-policy.md
  data-classification.md
  access-control.md
  tenant-isolation.md
  learner-data-protection.md
  data-retention.md
  audit-logging.md
  ai-governance.md
  human-approval-policy.md
```

Explain how Akoro protects learner data, separates school and learner access,
handles AI-generated content and controls privileged operations.

### 8.11 Testing and quality

```text
10-testing-quality/
  quality-assurance-strategy.md
  feature-test-cases.md
  api-test-cases.md
  agent-evaluation.md
  learning-effectiveness-evaluation.md
  security-testing.md
  regression-testing.md
  release-acceptance-criteria.md
```

Distinguish four kinds of correctness:

| Type | Question |
| --- | --- |
| Software correctness | Does the feature work? |
| Agent correctness | Did the agent choose and execute the right actions? |
| Educational effectiveness | Did the activity produce meaningful learning evidence? |
| Security correctness | Did the system enforce the required permissions? |

### 8.12 Examples

```text
13-examples/
  api-examples.md
  agent-examples.md
  complete-workflows.md
```

Examples include success and failure:

- successful requests;
- missing parameters;
- invalid identifiers;
- permission failures;
- empty results;
- duplicate requests;
- timeouts;
- asynchronous operations;
- recovery.

Agents learn more reliably from concrete successful and unsuccessful examples
than from prose alone.

---

## 9. Capability registry

### 9.1 Purpose

`capability-registry.yaml` is a machine-readable catalogue of what Akoro can
actually do. It is not the API reference and not the feature documentation. It
is the bridge:

- agents discover capabilities;
- each capability links to its docs, API contract and workflows;
- availability is explicit;
- permissions and confirmation rules are visible;
- CI validates that the capability exists.

### 9.2 Example schema

```yaml
platform: Akoro
capabilities:
  - id: learning.create_session
    name: Create Learning Session
    category: learning
    status: implemented
    description: >
      Creates a structured learning session using a selected learning
      methodology.
    documentation:
      - 01-features/learner/learning-sessions.md
      - 04-learning/learning-engine.md
      - 06-agents/agent-workflows.md
    api_reference:
      - 02-api/openapi.yaml
    access:
      - learner
      - authorized_agent
    requires_confirmation: true
    side_effects:
      - creates a learning session
      - updates session count and learner activity
    verification:
      - retrieve the session by id
      - check status is active

  - id: assessment.submit_attempt
    name: Submit Assessment Attempt
    category: assessment
    status: beta
    description: >
      Submits a learner's completed assessment attempt for evaluation.
    documentation:
      - 01-features/learner/practice-and-assessments.md
      - 04-learning/assessment-framework.md
    api_reference:
      - 02-api/openapi.yaml
    access:
      - learner
      - authorized_agent
    requires_confirmation: false
```

These entries are illustrative. Only publish capabilities that exist in the
codebase and have been verified.

### 9.3 Required fields

| Field | Purpose |
| --- | --- |
| `id` | Stable machine identifier |
| `name` | Human name |
| `category` | Domain grouping |
| `status` | `implemented`, `beta`, `planned`, `deprecated`, `disabled` |
| `description` | What it does |
| `documentation` | Links to capability/workflow docs |
| `api_reference` | OpenAPI operation references |
| `access` | Roles/agents allowed |
| `requires_confirmation` | Whether a human must approve |
| `side_effects` | What changes after execution |
| `verification` | How to confirm success |
| `constraints` | Limits, prerequisites, rate limits |

### 9.4 Registry invariants

- Every `implemented` capability maps to a real endpoint or backend operation.
- Every `planned` capability has `agent_access: false`.
- Every `deprecated` capability links to its replacement.
- Every `beta` capability has a known limitation section.
- Every capability links to at least one workflow or feature doc.
- CI fails on dangling documentation paths or OpenAPI operations.

---

## 10. Documentation index and progressive context loading

### 10.1 Principle

An agent should not read the entire documentation repository before reading its
tools. That wastes tokens, increases latency and can make the agent less
effective.

Order:

1. System instructions.
2. Tool definitions.
3. Task context.
4. Documentation discovery.
5. Documentation retrieval.
6. Execution and verification.

### 10.2 Loading stages

| Stage | What loads | Cost |
| --- | --- | --- |
| 1. System instructions | Identity, operating rules, safety | Small |
| 2. Tool definitions | Available tools and schemas | Moderate |
| 3. Task context | User request and relevant state | Variable |
| 4. Documentation discovery | Index entry, capability links | Small |
| 5. Documentation retrieval | Only the documents needed | On demand |
| 6. Execution | Tool results and required context | Variable |

### 10.3 Documentation index

`documentation-index.json` is a compact map of features to docs and
capabilities:

```json
{
  "features": {
    "learning_sessions": {
      "description": "Creating and managing learner study sessions",
      "docs": [
        "01-features/learner/learning-sessions.md",
        "04-learning/learning-engine.md"
      ],
      "capabilities": [
        "learning.create_session",
        "learning.update_session"
      ]
    },
    "assessments": {
      "description": "Practice questions, tests and assessments",
      "docs": [
        "01-features/learner/practice-and-assessments.md",
        "04-learning/assessment-framework.md"
      ],
      "capabilities": [
        "assessment.generate",
        "assessment.submit_attempt"
      ]
    }
  }
}
```

The index is not the documentation. It is a discovery layer.

### 10.4 Tool-linked documentation

Each tool definition links to the docs that explain it:

```json
{
  "name": "create_learning_session",
  "description": "Creates a structured learner session.",
  "documentation": [
    "01-features/learner/learning-sessions.md",
    "04-learning/learning-engine.md"
  ]
}
```

The runtime can retrieve linked docs before execution. Tool descriptions still
must contain enough information to select and call the tool correctly;
documentation retrieval supplements schemas, it does not replace them.

A dedicated tool may be exposed:

```text
search_akoro_documentation(query)
```

The agent uses it when it needs more knowledge.

### 10.5 Context-loading strategies

| Strategy | Purpose |
| --- | --- |
| Always loaded | Small instructions and essential operating principles |
| Task-based | Documents relevant to the current request |
| Tool-triggered | Docs linked to the selected tool |
| Memory retrieval | Relevant prior decisions and context |

Different agents receive different slices:

- Learner agent: learning, assessment, memory.
- Teacher agent: classroom, assignment, grading.
- School agent: school management, student records, analytics.
- Coding agent: architecture, API, data models, engineering, testing.

### 10.6 Illustrative token budget

Assume 200 docs, 150 tools and 500,000 documentation tokens. Loading everything
is expensive. A progressive context might look like:

| Context component | Illustrative tokens |
| --- | ---: |
| System instructions | 1,000 |
| Selected tools | 3,000 |
| Task context | 1,000 |
| Documentation index | 500 |
| Retrieved documentation | 2,000 |
| Total | 7,500 |

These are illustrative, not measured Akoro costs. Tool schemas and conversation
history can also become significant.

### 10.7 Context Manager

```text
AKORO AGENT RUNTIME
|
+-- System Instructions
+-- Tool Registry
+-- Context Manager
|   +-- Task Context
|   +-- Documentation Retrieval
|   +-- Memory Retrieval
|   +-- Feature Context
|   +-- State Context
+-- Agent Orchestrator
+-- Tool Executor
+-- Verification Engine
```

The Context Manager decides:

1. What information does the agent need?
2. What is already available?
3. What is missing?
4. Which documents should be retrieved?
5. Which memories are relevant?
6. What can be removed or summarised to control context size?

It should avoid retrieving the same document repeatedly within a task.

### 10.8 Separation of concerns

| Component | Question |
| --- | --- |
| Tool Registry | What actions are available? |
| Documentation Registry | What knowledge is available? |
| Context Manager | What knowledge should enter this context? |
| Agent Runtime | What action should happen next? |

---

## 11. Agent-readable API specifications

### 11.1 Two layers

- **API Reference:** endpoint, method, parameters, schemas, auth, errors.
- **Agent Knowledge:** when to use, when not to use, prerequisites, side
  effects, related workflows, failure recovery, verification.

### 11.2 Endpoint specification template

```yaml
capability:
  name: Submit Assessment Attempt
  id: assessment.submit_attempt
description: >
  Submits a learner's completed assessment attempt for evaluation and records
  the resulting score.
purpose: >
  Allows learners and authorised agents to submit completed assessments and
  obtain verified results.
endpoint:
  method: POST
  path: /api/assessments/attempts/submit
authentication:
  required: true
permissions:
  - learner
  - authorised_learning_agent
when_to_use:
  - The learner has completed the assessment.
  - All required answers have been collected.
  - The attempt is eligible for submission.
when_not_to_use:
  - The attempt is already submitted.
  - The learner has not started the assessment.
  - The attempt belongs to another learner.
prerequisites:
  - A valid assessment ID.
  - A valid attempt ID.
  - The authenticated learner owns the attempt.
  - The attempt is in an eligible state.
request:
  content_type: application/json
  fields:
    attempt_id:
      type: string
      required: true
      description: Unique assessment attempt identifier.
    answers:
      type: array
      required: true
      description: Learner's submitted answers.
expected_response:
  success:
    status: 200
    description: Assessment successfully submitted.
side_effects:
  - Attempt status changes to submitted.
  - Evaluation is initiated or completed.
  - Assessment result becomes available according to the evaluation workflow.
agent_instructions:
  - Never invent an attempt ID.
  - Verify the attempt belongs to the authenticated learner.
  - Do not submit an already submitted attempt.
  - Do not assume submission means the assessment is graded.
  - Retrieve the evaluation result before reporting a score.
error_handling:
  - code: INVALID_ATTEMPT
    action: Verify the attempt ID.
  - code: ALREADY_SUBMITTED
    action: Retrieve the existing result.
  - code: UNAUTHORIZED
    action: Stop and report the permission issue.
  - code: VALIDATION_ERROR
    action: Correct the request using the returned details.
status: implemented
```

The endpoint, permissions and response status are illustrative. Reconcile with
the actual API before publication.

### 11.3 Tool selection guidance

| User request | Appropriate capability |
| --- | --- |
| Teach me a topic | `learning.teach_concept` |
| Test my understanding | `assessment.create_attempt` |
| Give me JAMB questions | `assessment.retrieve_past_questions` |
| Show my weak topics | `learner.get_knowledge_gaps` |
| Create flashcards | `learning.generate_flashcards` |
| Create a custom study session | `creator.create_learning_session` |
| Review what I learned yesterday | `memory.get_scheduled_reviews` |
| Submit my assignment | `classroom.submit_assignment` |

Also document when not to use a tool. For example:

```text
assessment.retrieve_past_questions

Use when:
- The learner requests authentic past questions.
- A learning workflow requires verified examination questions.

Do not use when:
- The learner wants newly generated practice questions.
- The requested examination or topic is unsupported.

If no verified questions exist, do not silently substitute AI-generated
questions.
```

That last rule is an educational-integrity requirement, not a style preference.

---

## 12. Workflow documentation

Agents complete workflows, not single endpoints. Document complete workflows.

Example: **Teach a Concept and Assess Understanding**

```text
START
  |
  v
1. Retrieve learner profile
2. Retrieve learner learning state
3. Retrieve subject and topic information
4. Retrieve approved learning materials
5. Explain the concept
6. Ask learner to explain it back
7. Evaluate learner explanation
8. Retrieve verified JAMB questions
9. Create assessment attempt
10. Present questions
11. Collect answers
12. Submit assessment attempt
13. Retrieve verified assessment result
14. Update learner knowledge state
  |
  v
END
```

Rules:

| Condition | Agent action |
| --- | --- |
| Learner already understands the concept | Continue to assessment |
| Learner has a misconception | Explain again |
| No verified past questions exist | Report the gap; do not invent questions |
| Assessment submission fails | Follow the documented retry policy |
| Learner fails the assessment | Identify weak concepts and remediate |
| Learner passes | Ask the learning engine for the next eligible transition |

The agent does not directly unlock the next concept. The learning engine
verifies the result and controls the transition.

Workflow docs prevent agents from:

- generating questions when verified questions exist;
- skipping prerequisites;
- submitting an assessment twice;
- marking mastery without evidence;
- reporting a score before grading completes.

### Workflow template

Each workflow document contains:

1. Workflow ID and objective.
2. Required context and identifiers.
3. Preconditions.
4. Step-by-step flow.
5. Capabilities/APIs used at each step.
6. Decision rules and branches.
7. Side effects.
8. Failure and retry rules.
9. Verification steps.
10. Prohibited actions.
11. Related docs and examples.
12. Status.

---

## 13. Master `AGENTS.md`

`AGENTS.md` is the entry point for any coding, research or operational agent.

It should state:

- the purpose of the documentation;
- what to read before a task;
- source-of-truth precedence;
- API usage rules;
- educational-integrity rules;
- error-handling rules;
- documentation-maintenance rules;
- when to ask for human approval.

### Source-of-truth precedence

1. Current implementation and executable API contracts.
2. Current OpenAPI specification.
3. Current capability documentation.
4. Workflow documentation.
5. Examples and historical documentation.

If sources conflict, the agent must not silently choose one. It reports the
conflict.

### API usage rules

- Never invent endpoints.
- Never invent request parameters.
- Never invent identifiers.
- Never assume a planned feature is implemented.
- Never assume success without checking the response.
- Follow authentication and authorisation requirements.
- Respect rate limits.
- Follow idempotency rules for retryable operations.

### Educational integrity rules

- Use verified learning materials when available.
- Distinguish verified past questions from AI-generated questions.
- Never invent examination sources.
- Do not mark concepts as mastered without verified evidence.
- Respect learner privacy and ownership.

### Documentation maintenance

When an API or feature changes:

1. Update OpenAPI.
2. Update capability documentation.
3. Update affected workflows.
4. Update examples.
5. Record the change in the changelog.
6. Run documentation validation.

---

## 14. How agents research a task

Example request:

> Build a new learner dashboard that displays concept mastery, scheduled
> revisions and assessment performance.

The agent should not start coding immediately.

```text
TASK RECEIVED
      |
      v
RESEARCH AKORO
      |
      v
IDENTIFY CAPABILITIES
      |
+-----+-----+-----+
|     |     |     |
Memory Assessment Progress
|     |     |
+-----+-----+
      |
      v
READ API CONTRACTS
      |
      v
UNDERSTAND DATA MODELS
      |
      v
IDENTIFY WORKFLOWS
      |
      v
CHECK EXISTING COMPONENTS
      |
      v
PRODUCE IMPLEMENTATION
      |
      v
RUN TESTS
      |
      v
VERIFY INTEGRATION
```

The research stage produces a small structured report:

```yaml
research_result:
  task: learner_dashboard
  required_capabilities:
    - learner.get_progress
    - learner.get_knowledge_gaps
    - memory.get_scheduled_reviews
    - assessment.get_performance
  required_entities:
    - learner
    - concept
    - learner_concept_state
    - assessment_attempt
  missing_information:
    - No documented endpoint for retrieving combined dashboard data.
  implementation_notes:
    - Reuse existing learner progress APIs.
    - Do not calculate official mastery independently in the frontend.
    - Preserve server-side learner ownership checks.
  confidence: requires_api_verification
```

This gives the agent a research artefact and gives maintainers a documentation-gap
signal.

---

## 15. Self-validating documentation

Outdated documentation is worse than no documentation because agents trust it.

Validation:

| Check | What it verifies |
| --- | --- |
| OpenAPI validation | Specification is valid |
| Endpoint verification | Documented endpoint exists |
| Schema verification | Request/response schemas match |
| Example verification | Documented requests work |
| Link verification | Documentation references resolve |
| Workflow verification | Documented workflows can execute |
| Permission verification | Documented permissions match enforcement |
| Capability verification | Registry status matches reality |
| Index verification | `documentation-index.json` paths and IDs exist |
| Status verification | `implemented` capabilities have real operations |
| Secret scanning | No credentials or internal secrets in docs |

Recommended tools:

- OpenAPI Specification
- Redocly for linting and bundling
- Scalar or generated reference pages
- `llms.txt` as navigation, not a contract replacement
- CI route coverage against Express routes

Generate reference pages from the contract rather than maintaining the same
endpoint information in multiple places.

---

## 16. Agent-executable tool definitions

Documentation alone does not make a capability callable. Create a registry that
exposes documented capabilities as tools:

```json
{
  "name": "retrieve_learner_knowledge_gaps",
  "description": "Retrieves verified concepts where the authenticated learner has not demonstrated sufficient mastery.",
  "input_schema": {
    "type": "object",
    "properties": {
      "subject_id": {
        "type": "string",
        "description": "The subject identifier."
      }
    },
    "required": ["subject_id"],
    "additionalProperties": false
  },
  "documentation": [
    "01-features/learner/progress-tracking.md",
    "04-learning/mastery-framework.md"
  ]
}
```

Three representations must stay aligned:

| Representation | Purpose |
| --- | --- |
| OpenAPI | Defines the API contract |
| Agent documentation | Explains how and when to use it |
| Tool definition | Makes it callable by an agent |

Ideally, tool definitions and reference pages are generated from shared
definitions or validated against one another.

An agent must not receive unrestricted API access merely because an endpoint is
documented. Authentication, tenant isolation and permissions remain enforced by
the backend.

---

## 17. Public docs, changelog and status

The detailed public-surface plan is in
`docs/PUBLIC-DOCS-CHANGELOG-STATUS-PLAN.md`. It remains valid and becomes the
public presentation layer of this system.

### 17.1 Public docs

- `docs.akoro.ng`, Next.js + Fumadocs.
- Public allow-list, Tier-1 endpoints first.
- Getting started, auth, errors, uploads, media, app guides.
- Generated API reference from OpenAPI.
- Search, mobile nav, feedback, dark mode.

### 17.2 Changelog

- Product and API streams.
- Changelog, release notes, breaking changes, deprecations and migrations are
  distinct artefacts.
- PR labels generate drafts; an editor approves.
- RSS/JSON feeds.
- Breaking changes require migration guides and a deprecation window.

### 17.3 Status and incidents

- Independent managed provider at `status.akoro.ng`.
- Components: apps, API, auth, database, storage, media, extraction, AI,
  email/SMS, payments.
- Monitors, severity levels, incident templates, postmortems, subscriptions.
- Status must not depend on the API or Render service it reports on.

---

## 18. Documentation lifecycle and governance

### 18.1 Ownership

| Role | Responsibility |
| --- | --- |
| Documentation lead | Structure, templates, editorial, CI, public site |
| Domain owner | Feature and API accuracy |
| Agent-platform owner | Registry, index, tool definitions, context loading |
| Security | Sensitive content, permissions, data classification |
| Operations | Status, incidents, runbooks |
| Product | Roadmap, feature status, changelog |

### 18.2 Review

- Technical accuracy by domain owner.
- Style and structure by documentation lead.
- Security review for auth, data, permissions and infrastructure.
- Agent validation for capability and workflow docs.
- Review SLA: two business days; same day for breaking/security changes.

### 18.3 Change rule

A pull request that changes behaviour must update:

- OpenAPI if the contract changes;
- feature/capability docs if behaviour changes;
- workflow docs if steps or rules change;
- capability registry status if availability changes;
- changelog entry if users/developers are affected;
- examples if they would now fail.

CI should warn or fail when a public endpoint changes without a docs update.

### 18.4 Status labels

Every feature/capability doc starts with:

```yaml
status: implemented | beta | planned | deprecated | disabled
```

Rules:

- `planned` cannot have agent access.
- `deprecated` links to a replacement.
- `disabled` explains why and what to use instead.
- `beta` lists known limitations.
- `implemented` is verified by code/CI.

---

## 19. Implementation roadmap

### Phase 0 — Audit and inventory (2–4 days)

- Enumerate routes, modules, services and database tables.
- Enumerate apps and user-facing features.
- Identify existing agent capabilities and tools.
- Classify public, role-gated, internal and private.
- Map current docs to the new structure.
- Produce the initial capability list and documentation gaps.
- Confirm status vocabulary and source-of-truth rules.

**Output:** inventory spreadsheet, initial capability registry, page tree,
migration list.

### Phase 1 — Foundation (1 week)

- Create `akoro-documentation/` structure.
- Write `README.md`, `AGENTS.md`, `llms.txt`.
- Define templates: feature, endpoint, workflow, data model, architecture.
- Create `documentation-index.json` schema and initial entries.
- Create `capability-registry.yaml` schema and first verified entries.
- Set up link/format validation.

### Phase 2 — Capability and API knowledge (2–3 weeks)

- Write feature docs for Tier-1 domains.
- Build OpenAPI for Tier-1 public endpoints.
- Add agent-readable endpoint sections: when to use, prerequisites, side
  effects, errors, verification.
- Write complete workflows for the most important tasks.
- Add data-model documents for learner, concept, session, assessment, evidence
  and memory.
- Add examples, including failure cases.

### Phase 3 — Context and tooling (1–2 weeks)

- Build the documentation index and retrieval interface.
- Link tool definitions to docs.
- Implement or specify the Context Manager.
- Add `search_akoro_documentation`.
- Add permission metadata and confirmation rules.
- Add validation for registry/index/tool alignment.

### Phase 4 — Public surfaces (1–2 weeks, parallelisable)

- Build `akoro-docs` with Fumadocs.
- Publish getting started, auth, errors and Tier-1 API reference.
- Launch changelog and feeds.
- Launch managed status page and monitors.
- Run an incident drill.

### Phase 5 — Expand and harden (2–3 weeks)

- Tier-2 features and app guides.
- Engineering, security and quality docs.
- Migration and release notes.
- Search quality, analytics, feedback.
- Agent evaluation and documentation-gap review loop.

### Priority order

| Priority | Deliverable | Why |
| --- | --- | --- |
| 1 | `AGENTS.md` | Teaches agents how to research and operate |
| 2 | `openapi.yaml` | Machine-readable contract |
| 3 | `capability-registry.yaml` | What actually exists |
| 4 | Capability documentation | How features work |
| 5 | Workflow documentation | How to combine capabilities |
| 6 | Data models and examples | Prevents broken assumptions |
| 7 | Public docs, changelog, status | Human/partner surface |
| 8 | Automated validation | Keeps the system trustworthy |

---

## 20. Acceptance criteria

The system is ready for v1 when:

- `AGENTS.md` defines research order, source precedence and safety rules.
- `openapi.yaml` validates and covers all Tier-1 public endpoints.
- Every documented endpoint exists in code.
- `capability-registry.yaml` contains only verified capabilities and explicit
  statuses.
- Every `implemented` capability links to docs, API reference and verification.
- Feature docs use the standard template and status vocabulary.
- At least five end-to-end workflows are documented and validated.
- Data-model docs cover learner, concept, session, assessment and evidence.
- The documentation index resolves and supports retrieval.
- Tool definitions link to docs and match capability IDs.
- CI checks links, schemas, examples, routes, registry, index and secrets.
- Public docs, changelog and status are live and owned.
- Security has reviewed permissions, data and public content.

---

## 21. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Documentation describes planned features as real | Agents take invalid actions | Status vocabulary; registry validation; code audit |
| Docs drift from code | Wrong integrations | OpenAPI + route coverage + example tests |
| Capability registry becomes stale | Agents cannot trust discovery | CI checks and owner review |
| Context loading becomes too large | Cost/latency | Index + retrieval + summaries + dedup |
| Agents treat docs as permission | Security breach | Backend authorization; explicit warning in `AGENTS.md` |
| Too many docs before audit | Wasted effort | Audit first; capability-centred writing |
| One giant monolith | Slow navigation | Numbered categories, index, generated reference |
| Internal data leaks | Compliance/security | Public allow-list and security review |
| No clear owner | Stagnation | RACI, review SLA, docs in PR checklist |
| Status page goes down with Akoro | Users lose trust | Managed external provider |

---

## 22. Decisions and open questions

### Recommended defaults

| Decision | Recommendation |
| --- | --- |
| Canonical location | `akoro-documentation/` in the monorepo for v1 |
| Public site | `akoro-docs/` Next.js + Fumadocs |
| API contract | OpenAPI 3.1 |
| Capability model | Capability-centred |
| Agent context | Progressive retrieval via Context Manager |
| Status vocabulary | implemented/beta/planned/deprecated/disabled |
| Status page | Managed provider |
| Changelog | Product + API streams; PR-label drafts; editor approval |
| Permissions | Backend-enforced; docs descriptive only |

### Open questions

- Which domains are Tier 1 for the first capability audit?
- Does Akoro need a separate documentation repository immediately, or is a
  monorepo folder sufficient for v1?
- Which agent runtimes consume the index first: learner agent, coding agent, or
  both?
- Should capability registry and tool registry share one schema or two linked
  schemas?
- Which workflows are mandatory for v1?
- What is the human-approval policy for agents proposing documentation changes?
- Which status provider is approved?
- Is `/api/v1` approved as the public versioning policy?

---

## 23. Appendices

### A. Full proposed tree

```text
akoro-documentation/
|
+-- README.md
+-- AGENTS.md
+-- llms.txt
+-- documentation-index.json
+-- capability-registry.yaml
+-- openapi.yaml
|
+-- 00-platform/
|   +-- platform-overview.md
|   +-- platform-architecture.md
|   +-- platform-ecosystem.md
|   +-- terminology.md
|   +-- product-principles.md
|   +-- roadmap.md
|
+-- 01-features/
|   +-- learner/
|   +-- teacher/
|   +-- school/
|   +-- ai/
|   +-- creator-studio/
|
+-- 02-api/
|   +-- openapi.yaml
|   +-- authentication.md
|   +-- authorization.md
|   +-- endpoints/
|   +-- request-response-schemas.md
|   +-- error-codes.md
|   +-- pagination.md
|   +-- rate-limits.md
|   +-- webhooks.md
|
+-- 03-architecture/
|   +-- system-overview.md
|   +-- frontend-architecture.md
|   +-- backend-architecture.md
|   +-- database-architecture.md
|   +-- agent-architecture.md
|   +-- model-routing.md
|   +-- memory-architecture.md
|   +-- event-driven-architecture.md
|   +-- background-workers.md
|   +-- caching-strategy.md
|   +-- security-architecture.md
|
+-- 04-learning/
|   +-- learning-engine.md
|   +-- learning-methodologies.md
|   +-- active-recall.md
|   +-- spaced-repetition.md
|   +-- feynman-technique.md
|   +-- socratic-learning.md
|   +-- interleaving.md
|   +-- pomodoro.md
|   +-- teach-back-method.md
|   +-- assessment-framework.md
|   +-- mastery-framework.md
|   +-- knowledge-retention.md
|   +-- adaptive-learning.md
|
+-- 05-data-models/
|   +-- data-architecture.md
|   +-- entity-relationships.md
|   +-- learner-model.md
|   +-- teacher-model.md
|   +-- school-model.md
|   +-- agent-model.md
|   +-- concept-model.md
|   +-- assessment-model.md
|   +-- learning-session-model.md
|   +-- memory-model.md
|   +-- database-conventions.md
|
+-- 06-agents/
|   +-- AGENTS.md
|   +-- agent-operating-principles.md
|   +-- agent-capabilities.md
|   +-- agent-tool-registry.md
|   +-- agent-permissions.md
|   +-- agent-memory-policy.md
|   +-- agent-workflows.md
|   +-- agent-handoffs.md
|   +-- agent-verification.md
|   +-- agent-error-recovery.md
|   +-- agent-safety.md
|
+-- 07-integrations/
|   +-- supabase.md
|   +-- ai-providers.md
|   +-- payment-providers.md
|   +-- storage-providers.md
|   +-- email-notifications.md
|   +-- educational-content.md
|
+-- 08-engineering/
|   +-- getting-started.md
|   +-- repository-structure.md
|   +-- development-environment.md
|   +-- coding-standards.md
|   +-- naming-conventions.md
|   +-- testing-strategy.md
|   +-- debugging-guide.md
|   +-- deployment-guide.md
|   +-- environment-variables.md
|   +-- observability.md
|   +-- contribution-guide.md
|
+-- 09-security-governance/
|   +-- security-policy.md
|   +-- privacy-policy.md
|   +-- data-classification.md
|   +-- access-control.md
|   +-- tenant-isolation.md
|   +-- learner-data-protection.md
|   +-- data-retention.md
|   +-- audit-logging.md
|   +-- ai-governance.md
|   +-- human-approval-policy.md
|
+-- 10-testing-quality/
|   +-- quality-assurance-strategy.md
|   +-- feature-test-cases.md
|   +-- api-test-cases.md
|   +-- agent-evaluation.md
|   +-- learning-effectiveness-evaluation.md
|   +-- security-testing.md
|   +-- regression-testing.md
|   +-- release-acceptance-criteria.md
|
+-- 11-changes-releases/
|   +-- CHANGELOG.md
|   +-- releases/
|   +-- breaking-changes.md
|   +-- deprecations.md
|   +-- migrations/
|   +-- upgrade-guides/
|
+-- 12-roadmap/
|   +-- current-direction.md
|   +-- priorities.md
|   +-- planned-features.md
|
+-- 13-examples/
|   +-- api-examples.md
|   +-- agent-examples.md
|   +-- complete-workflows.md
```

### B. Feature document checklist

```text
[ ] Purpose
[ ] Problem solved
[ ] Target users
[ ] User journeys
[ ] Functional requirements
[ ] Business rules
[ ] System behaviour
[ ] Dependencies
[ ] Permissions
[ ] Data read/written
[ ] Edge cases and failures
[ ] Implementation status
[ ] Related capabilities
[ ] Related APIs
[ ] Related data models
[ ] Verification steps
[ ] Open questions
```

### C. Endpoint document checklist

```text
[ ] Method and path
[ ] Purpose
[ ] Auth and permissions
[ ] Path/query/header/body parameters
[ ] Required fields and defaults
[ ] Response schema
[ ] Errors and recovery
[ ] Side effects
[ ] When to use / not use
[ ] Prerequisites
[ ] Related workflow
[ ] Example request/response
[ ] Verification step
[ ] Status
```

### D. Workflow document checklist

```text
[ ] Workflow ID and objective
[ ] Required context
[ ] Preconditions
[ ] Steps and capabilities
[ ] Decision rules
[ ] Side effects
[ ] Failure and retry policy
[ ] Verification
[ ] Prohibited actions
[ ] Examples
[ ] Status
```

### E. Status vocabulary

```yaml
implemented: exists, verified and supported
beta: exists, supported with known limitations
planned: not available; agents must not use it
deprecated: still works but will be removed; replacement linked
disabled: not available; reason and replacement linked
```

### F. Agent research checklist

```text
[ ] Identify the task and success criteria
[ ] Identify required capabilities
[ ] Check capability status
[ ] Read capability docs
[ ] Read OpenAPI operations
[ ] Check auth and permissions
[ ] Read data models
[ ] Read workflow docs
[ ] Check existing components
[ ] Identify missing information
[ ] Implement or request clarification
[ ] Run tests
[ ] Verify side effects
[ ] Update docs/changelog if behaviour changed
```

### G. Relationship to the public docs plan

`docs/PUBLIC-DOCS-CHANGELOG-STATUS-PLAN.md` remains the detailed plan for:

- the public docs site;
- public API reference presentation;
- public changelog;
- public status page and incident communication.

This document is the master knowledge-system plan. The public plan is the
external presentation layer of this system.

---

## 24. Definition of done

The Platform Documentation System is complete for v1 when:

- the canonical repository and ownership are established;
- `AGENTS.md`, `openapi.yaml`, `capability-registry.yaml` and
  `documentation-index.json` exist and validate;
- Tier-1 features and APIs are documented in the standard templates;
- at least five end-to-end workflows are documented and tested;
- every capability has an explicit status and backend enforcement;
- agents can discover capabilities, retrieve only relevant docs and verify
  execution;
- public docs, changelog and status are live;
- CI prevents stale endpoints, links, examples, capabilities and permissions;
- documentation changes are part of the normal engineering workflow.
