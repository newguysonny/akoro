import assert from 'node:assert/strict';
import test from 'node:test';
import { hasAnswer, sameAnswer, stepStatuses, resumeStep, openingAnswers, shownAnswer, lastCheck } from './questionSteps.js';

const qs = [{ q: 'Pick', options: ['a', 'b'] }, { q: 'Explain' }, 'Name one'];

test('answers: typed text (an older option number counts), ignoring outer spaces', () => {
  assert.equal(hasAnswer(qs[0], 0), true);
  assert.equal(hasAnswer(qs[0], 'b'), true);
  assert.equal(shownAnswer(qs[0], 1), 'B');
  assert.equal(shownAnswer(qs[1], 'x'), 'x');
  assert.equal(sameAnswer(qs[0], 'B', 1), true);   // an older pick and its letter agree — no needless re-save
  assert.equal(sameAnswer(qs[0], 'B', 'b'), false);
  assert.equal(hasAnswer(qs[0], null), false);
  assert.equal(hasAnswer(qs[1], '  '), false);
  assert.equal(sameAnswer(qs[0], 1, 1), true);
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

test('files answer a question too: files only counts as answered and saved', () => {
  assert.deepEqual(stepStatuses(qs, {}, {}, { 1: 2 }), ['empty', 'saved', 'empty']);
  assert.equal(resumeStep(qs, { 0: 'b' }, { 0: 'b' }, { 1: 1 }), 2);
});

test('last check: unanswered, labelling blanks, unsaved typing, file count', () => {
  const paper = [{ q: 'Pick', options: ['a', 'b'] }, { q: 'Label', format: 'label', labels: ['P', 'Q'] }, { q: 'Explain' }];
  const c = lastCheck(paper, { 1: 'P: stoma', 2: 'typed' }, { 1: 'P: stoma' }, { 0: 1 });
  assert.deepEqual(c.unanswered, []);
  assert.deepEqual(c.blanks, [{ index: 1, parts: ['Q'] }]);
  assert.deepEqual(c.pending, [2]);
  assert.equal(c.files, 1);
  assert.deepEqual(lastCheck(paper, {}, {}, {}).unanswered, [0, 1, 2]);
});
