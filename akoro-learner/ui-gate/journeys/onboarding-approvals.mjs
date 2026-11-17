#!/usr/bin/env node
/**
 * Journey: onboarding and approvals, end to end — with REAL accounts, real saves and real approvals.
 *
 *   1. A new instructor signs up, does the onboarding chat (name, school, subjects, guide) and lands
 *      on the dashboard; their request to the school is pending.
 *   2. The school admin signs in to the school app and approves them on Teacher requests.
 *   3. A new learner signs up, does the onboarding chat (terms, name, level/class, school, subjects,
 *      agent, picks the instructor from step 1, preferences) and lands on /app; their request to the
 *      teacher is pending.
 *   4. The instructor approves the learner on Join requests: the learner is an active class member
 *      and on the school's roster.
 * Every save is read back through the API, and each app is reloaded to prove it stays routed.
 *
 * Unlike the gate's onboarding scenarios (which intercept the saves), this CREATES accounts, so it
 * runs against the SANDBOX API only (its own database). Accounts are named "Ada Obi <tag>" /
 * "Tunde Bello <tag>" with @demo.akoro.app emails, and are left in place as evidence.
 *
 *   cd akoro-learner
 *   npm run journey:onboarding                       # builds the three apps, sandbox API
 *   node ui-gate/journeys/onboarding-approvals.mjs --no-build --headed
 *   UI_GATE_API=https://other-sandbox.example node ui-gate/journeys/onboarding-approvals.mjs --allow-api
 *
 * School admin: SCHOOL_ADMIN_EMAIL / SCHOOL_ADMIN_PASSWORD (default: the demo school,
 * school@demo.akoro.app / Admin2026 from migrations/2026-seed-school-passwords.sql).
 * Output (git-ignored): ui-gate/.out/journey-onboarding/ — screenshots, builds, result-<tag>.json.
 * Exit code 0 only when every check passed.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const OUT = path.resolve(HERE, '../.out/journey-onboarding');
const GATE_CONFIG = path.resolve(HERE, '../vite.gate.config.mjs');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);

const API = process.env.UI_GATE_API || 'https://sandbox.akoro.ng';
// It signs up accounts: never against production by accident.
if (!/sandbox|localhost|127\.0\.0\.1/.test(new URL(API).hostname) && !flag('allow-api')) {
  console.error(`Refusing ${API}: this journey creates real accounts, so it runs against a sandbox API. Pass --allow-api if this API is disposable.`);
  process.exit(2);
}
const SCHOOL_ADMIN = { email: process.env.SCHOOL_ADMIN_EMAIL || 'school@demo.akoro.app', password: process.env.SCHOOL_ADMIN_PASSWORD || 'Admin2026' };
const SCHOOL = process.env.JOURNEY_SCHOOL || 'Akoro Demo Academy';
const TAG = process.env.TAG || Date.now().toString(36).slice(-6);
const PW = `Onboard!${TAG}9`;
const instructor = { name: `Ada Obi ${TAG}`, username: `ob_i_${TAG}`, email: `ob-i-${TAG}@demo.akoro.app` };
const learner = { name: `Tunde Bello ${TAG}`, username: `ob_l_${TAG}`, email: `ob-l-${TAG}@demo.akoro.app` };
const APPS = { learner: { dir: 'akoro-learner', port: 4331 }, instructor: { dir: 'akoro-instructor', port: 4332 }, school: { dir: 'akoro-school', port: 4333 } };

/* ── the three apps, built and served on localhost with /api passed through to API ── */
function vite(app, cmd) {
  const root = path.join(REPO, app.dir);
  return spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), ...cmd, '--config', GATE_CONFIG], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, UI_GATE_API: API, UI_GATE_PORT: String(app.port), UI_GATE_DIST: path.join(OUT, `dist-${app.dir}`),
      VITE_API_URL: `http://127.0.0.1:${app.port}`, UI_GATE_BASE_CONFIG: path.join(root, 'vite.config.js') },
  });
}
async function serve(app) {
  if (!flag('no-build')) {
    const b = vite(app, ['build', '--logLevel', 'warn']);
    let log = ''; b.stdout.on('data', (d) => { log += d; }); b.stderr.on('data', (d) => { log += d; });
    if (await new Promise((r) => b.on('exit', r)) !== 0) throw new Error(`building ${app.dir} failed: ${log.slice(-600)}`);
  }
  const child = vite(app, ['preview']);
  const url = `http://127.0.0.1:${app.port}`;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode != null) throw new Error(`${app.dir} did not start`);
    try { if ((await fetch(url)).ok) return { url, stop: () => child.kill('SIGTERM') }; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGTERM');
  throw new Error(`${app.dir} did not answer on ${url}`);
}

