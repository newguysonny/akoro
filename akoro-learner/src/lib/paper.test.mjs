import test from 'node:test';
import assert from 'node:assert/strict';
import { paperBlocks, passageRange, questionContext, figureSrc, mathRuns, removeRef, letterOf } from './paper.js';

const details = {
  sections: [{ title: 'Section A', instructions: 'Choose A to E.' }, { title: 'Section B', instructions: 'Read the passage.' }],
  passages: [{ title: 'The farmer', text: 'Ade woke at dawn.' }],
  questions: [
    { q: 'one', section: 0 }, { q: 'two', section: 0 },
    { q: 'three', section: 1, passage: 0 }, { q: 'four', section: 1, passage: 0 },
    { q: 'five', section: 1 }, 'plain string',
  ],
};

test('blocks group consecutive questions; a section heads once', () => {
  const b = paperBlocks(details);
  assert.deepEqual(b.map((x) => [x.sectionIndex, x.passageIndex, x.newSection, x.items.map((y) => y.i)]),
    [[0, null, true, [0, 1]], [1, 0, true, [2, 3]], [1, null, false, [4]], [null, null, false, [5]]]);
  assert.equal(passageRange(b[1].items), 'Questions 3–4');
  assert.equal(passageRange([{ i: 0 }]), 'Question 1');
});

test('a reference to a missing section or passage is ignored', () => {
  const b = paperBlocks({ questions: [{ q: 'x', section: 4, passage: 2 }] });
  assert.equal(b[0].section, null);
  assert.equal(b[0].passage, null);
});

test('one question knows its section and passage', () => {
  const c = questionContext(details, 3);
  assert.equal(c.section.title, 'Section B');
  assert.equal(c.passage.title, 'The farmer');
  assert.equal(c.passageRange, 'Questions 3–4');
  assert.equal(questionContext(details, 5).section, null);
});

test('figures become image sources — nothing else', () => {
  assert.match(figureSrc({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><line/></svg>' }), /^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  assert.equal(figureSrc({ src: 'data:image/png;base64,AAAA' }), 'data:image/png;base64,AAAA');
  assert.equal(figureSrc({ src: 'javascript:alert(1)' }), null);
  assert.equal(figureSrc({ svg: '<script>' }), null);
  assert.equal(figureSrc(null), null);
});

test('maths: powers and subscripts', () => {
  assert.deepEqual(mathRuns('x^2 + y^{10}'), [{ text: 'x' }, { text: '2', sup: true }, { text: ' + y' }, { text: '10', sup: true }]);
  assert.deepEqual(mathRuns('H_2O'), [{ text: 'H' }, { text: '2', sub: true }, { text: 'O' }]);
  assert.deepEqual(mathRuns('10^-3 m'), [{ text: '10' }, { text: '-3', sup: true }, { text: ' m' }]);
  assert.deepEqual(mathRuns('my_var and file_2'), [{ text: 'my_var and file_2' }]);
  assert.deepEqual(mathRuns('x² already'), [{ text: 'x² already' }]);
  assert.deepEqual(mathRuns(''), [{ text: '' }]);
});

test('removing a section keeps references in step', () => {
  const qs = removeRef(details.questions, 'section', 0);
  assert.deepEqual(qs.map((q) => (typeof q === 'object' ? q.section : 'str')), [undefined, undefined, 0, 0, 0, 'str']);
  assert.equal('section' in qs[0], false);
  assert.equal(letterOf(4), 'E');
});
