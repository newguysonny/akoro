import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STEP_IDS, STEP_COUNT, classesFor, emptyAnswers, answerText, stepError, progressOf, profilePayload, agentPayload,
  applyPrefill, filterTeachers, filterSchools, missingRequired, subjectsLabel, subjectsDraft, subjectChoices, firstName, initials, GUIDE_EMOJIS,
} from './onboardingChat.js';

test('nine steps, in the order the conversation asks them', () => {
  assert.deepEqual(STEP_IDS, ['welcome', 'name', 'level', 'school', 'subjects', 'agent', 'teacher', 'prefs', 'done']);
  assert.equal(STEP_COUNT, 9);
  assert.deepEqual(progressOf(0), { pct: 11, done: false, number: 1 });
  assert.deepEqual(progressOf(8), { pct: 100, done: true, number: 9 });
  assert.equal(progressOf(99).pct, 100);
  assert.equal(progressOf(-3).number, 1);
});

test('classes follow the study level, and an adult learner has none', () => {
  assert.deepEqual(classesFor('Junior Secondary'), ['JSS 1', 'JSS 2', 'JSS 3']);
  assert.deepEqual(classesFor('Adult learner'), []);
  assert.deepEqual(classesFor('nonsense'), []);
});

test('a step cannot be sent until its required answer is there', () => {
  const a = emptyAnswers();
  assert.equal(stepError('welcome', a), 'onboarding.chat_err_terms');
  assert.equal(stepError('name', a), 'onboarding.err_name');
  assert.equal(stepError('level', a), 'onboarding.err_level');
  assert.equal(stepError('agent', a), 'onboarding.err_agent');
  assert.equal(stepError('school', a), null);      // optional
  assert.equal(stepError('subjects', a), null);    // optional
  assert.equal(stepError('teacher', a), 'onboarding.err_teacher');              // a teacher is required…
  assert.equal(stepError('teacher', a, { teachersAvailable: false }), null);    // …unless there is no one to choose yet
  Object.assign(a, { agreed: true, name: ' Amara ', level: 'Junior Secondary', agentName: 'Brainy', teacherId: 't1' });
  for (const id of ['welcome', 'name', 'level', 'agent', 'teacher']) assert.equal(stepError(id, a), null);
});

test('reply bubbles read like what the learner said', () => {
  const a = { ...emptyAnswers(), name: ' Amara Johnson ', level: 'Junior Secondary', cls: 'JSS 2', school: '', subjects: ['Mathematics', 'English Language', 'Basic Science', 'Biology', 'Civic Education'], agentName: ' Brainy ', teacherName: 'Mrs. S. Adebayo' };
  assert.equal(answerText('name', a), 'Amara Johnson');
  assert.equal(answerText('level', a), 'Junior Secondary · JSS 2');
  assert.equal(answerText('level', { ...a, cls: '' }), 'Junior Secondary');
  assert.equal(answerText('school', a), 'I learn on my own');
  assert.equal(answerText('school', { ...a, school: 'Crestview High School' }), 'Crestview High School');
  assert.equal(answerText('subjects', a), 'Mathematics, English Language, Basic Science +2 more');
  assert.equal(answerText('agent', a), 'Brainy');
  assert.equal(answerText('teacher', a), 'Mrs. S. Adebayo');
  assert.equal(answerText('prefs', a, { language: 'English', theme: 'Light', accent: 'Purple' }), 'English · Light · Purple');
  assert.equal(subjectsLabel([]), "I'll pick subjects later");
  assert.equal(subjectsLabel(['Biology']), 'Biology');
  assert.equal(subjectsDraft(['A']), '1 subject picked');
  assert.equal(subjectsDraft(['A', 'B']), '2 subjects picked');
  assert.equal(subjectsDraft([]), '');
});

test('required answers are checked again before saving; optional ones never block', () => {
  const none = missingRequired(emptyAnswers());
  assert.deepEqual(none.map(([id]) => id), ['welcome', 'name', 'level', 'agent', 'teacher']);
  assert.deepEqual(missingRequired(emptyAnswers(), { teachersAvailable: false }).map(([id]) => id), ['welcome', 'name', 'level', 'agent']);
  const done = { ...emptyAnswers(), agreed: true, name: 'A', level: 'Primary', agentName: 'B', teacherId: 't' };   // no class, school or subjects
  assert.deepEqual(missingRequired(done), []);
});

