# Architecture

System, backend, frontend, data, agent, model-routing, memory, event and security architecture.

Status: Phase 2 content in place. All eleven topic pages are written from the
current code on `kilo/modular-storm-thz` and carry draft status pending review.

## Documents

- [System overview](system-overview.md)
- [Frontend architecture](frontend-architecture.md)
- [Backend architecture](backend-architecture.md)
- [Database architecture](database-architecture.md)
- [Agent architecture](agent-architecture.md)
- [Model routing](model-routing.md)
- [Memory architecture](memory-architecture.md)
- [Event-driven architecture](event-driven-architecture.md)
- [Background workers](background-workers.md)
- [Caching strategy](caching-strategy.md)
- [Security architecture](security-architecture.md)

## Rules

- Architecture describes boundaries and invariants. It does not expose secrets or exploitable details.
- Use the templates in `_templates/`.
- Declare status and ownership.
- Link capabilities, API operations, data models and workflows where relevant.
