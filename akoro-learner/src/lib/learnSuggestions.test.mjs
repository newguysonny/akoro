import test from 'node:test';
import assert from 'node:assert/strict';
import { materialText, keyTerms, localLearnSuggestions, learnSuggestionInput, shapeLearnSuggestions, LEARN_EXCERPT_CHARS } from './learnSuggestions.js';

const CELL = 'The cell wall protects the plant cell. The cell wall is made of cellulose. ' +
  'Mitochondria release energy. Mitochondria are found in the cytoplasm. The nucleus controls the cell.';

test('materialText: content pages first, then the reference, else empty', () => {
  assert.equal(materialText({ content: { state: 'ready', pages: [{ text: ' a ' }, { text: '' }, { text: 'b' }] } }), 'a\nb');
  assert.equal(materialText({ content: { state: 'loading', pages: [{ text: 'x' }] }, reference: { text: 'ref' } }), 'ref');
  assert.equal(materialText({}), '');
});

test('keyTerms finds the repeated concepts, phrases first, no stop words', () => {
  const terms = keyTerms(CELL);
  assert.equal(terms[0], 'cell wall');
  assert.ok(terms.includes('mitochondria'));
  assert.ok(!terms.some((t) => /^(the|is|are)$/.test(t)));
});

test('with material: suggestions name the document and its terms', () => {
  const s = localLearnSuggestions({ topic: 'Cells', title: 'BIO 111 Cell Structure.pdf', text: CELL });
  assert.equal(s.length, 4);
  assert.equal(s[0].label, 'Summarise "BIO 111 Cell Structure"');
  assert.equal(s[1].label, 'Explain cell wall in simple words');
  assert.ok(s.every((x) => x.icon.startsWith('ti-')));
});

test('no material: the topic and its subtopics', () => {
  const s = localLearnSuggestions({ topic: 'Photosynthesis', subtopics: ['Light reactions', { name: 'Calvin cycle' }] });
  assert.equal(s[0].label, 'Summarise the key points of Photosynthesis');
  assert.equal(s[1].label, 'Explain Light reactions in simple words');
  assert.equal(s[2].label, 'Quiz me on Calvin cycle');
  const bare = localLearnSuggestions({ topic: 'Fractions' });
  assert.equal(bare[2].label, 'Quiz me on Fractions');
});

test('learnSuggestionInput samples a long document and caps everything', () => {
  const long = 'start '.repeat(400) + 'middle '.repeat(400) + 'finish '.repeat(400);
  const body = learnSuggestionInput({ topic: 'T', title: 'doc.pdf', text: long, subtopics: Array(20).fill('s') });
  assert.ok(body.excerpt.length <= LEARN_EXCERPT_CHARS + 10);
  assert.ok(body.excerpt.includes('start') && body.excerpt.includes('middle') && body.excerpt.includes('finish'));
  assert.equal(body.title, 'doc');
  assert.equal(body.subtopics.length, 8);
});

test('shapeLearnSuggestions: distinct, capped at 4, icons by kind', () => {
  const s = shapeLearnSuggestions(['Summarise it', 'summarise it', '', 'Explain X', 'Quiz me', 'Example', 'Fifth']);
  assert.deepEqual(s.map((x) => x.label), ['Summarise it', 'Explain X', 'Quiz me', 'Example']);
  assert.equal(s[0].icon, 'ti-notes');
  assert.deepEqual(shapeLearnSuggestions(null), []);
});

test('shapeLearnSuggestions starts each with a capital', () => {
  assert.deepEqual(shapeLearnSuggestions(['summarise the cell wall section', 'explain mitochondria simply']).map((x) => x.label),
    ['Summarise the cell wall section', 'Explain mitochondria simply']);
});

test("placeholder dashes never become a suggestion topic", () => {
  const s = localLearnSuggestions({ title: "Cell Structure and Organization", text: "--- --- ----- --- --- ----- 12 34", subtopics: [] });
  for (const item of s) assert.doesNotMatch(item.label, /---/);
  assert.match(s[0].label, /Cell Structure and Organization/);
});
