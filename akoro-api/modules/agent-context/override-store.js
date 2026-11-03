/**
 * modules/agent-context/override-store.js — the database side of admin-
 * editable prompt parts (Phase 18 item 7): the boot install, and the admin
 * operations (list, read, edit, reset, keep mine, use the new default,
 * history, the assembled prompt). Thin: the rules are in overrides.js.
 */
import db from "../../db.js";
import { SETS } from "./manifest.mjs";
import { CONTEXT_BUDGET, loadDefaultRaw } from "./context-manager.js";
import {
  createOverrideCache, editableParts, hashText, installOverrides, invalidateOverrides, isEditable,
  partStatus, tokensOf, validateOverride,
} from "./overrides.js";

const overrides = () => db.schema("edu").from("agent_prompt_overrides");
const history = () => db.schema("edu").from("agent_prompt_override_history");

export class PromptPartError extends Error {
  constructor(status, message, problems = []) { super(message); this.status = status; this.problems = problems; }
}

/** Boot: model calls read overrides through a 30-second cache from now on. */
export function installPromptOverrides({ env = process.env } = {}) {
  if (String(env.AGENT_PROMPT_OVERRIDES || "").toLowerCase() === "off") return false;
  installOverrides(createOverrideCache({
    fetchRows: async () => {
      const { data, error } = await overrides().select("file, text, base_hash");
      if (error) throw error;
      return data || [];
    },
  }));
  return true;
}

async function storedOverrides() {
  const { data, error } = await overrides().select("file, text, base_hash, base_text, note, updated_by, updated_at");
  if (error) throw new PromptPartError(503, "Prompt overrides are unavailable (migration 2026-agent-prompt-overrides pending?)");
  return new Map((data || []).map((r) => [r.file, r]));
}

async function storedOverride(file) {
  const { data, error } = await overrides().select("file, text, base_hash, base_text, note, updated_by, updated_at").eq("file", file).maybeSingle();
  if (error) throw new PromptPartError(503, "Prompt overrides are unavailable (migration 2026-agent-prompt-overrides pending?)");
  return data || null;
}

const mustBeEditable = (file) => {
  if (!isEditable(file)) throw new PromptPartError(404, "Not a prompt part the agent loads");
};

const record = (row) => history().insert(row).then(({ error }) => {
  if (error) console.warn("[agent-prompts] history not written:", String(error.message || error).slice(0, 160));
});

/** Every part, with what it shows now. */
export async function listParts() {
  const stored = await storedOverrides();
  const out = [];
  for (const part of editableParts()) {
    const def = await loadDefaultRaw(part.file);
    const o = stored.get(part.file) || null;
    out.push({
      file: part.file, sets: part.sets, consumers: [...new Set(part.consumers)],
      status: partStatus({ defaultText: def, override: o }), bytes: (o?.text ?? def).length,
      tokens: tokensOf(def), updated_at: o?.updated_at ?? null,
    });
  }
  return out;
}

/** One part: the default, the override, and — when the default moved — the default it was based on. */
export async function readPart(file) {
  mustBeEditable(file);
  const def = await loadDefaultRaw(file);
  const o = await storedOverride(file);
  const status = partStatus({ defaultText: def, override: o });
  return {
    file, status, sets: editableParts().find((p) => p.file === file)?.sets || [],
    tokens: tokensOf(def), default: { text: def, hash: hashText(def) },
    override: o ? { text: o.text, note: o.note, updated_at: o.updated_at, base_hash: o.base_hash } : null,
    // Both texts for the diff: what the override was based on, and the new default.
    ...(status === "default_updated" ? { based_on: { text: o.base_text, hash: o.base_hash } } : {}),
  };
}

/** A set's size with one part replaced (for the context budget). */
async function setBytesWith(stored) {
  const sizes = new Map();
  for (const p of editableParts()) sizes.set(p.file, (stored.get(p.file)?.text ?? await loadDefaultRaw(p.file)).length);
  return (set, file, bytes) => SETS[set].files.reduce((n, f) => n + (f === file ? bytes : sizes.get(f) || 0), 0);
}

