---
title: Model routing
status: beta
doc_status: draft
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Model routing

## Purpose

Every AI call in the API resolves its model through one registry
(`lib/modelRegistry.js`) and one call path (`lib/aiModel.js`). Callers name
a role, not a model; the registry decides which provider, transport and
price apply, and the call path meters, bills and fails over.

## Boundaries

The registry owns the catalogue: model id, provider, lane, API family,
capabilities, price, selectability and fallback. It does not own provider
keys — keys stay per provider in environment variables (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `OPENCODE_API_KEY`, `DEEPSEEK_API_KEY`) and never
appear in the catalogue. Runtime overrides live in the database
(`edu.ai_runtime_settings`, loaded at boot by `lib/modelRuntime.js`) and in
the `AI_MODELS` environment value, which merges over the catalogue by id.

## Diagram

```text
caller names a role (chat, controller, persona, assessor, evidence,
                     agent_recall, question_generator, vision, ...)
      |
      v
resolveModel({ role, learnerChoice, allowedModels })
  1. locked role?            -> the role's env model, else the default
  2. learner's choice        -> only if the picker is enabled, the model is
                                enabled + selectable, in the payer's allowed
                                list, and has the role's required caps
  3. role env default        -> AI_MODEL_ROLE_<ROLE>
  4. platform default        -> AI_MODEL_DEFAULT (legacy OPENAI_MODEL
                                honoured), else gpt-4o-mini;
                                a disabled choice falls back to DeepSeek
      |
      v
lib/aiModel.js call path: provider adapter (openai | anthropic |
openai_compatible | opencode) -> metering + coin charge + telemetry
      |
      +-- retryable failure -> fallback ladder (bounded, 4 hops):
          the model's own fallbackModel chain, then the global fallback,
          then the default — capability-checked at every hop
```

## Request/event flow

1. Providers are `openai`, `anthropic`, `openai_compatible` and `opencode`;
   the OpenCode transport has two lanes (Go subscription, Console
   pay-as-you-go) and three API families (chat, responses, messages).
2. The public, learner-pickable catalogue is served through the OpenCode Go
   lane (DeepSeek is the default identity, with GLM, Qwen, Claude Haiku,
   GPT Luna and Grok alongside). Legacy direct-provider rows remain in the
   catalogue disabled, so old ids in wallet and telemetry history still
   resolve. DeepSeek also has a hidden direct-API fallback entry, callable
   only as a failover target.
3. An enabled `AI_MODELS` entry with no price fails boot — a learner on an
   expensive model must never be silently billed at a cheap model's rate.

## Data and storage

Prices are per-model input/output (and cached-input) rates in the
catalogue, used both for coin charging and for cost telemetry. DeepSeek's
static fallback price uses its peak rate so a missing reported cost is
never under-billed.

## Dependencies

Provider adapters in `lib/providers/`; the coin wallet (`lib/coins.js`) for
`chargeForAI`; circuit breakers per provider (`lib/aiBreakers.js`).

## Failure modes

- Retryable failures (rate limit, quota, upstream 5xx, timeout, connection)
  walk the fallback ladder; a bad request does not.
- Capability safety: a hop that lacks the role's required capability (for
  example vision) is skipped — an image is never sent to a model that
  cannot see it.
- `InsufficientCoins` is a stop outcome, not an exception path: agent loops
  end the step on it.

## Security and permissions

The learner model picker (`AI_MODEL_PICKER_ENABLED`, on by default) can
only select models that are enabled, selectable and in the payer's allowed
list. Locked roles — assessor and evidence always, plus any role added via
`AI_MODEL_LOCKED_ROLES`, and by design `agent_recall` and
`question_generator` — ignore learner choice entirely, so grading and
Agent Check difficulty stay comparable across learners and plans.

## Invariants

- Fallback answers go through the same registry default as primary
  answers; no code path may pin its own provider or model.
- The starting model of a call is never its own fallback target.
- Every model the server can bill for has a price before it can be enabled.

## Observability

`lib/aiTelemetry.js` records each call's model, cost and error kind;
reported provider cost is preferred, with the catalogue price as the
fallback estimate.

## Related

- [Agent architecture](agent-architecture.md)
- [Backend architecture](backend-architecture.md)
- [Capability registry](../capability-registry.yaml)
