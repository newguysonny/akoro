import { login, score } from './golden.mjs';
import { taskPath } from './gp-task.mjs';
import { selfStudyPath } from './gp-selfstudy.mjs';

const teacher = await login('teacher', 'instructor', 'teacher1@demo.akoro.app', 'Amara2026');
const priya   = await login('priya', 'student', 'stu.jss11@demo.akoro.app', 'Priya2026');

await taskPath(teacher);
await selfStudyPath(teacher, priya);

const s = score();
console.log(`\nTASK + SELF STUDY: ${s.pass} passed, ${s.fail} failed`);
