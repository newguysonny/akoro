# Akoro LLM provider switch — OpenCode as the default (open models, Claude, GPT)

**Status:** planned (decision record locked 2026-11-12) · **Owner:** backend/platform
**Piece:** `lib/modelRegistry.js` + `lib/aiModel.js` + `lib/providers/*` + admin API + model picker
**Goal:** make the default LLM a runtime/env choice — one switch changes provider and model
without a deploy, and the learner-facing picker follows it.

---

## 1. Why

Today the platform standardises on OpenAI/DeepSeek and the default is fixed by env at boot
(`AI_MODEL_DEFAULT`, legacy `OPENAI_MODEL`, else `gpt-4o-mini`). We want to:

- run **DeepSeek, GLM, Qwen, Claude Haiku, GPT Luna and Grok** through one gateway
  (**OpenCode Go**) — cheaper, one key, several providers;
- change the **default provider + model** from environment config *any time*;
- flip the default at runtime (**no restart, no deploy**) for incident response or cost spikes;
- bill from the provider's **reported cost**, not only our static price table;
- offer the same models to learners through the existing model picker.

The registry was built for this (providers, roles, prices, tiers, picker, adapters); this plan
adds the OpenCode transport, the runtime switch, provider-cost billing and the catalogue.

---

## 2. Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| 1 | Models first | **OpenCode Go only, for now.** Public set: **Claude Haiku 5.5, GPT 6 Luna, GPT 5.6 Luna, Grok 4.7, DeepSeek V4.1 Flash, Qwen3.8 Flash, GLM 5.3 Flash**. Everything else is removed/disabled until deliberately activated. Gemini, Kimi and MiniMax deferred; no Sonnet/Opus yet. |
| 2 | Billing | **A — provider-reported cost** (`usage.cost`), static price as fallback/estimate/display. |
| 3 | Switching | **Runtime admin override** (no restart), persisted, plus env. |
| 4 | Fallback | **DeepSeek V4.1 Flash** — per-entry fallback first, then global fallback (its own route falls back to the direct DeepSeek API if Go is unavailable). |
| 5 | Scope | **Both** the server default and the learner model picker. |
| 6 | Granularity | **One global default: DeepSeek V4.1 Flash** (`deepseek`), locked. No per-role model envs for now. |
| 7 | Privacy | Learner documents/prompts **may** transit OpenCode's routing. |
| 8 | Visibility | **OpenCode is internal only.** Existing model names/labels stay as they are; the new open models get neutral public identity (model family only). No provider/gateway name is ever shown. |

Locked roles (assessor, evidence, agent_recall, question_generator) keep their locked behaviour.
Gemini is deliberately deferred.

---

## 3. OpenCode transport facts

From `https://opencode.ai/docs/console/api/inference`:

- Base host: **Go lane** `https://opencode.ai/inference/go`; Console pay-as-you-go lane
  `https://opencode.ai/inference` (not used until Sonnet/Opus/frontier GPT are activated).
  Auth `Authorization: Bearer <key>`. Go is subscription-based with per-model monthly
  allowances; Console is per-request credits. Free-tier chat models return **403** from server
  clients.
- Go expects coding-agent traffic: send a real user agent and a stable
  `x-opencode-session` per conversation. Allowances are exposed per response
  (`usage.opencode.allowance`) and can overflow into Console credit with **Extra Usage**.
- **Each model is served by one API family**, so there is no single base URL:

| Family | Path | Used for |
|---|---|---|
| OpenAI Chat Completions | `/go/openai/v1/chat/completions` | DeepSeek, GLM 5.3 Flash |
| OpenAI Responses | `/go/openai/v1/responses` | GPT 6/5.6 Luna, Grok 4.7 |
| Anthropic Messages | `/go/anthropic/v1/messages` | Claude Haiku 5.5, Qwen3.8 Flash (`max_tokens` required) |
| Gemini | — | **not in scope** |

- Live model list: `GET /inference/v1/models` — resolve ids at boot; never hardcode vendor ids.
- Usage carries the real cost: `usage.cost`, `usage.opencode.billing_source`
  (`balance|go|byok|free`), `list_cost`, and cache read/write token counts. Streams report on
  the final usage event (`include_usage` for chat, `message_delta` for Messages,
  `response.completed` for Responses).

---

## 4. Env contract

