# Akoro LLM Cost Model & Coin Economics

> How AI usage is priced, metered, and charged to wallets. Read this before
> changing prices, adding an AI feature, or answering a billing/pricing question.
> Source of truth in code: `akoro-api/lib/aiPricing.js` (numbers) and
> `akoro-api/lib/coins.js` (ledger).

---

## 1. The coin

- **1 coin = `COIN_USD` of value** — default **$0.001** (a tenth of a cent).
- Balances are **integer coins**, held per **account** (`coin_accounts`): one per
  user, one per school. Every movement is an append-only row in
  `coin_transactions`.
- **Who pays depends on the portal.**
  - **School portal** (`X-Akoro-Portal: school`, or a socket with
    `auth.portal:'school'`) — usage is **funded by the school account** directly
    (`billTo`). So a student using the **school website** (incl. the proctored
    assessment: questions, grading, TTS and answer transcription) is paid for by
    the **school**, not the student.
  - **Student portal** (learner app) — **hybrid**: the student's **own** wallet
    first, then their school's for any remainder. Schools can also allocate coins
    to students; standalone learners fund themselves.
- The billing target is set once per request (`authenticateToken`) / per socket
  (`io.use`) as an `AsyncLocalStorage` `billTo`, so every AI call in that
  request/connection is charged to the right account automatically.
- **Zero balance = hard block.** AI calls refuse before spending (HTTP `402` /
  socket `INSUFFICIENT_COINS`) and the UI prompts a top-up. No overdraft.

## 2. How a charge is computed

For token-based (chat) calls:

```
realCost($) = tokensIn/1e6 × model.in  +  tokensOut/1e6 × model.out
coins       = ceil( realCost × AI_MARKUP / COIN_USD ),  min 1
```

- **`AI_MARKUP`** (default **2.0**) is where the margin lives — the wallet is
  debited at ~2× underlying cost. Raise it for more margin per call.
- Model prices (USD per 1M tokens) — `MODEL_PRICES` in `aiPricing.js`:

  | Model | in | out |
  |---|---|---|
  | gpt-4o-mini | $0.15 | $0.60 |
  | gpt-4.1-mini | $0.40 | $1.60 |
  | gpt-4o | $2.50 | $10.00 |
  | gpt-4.1 | $2.00 | $8.00 |
  | text-embedding-3-small | $0.02 | — |

  Unknown models fall back to gpt-4o-mini pricing. **Verify these against live
  OpenAI pricing before a real pricing decision** — they're point-in-time.

### Voice (audio) pricing

- **STT** priced **per minute**: `whisper-1` $0.006/min, `deepgram` $0.0043/min.
  Real duration is used when the provider returns it (Deepgram); otherwise it's
  estimated from the audio buffer via `AUDIO_BYTES_PER_SEC` (default 3000 B/s).
- **TTS** priced **per character** of input: `tts-1` $15 / 1M chars
  (`$0.015`/1k), `tts-1-hd` $30 / 1M.
- Same `AI_MARKUP` and `ceil(min 1)` applied.

## 3. Selling coins (top-up)

- Top-ups go through **Paystack in ₦**. Price of 1 coin in ₦:
  `COIN_USD × USD_NGN × 100` kobo (default `0.001 × 1600 = ₦1.6`).
- Credited **idempotently** by Paystack reference (`coin_topup`, unique-ref) via
  the unified webhook — replays never double-credit.
- New accounts get a **welcome grant** (`COIN_WELCOME_GRANT`, default 200 coins).

> Margin note: margin is applied on the **debit** side (`AI_MARKUP`). Coins are
> sold at face value (`COIN_USD`). If you'd rather price margin into the sale,
> keep `AI_MARKUP = 1` and raise the ₦ sell price instead — don't double-apply.

## 4. What is metered (coverage)

Metering is centralised so new call sites are covered automatically:

