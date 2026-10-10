import assert from 'node:assert/strict';
import test from 'node:test';
import { hasAnswer, sameAnswer, stepStatuses, resumeStep, openingAnswers } from './questionSteps.js';

const qs = [{ q: 'Pick', options: ['a', 'b'] }, { q: 'Explain' }, 'Name one'];

test('answers: MCQ picks (0 counts), text ignoring outer spaces', () => {
  assert.equal(hasAnswer(qs[0], 0), true);
  assert.equal(hasAnswer(qs[0], null), false);
  assert.equal(hasAnswer(qs[1], '  '), false);
  assert.equal(sameAnswer(qs[0], '1', 1), true);
  assert.equal(sameAnswer(qs[1], ' hi ', 'hi'), true);
  assert.equal(sameAnswer(qs[1], '', null), true);
});

test('step states: saved, edited since submitting, never submitted, empty', () => {
  assert.deepEqual(
    stepStatuses(qs, { 0: 1, 1: 'new text', 2: '' }, { 0: 1, 1: 'old text', 2: 'gone' }),
    ['saved', 'edited', 'edited'],   // clearing a submitted answer is an edit too
  );
  assert.deepEqual(stepStatuses(qs, { 1: 'typed' }, {}), ['empty', 'edited', 'empty']);
});

test('resume at the first step not submitted; all submitted → the review', () => {
  assert.equal(resumeStep(qs, { 0: 1 }, { 0: 1 }), 1);
  assert.equal(resumeStep(qs, { 0: 0, 1: 'a', 2: 'b' }, { 0: 0, 1: 'a', 2: 'b' }), 3);
});

test('opening: the server wins when it is newer; unsent browser edits ride on top otherwise', () => {
  const saved = { 0: 1, 1: 'server' };
  assert.deepEqual(openingAnswers({ saved, savedAt: '2026-10-10T10:00:00Z', local: { 1: 'old local' }, editedAt: '2026-10-10T09:00:00Z' }), saved);
  assert.deepEqual(openingAnswers({ saved, savedAt: '2026-10-10T10:00:00Z', local: { 1: 'newer local' }, editedAt: '2026-10-10T11:00:00Z' }), { 0: 1, 1: 'newer local' });
  assert.deepEqual(openingAnswers({ local: { 2: 'only local' } }), { 2: 'only local' });
});
