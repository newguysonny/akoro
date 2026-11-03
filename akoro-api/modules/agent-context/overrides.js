/**
 * modules/agent-context/overrides.js — admin-editable prompt parts with
 * "Default updated" (Grand Plan Phase 18 item 7). Side-effect-free: no
 * database import, so the context manager and the golden tests load it
 * without a store.
 *
 * The defaults stay the akoro-agent/ files (D4 single source). An override
 * replaces ONE manifest file's text at load time and records the default it
 * was based on (hash + text). When a deploy changes that default, the part's
 * status reads `default_updated` and the admin keeps their text or takes the
 * new one; until then their text keeps being used (an override survives a
 * deploy).
 *
 * Nothing is overridden until the boot wiring installs a source
 * (installOverrides, from override-store.js). Tests never install one, so
 * the golden tests keep comparing the DEFAULTS. AGENT_PROMPT_OVERRIDES=off
 * turns every override off without a deploy.
 *
 * Only prompt text is editable: code-enforced rules (gates, policies,
 * verdicts, tool checks) are code, not files, and never pass through here.
 */
import { createHash } from "node:crypto";
import { SETS } from "./manifest.mjs";

export const OVERRIDE_TTL_MS = 30_000;
export const MAX_PART_BYTES = 8192;   // = context-manager CONTEXT_BUDGET.MAX_FILE_BYTES
export const STATUSES = Object.freeze(["default", "overridden", "default_updated"]);

/** PURE: a short content hash. */
export const hashText = (text) => createHash("sha256").update(String(text ?? "")).digest("hex").slice(0, 16);

/** PURE: the {{token}} placeholders a template carries, sorted. */
export const tokensOf = (text) => [...new Set([...String(text ?? "").matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].sort();

/** PURE: every editable part — exactly the files the manifest loads — with the sets that load it. */
export function editableParts(sets = SETS) {
  const parts = new Map();
  for (const [name, def] of Object.entries(sets)) {
    for (const file of def.files) {
      if (!parts.has(file)) parts.set(file, { file, sets: [], consumers: [] });
      parts.get(file).sets.push(name);
      parts.get(file).consumers.push(def.consumer);
    }
  }
  return [...parts.values()].sort((a, b) => a.file.localeCompare(b.file));
}

export const isEditable = (file, sets = SETS) => editableParts(sets).some((p) => p.file === file);

/** PURE: what a part is showing now. override: { text, base_hash } | null */
export function partStatus({ defaultText, override }) {
  if (!override) return "default";
  return override.base_hash === hashText(defaultText) ? "overridden" : "default_updated";
}

/**
 * PURE: may this text replace this part? The same placeholders as the
 * default (a missing or extra {{token}} would fail the persona render at run
 * time), within the file budget, and each set that loads it within the
 * context budget (`setBytes(set, file, bytes)` → that set's size with it).
 */
export function validateOverride({ file, text, defaultText, sets = SETS, setBytes = null, maxContextBytes = 24_576 }) {
  const problems = [];
  if (!isEditable(file, sets)) problems.push(`${file} is not a prompt part the manifest loads`);
  const body = typeof text === "string" ? text : "";
  if (!body.trim()) problems.push("the text is empty — use Reset to go back to the default");
  if (Buffer.byteLength(body, "utf8") > MAX_PART_BYTES) problems.push(`the text is over ${MAX_PART_BYTES} bytes`);
  const want = tokensOf(defaultText);
  const got = tokensOf(body);
  const missing = want.filter((t) => !got.includes(t));
  const extra = got.filter((t) => !want.includes(t));
  if (missing.length) problems.push(`keep the placeholders ${missing.map((t) => `{{${t}}}`).join(", ")} — the code fills them`);
  if (extra.length) problems.push(`unknown placeholders ${extra.map((t) => `{{${t}}}`).join(", ")} — nothing fills them`);
  if (setBytes && !problems.length) {
    for (const p of editableParts(sets).filter((x) => x.file === file)) {
      for (const set of p.sets) {
        const n = setBytes(set, file, body.length);
        if (n > maxContextBytes) problems.push(`${set} would be ${n} bytes, over its ${maxContextBytes}-byte budget`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * A short-lived cache over the stored overrides: one read per TTL, a fresh
 * read right after a save (invalidate), and the last good copy kept when a
 * read fails — a model call never waits on, or fails with, the database.
 * fetchRows() → [{ file, text, base_hash }]
 */
export function createOverrideCache({ fetchRows, ttlMs = OVERRIDE_TTL_MS, now = Date.now } = {}) {
  let map = new Map();
  let at = -Infinity;
  let inflight = null;
  const refresh = () => (inflight ||= (async () => {
    try {
      const rows = await fetchRows();
      map = new Map((rows || []).filter((r) => r && typeof r.file === "string" && typeof r.text === "string").map((r) => [r.file, { text: r.text, base_hash: r.base_hash || null }]));
    } catch (e) {
      console.warn("[agent-prompts] overrides not refreshed, keeping the last copy:", String(e?.message || e).slice(0, 160));
    } finally {
      at = now();
      inflight = null;
    }
    return map;
  })());
  return {
    async get() { return now() - at < ttlMs ? map : refresh(); },
    invalidate() { at = -Infinity; },
  };
}

let active = null;

/** Boot wiring: overrides come from this cache from now on. */
export function installOverrides(cache) { active = cache; }
/** Tests: back to defaults only. */
export function uninstallOverrides() { active = null; }
/** After a save: the next load reads the store again. */
export function invalidateOverrides() { active?.invalidate(); }
export const overridesInstalled = () => !!active;

/** The override for one file, or null (none installed, switched off, or none stored). */
export async function overrideFor(file, env = process.env) {
  if (!active || String(env.AGENT_PROMPT_OVERRIDES || "").toLowerCase() === "off") return null;
  try {
    return (await active.get()).get(file) || null;
  } catch {
    return null;
  }
}