/* ── checks and page helpers ── */
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → ${JSON.stringify(detail ?? null).slice(0, 400)}`}`); return !!ok; };
const note = (text) => { results.push({ note: text }); console.log(`note  ${text}`); };
const settle = (page, ms = 1200) => page.waitForTimeout(ms);
const composer = (page) => page.locator('.ob-composer textarea').last();
const send = (page) => page.getByRole('button', { name: 'Send message' });
const chips = async (page) => (await page.locator('.ob-q button').allInnerTexts()).map((x) => x.trim());
const pick = (page, name) => page.getByRole('button', { name, exact: true }).click();
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${TAG}-${name}.png`) }).catch(() => {});
const appears = (locator, timeout = 20_000) => locator.waitFor({ timeout }).then(() => true, () => false);
/** An API call from inside the page, with the page's own cookies (and its portal). */
const api = (page, p, portal) => page.evaluate(async ({ p, portal }) => {
  const r = await fetch(p, { credentials: 'include', headers: portal ? { 'X-Akoro-Portal': portal } : {} });
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  return j?.data ?? j;
}, { p, portal });

async function signup(page, base, who) {
  await page.goto(`${base}/signup`, { waitUntil: 'domcontentloaded' });
  const inputs = page.locator('form input');
  await inputs.first().waitFor({ timeout: 30_000 });
  await inputs.nth(0).fill(who.name);
  await inputs.nth(1).fill(who.username);
  await page.locator('form input[type=email]').fill(who.email);
  await page.locator('form input[type=password]').fill(PW);
  await page.locator('form button[type=submit]').click();
  // A cold sandbox can take a while to create the account.
  return page.waitForURL(/\/onboarding/, { timeout: 90_000 }).then(() => true, () => false);
}

/* ── 1. instructor ── */
async function instructorOnboards(ip, I) {
  check('instructor: sign-up lands on the onboarding chat', await signup(ip, I, instructor), ip.url());
  await ip.waitForSelector('.ob-composer textarea:not([disabled])', { timeout: 45_000 }); await settle(ip);
  check('instructor: the name arrives pre-filled from sign-up', (await composer(ip).inputValue()).includes(instructor.name), await composer(ip).inputValue());
  await composer(ip).fill(`Dr. ${instructor.name}`); await send(ip).click();
  await ip.waitForSelector('.ob-search', { timeout: 20_000 }); await settle(ip);
  check('instructor: the school can\'t be skipped', (await send(ip).isDisabled()) && !(await chips(ip)).some((c) => /skip/i.test(c)), await chips(ip));
  await composer(ip).fill(SCHOOL.split(' ').slice(0, 2).join(' '));
  const school = ip.locator('.ob-tcard', { hasText: SCHOOL }).first();
  check('instructor: searching finds the school', await appears(school, 15_000));
  await school.click(); await send(ip).click(); await settle(ip);
  await pick(ip, 'Physics'); await pick(ip, 'Chemistry'); await send(ip).click();
  await ip.waitForSelector('.ob-avas', { timeout: 20_000 }); await settle(ip);
  await ip.locator('.ob-avopt').nth(6).click();
  await composer(ip).fill('Professor Owl'); await send(ip).click();
  check('instructor: the summary appears', await appears(ip.locator('.ob-sum'), 30_000));
  await shot(ip, '1-instructor-summary');
  await ip.getByRole('button', { name: /Go to dashboard/ }).click();
  check('instructor: "Go to dashboard" leaves onboarding', await ip.waitForFunction(() => !location.pathname.startsWith('/onboarding'), null, { timeout: 30_000 }).then(() => true, () => false), ip.url());
  await settle(ip, 3000); await shot(ip, '2-instructor-dashboard');
  await ip.reload({ waitUntil: 'domcontentloaded' }); await settle(ip, 3000);
  check('instructor: after a reload it stays out of onboarding', !new URL(ip.url()).pathname.startsWith('/onboarding'), ip.url());
  const me = await api(ip, '/api/profiles/me', 'instructor');
  check('instructor saved: full name', me?.fullName === `Dr. ${instructor.name}`, me?.fullName);
  check('instructor saved: school', me?.schoolName === SCHOOL, me?.schoolName);
  check('instructor saved: subjects', JSON.stringify(me?.subjects) === JSON.stringify(['Physics', 'Chemistry']), me?.subjects);
  check('instructor saved: guide name and avatar', me?.teachingGuide === 'Professor Owl' && me?.guideEmoji === '🦉', [me?.teachingGuide, me?.guideEmoji]);
  check('instructor saved: onboarding completed', me?.onboardingCompleted === true, me?.onboardingCompleted);
  const link = await api(ip, '/api/profiles/me/school-link', 'instructor');
  check('instructor: a pending request to the school', link?.status === 'pending' && link?.name === SCHOOL, link);
}

/* ── 2. school admin approves ── */
async function schoolApproves(sp, S, ip) {
  await sp.goto(`${S}/signin`, { waitUntil: 'domcontentloaded' });
  await sp.locator('input[type=email]').fill(SCHOOL_ADMIN.email);
  await sp.locator('input[type=password]').fill(SCHOOL_ADMIN.password);
  await sp.locator('button[type=submit]').click();
  if (!check('school admin signs in', await sp.waitForFunction(() => !location.pathname.startsWith('/signin'), null, { timeout: 30_000 }).then(() => true, () => false), `${SCHOOL_ADMIN.email} — set SCHOOL_ADMIN_PASSWORD`)) return false;
  await sp.goto(`${S}/staff/teacher-requests`, { waitUntil: 'domcontentloaded' }); await settle(sp, 3000);
  const row = sp.locator('div', { hasText: `Dr. ${instructor.name}` }).filter({ has: sp.getByRole('button', { name: /Approve/ }) }).last();
  if (!check('school: the instructor\'s request is listed', await appears(row))) return false;
  await shot(sp, '3-school-requests');
  await row.getByRole('button', { name: /Approve/ }).click(); await settle(sp, 2500);
  const link = await api(ip, '/api/profiles/me/school-link', 'instructor');
  return check('instructor: school membership approved', link?.status === 'approved', link);
}

/* ── 3. learner ── */
async function learnerOnboards(lp, L) {
  check('learner: sign-up lands on the onboarding chat', await signup(lp, L, learner), lp.url());
  await lp.waitForSelector('.ob-terms', { timeout: 45_000 });
  check('learner: the terms are required', await send(lp).isDisabled());
  await lp.locator('.ob-terms input').check(); await send(lp).click(); await settle(lp);
  await composer(lp).fill(learner.name); await send(lp).click(); await settle(lp);
  const level = lp.getByRole('button', { name: 'Senior Secondary' });
  await level.waitFor({ timeout: 15_000 }); await level.click(); await settle(lp);
  await pick(lp, 'SSS 2'); await send(lp).click(); await settle(lp);
  await composer(lp).fill(SCHOOL.split(' ').slice(0, 2).join(' '));
  const school = lp.locator('.ob-tcard', { hasText: SCHOOL }).first();
  check('learner: searching finds the school', await appears(school, 15_000));
  await school.click(); await send(lp).click(); await settle(lp);
  for (let i = 0; i < 40 && (await lp.locator('.ob-q button.on').count()) > 0; i++) await lp.locator('.ob-q button.on').first().click();
  await pick(lp, 'Physics'); await pick(lp, 'Chemistry'); await pick(lp, 'Mathematics'); await send(lp).click();
  await lp.waitForSelector('.ob-avas', { timeout: 20_000 }); await settle(lp);
  await lp.locator('.ob-avopt').nth(3).click(); await composer(lp).fill('Spark'); await send(lp).click();
  await lp.waitForSelector('.ob-search', { timeout: 20_000 }); await settle(lp);
  check('learner: the teacher can\'t be skipped', (await send(lp).isDisabled()) && (await chips(lp)).length === 0, await chips(lp));
  await composer(lp).fill(instructor.name);
  const teacher = lp.locator('.ob-tcard', { hasText: instructor.name }).first();
  check('learner: searching finds the new instructor', await appears(teacher));
  await teacher.click(); await send(lp).click();
  await lp.waitForSelector('.ob-seg', { timeout: 20_000 }); await settle(lp); await send(lp).click();
  check('learner: the summary appears', await appears(lp.locator('.ob-sum'), 30_000));
  await shot(lp, '4-learner-summary');
  await lp.getByRole('button', { name: /Start learning/ }).click();
  check('learner: "Start learning" lands on /app', await lp.waitForURL(/\/app(\?|$|\/)/, { timeout: 30_000 }).then(() => true, () => false), lp.url());
  await settle(lp, 3000); await shot(lp, '5-learner-dashboard');
  await lp.reload({ waitUntil: 'domcontentloaded' }); await settle(lp, 3000);
  check('learner: after a reload it stays on /app', /\/app/.test(lp.url()), lp.url());
  const me = await api(lp, '/api/profiles/me');
  check('learner saved: full name', me?.fullName === learner.name, me?.fullName);
  check('learner saved: Senior Secondary · SSS 2', me?.studyLevel === 'Senior Secondary' && me?.yearGroup === 'SSS 2', [me?.studyLevel, me?.yearGroup]);
  check('learner saved: school', me?.schoolName === SCHOOL, me?.schoolName);
  check('learner saved: subjects', ['Physics', 'Chemistry', 'Mathematics'].every((s) => (me?.subjects || []).includes(s)), me?.subjects);
  check('learner saved: onboarding completed', me?.onboardingCompleted === true, me?.onboardingCompleted);
  const agent = JSON.stringify(await api(lp, '/api/user/agent') || {});
  check('learner agent: name and avatar', agent.includes('Spark') && agent.includes('🦉'), agent.slice(0, 200));
  const link = await api(lp, '/api/profiles/me/teacher-link');
  check('learner: a pending request to the new instructor', link?.status === 'pending' && link?.teacher_name === `Dr. ${instructor.name}`, link);
}

/* ── 4. the instructor approves the learner ── */
async function teacherApproves(ip, I, lp, sp) {
  await ip.goto(`${I}/mgmt/join-requests`, { waitUntil: 'domcontentloaded' }); await settle(ip, 3000);
  const row = ip.locator('div', { hasText: learner.name }).filter({ has: ip.getByRole('button', { name: /Approve/ }) }).last();
  if (!check('instructor: the learner\'s request is listed', await appears(row))) return;
  await shot(ip, '6-instructor-requests');
  await row.getByRole('button', { name: /Approve/ }).click(); await settle(ip, 2500);
  const link = await api(lp, '/api/profiles/me/teacher-link');
  check('learner: an active member of the instructor\'s class', link?.status === 'active', link);
  if (!sp) return;
  const roster = await api(sp, '/api/school/students', 'school');
  check('school: the learner is on the school roster', (Array.isArray(roster) ? roster : []).some((s) => s.email === learner.email && s.status === 'active'), { count: Array.isArray(roster) ? roster.length : roster });
}

/* ── run ── */
await mkdir(OUT, { recursive: true });
const servers = [];
let browser;
try {
  note(`API ${API} · tag ${TAG} · instructor ${instructor.email} · learner ${learner.email}`);
  for (const app of Object.values(APPS)) servers.push(await serve(app));
  const [L, I, S] = servers.map((s) => s.url);
  const proxy = process.env.HTTPS_PROXY;
  browser = await chromium.launch({ headless: !flag('headed'), args: proxy ? [`--proxy-server=${proxy}`, '--proxy-bypass-list=127.0.0.1;localhost'] : [] });
  const phone = { ...devices['Pixel 7'], ignoreHTTPSErrors: !!proxy };
  const ip = await (await browser.newContext(phone)).newPage();
  await instructorOnboards(ip, I);
  const sp = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: !!proxy })).newPage();
  const schoolOk = await schoolApproves(sp, S, ip);
  const lp = await (await browser.newContext(phone)).newPage();
  await learnerOnboards(lp, L);
  await teacherApproves(ip, I, lp, schoolOk ? sp : null);
} catch (e) {
  check('the journey ran to the end', false, String(e?.stack || e).slice(0, 600));
} finally {
  await browser?.close().catch(() => {});
  servers.forEach((s) => s.stop());
  const failed = results.filter((r) => r.ok === false).length;
  await writeFile(path.join(OUT, `result-${TAG}.json`), JSON.stringify({ api: API, tag: TAG, instructor: instructor.email, learner: learner.email, passed: !failed, results }, null, 2));
  console.log(`\n${results.filter((r) => r.ok).length} passed, ${failed} failed · screenshots and result in ${path.relative(process.cwd(), OUT)}`);
  process.exit(failed ? 1 : 0);
}
