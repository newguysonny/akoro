import assert from 'node:assert/strict';
import test from 'node:test';
import { modelDisplayName, chatModelOptions } from './chatModels.js';

test('model ids read as names', () => {
  assert.equal(modelDisplayName('gpt-4o-mini'), 'GPT-4o mini');
  assert.equal(modelDisplayName('gpt-4o'), 'GPT-4o');
  assert.equal(modelDisplayName('gpt-4.1-nano'), 'GPT-4.1 nano');
  assert.equal(modelDisplayName('o4-mini'), 'o4-mini');
  assert.equal(modelDisplayName(''), '');
});

test("the switch's options: the server's models, defaults while they load, unknown modes dropped", () => {
  const opts = chatModelOptions([
    { id: 'default', model: 'gpt-4.1-mini', kind: 'Fast', description: 'd' },
    { id: 'think', model: 'o3', kind: 'Thinking' },
    { id: 'evil', model: 'anything' },
  ]);
  assert.deepEqual(opts, [
    { id: 'default', label: 'GPT-4.1 mini', meta: 'Fast', description: 'd' },
    { id: 'think', label: 'o3', meta: 'Thinking', description: '' },
  ]);
  assert.deepEqual(chatModelOptions(null).map((o) => o.label), ['GPT-4o mini', 'o4-mini', 'GPT-4o']);
});