- **All chat completions + embeddings** — `openai.chat.completions.create` and
  `openai.embeddings.create` go through a metered proxy (`lib/aiModel.js`). The
  acting user comes from an `AsyncLocalStorage` context set in
  `authenticateToken`, so any AI call during an authenticated request bills that
  user. **All modules use this one client** (the adaptive-learning agents that
  previously made their own `new OpenAI()` were rerouted) — covers the student
  tutor, concierge, generators, instructor tools, battles, RAG, etc.
  - **Blocking calls** → exact tokens from `response.usage`.
  - **Streaming calls** → `stream_options.include_usage` + a teeing wrapper
    charge **exact** tokens on completion (estimate only on early abort).
  - **Cached prompt tokens** (automatic OpenAI prompt caching) are billed at
    `AI_CACHED_INPUT_FACTOR` (default 0.5×) — the tutor's stable system prompt
    gets the discount automatically.
- **Agent tasks** (background worker) — pre-checks balance, then bills each
  agent-loop iteration to the task owner via explicit `__userId`.
- **Voice** — STT and TTS metered explicitly (own client + audio API), per
  §2, with hard-block on empty balance.

**Not billed (by design):** system/cron calls with no acting user (e.g. the
decay-engine), and any provider whose usage we can't attribute to a user.

**Soft-overspend edge:** charges fire after the call returns, and the pre-check
only requires ≥1 coin. A near-empty wallet can therefore complete **one** call
that costs more than its balance before the next call is blocked — a few coins
of slippage. A true hard cap needs a pre-authorization hold; accepted for MVP.

**Admin tooling:** `GET /api/wallet/admin/overview` (platform totals, 7-day
top-up/spend, spend-by-feature) and `POST /api/wallet/admin/grant` (grant with
positive coins, adjust/deduct with negative) — admin role only, surfaced on the
admin Wallet page. Low-balance is flagged in `GET /api/wallet` (`low`,
`lowBalanceThreshold`) and shown as a red header chip in the learner app.

## 5. Tunable knobs (env)

| Env | Default | Effect |
|---|---|---|
| `COIN_USD` | 0.001 | $ value of 1 coin (top-up price + charge divisor) |
| `AI_COIN_MARKUP` | 2.0 | Margin multiplier on every AI debit |
| `USD_NGN_RATE` | 1600 | ₦ per $ for top-up pricing |
| `COIN_WELCOME_GRANT` | 200 | Free coins on first account creation |
| `AUDIO_BYTES_PER_SEC` | 3000 | STT minute estimate when duration is unknown |
| `AI_CACHED_INPUT_FACTOR` | 0.5 | Price of cached prompt tokens vs. fresh input |
| `AI_DEFAULT_MAX_TOKENS` | 0 (off) | Output ceiling applied when a caller omits max_tokens |
| `COIN_LOW_BALANCE` | 100 | Coins below which the wallet flags `low` |
| `OPENAI_MODEL` | gpt-4o-mini | Default model for the agent loops |

## 6. Rough economics (illustrative)

Charged coins ≈ `ceil(realCost × 2 / $0.001)`, so **1 coin ≈ $0.0005 of real
cost** after markup. Example charges:

| Action | Model | ~coins |
|---|---|---|
| Tutor message (3k in / 500 out) | gpt-4o-mini | ~2–4 |
| Quiz generation (2k / 1.5k) | gpt-4.1-mini | ~7 |
| Assessment (≈15k / 6k across calls) | gpt-4.1-mini | ~70 |
| 1 min voice STT | whisper-1 | ~24 |
| ~500-char TTS reply | tts-1 | ~15 |

At default pricing a **$10 top-up ≈ 16,000 coins** (`$10 / (COIN_USD × … )`
— i.e. ₦-priced, ~₦16,000). For the **1,000-student / 100-teacher** day modelled
earlier (~$40–70 text, +voice), users collectively spend on the order of
**80k–300k coins/day**; the 2× markup is your gross margin over the underlying
OpenAI/Deepgram spend. Re-derive with live prices before committing to a price
sheet — see `docs/` cost estimate for the usage assumptions.

## 7. Where to look in code

- Prices & coin math — `akoro-api/lib/aiPricing.js`
- Wallet ops / atomic ledger — `akoro-api/lib/coins.js`, migration
  `2026-coin-wallet.sql`
- Metering chokepoint — `akoro-api/lib/aiModel.js` (+ `lib/aiContext.js`)
- Voice metering — `akoro-api/modules/voice/routes.js`, `streaming.js`
- Wallet API — `akoro-api/modules/wallet/routes.js` (`/api/wallet`)
- Top-up fulfillment — `fulfillCoinTopup` in the Paystack webhook dispatcher
