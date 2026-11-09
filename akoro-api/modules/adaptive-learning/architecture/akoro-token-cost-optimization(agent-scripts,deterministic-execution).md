# Akoro Token Cost Optimization — Agents + Scripts for Repetitive Tasks

**What this covers:** a platform-wide initiative to move *deterministic, repetitive* work off the LLM and onto scripts, so the same result costs zero inference tokens instead of thousands. The "intelligence" is spent once to write the script; the "execution" is a fixed code path that runs every time for free.

**Inspiration:** the "agent + script" cost pattern — recording & replay, one-shot compile-to-code, helper scripts for fixed operations, and delegating token-heavy I/O — reporting 90–99% token savings on repetitive workflows. We adopt the *idea* (deterministic execution where the outcome should be fixed) but **not** naive per-task recording; see §6.

**Reads alongside:** [[akoro-creator-agent(custom-learning-sessions,blueprint)]], [[Akoro Context Layer Adoption — Mini-Plan All Agentic Surfaces]], `docs/llm-cost-model.md`, `reference/Akoro Token Metrics & Economics Plan.md`.

---

## 1. Positioning

> *"If the answer should always be the same, don't ask the model. Run the script."*

Akoro has **41+ LLM call sites** in `akoro-api` (the context-layer survey counted 41 files importing `chat.completions.create`; today `grep` counts 67). Not all of them need an LLM. A meaningful subset makes a *decision* or *transformation* whose correct output is fixed given the input — classification, extraction, filtering, embedding, scaffolding, retrieval. Those are the surface this plan targets.

The goal is not to reduce model quality. It is to ensure that the model is only ever invoked where **probabilistic reasoning is the actual value-add**, and that everything around it — the plumbing, the filtering, the deterministic classification — runs as cheap code.

## 2. The principle

| | LLM | Script |
|---|---|---|
| Nature | probabilistic, expensive, slow | deterministic, cheap, instant |
| Cost | ~tokens × model price | 0 tokens |
| Repeatability | may differ run-to-run | identical every run |
| Best at | novel reasoning, prose, synthesis | known, fixed transformations |

The savings mechanics, mapped to Akoro:

1. **Recording & replay** — a successful workflow is captured once, then replayed deterministically (→ embeddings, RAG retrieval, syllabus structure).
2. **Compile-to-code** — one LLM call produces a reusable artifact (JSON blueprint / cached embedding / extracted structure); later runs execute the artifact, not the LLM.
3. **Helper scripts for fixed operations** — a CLI/script replaces a high-token instruction block (→ lint, filter, scaffold).
4. **Delegate token-heavy I/O** — a script reads/parses the 10,000-line input and hands the LLM only the 15 relevant lines (→ the `analyze_logs.py` pattern).

## 3. What already exists in the backend

The platform is unusually well-prepared for this. The plumbing is done; only the *decisions about which tasks are deterministic* remain.

| Existing capability | Where | Role in this initiative |
|---|---|---|
| Single metered AI gateway | `lib/aiModel.js` (a `Proxy` over the OpenAI client) | Every call is metered with no per-call-site wiring — so savings are measurable per surface |
| Coin cost model | `lib/aiPricing.js` + `lib/coins.js` (`docs/llm-cost-model.md`) | Real USD cost → coins; a 2× markup means every token saved is margin |
| Per-call telemetry | `lib/aiTelemetry.js` (`recordAiCall`: tokens, cost, latency, feature) | The measurement backbone to prove savings before/after |
| Feature attribution | `lib/aiContext.js#featureForRequest` (longest-prefix path → label) | Groups spend by surface so we know *where* to optimize |
| Deterministic intent routing (reference impl) | `modules/adaptive-learning/agent-chat-intent.js` | 223 lines of regex that FORCE tool calls instead of letting the model reason — the pattern to replicate |
| Deterministic post-filter | `modules/agent-runtime/factFilter.js` | Drops hallucinated numbers with a numeric containment check — no LLM |
| Context budgeting | `contextBudget.js`, `modules/agent-context/` (8 KB/file, 24 KB/set) | Keeps prompt slices small; a proof that "curated slice, not whole brain" saves tokens |
| Prompt caching | `lib/aiModel.js` cached-token handling, billed at `AI_CACHED_INPUT_FACTOR` (0.5×) | Already discounts the stable system prompt automatically |
| Offline-cached model workers | `embed-worker/`, `runpod-worker/` (hanji-parse-4b), `proctor-service/` | Deterministic parse/embed/proctor paths already sit outside the LLM gateway |
| Golden-path eval harness | `scripts/evals/`, `scripts/golden-path/`, `scripts/capture.mjs` + `scripts/transcript.mjs` | The byte-identical snapshot discipline to prove a script reproduces the LLM's output |

## 4. The gap

