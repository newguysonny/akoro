// gp-revisions.mjs — a battle leaves ONE revision, at the end.
//
// The bug this locks down: the review notification was written from inside the
// per-answer confidence update. That runs once per QUESTION, so a fifteen-
// question battle whose questions each carried their own topic produced up to
// fifteen revision cards, appearing one at a time while the learner was still
// playing. Every one of them read "-10% (was 70%)" — the -0.10 was the
// "encountered but struggled" sentinel being shown as a percentage, and the 70%
// was the alerts endpoint defaulting prev_confidence because nothing ever set
// it. Three defects, one line of code.
//
// It is checked from the outside — count the rows a whole battle leaves —
// because that is the thing the learner sees. Asserting that a function is
// called from a different place would pass whether or not the count changed.

import { call, login, check, score } from './golden.mjs';
import pg from 'pg';

const sql = new pg.Client({ host: 'localhost', port: 5433, user: 'postgres', database: 'akoro' });
await sql.connect();

console.log('\n═══ REVISIONS FROM A BATTLE ═══\n');

const teacher = await login('teacher', 'instructor', 'teacher1@demo.akoro.app', 'Amara2026');

const cls  = await call(teacher, 'GET', '/api/battle/my-classes');
const jss1 = (cls.json?.data ?? []).find(c => c.name === 'JSS1');
check('teacher has a class', !!jss1, jss1?.name);

const roster = await call(teacher, 'GET', `/api/battle/classes/${jss1.id}/roster`);
const mates  = (roster.json?.data ?? []).filter(m => m.has_agent && /^jss1_mate\d+$/.test(m.username ?? ''));
check('roster has learners with agents', mates.length >= 2, `${mates.length} eligible`);
const [a, b] = mates;

// Clean slate, so the count at the end is this battle's doing and nobody else's.
await sql.query('DELETE FROM edu.decay_notifications WHERE student_id = ANY($1)', [[a.id, b.id]]);
// The knowledge model hangs off edu.student_agents, which the demo seeds do not
// create — without a row here every confidence write and every revision is a
// silent no-op, and this suite would pass by doing nothing at all.
for (const id of [a.id, b.id]) {
  await sql.query(
    `INSERT INTO edu.student_agents (student_id, name) VALUES ($1, 'Probe Agent')
     ON CONFLICT (student_id) DO NOTHING`, [id]);
}

console.log('· A battle whose questions each carry their own sub-topic');
const made = await call(teacher, 'POST', `/api/battle/classes/${jss1.id}/battles/invite`, {
  title: 'Family', subject: 'Social Studies', topic: 'Family',
  total_questions: 6, question_source: 'bank',
  user_ids: [a.id, b.id],
});
check('battle created', made.status === 201,
  made.status !== 201 ? JSON.stringify(made.json).slice(0, 200) : `invited ${made.json.data.invited}`);
const battleId = made.json?.data?.battle_id;

// Give every question a DIFFERENT topic — the exact shape that produced the
// screenshot: six questions, six sub-topics, six cards.
const SUBTOPICS = ['Family Roles', 'Family Structures', 'Family Dynamics',
                   'Family Benefits', 'Family Responsibilities', 'Family Types'];
const { rows: qs } = await sql.query(
  'SELECT id, question_order FROM battle_questions WHERE battle_id = $1 ORDER BY question_order', [battleId]);
check('the battle has questions', qs.length > 0, `${qs.length} questions`);
for (const [i, q] of qs.entries()) {
  await sql.query('UPDATE battle_questions SET topic = $1, subject = $2 WHERE id = $3',
    [SUBTOPICS[i % SUBTOPICS.length], 'Social Studies', q.id]);
}
// The battle's own topic is what the card gets titled with.
await sql.query("UPDATE battles SET topic = 'Family' WHERE id = $1", [battleId]);

