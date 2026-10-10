import assert from 'node:assert/strict';
import test from 'node:test';
import { modelDisplayName, chatModelOptions, chatPicker, applyPick } from './chatModels.js';

const server = {
  modes: [
    { id: 'default', model: 'gpt-4o-mini', kind: 'Fast' },
    { id: 'think', model: 'o4-mini', kind: 'Thinking', description: 'reasons' },
    { id: 'research', model: 'gpt-4o', kind: 'Research' },
  ],
  models: [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini', default: true, available: true, description: 'std' },
    { id: 'gpt-4.1', label: 'GPT-4.1', available: true, description: 'strong' },
    { id: 'claude-sonnet', label: 'Claude Sonnet', available: false, note: 'Coming soon — not set up on this server yet.' },
  ],
};

test('model ids read as names', () => {
  assert.equal(modelDisplayName('gpt-4o-mini'), 'GPT-4o mini');
  assert.equal(modelDisplayName('gpt-4.1-nano'), 'GPT-4.1 nano');
  assert.equal(modelDisplayName('o4-mini'), 'o4-mini');
  assert.deepEqual(chatModelOptions(null).map((o) => o.label), ['GPT-4o mini', 'o4-mini', 'GPT-4o']);
});

test('the menu: models first (unavailable ones say coming soon), then the modes', () => {
  const { options, selectedId, label } = chatPicker(server, { mode: 'default', modelId: null });
  assert.deepEqual(options.map((o) => [o.id, o.section ?? '', o.meta, !!o.disabled]), [
    ['model:gpt-4o-mini', 'Models', 'Default', false],
    ['model:gpt-4.1', '', '', false],
    ['model:claude-sonnet', '', 'Coming soon', true],
    ['mode:think', 'Modes', 'o4-mini', false],
    ['mode:research', '', 'GPT-4o', false],
  ]);
  assert.equal(options[2].note, 'Coming soon — not set up on this server yet.');   // the badge carries it; the hover title too
  assert.equal(selectedId, 'model:gpt-4o-mini');
  assert.equal(label, 'GPT-4o mini');
  assert.equal(chatPicker(server, { mode: 'default', modelId: 'gpt-4.1' }).label, 'GPT-4.1');
  assert.equal(chatPicker(server, { mode: 'think' }).label, 'Thinking · o4-mini');
  // A remembered pick that's no longer available falls back to the default.
  assert.equal(chatPicker(server, { modelId: 'claude-sonnet' }).selectedId, 'model:gpt-4o-mini');
});

test('picking: a model switches to the standard mode; coming-soon models change nothing', () => {
  const cur = { mode: 'think', modelId: null };
  assert.deepEqual(applyPick('model:gpt-4.1', cur, server), { mode: 'default', modelId: 'gpt-4.1' });
  assert.deepEqual(applyPick('model:gpt-4o-mini', { mode: 'default', modelId: 'gpt-4.1' }, server), { mode: 'default', modelId: null });
  assert.equal(applyPick('model:claude-sonnet', cur, server), cur);
  assert.deepEqual(applyPick('mode:research', { mode: 'default', modelId: 'gpt-4.1' }, server), { mode: 'research', modelId: 'gpt-4.1' });
});
