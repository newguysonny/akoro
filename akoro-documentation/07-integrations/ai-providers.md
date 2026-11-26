---
title: AI providers
status: beta
doc_status: draft
audience: [engineer, partner]
last_reviewed: 2026-11-26
owners: [TBD]
---

# AI providers

## Purpose

All model traffic — agent chat, teaching, assessment, extraction assistance,
embeddings and voice — goes through one seam (`akoro-api/lib/aiModel.js`)
backed by a model registry (`lib/modelRegistry.js`). Features never call a
provider directly. The registry resolves each call by role, learner choice
and environment configuration to a catalogue entry: provider, API model,
price, capabilities and fallback.

## Providers the code actually uses

Provider adapters live in `akoro-api/lib/providers/`:

| Provider id | Adapter | Used for |
| --- | --- | --- |
| `opencode` | `opencode.js` | The public learner-pickable catalogue (DeepSeek, GLM, Qwen, Claude Haiku, GPT Luna, Grok) served through the OpenCode transport, Go and Console lanes |
| `openai` | via the OpenAI SDK | Legacy catalogue rows (GPT-4o mini and family) and embeddings default |
| `anthropic` | `anthropic.js` (`@anthropic-ai/sdk`) | Legacy Claude rows |
| `openai_compatible` | `openaiCompatible.js` | Direct compatible endpoints — notably DeepSeek direct (`deepseek-direct`, the catalogue's terminal fallback) and xAI |

Older configuration that named Grok or DeepSeek as their own provider is
normalised to `openai_compatible` entries. There is no Gemini, Mistral or
other provider adapter in the codebase.

## Configuration surface (names only)

- Keys stay per provider in the environment, never in the catalogue:
  `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`,
  `OPENCODE_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`.
- `AI_MODELS` (JSON) merges over the built-in catalogue by id;
  `AI_MODEL_DEFAULT`, `AI_MODEL_FALLBACK`, `AI_MODEL_ROLE_<ROLE>`,
  `AI_MODEL_LOCKED_ROLES`, `AI_MODEL_PICKER_ENABLED`, and the legacy
  `OPENAI_MODEL` steer resolution. A switched-on model with no price fails
  boot, so a learner is never billed at a wrong fallback rate.
- Resolution order: locked role → learner's pick (picker enabled, model
  enabled and selectable, in the payer's allowed list, with the role's
  required capabilities) → role default → global default.

## Failure handling and fallbacks

- Failover follows an ordered ladder — the model's own `fallbackModel`
  chain, then the runtime global fallback, then the default — bounded to
  four hops. Catalogue chains end at DeepSeek direct.
- Only transport/quota-shaped failures fail over (rate limited, auth,
  upstream 5xx, timeout, connection, quota/balance statuses). A malformed
  request does not hop providers.
- Capability requirements hold on every hop: a vision role never lands on a
  model without vision.
- Per-provider circuit breakers (`lib/aiBreakers.js`, built on the platform
  breaker) stop calls to a failing provider while it recovers.
- **Embeddings are the exception:** `lib/embeddingProvider.js` deliberately
  has no cross-provider fallback, because two models' vectors are not
  comparable. If the chosen embedding provider fails, the call fails and
  search degrades to its lexical half.

## Embeddings and speech

- Embeddings: OpenAI `text-embedding-3-small` (1536 dims, the default) or a
  self-hosted RunPod endpoint (Qwen3-Embedding-0.6B or bge-m3, 1024 dims
  zero-padded to the database's 1536). Configured by `EMBEDDINGS_PROVIDER`,
  `EMBEDDINGS_MODEL`, `RUNPOD_API_KEY`, `RUNPOD_EMBED_ENDPOINT_ID`,
  `RUNPOD_EMBED_BGE_ENDPOINT_ID`. Self-hosted model artefacts come from
  Hugging Face (`@huggingface/hub`; an `hfmirror` module mirrors them).
- Voice: Deepgram (`@deepgram/sdk`) for live transcription, an OpenAI
  realtime path, and a TTS module, under `akoro-api/modules/voice/`.

## Data shared and privacy impact

Prompts, conversation context and learner content (including extracted
document text for grounded answers) are sent to the resolved provider for
the duration of a call. Provider choice is therefore a privacy-relevant
configuration: the catalogue, not individual features, decides which
provider sees learner content, and cost is metered per call (`lib/aiPricing`
/ `lib/aiBilling`) against the learner-facing coin balance.

## Related

- [AI and agent runtime overview](../01-features/ai/overview.md)
- [Agent error recovery](../06-agents/agent-error-recovery.md)
- [Educational content](educational-content.md)
