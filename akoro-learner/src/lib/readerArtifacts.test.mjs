import assert from 'node:assert/strict';
import test from 'node:test';
import { artifactToTab, marksFromArtifacts, tabContentPatch, tabToArtifact } from './readerArtifacts.js';

const quizTab = {
  id: 'r3', toolId: 'quiz', createdPage: 1, values: { scope: 'This page', count: '3', difficulty: 'Easy' },
  title: 'Quiz · Page 2', quizQuestions: [{ prompt: 'Q?' }], quizAnswers: [{ selected: 'A', checked: true }], quizIndex: 0,
  cardIndex: 0, flipped: true, quizHint: 'x', topic: 'Bio',
};

test('a tab saves its form values, what it shows, and the learner’s progress — not transient UI', () => {
  const a = tabToArtifact(quizTab);
  assert.deepEqual(a, {
    kind: 'quiz', pageNumber: 2, params: quizTab.values, open: true,
    content: { quizQuestions: [{ prompt: 'Q?' }], ui: { quizAnswers: [{ selected: 'A', checked: true }], quizIndex: 0, cardIndex: 0 } },
  });
  assert.ok(!('flipped' in a.content) && !('quizHint' in a.content), 'flip/hint state is not saved');
  assert.deepEqual(tabContentPatch(quizTab), { content: a.content });
});

test('a saved artifact becomes the same tab again, progress restored', () => {
  const tab = artifactToTab({ id: 'uuid-1', ...tabToArtifact(quizTab) }, 'r9');
  assert.equal(tab.id, 'r9');
  assert.equal(tab.artifactId, 'uuid-1');
  assert.equal(tab.createdPage, 1);
  assert.equal(tab.title, 'Quiz · Page 2');
  assert.deepEqual(tab.quizQuestions, quizTab.quizQuestions);
  assert.deepEqual(tab.quizAnswers, quizTab.quizAnswers);
  const doc = artifactToTab({ id: 'u2', kind: 'summary', pageNumber: 1, params: { scope: 'Whole document' }, content: { summaryPoints: [] } }, 'r1');
  assert.equal(doc.title, 'Summary · Whole document');
});

test('annotations and hidden passages come back on their page', () => {
  const { annotations, redactions } = marksFromArtifacts([
    { id: 'a1', kind: 'annotation', pageNumber: 3, content: { text: 'Calvin cycle', note: 'learn this' } },
    { id: 'a2', kind: 'redaction', pageNumber: 1, content: { text: 'answer key', rects: [{ x: 10, y: 20, w: 30, h: 2 }, { x: 'bad' }] } },
    { id: 'a3', kind: 'annotation', pageNumber: 2, content: {} },
    { id: 'a4', kind: 'quiz', pageNumber: 1, content: {} },
  ]);
  assert.deepEqual(annotations, [{ id: 'ann-a1', artifactId: 'a1', page: 2, text: 'Calvin cycle', note: 'learn this', rects: [] }]);
  // A mark on a drawn page (PDF / image) keeps its boxes; bad ones are dropped.
  assert.deepEqual(redactions, [{ id: 'red-a2', artifactId: 'a2', page: 0, text: 'answer key', rects: [{ x: 10, y: 20, w: 30, h: 2 }] }]);
});
