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
    payload: { subject: 'Mathematics', topic: 'Fractions', difficulty: 'intermediate', details: { topic: 'Fractions', mode: 'battle', total_questions: 6, scheduled_at: inDays(2, 10), note: 'Bring a calculator.' } },
  },
  'gatefake-review': {
    id: 'gatefake-review', type: 'battle', status: 'draft', title: 'Fractions review: Amaka', audience: { label: '@amaka in Tester Class A', class_name: 'Tester Class A', names: ['amaka'] }, created_at: new Date().toISOString(),
    payload: { subject: 'Mathematics', topic: 'Fractions', difficulty: 'intermediate', details: { topic: 'Fractions', mode: 'review', total_questions: 6 } },
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
  description: 'Screenshots of the battle and self-study draft previews (Settings, Preview, Questions / Study plan) and of Play: the simulated battle (class battle and study review) and the simulated teaching session. Fixture drafts, intercepted in the browser — nothing is created.',
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
    t.check('every screenshot was taken', shots.length === 15, { shots: shots.length });
  },
}];
