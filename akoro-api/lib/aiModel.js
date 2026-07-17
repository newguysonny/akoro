/**
 * lib/aiModel.js
 * Single source of truth for the Anthropic model id used across the task
 * tools, battle, instructor and chat agent loops.
 *
 * Previously every call site hardcoded an unrecognised model id, so every
 * Anthropic call risked a 400 and there was no one place to correct it. Set
 * ANTHROPIC_MODEL to pin whatever your account is entitled to; the default
 * tracks the current Sonnet tier.
 */
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
