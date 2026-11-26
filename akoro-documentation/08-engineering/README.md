# Engineering

Local setup, repository structure, coding standards, testing, debugging, deployment, environment variables, observability and contribution.

Status: Populated 2026-11-26. All pages are drafts written from the repository
itself (`akoro-api/package.json`, `render.yaml`, `akoro-api/.env.example`,
the repo `AGENTS.md`); deployment and environment facts should be re-checked
against those sources when they change.

## Documents

- [Getting started](getting-started.md)
- [Repository structure](repository-structure.md)
- [Development environment](development-environment.md)
- [Coding standards](coding-standards.md)
- [Naming conventions](naming-conventions.md)
- [Testing strategy](testing-strategy.md)
- [Debugging guide](debugging-guide.md)
- [Deployment guide](deployment-guide.md)
- [Environment variables](environment-variables.md)
- [Observability](observability.md)
- [Incident drill runbook](incident-drill-runbook.md)
- [Contribution guide](contribution-guide.md)

## Rules

- Engineering docs help humans and coding agents work safely without guessing conventions.
- Use the templates in `_templates/`.
- Declare status and ownership.
- Link capabilities, API operations, data models and workflows where relevant.
- Commands, scripts and deploy mechanics are quoted from the repo, never
  invented; if a mechanic cannot be confirmed in the repo, say so.
- Environment documentation names variables and purposes only — never values
  or secrets.
