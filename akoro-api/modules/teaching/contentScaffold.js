/**
 * modules/teaching/contentScaffold.js — Lever 4 for the teaching resources
 * (hooks, real-world connections, misconceptions, podcasts, vocabulary, lesson
 * plans, activities, assignments).
 *
 * The model used to type the whole template — every section re-emitting
 * `"kind"`, `"tone"` and `"layout"`, fields the server already knows or can
 * derive. This supplies a CONTENT-ONLY draft contract: the model writes the
 * label + body/items, and `normalizeResult` (template.js) fills the structure it
 * omitted — kind inferred from the fields present, tone derived from the label,
 * layout defaulted. That is pure output-token savings on the most expensive side,
 * with no change to what the teacher sees.
 *
 * Drafts use this; a revision ("make it more playful") still sends the full
 * template so the model can change specific fields predictably.
 */
import { normalizeResult } from "./template.js";

export const COMPACT_TEMPLATE_RULE = `Return ONLY valid JSON — no markdown fences, no commentary:
{"title":string,"summary":string,"highlights":[{"label":string,"value":string}],"entries":[{"title":string,"tag":string,"sections":[SECTION]}]}
Each SECTION is one of:
{"label":string,"body":string}
{"label":string,"items":[string],"ordered":boolean}
{"label":string,"items":[{"label":string,"value":string}]}
Omit "kind", "tone" and "layout" — the server infers the section kind from the fields you provide (items are a list; items of {label,value} are fields; body is a paragraph) and derives the label colour from the label itself. Include a "label" only when the brief names one. "title" is a specific heading for this result, "summary" is one sentence, and "highlights" are 0-4 quick facts. Write **bold** around key terms in paragraphs and items. Keep each paragraph under 70 words. Leave out any section you have nothing real to put in.`;

/** Fill the structure the model omitted (kind/tone/layout) — the code side of the scaffold. */
export function assembleResourceDoc(raw, ctx = {}) {
  return normalizeResult(raw, ctx);
}
