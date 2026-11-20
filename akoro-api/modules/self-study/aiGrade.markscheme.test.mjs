import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { readRoutesSource } from './routesSource.mjs';
import { readDraftSource } from './draftSource.mjs';
import { aiGradeSchema, buildAiGradeMessages, shapeAiGrade, schemePrompt, snapLevel, runAiGrade, openQuestions } from './aiGrade.js';
import { cleanMarkScheme } from './markScheme.js';

const paper = { questions: [
  { q: 'Which is the capital of France?', type: 'MCQ', max_points: 1, options: ['Paris', 'Rome'], correct: 0 },
  { q: 'Decode rw-r-----', type: 'Theory', max_points: 4, answer: '640' },
  { q: 'Why is ./ needed?', type: 'Theory', max_points: 2, answer: 'The current directory is not on PATH' },
] };
const mp = (points, extra = {}) => ({ looks_for: 'Does it say X?', model_answer: 'X', points, levels: [], full_marks_also_for: [], no_marks_for: [], ...extra });
const scheme = cleanMarkScheme({ criteria: [
  { question: 1, title: 'Octal decoding', description: 'Works out 640', marking_points: [mp(2, { full_marks_also_for: ['owner has read and write'], no_marks_for: ['User = 7'] }), mp(2)] },
  { question: 2, title: 'PATH', description: 'Explains ./', marking_points: [mp(2)] },
] }, paper);
const assignment = { title: 'Linux', subject: 'CS', details: { questions: paper.questions, mark_scheme: scheme } };
const [m1, m2] = scheme.criteria[0].marking_points;
const m3 = scheme.criteria[1].marking_points[0];
const answers = { 0: 'Paris', 1: 'User 6, group 4, others 0', 2: 'it is not in PATH' };

test('snapLevel: the nearest level the marking point can award, never above full marks', () => {
  assert.equal(snapLevel(2, m1), 2);
  assert.equal(snapLevel(1.4, m1), 1);
  assert.equal(snapLevel(99, m1), 2);
  assert.equal(snapLevel(-3, m1), 0);
  assert.equal(snapLevel('x', m1), null);
  assert.equal(snapLevel(undefined, m1), null);
  assert.equal(snapLevel(null, m1), null);
});

