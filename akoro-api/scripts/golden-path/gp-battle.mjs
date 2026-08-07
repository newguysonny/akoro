import { call, login, check, score } from './golden.mjs';

console.log('\n═══ GOLDEN PATH 1 — BATTLE ═══\n');

console.log('· Learner creates a CLASS battle against classmates');
const priya = await login('priya', 'student', 'stu.jss11@demo.akoro.app', 'Priya2026');

const cls = await call(priya, 'GET', '/api/battle/my-classes');
check('GET /my-classes', cls.status === 200 && Array.isArray(cls.json?.data), `${cls.json?.data?.length ?? 0} class(es)`);
const jss1 = (cls.json?.data ?? [])[0];
check('class carries subjects', !!jss1?.subjects?.length, jss1?.subjects?.join(', '));

const roster = await call(priya, 'GET', `/api/battle/classes/${jss1.id}/roster`);
const mates = roster.json?.data ?? [];
check('GET class roster', roster.status === 200 && mates.length > 0, `${mates.length} classmates`);
check('classmates have agents', mates.every(m => m.has_agent), `${mates.filter(m => m.has_agent).length}/${mates.length}`);

const duel = await call(priya, 'POST', `/api/battle/classes/${jss1.id}/battles/invite`, {
  title: 'Golden path duel', subject: 'Mathematics', difficulty: 'intermediate',
  total_questions: 10, xp_prize: 200, question_source: 'bank',
  usernames: ['jss1_mate1'],   // a KNOWN opponent, so the next step can log in as them
});
check('create 1v1 from the bank', duel.status === 201, duel.status !== 201 ? JSON.stringify(duel.json).slice(0,160) : `${duel.json.data.questions} questions, type=${duel.json.data.battle_type}`);
const duelId = duel.json?.data?.battle_id;
check('one opponent => 1v1', duel.json?.data?.battle_type === '1v1');

console.log('\n· Questions must not be readable before it starts');
const peek = await call(priya, 'GET', `/api/battle/battles/${duelId}/questions`);
check('lobby hides question text', peek.status === 200 && peek.json.questions.length === 0 && peek.json.notStarted === true,
  `returned ${peek.json?.questions?.length} questions, total=${peek.json?.total}`);

console.log('\n· The challenged classmate sees it');
const mate = await login('mate', 'student', 'jss1.mate1@demo.akoro.app', 'Password123!');
const mine = await call(mate, 'GET', '/api/battle/my-challenges');
const found = (mine.json?.data ?? []).some(c => c.id === duelId);
check('opponent sees the challenge', found, `${mine.json?.data?.length ?? 0} pending`);

console.log('\n· Whole-class battle');
const group = await call(priya, 'POST', `/api/battle/classes/${jss1.id}/battles/invite`, {
  title: 'Golden path class battle', subject: 'English Language',
  total_questions: 10, question_source: 'bank', whole_class: true,
});
check('create whole-class battle', group.status === 201,
  group.status !== 201 ? JSON.stringify(group.json).slice(0,160) : `invited ${group.json.data.invited}, ${group.json.data.questions} questions, type=${group.json.data.battle_type}`);
check('many opponents => classroom', group.json?.data?.battle_type === 'classroom');

console.log('\n· Bank-only on a thin subject must refuse, not half-fill');
const thin = await call(priya, 'POST', `/api/battle/classes/${jss1.id}/battles/invite`, {
  title: 'Should refuse', subject: 'Civic Education',
  total_questions: 10, question_source: 'bank', user_ids: [mates[0].id],
});
check('thin subject refused with a reason', thin.status === 400 && /questions/i.test(thin.json?.error ?? ''), thin.json?.error?.slice(0,110));

console.log('\n· Teacher creates a class battle');
const teacher = await login('teacher', 'instructor', 'teacher1@demo.akoro.app', 'Amara2026');
const tCls = await call(teacher, 'GET', '/api/battle/my-classes');
check('teacher sees classes they run', tCls.status === 200 && (tCls.json?.data ?? []).length > 0, `${tCls.json?.data?.length ?? 0}`);
const tRoom = (tCls.json?.data ?? []).find(c => c.name === 'JSS1') ?? (tCls.json?.data ?? [])[0];
const tBattle = tRoom ? await call(teacher, 'POST', `/api/battle/classes/${tRoom.id}/battles/invite`, {
  title: 'Teacher class battle', subject: 'Mathematics', total_questions: 8,
  question_source: 'bank', whole_class: true,
}) : { status: 0, json: {} };
check('teacher creates class battle', tBattle.status === 201,
  tBattle.status !== 201 ? JSON.stringify(tBattle.json).slice(0,160) : `invited ${tBattle.json.data.invited}`);
check('teacher single-pick is never a duel', tBattle.json?.data?.battle_type === 'classroom');

const s = score();
console.log(`\nBATTLE: ${s.pass} passed, ${s.fail} failed`);
