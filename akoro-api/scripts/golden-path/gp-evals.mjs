// gp-evals.mjs — the eval suite's control surface.
//
// The suites themselves cannot run here: they need a live OPENAI_API_KEY, and
// against the stand-in model every case would pass for the wrong reason — a
// green board that proves nothing, which is the one outcome this feature must
// never produce. So the endpoint REFUSES without a live key, and that refusal
// is the first thing checked.
//
// What is testable without spending money is everything around the model: who
// may press the button, that a second concurrent run is refused, that a run is
// recorded and cancellable, and that results come back failures-first. That is
// the part that breaks silently; the model call is the part that shouts.

import { call, login, check, score } from './golden.mjs';
import pg from 'pg';

const sql = new pg.Client({ host: 'localhost', port: 5433, user: 'postgres', database: 'akoro' });
await sql.connect();

const API = process.env.GP_API ?? 'http://127.0.0.1:4800';
const EMAIL = 'gp.evaladmin@demo.akoro.app';
const PASS  = 'AdminProbe2026!';

console.log('\n═══ EVALS ═══\n');

await sql.query('DELETE FROM users WHERE email = $1', [EMAIL]);
const reg = await fetch(`${API}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'admin' },
  body: JSON.stringify({ email: EMAIL, password: PASS, username: 'gp_eval_admin', fullName: 'GP Eval Admin' }),
});
check('probe account created', reg.ok, `status=${reg.status}`);
await sql.query("UPDATE users SET role = 'admin' WHERE email = $1", [EMAIL]);
const admin = await login('admin', 'admin', EMAIL, PASS);

console.log('\n· What can be run, and what it would cost');
const suites = await call(admin, 'GET', '/api/admin/evals/suites');
check('the catalog answers', suites.status === 200, `${suites.status} ${suites.json?.error ?? ''}`);
check('every suite is listed',
  (suites.json?.suites ?? []).length >= 3,
  (suites.json?.suites ?? []).map(s => s.key).join(', '));
// The bar is what turns a measurement into a decision, so it has to reach the
// page — a card that cannot say whether 9/10 is a pass is just a number.
check('each carries its own threshold, and says why',
  (suites.json?.suites ?? []).every(s => s.threshold > 0 && s.threshold <= 1 && s.thresholdNote?.length > 20),
  (suites.json?.suites ?? []).map(s => `${s.key}:${s.threshold}`).join(' '));
// Not one shared number: question generation tolerates nothing because a
// mis-keyed question is permanent, and the loop tolerates a miss because it has
// more ways to be almost-right. A single bar would be wrong for both.
check('and the bars are not all the same',
  new Set((suites.json?.suites ?? []).map(s => s.threshold)).size > 1,
  [...new Set((suites.json?.suites ?? []).map(s => s.threshold))].join(', '));
check('every suite says what it proves and how many cases',
  (suites.json?.suites ?? []).every(s => s.purpose?.length > 40 && s.cases > 0),
  (suites.json?.suites ?? []).map(s => `${s.key}:${s.cases}`).join(' '));
// The estimate is the whole reason the confirm dialog can exist.
check('a cost estimate for every model, before anything is spent',
  (suites.json?.suites ?? []).every(s =>
    (suites.json.models ?? []).every(m => Number.isFinite(s.estimates?.[m]) && s.estimates[m] > 0)),
  JSON.stringify(suites.json?.suites?.[0]?.estimates ?? {}));
check('and the page is told whether a live key exists',
  typeof suites.json?.liveKey === 'boolean', `liveKey=${suites.json?.liveKey}`);

console.log('\n· Bad input is refused before it costs anything');
const badSuite = await call(admin, 'POST', '/api/admin/evals/run', { suite: 'nope', model: 'gpt-4o-mini' });
check('an unknown suite is a 400', badSuite.status === 400, `status=${badSuite.status}`);
const badModel = await call(admin, 'POST', '/api/admin/evals/run', { suite: 'questions', model: 'gpt-9' });
check('an unknown model is a 400', badModel.status === 400, `status=${badModel.status}`);

const liveKey = !!suites.json?.liveKey;
console.log(`\n· Starting a run (live key: ${liveKey ? 'yes' : 'no'})`);
const started = await call(admin, 'POST', '/api/admin/evals/run', { suite: 'questions', model: 'gpt-4o-mini' });

if (!liveKey) {
  // The important half. A stand-in model returns a fixed reply and would score
  // the routing suite green by accident; refusing is the only honest answer.
  check('without a live key the run is refused, not faked', started.status === 503,
    `status=${started.status}`);
  check('and the refusal says why', /prove|stand-in|OPENAI_API_KEY/i.test(started.json?.error ?? ''),
    started.json?.error ?? '');
} else {
  check('a run is queued', started.status === 202 && started.json?.runId, `status=${started.status}`);
  const runId = started.json?.runId;
  // A second run would double the bill and race the same tables.
  const second = await call(admin, 'POST', '/api/admin/evals/run', { suite: 'routing', model: 'gpt-4o-mini' });
  check('a second concurrent run is refused', second.status === 409, `status=${second.status}`);
  const cancelled = await call(admin, 'POST', `/api/admin/evals/${runId}/cancel`, {});
  check('and it can be stopped', cancelled.status === 200, `status=${cancelled.status}`);
  await sql.query('DELETE FROM edu.eval_runs WHERE id = $1', [runId]);
}

// The rest holds either way, so it is checked either way. Locally there is
// always a key (pointed at the stand-in), so putting these behind the no-key
// branch would mean they never ran anywhere that anyone looks.
{
  const { rows } = await sql.query(
    `INSERT INTO edu.eval_runs (suite, model, status, cases_total) VALUES ('questions','gpt-4o-mini','running',2) RETURNING id`);
  const runId = rows[0].id;
  await sql.query(
    `INSERT INTO edu.eval_results (run_id, case_key, name, passed, expected, actual, detail, ms)
     VALUES ($1,'a','a passing case',true,'x','x','fine',10),
            ($1,'b','a failing case',false,'5 markable questions','3 usable','answer key out of range',20)`,
    [runId]);

  // A run keeps the bar it was judged against. Raising a suite's threshold
  // later must not repaint finished runs red — history would stop being
  // readable, and a real regression would be indistinguishable from a stricter
  // rule.
  await sql.query(
    `UPDATE edu.eval_runs SET status='done', cases_passed=9, cases_failed=1, cases_total=10,
       threshold=0.8, met_threshold=true WHERE id=$1`, [runId]);
  const kept = await call(admin, 'GET', `/api/admin/evals/${runId}`);
  check('a finished run keeps the bar it was judged against',
    Number(kept.json?.run?.threshold) === 0.8 && kept.json?.run?.met_threshold === true,
    `threshold=${kept.json?.run?.threshold} met=${kept.json?.run?.met_threshold}`);
  await sql.query(`UPDATE edu.eval_runs SET status='running' WHERE id=$1`, [runId]);

  const detail = await call(admin, 'GET', `/api/admin/evals/${runId}`);
  check('a run reads back with its results', detail.status === 200 && (detail.json?.results ?? []).length === 2,
    `${detail.json?.results?.length ?? 0} results`);
  // Nobody opens a run to read the passes.
  check('failures come first', detail.json?.results?.[0]?.passed === false,
    detail.json?.results?.map(r => r.passed).join(','));
  check('a failure carries expected vs actual',
    detail.json?.results?.[0]?.expected && detail.json?.results?.[0]?.actual,
    `${detail.json?.results?.[0]?.expected} / ${detail.json?.results?.[0]?.actual}`);

  // A second run while one is going would double the bill and race the tables.
  const second = await call(admin, 'POST', '/api/admin/evals/run', { suite: 'routing', model: 'gpt-4o-mini' });
  check('a second concurrent run is refused', second.status === 409, `status=${second.status}`);

  const cancelled = await call(admin, 'POST', `/api/admin/evals/${runId}/cancel`, {});
  check('a running run can be stopped', cancelled.status === 200, `status=${cancelled.status}`);
  const { rows: after } = await sql.query('SELECT status FROM edu.eval_runs WHERE id = $1', [runId]);
  check('and it is marked cancelled', after[0]?.status === 'cancelled', `status=${after[0]?.status}`);
  const again = await call(admin, 'POST', `/api/admin/evals/${runId}/cancel`, {});
  check('cancelling a finished run is refused', again.status === 400, `status=${again.status}`);

  await sql.query('DELETE FROM edu.eval_runs WHERE id = $1', [runId]);
}

console.log('\n· The list, and who may see any of it');
const list = await call(admin, 'GET', '/api/admin/evals?limit=5');
check('recent runs list', list.status === 200 && Array.isArray(list.json?.runs), `${list.status}`);

const teacher = await login('teacher', 'instructor', 'teacher1@demo.akoro.app', 'Amara2026');
const nosy = await call(teacher, 'GET', '/api/admin/evals/suites');
check('an instructor cannot see the suites', nosy.status === 403 || nosy.status === 401, `status=${nosy.status}`);
// The one that actually matters: this endpoint spends money.
const nosyRun = await call(teacher, 'POST', '/api/admin/evals/run', { suite: 'questions', model: 'gpt-4o-mini' });
check('and certainly cannot start a run', nosyRun.status === 403 || nosyRun.status === 401, `status=${nosyRun.status}`);

await sql.query('DELETE FROM users WHERE email = $1', [EMAIL]);
await sql.end();
score();
process.exit(0);
