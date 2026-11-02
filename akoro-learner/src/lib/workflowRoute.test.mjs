import test from 'node:test';
import assert from 'node:assert/strict';
import { openFor, workflowIdFromSearch } from './workflowRoute.js';

const ID = '11111111-1111-4111-8111-111111111111';
const BATTLE = '22222222-2222-4222-8222-222222222222';
const d = (surface, params = {}) => ({ title: 'Water Cycle', action: { label: 'Open', route: { surface, workflowId: ID, params, href: `/app?workflow=${ID}` } } });

test('the deep link: only a real workflow id', () => {
  assert.equal(workflowIdFromSearch(`?tab=agent&workflow=${ID}`), ID);
  assert.equal(workflowIdFromSearch('?workflow=nope'), null);
  assert.equal(workflowIdFromSearch(''), null);
});

test('each surface opens what it names, with the workflowId', () => {
  assert.deepEqual(openFor(d('teaching_modal', { topic: 'Evaporation', subject: 'Basic Science', adaptiveSessionId: 'as-1', mode: 'continuation' })),
    { kind: 'teaching', workflowId: ID, topic: 'Evaporation', subject: 'Basic Science', mode: 'continuation', sessionId: 'as-1' });
  assert.equal(openFor(d('teaching_modal', {})).mode, 'fresh');
  assert.deepEqual(openFor(d('decay_review_modal', { topic: 'Cells' })), { kind: 'decay_review', workflowId: ID, topic: 'Cells', subject: null });
  assert.equal(openFor(d('assessment_room', { topic: 'Algebra', assessmentId: 'a-1' })).assessmentId, 'a-1');
  assert.deepEqual(openFor(d('agent_chat')), { kind: 'agent_chat', workflowId: ID });
  assert.deepEqual(openFor(d('battle', { battleId: BATTLE })), { kind: 'battle', workflowId: ID, battleId: BATTLE });
  assert.equal(openFor(d('battle', { battleId: 'x' })), null);
  assert.equal(openFor(d('unknown')), null);
  assert.equal(openFor({ action: null }), null);
});
