import { call, login, check, score } from './golden.mjs';

console.log('\n═══ MY STUDENTS — class members, not just enrolments ═══\n');
const teacher = await login('t', 'instructor', 'teacher1@demo.akoro.app', 'Amara2026');

const r = await call(teacher, 'GET', '/api/instructor/students');
const rows = r.json?.data ?? [];
check('endpoint answers', r.status === 200);
check('class members are listed', rows.length > 2, `${rows.length} learners (course enrolments alone gave 2)`);
check('the teacher is not their own student', !rows.some(x => x.email === 'teacher1@demo.akoro.app'));
check('only learners, no service accounts as staff', rows.every(x => x.email !== 'teacher1@demo.akoro.app'));
check('each carries its class', rows.filter(x => x.classes?.length).length > 0,
  `${rows.filter(x => x.classes?.length).length} with a class`);

const multi = rows.find(x => (x.classes?.length ?? 0) > 1);
check('a learner in several classes shows all of them', !!multi,
  multi ? multi.classes.map(c => c.name).join(' + ') : 'none in this data');

const jss1 = rows.filter(x => x.classes?.some(c => c.name === 'JSS1'));
check('JSS1 cohort is visible', jss1.length >= 18, `${jss1.length} in JSS1`);

const s = score();
console.log(`\nMY STUDENTS: ${s.pass} passed, ${s.fail} failed`);
