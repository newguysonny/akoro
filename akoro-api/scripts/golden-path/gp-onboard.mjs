import { call, login, check, score } from './golden.mjs';

console.log('\n═══ ONBOARDING PREFILL — a learner their teacher added ═══\n');

const mate = await login('mate', 'student', 'jss1.mate1@demo.akoro.app', 'Password123!');
const r = await call(mate, 'GET', '/api/profiles/onboarding-prefill');
const p = r.json?.data ?? {};

check('endpoint answers', r.status === 200);
check('picks the real class, not a catch-all', p.className === 'JSS1', p.className);
check('study level derived', p.studyLevel === 'Junior Secondary', p.studyLevel);
check('year matches the form\'s own option', p.yearGroup === 'JSS 1', p.yearGroup);
check('school derived', p.schoolName === 'Akoro Demo Academy', p.schoolName);
check('teacher derived', !!p.teacherId, p.teacherName);
check('subjects from the class', (p.subjects ?? []).length === 4, (p.subjects ?? []).join(', '));

// The form's dropdown only accepts values it lists.
const CLASSES_BY_LEVEL = {
  'Primary': ['Primary 1','Primary 2','Primary 3','Primary 4','Primary 5','Primary 6'],
  'Junior Secondary': ['JSS 1','JSS 2','JSS 3'],
  'Senior Secondary': ['SSS 1','SSS 2','SSS 3'],
};
check('year is selectable in the dropdown',
  (CLASSES_BY_LEVEL[p.studyLevel] ?? []).includes(p.yearGroup),
  `${p.yearGroup} in ${p.studyLevel}`);

console.log('\n· A learner in no class must be unaffected');
const priya = await login('priya2', 'student', 'stu.jss12@demo.akoro.app', 'Amara2026');
const r2 = await call(priya, 'GET', '/api/profiles/onboarding-prefill');
check('still answers for any learner', r2.status === 200, JSON.stringify(r2.json?.data).slice(0, 80));

const s = score();
console.log(`\nONBOARDING: ${s.pass} passed, ${s.fail} failed`);