```bash
AI_PROVIDER=opencode_go              # Go subscription lane (docs: coding-agent traffic)
AI_MODEL_DEFAULT=deepseek             # locked: DeepSeek V4.1 Flash (the default)
AI_MODEL_FALLBACK=deepseek            # its route falls back to the direct DeepSeek API
OPENCODE_API_KEY=…                   # Go key; only here, never logged
OPENCODE_BASE_URL=https://opencode.ai/inference/go
OPENCODE_USER_AGENT=akoro-api/1.0     # Go asks clients to identify themselves
OPENCODE_EXTRA_USAGE=on               # after a model's monthly allowance, use Console credits
AI_MODELS=[ … ]
AI_BILL_PROVIDER_COST=true           # decision A; static price when absent/unusable
AI_RUNTIME_OVERRIDE=on               # enables the admin switch
AI_MODELS=[ … ]                      # existing JSON catalogue, now with provider:"opencode"
```

- `AI_PROVIDER` does not bypass the registry; it records intent and lets boot validate that the
  intended provider has a key and at least one callable model.
- OpenCode is a transport behind **public models**. The final Go set (seven models, §5) is
  presented with neutral ids/labels; everything else is hidden until activated. No "OpenCode/"
  label, gateway id prefix or provider name appears in the picker, wallet or learner-facing text.
- Legacy `AI_MODEL_DEFAULT` / `OPENAI_MODEL` continue to work when the new vars are unset.
- One global default: role envs (`AI_MODEL_ROLE_*`) stay available but are not used by this plan.

---

## 5. Catalogue entries

Ids and labels are **ours and stable**; vendor strings live in `apiModel` so a vendor rename never
changes a learner's saved choice or telemetry. The public identity never names the gateway.

### Final Go model set (2026-11-12)

| public id | public label | Go apiModel | Go endpoint family | Go price in/out (per 1M) | Go monthly allowance |
|---|---|---|---|---|---|
| `deepseek` **← default** | DeepSeek | deepseek-v4.1-flash | chat completions | $0.15/$0.60 off-peak · $0.30/$1.20 peak* | $100 |
| `glm-5-3-flash` | GLM 5.3 Flash | glm-5.3-flash | chat completions | $0.15/$0.50 (cached $0.03) | $60 |
| `qwen3-8-flash` | Qwen3.8 Flash | qwen3.8-flash | anthropic messages | $0.15/$0.47 | $30 |
| `claude-haiku` | Claude Haiku | claude-haiku-5-5 | anthropic messages | $0.10/$0.50 ≤100K · $0.50/$2.50 >100K | $15 |
| `gpt-6-luna` | GPT 6 Luna | gpt-6-luna | responses | $0.10/$0.50 ≤272K · $0.20/$0.75 >272K | $15 |
| `gpt-5-6-luna` | GPT 5.6 Luna | gpt-5.6-luna | responses | $0.20/$1.20 ≤272K · $0.40/$1.80 >272K | $15 |
| `grok` | Grok | grok-4.7 | responses | $2.00/$6.00 ≤200K · $4.00/$12.00 >200K | $15 |

\* DeepSeek peak hours are 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri; the static fallback
price uses the **peak** rate so we never under-bill when the reported cost is missing.

### Removed / disabled until activated

- **OpenAI legacy:** `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o` — disabled and removed
  from the picker; GPT Luna is the OpenAI story now. Keep the registry rows (hidden, `enabled:false`)
  so old wallet/telemetry rows still resolve, then delete in a later cleanup.
- **Claude Sonnet / Opus / Fable** — hidden until activated.
- **Kimi / MiniMax / Gemini / Muse / MiMo / LongCat** — deferred.
- Nothing outside the seven rows above is selectable or defaultable.

```json
{
  "id": "gpt-6-luna",
  "label": "GPT 6 Luna",
  "provider": "opencode",
  "lane": "go",
  "family": "responses",
  "apiModel": "gpt-6-luna",
  "price": { "in": 0.10, "out": 0.50 },
  "caps": { "tools": true, "stream": true, "json": true, "vision": true },
  "selectable": true,
  "tier": "freemium",
  "fallbackModel": "deepseek"
}
```

## 5b. Internal routing: public model → transport

The learner sees a **product model** (id + label); the server picks the **transport** that
serves it. This is the layer that lets us move between OpenCode and direct provider APIs
without touching the catalogue, the picker, or anything a learner reads.

