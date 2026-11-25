#!/usr/bin/env node
/**
 * scripts/export-routes.mjs — write the runtime Express route table as JSON.
 *
 *   node scripts/export-routes.mjs [--out docs/audits/phase-2-route-table.json]
 *
 * The app is imported through scripts/route-runtime.mjs, which sets
 * AKORO_ROUTE_EXPORT=1. Normal server boot is unchanged; this process never
 * opens a port, connects to Redis/Supabase, runs migrations or starts workers.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuntimeRouteTable } from "./route-runtime.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const outPath = path.resolve(REPO_ROOT, arg("--out", "docs/audits/phase-2-route-table.json"));

const { routes } = await loadRuntimeRouteTable();

const table = {
  generatedAt: new Date().toISOString(),
  source: "runtime:app._router.stack",
  guard: "AKORO_ROUTE_EXPORT=1 (app.js skips Redis, migrations, workers, preflight and listen)",
  counts: {
    routes: routes.length,
    paths: new Set(routes.map((route) => route.path)).size,
    methods: [...new Set(routes.map((route) => route.method))].sort(),
  },
  routes,
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(table, null, 2)}\n`);

console.log(`[routes] ${routes.length} method+path rows (${table.counts.paths} paths) → ${path.relative(REPO_ROOT, outPath)}`);
for (const method of table.counts.methods) {
  console.log(`[routes]   ${method}: ${routes.filter((route) => route.method === method).length}`);
}

// Import-time BullMQ/ioredis clients retry in the background; the work is done.
process.exit(0);
