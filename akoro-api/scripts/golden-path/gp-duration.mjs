// gp-duration.mjs — the Duration field on the create form actually paces the
// battle.
//
// It used to do NOTHING. The engine schedules each question's reveal from
// battle_questions.time_limit_seconds and never reads the battle's own, and
// that per-question value was hardcoded to 15 wherever questions were written.
// So a teacher asking for 15 minutes over 15 questions got a battle that was
// over in 3m45s — while every card and the challenge sheet said "15 min".
//
// Duration is now shared across the questions, and the battle's stored length
// is reconciled to what the questions actually add up to.

import { call, login, check, score } from './golden.mjs';
import pg from 'pg';

const sql = new pg.Client({ host: 'localhost', port: 5433, user: 'postgres', database: 'akoro' });
await sql.connect();

const teacher = await login('teacher', 'instructor', 'teacher1@demo.akoro.app', 'Amara2026');
const cls  = await call(teacher, 'GET', '/api/battle/my-classes');
const jss1 = (cls.json?.data ?? []).find(c => c.name === 'JSS1');
const roster = await call(teacher, 'GET', `/api/battle/classes/${jss1.id}/roster`);
const mates = (roster.json?.data ?? []).filter(m => m.has_agent && /^jss1_mate\d+$/.test(m.username ?? ''));

async function make(title, questions, seconds, source = 'bank') {
  const r = await call(teacher, 'POST', `/api/battle/classes/${jss1.id}/battles/invite`, {
    title, subject: 'Mathematics', total_questions: questions,
    time_limit_seconds: seconds, question_source: source,
    user_ids: [mates[0].id, mates[1].id],
  });
  if (r.status !== 201) { check(`create ${title}`, false, JSON.stringify(r.json).slice(0, 160)); return null; }
  const id = r.json.data.battle_id;
  const { rows } = await sql.query(
    `select b.total_questions, b.time_limit_seconds AS stored,
            min(q.time_limit_seconds)::int AS per_q, count(q.id)::int AS placed
     from battles b join battle_questions q on q.battle_id = b.id
     where b.id = $1 group by b.id`, [id]);
  return rows[0];
}

console.log('\n· Duration is shared across the questions');
const a = await make('dur 10min/10q', 10, 600);
check('10 min over 10 questions = 60s each', a?.per_q === 60, JSON.stringify(a));

const b = await make('dur 2min/10q', 10, 120);
check('2 min over 10 questions = 12s each', b?.per_q === 12, JSON.stringify(b));

console.log('\n· And it is clamped to something playable');
// 60/30 = 2s, which is not long enough to read a question, let alone answer.
const c = await make('dur 1min/30q', 30, 60, 'auto');
check('too little time is floored at 8s, not 2s', c?.per_q === 8, JSON.stringify(c));

console.log('\n· The stored duration matches what the questions add up to');
// Otherwise the card and the challenge sheet promise a length the battle will
// not take — which is the bug this whole change exists to fix.
for (const [name, row] of [['10min', a], ['2min', b], ['clamped', c]]) {
  check(`${name}: stored = placed x per-question`,
    row && row.stored === row.placed * row.per_q,
    `stored=${row?.stored} placed=${row?.placed} per_q=${row?.per_q}`);
}

await sql.end();
score();
process.exit(0);
