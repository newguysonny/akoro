/**
 * instructor.draft_previews — the battle and self-study draft previews
 * (Settings · Preview · Questions / Study plan), and Play: the simulated
 * battle and the simulated teaching session. For a person to look at.
 *
 * The drafts are FIXTURES served by intercepting their API routes in the
 * browser: nothing is created on any server. Element screenshots of the
 * preview area land in ui-gate/.out/previews/ (git-ignored).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.out', 'previews');
const inDays = (d, h) => { const t = new Date(Date.now() + d * 86400000); t.setHours(h, 0, 0, 0); return t.toISOString(); };

const AUDIENCE = { label: 'Everyone in Tester Class A', whole_class: true, class_name: 'Tester Class A', classroom_id: 'gatefake-class', resolved_count: 4, names: ['amaka', 'tobi', 'ada', 'femi'] };
const DRAFTS = {
  'gatefake-battle': {
    id: 'gatefake-battle', type: 'battle', status: 'draft', title: 'Fractions Showdown', audience: AUDIENCE, created_at: new Date().toISOString(),
    payload: { subject: 'Mathematics', topic: 'Fractions', difficulty: 'intermediate', details: { topic: 'Fractions', mode: 'battle', total_questions: 6, scheduled_at: inDays(2, 10), note: 'Bring a calculator.',
      // The draft's real questions (bank first, AI tops up), as the sandbox draft made them.
      questions: [
        ['What is 3/4 + 1/6?', ['10/12', '11/12', '4/10', '1'], 1],
        ['Simplify 18/24 to its lowest terms.', ['9/12', '3/4', '6/8', '2/3'], 1],
        ['Which fraction is equivalent to 3/4?', ['6/8', '4/3', '3/8', '9/16'], 0],
        ['What is 2/3 of 45?', ['15', '20', '30', '35'], 2],
        ['Arrange 2/3, 5/6, 1/2 and 1/4 in ascending order.', ['1/4, 1/2, 2/3, 5/6', '1/2, 1/4, 2/3, 5/6', '5/6, 2/3, 1/2, 1/4', '1/4, 2/3, 1/2, 5/6'], 0, 'NECO', 2018],
        ['Find the square root of 4/9.', ['2/9', '4/3', '2/3', '16/81'], 2, 'NCEE', 2019],
      ].map(([stem, opts, correctIndex, exam, year]) => ({ stem, options: opts.map((text, i) => ({ label: 'ABCD'[i], text })), correctIndex, topic: 'Fractions', ...(exam ? { exam, year } : {}) })) } },
  },
  'gatefake-review': {
    id: 'gatefake-review', type: 'battle', status: 'draft', title: 'Fractions review: Amaka', audience: { label: '@amaka in Tester Class A', class_name: 'Tester Class A', names: ['amaka'] }, created_at: new Date().toISOString(),
    payload: { subject: 'Mathematics', topic: 'Fractions', difficulty: 'intermediate', details: { topic: 'Fractions', mode: 'review', total_questions: 6 } },
  },
  'gatefake-assignment': {
    id: 'gatefake-assignment', type: 'assignment', status: 'draft', title: 'Photosynthesis — assignment', audience: AUDIENCE, created_at: new Date().toISOString(),
    payload: {
      subject: 'Basic Science', topic: 'Photosynthesis', due_at: inDays(4, 17), title: 'Photosynthesis — assignment',
      versions: [{
        n: 1, status: 'ready', note: 'First draft — 5 questions (3 MCQ · 1 Labelling · 1 Short answer) as asked.',
        summary: { count: 5, totalPoints: 12, line: '5 questions (3 MCQ · 1 Labelling · 1 Short answer) · 12 marks' },
        paper: {
          instructions: 'Answer all questions. Do not spend too much time on one question.',
          sections: [{ title: 'Part A – Multiple Choice', instructions: 'Each question carries 1 mark.' }, { title: 'Part B – Short Answers', instructions: 'Marks are shown at the end of each question.' }],
          questions: [
            { q: 'Where in a leaf cell does photosynthesis take place?', type: 'MCQ', options: ['Nucleus', 'Chloroplast', 'Cell wall', 'Vacuole'], correct: 1, max_points: 1, section: 0 },
            { q: 'Which gas do plants take in for photosynthesis?', type: 'MCQ', options: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], correct: 2, max_points: 1, section: 0 },
            { q: 'What is the green pigment in leaves called?', type: 'MCQ', options: ['Chlorophyll', 'Haemoglobin', 'Keratin', 'Melanin'], correct: 0, max_points: 1, section: 0 },
            { q: 'Name the labelled parts of the leaf.', type: 'Labelling', format: 'label', labels: ['P', 'Q'], label_answers: [{ label: 'P', answer: 'Vein' }, { label: 'Q', answer: 'Stoma' }], figure_note: 'A leaf: P on a vein, Q on a stoma.', max_points: 4, section: 0 },
            { q: 'Explain why plants need light to make food.', type: 'Short answer', answer: 'Light gives the energy chlorophyll traps to turn carbon dioxide and water into glucose. Without light no glucose is made.', max_points: 5, section: 1 },
          ],
        },
      }],
    },
  },
  'gatefake-selfstudy': {
    id: 'gatefake-selfstudy', type: 'self_study', status: 'draft', title: 'Photosynthesis: how plants make food', audience: AUDIENCE, created_at: new Date().toISOString(),
    payload: {
      subject: 'Basic Science', topic: 'Photosynthesis', due_at: inDays(5, 16),
      instructions: 'Teach your protégé how plants make their own food, one concept at a time.',
      subtopics: ['What photosynthesis is', 'Light and chlorophyll', 'The products: glucose and oxygen'],
      objectives: {
        'What photosynthesis is': ['Define photosynthesis in your own words', 'Name the raw materials a plant needs'],
        'Light and chlorophyll': ['Explain why leaves are green', 'Describe what chlorophyll does with light'],
        'The products: glucose and oxygen': ['Write the word equation for photosynthesis', 'Say what the plant does with the glucose'],
      },
    },
  },
};

export const draftPreviewScenarios = [{
  name: 'instructor.draft_previews',
  portal: 'instructor',
  description: 'Screenshots of the battle, assignment and self-study draft previews (Settings, Preview, Questions / Study plan) and of Play: the simulated battle (class battle and study review) and the simulated teaching session. Fixture drafts, intercepted in the browser — nothing is created.',
  async run(t) {
    const { page } = t;
    fs.mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 1500 });
    await page.route(/\/api\/self-study\/drafts\/gatefake-[a-z]+(\?.*)?$/, (route) => {
      const url = new URL(route.request().url());
      const id = url.pathname.split('/').find((s) => s.startsWith('gatefake-'));
      return route.fulfill({ json: { success: true, data: { draft: DRAFTS[id] } } });
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shots = [];
    const panel = () => page.locator('[data-preview-panel]').first();
    const snap = async (name) => { const f = path.join(OUT, `${name}.png`); await panel().screenshot({ path: f }); shots.push(f); };
    const tab = (label) => page.getByRole('tab', { name: new RegExp(`^${label}`) }).click();
    const open = async (id, ready) => {
      await page.goto(`${t.app}/activities/draft?draft=${id}`, { waitUntil: 'domcontentloaded' });
      await page.locator(ready).first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(1200);
    };

    // ── Battle draft (a class battle) ────────────────────────────────────
    await open('gatefake-battle', '[data-battle-preview]');
    await page.waitForTimeout(2500); await snap('01-battle-settings');
    await tab('Preview'); await page.waitForTimeout(500); await snap('02-battle-preview');
    await page.getByRole('button', { name: /Play preview/ }).click();
    await page.waitForTimeout(1000); await snap('03-battle-lobby');
    await page.waitForTimeout(2800); await snap('04-battle-question');
    await page.waitForTimeout(1800); await snap('05-battle-reveal');
    await page.locator('text=wins!').first().waitFor({ timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(400); await snap('06-battle-winner');
    await tab('Questions'); await page.waitForTimeout(500); await snap('07-battle-questions');

    // ── A study review (one learner, a mark sheet) ───────────────────────
    await open('gatefake-review', '[data-battle-preview]');
    await tab('Preview'); await page.getByRole('button', { name: /Play preview/ }).click();
    await page.waitForTimeout(4800); await snap('08-review-question');
    await page.locator('text=correct').first().waitFor({ timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(400); await snap('09-review-marksheet');

    // ── Assignment: Settings · Preview (a learner answers and submits) · Questions ──
    await page.route(/\/api\/self-study\/drafts\/gatefake-assignment\/paper\.html/, (route) => route.fulfill({ contentType: 'text/html', body: '<html><body style="font-family:Georgia;padding:24px"><h3>Photosynthesis — assignment</h3><p>Answer all questions. Do not spend too much time on one question.</p><p>Part A – Multiple Choice …</p></body></html>' }));
    await open('gatefake-assignment', '[data-assignment-preview]');
    await snap('16-assignment-settings');
    await tab('Preview'); await page.waitForTimeout(500); await snap('17-assignment-preview');
    await page.getByRole('button', { name: /Play preview/ }).click();
    await page.waitForTimeout(1500); await snap('18-assignment-q1-typing');
    await page.locator('[data-sim-question="4"]').waitFor({ timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2100); await snap('19-assignment-q4-labels');
    await page.locator('[data-sim-review]').waitFor({ timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(600); await snap('20-assignment-review');
    await page.locator('[data-sim-submitted]').waitFor({ timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(400); await snap('21-assignment-submitted');
    await tab('Questions'); await page.waitForTimeout(1500); await snap('22-assignment-questions');

    // ── Self study ───────────────────────────────────────────────────────
    await open('gatefake-selfstudy', '[data-selfstudy-preview]');
    await snap('10-selfstudy-settings');
    await page.getByRole('button', { name: /Review battle/ }).first().click();
    await page.waitForTimeout(400); await snap('11-selfstudy-review-battle');
    await tab('Preview'); await page.waitForTimeout(500); await snap('12-selfstudy-preview');
    await page.getByRole('button', { name: /Play preview/ }).click();
    await page.waitForTimeout(7000); await snap('13-selfstudy-session');
    await page.locator('text=End of the session').first().waitFor({ timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(500); await snap('14-selfstudy-session-end');
    await tab('Study plan'); await page.waitForTimeout(400); await snap('15-selfstudy-plan');

    t.note(`${shots.length} screenshots in ui-gate/.out/previews`);
    t.check('the previews rendered without errors', errors.length === 0, { errors: errors.slice(0, 5) });
    t.check('every screenshot was taken', shots.length === 22, { shots: shots.length });
  },
}];
