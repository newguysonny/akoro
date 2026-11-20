import assert from 'node:assert/strict';
import test from 'node:test';
import { modelDisplayName, chatModelOptions, chatPicker, applyModelPick, applyModePick } from '../features/agent-chat/lib/chatModels.js';

const server = {
  modes: [
    { id: 'think', kind: 'Thinking', description: 'reasons' },
    { id: 'research', kind: 'Research', description: 'deeper' },
  ],
  models: [
    { id: 'deepseek', label: 'DeepSeek', default: true, available: true, description: 'std', modes: { default: true, think: true, research: true } },
    { id: 'glm', label: 'GLM', available: true, description: 'cheap', modes: { default: true, think: true, research: true } },
    { id: 'haiku', label: 'Claude Haiku', available: true, description: 'fast', modes: { default: true, think: false, research: true } },
    { id: 'old', label: 'Old', available: false, note: 'Coming soon', modes: { default: true, think: false, research: false } },
  ],
};

test('model ids read as names', () => {
  assert.equal(modelDisplayName('gpt-4o-mini'), 'GPT-4o mini');
  assert.equal(modelDisplayName('gpt-4.1-nano'), 'GPT-4.1 nano');
  assert.equal(modelDisplayName('o4-mini'), 'o4-mini');
  assert.deepEqual(chatModelOptions(null).map((o) => o.label), ['Default', 'Thinking', 'Research']);
});

test('the model menu has models only; the mode menu is separate', () => {
  const { modelOptions, modeOptions, modelSelectedId, modelLabel, modeSelectedId, modeLabel } =
    chatPicker(server, { mode: 'default', modelId: null });
  assert.deepEqual(modelOptions.map((o) => [o.id, o.meta, !!o.disabled]), [
    ['model:deepseek', 'Default', false],
    ['model:glm', '', false],
    ['model:haiku', '', false],
    ['model:old', 'Coming soon', true],
  ]);
  assert.equal(modelOptions.some((o) => o.id.startsWith('mode:')), false, 'no modes in the model list');
  assert.deepEqual(modeOptions.map((o) => [o.id, o.meta, !!o.disabled]), [
    ['mode:default', '', false],
    ['mode:think', '', false],
    ['mode:research', '', false],
  ]);
  assert.equal(modelSelectedId, 'model:deepseek');
  assert.equal(modelLabel, 'DeepSeek');
  assert.equal(modeSelectedId, 'mode:default');
  assert.equal(modeLabel, 'Default');
});

test('a mode the selected model cannot run is disabled, with the reason', () => {
  const { modeOptions } = chatPicker(server, { mode: 'think', modelId: 'haiku' });
  const think = modeOptions.find((o) => o.id === 'mode:think');
  assert.equal(think.disabled, true);
  assert.equal(think.meta, 'Unavailable');
  assert.match(think.description, /Not available for Claude Haiku/);
  const research = modeOptions.find((o) => o.id === 'mode:research');
  assert.equal(research.disabled, false);
});

test('picking a model keeps a supported mode and falls back to Default otherwise', () => {
  const cur = { mode: 'think', modelId: null };
  assert.deepEqual(applyModelPick('model:glm', cur, server), { modelId: 'glm', mode: 'think' });
  assert.deepEqual(applyModelPick('model:haiku', cur, server), { modelId: 'haiku', mode: 'default' });
  assert.deepEqual(applyModelPick('model:deepseek', { mode: 'research', modelId: 'glm' }, server), { modelId: null, mode: 'research' });
  assert.equal(applyModelPick('model:old', cur, server), cur, 'unavailable models change nothing');
});

test('a mode pick is ignored when the selected model cannot run it', () => {
  const cur = { mode: 'default', modelId: 'haiku' };
  assert.equal(applyModePick('mode:think', cur, server), cur);
  assert.deepEqual(applyModePick('mode:research', cur, server), { mode: 'research', modelId: 'haiku' });
  assert.deepEqual(applyModePick('mode:default', { mode: 'research', modelId: 'glm' }, server), { mode: 'default', modelId: 'glm' });
});

test('picker with tier lists: plan badge, locked models, cost hints, a confirm on dearer models', () => {
  const s = {
    picker: { enabled: true, tier: 'Freemium' },
    modes: server.modes,
    models: [
      { id: 'mini', label: 'Mini', default: true, available: true, costMultiple: 1, costHint: null, modes: { default: true, think: true, research: true } },
      { id: 'deep', label: 'DeepSeek', available: true, costMultiple: 0.5, costHint: 'Fewer coins per message', modes: { default: true, think: true, research: true } },
      { id: 'big', label: 'Big', available: true, costMultiple: 3, costHint: '≈ 3× coins per message', modes: { default: true, think: true, research: true } },
      { id: 'pro', label: 'Pro', available: false, locked: 'plan', note: 'Not in your plan.', costMultiple: 8, costHint: '≈ 8× coins per message', modes: { default: true, think: false, research: false } },
    ],
  };
  const p = chatPicker(s, {});
  assert.equal(p.tier, 'Freemium');
  const by = Object.fromEntries(p.modelOptions.map((o) => [o.id, o]));
  assert.equal(by['model:pro'].meta, 'Plan');
  assert.equal(by['model:pro'].locked, true);
  assert.equal(by['model:pro'].disabled, true);
  assert.match(by['model:deep'].description, /Fewer coins/);
  assert.equal(by['model:deep'].confirm, undefined, 'a cheaper model needs no confirm');
  assert.equal(by['model:big'].confirm, 'Costs more than the default.');
  assert.equal(chatPicker({ ...s, picker: { enabled: false, tier: 'Freemium' } }, {}).tier, null, 'no badge with the picker off');
});