```
public model      internal routes (in order)                          fallback model
deepseek      →   opencode_go/chat     → direct deepseek              (global)
glm-5-3-flash →   opencode_go/chat                                    deepseek
qwen3-8-flash →   opencode_go/messages                                 deepseek
claude-haiku  →   opencode_go/messages → direct anthropic              deepseek
gpt-6-luna    →   opencode_go/responses → direct openai (later)        deepseek
gpt-5-6-luna  →   opencode_go/responses → direct openai (later)        deepseek
grok          →   opencode_go/responses → direct xai (later)           deepseek
```

The `opencode_go` lane requires the headers OpenCode asks for: a real user agent
(`OPENCODE_USER_AGENT`, e.g. `akoro-api/1.0`) and `x-opencode-session` with a stable id per
conversation, so routing and caching work. A separate `opencode` (Console pay-as-you-go) lane can
be added later for models Go does not include (Sonnet/Opus/frontier GPT) without changing the
public catalogue — only the route list.

- Routes are configuration, per environment (`AI_TRANSPORT=auto|opencode|direct`, plus an
  optional per-model override). "auto" uses the order above.
- A route is eligible only if its key exists, the model id resolves on that transport, and
  its capabilities cover the role; otherwise it is skipped at boot with a warning.
- **Billing keeps the public model as the unit.** The learner is charged the public model's
  coin price; the transport's real cost (reported by OpenCode, or static for direct) is what
  we record internally and reconcile against. Provider choice never changes what a learner
  pays, and never appears in a receipt.
- Telemetry carries `transport`, `billing_source`, `provider_cost_usd` and `list_cost_usd`
  as internal fields; no learner-facing surface renders them.

### Failover policy

1. **Same model, next transport** on: `429` (rate limit), `402` (balance/quota), `5xx`,
   timeouts/network errors, and gateway-specific unavailability. One short jittered retry,
   then move on — never hammer the same route.
2. **Context limit is not a transport failure.** Map `context_length_exceeded` /
   "prompt is too long" to its own error kind. Do **not** resend the same oversized prompt to
   an equivalent route. Instead: use a route/model with a larger context if one is configured,
   else trigger the existing truncation/summarisation path, and only then fail.
3. **Cross-model fallback** (`AI_MODEL_FALLBACK=deepseek`) when every route for the chosen
   model is exhausted.
4. **Silent when it is the same model** (transport swap). If the public model had to change,
   the learner gets the existing notice, phrased without provider names
   ("Using DeepSeek: Claude is busy right now").
5. Every failover is logged with model, from-route, to-route, error kind and latency, so the
   internal dashboard shows which transport is carrying the product — without surfacing it to
   learners.

## 6. Implementation shape

### 6.1 Registry / transport
- `provider: "opencode"` + `family: "chat" | "anthropic" | "responses"`.
- `chat` → existing `openaiCompatible` adapter, base `…/inference/openai/v1`.
- `anthropic` → existing Anthropic adapter with a `baseURL` option (`…/inference/anthropic`).
- `responses` → new thin adapter over `…/inference/openai/v1/responses`, mapping input/tools and
  streaming events to the chat-completions shape the codebase consumes.
- One circuit breaker per base URL (already the pattern); ability to probe
  `GET /inference/v1/models` for `/health` and catalogue validation.
- Adapters surface `providerCostUsd`, `billingSource`, `listCost`, cache tokens on the result
  and on the final stream usage.

### 6.2 Billing / telemetry
- `AI_BILL_PROVIDER_COST=true` and a reported cost present → debit coins from the reported
  cost (existing markup/coin conversion), else from the static price (and the current estimate
  path when a stream omits usage).
- Always record reported cost + `billing_source` + list cost, even when billing statically.
- Warn `cost_drift` when reported ≫/< list price (threshold configurable).
- Telemetry gains `provider`, `family`, `billing_source`, `provider_cost_usd`,
  `list_cost_usd`, `cache_read`, `cache_write`.

### 6.3 Runtime override (no restart)
- `GET  /api/admin/ai/model` → default, fallback, provider status, live models.
- `PUT  /api/admin/ai/model` `{ defaultModel, fallbackModel? }` → validated (known, enabled,
  available, priced, pickable/callable) and applied to the live registry. New calls use it;
  in-flight calls finish on the old model.
- `DELETE /api/admin/ai/model` → back to env defaults.
- Persisted in `edu.ai_runtime_settings` so restarts keep the switch; admin-guarded; audit entry
  (who, old, new, when) and a log line.
