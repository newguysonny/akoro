/**
 * modules/self-tooling/viewRegistry.js — the runtime loader for the
 * data-driven Data View registry (2026-11-18).
 *
 * Built-in views live in views.js (code). ACTIVE rows in edu.self_tool_views
 * are merged into the live registry at boot and re-read every 60s, so an
 * admin approving a stored spec makes the new view buildable with no code
 * deploy — and disabling the row removes it again. Rows were validated
 * against the live schema when written/approved (viewSpecs.js); the loader
 * additionally re-checks the pure shape before merging, and ANY failure
 * (table missing before the migration lands, database unreachable, a bad
 * row) leaves the current registry untouched — the built-ins always work.
 *
 * Kill switch: AKORO_DB_VIEWS=false → the registry stays exactly the
 * built-ins, as before this module existed.
 */
import db from "../../db.js";
import { applyDbViewRows } from "./views.js";
import { validateViewShape, normalizeViewSpec } from "./viewSpecs.js";

const edu = () => db.schema("edu");
const REFRESH_MS = 60 * 1000;
const enabled = () => process.env.AKORO_DB_VIEWS !== "false";

let timer = null;
let lastSummary = null;

/**
 * Re-read the active stored views and merge them into the live registry.
 * Never throws. Returns { applied, skipped } or null when disabled/failed.
 */
export async function refreshDbViews() {
  if (!enabled()) return null;
  try {
    const { data, error } = await edu().from("self_tool_views").select("name, spec").eq("status", "active");
    if (error) throw new Error(error.message);
    const rows = [];
    const skipped = [];
    for (const row of data || []) {
      const shape = validateViewShape(row.name, row.spec);
      if (!shape.ok) { skipped.push({ name: row.name, why: shape.errors[0] }); continue; }
      rows.push({ name: row.name, spec: normalizeViewSpec(row.spec) });
    }
    const merged = applyDbViewRows(rows);
    lastSummary = { at: new Date().toISOString(), applied: merged.applied, skipped: [...skipped, ...merged.skipped] };
    if (merged.applied.length || merged.skipped.length || skipped.length) {
      console.log(`[view-registry] active: ${merged.applied.join(", ") || "none"}${lastSummary.skipped.length ? `; skipped: ${lastSummary.skipped.map((x) => `${x.name} (${x.why})`).join("; ")}` : ""}`);
    }
    return lastSummary;
  } catch (e) {
    console.warn(`[view-registry] refresh failed, keeping current registry: ${e.message}`);
    return null;
  }
}

/** Boot the loader: one refresh now, then every 60s. Safe to call once. */
export function startViewRegistry() {
  if (!enabled() || timer) return;
  refreshDbViews().catch(() => {});
  timer = setInterval(() => { refreshDbViews().catch(() => {}); }, REFRESH_MS);
  timer.unref?.();
}

/** The last refresh outcome (for the admin views endpoint). */
export const viewRegistryStatus = () => ({ enabled: enabled(), last: lastSummary });
