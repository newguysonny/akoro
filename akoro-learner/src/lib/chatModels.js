/**
 * chatModels — the Agent Chat's model switch.
 *
 * GET /api/adaptive/chat/models answers with
 *   modes:  [{ id: 'default'|'think'|'research', model, kind, description }]
 *   models: [{ id, label, provider, description, default, available, note }]
 * — the plan's model catalogue (Grand Plan §7.11), each model marked
 * available only when this server is set up for it; the rest read
 * "Coming soon". The menu lists the models, then the Thinking / Research
 * modes. Picking a model sends its catalogue id with the standard mode;
 * the server maps it (and ignores anything it can't use).
 */

/** "gpt-4o-mini" → "GPT-4o mini", "o4-mini" → "o4-mini", "gpt-4.1" → "GPT-4.1". */
export function modelDisplayName(id) {
  const m = String(id || '').trim();
  if (!m) return '';
  const gpt = /^gpt-([\w.]+?)(?:-(mini|nano|turbo))?$/i.exec(m);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].toLowerCase()}` : ''}`;
  return m;
}

const FALLBACK_MODES = [
  { id: 'default',  model: 'gpt-4o-mini', kind: 'Fast',     description: 'Quick, grounded answers for everyday study.' },
  { id: 'think',    model: 'o4-mini',     kind: 'Thinking', description: 'Reasons step by step before answering — best for hard problems.' },
  { id: 'research', model: 'gpt-4o',      kind: 'Research', description: 'A deeper pass with more syllabus and past-question references.' },
];
const FALLBACK_MODELS = [
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', description: 'Akoro Standard — quick, grounded answers.', default: true, available: true },
];

/** The modes alone (kept for callers that only switch modes). */
export function chatModelOptions(serverModes) {
  const modes = Array.isArray(serverModes) && serverModes.length ? serverModes : FALLBACK_MODES;
  return modes
    .filter((m) => ['default', 'think', 'research'].includes(m?.id))
    .map((m) => ({ id: m.id, label: modelDisplayName(m.model) || m.kind || m.id, meta: m.kind || '', description: m.description || '' }));
}

/**
 * The switch's menu and current label.
 * server: the /models answer (or null while it loads)
 * mode: 'default'|'think'|'research'; modelId: the picked catalogue id (null = default)
 * → { options, selectedId, label }
 */
export function chatPicker(server, { mode = 'default', modelId = null } = {}) {
  const modes = Array.isArray(server?.modes) && server.modes.length ? server.modes : FALLBACK_MODES;
  const models = Array.isArray(server?.models) && server.models.length ? server.models : FALLBACK_MODELS;
  const defaultModel = models.find((m) => m.default) || models[0];
  const options = [
    ...models.map((m, i) => ({
      id: `model:${m.id}`, section: i === 0 ? 'Models' : undefined,
      label: m.label || modelDisplayName(m.id),
      // Locked to a plan (§7.11.5a) reads "Plan"; not set up here reads "Coming soon".
      meta: m.locked === 'plan' ? 'Plan' : m.available ? (m.default ? 'Default' : '') : 'Coming soon',
      // The line says what the model is; the cost hint says what it costs against the default.
      description: [m.description || (m.available ? '' : (m.note || '')), m.available && !m.default ? m.costHint : null].filter(Boolean).join(' · '),
      ...(m.available ? {} : { note: m.note || 'Coming soon.' }),
      ...(m.locked === 'plan' ? { locked: true } : {}),
      // A dearer model asks once before it is used (1.5× the default or more).
      ...(m.available && !m.default && Number(m.costMultiple) >= 1.5 ? { confirm: `${m.costHint || 'More coins per message'}. Use it?` } : {}),
      disabled: !m.available,
    })),
    ...modes.filter((m) => m.id === 'think' || m.id === 'research').map((m, i) => ({
      id: `mode:${m.id}`, section: i === 0 ? 'Modes' : undefined,
      label: m.kind || m.id, meta: modelDisplayName(m.model), description: m.description || '',
    })),
  ];
  const picked = models.find((m) => m.id === modelId && m.available) || defaultModel;
  const selectedId = mode === 'think' || mode === 'research' ? `mode:${mode}` : `model:${picked?.id}`;
  const selected = options.find((o) => o.id === selectedId);
  const label = mode === 'think' || mode === 'research'
    ? `${selected?.label || mode} · ${selected?.meta || ''}`.replace(/ · $/, '')
    : (selected?.label || 'GPT-4o mini');
  // The payer's plan, when the server's picker is on (§7.11.5a).
  const tier = server?.picker?.enabled && server.picker.tier ? server.picker.tier : null;
  return { options, selectedId, label, tier };
}

/** A menu pick → the chat's next { mode, modelId }. Unavailable models change nothing. */
export function applyPick(optionId, current, server) {
  const [kind, id] = String(optionId).split(':');
  if (kind === 'mode' && (id === 'think' || id === 'research')) return { mode: id, modelId: current.modelId ?? null };
  if (kind === 'model') {
    const m = (server?.models || FALLBACK_MODELS).find((x) => x.id === id);
    if (!m?.available) return current;
    return { mode: 'default', modelId: m.default ? null : m.id };
  }
  return current;
}