- Precedence: **locked role → learner choice → role env → runtime default → env default**.
  The override replaces only the global default; a kill switch is
  `PUT { "defaultModel": "deepseek" }` or the env var.

### 6.4 Learner picker / tiers
- The picker shows exactly the seven Go models (§5) with neutral labels. No provider field is
  added to the payload and no "OpenCode" string is rendered.
- Availability is decided by the internal routes (§5b), so a model stays selectable as long as
  at least one eligible transport exists.
- Locked roles unchanged; a learner's saved choice keeps working across a transport switch.

---

## 7. Rollout

1. **Sandbox**: provider + `chat` family, one open model, default switched via env. Verify chat,
   tools, streaming, JSON, refusal/fallback, and that the coin debit equals the reported cost.
2. **Claude via Anthropic family**, then **GPT via Responses** (feature-flagged last).
3. Runtime endpoint + persistence + kill switch; verify override survives a restart.
4. **Production**: DeepSeek fallback retained; monitor 24–48 h — cost per feature, fallback
   rate, error rate, ttfb per provider — then widen the picker/tiers.

---

## 8. Acceptance criteria

- Switching the default needs only env **or** the admin endpoint — no deploy, no learner UI edit.
- An unavailable/unpriced model is never silently billed at another model's rate; it stays
  unavailable.
- With decision A on, coins match the provider's reported cost within rounding; currency math
  unchanged.
- Chat + tools + stream + JSON work on all three families; non-tool models are never selected for
  `controller`.
- DeepSeek fallback is exercised by a forced 500/402 in tests, with the existing learner notice.
- The picker lists only available, allowed, capable models, immediately reflecting a runtime
  switch — and its payload/UI contains **no provider name or "OpenCode" string**.
- Forcing the primary transport to fail (429/500) swaps to the next route of the **same**
  public model with no learner-visible change; only a model change produces a notice.
- `/health` reports OpenCode key + model-list reachability.

---

## 9. Risks

- **Responses family** is the least-known transport (different streaming and tool-call shapes) —
  ship it last, behind a flag.
- Reported cost can be missing or `opencode.estimated`; fall back to static price and log.
- Balance/Go exhaustion mid-request: charge what was reported; next call falls back.
- A gateway adds a third party in the data path — accepted (decision 7); keys per environment,
  never logged; learner-visible notices unchanged.
- Two providers callable at once (default + fallback) means two breakers and two cost streams to
  watch.

---

## 10. Out of scope / later

- Gemini family.
- Per-role model defaults (one global default for now).
- Embeddings, voice and transcription — stay on their current providers; OpenCode is chat-only.
- Automatic provider shopping by price/latency.

---

## 11. Implementation order (when we code)

1. Registry entry validation (`provider: opencode`, `family`) + availability + boot validation.
2. `chat` transport through `openaiCompatible`; one model; tests for routing and caps.
3. Usage/cost extraction + billing A + telemetry fields; streaming usage capture.
4. Anthropic family (baseURL) and Responses adapter (flagged).
5. Runtime override store, admin endpoints, audit, kill switch.
6. Picker/tiers updates + learner-visible labels.
7. Sandbox E2E, then production rollout with DeepSeek fallback.

---

## 12. Open items for implementation time

- Exact first model per family (from the live model list) and its `price` values for the
  fallback biller.
- ~~Which model is the single global default~~ — **locked: DeepSeek V4.1 Flash**. Runtime
  override may change it temporarily; the env default stays DeepSeek.
- Public labels/tiers for the two Luna models (both are listed; decide whether both are visible
  or GPT 6 Luna is pickable and 5.6 is internal).
- When to activate Sonnet/Opus/Kimi/MiniMax: flipping `enabled/selectable` plus a route, no
  code change.
- Whether to send `x-opencode-session` per chat session or per learner (affects caching and
  abuse monitoring).
- Context-limit ladder: which models/routes count as "larger context" before summarisation.
- Learner notice wording for the silent-vs-model-change cases.
- Drift threshold and alert destination.
- Admin authentication to reuse (existing admin guard vs console key).
- Whether the learner picker shows vendor provider names or friendly aliases only.

---

## 13. Implemented (2026-11-12)

- **Transport:** `lib/providers/opencode.js` — one OpenAI chat-completions adapter per
  OpenCode lane (`OPENCODE_BASE_URL/<lane>/openai/v1`), `OPENCODE_API_KEY`, the Go headers
  (`User-Agent`, `x-opencode-session` from the request context), one breaker per base URL, and
  the gateway's `usage.cost` / `opencode.billing_source|list_cost|allowance` preserved as a
  non-enumerable `__opencode`.