The **measurement** exists, but the **deterministic execution layer does not extend to the surfaces that need it most.** Concretely:

- **Intent classification still partly LLM-driven.** `chat-follow-ups.js`, `agent-tool-request-intent.js`, `chatSuggestions.js` decide *what to do next*; the context-layer plan already marks these "verify (rules or LLM)". Every one that is LLM is an inference round-trip spent on a routing decision.
- **Embeddings are recomputed for stable text.** `syllabus.js#embed()`, `agents/student/knowledge.js`, `training/agentPromptBuilder.js` embed text that rarely changes (syllabus, past questions, trained-teacher chunks). Embeddings are a pure function of the text — no cache exists on the *result*.
- **Full OCR text is dumped into agent context.** `tasks/lib/context.js#buildContext` loads every task file's `ocr_text` and hands it to the model un-filtered. This is the "read the whole 10,000-line log" anti-pattern, live.
- **Conversation/memory is re-assembled per turn.** `chat.js` (5262 lines), `chat-memory.js`, `chat-history-tools.js` re-compress/re-summarize on every turn without a deterministic dedup/pre-filter step.
- **Boilerplate generators re-author the fixed shape.** `tasks/tools/*.js` (`worksheet-fill.js`, `lesson-plan-fill.js`, `mcq.js`, `generate-quiz.js`) have a *fixed structure* — only the content varies, but the model regenerates the scaffold each time.

## 5. Design decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Measure before optimizing.** No script is written until `aiTelemetry` proves the surface's spend. | 67 call sites, not all equal — optimize by evidence, not by intuition |
| D2 | **Deterministic-script-first, not LLM-first.** A task is a script unless it *needs* probabilistic reasoning. | The inverse default (LLM until proven cheap) is what costs money today |
| D3 | **Byte-identical replacement gate.** A script replaces an LLM call only when a golden snapshot proves identical output on the eval set — same discipline as the context-layer migration (`D1` there). | Prevents "saved tokens, broke behaviour" |
| D4 | **Deterministic = code, not "prompt the model to be cheaper".** We write `analyze_logs.py`, we do not add "be concise" to the prompt. | Prompt-only savings are fragile and don't remove the inference |
| D5 | **The gateway stays the single chokepoint.** Scripts run *before* the gateway (pre-filter) or *replace* a call entirely — never a second, un-metered LLM path. | Preserves the metering/security invariant from `docs/llm-cost-model.md` |
| D6 | **The model only ever sees the distilled result.** Filters, dedup, and scaffolding happen in code; the model receives the small output. | The `analyze_logs.py` contract — 150k tokens → 200 |
| D7 | **Replay caches are keyed on content, not identity.** Cache keys hash the *text*, so the cache self-invalidates when content changes. | No stale-result bugs from a key that outlives its input |
| D8 | **Test a lever with the existing harness, never a new one.** A lever ships with a golden fixture in `lib/evals/data/` scored by the existing `matches`/`scoreRun` — no bespoke test runner. | The sandbox + eval harness already cover plumbing, scoring, and cost; a parallel harness would drift and double the surface |

## 6. The deterministic-execution levers

The canonical five levers, each mapping to live Akoro surfaces. Every lever is independently shippable, deterministic, and golden-testable.

### Lever 1 — Deterministic intent classification & routing

Replace LLM routing decisions with regex/rules passes, exactly as `agent-chat-intent.js` already does.

- `modules/adaptive-learning/agent-tool-request-intent.js`
- `modules/adaptive-learning/chat-follow-ups.js`
- `modules/adaptive-learning/chatSuggestions.js`

**Savings:** one removed LLM round-trip per routed message in the chat loop (`chat.js`). Classification is the single most common *unnecessary* inference.

### Lever 2 — Embedding & retrieval result cache

Embeddings are a pure function of text. Cache `content-hash → vector` so stable text is embedded once, never re-embedded.

- `syllabus.js#embed()` — syllabus subtopics re-embedded per ingest/query
- `agents/student/knowledge.js` — knowledge retrieval vectors
- `training/agentPromptBuilder.js` — trained-teacher pgvector chunks

**Savings:** the embedding bill (charged via `openai.embeddings.create` through the gateway) and the retrieval latency drop to near-zero for repeat content.

### Lever 3 — Token-heavy I/O pre-filter (the `analyze_logs.py` pattern)

A script distills a large input into the small relevant slice *before* the model sees it.

- `tasks/lib/context.js#buildContext` — truncate/dedup/snippet-select OCR text; drop empty and near-duplicate files
- `chat.js` / `chat-memory.js` / `chat-history-tools.js` — deterministic dedup + budget-fit before context assembly
- `contextBudget.js` — extend the existing budget discipline to a *deterministic* selector, not a truncation-after-the-fact

**Savings:** input-token reduction on the highest-volume surfaces; the budgeted slice is assembled in code, so only the curated content is metered.

