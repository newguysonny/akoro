// gp-autoplay.mjs — agents answer for themselves.
//
// A battle is described everywhere as agent vs agent, but nothing ever made an
// agent answer: the only path to an answer was a human tapping an option. So an
// unattended battle produced ten questions of "⏰ ran out of time", every score
// 0, and a winner picked by whoever sorted first — "Priya's Agent wins 0–0".

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

console.log('\n· A battle nobody touches must still be played');
const made = await call(teacher, 'POST', `/api/battle/classes/${jss1.id}/battles/invite`, {
  title: 'Agents play it themselves', subject: 'Mathematics',
  total_questions: 5, time_limit_seconds: 50,   // 10s a question — quick to watch
  question_source: 'bank', user_ids: [a.id, b.id],
});
check('created', made.status === 201, JSON.stringify(made.json).slice(0, 140));
const id = made.json?.data?.battle_id;

for (const m of [a, b]) {
  const s = await login(m.username, 'student', email(m), 'Password123!');
  await call(s, 'POST', `/api/battle/challenges/${id}/accept`, {});
}

console.log('\n· While it is LIVE, a learner cannot answer by hand');
// Checked here, not after it finishes: a completed battle refuses every answer
// with "not live", which would pass this check while proving nothing about the
// agent-only rule.
const asLearner = await login('spectator', 'student', email(a), 'Password123!');
let live = false;
for (let i = 0; i < 25 && !live; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const { rows } = await sql.query('select status from battles where id = $1', [id]);
  live = rows[0]?.status === 'live';
}
check('the battle went live', live);
const manual = await call(asLearner, 'POST', `/api/battle/battles/${id}/answer`,
  { question_order: 1, selected_index: 0 });
check('manual answering is refused because the agent plays',
  manual.status === 409 && manual.json?.code === 'AGENT_ANSWERS',
  `${manual.status} ${manual.json?.error ?? ''}`);

// Nobody answers anything from here on. 5 questions x 10s + slack.
console.log('  …letting it run, untouched');
await new Promise(r => setTimeout(r, 70000));

const { rows: st } = await sql.query('select status, total_questions from battles where id = $1', [id]);
check('it finished', st[0]?.status === 'completed', `status=${st[0]?.status}`);

const { rows: ans } = await sql.query(
  `select count(*)::int n, count(*) filter (where is_correct)::int correct
   from battle_answers where battle_id = $1`, [id]);
check('answers were actually given', ans[0].n > 0, `${ans[0].n} answers, ${ans[0].correct} correct`);
check('every question got an answer from both agents', ans[0].n === st[0].total_questions * 2,
  `${ans[0].n} of ${st[0].total_questions * 2}`);

const { rows: seats } = await sql.query(
  `select p.role, p.score, p.correct_answers, p.wrong_answers, p.is_winner, p.final_rank, p.xp_earned,
          a.agent_name
   from battle_participants p join user_agents a on a.id = p.agent_id
   where p.battle_id = $1 order by p.final_rank`, [id]);
check('nobody scored 0–0 this time', seats.some(s => (s.score ?? 0) > 0),
  seats.map(s => `${s.agent_name}:${s.score}`).join(' '));
check('there is a real winner', seats.filter(s => s.is_winner).length === 1,
  seats.map(s => `${s.agent_name}:${s.is_winner ? 'W' : '-'}`).join(' '));
check('XP was distributed', seats.some(s => (s.xp_earned ?? 0) > 0),
  seats.map(s => `${s.agent_name}:${s.xp_earned}`).join(' '));

console.log('\n· The teacher hosts — they are not played, scored or narrated');
const host = seats.find(s => s.role === 'teacher');
check('the host answered nothing', !host || (host.correct_answers === 0 && host.wrong_answers === 0),
  host ? `${host.agent_name} c=${host.correct_answers} w=${host.wrong_answers}` : 'no host seat');
const { rows: hostLog } = await sql.query(
  `select count(*)::int n from battle_log
   where battle_id = $1 and message like '%demo_teacher%'`, [id]);
check('the host is not in the commentary', hostLog[0].n === 0, `${hostLog[0].n} mentions`);

console.log('\n· Agents answer independently, not in lockstep');
const { rows: times } = await sql.query(
  `select distinct response_time_ms from battle_answers where battle_id = $1 and response_time_ms is not null`, [id]);
check('response times differ between agents', times.length > 1, `${times.length} distinct times`);

console.log('\n· The finished card can say what happened');
const mine = await call(asLearner, 'GET', '/api/battle/my-battles');
const card = (mine.json?.data ?? []).find(x => x.id === id);
check('the card carries agentA/agentB/winner', !!card?.agentA && !!card?.agentB && !!card?.winner,
  `A=${card?.agentA?.name} B=${card?.agentB?.name} winner=${card?.winner ? 'set' : 'null'}`);
check('and scores, so the line is not "undefined–undefined"',
  Number.isFinite(card?.agentA?.score) && Number.isFinite(card?.agentB?.score),
  `${card?.agentA?.score}–${card?.agentB?.score}`);

await sql.end();
score();
process.exit(0);
