/**
 * pharmd — PHARM.D content upload and the legacy-key hash backfill.
 *
 * Pure re-export entry: importing it must not mount routes or start work.
 */
export { runPharmdHashBackfill } from "./hashBackfill.js";