test('the saved bodies are the ones the form sent', () => {
  const a = { ...emptyAnswers(), name: ' Amara ', level: 'Junior Secondary', cls: ' JSS 2 ', school: ' ', subjects: ['Biology'], agentName: ' Brainy ', agentEmoji: '🦉' };
  assert.deepEqual(profilePayload(a, { language: 'English', displayMode: 'light', accentColor: '#6C3BFF' }), {
    fullName: 'Amara', yearGroup: 'JSS 2', studyLevel: 'Junior Secondary', schoolName: undefined, subjects: ['Biology'],
    language: 'English', displayMode: 'light', accentColor: '#6C3BFF', onboardingCompleted: true,
  });
  assert.deepEqual(agentPayload(a, 'amara'), { agent_name: 'Brainy', agent_emoji: '🦉', study_level: 'Junior Secondary', year_group: 'JSS 2', subjects: ['Biology'] });
  assert.equal(agentPayload({ ...a, agentName: ' ' }, 'amara').agent_name, 'Agent_amara');
  assert.equal(agentPayload({ ...a, subjects: [] }).subjects, undefined);
});

test('what a teacher put on file fills the blanks and never overwrites the learner', () => {
  const p = { className: 'JSS 2 Gold', studyLevel: 'Junior Secondary', yearGroup: 'JSS 2', schoolName: 'Crestview', teacherId: 't1', teacherName: 'Mrs. Adebayo', subjects: ['Basic Science', 'Quantum Cooking'] };
  const filled = applyPrefill(emptyAnswers(), p);
  assert.equal(filled.level, 'Junior Secondary'); assert.equal(filled.cls, 'JSS 2'); assert.equal(filled.school, 'Crestview');
  assert.equal(filled.teacherId, 't1'); assert.equal(filled.teacherName, 'Mrs. Adebayo');
  assert.deepEqual(filled.subjects, ['Basic Science', 'Quantum Cooking']);   // a subject we don't carry is kept
  const typed = applyPrefill({ ...emptyAnswers(), school: 'My School', subjects: ['Biology'] }, p);
  assert.equal(typed.school, 'My School'); assert.deepEqual(typed.subjects, ['Biology']);
  assert.deepEqual(applyPrefill(emptyAnswers(), null), emptyAnswers());
  assert.deepEqual(applyPrefill(emptyAnswers(), { subjects: ['x'] }), emptyAnswers());   // no class on file → nothing to trust
  assert.deepEqual(subjectChoices(['Quantum Cooking']).slice(0, 2), ['Quantum Cooking', 'Mathematics']);
  assert.equal(new Set(subjectChoices(['Mathematics'])).size, subjectChoices(['Mathematics']).length);
  // a senior learner sees the sciences up front; a junior keeps the junior cores first; nothing is lost either way
  assert.deepEqual(subjectChoices([], 'Senior Secondary').slice(0, 5), ['Mathematics', 'English Language', 'Physics', 'Chemistry', 'Biology']);
  assert.deepEqual(subjectChoices([], 'Junior Secondary').slice(0, 3), ['Mathematics', 'English Language', 'Basic Science']);
  assert.equal(subjectChoices([], 'Senior Secondary').length, subjectChoices([], 'Junior Secondary').length);
});

test('teacher search matches name, school, class and subjects, every word', () => {
  const ts = [
    { id: 1, full_name: 'Mrs. S. Adebayo', username: 'sadebayo', school_name: 'Crestview High School', class_name: 'JSS 2', subjects: ['Biology', 'Basic Science'] },
    { id: 2, full_name: 'Mr. E. Okafor', username: 'eokafor', school_name: 'Kingsway College', subjects: ['Mathematics'] },
  ];
  assert.equal(filterTeachers(ts, '').length, 2);
  assert.deepEqual(filterTeachers(ts, 'crestview biology').map((t) => t.id), [1]);
  assert.deepEqual(filterTeachers(ts, 'MATHS').map((t) => t.id), []);
  assert.deepEqual(filterTeachers(ts, 'kingsway math').map((t) => t.id), [2]);
});

test('school search matches name and address, every word, and is empty until the learner types', () => {
  const schools = [{ id: 1, name: 'Crestview High School', address: 'Ikeja, Lagos' }, { id: 2, name: 'Kingsway College', address: 'Wuse, Abuja' }];
  assert.deepEqual(filterSchools(schools, ''), []);
  assert.deepEqual(filterSchools(schools, 'crest').map((s) => s.id), [1]);
  assert.deepEqual(filterSchools(schools, 'abuja college').map((s) => s.id), [2]);
  assert.deepEqual(filterSchools(schools, 'lagos kingsway'), []);
});

test('small helpers', () => {
  assert.equal(firstName('  Amara Johnson '), 'Amara'); assert.equal(firstName(''), 'there');
  assert.equal(initials('Mrs. S. Adebayo'), 'SA'); assert.equal(initials(''), '?');
  assert.equal(GUIDE_EMOJIS.length, 12);
});
