/**
 * chatModels — the Agent Chat's two switches: model and mode.
 *
 * GET /api/adaptive/chat/models answers with
 *   modes:  [{ id: 'think'|'research', kind, description }]
 *   models: [{ id, label, description, default, available, note, modes:{default,think,research} }]
 * The model menu lists MODELS only. The mode menu lists Default / Thinking /
 * Research and disables a mode the selected model cannot run (the server marks
 * each model's `modes`).
 */

/** "gpt-4o-mini" → "GPT-4o mini", "o4-mini" → "o4-mini", "gpt-4.1" → "GPT-4.1". */
export function modelDisplayName(id) {
  const m = String(id || '').trim();
  if (!m) return '';
  const gpt = /^gpt-([\w.]+?)(?:-(mini|nano|turbo))?$/i.exec(m);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].toLowerCase()}` : ''}`;
  return m;
}

const DEFAULT_MODE = { id: 'default', kind: 'Default', description: 'Quick, grounded answers for everyday study.' };

const FALLBACK_MODES = [
  { id: 'think',    kind: 'Thinking', description: 'Reasons step by step before answering — best for hard problems.' },
  { id: 'research', kind: 'Research', description: 'A deeper pass with more syllabus and past-question references.' },
];
const FALLBACK_MODELS = [
  { id: 'deepseek', label: 'DeepSeek', description: 'Akoro Standard — quick, grounded answers.', default: true, available: true, modes: { default: true, think: true, research: true } },
];

/** The modes alone (kept for callers that only switch modes). */
export function chatModelOptions(serverModes) {
  const modes = [DEFAULT_MODE, ...((Array.isArray(serverModes) && serverModes.length) ? serverModes : FALLBACK_MODES)];
  return modes
    .filter((m) => ['default', 'think', 'research'].includes(m?.id))
    .map((m) => ({ id: m.id, label: m.kind || m.id, meta: '', description: m.description || '' }));
}

const supported = (model, mode) => {
  if (mode === 'default') return true;
  const flags = model?.modes;
  // Older server: no flags → trust the mode list (previous behaviour).
  if (!flags) return true;
  return !!flags[mode];
};

/**
 * The two switches.
 * server: the /models answer (or null while it loads)
 * mode: 'default'|'think'|'research'; modelId: the picked catalogue id (null = default)
 */
export function chatPicker(server, { mode = 'default', modelId = null } = {}) {
  const modes = Array.isArray(server?.modes) && server.modes.length ? server.modes : FALLBACK_MODES;
  const models = Array.isArray(server?.models) && server.models.length ? server.models : FALLBACK_MODELS;
  const defaultModel = models.find((m) => m.default) || models[0];
  const picked = models.find((m) => m.id === modelId && m.available) || defaultModel;

  const selectedMode = ['think', 'research'].includes(mode) ? mode : 'default';
  const modeSupported = supported(picked, selectedMode);

  const modelOptions = models.map((m) => ({
    id: `model:${m.id}`,
    label: m.label || modelDisplayName(m.id),
    // Locked to a plan (§7.11.5a) reads "Plan"; not set up here reads "Coming soon".
    meta: m.locked === 'plan' ? 'Plan' : m.available ? (m.default ? 'Default' : '') : 'Coming soon',
    description: [m.description || (m.available ? '' : (m.note || '')), m.available && !m.default ? m.costHint : null].filter(Boolean).join(' · '),
    ...(m.available ? {} : { note: m.note || 'Coming soon.' }),
    ...(m.locked === 'plan' ? { locked: true } : {}),
    ...(m.available && !m.default && Number(m.costMultiple) >= 1.5 ? { confirm: 'Costs more than the default.' } : {}),
    disabled: !m.available,
  }));

  const modeOptions = [DEFAULT_MODE, ...modes.filter((m) => m.id === 'think' || m.id === 'research')].map((m) => {
    const ok = supported(picked, m.id);
    return {
      id: `mode:${m.id}`,
      label: m.kind || (m.id === 'default' ? 'Default' : m.id),
      meta: ok ? '' : 'Unavailable',
      description: ok ? (m.description || '') : `Not available for ${picked?.label || 'this model'}.`,
      disabled: !ok,
    };
  });

  const modeEntry = [DEFAULT_MODE, ...modes].find((m) => m.id === selectedMode);
  const label = selectedMode === 'default'
    ? (modeEntry?.kind || 'Default')
    : `${modeEntry?.kind || selectedMode}`;

  return {
    modelOptions,
    modeOptions,
    modelSelectedId: `model:${picked?.id}`,
    modelLabel: picked?.label || 'DeepSeek',
    modeSelectedId: `mode:${selectedMode}`,
    modeLabel: label,
    modeSupported,
    tier: server?.picker?.enabled && server.picker.tier ? server.picker.tier : null,
  };
}

/** A model pick → { modelId, mode } (mode falls back to Default if unsupported). */
export function applyModelPick(optionId, current, server) {
  const [kind, id] = String(optionId).split(':');
  if (kind !== 'model') return current;
  const models = Array.isArray(server?.models) ? server.models : FALLBACK_MODELS;
  const m = models.find((x) => x.id === id);
  if (!m?.available) return current;
  const mode = supported(m, current.mode) ? current.mode : 'default';
  return { modelId: m.default ? null : m.id, mode };
}

/** A mode pick → { mode } (unchanged when the selected model can't run it). */
export function applyModePick(optionId, current, server) {
  const [kind, id] = String(optionId).split(':');
  if (kind !== 'mode' || !['default', 'think', 'research'].includes(id)) return current;
  const models = Array.isArray(server?.models) ? server.models : FALLBACK_MODELS;
  const picked = models.find((m) => m.id === current.modelId && m.available)
    || models.find((m) => m.default) || models[0];
  if (!supported(picked, id)) return current;
  return { ...current, mode: id };
}
