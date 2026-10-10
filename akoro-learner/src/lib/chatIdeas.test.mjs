import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_STARTERS, cleanIdeas, protegeMoves } from './chatIdeas.js';

test('starters show what the agent can do, each with a ready-to-send example', () => {
  assert.equal(CHAT_STARTERS.length, 6);
  for (const s of CHAT_STARTERS) {
    assert.match(s.labelKey, /^agent\.starter_/);
    assert.equal(s.fillKey, `${s.labelKey}_fill`);
    assert.ok(s.fill.length > s.label.length - 5);
  }
});

test('suggestions become at most three distinct chips', () => {
  assert.deepEqual(cleanIdeas(['  Give me an example ', 'give me an example', '', 'x'.repeat(90), 'Quiz me on this', 'Make it simpler', 'Fourth']),
    [{ label: 'Give me an example', fill: 'Give me an example' }, { label: 'Quiz me on this', fill: 'Quiz me on this' }, { label: 'Make it simpler', fill: 'Make it simpler' }]);
  assert.deepEqual(cleanIdeas(null), []);
});

test("the protégé's moves: a Teach me topic, and the guide's mark", () => {
  assert.deepEqual(protegeMoves([{ tool: 'ask_to_be_taught', teach: { topic: 'Photosynthesis', subject: 'Biology' } }]), { teach: { topic: 'Photosynthesis', subject: 'Biology' } });
  assert.deepEqual(protegeMoves([{ tool: 'consult_teaching_guide', guide: { name: 'NaNa Esumai', teach: { topic: 'Osmosis' } } }]),
    { guide: { name: 'NaNa Esumai' }, teach: { topic: 'Osmosis', subject: '' } });
  assert.deepEqual(protegeMoves([{ tool: 'create_task', success: true }]), {});
  assert.deepEqual(protegeMoves(undefined), {});
});
