/**
 * modules/self-tooling/uiCatalogue.js — the declarative UI catalogue
 * (Plugin Runtime, 2026-11-27). A built tool may carry a `presentation`:
 * a tree of catalogue components the learner app renders in the tool's tab
 * (SpecView) and, as a live preview, on its build card. No generated code
 * ever reaches the client — components are fixed, bindings are data paths.
 *
 * A binding is a string starting with "$": "$state.topic", "$rows",
 * "$tool.label", "$params.subject". Bindings may only reference roots the
 * caller declares (state keys for a mode tool, row fields for a data tool),
 * so a presentation can never point at data the tool doesn't have.
 *
 * This file is the single source of truth for the catalogue: the builder
 * prompt's UI section is generated from it (builder.js), akoro_inspect's
 * `ui` provider serves it, and the client renderer implements exactly
 * these types. Pure — no imports.
 */

export const UI_SLOTS = Object.freeze(["tool.tab"]);

/** Component catalogue: props are the full contract for each type. */
export const UI_COMPONENTS = Object.freeze({
  hero: {
    does: "Gradient header card for the tool's tab: a title, a subtitle line, an optional icon name.",
    props: { title: "string (binding or literal)", sub: "string (binding or literal)", icon: "optional icon name (book, cap, chart, target, clock, star)" },
  },
  statRow: {
    does: "A row of up to 4 stat tiles: a big value over a small label.",
    props: { stats: "[{ value, label }] — value may be a binding like \"$state.coverageDone\" or a literal" },
  },
  stepper: {
    does: "Phase steps (Learn → Recall → Review). Either fixed steps with a state each, or bound to a state field with a map from phase value to the current step index.",
    props: { steps: "[{ label, state: done|now|next }]", bind: "optional binding to a phase field, e.g. \"$state.phase\"", map: "optional { phaseValue: stepIndex }" },
  },
  list: {
    does: "A titled list of rows. Each row: a title, an optional sub line, and a state shown as an icon — done (ticked), partial, todo, or hidden (masked: the row's title is NOT shown, only the hidden label).",
    props: { title: "optional section title", items: "binding to an array, e.g. \"$state.coverage\" or \"$rows\"", item: "{ title: field name or binding, sub: field name or binding, stateField: field holding done|partial|todo|hidden }", hiddenLabel: "optional text for masked rows" },
  },
  cardGrid: {
    does: "A grid of small cards from an array.",
    props: { items: "binding to an array", item: "{ title: field name, sub: field name }" },
  },
  table: {
    does: "A simple table over rows.",
    props: { rows: "binding to an array (\"$rows\" for a data tool)", columns: "[{ field, label }]" },
  },
  detail: {
    does: "Label/value rows.",
    props: { fields: "[{ label, value }] — value may be a binding or literal" },
  },
  markdown: {
    does: "A paragraph of plain text (no HTML).",
    props: { text: "string (binding or literal)" },
  },
  image: {
    does: "An image from an https URL.",
    props: { src: "https URL or binding", alt: "optional" },
  },
  chart: {
    does: "Simple bars over rows: one bar per row, height from a numeric field.",
    props: { kind: "\"bar\"", rows: "binding to an array", x: "field for the bar label", y: "numeric field for the bar value" },
  },
  cta: {
    does: "A primary button. Tapping it sends `message` into the chat as the learner — the session continues through the agent, never a direct call.",
    props: { label: "button text", message: "the message sent into the chat" },
  },
});

const COMPONENT_NAMES = new Set(Object.keys(UI_COMPONENTS));
const MAX_COMPONENTS = 14;
const MAX_DEPTH = 3;

/** Roots a binding may start from. */
const ROOTS = ["state", "rows", "tool", "params"];

const isBinding = (v) => typeof v === "string" && v.startsWith("$");

/** "$state.coverage.0.title" → ["state", "coverage", "0", "title"]; null when not a binding. */
export function bindingPath(v) {
  if (!isBinding(v)) return null;
  const parts = v.slice(1).split(".").filter((p) => p.length);
  return parts.length ? parts : null;
}

