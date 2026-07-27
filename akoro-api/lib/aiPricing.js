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
  "text-embedding-3-small": { in: 0.02, out: 0.0 },
  "text-embedding-3-large": { in: 0.13, out: 0.0 },
};
const DEFAULT_PRICE = MODEL_PRICES["gpt-4o-mini"];

/** Real USD cost of a completion from its token usage. */
export function usdCost(model, tokensIn = 0, tokensOut = 0) {
  const p = MODEL_PRICES[model] || DEFAULT_PRICE;
  return (tokensIn / 1e6) * p.in + (tokensOut / 1e6) * p.out;
}

/** Coins to debit for a completion (real cost × markup, rounded up, min 1). */
export function coinsForUsage(model, tokensIn = 0, tokensOut = 0) {
  const cost = usdCost(model, tokensIn, tokensOut);
  return Math.max(1, Math.ceil((cost * AI_MARKUP) / COIN_USD));
}

/** Coins to debit given an OpenAI `response.usage` object. */
export function coinsForResponseUsage(model, usage = {}) {
  return coinsForUsage(model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
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