- **Registry:** provider `opencode` with `lane` + `family`; the seven Go models are built in as
  neutral public entries with prices; legacy GPT-4o/4.1 and Sonnet/Opus/Fable rows are retained
  but disabled/hidden. Default `deepseek`; a disabled default falls back to it.
- **Resolution:** `defaultId`/`fallbackId` are live getters; the runtime override wins over the
  env default, per-role envs and locked roles keep their precedence.
- **Billing (decision A):** `chargeForAI({ costUsd })` debits the provider-reported cost via
  `coinsForReportedCost` when present, else the static price (DeepSeek's peak rate for the
  fallback). Telemetry records `provider`, `lane`, `billing_source`, `provider_cost_usd`,
  `list_cost_usd`, `allowance_usd`, cache read/write.
- **Failover:** retryable provider failures (429/402/5xx/timeout/auth) retry once on the next
  model — entry `fallbackModel` → runtime/env fallback → default. Streams fail over only before
  the first chunk. Refusals keep the existing fallback path. Context-limit errors are not
  retried (they fall through to the caller's trim/summarise path).
- **Runtime switch:** `GET/PUT/DELETE /api/admin/ai/model` (admin JWT), persisted in
  `edu.ai_runtime_settings`, audit-logged, cached with a 30 s refresh so a change reaches every
  instance without a restart; clearing returns to env.
- **Picker:** same endpoint/labels for learners; provider/internal fields are stripped
  (`publicModel`), the seven Go models follow the tier lists, and no "OpenCode" string reaches
  the browser.
- **Boot:** `loadRuntimeSettings()` runs before `listen`; a missing table logs and falls back to
  env (apply the migration).
- **Tests:** 98 across registry, tiers, picker, callsites, adapters, runtime, pricing — all green.

- **Full failover ladder:** a retryable failure (429/402/5xx/timeout/auth) walks
  `entry.fallbackModel → that model's own fallback → …` (max 4). So GLM → DeepSeek
  OpenCode → DeepSeek direct, all inside one request; each hop is availability-checked and the
  final answer carries `model_fallback: { model, fallbackModel, tried, reason }`. Streams walk
  the ladder before the first chunk; refusals keep the single existing hop.
- **DeepSeek direct failover:** the public `deepseek` row (OpenCode Go) carries
  `fallbackModel: "deepseek-direct"` — a hidden, non-selectable entry
  (`provider: "deepseek"` → OpenAI-compatible, `https://api.deepseek.com`,
  `DEEPSEEK_API_KEY`, apiModel from `DEEPSEEK_MODEL`). A 429/402/5xx/timeout first
  retries that same model on its direct transport; if the direct key/model is absent it is
  skipped (availability-checked), never guessed. Learners only ever see "DeepSeek".

### Still open

- Console pay-as-you-go lane (for Sonnet/Opus/frontier GPT when activated) and direct
  Anthropic/OpenAI/xAI routes per model.
- Native family endpoints (messages/responses) if tool-call fidelity through translation is not
  enough; the schema (`family`) is ready.
- Go monthly-allowance enforcement UI/alerts and the cost-drift threshold.
- `x-opencode-session` is currently the request id; switch to a conversation id for better
  cache/route stickiness.
- Admin UI for the switch (the API is live).

## 14. Pinned helpers converted to roles (2026-11-12)

The platform default is now the only switch for the helpers that used to name a
model. Each maps to a role and is resolved with capability checks:

| Helper | Role | Notes |
|---|---|---|
| Chat follow-up / learn / upload suggestions | `suggestions` (JSON) | follows the default (DeepSeek) |
| Guide chat | `persona` | follows the default; `OPENAI_GUIDE_MODEL` is no longer read |
| Vision imports / OCR | `vision` (vision) | the default can't see images, so it resolves the first capable model (`gpt-6-luna`, then `claude-haiku`, `qwen3-8-flash`) |
| Tool builder / code generator | `builder` (JSON) | follows the default |
| Battle answerer | `battle_answer` | follows the default |
| Battle judge | `assessor` (locked) | the locked role decides; `BATTLE_JUDGE_MODEL` is gone |
| Agent Check recall | `agent_recall` (locked) | unchanged lock, no pinned model |
| Search rerank | `rerank` (JSON) | follows the default |
| Syllabus importer | `background` | follows the default |

- The resolver now checks the **default's capabilities** for the role: a role
  that needs vision or JSON will not silently use an incapable default.
- Failover is role-aware too: a vision call's hops are all vision-capable; it
  never falls back to text-only DeepSeek.
- **Overrides are role envs now:** `AI_MODEL_ROLE_SUGGESTIONS`,
  `_VISION`, `_BUILDER`, `_RERANK`, `_BATTLE_ANSWER`, `_PERSONA`, … The old
  `OPENAI_SUGGEST_MODEL`, `OPENAI_GUIDE_MODEL`, `OPENAI_VISION_MODEL`,
  `AKORO_SELF_TOOLING_MODEL/CODE`, `BATTLE_ANSWER_MODEL`, `BATTLE_JUDGE_MODEL`,
  `RERANK_MODEL`, `SYLLABUS_IMPORT_MODEL` are no longer read.
- **Still pinned by API shape:** chat think mode and research mode use the
  OpenAI **Responses** API (`OPENAI_THINK_MODEL` / `OPENAI_RESEARCH_MODEL`).
  The admin page lists only these two under “Feature models”.

## 15. Model + mode switches (implemented 2026-11-12)

- The Agent Chat's single menu is now **two instances of the same `ModelSwitch`**:
  a model switch (models only) and a mode switch (Default / Thinking /
  Research), side by side in the composer.
- `/api/adaptive/chat/models` returns `modes` without a model and each model
  with `modes: { default, think, research }`. Availability comes from
  capabilities: `think` needs `caps.reasoning` (or a Responses surface),
  `research` needs tools. Nothing is guessed in the browser.
- Modes the selected model cannot run are disabled in the mode menu (same
  styling as “Coming soon” models) with “Not available for <model>”. The
  server also downgrades to Default, with a notice, if an old client asks
  anyway.
- **Thinking runs on the selected model** over chat completions: a
  `reasoning_effort` hint is tried once, any exposed `reasoning_content` /
  `reasoning` streams into the Thought row, and the answer comes from the same
  model. Capability probe (2026-11-12): DeepSeek 37, GLM 20, Qwen 105, GPT 6
  Luna 30, GPT 5.6 Luna, Grok 109 reasoning tokens; Claude Haiku 0 (Thinking
  disabled). The older Responses path remains only for models with
  `caps.responses`; `OPENAI_THINK_MODEL` is its fallback, no longer the mode.
- **Research runs on the selected model** with the deeper retrieval.
  `OPENAI_RESEARCH_MODEL` is a fallback when no pick is sent.
- Verified live: `/chat/models` marks per-model modes; Think+DeepSeek answered
  391 with `metadata.model = deepseek-v4.1-flash`; Research+DeepSeek and
  Default+DeepSeek also ran on the picked model. Frontend deploy required for
  the two-switch UI.

## 16. Per-role and per-feature runtime overrides (2026-11-12)

The admin AI model page now edits more than the global default:

- `edu.ai_runtime_settings.role_models` — `{"suggestions":"glm-5-3-flash", …}`.
  Resolution: learner pick → **runtime role override** → `AI_MODEL_ROLE_<ROLE>`
  → platform default. Locked roles accept a runtime override too (they still
  ignore learner picks). An override that is disabled, unavailable or missing
  the role's capabilities is ignored and the env/default is used.
- `edu.ai_runtime_settings.feature_models` — the two Responses/fallback modes
  (`think_mode`, `research_mode`). Research may point at any tool-capable model;
  Thinking's Responses fallback requires a `responses` model. These modes run on
  the learner's selected model when it can handle them; the override only
  supplies the fallback.
- `PUT /api/admin/ai/model` accepts `roleModels` and `featureModels` alongside
  `defaultModel`/`fallbackModel` (all optional; omitted fields are unchanged,
  explicit empty values clear). Every id is validated for existence,
  availability and the role/feature capability. `GET` returns the raw overrides
  (`runtime.roleModels/featureModels`) and per-row `override` + `source`.
- The page renders a dropdown on every role and feature row; “Env / default”
  clears that override. One Save applies the default, fallback and all maps;
  Reset clears everything back to env.

Practical meaning: suggestions, vision, builder, rerank, battle answering and
the locked graders can each be pinned to a different model from the admin page
without a deploy; the default remains the fallback for anything left on
“Env / default”.
