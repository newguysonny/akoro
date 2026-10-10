/**
 * scripts/backfill-record-text.mjs — run the library text backfill now.
 *
 *   npm run records:backfill-text            # everything still missing
 *   npm run records:backfill-text -- --limit=50
 *
 * Same pass as the "record text backfill" startup job (see
 * modules/records/textBackfill.js): free server-readable text only — scans,
 * images and recordings are left to the reader's tap-to-extract offer.
 */
import "dotenv/config";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const limit = Number(arg("limit")) || Infinity;

const { backfillRecordText } = await import("../modules/records/textBackfill.js");
const counts = await backfillRecordText({ limit });
console.log(JSON.stringify(counts, null, 2));
process.exit(0);
