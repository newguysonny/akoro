// gp-expiry.mjs — an invitation expires only when there is a start time for it
// to expire at.
//
// Every battle used to get expires_at = now() + 60 minutes, from a default
// parameter no form exposed. /my-challenges filters on that column, so at the
// hour mark the card silently left the learner's tab — including for a battle
// set in the morning for an afternoon lesson, which expired before break.
//
// Now: a SCHEDULED battle's deadline is its start (nothing to accept after it
// begins); an UNSCHEDULED one has no deadline at all and waits to be answered.

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

const deadlineOf = async (id) => (await sql.query(
  'select expires_at, scheduled_start, status from battles where id = $1', [id])).rows[0];

console.log('\n· An unscheduled battle has NO deadline');
const open = await call(teacher, 'POST', `/api/battle/classes/${jss1.id}/battles/invite`, {
  title: 'Open invitation', subject: 'Mathematics', total_questions: 10,
  question_source: 'bank', user_ids: [a.id, b.id],
});
check('created', open.status === 201, JSON.stringify(open.json).slice(0, 140));
const openId = open.json?.data?.battle_id;
const openRow = await deadlineOf(openId);
check('expires_at is NULL', openRow?.expires_at === null, JSON.stringify(openRow));

console.log('\n· And it still reaches the learner');
const learner = await login('a', 'student', email(a), 'Password123!');
const list = await call(learner, 'GET', '/api/battle/my-challenges');
const card = (list.json?.data ?? []).find(x => x.id === openId);
check('the open invitation is in the Challenges tab', !!card,
  `${list.json?.data?.length ?? 0} pending`);
// The filter is `expires_at IS NULL OR expires_at > now()`. A plain
// `.gt("expires_at", now())` drops NULLs, which would hide it entirely.
check('the card carries no deadline for the UI to count down',
  card && card.expiresAt === null && card.expiresIn === null,
  `expiresAt=${card?.expiresAt} expiresIn=${card?.expiresIn}`);

console.log('\n· It is still acceptable — no epoch-expiry from a NULL');
// new Date(null) is 1970, so a naive `< now()` would 410 every open invitation.
const acc = await call(learner, 'POST', `/api/battle/challenges/${openId}/accept`, {});
check('accepting an open invitation works', acc.status === 200, JSON.stringify(acc.json).slice(0, 140));

console.log('\n· A scheduled battle expires when it starts');
const when = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
const sched = await call(teacher, 'POST', `/api/battle/classes/${jss1.id}/battles/invite`, {
  title: 'Scheduled invitation', subject: 'Mathematics', total_questions: 10,
  question_source: 'bank', user_ids: [a.id, b.id], scheduled_for: when,
});
check('created', sched.status === 201, JSON.stringify(sched.json).slice(0, 140));
const schedRow = await deadlineOf(sched.json?.data?.battle_id);
check('deadline IS the start time',
  schedRow?.expires_at && new Date(schedRow.expires_at).getTime() === new Date(schedRow.scheduled_start).getTime(),
  `expires=${schedRow?.expires_at} starts=${schedRow?.scheduled_start}`);
check('not an hour from now',
  Math.abs(new Date(schedRow.expires_at) - Date.now()) > 2 * 60 * 60 * 1000,
  `${Math.round((new Date(schedRow.expires_at) - Date.now()) / 60000)} min away`);

const learnerList = await call(learner, 'GET', '/api/battle/my-challenges');
const schedCard = (learnerList.json?.data ?? []).find(x => x.id === sched.json.data.battle_id);
check('the scheduled card gives the UI something to count down to',
  !!schedCard?.expiresAt, `expiresAt=${schedCard?.expiresAt}`);

console.log('\n· Start Now counts learners who accepted, not seats');
const notReady = await call(teacher, 'POST', `/api/battle/battles/${openId}/start`, {});
check('refuses with one accept, and says who is missing',
  notReady.status === 400 && /still to answer/.test(notReady.json?.error ?? ''),
  notReady.json?.error);

const learnerB = await login('b', 'student', email(b), 'Password123!');
await call(learnerB, 'POST', `/api/battle/challenges/${openId}/accept`, {});
await new Promise(r => setTimeout(r, 8000));
const started = await deadlineOf(openId);
check('once everyone answered it started on its own', started?.status === 'live', `status=${started?.status}`);

await sql.end();
score();
process.exit(0);
