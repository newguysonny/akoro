import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const APPS = ['akoro-learner', 'akoro-school', 'akoro-instructor', 'akoro-admin'];

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'dist', '.dist'].includes(e.name)) await walk(p, out); }
    else if (/\.(jsx?|mjs)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) out.push(p);
  }
  return out;
}
// Code only: drop comment lines; mailboxes (name@akoro.app) are content, not addresses we call.
const code = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n').replace(/[\w.+-]+@akoro\.app/g, '');

test('no app spells a retired or platform address in code: URLs come from src/config/urls.js (env, current-host fallback)', async () => {
  const offenders = [];
  for (const app of APPS) {
    for (const f of await walk(path.join(root, app, 'src'))) {
      if (f.endsWith(path.join('config', 'urls.js'))) continue;
      const src = code(await readFile(f, 'utf8'));
      if (/onrender\.com/.test(src)) offenders.push(`${path.relative(root, f)}: onrender.com`);
      if (/https?:\/\/[a-z.-]*akoro\.app/.test(src)) offenders.push(`${path.relative(root, f)}: akoro.app address`);
      if (/VITE_API_URL\s*\|\|/.test(src)) offenders.push(`${path.relative(root, f)}: inline VITE_API_URL fallback`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('each app has a urls.js with an env-driven API address whose fallback is the current API host', async () => {
  for (const app of APPS) {
    const src = await readFile(path.join(root, app, 'src/config/urls.js'), 'utf8');
    assert.match(src, /E\.VITE_API_URL\) \|\| 'https:\/\/api\.akoro\.name\.ng'/, app);
    assert.match(src, /E\.VITE_SITE_URL\) \|\| 'https:\/\/akoro\.name\.ng'/, app);
  }
  const learner = await readFile(path.join(root, 'akoro-learner/src/config/urls.js'), 'utf8');
  for (const k of ['VITE_APP_URL', 'VITE_INSTRUCTOR_URL']) assert.match(learner, new RegExp(k));
  const school = await readFile(path.join(root, 'akoro-school/src/config/urls.js'), 'utf8');
  for (const k of ['VITE_LEARNER_URL', 'VITE_WS_URL', 'VITE_ADMISSION_BASE_URL']) assert.match(school, new RegExp(k));
});

test('terms and privacy links are built from SITE_URL on every sign-in/up page', async () => {
  for (const f of ['akoro-learner/src/pages/auth/SigninPage.jsx', 'akoro-learner/src/pages/auth/SignupPage.jsx', 'akoro-school/src/pages/auth/SigninPage.jsx', 'akoro-school/src/pages/auth/SignupPage.jsx',
    'akoro-instructor/src/pages/auth/SigninPage.jsx', 'akoro-instructor/src/pages/auth/SignupPage.jsx', 'akoro-admin/src/pages/auth/SigninPage.jsx']) {
    const src = await readFile(path.join(root, f), 'utf8');
    assert.match(src, /href=\{`\$\{SITE_URL\}\/terms`\}/, f);
    assert.match(src, /href=\{`\$\{SITE_URL\}\/privacy`\}/, f);
  }
});
