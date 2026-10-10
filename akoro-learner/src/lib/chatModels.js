/**
 * chatModels — the Agent Chat's model switch.
 *
 * The API names the model behind each chat mode (GET /api/adaptive/chat/models
 * → [{ id: 'default'|'think'|'research', model, kind, description }]); the
 * switch shows those names. Choosing one still sends only the MODE — the
 * server routes it, so a browser can never ask for an arbitrary model.
 */

/** "gpt-4o-mini" → "GPT-4o mini", "o4-mini" → "o4-mini", "gpt-4.1" → "GPT-4.1". */
export function modelDisplayName(id) {
  const m = String(id || '').trim();
  if (!m) return '';
  const gpt = /^gpt-([\w.]+?)(?:-(mini|nano|turbo))?$/i.exec(m);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].toLowerCase()}` : ''}`;
  return m;
}

const FALLBACK = [
  { id: 'default',  model: 'gpt-4o-mini', kind: 'Fast',     description: 'Quick, grounded answers for everyday study.' },
  { id: 'think',    model: 'o4-mini',     kind: 'Thinking', description: 'Reasons step by step before answering — best for hard problems.' },
  { id: 'research', model: 'gpt-4o',      kind: 'Research', description: 'A deeper pass with more syllabus and past-question references.' },
];

/** Server modes (or the defaults while they load) → the switch's options. */
export function chatModelOptions(serverModes) {
  const modes = Array.isArray(serverModes) && serverModes.length ? serverModes : FALLBACK;
  return modes
    .filter((m) => ['default', 'think', 'research'].includes(m?.id))
    .map((m) => ({ id: m.id, label: modelDisplayName(m.model) || m.kind || m.id, meta: m.kind || '', description: m.description || '' }));
}
