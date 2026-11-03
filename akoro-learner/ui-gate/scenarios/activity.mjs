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
      if (!shown) {
        // Why: what the server holds for this hand-in (the instructor's view of the target).
        const view = await teach('GET', `/api/self-study/${id}`);
        const tg = (view.body?.data?.targets || []).find((x) => x.student_id === t.learner.id);
        t.note(`no score after 60s — server: status=${tg?.status}, grade=${tg?.grade ?? null}, ai_grade=${JSON.stringify(tg?.ai_grade || null).slice(0, 300)}`);
      }
      if (shown) {
        t.check('1 of 2 right → 50%', /50%/.test(await score.innerText()), { text: (await score.innerText()).slice(0, 80) });
        t.check('flagged as marked by AI', /Marked by AI/i.test(await score.innerText()));
        t.check('the marked paper is shown under it', await page.getByText('Your marked paper').first().isVisible().catch(() => false));
      }
      await t.shot('score');
      t.check('no page errors', errors.length === 0, { errors: errors.slice(0, 3) });
    },
  },
  {
    name: 'activity.question_types',
    description: 'One paper with every kind of question — multiple choice, true/false, fill the gap, theory, essay, a labelled diagram, a calculation — answered in the app: typed, an uploaded file, and camera-capture photos. Review and the handed-in paper show every answer, with the photos under their own questions; the server holds the right files per question.',
    async run(t) {
      const { page } = t;
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
      const teach = await instructorApi(t);
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><rect x="20" y="20" width="160" height="80" fill="#cde" stroke="#345"/><text x="30" y="40">A</text><text x="150" y="90">B</text></svg>';
      const questions = [
        { q: 'Which is a noble gas?', type: 'mcq', options: ['Oxygen', 'Neon', 'Iron', 'Sodium'], correct: 1, max_points: 1, answer_space: 'options' },
        { q: 'Water boils at 100°C at sea level.', type: 'true_false', format: 'true_false', options: ['True', 'False'], correct: 0, max_points: 1, answer_space: 'true_false' },
        { q: 'Plants make their food by ____.', type: 'fill_blank', max_points: 1, answer_space: 'blank' },
        { q: 'Explain why leaves are green.', type: 'short_answer', max_points: 3, answer_space: 'lines' },
        { q: 'Discuss the importance of photosynthesis to life on Earth.', type: 'essay', max_points: 6, answer_space: 'lines' },
        { q: 'Label the parts A and B of the diagram.', type: 'label', format: 'label', labels: ['A', 'B'], figure: { svg, alt: 'A box with two marked corners', caption: 'Fig. 1' }, max_points: 2, answer_space: 'labels' },
        { q: 'A car travels 150 m in 30 s. Calculate its speed.', type: 'calculation', max_points: 3, answer_space: 'working' },
      ];
      const made = await teach('POST', '/api/self-study', {
        type: 'assignment', title: `${t.tag || '[ui-gate]'} Question types`, subject: 'Science', topic: 'Mixed',
        usernames: [t.learner.username], details: { questions, answer_format: 'all', ai_auto_grade: false },
      });
      if (made.status !== 201) t.block(`couldn't set the assignment (${made.status}: ${JSON.stringify(made.body)?.slice(0, 160)})`);
      const id = made.body.data.id;
      t.cleanup(() => teach('DELETE', `/api/self-study/${id}`));

      const next = () => page.getByRole('button', { name: /Submit answer & (next|review)|Skip for now|Review answers/ }).click();
      const type = (n, text) => page.getByLabel(`Answer to question ${n}`).fill(text);
      // A written answer is typed in the document editor: tap the box, type, close — the document becomes a file under the question.
      const writeInDoc = async (n, text) => {
        await page.getByTestId('write-in-doc').click();
        const editor = page.locator('.ProseMirror').first();
        await editor.waitFor({ timeout: 25_000 });
        await editor.click();
        await page.keyboard.type(text);
        await page.getByRole('button', { name: /Save to answer/ }).click();
        await page.getByRole('button', { name: /^Saved/ }).waitFor({ timeout: 30_000 }).catch(() => {});
        await page.getByRole('button', { name: 'Close the document' }).click();
        const tile = page.locator('[data-testid="file-tile"]', { hasText: 'Document' });
        t.check(`question ${n}: the document is attached to the answer`, await tile.first().waitFor({ timeout: 30_000 }).then(() => true, () => false));
      };
      // A finished upload is a file tile; while it goes up it is an upload tile with a spinner.
      const attached = (name) => page.locator('[data-testid="file-tile"]', { hasText: name }).first().waitFor({ timeout: 30_000 }).then(() => true, () => false);

      await page.goto(`${t.app}/activities/${id}`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('answer-dock').waitFor({ timeout: 25_000 });

      await type(1, 'B'); await next();
      await page.getByLabel('Answer to question 2').waitFor();
      await type(2, 'True'); await next();
      await page.getByLabel('Answer to question 3').waitFor();
      await type(3, 'photosynthesis'); await next();

      // Theory + an uploaded file (a photo from the gallery and a text file).
      await page.getByTestId('write-in-doc').waitFor({ timeout: 15_000 });
      t.check('a written answer opens a document, not a text box', (await page.locator('textarea[aria-label="Answer to question 4"]').count()) === 0);
      const files = page.locator('input[type=file]:not([capture])');
      await files.setInputFiles([{ name: 'workings-gallery.png', mimeType: 'image/png', buffer: PNG }]);
      t.check('a spinner tile shows while it uploads (or it has already landed)', (await page.getByTestId('upload-tile').count()) > 0 || (await page.getByTestId('file-tile').count()) > 0);
      t.check('an uploaded photo is attached to the question', await attached('workings-gallery.png'));
      await files.setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('chlorophyll reflects green light') }]);
      t.check('an uploaded text file is attached too', await attached('notes.txt'));
      await writeInDoc(4, 'Leaves contain chlorophyll, which reflects green light.');
      await t.shot('theory-upload'); await next();

      // Essay.
      await page.getByTestId('write-in-doc').waitFor({ timeout: 15_000 });
      await writeInDoc(5, 'Photosynthesis feeds almost every food chain and releases the oxygen we breathe. '.repeat(3)); await next();

      // Labelled diagram: the figure is on the page and each part has a box.
      await page.getByLabel('Part A').waitFor({ timeout: 10_000 });
      t.check('the diagram is shown with the question', (await page.locator('svg:has(text)').count()) > 0 || (await page.locator('img[alt*="box"], figure').count()) > 0);
      await page.getByLabel('Part A').fill('Corner one'); await page.getByLabel('Part B').fill('Corner two');
      await t.shot('diagram'); await next();

      // Calculation + camera capture (the camera input's file is what a phone's camera hands back).
      await page.getByTestId('write-in-doc').waitFor({ timeout: 15_000 });
      await writeInDoc(7, 'speed = 150 / 30 = 5 m/s');
      const cam = page.getByTestId('camera-input');
      await cam.setInputFiles([{ name: 'capture-1.png', mimeType: 'image/png', buffer: PNG }]);
      t.check('a camera photo is attached', await attached('capture-1.png'));
      await cam.setInputFiles([{ name: 'capture-2.png', mimeType: 'image/png', buffer: PNG }]);
      t.check('a second camera photo is attached', await attached('capture-2.png'));
      await t.shot('camera'); await next();

      // Review: the server paper, every answer in it, the photos under their questions.
      const review = page.locator('iframe[title="My answers"]');
      t.check('Review shows the server paper', await review.waitFor({ timeout: 25_000 }).then(() => true, () => false));
      const frame = page.frameLocator('iframe[title="My answers"]');
      await frame.locator('body').waitFor({ timeout: 15_000 }).catch(() => {});
      const reviewText = await frame.locator('body').innerText().catch(() => '');
      for (const w of ['chlorophyll', 'photosynthesis', 'Corner one', '5 m/s']) t.check(`Review shows "${w}"`, reviewText.includes(w));
      t.check('Review shows the photos (3)', (await frame.locator('img').count()) >= 3, { imgs: await frame.locator('img').count() });
      t.check('Review shows the diagram', (await frame.locator('svg, img').count()) >= 4);
      await t.shot('review');

      await page.getByRole('button', { name: /Submit assignment/ }).click();
      await page.getByRole('dialog', { name: /Hand in your assignment/ }).getByRole('button', { name: /^Submit/ }).click();
      const done = page.locator('iframe[title="My submission"]');
      t.check('the handed-in copy is the server paper', await done.waitFor({ timeout: 45_000 }).then(() => true, () => false));
      const sub = page.frameLocator('iframe[title="My submission"]');
      await sub.locator('body').waitFor({ timeout: 15_000 }).catch(() => {});
      t.check('the handed-in copy still has the photos', (await sub.locator('img').count()) >= 3);
      await t.shot('handed-in');

      // What the server holds: every answer, the right files under the right question.
      const mine = await t.api('GET', '/api/self-study/mine');
      const row = (mine.body?.data || []).find((r) => r.id === id);
      const doc = await t.api('GET', `/api/self-study/targets/${row?.targetId}/submission.json`);
      const qsOut = (doc.body?.data?.document?.parts || []).flatMap((p) => p.questions || []);
      t.equal('seven questions on the paper', qsOut.length, 7);
      t.equal('all seven answered', doc.body?.data?.document?.summary?.answered, 7);
      const filesOf = (i) => (qsOut[i]?.answer?.files || []).map((f) => f.name).sort().join(',');
      t.equal('theory: the photo, the text file and the document are under question 4', filesOf(3), 'document-q4.docx,notes.txt,workings-gallery.png');
      t.equal('calculation: both camera photos and the document are under question 7', filesOf(6), 'capture-1.png,capture-2.png,document-q7.docx');
      t.equal('the diagram answer was kept', /Corner one/.test(JSON.stringify(qsOut[5]?.answer || {})), true);
      t.check('no page errors', errors.length === 0, { errors: errors.slice(0, 3) });
    },
  },
];
