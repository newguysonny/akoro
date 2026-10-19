/**
 * lib/aiPricing.js
 * ─────────────────────────────────────────────────────────────
 * Coin economics + model pricing, in ONE place so you tune it with a few knobs.
 *
 *   1 coin        = COIN_USD dollars of value (default $0.001 = a tenth of a cent)
 *   AI debit      = ceil( realTokenCost($) × AI_MARKUP / COIN_USD ), min 1 coin
 *   Top-up price  = coins × COIN_USD × USD_NGN  (charged in ₦ via Paystack)
 *
 * Raise AI_MARKUP for more margin on usage; raise the sell price by widening the
 * gap between what you charge for coins and COIN_USD.
 */

const num = (v, d) => (v != null && !Number.isNaN(Number(v)) ? Number(v) : d);

export const COIN_USD  = num(process.env.COIN_USD, 0.001);   // $ value of 1 coin
export const AI_MARKUP = num(process.env.AI_COIN_MARKUP, 2.0);
export const USD_NGN   = num(process.env.USD_NGN_RATE, 1600); // for ₦ top-up pricing
export const WELCOME_GRANT = Math.max(0, Math.round(num(process.env.COIN_WELCOME_GRANT, 200)));

// Per-model price in USD per 1M tokens { in, out }. Extend as models are added.
// Falls back to gpt-4o-mini pricing for unknown models (cheap-tier default).
const MODEL_PRICES = {
  "gpt-4o-mini":       { in: 0.15, out: 0.60 },
  "gpt-4.1-mini":      { in: 0.40, out: 1.60 },
  "gpt-4o":            { in: 2.50, out: 10.00 },
  "gpt-4.1":           { in: 2.00, out: 8.00 },
  // Reasoning models (Think mode). Reasoning tokens are billed as output.
  "o4-mini":           { in: 1.10, out: 4.40 },
  "o3-mini":           { in: 1.10, out: 4.40 },
  "o3":                { in: 2.00, out: 8.00 },
  "text-embedding-3-small": { in: 0.02, out: 0.0 },
  "text-embedding-3-large": { in: 0.13, out: 0.0 },
};
const DEFAULT_PRICE = MODEL_PRICES["gpt-4o-mini"];

/** The built-in price table — the model registry's default catalogue (lib/modelRegistry.js). */
export const DEFAULT_MODEL_PRICES = Object.freeze(Object.fromEntries(Object.entries(MODEL_PRICES).map(([k, v]) => [k, Object.freeze({ ...v })])));

/**
 * Add a catalogue model's price (lib/modelRegistry.js, from AI_MODELS), under
 * every name a call may be billed as (its id and its API model). A model the
 * registry knows is never billed at the gpt-4o-mini fallback.
 */
export function registerModelPrice(names, price) {
  for (const name of [].concat(names).filter(Boolean)) MODEL_PRICES[name] = { in: price.in, out: price.out, ...(price.cachedIn != null ? { cachedIn: price.cachedIn } : {}) };
}
export const hasModelPrice = (name) => Object.prototype.hasOwnProperty.call(MODEL_PRICES, name);

// OpenAI bills cached prompt-prefix tokens at ~50% of the input rate (automatic
// prompt caching kicks in for stable ≥1024-token prefixes — e.g. the tutor's
// fixed system prompt). We price cached input at CACHED_INPUT_FACTOR so the
// savings flow through to what the wallet is charged.
const CACHED_INPUT_FACTOR = num(process.env.AI_CACHED_INPUT_FACTOR, 0.5);
// Optional safety ceiling: max_tokens applied when a caller omits it (0 = off).
export const AI_DEFAULT_MAX_TOKENS = Math.max(0, Math.round(num(process.env.AI_DEFAULT_MAX_TOKENS, 0)));

/** Real USD cost of a completion; cachedIn tokens billed at the cached rate. */
export function usdCost(model, tokensIn = 0, tokensOut = 0, cachedIn = 0) {
  const p = MODEL_PRICES[model] || DEFAULT_PRICE;
  const freshIn = Math.max(0, tokensIn - cachedIn);
  // A catalogue price may carry its own cached-input rate (e.g. Claude cache reads).
  const cachedRate = p.cachedIn != null ? p.cachedIn : p.in * CACHED_INPUT_FACTOR;
  return (freshIn / 1e6) * p.in + (cachedIn / 1e6) * cachedRate + (tokensOut / 1e6) * p.out;
}

/** Coins to debit for a completion (real cost × markup, rounded up, min 1). */
export function coinsForUsage(model, tokensIn = 0, tokensOut = 0, cachedIn = 0) {
  const cost = usdCost(model, tokensIn, tokensOut, cachedIn);
  return Math.max(1, Math.ceil((cost * AI_MARKUP) / COIN_USD));
}

/** Coins to debit given an OpenAI `response.usage` object (cache-aware). */
export function coinsForResponseUsage(model, usage = {}) {
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return coinsForUsage(model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, cached);
}
/** Cached-token count from a usage object (for the ledger cost calc). */
export function cachedTokensOf(usage = {}) {
  return usage.prompt_tokens_details?.cached_tokens ?? 0;
}

// ── Audio (voice) pricing ─────────────────────────────────────────────────────
// STT priced per minute of audio; TTS priced per character of input.
const STT_USD_PER_MIN = { "whisper-1": 0.006, "deepgram": 0.0043 };
const TTS_USD_PER_1K_CHARS = { "tts-1": 0.015, "tts-1-hd": 0.030, "deepgram-aura-2": 0.030 };   // $15 / 1M chars (Aura-2: $30 / 1M — re-check Deepgram's price list)
const AUDIO_BYTES_PER_SEC = num(process.env.AUDIO_BYTES_PER_SEC, 3000); // est. for compressed voice

/** Estimate audio minutes from a buffer size when duration is unknown (Whisper). */
export function estimateAudioMinutes(bytes) {
  return Math.max(0.05, (Number(bytes || 0) / AUDIO_BYTES_PER_SEC) / 60);
}
/** Coins to debit for speech-to-text of `minutes` on `model`. */
export function coinsForSttMinutes(model, minutes) {
  const rate = STT_USD_PER_MIN[model] ?? STT_USD_PER_MIN["whisper-1"];
  return Math.max(1, Math.ceil((minutes * rate * AI_MARKUP) / COIN_USD));
}
/** Coins to debit for text-to-speech of `chars` on `model`. */
export function coinsForTtsChars(model, chars) {
  const rate = TTS_USD_PER_1K_CHARS[model] ?? TTS_USD_PER_1K_CHARS["tts-1"];
  const cost = (Number(chars || 0) / 1000) * rate;
  return Math.max(1, Math.ceil((cost * AI_MARKUP) / COIN_USD));
}

/** ₦ (kobo) to charge for buying `coins`. Paystack works in kobo. */
export function coinsToKobo(coins) {
  return Math.round(coins * COIN_USD * USD_NGN * 100);
}
/** How many coins a given ₦ (naira) top-up buys. */
export function nairaToCoins(naira) {
  return Math.floor(naira / (COIN_USD * USD_NGN));
}
/** Human display: coins → approx money. */
export function coinsToUsd(coins) { return coins * COIN_USD; }
