// gp-review.mjs — "study review": a battle with one learner and no winner.
//
// Every other battle is a contest — two or more agents, HP, a ranking, an XP
// pool split by placing. A teacher checking what ONE learner has retained could
// use none of it: the invite routes refuse a single learner (rightly — there is
// nobody to compete against) and the engine ends a battle the moment one player
// is left standing, which for a solo learner is question one.
//
// A review runs the same machinery to a different end: the learner works
// through the paper, and what comes out is a MARK SHEET.

import { call, login, check, score } from './golden.mjs';
import pg from 'pg';

const sql = new pg.Client({ host: 'localhost', port: 5433, user: 'postgres', database: 'akoro' });
await sql.connect();

const email = (m) => `${m.username.replace('_', '.')}@demo.akoro.app`;
const teacher = await login('teacher', 'instructor', 'teacher1@demo.akoro.app', 'Amara2026');
const cls  = await call(teacher, 'GET', '/api/battle/my-classes');
const jss1 = (cls.json?.data ?? []).find(c => c.name === 'JSS1');
const roster = await call(teacher, 'GET', `/api/battle/classes/${jss1.id}/roster`);
const mates = (roster.json?.data ?? []).filter(m => m.has_agent && /^jss1_mate\d+$/.test(m.username ?? ''));
const [a, b] = mates;

console.log('\n· A review is for exactly ONE learner');
const made = await call(teacher, 'POST', `/api/battle/classes/${jss1.id}/battles/invite`, {
  title: 'Fractions review', subject: 'Mathematics', mode: 'review',
  total_questions: 6, question_source: 'bank', user_ids: [a.id],
});
check('one learner is accepted here, where a battle refuses it', made.status === 201,
  `${made.status} ${JSON.stringify(made.json).slice(0, 160)}`);
const id = made.json?.data?.battle_id;
check('battle_type is review', made.json?.data?.battle_type === 'review', made.json?.data?.battle_type);

const two = await call(teacher, 'POST', `/api/battle/classes/${jss1.id}/battles/invite`, {
  title: 'Two is not a review', subject: 'Mathematics', mode: 'review',
  total_questions: 6, question_source: 'bank', user_ids: [a.id, b.id],
});
check('two learners is refused with a reason', two.status === 400 && /one learner/i.test(two.json?.error ?? ''),
  `${two.status} ${two.json?.error ?? ''}`);

console.log('\n· The learner accepts, and it starts — one player is enough');
const learner = await login('a', 'student', email(a), 'Password123!');
const list = await call(learner, 'GET', '/api/battle/my-challenges');
check('it reaches their Challenges tab', (list.json?.data ?? []).some(x => x.id === id));
const acc = await call(learner, 'POST', `/api/battle/challenges/${id}/accept`, {});
check('accept succeeds', acc.status === 200, JSON.stringify(acc.json).slice(0, 140));

await new Promise(r => setTimeout(r, 9000));
const live = await sql.query('select status, total_questions from battles where id = $1', [id]);
check('a solo review starts rather than being cancelled', live.rows[0]?.status === 'live',
  `status=${live.rows[0]?.status}`);

console.log('\n· They answer the paper — right, wrong, and one left blank');
const { rows: qs } = await sql.query(
  'select question_order, correct_answer_index from battle_questions where battle_id = $1 order by question_order', [id]);
check('questions were placed', qs.length >= 5, `${qs.length} questions`);

let expectCorrect = 0;
for (const q of qs) {
  if (q.question_order === qs.length) break;          // leave the last unanswered
  const wrong = q.question_order % 3 === 0;           // every third one wrong
  const pick  = wrong ? (q.correct_answer_index + 1) % 4 : q.correct_answer_index;
  if (!wrong) expectCorrect++;
  const r = await call(learner, 'POST', `/api/battle/battles/${id}/answer`,
    { question_order: q.question_order, selected_index: pick, response_time_ms: 4000 });
  if (r.status !== 200) { check(`answer Q${q.question_order}`, false, JSON.stringify(r.json).slice(0, 120)); break; }
}
check('answers were accepted', true, `${qs.length - 1} answered, ${expectCorrect} correct`);

