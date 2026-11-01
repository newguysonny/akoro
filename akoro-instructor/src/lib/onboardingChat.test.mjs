import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STEP_IDS, SUBJECT_OPTIONS, GUIDE_ICONS, emptyAnswers, answerText, stepError, missingRequired, progressOf, profilePayload,
  filterSchools, subjectsLabel, subjectsDraft, firstName, callName, initials,
} from './onboardingChat.js';

test('Ako calls an instructor by name, and a title is not a first name', () => {
  assert.equal(callName('Amara Osei'), 'Amara');
  assert.equal(callName(' Dr. Amara Osei '), 'Dr. Osei');
  assert.equal(callName('Prof Ade Bello'), 'Prof Bello');
  assert.equal(callName('Mrs. Okafor'), 'Mrs. Okafor');
  assert.equal(callName('Dr.'), 'Dr.');            // a lone title: nothing better to say
  assert.equal(callName('Chief Adeyemi Bello'), 'Chief Bello');
  assert.equal(callName(''), 'there');
});

test('five steps, and the bar follows them', () => {
  assert.deepEqual(STEP_IDS, ['name', 'school', 'subjects', 'guide', 'done']);
  assert.deepEqual(progressOf(0), { pct: 20, done: false, number: 1 });
  assert.deepEqual(progressOf(4), { pct: 100, done: true, number: 5 });
  assert.equal(progressOf(99).pct, 100); assert.equal(progressOf(-1).number, 1);
});

test('name, a school (when any exist) and one subject are required; the guide name is not', () => {
  const a = emptyAnswers();
  assert.equal(stepError('name', a), 'Please enter your name');
  assert.equal(stepError('school', a), 'Please choose your school');
  assert.equal(stepError('school', a, { schoolsAvailable: false }), null);   // nothing to choose from yet
  assert.equal(stepError('subjects', a), 'Pick at least one subject you teach');
  assert.equal(stepError('guide', a), null);
  assert.deepEqual(missingRequired(a).map(([id]) => id), ['name', 'school', 'subjects']);
  assert.deepEqual(missingRequired(a, { schoolsAvailable: false }).map(([id]) => id), ['name', 'subjects']);
  const done = { ...a, name: ' Dr. Osei ', schoolId: 's1', schoolName: 'Crestview', subjects: ['Physics'] };
  assert.deepEqual(missingRequired(done), []);
});

test('the saved body is the one the form sent', () => {
  const a = { ...emptyAnswers(' Dr. Osei '), schoolId: 's1', schoolName: 'Crestview High School', subjects: ['Physics', 'Chemistry'], guideName: ' NaNa ', guideEmoji: '🦉' };
  assert.deepEqual(profilePayload(a), { fullName: 'Dr. Osei', schoolName: 'Crestview High School', subjects: ['Physics', 'Chemistry'], teachingGuide: 'NaNa', guideEmoji: '🦉', onboardingCompleted: true });
  const bare = profilePayload({ ...emptyAnswers('A'), subjects: ['Biology'] });
  assert.equal(bare.schoolName, undefined); assert.equal(bare.teachingGuide, undefined); assert.equal(bare.guideEmoji, '🧠');
});

test('reply bubbles read like what the instructor said', () => {
  const a = { ...emptyAnswers(' Dr. Osei '), schoolName: 'Crestview', subjects: ['A', 'B', 'C', 'D', 'E'], guideName: '' };
  assert.equal(answerText('name', a), 'Dr. Osei');
  assert.equal(answerText('school', a), 'Crestview');
  assert.equal(answerText('subjects', a), 'A, B, C +2 more');
  assert.equal(answerText('guide', a), "I'll name it later");
  assert.equal(answerText('guide', { ...a, guideName: ' NaNa ' }), 'NaNa');
  assert.equal(subjectsLabel([]), ''); assert.equal(subjectsDraft([]), ''); assert.equal(subjectsDraft(['A', 'B']), '2 subjects picked');
});

test('school search matches name and address, every word, and is empty until they type', () => {
  const schools = [{ id: 1, name: 'Crestview High School', address: 'Ikeja, Lagos' }, { id: 2, name: 'Kingsway College', address: 'Wuse, Abuja' }];
  assert.deepEqual(filterSchools(schools, ''), []);
  assert.deepEqual(filterSchools(schools, 'crest').map((s) => s.id), [1]);
  assert.deepEqual(filterSchools(schools, 'abuja college').map((s) => s.id), [2]);
  assert.deepEqual(filterSchools(schools, 'lagos kingsway'), []);
});

test('nothing the old form offered is gone, and the guide icons keep their stored keys', () => {
  for (const s of ['Mathematics', 'Further Mathematics', 'Physics', 'Chemistry', 'Biology', 'Computer Science', 'English Language', 'English Literature', 'Economics', 'Geography', 'History']) assert.ok(SUBJECT_OPTIONS.includes(s), s);
  assert.equal(new Set(SUBJECT_OPTIONS).size, SUBJECT_OPTIONS.length);
  assert.deepEqual(GUIDE_ICONS.map(([em]) => em), ['🧠', '👩‍🏫', '👨‍🏫', '🎓', '📚', '💡', '🦉', '⚡', '🌟', '🔮', '🚀', '🎯']);
  assert.equal(firstName(' Amara Osei '), 'Amara'); assert.equal(initials('Dr. Amara Osei'), 'AO');
});
