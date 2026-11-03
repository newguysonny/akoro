/**
 * Suite "activity" — an assignment worked through in the learner app, against the real API:
 * the answer dock is fixed to the bottom, the camera control is there, the Review step shows the server's
 * paper template, and a hand-in on an auto-graded assignment shows "Marking your answers…" and then the score.
 *
 * The assignment is made by an instructor test account (tester51) through the API, marked with the run's
 * [ui-gate:xxxxxx] tag, and deleted at the end. The paper is multiple-choice only, so the answer key marks it
 * (no model call) and the score arrives in seconds.
 */
import { EDGE_HEADER } from '../lib/gate.mjs';

const DEMO_PASSWORD = 'Password123!';
const QS = [
  { q: 'Which is a noble gas?', type: 'mcq', options: ['Oxygen', 'Neon', 'Iron', 'Sodium'], correct: 1, max_points: 2, answer_space: 'options' },
  { q: 'Which metal is liquid at room temperature?', type: 'mcq', options: ['Iron', 'Mercury', 'Gold', 'Zinc'], correct: 1, max_points: 2, answer_space: 'options' },
];

/** Sign in as the instructor test account in a second browser context; returns an API caller. */
async function instructorApi(t) {
  const browser = t.context.browser();
  const ctx = await browser.newContext({ extraHTTPHeaders: EDGE_HEADER || {} });
  t.cleanup(() => ctx.close().catch(() => {}));
  const base = t.app.startsWith('http://127.0.0.1') || t.app.startsWith('http://localhost') ? t.app : null;
  const apiBase = base || process.env.UI_GATE_API || 'https://api.akoro.name.ng';
  const login = await ctx.request.post(`${apiBase}/api/auth/login`, {
    headers: { 'X-Akoro-Portal': 'instructor', 'Content-Type': 'application/json' },
    data: { email: 'tester51@demo.akoro.app', password: process.env.UI_GATE_PASSWORD || DEMO_PASSWORD },
  });
  const body = await login.json().catch(() => ({}));
  const token = (body.data || body).accessToken;
  if (!login.ok() || !token) t.block(`the instructor test account (tester51) couldn't sign in (${login.status()})`);
  return async (method, p, data) => {
    const r = await ctx.request.fetch(`${apiBase}${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'instructor', Authorization: `Bearer ${token}` }, ...(data !== undefined ? { data } : {}) });
    return { status: r.status(), body: await r.json().catch(() => null) };
  };
}

export const scenarios = [
  {
    name: 'activity.answer_review_score',
    description: 'An auto-graded assignment: the answer dock is fixed to the bottom with a camera control, Review shows the server paper, and handing in shows "Marking your answers…" then the score ring.',
    async run(t) {
      const { page } = t;
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const teach = await instructorApi(t);
      const made = await teach('POST', '/api/self-study', {
        type: 'assignment', title: `${t.tag || '[ui-gate]'} Gases`, subject: 'Chemistry', topic: 'Gases',
        usernames: [t.learner.username],
        details: { questions: QS, answer_format: 'all', ai_auto_grade: true, total_points: 4 },
      });
      if (made.status !== 201) t.block(`couldn't set the assignment (${made.status}: ${JSON.stringify(made.body)?.slice(0, 160)})`);
      const id = made.body.data.id;
      t.cleanup(() => teach('DELETE', `/api/self-study/${id}`));

      await page.goto(`${t.app}/activities/${id}`, { waitUntil: 'domcontentloaded' });
      const dock = page.getByTestId('answer-dock');
      t.check('the answer dock is on the page', await dock.waitFor({ timeout: 25_000 }).then(() => true, () => false));
      const vh = page.viewportSize()?.height || 0;
      const box = await dock.boundingBox().catch(() => null);
      t.check('the dock sits at the bottom of the screen', !!box && Math.abs(box.y + box.height - vh) < 3, { box, vh });
      t.check('there is a camera control', (await page.getByTestId('camera-input').count()) === 1);
      t.check('it opens the camera (capture)', (await page.getByTestId('camera-input').getAttribute('capture').catch(() => null)) === 'environment');
      await t.shot('dock');

      // Q1 right (B), Q2 wrong (A).
      await page.getByLabel('Answer to question 1').fill('B');
      await page.getByRole('button', { name: /Submit answer & next/ }).click();
      await page.getByLabel('Answer to question 2').waitFor({ timeout: 10_000 });
      await page.getByLabel('Answer to question 2').fill('A');
      await page.getByRole('button', { name: /Submit answer & review/ }).click();

      // Review: the server's paper template.
      const paper = page.locator('iframe[title="My answers"]');
      t.check('Review shows the server paper (the same template as the handed-in copy)', await paper.waitFor({ timeout: 25_000 }).then(() => true, () => false));
      await t.shot('review');

      await page.getByRole('button', { name: /Submit assignment/ }).click();
      await page.getByRole('dialog', { name: /Hand in your assignment/ }).getByRole('button', { name: /^Submit/ }).click();

      // Marking, then the score.
      const t0 = Date.now();
      const score = page.getByTestId('score-card');
      const shown = await score.waitFor({ timeout: 60_000 }).then(() => true, () => false);
      const secs = Math.round((Date.now() - t0) / 100) / 10;
      t.note(`the score card appeared ${secs}s after Submit`);
      t.check('the score appears without leaving the page', shown);
      if (shown) {
        t.check('1 of 2 right → 50%', /50%/.test(await score.innerText()), { text: (await score.innerText()).slice(0, 80) });
        t.check('flagged as marked by AI', /Marked by AI/i.test(await score.innerText()));
        t.check('the marked paper is shown under it', await page.getByText('Your marked paper').first().isVisible().catch(() => false));
      }
      await t.shot('score');
      t.check('no page errors', errors.length === 0, { errors: errors.slice(0, 3) });
    },
  },
];
