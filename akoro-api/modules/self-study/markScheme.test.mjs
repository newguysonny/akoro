import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fitPoints, levelPoints, cleanMarkScheme, summarizeMarkScheme, paperDigest, gradingScheme, criteriaFor, draftMarkScheme,
  buildMarkSchemeMessages, markSchemeResponseFormat, markedIndexes, isKeyedMcq,
} from './markScheme.js';

const paper = {
  questions: [
    { q: 'Which is the capital of France?', type: 'MCQ', max_points: 1, options: ['Paris', 'Rome', 'Oslo', 'Bonn'], correct: 0 },
    { q: 'Decode rw-r-----', type: 'Theory', max_points: 4, answer: '640', marking: 'User 6, group 4, others 0 (1 each); 640 (1)' },
    { q: 'Explain why ./ is needed.', type: 'Theory', max_points: 2, answer: 'The current directory is not on PATH' },
  ],
};
const mp = (points, extra = {}) => ({ looks_for: 'Does the answer say X?', model_answer: 'X', points, levels: [], full_marks_also_for: [], no_marks_for: [], ...extra });

test('which questions the AI marks: everything the key does not', () => {
  assert.equal(isKeyedMcq(paper.questions[0]), true);
  assert.deepEqual(markedIndexes(paper), [1, 2]);
  assert.deepEqual(markedIndexes({ questions: [{ q: 'x', options: ['a', 'b'] }] }), [0]);   // an MCQ with no key is marked by the model
});

test('levels run from no marks up to full marks', () => {
  assert.deepEqual(levelPoints(1), [0, 1]);
  assert.deepEqual(levelPoints(0.5), [0, 0.5]);
  assert.deepEqual(levelPoints(2), [0, 1, 2]);
  assert.deepEqual(levelPoints(4), [0, 2, 4]);
  assert.deepEqual(levelPoints(3), [0, 1.5, 3]);
});

test('fitPoints splits a question\'s marks across its marking points exactly, in halves', () => {
  assert.deepEqual(fitPoints([1, 1, 1, 1], 4), [1, 1, 1, 1]);
  assert.equal(fitPoints([3, 3, 3], 4).reduce((s, x) => s + x, 0), 4);
  assert.equal(fitPoints([1, 1, 1], 10).reduce((s, x) => s + x, 0), 10);
  assert.equal(fitPoints([5, 1], 2).reduce((s, x) => s + x, 0), 2);
  assert.deepEqual(fitPoints([1, 1, 1], 1), [1, 0, 0]);          // fewer marks than marking points
  for (const x of fitPoints([2, 9, 1, 1], 7)) assert.ok(x * 2 === Math.round(x * 2) && x >= 0.5);
  assert.deepEqual(fitPoints([], 3), []);
});

test('the model\'s JSON becomes a scheme whose marks match the paper', () => {
  const json = { criteria: [
    { question: 2, title: 'Octal decoding', description: 'Works out 640.', marking_points: [mp(1), mp(1), mp(1), mp(2, { full_marks_also_for: ['owner has read and write', 'owner has read and write'], no_marks_for: ['User = 7'] })] },
    { question: 3, title: 'PATH', description: 'Explains ./', marking_points: [mp(5)] },
    { question: 1, title: 'MCQ', description: 'should be dropped', marking_points: [mp(1)] },   // keyed MCQ: no criteria
    { question: 9, title: 'Nowhere', description: '', marking_points: [mp(1)] },                // no such question
  ] };
  const s = cleanMarkScheme(json, paper, { oneBased: true });
  assert.deepEqual(s.criteria.map((c) => [c.question, c.title]), [[1, 'Octal decoding'], [2, 'PATH']]);
  assert.equal(s.criteria[0].points, 4);                       // 5 marking-point marks fitted to the question's 4
  assert.equal(s.criteria[1].points, 2);                       // 5 fitted down to 2
  assert.equal(s.total_points, 6);
  assert.deepEqual(s.criteria.map((c) => c.id), ['c1', 'c2']);
  assert.deepEqual(s.criteria[0].marking_points.map((m) => m.id), ['c1m1', 'c1m2', 'c1m3', 'c1m4']);
  const sum = s.criteria[0].marking_points.reduce((t, m) => t + m.points, 0);
  assert.equal(sum, 4);
  for (const m of s.criteria[0].marking_points) {
    const pts = m.levels.map((l) => l.points);
    assert.equal(pts[0], 0); assert.equal(pts.at(-1), m.points);   // no marks … full marks
    assert.ok(m.levels.every((l) => l.label && l.descriptor));
  }
  assert.deepEqual(s.criteria[0].marking_points.find((m) => m.no_marks_for.length)?.full_marks_also_for, ['owner has read and write']);   // de-duplicated
});