test('the prompt gives the model each marking point, its levels and what earns or loses marks', () => {
  const open = openQuestions(paper.questions, answers);
  const t = schemePrompt(scheme, open);
  assert.match(t, /Mark scheme for Q2:/); assert.match(t, /Mark scheme for Q3:/);
  assert.doesNotMatch(t, /Mark scheme for Q1:/);                       // the keyed MCQ is marked from the key
  assert.match(t, new RegExp(`\\[${m1.id}\\] \\(max 2\\) Looks for:`));
  assert.match(t, /Levels: 0 = .* \| 1 = .* \| 2 = /);
  assert.match(t, /Full marks also for: owner has read and write/);
  assert.match(t, /No marks for: User = 7/);
  assert.equal(schemePrompt(null, open), '');
  const sys = buildAiGradeMessages({ assignment, markdown: 'x', answers })[0].content;
  assert.match(sys, /The teacher's mark scheme is the rule/); assert.match(sys, /`awarded` is the sum of its marking-point levels/);
  const noScheme = buildAiGradeMessages({ assignment: { ...assignment, details: { questions: paper.questions } }, markdown: 'x', answers })[0].content;
  assert.doesNotMatch(noScheme, /mark scheme is the rule/);
});

test('the answer schema asks for the marking points\' levels', () => {
  const s = aiGradeSchema();
  assert.deepEqual(s.required, ['questions', 'rubric', 'marking', 'feedback']);
  assert.deepEqual(s.properties.marking.items.required, ['id', 'level', 'why']);
  assert.deepEqual(Object.keys(s.properties).sort(), ['feedback', 'marking', 'questions', 'rubric']);   // strict mode: every property is required
});

test('a question\'s mark is the sum of the levels picked; the keyed MCQ is still scored from the key', () => {
  const json = { questions: [{ index: 1, read: 'User 6, group 4, others 0', awarded: 99, why: 'Good.' }, { index: 2, read: 'not in PATH', awarded: 0, why: 'Right idea.' }],
    marking: [{ id: m1.id, level: 2, why: 'Gives 6, 4, 0' }, { id: m2.id, level: 1, why: 'Half of it' }, { id: m3.id, level: 2, why: 'Says not in PATH' }], rubric: [], feedback: 'Well done.' };
  const g = shapeAiGrade({ assignment, submission: { answers }, json });
  assert.deepEqual(g.questions.map((q) => [q.index, q.awarded, q.max, !!q.auto]), [[0, 1, 1, true], [1, 3, 4, false], [2, 2, 2, false]]);   // 99 from the model ignored: the scheme decides
  assert.equal(g.score, Math.round((6 / 7) * 100));
  assert.equal(g.marking.length, 2);
  const q1 = g.marking[0];
  assert.equal(q1.index, 1);
  assert.deepEqual(q1.criteria[0].points.map((p) => [p.id, p.awarded, p.max]), [[m1.id, 2, 2], [m2.id, 1, 2]]);
  assert.equal(q1.criteria[0].points[1].label.length > 0, true);
  assert.equal(q1.criteria[0].points[0].why, 'Gives 6, 4, 0');
  assert.equal(q1.unassessed, undefined);
});

test('a marking point the model skipped is marked down and flagged for the teacher, never invented', () => {
  const json = { questions: [{ index: 1, read: '', awarded: 4, why: 'x' }, { index: 2, read: '', awarded: 2, why: 'y' }], marking: [{ id: m1.id, level: 2, why: 'ok' }, { id: 'nonsense', level: 2, why: '?' }], rubric: [], feedback: '' };
  const g = shapeAiGrade({ assignment, submission: { answers }, json });
  const q1 = g.questions.find((q) => q.index === 1);
  assert.equal(q1.awarded, 2);                                         // only the one it assessed
  assert.match(q1.why, /weren't assessed/);
  assert.equal(g.marking[0].unassessed, 1);
  assert.equal(g.marking[0].criteria[0].points[1].why, 'Not assessed — check this one.');
  assert.equal(g.marking[1].unassessed, 1);                            // Q3's marking point was never mentioned
  // a level the scheme doesn't have is snapped to one it does
  const odd = shapeAiGrade({ assignment, submission: { answers }, json: { questions: [], marking: [{ id: m1.id, level: 1.7, why: '' }, { id: m2.id, level: 0, why: '' }, { id: m3.id, level: 2, why: '' }] } });
  assert.equal(odd.questions.find((q) => q.index === 1).awarded, 2);
});

test('without a mark scheme the grader works exactly as before', () => {
  const plain = { ...assignment, details: { questions: paper.questions } };
  const g = shapeAiGrade({ assignment: plain, submission: { answers }, json: { questions: [{ index: 1, awarded: 3, why: 'ok' }, { index: 2, awarded: 1, why: 'ok' }] } });
  assert.equal(g.marking, undefined);
  assert.deepEqual(g.questions.map((q) => q.awarded), [1, 3, 1]);
});

test('runAiGrade follows the scheme end to end', async () => {
  const saves = [];
  const chat = async (messages) => { assert.match(messages[0].content, /mark scheme is the rule/); return JSON.stringify({ questions: [], rubric: [], feedback: 'ok',
    marking: [{ id: m1.id, level: 2, why: 'a' }, { id: m2.id, level: 2, why: 'b' }, { id: m3.id, level: 0, why: 'c' }] }); };
  const draft = await runAiGrade('t1', { save: async (id, d) => saves.push(d), chat, load: async () => ({ assignment, submission: { answers }, markdown: 'm', images: [] }) });
  assert.deepEqual(draft.questions.map((q) => q.awarded), [1, 4, 0]);
  assert.equal(saves.at(-1).status, 'ready'); assert.ok(saves.at(-1).marking);
});

test('the rubric, settings and assign are wired through the draft flow', async () => {
  const drafts = await readDraftSource();
  const routes = await readRoutesSource();
  const versions = await readFile(new URL('./draftVersions.js', import.meta.url), 'utf8');
  assert.match(drafts, /export async function setAssignmentSettings/);
  assert.match(drafts, /if \(patch\.ai_auto_grade\)/);                                          // turning it on writes the rubric
  assert.match(drafts, /const gate = payload\.details\?\.ai_auto_grade \? assignGate\(v\) : null;/);   // assign needs a finished rubric
  assert.match(versions, /\.\.\.\(details\?\.ai_auto_grade && assignScheme\(v\) \? \{ mark_scheme: assignScheme\(v\) \} : \{\}\)/);
  assert.match(versions, /answer_format: cleanAnswerFormat\(details\?\.answer_format\)/);
  assert.match(versions, /await onReady\?\.\(n\)/);
  assert.match(routes, /router\.put\("\/drafts\/:id\/settings"/);
  assert.match(routes, /router\.post\("\/drafts\/:id\/versions\/:n\/rubric"/);
  assert.match(routes, /router\.put\("\/drafts\/:id\/versions\/:n\/rubric"/);
  assert.match(routes, /\{ \.\.\.v, rubric: rubricView\(v\) \}/);
});
