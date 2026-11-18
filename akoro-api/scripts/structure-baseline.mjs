// Regenerates modules/structure-baseline.json after a cleanup.
//
//   cd akoro-api && node scripts/structure-baseline.mjs
//
// Only run this after you have removed violations. The contract test fails on
// stale entries, so adding a file here without fixing the code will not pass.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanStructure } from "./structure-scan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "modules", "structure-baseline.json");

const scan = await scanStructure(root);
const baseline = {
  oversized: scan.oversized,
  crossModuleImports: scan.crossModuleImports,
  cyclicModules: scan.cyclicModules,
  missingReadmes: scan.missingReadmes,
};

await writeFile(out, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`wrote ${path.relative(root, out)}`);
console.log(`  files scanned: ${scan.files}`);
console.log(`  oversized: ${Object.keys(baseline.oversized).length}`);
console.log(`  cross-module internals: ${baseline.crossModuleImports.length}`);
console.log(`  cyclic modules: ${baseline.cyclicModules.length}`);
console.log(`  modules missing README: ${baseline.missingReadmes.length}/${scan.moduleNames.length}`);
