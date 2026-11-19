/**
 * adaptive-learning/strategies/library.js — the Strategy Library, v3 entry.
 *
 * The list itself moved to lib/strategyLibrary.js (Phase 19, S8a) so the
 * context manifest can read GUIDE_FILES without entering this module. This
 * path re-exports it unchanged for the strategy consumers inside
 * adaptive-learning (and the library contract test).
 */
export * from "../../../lib/strategyLibrary.js";
