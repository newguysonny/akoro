// gp-aispend.mjs — the AI spend dashboard's data path.
//
// Cost and tokens used to be recorded only by the wallet DEBIT, so a call with
// no payer wrote nothing and latency was recorded nowhere. This checks the
// whole chain end to end: a model call happens → a row is written → the
// aggregates see it → the admin endpoint returns it → and a non-admin cannot.

import { call, login, check, score } from './golden.mjs';
import pg from 'pg';

const sql = new pg.Client({ host: 'localhost', port: 5433, user: 'postgres', database: 'akoro' });
await sql.connect();

const API = process.env.GP_API ?? 'http://127.0.0.1:4800';
const EMAIL = 'gp.admin@demo.akoro.app';
const PASS  = 'AdminProbe2026!';

console.log('\n═══ AI SPEND DASHBOARD ═══\n');

// There is no seeded admin, so make one for the run and take it away after.
await sql.query('DELETE FROM users WHERE email = $1', [EMAIL]);
const reg = await fetch(`${API}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'admin' },
  body: JSON.stringify({ email: EMAIL, password: PASS, username: 'gp_admin_probe', fullName: 'GP Admin Probe' }),
});
check('probe account created', reg.ok, `status=${reg.status}`);
await sql.query("UPDATE users SET role = 'admin' WHERE email = $1", [EMAIL]);

const admin = await login('admin', 'admin', EMAIL, PASS);

console.log('\n· Some AI happens, and leaves a trace');
const before = (await sql.query('SELECT count(*)::int n FROM edu.ai_call_log')).rows[0].n;
const teacher = await login('teacher', 'instructor', 'teacher1@demo.akoro.app', 'Amara2026');
await call(teacher, 'POST', '/api/teaching/tools/lesson-hooks',
  { topic: 'Fractions', subject: 'Mathematics', class: 'JSS1' });
await new Promise(r => setTimeout(r, 900));   // the write is fire-and-forget
const after = (await sql.query('SELECT count(*)::int n FROM edu.ai_call_log')).rows[0].n;
check('the call was recorded', after > before, `${before} → ${after} rows`);

// The point of tagging: /api/teaching used to land in the "ai" catch-all.
const { rows: tagged } = await sql.query(
  "SELECT feature FROM edu.ai_call_log ORDER BY id DESC LIMIT 1");
check('and attributed to a real feature, not the catch-all',
  tagged[0]?.feature && tagged[0].feature !== 'ai', `feature=${tagged[0]?.feature}`);

console.log('\n· The admin endpoint answers');
const spend = await call(admin, 'GET', '/api/admin/ai-spend?hours=24');
check('200 for an admin', spend.status === 200, `${spend.status} ${spend.json?.error ?? ''}`);
check('totals are present', Number.isFinite(spend.json?.totals?.calls) && Number.isFinite(spend.json?.totals?.usd),
  JSON.stringify(spend.json?.totals));
check('cost per call is derived, not left to the caller',
  Number.isFinite(spend.json?.totals?.usdPerCall), `${spend.json?.totals?.usdPerCall}`);
check('by feature, with p95 beside cost',
  (spend.json?.byFeature ?? []).every(r => 'usd' in r && 'p95_ms' in r),
  `${spend.json?.byFeature?.length ?? 0} features`);
check('by model', (spend.json?.byModel ?? []).length > 0,
  (spend.json?.byModel ?? []).map(m => m.model).join(', '));
check('a time series to compare against', Array.isArray(spend.json?.series),
  `${spend.json?.series?.length ?? 0} buckets`);

console.log('\n· The window is honoured and bounded');
const week = await call(admin, 'GET', '/api/admin/ai-spend?hours=168');
check('7 days works', week.status === 200 && week.json?.windowHours === 168, `${week.json?.windowHours}`);
const silly = await call(admin, 'GET', '/api/admin/ai-spend?hours=99999');
check('an absurd window is clamped, not honoured', silly.json?.windowHours === 24 * 90,
  `${silly.json?.windowHours} hours`);

console.log('\n· Alerts: state for every rule, and a dry run');
const alerts = await call(admin, 'GET', '/api/admin/alerts');
check('the alerts endpoint answers', alerts.status === 200, `${alerts.status}`);
// Every rule, not only the firing ones — an empty list cannot distinguish
// "nothing is wrong" from "nothing is being checked".
check('every rule is listed with its state',
  (alerts.json?.rules ?? []).length > 0 && alerts.json.rules.every(r => r.title && r.severity && 'firing' in r),
  `${alerts.json?.rules?.length ?? 0} rules, ${alerts.json?.firing ?? 0} firing`);

const dry = await call(admin, 'POST', '/api/admin/alerts/check', {});
check('a manual check runs', dry.status === 200 && Array.isArray(dry.json?.results),
  `${dry.json?.results?.length ?? 0} results`);
// Pressing "check" to verify a threshold must not email everyone.
check('and does NOT deliver by default', dry.json?.delivered === false, `delivered=${dry.json?.delivered}`);

console.log('\n· And it is admin-only');
const nosy = await call(teacher, 'GET', '/api/admin/ai-spend?hours=24');
check('an instructor is refused the spend data', nosy.status === 403 || nosy.status === 401, `status=${nosy.status}`);
const nosyAlerts = await call(teacher, 'GET', '/api/admin/alerts');
check('and the alerts', nosyAlerts.status === 403 || nosyAlerts.status === 401, `status=${nosyAlerts.status}`);

await sql.query('DELETE FROM users WHERE email = $1', [EMAIL]);
await sql.end();
score();
process.exit(0);
