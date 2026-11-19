// gp-chat-battle.mjs — creating battles the way a teacher asks for them in chat.
//
// The task tool posts to the same invite endpoints the Battles form uses, so
// every rule change to those endpoints lands on the chat path too — silently,
// because the tool's own schema and the intent router are separate code that
// nobody updates at the same time.
//
// Three things were wrong after the battle changes:
//   · naming learners ALWAYS routed to a course, so "a battle for Priya and Ada
//     in JSS1" demanded a course and listed twelve of them back at the teacher
//   · one named learner hit the endpoint's new two-learner rule, and the tool
//     still described that case as producing a 1-v-1
//   · study reviews did not exist in the tool at all, and "review Priya on
//     fractions" routed to generate_quiz — whose tool set has no assign_battle

import db from '../../db.js';
import { executeAssignBattle } from '../../modules/tasks/index.js';
import { extractIntent } from '../../modules/tasks/index.js';
import { TaskDB, TaskRunDB } from '../../modules/tasks/index.js';

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓ ' : '✗ FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

const { data: teacher } = await db.from('users').select('id').eq('email','teacher1@demo.akoro.app').single();
const { data: mates }   = await db.from('users').select('id,username').like('username','jss1_mate%').limit(3);
const { data: tAgent }  = await db.from('user_agents').select('id').eq('user_id', teacher.id).single();

// A real task + run, because the tool writes an artifact against them.
// TaskDB.create takes raw COLUMN names, not camelCase — it inserts what it is
// given straight into the table.
const task = await TaskDB.create({
  creator_id: teacher.id, agent_id: tAgent.id, title: 'chat battle probe', description: 'probe',
  task_type: 'create_battle', status: 'running', payload: {},
});
const run = await TaskRunDB.create({ taskId: task.id, runNumber: 1, status: 'running' });
const ctx = { teacherId: teacher.id, runId: run.id, taskId: task.id, courseId: null };

console.log('\n═══ BATTLES FROM CHAT ═══');

console.log('\n· What a teacher types routes to the right tool set');
for (const [text, expect] of [
  ['Create a battle for JSS1',                'create_battle'],
  ['Set a study review for jss1_mate1',       'create_battle'],
  ['Review Priya on fractions',               'create_battle'],
  ['Grade and review student work',           'grade_submissions'],
  ['Make a quiz on fractions',                'generate_quiz'],
]) {
  const r = await extractIntent(text, '', 'instructor');
  check(`"${text}"`, r.taskType === expect, `→ ${r.taskType}`);
}

console.log('\n· Naming learners in a CLASS no longer demands a course');
const two = await executeAssignBattle({
  title: 'Chat — two named', audience: 'learners', className: 'JSS1', subject: 'Mathematics',
  usernames: [mates[0].username, mates[1].username], totalQuestions: 8, questionSource: 'bank',
}, ctx);
check('two named learners in a class', two.success === true,
  two.success ? `invited ${two.invited}` : two.error);

console.log('\n· One named learner is refused, and points at the review');
const one = await executeAssignBattle({
  title: 'Chat — one named', audience: 'learners', className: 'JSS1', subject: 'Mathematics',
  usernames: [mates[0].username], totalQuestions: 8, questionSource: 'bank',
}, ctx);
check('refused with something the teacher can act on',
  one.success === false && /study review/i.test(one.error ?? ''), one.error);

console.log('\n· A study review can be created from chat');
const rev = await executeAssignBattle({
  title: 'Chat — review', audience: 'review', className: 'JSS1', subject: 'Mathematics',
  usernames: [mates[0].username], totalQuestions: 8, questionSource: 'bank',
}, ctx);
check('review created', rev.success === true, rev.success ? `battle ${rev.battleId}` : rev.error);
if (rev.battleId) {
  const { data: b } = await db.from('battles').select('battle_type').eq('id', rev.battleId).single();
  check('and it really is a review', b?.battle_type === 'review', `battle_type=${b?.battle_type}`);
}

console.log('\n· A review needs exactly one learner');
const revTwo = await executeAssignBattle({
  title: 'Chat — review of two', audience: 'review', className: 'JSS1', subject: 'Mathematics',
  usernames: [mates[0].username, mates[1].username], totalQuestions: 8, questionSource: 'bank',
}, ctx);
check('two is refused', revTwo.success === false && /one learner/i.test(revTwo.error ?? ''), revTwo.error);

console.log('\n· Whole class still works');
const whole = await executeAssignBattle({
  title: 'Chat — whole class', audience: 'class', className: 'JSS1', subject: 'Mathematics',
  totalQuestions: 8, questionSource: 'bank',
}, ctx);
check('whole class', whole.success === true, whole.success ? `invited ${whole.invited}` : whole.error);

console.log('\n· What is MANDATORY is refused clearly, not passed downstream');
// The endpoints require: title, a target, and — for anything class-based — a
// subject, because the past-questions bank is searched by subject and there is
// nothing to draw from without it.
const noSubject = await executeAssignBattle({
  title: 'Chat — no subject', audience: 'class', className: 'JSS1',
  totalQuestions: 8, questionSource: 'bank',
}, ctx);
check('a class battle without a subject says which field is missing',
  noSubject.success === false && /which subject/i.test(noSubject.error ?? ''), noSubject.error);

const noClass = await executeAssignBattle({
  title: 'Chat — no class', audience: 'class', subject: 'Mathematics',
  totalQuestions: 8, questionSource: 'bank',
}, ctx);
check('and a class battle without a class does too',
  noClass.success === false && /which class/i.test(noClass.error ?? ''), noClass.error);

console.log('\n· What is OPTIONAL really does default');
// Only the mandatory fields — everything else should fill itself in.
const bare = await executeAssignBattle({
  title: 'Chat — defaults only', audience: 'class', className: 'JSS1', subject: 'Mathematics',
}, ctx);
check('a battle with only the required fields is created', bare.success === true,
  bare.success ? `invited ${bare.invited}` : bare.error);
if (bare.battleId) {
  const { data: b } = await db.from('battles')
    .select('total_questions, time_limit_seconds, xp_prize, difficulty').eq('id', bare.battleId).single();
  check('and it carries the documented defaults',
    b?.difficulty === 'intermediate' && b?.xp_prize === 200 && b?.time_limit_seconds === 15 * 60,
    JSON.stringify(b));
}

console.log(`\nCHAT BATTLES: ${pass} passed, ${fail} failed`);
process.exit(0);
