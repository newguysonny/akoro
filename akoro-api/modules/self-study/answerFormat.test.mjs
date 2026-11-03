import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { ANSWER_FORMATS, ANSWER_FORMAT_INFO, cleanAnswerFormat, answerFormatOf, permits, fileRefusal, typedRefusal } from './answerFormat.js';

test('a missing or unknown format is "all", so every assignment made before this setting behaves as it did', () => {
  assert.equal(cleanAnswerFormat(undefined), 'all'); assert.equal(cleanAnswerFormat('videos'), 'all'); assert.equal(cleanAnswerFormat(null), 'all');
  assert.equal(answerFormatOf({}), 'all'); assert.equal(answerFormatOf(null), 'all'); assert.equal(answerFormatOf({ answer_format: 'images' }), 'images');
  assert.deepEqual([...ANSWER_FORMATS].sort(), ['all', 'images', 'images_text', 'text']);
  for (const f of ANSWER_FORMATS) assert.ok(ANSWER_FORMAT_INFO[f].label && ANSWER_FORMAT_INFO[f].hint);
});

test('what each format permits', () => {
  assert.deepEqual(permits('images'), { typed: false, images: true, documents: false });
  assert.deepEqual(permits('text'), { typed: true, images: false, documents: false });
  assert.deepEqual(permits('images_text'), { typed: true, images: true, documents: false });
  assert.deepEqual(permits('all'), { typed: true, images: true, documents: true });
  assert.deepEqual(permits(undefined), permits('all'));
});

test('uploads: photos need an image format, PDFs and Word need "all", and text-only takes no files', () => {
  assert.equal(fileRefusal('images', 'image'), null);
  assert.equal(fileRefusal('images_text', 'image'), null);
  assert.equal(fileRefusal('all', 'image'), null);
  assert.match(fileRefusal('text', 'image'), /typed answers only/);
  for (const kind of ['pdf', 'docx', 'text']) {
    assert.equal(fileRefusal('all', kind), null);
    assert.match(fileRefusal('images', kind), /photos or drawings/);
    assert.match(fileRefusal('images_text', kind), /photos or drawings/);
    assert.match(fileRefusal('text', kind), /typed answers only/);
  }
});

test('typed answers are refused only on a photo-only assignment', () => {
  assert.match(typedRefusal('images'), /photo answers only/);
  for (const f of ['text', 'images_text', 'all', undefined]) assert.equal(typedRefusal(f), null);
});

test('the routes enforce it on files, autosaves and the hand-in (the app is not the gate)', async () => {
  const src = await readFile(new URL('./routes.js', import.meta.url), 'utf8');
  assert.match(src, /fileRefusal\(answerFormatOf\(brief\?\.details\), sniffed\.kind\)/);
  assert.match(src, /typedNo && !Array\.isArray\(asked\?\.options\)/);                  // autosave: open answers only — picking an option is not typing
  assert.match(src, /if \(typedNo && !Array\.isArray\(questions\[Number\(k\)\]\?\.options\)\) continue;/);   // hand-in
  assert.match(src, /const text = typedNo \? ""/);
});

test('the mark scheme never reaches a learner — graded or not — and an ordinary brief is untouched', async () => {
  const { briefForLearner } = await import('./submissionView.js');
  const secret = 'Model answer: 640';
  const details = { instructions: 'Answer all.', answer_format: 'images', mark_scheme: { criteria: [{ marking_points: [{ model_answer: secret, no_marks_for: ['755'] }] }] }, questions: [{ q: 'Decode', answer: '640', marking: 'm' }] };
  for (const graded of [false, true]) {
    const out = briefForLearner(details, graded);
    assert.equal('mark_scheme' in out, false, `graded=${graded}`);
    assert.doesNotMatch(JSON.stringify(out), /Model answer: 640|no_marks_for|marking_points/);
    assert.equal(out.answer_format, 'images');                  // the format is the learner's to know (their screen follows it)
  }
  assert.equal(briefForLearner(details, false).questions[0].answer, undefined);   // unchanged behaviour: answers hidden until graded
  assert.equal(briefForLearner(details, true).questions[0].answer, '640');
  const plain = { questions: [{ q: 'x', answer: 'y' }] };
  assert.equal(briefForLearner(plain, true), plain);            // no scheme: the very same object, as before
  assert.deepEqual(briefForLearner(null, false), {});
});
