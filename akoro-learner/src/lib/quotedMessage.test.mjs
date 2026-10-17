import test from 'node:test';
import assert from 'node:assert/strict';
import { makeQuote, withQuote, parseQuoted, QUOTE_MAX, QUOTE_DEFAULT_QUESTION } from './quotedMessage.js';

test('makeQuote trims, collapses whitespace, caps and keeps a valid page', () => {
  assert.equal(makeQuote('  '), null);
  assert.deepEqual(makeQuote(' a\n  b ', 3), { text: 'a b', pageNumber: 3 });
  assert.equal(makeQuote('x', 0).pageNumber, null);
  assert.equal(makeQuote('x', 2.5).pageNumber, null);
  assert.equal(makeQuote('y'.repeat(QUOTE_MAX + 50)).text.length, QUOTE_MAX + 1);
});

test('withQuote: no quote leaves the question alone', () => {
  assert.equal(withQuote(' hi ', null), 'hi');
});

test('withQuote → parseQuoted round-trips, with and without a page', () => {
  const q = makeQuote('Mitochondria make "ATP".\nThey have two membranes.', 4);
  const sent = withQuote('Why two?', q);
  assert.equal(sent, 'Passage (page 4): "Mitochondria make "ATP". They have two membranes."\n\nWhy two?');
  assert.deepEqual(parseQuoted(sent), { quote: q, question: 'Why two?' });
  const noPage = withQuote('ok', makeQuote('cell wall'));
  assert.deepEqual(parseQuoted(noPage), { quote: { text: 'cell wall', pageNumber: null }, question: 'ok' });
});

test('an empty question still sends, with the default ask', () => {
  const sent = withQuote('', makeQuote('nucleus', 1));
  assert.equal(parseQuoted(sent).question, QUOTE_DEFAULT_QUESTION);
});

test('ordinary messages parse as plain text', () => {
  assert.deepEqual(parseQuoted('Passage: no quotes here'), { quote: null, question: 'Passage: no quotes here' });
  assert.deepEqual(parseQuoted(undefined), { quote: null, question: '' });
});