console.log('\n· While it is being played, nothing is raised');
const learner = await login('learner', 'student', `${a.username.replace(/_/g, '.')}@demo.akoro.app`, 'Password123!');
const accepted = await call(learner, 'POST', `/api/battle/challenges/${battleId}/accept`, {});
check('the invited learner accepts', accepted.status === 200 || accepted.status === 201, `status=${accepted.status}`);

// Simulate the battle being played: answers land, and the per-answer confidence
// update runs. This is the window in which the cards used to appear.
const { rows: seats } = await sql.query(
  'SELECT id, user_id FROM battle_participants WHERE battle_id = $1', [battleId]);
const mySeat = seats.find(s => s.user_id === a.id);
for (const [i, q] of qs.entries()) {
  await sql.query(
    `INSERT INTO battle_answers (battle_id, question_id, participant_id, selected_index, is_correct, response_time_ms)
     VALUES ($1, $2, $3, 0, $4, 4000)`,
    [battleId, q.id, mySeat.id, i >= 4]);   // wrong on the first four, right on the last two
}

const { rows: during } = await sql.query(
  'SELECT count(*)::int n FROM edu.decay_notifications WHERE student_id = $1', [a.id]);
check('no revision card appears mid-battle', during[0].n === 0, `${during[0].n} cards`);

console.log('\n· When it ends, exactly one revision is raised');
const { flagBattleReviewTopics } = await import('../../modules/battle/knowledge.js');
await flagBattleReviewTopics(battleId);

const { rows: after } = await sql.query(
  `SELECT topic, subtopic, confidence, prev_confidence, misconceptions, message, priority
   FROM edu.decay_notifications WHERE student_id = $1`, [a.id]);

// The heart of it: six wrong-ish questions across six sub-topics, one card.
check('one card, not one per question', after.length === 1, `${after.length} cards for ${qs.length} questions`);
check('titled with what the battle was about', after[0]?.topic === 'Family', `topic=${after[0]?.topic}`);

// The sub-topics are not lost — they are what makes the card actionable.
const weak = after[0]?.misconceptions ?? [];
check('and names the sub-topics that were weak',
  weak.length === 4 && weak.every(w => SUBTOPICS.slice(0, 4).includes(w)),
  weak.join(', '));
check('but not the ones answered correctly',
  !weak.includes('Family Responsibilities') && !weak.includes('Family Types'),
  weak.join(', '));

// The numbers on the card have to be true. "-10% (was 70%)" was neither.
const conf = Number(after[0]?.confidence);
const prev = Number(after[0]?.prev_confidence);
check('confidence is a real value, not the -0.10 sentinel', conf >= 0 && conf <= 1, `confidence=${conf}`);
check('prev_confidence is recorded, so "was x%" is not invented',
  Number.isFinite(prev) && prev >= conf, `${prev} → ${conf}`);
check('the message says what to look at', /Family Roles/.test(after[0]?.message ?? ''), after[0]?.message ?? '');

console.log('\n· A second battle on the same topic does not stack another card');
await flagBattleReviewTopics(battleId);
const { rows: again } = await sql.query(
  'SELECT count(*)::int n FROM edu.decay_notifications WHERE student_id = $1', [a.id]);
check('still one outstanding card', again[0].n === 1, `${again[0].n} cards`);

console.log('\n· A learner who did well gets no homework');
await sql.query('UPDATE battle_answers SET is_correct = true WHERE battle_id = $1', [battleId]);
await sql.query('DELETE FROM edu.decay_notifications WHERE student_id = $1', [a.id]);
await flagBattleReviewTopics(battleId);
const { rows: clean } = await sql.query(
  'SELECT count(*)::int n FROM edu.decay_notifications WHERE student_id = $1', [a.id]);
check('nothing raised for a clean sweep', clean[0].n === 0, `${clean[0].n} cards`);

await sql.query('DELETE FROM edu.decay_notifications WHERE student_id = ANY($1)', [[a.id, b.id]]);
await sql.end();
score();
process.exit(0);