/**
 * Validate a presentation against what the tool actually has.
 * ctx: { stateKeys?: [names], rowFields?: [names] } — bindings into
 * $state must name a declared state key; bindings into $rows fields must
 * name a known row field (checked loosely: only the first field segment).
 * → { ok, errors: [] }
 */
export function validatePresentation(presentation, ctx = {}) {
  const errors = [];
  if (!presentation || typeof presentation !== "object" || Array.isArray(presentation)) return { ok: false, errors: ["presentation must be an object"] };
  if (presentation.v !== 1) errors.push("presentation.v must be 1");
  if (presentation.slot !== undefined && !UI_SLOTS.includes(presentation.slot)) errors.push(`presentation.slot must be one of ${UI_SLOTS.join(", ")}`);
  if (!Array.isArray(presentation.body) || !presentation.body.length) errors.push("presentation.body must be a non-empty list of components");
  if (Array.isArray(presentation.body) && presentation.body.length > MAX_COMPONENTS) errors.push(`presentation.body has more than ${MAX_COMPONENTS} components`);
  const stateKeys = ctx.stateKeys ? new Set(ctx.stateKeys) : null;
  const rowFields = ctx.rowFields ? new Set(ctx.rowFields) : null;

  const checkBinding = (v, where) => {
    const parts = bindingPath(v);
    if (!parts) return;
    const [root, key] = parts;
    if (!ROOTS.includes(root)) { errors.push(`${where}: binding "${v}" must start with $state, $rows, $tool or $params`); return; }
    if (root === "state" && stateKeys && key && !stateKeys.has(key)) errors.push(`${where}: binding "${v}" — the tool's state has no "${key}"`);
    if (root === "rows" && rowFields && parts[1] && !rowFields.has(parts[1])) errors.push(`${where}: binding "${v}" — the tool's rows have no field "${parts[1]}"`);
  };
  const checkString = (v, where) => { if (typeof v === "string") checkBinding(v, where); };

  const walk = (node, where, depth) => {
    if (depth > MAX_DEPTH) { errors.push(`${where}: nested too deep`); return; }
    if (!node || typeof node !== "object" || Array.isArray(node)) { errors.push(`${where}: a component must be an object`); return; }
    if (!COMPONENT_NAMES.has(node.type)) { errors.push(`${where}: unknown component "${node.type}" — use only: ${[...COMPONENT_NAMES].join(", ")}`); return; }
    // Every string anywhere in the component may be a binding; check them all.
    const scan = (val, at) => {
      if (typeof val === "string") checkBinding(val, at);
      else if (Array.isArray(val)) val.forEach((x, i) => scan(x, `${at}[${i}]`));
      else if (val && typeof val === "object") for (const [k, x] of Object.entries(val)) if (k !== "type") scan(x, `${at}.${k}`);
    };
    scan(node, where);
    if (node.type === "image" && typeof node.src === "string" && !isBinding(node.src) && !/^https:\/\//.test(node.src)) {
      errors.push(`${where}: image src must be an https URL`);
    }
    if (node.type === "cta" && (typeof node.label !== "string" || typeof node.message !== "string")) {
      errors.push(`${where}: a cta needs a label and the message it sends`);
    }
    checkString(node.title, `${where}.title`);
  };
  (presentation.body || []).forEach((c, i) => walk(c, `body[${i}]`, 1));
  return { ok: errors.length === 0, errors };
}

/** Resolve a binding against { state, rows, tool, params }; literals pass through. */
export function resolveBinding(v, data = {}) {
  const parts = bindingPath(v);
  if (!parts) return v;
  let cur = data[parts[0]];
  for (const p of parts.slice(1)) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** The catalogue as akoro_inspect and the builder prompt present it. */
export function describeCatalogue() {
  return {
    slots: [...UI_SLOTS],
    bindings: "A string starting with $ reads from the tool's data: $state.<field> (a mode tool's state), $rows (a data tool's result rows), $tool.label / $tool.goal, $params.<name>. In a list's item map, title/sub name FIELDS of each item (not $ paths).",
    components: Object.entries(UI_COMPONENTS).map(([type, c]) => ({ type, does: c.does, props: c.props })),
  };
}