/** Save the admin's text for one part, based on today's default. */
export async function editPart({ file, text, note = null, actorId }) {
  mustBeEditable(file);
  const def = await loadDefaultRaw(file);
  const stored = await storedOverrides();
  const check = validateOverride({ file, text, defaultText: def, setBytes: await setBytesWith(stored), maxContextBytes: CONTEXT_BUDGET.MAX_CONTEXT_BYTES });
  if (!check.ok) throw new PromptPartError(422, check.problems[0], check.problems);
  if (text === def) return resetPart({ file, actorId, note: note || "Saved text equals the default" });
  const now = new Date().toISOString();
  const row = { file, text, base_hash: hashText(def), base_text: def, note: note ? String(note).slice(0, 300) : null, updated_by: actorId || null, updated_at: now };
  const { error } = stored.has(file)
    ? await overrides().update(row).eq("file", file)
    : await overrides().insert({ ...row, created_at: now });
  if (error) throw new PromptPartError(500, "Could not save the prompt part");
  await record({ file, action: "edit", text, base_hash: row.base_hash, note: row.note, actor_id: actorId || null });
  invalidateOverrides();
  return readPart(file);
}

/** Back to the shipped default (the override row goes; its history stays). */
export async function resetPart({ file, actorId, note = null, action = "reset" }) {
  mustBeEditable(file);
  const o = await storedOverride(file);
  if (!o) return readPart(file);
  const { error } = await overrides().delete().eq("file", file);
  if (error) throw new PromptPartError(500, "Could not reset the prompt part");
  await record({ file, action, text: null, base_hash: hashText(await loadDefaultRaw(file)), note: note ? String(note).slice(0, 300) : null, actor_id: actorId || null });
  invalidateOverrides();
  return readPart(file);
}

/** The default changed under an override: keep the admin's text, now based on the new default. */
export async function keepMine({ file, actorId }) {
  const part = await readPart(file);
  if (part.status !== "default_updated") throw new PromptPartError(409, "This part's default has not changed");
  const def = part.default.text;
  const check = validateOverride({ file, text: part.override.text, defaultText: def });
  if (!check.ok) throw new PromptPartError(422, `Your text no longer fits the new default: ${check.problems[0]}`, check.problems);
  const { error } = await overrides().update({ base_hash: hashText(def), base_text: def, updated_by: actorId || null, updated_at: new Date().toISOString() }).eq("file", file);
  if (error) throw new PromptPartError(500, "Could not keep the text");
  await record({ file, action: "keep_mine", text: part.override.text, base_hash: hashText(def), actor_id: actorId || null });
  invalidateOverrides();
  return readPart(file);
}

/** The default changed under an override: take the new default. */
export async function useNewDefault({ file, actorId }) {
  const part = await readPart(file);
  if (part.status !== "default_updated") throw new PromptPartError(409, "This part's default has not changed");
  return resetPart({ file, actorId, action: "use_new_default" });
}

export async function partHistory(file) {
  mustBeEditable(file);
  const { data, error } = await history().select("id, action, text, base_hash, note, actor_id, created_at").eq("file", file).order("created_at", { ascending: false }).limit(50);
  if (error) throw new PromptPartError(503, "Prompt history is unavailable");
  return data || [];
}

/**
 * The full assembled prompt for one set (a persona, a chat role): each file
 * in load order, as the model gets it — `effective` with overrides, or the
 * shipped defaults. {{token}} placeholders stay visible (the code fills them
 * per call); the chat roles' live assembly adds time, memory and grounding.
 */
export async function assembledPrompt({ set, source = "effective" }) {
  const def = SETS[set];
  if (!def) throw new PromptPartError(404, "No such prompt set");
  const stored = source === "effective" ? await storedOverrides() : new Map();
  const files = [];
  for (const file of def.files) {
    const o = stored.get(file);
    const text = o ? o.text : await loadDefaultRaw(file);
    files.push({ file, overridden: !!o, text });
  }
  const text = def.mode === "joined"
    ? files.map((f) => `# ${f.file}\n${f.text.trim()}`).join("\n\n---\n\n")
    : files.map((f) => `<!-- ${f.file}${f.overridden ? " (edited)" : ""} -->\n${f.text.trim()}`).join("\n\n");
  return { set, mode: def.mode, consumer: def.consumer, source, files: files.map(({ file, overridden }) => ({ file, overridden })), text };
}

export const promptSets = () => Object.entries(SETS).map(([name, d]) => ({ set: name, mode: d.mode, consumer: d.consumer, files: [...d.files] }));