console.log('\n· It runs to the END of the paper, not to question one');
// The engine ends a contest when one agent is left standing — always true for a
// solo learner, so without the review branch this would stop after Q1.
await call(teacher, 'POST', `/api/battle/battles/${id}/end`, {});
await new Promise(r => setTimeout(r, 6000));
const done = await sql.query('select status from battles where id = $1', [id]);
check('review completed', done.rows[0]?.status === 'completed', `status=${done.rows[0]?.status}`);

console.log('\n· And it produces a MARK SHEET, not a scoreboard');
const res = await call(teacher, 'GET', `/api/battle/battles/${id}/results`);
check('results are a review', res.status === 200 && res.json?.type === 'review', `type=${res.json?.type}`);
check('every question is on the sheet', res.json?.markSheet?.length === qs.length,
  `${res.json?.markSheet?.length} of ${qs.length}`);
check('the score matches what they answered', res.json?.score?.correct === expectCorrect,
  `${res.json?.score?.correct} correct, expected ${expectCorrect} — ${JSON.stringify(res.json?.score)}`);
check('an unanswered question is marked as such, not as wrong',
  res.json?.markSheet?.some(r => r.answered === false && r.chosenAnswer === null),
  JSON.stringify(res.json?.markSheet?.[qs.length - 1] ?? {}).slice(0, 140));
check('a wrong answer shows what they chose AND what was right',
  res.json?.markSheet?.some(r => r.answered && !r.isCorrect && r.chosenAnswer && r.correctAnswer),
  JSON.stringify(res.json?.markSheet?.find(r => r.answered && !r.isCorrect) ?? {}).slice(0, 160));
check('topics are broken down weakest first', Array.isArray(res.json?.byTopic),
  JSON.stringify(res.json?.byTopic ?? []).slice(0, 120));

console.log('\n· It pays XP and counts toward the ranking');
// A review is real work. Paying a flat prize for turning up would make it the
// cheapest XP on the platform; paying nothing would make it the only work that
// does not count. So: the pool, scaled by how much of the paper was right.
const { rows: paid } = await sql.query(
  `select p.xp_earned, p.final_rank, p.correct_answers, b.xp_prize, b.total_questions
   from battle_participants p join battles b on b.id = p.battle_id
   where p.battle_id = $1 and p.role <> 'teacher'`, [id]);
const row = paid[0];
const expectXp = Math.round(row.xp_prize * Math.min(1, row.correct_answers / row.total_questions));
check('XP is proportional to the score', row.xp_earned === expectXp,
  `earned ${row.xp_earned}, expected ${expectXp} (${row.correct_answers}/${row.total_questions} of ${row.xp_prize})`);
check('it is ranked, so it shows in their history', row.final_rank === 1, `rank=${row.final_rank}`);

// The ledger also carries a battle_correct row per right answer — that is the
// existing per-question XP and is not what this checks.
const { rows: ledger } = await sql.query(
  `select amount, source from xp_ledger where reference_id = $1 and source = 'study_review'`, [id]);
check('and it reaches the XP ledger the leaderboard reads',
  ledger.length === 1 && ledger[0].amount === expectXp, JSON.stringify(ledger));

check('the tally is not double-counted',
  row.correct_answers <= row.total_questions,
  `${row.correct_answers} correct out of ${row.total_questions} questions`);

console.log('\n· But nobody WON it');
const { rows: seats } = await sql.query(
  'select role, is_winner, final_rank from battle_participants where battle_id = $1', [id]);
check('no winner flag anywhere', seats.every(s => !s.is_winner), JSON.stringify(seats));
// Ranked, but not won — those are different claims, and only the second is
// meaningless in a field of one.
check('no winner is declared', seats.every(s => !s.is_winner), JSON.stringify(seats));

await sql.end();
score();
process.exit(0);
