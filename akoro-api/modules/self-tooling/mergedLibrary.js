/**
 * The library merge (pilot, 2026-11-15): ONE tool def for the learner's
 * Library instead of a built-in (`search_my_library`) plus a possible personal
 * domain tool (`library_documents`) duplicating it. The built-in gains the
 * domain's action model:
 *
 *   - BASE actions (count, list, by_kind) are served by the platform from the
 *     my_library view — no learner tool row is needed or created.
 *   - `search` is a PLATFORM action, dispatched to the existing
 *     search_my_library handler (content + name search, reader links). The
 *     domain's name-only search is absorbed — it is a subset.
 *   - A learner's personal library row now contributes only its DELTA actions
 *     (anything beyond the merged set, e.g. by_size, sum_size), which keep
 *     running through runLearnerTool with their toggles intact.
 *
 * Kill switch: AKORO_MERGED_LIBRARY=false restores the legacy two-def world.
 * Pure module (no imports) so chat.js and pipeline.js can both use it.
 */

export const LIBRARY_BASE_ACTIONS = ["count", "list", "by_kind"];
export const LIBRARY_PLATFORM_ACTIONS = ["search"];
export const LIBRARY_MERGED_ACTIONS = [...LIBRARY_BASE_ACTIONS, ...LIBRARY_PLATFORM_ACTIONS];

export function mergedLibraryEnabled() {
  return String(process.env.AKORO_MERGED_LIBRARY ?? "true").toLowerCase() !== "false";
}

export function isLibraryBaseAction(action) {
  return LIBRARY_BASE_ACTIONS.includes(action);
}

/** A create_tool build over the library whose whole action set is already in
 *  the merged set builds nothing new — it is covered by the built-in. */
export function libraryBuildIsCovered(actions) {
  return Array.isArray(actions) && actions.length > 0
    && actions.every((a) => LIBRARY_MERGED_ACTIONS.includes(a));
}

/** The visible DELTA actions a learner's library row contributes: its stored
 *  actions minus the merged set, minus the ones the learner switched off. */
export function libraryDeltaActions(row) {
  if (!row) return [];
  const acts = Array.isArray(row.actions) && row.actions.length
    ? row.actions : (row.params_schema?.action?.enum || []);
  const off = new Set(Array.isArray(row.disabledActions) ? row.disabledActions
    : (Array.isArray(row.disabled_actions) ? row.disabled_actions : []));
  return acts.filter((a) => !LIBRARY_MERGED_ACTIONS.includes(a) && !off.has(a));
}

/**
 * The merged def, in the OpenAI tools shape the chat runtime uses.
 * `delta` — the learner's visible extra actions; `disabled` — merged-set
 * actions the learner switched off on their row (kept out of the enum so the
 * def never offers what dispatch would refuse).
 */
export function mergedLibraryDef({ delta = [], disabled = [] } = {}) {
  const off = new Set(disabled);
  const actions = [...LIBRARY_MERGED_ACTIONS, ...delta].filter((a) => !off.has(a));
  return {
    type: "function",
    function: {
      name: "library_documents",
      description: "The signed-in learner's Library — their uploads, links and pasted notes — one tool for everything about their documents. "
        + "action=count: how many documents they have. action=list: their documents with kind, size and when added. action=by_kind: how many documents per kind. "
        + "action=search: find documents by name or by what is inside them; the reply shows each as a link that opens it in the reader — pass `tool` to open a found document on the reader's quiz, flashcards, summary, notes or podcast. "
        + "count, list and by_kind read the Library records; search looks inside the documents themselves. "
        + "The learner's taught study notes (topics they taught their agent, with confidence scores) are NOT Library documents — those live in my_study_notes; never answer a study-notes question from this tool. "
        + (delta.length ? `This learner also added their own action(s) to this tool: ${delta.join(", ")}. ` : "")
        + "Search again every time (the Library changes; an earlier answer in this chat may be out of date). Never invent a document — mention only what this returns, by name; never show record ids.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: actions, description: "count | list | by_kind read the Library records; search searches inside the documents" },
          query: { type: "string", description: "For action=search: the topic or document to look for (3-200 characters)." },
          tool: { type: "string", enum: ["quiz", "flashcards", "summary", "notes", "podcast"], description: "For action=search only: open the found document on this reader tool." },
          limit: { type: "integer", description: "For action=list: max rows (default 100)." },
        },
        required: ["action"],
      },
    },
  };
}