test('a question the model skipped still gets a plain criterion, so the marker covers every open question', () => {
  const s = cleanMarkScheme({ criteria: [{ question: 2, title: 'Octal', description: '', marking_points: [mp(4)] }] }, paper, { oneBased: true });
  assert.deepEqual(s.criteria.map((c) => c.question), [1, 2]);
  const plain = criteriaFor(s, 2)[0];
  assert.equal(plain.points, 2); assert.equal(plain.marking_points[0].model_answer, 'The current directory is not on PATH');
  assert.deepEqual(cleanMarkScheme({}, { questions: [{ q: 'x', options: ['a'], correct: 0 }] }).criteria, []);   // nothing to mark
});

test('a teacher\'s edits go through the same clean-up (0-based questions, marks re-fitted)', () => {
  const edited = { criteria: [{ question: 1, title: ' Decoding ', description: 'd', marking_points: [mp(3), mp(3)] }, { question: 2, title: 'PATH', marking_points: [mp(2)] }] };
  const s = cleanMarkScheme(edited, paper);
  assert.equal(s.criteria[0].title, 'Decoding');
  assert.equal(s.criteria[0].points, 4); assert.equal(s.total_points, 6);
  // the same input cleaned again changes nothing: saving is stable
  assert.deepEqual(cleanMarkScheme(s, paper), s);
});

test('summary, grading scheme and digest', () => {
  const s = cleanMarkScheme({ criteria: [{ question: 1, title: 'a', marking_points: [mp(2), mp(2)] }] }, paper);
  assert.deepEqual(summarizeMarkScheme(s), { criteria: 2, markingPoints: 3, totalPoints: 6 });
  assert.equal(gradingScheme({ mark_scheme: s }), s); assert.equal(gradingScheme({}), null); assert.equal(gradingScheme({ mark_scheme: { criteria: [] } }), null);
  const d = paperDigest(paper);
  assert.equal(d, paperDigest(structuredClone(paper)));
  assert.notEqual(d, paperDigest({ questions: [...paper.questions, { q: 'new' }] }));
  assert.notEqual(d, paperDigest({ questions: paper.questions.map((q, i) => (i === 1 ? { ...q, max_points: 5 } : q)) }));
});

test('the prompt lists the questions the AI marks and leaves keyed MCQs out', () => {
  const [sys, user] = buildMarkSchemeMessages({ paper, topic: 'Linux permissions', subject: 'Computer Science', classLevel: 'SSS 2' });
  assert.match(sys.content, /marking points of a question must add up to the question's marks EXACTLY/);
  assert.match(user.content, /Q2 \(4 marks, Theory\): Decode rw-r-----/);
  assert.match(user.content, /Model answer: 640/);
  assert.match(user.content, /Q1: marked from the answer key/);
  assert.doesNotMatch(user.content, /Paris/);
  const again = buildMarkSchemeMessages({ paper, topic: 't', current: cleanMarkScheme({}, paper), request: 'make Q2 stricter' })[1].content;
  assert.match(again, /The mark scheme as it stands/); assert.match(again, /make Q2 stricter/);
  const f = markSchemeResponseFormat();
  assert.equal(f.json_schema.strict, true);
  assert.deepEqual(f.json_schema.schema.properties.criteria.items.required, ['question', 'title', 'description', 'marking_points']);
});

test('draftMarkScheme: writes it, asks once more when the model missed questions, and says when it cannot', async () => {
  const good = { criteria: [
    { question: 2, title: 'Octal', description: 'd', marking_points: [mp(4)] },
    { question: 3, title: 'PATH', description: 'd', marking_points: [mp(2)] }] };
  let calls = 0;
  const ok = await draftMarkScheme({ chat: async () => { calls++; return JSON.stringify(good); }, paper, topic: 't' });
  assert.equal(calls, 1); assert.equal(ok.scheme.total_points, 6); assert.match(ok.note, /Written/);

  // first answer covers one of two questions → asked again, the fuller answer kept
  const seq = [JSON.stringify({ criteria: [good.criteria[0]] }), JSON.stringify(good)]; calls = 0;
  const retried = await draftMarkScheme({ chat: async () => seq[calls++], paper, topic: 't' });
  assert.equal(calls, 2); assert.deepEqual(retried.scheme.criteria.map((c) => c.title), ['Octal', 'PATH']);

  await assert.rejects(() => draftMarkScheme({ chat: async () => 'not json', paper, topic: 't' }), /no mark scheme/);
  const mcqOnly = await draftMarkScheme({ chat: async () => { throw new Error('should not be called'); }, paper: { questions: [paper.questions[0]] }, topic: 't' });
  assert.deepEqual(mcqOnly.scheme.criteria, []); assert.match(mcqOnly.note, /answer key/);
  const improved = await draftMarkScheme({ chat: async () => JSON.stringify(good), paper, topic: 't', current: ok.scheme, request: 'stricter' });
  assert.match(improved.note, /Improved/);
});
