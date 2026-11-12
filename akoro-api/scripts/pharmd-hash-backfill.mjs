// Hash PHARM.D topic PDFs that predate file_hash and move their cached parses
// to the versioned content key. Usage: npm run pharmd:backfill-hash
import { runPharmdHashBackfill } from "../modules/pharmd/hashBackfill.js";

const out = await runPharmdHashBackfill({ onLog: (line) => console.log(line) });
console.log(JSON.stringify(out, null, 2));
process.exit(out.failed.length ? 1 : 0);
