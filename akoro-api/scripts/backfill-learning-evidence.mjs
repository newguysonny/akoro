/**
 * scripts/backfill-learning-evidence.mjs — the Phase 4a one-off backfill
 * (Grand Plan §7.8.1, D37): teaching sessions' misconception history and
 * exam-prep runs → the learning-evidence recorder, source "backfill".
 *
 *   node scripts/backfill-learning-evidence.mjs --dry-run       # count only
 *   node scripts/backfill-learning-evidence.mjs                  # everything before live recording began
 *   node scripts/backfill-learning-evidence.mjs --learner=<uuid> --limit=200
 *   node scripts/backfill-learning-evidence.mjs --before=none    # include rows updated since
 *
 * Safe to re-run: every event's reference comes from its source row, and the
 * recorder writes each one once (modules/adaptive-learning/learner/learning-backfill.js).
 */
import "dotenv/config";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const flag = (name) => process.argv.includes(`--${name}`);

const { backfillLearningEvidence, LIVE_RECORDING_SINCE } = await import("../modules/adaptive-learning/learner/learning-backfill.js");
const before = arg("before") === "none" ? null : (arg("before") || LIVE_RECORDING_SINCE);
const stats = await backfillLearningEvidence({
  learnerId: arg("learner") || null,
  limit: Number(arg("limit")) || 2000,
  before,
  dryRun: flag("dry-run"),
  teaching: !flag("exam-prep-only"),
  examPrep: !flag("teaching-only"),
});
console.log(JSON.stringify({ before, dryRun: flag("dry-run"), ...stats }, null, 2));
process.exit(0);
