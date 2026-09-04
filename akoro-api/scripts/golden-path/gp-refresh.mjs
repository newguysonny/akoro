// gp-refresh.mjs — refreshing twice at once must not sign you out everywhere.
//
// Refresh tokens rotate, and reuse of a spent one revoked the whole FAMILY —
// every session on every device. Right for a stolen token; wrong for the app
// racing itself, which it does routinely: AuthContext's 13-minute timer and
// api.js's 401-retry deduped separately, and two tabs each run their own timer.
// That produced "Refresh token reuse detected — all sessions revoked", which is
// the logout the instructor and learner apps kept doing.

import { check, score } from './golden.mjs';
import pg from 'pg';

const sql = new pg.Client({ host: 'localhost', port: 5433, user: 'postgres', database: 'akoro' });
await sql.connect();

/** jti out of a refresh JWT, so the test can age the row it belongs to. */
const jtiOf = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).jti;

const API = process.env.GP_API ?? 'http://127.0.0.1:4800';
const jar = new Map();

function store(res) {
  for (const c of (res.headers.getSetCookie?.() ?? [])) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function post(path, body, cookies = cookieHeader()) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'instructor', Cookie: cookies },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, res };
}

console.log('\n═══ REFRESH ROTATION ═══\n');

const login = await post('/api/auth/login', { email: 'teacher1@demo.akoro.app', password: 'Amara2026' });
check('login', login.status === 200, login.json?.message ?? '');
store(login.res);
check('got a refresh cookie', [...jar.keys()].some(k => k.startsWith('akoro_refresh')), [...jar.keys()].join(' '));

// The exact cookie header two tabs would each be holding.
const shared = cookieHeader();

console.log('\n· Two refreshes at once, same cookie — as two tabs would');
const [a, b] = await Promise.all([post('/api/auth/refresh', {}, shared), post('/api/auth/refresh', {}, shared)]);
check('both succeed', a.status === 200 && b.status === 200, `a=${a.status} b=${b.status}`);
check('neither reports replay',
  !/reuse detected/i.test(a.json?.message ?? '') && !/reuse detected/i.test(b.json?.message ?? ''),
  `${a.json?.message ?? 'ok'} | ${b.json?.message ?? 'ok'}`);

console.log('\n· The session still works afterwards');
store(a.res); store(b.res);
const after = await post('/api/auth/refresh', {});
check('a later refresh with the newest cookie works', after.status === 200,
  `${after.status} ${after.json?.message ?? ''}`);

console.log('\n· Sequential rotation still spends each token');
store(after.res);
const chain = await post('/api/auth/refresh', {});
check('rotation continues', chain.status === 200, `${chain.status} ${chain.json?.message ?? ''}`);

console.log('\n· A genuinely OLD token is still treated as theft');
// The whole run above finishes inside the grace window, so the reuse has to be
// AGED to reach the strict branch — otherwise this asserts nothing and the fix
// could have traded a logout bug for a security hole unnoticed.
const oldJti = jtiOf(shared.match(/akoro_refresh_instructor=([^;]+)/)[1]);
const aged = await sql.query(
  `update refresh_tokens set used_at = now() - interval '10 minutes'
   where jti = $1 returning family`, [oldJti]);
check('aged the spent token', aged.rowCount === 1, `${aged.rowCount} row(s)`);

const stale = await post('/api/auth/refresh', {}, shared);
check('stale reuse is rejected', stale.status === 401, `${stale.status} ${stale.json?.message ?? ''}`);
check('and it revokes the family', /reuse detected/i.test(stale.json?.message ?? ''), stale.json?.message);

const { rows: left } = await sql.query('select count(*)::int n from refresh_tokens where family = $1',
  [aged.rows[0].family]);
check('the family really is gone', left[0].n === 0, `${left[0].n} token(s) left`);

await sql.end();
score();
process.exit(0);