### Lever 4 — Boilerplate generation via scaffold + fill

The structure is a script; only the *content* is the LLM's job. Mirror the `generate_component.sh MyButton` pattern.

- `tasks/tools/worksheet-fill.js`, `lesson-plan-fill.js`, `mcq.js`, `generate-quiz.js`
- `scripts/gen-content-seed.mjs` (existing seed pattern) extended to emit scaffolds

**Savings:** output tokens for the fixed shape disappear; the model writes only the variable body.

### Lever 5 — One-shot document ingestion → compiled artifact

Expensive extraction runs once and becomes a cached, versioned artifact.

- `syllabus.js` PDF ingestion (`gpt-4o` vision + `renderPdfToImages`) — extract once, store the normalized structure + embeddings, never re-extract
- `scripts/ingest-syllabus.mjs` seed pattern — the compile step that produces the artifact

**Savings:** the most expensive per-unit calls (vision + long context) run once per document instead of per query.

## 7. The "compile to script" pipeline

How a repetitive task is promoted from LLM to script, following the same gate as the context-layer migration:

```
LLM CALL SITE  (identified by aiTelemetry spend)
      │
      ▼
[1] MEASURE ── feature, tokens, cost, latency, call volume
      │
      ▼
[2] CAPTURE ── golden snapshot of current input → output (scripts/evals harness)
      │
      ▼
[3] DETERMINE ── is the output a fixed function of the input?
      │
      ├── no  ── keep LLM; revisit only if the cost justifies a smaller model
      │
      └── yes ──────────────────────────────▶ [4] SCRIPT ── write the deterministic equivalent
                                                    │
                                                    ▼
                                             [5] VERIFY ── byte-identical on the eval set
                                                    │
                                                    ▼
                                             [6] REPLACE ── route the call site to the script; delete the LLM path
```

### Stage 1 — Measure

`aiTelemetry` already writes `feature, tokens, cost, latency`. Add a per-surface roll-up so each of the five levers has a baseline number to beat. This is the *only* stage that requires no code change — it is a query over `edu.ai_call_log`.

### Stage 2 — Capture

Use `scripts/capture.mjs` / `scripts/evals/` to record the exact input and output of the candidate call site across a representative eval set.

### Stage 3 — Determine

A task is deterministic if, for every eval-set input, the correct output is identical. Intent classification, embedding, filtering, and scaffolding qualify. Prose tutoring, grading commentary, and synthesis do not — and stay on the LLM.

### Stage 4–6 — Script, verify, replace

Write the script, assert byte-identical output on the eval set (same discipline as `D1` in the context layer), then route the call site through it and delete the LLM path in the same commit.

## 8. Target surfaces (the opportunity map)

| # | Surface | File(s) | Lever | Today | After |
|---|---|---|---|---|---|
| 1 | Intent / routing | `agent-tool-request-intent.js`, `chat-follow-ups.js`, `chatSuggestions.js` | 1 | LLM (or unverified) | rules/regex force, like `agent-chat-intent.js` |
| 2 | Syllabus / knowledge embeddings | `syllabus.js#embed`, `agents/student/knowledge.js`, `training/agentPromptBuilder.js` | 2 | re-embed stable text | `content-hash → vector` cache |
| 3 | Agent task context | `tasks/lib/context.js#buildContext` | 3 | dump full OCR text | deterministic truncate/dedup/select |
| 4 | Chat memory/context | `chat-memory.js`, `chat-history-tools.js`, `contextBudget.js` | 3 | re-assemble per turn | deterministic dedup + budget-fit |
| 5 | Content generators | `tasks/tools/worksheet-fill.js`, `lesson-plan-fill.js`, `mcq.js`, `generate-quiz.js` | 4 | model regenerates scaffold | scaffold script + LLM fill |
| 6 | Syllabus PDF ingestion | `syllabus.js` (vision ingest) | 5 | vision extraction per document | compile-once artifact + cache |

## 9. Build order

Each phase is byte-identical-first (golden snapshot → extract → verify → delete), per `D3`.

| Phase | Deliverable | Notes |
|---|---|---|
| 0 | **Measurement roll-up** | A per-surface token/cost view over `edu.ai_call_log` (feature, model, tokens, cost, p95). No behaviour change; proves *where* the tokens go |
| 1 | **Lever 1 — intent classifiers** | Convert `agent-tool-request-intent.js` + `chat-follow-ups.js` to rules; golden snapshot over the gate scenarios (the `instructor-chat`/`agent-tool-request` gate suites already exist) |
| 2 | **Lever 2 — embedding result cache** | `content-hash → vector` cache for `syllabus.js`, `knowledge.js`, `agentPromptBuilder.js`; assert identical cosine retrieval before/after |
| 3 | **Lever 3 — context pre-filters** | Deterministic truncate/dedup in `tasks/lib/context.js` + chat memory assembly; golden snapshot of assembled context |
| 4 | **Lever 4 — generator scaffolds** | `tasks/tools/*` scaffolds emitted by script; LLM fills only the variable body |
| 5 | **Lever 5 — ingestion artifacts** | Syllabus PDF extraction becomes compile-once; `scripts/ingest-syllabus.mjs` emits the normalized structure + embeddings |

