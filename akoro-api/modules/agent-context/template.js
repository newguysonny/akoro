/**
 * modules/agent-context/template.js — the persona-template engine (Context
 * Layer Adoption P2). Persona prompts live in akoro-agent/agents/<persona>/
 * as verbatim templates with {{token}} placeholders where the original code
 * interpolated dynamic truth. fillTemplate performs the substitution with
 * template-literal semantics and FAILS LOUD on a missing value or a leftover
 * token — a half-filled persona prompt must never reach a model.
 *
 * Side-effect-free (imports only the context manager) so tests load it
 * directly, like chat-doctrine.js.
 */

import { loadRaw } from "./context-manager.js";

/**
 * Fill a {{token}} template. Every token must have a value; every value must
 * be consumed. Mirrors template-literal stringification (String(value)).
 */
export function fillTemplate(template, values, source = "template") {
  const used = new Set();
  const filled = template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`${source}: no value for {{${key}}}`);
    }
    used.add(key);
    return String(values[key]);
  });
  if (/\{\{\w+\}\}/.test(filled)) {
    throw new Error(`${source}: unfilled placeholder remains`);
  }
  const extras = Object.keys(values).filter((key) => !used.has(key));
  if (extras.length) {
    throw new Error(`${source}: unused values ${extras.join(", ")} — the template and the caller disagree`);
  }
  return filled;
}

/** Load one persona template from the workspace and fill it. */
export async function renderPersona(file, values) {
  return fillTemplate(await loadRaw(file), values, file);
}
