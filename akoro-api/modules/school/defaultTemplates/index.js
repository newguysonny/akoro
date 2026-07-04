/**
 * Default website templates — a shared gallery every school can browse and use.
 * Each JSON file here is a full template: { id, name, description, html
 * (activate-as-is landing), importPayload: { pages, menu } }. They live in code
 * (not per-school in the DB); when a school uses one it's cloned into their own
 * templates so they can customise it without affecting the shared original.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_TEMPLATES = readdirSync(here)
  .filter((f) => f.endsWith(".json"))
  .map((f) => {
    try { return JSON.parse(readFileSync(join(here, f), "utf8")); }
    catch { return null; }
  })
  .filter(Boolean);

export const getDefaultTemplate = (id) => DEFAULT_TEMPLATES.find((t) => t.id === id) || null;