**Phase 0 is the foundation.** Every later phase is justified by the numbers it produces, and each later phase's success is measured against that baseline.

## 10. Validation test suite

| # | Scenario | Assertions |
|---|---|---|
| 1 | Intent classifier | The converted classifier routes every gate-scenario message to the same tool as the LLM (golden), at zero inference |
| 2 | Embedding cache | Identical vector returned for identical text; cache invalidates when text changes; cosine retrieval identical pre/post |
| 3 | Context pre-filter | Assembled agent context is byte-identical to the golden on the eval set, but input tokens are lower |
| 4 | Generator scaffold | The scaffold matches the fixed shape exactly; only the variable content differs from the model output |
| 5 | Ingestion artifact | Re-ingesting an unchanged PDF does not re-run vision; the normalized structure is identical |
| 6 | Metering integrity | A scripted path produces **zero** gateway charges for the removed call, and the gateway remains the only LLM path (D5) |

## 11. Sandbox & benchmarking reuse

The levers are tested by **reusing** the existing sandbox and eval harness, not by building new test infrastructure. Two trust domains, kept deliberately separate:

- **User-authored tool logic** runs in `modules/self-tooling/sandbox/` (`function run(input, data, akoro)`) — that sandbox is *already* the compile-to-code pattern (a deterministic function replaces per-run LLM inference), and it is precedent that this works at scale here.
- **Platform levers** (this plan's scripts) are trusted code in `lib/` / `scripts/`, validated by the eval harness — they must **never** be routed through the user-facing sandbox. Different trust domain, same principle (`D8`).

The eval harness already provides everything a lever's validation needs:

| Harness piece | Where | Role in validating a lever |
|---|---|---|
| Deterministic stand-in model | `scripts/golden-path/mock-openai.mjs` (regex `pickTool`/`contentFor`) | Proves plumbing — routing, arg validation, DB writes, coin charging, failure branches — with **no key and no cost** |
| Stubbed-tool loop | `lib/evals/benchmark.js` (`callTool` seam over the real `chat.js` loop) | Exercises a lever in situ with no side effects |
| Deterministic scoring | `benchmark.js#scoreRun` + `lib/evals/match.js` | Judges output with regex/equality — no second LLM judge doubling the cost |
| Golden fixtures, data not code | `lib/evals/data/{intent,routing,questions,recall,ladder,learner-tools,agent-checks}.json` | The byte-identical snapshots from §7 Stage 2 / §10 |
| Cost estimate | `lib/evals/index.js#estimateUsd` | Prices the LLM path *before* it runs, so the before/after cost delta of a lever is a number, not a claim |

The consequence that makes this a cost lever in its own right: **once a surface becomes a script, its benchmark becomes zero-token.** The LLM intent classifier needs a live key (`routing.json` cases); the script version is just code over the same dataset. `estimateUsd` already exists to *show* that delta.

**What scripts cannot test (and the harness already says so):** `gp-evals.mjs` refuses to run the real eval suite without a live key because against the stand-in model "every case would pass for the wrong reason." A script can regress against goldens for free, but it cannot prove the real model picks the right tool on novel input — that is the `routing.js` suite's job and it still needs the live model. The plan therefore **shrinks** the set of things that need an LLM benchmark; it does not delete them.

## 12. Open design decisions

- **Cache storage & TTL.** Embedding/result caches: Redis (fast, disposable) vs Postgres (source of truth) — the same split the token-economics plan already calls out. Content-hash keys self-invalidate; TTL is a secondary safety.
- **Which surfaces are *truly* deterministic.** Intent classification and embedding are clear; grading commentary and tutoring prose are not. The `Determine` stage (§7 Stage 3) needs an explicit owner call per surface, not a blanket rule.
- **Cache shareability.** Personalized tutoring context differs per student, so result caches must respect what is shareable (syllabus, past questions) vs not (per-learner state) — the same caveat as the token-economics plan §6.
- **Model-size fallback vs script.** For a non-deterministic surface whose cost is high, the cheaper alternative to a script is a *smaller model* (`modelTiers.js` / `modelPicker.js` already exist). Decide per surface which lever applies.
- **Where scripts live.** `scripts/` (one-off/seed) vs `akoro-api/lib/` (runtime pre-filters) vs `akoro-python-agent/` (the Python runtime). Runtime scripts must ship with the deploy, not as a side folder.
