/**
 * Suite "battles" — the Challenges tab (reference/Akoro Battles — Model.md):
 * one list, one compact card per challenge with Format / Scope / Timing
 * fields, filter chips instead of sections; a card opens the challenge sheet
 * (a bottom sheet on phones, a dialog on desktop).
 */
export const scenarios = [
  {
    name: 'battles.challenges_tab',
    description: 'The Challenges tab is one list of compact cards (Format · Scope · Timing) with filter chips; tapping a card opens its sheet.',
    async run(t) {
      const { page } = t;
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${t.app}/app?tab=challenges`, { waitUntil: 'domcontentloaded' });
      const all = page.getByRole('button', { name: /^All\s*\d+/ });
      t.check('the filter chips are there', await all.first().waitFor({ timeout: 20_000 }).then(() => true, () => false));
      // Loaded = cards or the empty message (the requests come from a second API).
      await page.locator('button:has-text("FORMAT"), :text("No challenges right now"), :text("Nothing here")').first()
        .waitFor({ timeout: 25_000 }).catch(() => {});
      t.check('no old sections ("Open to you", "You\'ve joined")',
        !(await page.getByText(/OPEN TO YOU|You've joined — waiting to fill|Peer Challenges/i).first().isVisible().catch(() => false)));
      const cards = page.locator('button:has-text("FORMAT")');
      const n = await cards.count();
      t.note(`${n} card(s)`);
      await t.shot('list');
      if (!n) {
        t.check('an empty list says so', await page.getByText(/No challenges right now|Nothing here/).first().isVisible().catch(() => false));
      } else {
        await cards.first().click();
        const sheet = page.getByRole('dialog');
        t.check('a card opens its sheet', await sheet.first().waitFor({ timeout: 8_000 }).then(() => true, () => false));
        const box = await sheet.first().boundingBox().catch(() => null);
        const vw = page.viewportSize()?.width || 0;
        if (box && vw > 1024) t.check('on desktop it is a centred dialog', box.width < vw * 0.6 && box.y > 10, { box, vw });
        if (box && vw <= 1024) t.check('on a phone it is a bottom sheet', Math.abs(box.x) < 2 && Math.round(box.width) >= vw - 2, { box, vw });
        await t.shot('sheet');
        await page.keyboard.press('Escape');
        t.check('Escape closes it', await sheet.first().waitFor({ state: 'detached', timeout: 5_000 }).then(() => true, () => false));
      }
      t.check('no page errors', errors.length === 0, { actual: errors.slice(0, 3) });
    },
  },
  {
    name: 'battles.questions_menu',
    description: 'A finished battle\'s Questions tab: ALL QUESTIONS, the ⋮ menu (Download as PDF, Create activity and Agent session marked Soon) and the PDF download. A fixture battle, intercepted in the browser — nothing is created.',
    async run(t) {
      const { page } = t;
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const ID = '00000000-0000-4000-8000-0000000fa4e0';
      const qs = [
        ['Where in the leaf does photosynthesis happen?', ['Roots', 'Chloroplasts', 'Stem', 'Flowers'], 1],
        ['Which gas do plants give off in photosynthesis?', ['Oxygen', 'Nitrogen', 'Helium', 'Argon'], 0],
        ['Why are leaves green?', ['They absorb green light', 'Chlorophyll reflects green light', 'Water is green', 'Glucose is green'], 1],
      ];
      const fixtures = {
        state: { status: 'completed', battleType: 'check', reviewHost: 'teacher', participants: [], viewer_count: 0 },
        questions: { total: qs.length, questions: qs.map(([text, options, c], i) => ({ questionOrder: i + 1, questionText: text, options, topic: 'Photosynthesis', correctAnswerIndex: c, correctAnswer: options[c], myAnswer: c, isCorrect: true, xpGained: 0 })) },
        log: { logs: [] },
        results: { type: 'check', score: { correct: 3, total: 3, wrong: 0, unanswered: 0, guessed: 0, percent: 100 }, markSheet: [], learner: null, battle: { id: ID } },
      };
      let pdfAsked = false;
      await page.route(new RegExp(`/api/battle/battles/${ID}/(state|questions|log|results|questions\\.pdf)(\\?.*)?$`), (route) => {
        const what = new URL(route.request().url()).pathname.split('/').pop();
        if (what === 'questions.pdf') { pdfAsked = true; return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%fixture\n' }); }
        return route.fulfill({ json: fixtures[what] });
      });
      await page.goto(`${t.app}/app?tab=battles&battle=${ID}`, { waitUntil: 'domcontentloaded' });
      const tab = page.getByRole('button', { name: /^Questions$/ });
      t.check('the finished battle opens', await tab.first().waitFor({ timeout: 25_000 }).then(() => true, () => false));
      await tab.first().click();
      t.check('ALL QUESTIONS, with the count', await page.getByText('ALL QUESTIONS').first().waitFor({ timeout: 8_000 }).then(() => true, () => false));
      const menuBtn = page.getByRole('button', { name: 'Question options' });
      t.check('the ⋮ button sits beside the count', await menuBtn.first().isVisible().catch(() => false));
      await t.shot('questions-tab');
      await menuBtn.first().click();
      const menu = page.getByRole('menu');
      t.check('it opens the menu', await menu.first().waitFor({ timeout: 5_000 }).then(() => true, () => false));
      const items = (await page.getByRole('menuitem').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
      t.check('three options: Download as PDF, Create activity (Soon), Agent session (Soon)',
        items.length === 3 && /^Download as PDF/.test(items[0]) && /^Create activity\s*Soon$/.test(items[1]) && /^Agent session\s*Soon$/.test(items[2]), { actual: items });
      t.check('the coming-soon ones are disabled', await page.getByRole('menuitem', { name: /Create activity/ }).isDisabled() && await page.getByRole('menuitem', { name: /Agent session/ }).isDisabled());
      await t.shot('questions-menu');
      const dl = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
      await page.getByRole('menuitem', { name: /Download as PDF/ }).click();
      const file = await dl;
      t.check('Download as PDF asks the API and saves a .pdf', pdfAsked && !!file && /questions\.pdf$/.test(file.suggestedFilename()), { pdfAsked, name: file?.suggestedFilename() });
      t.check('the menu closes after the download', await menu.first().waitFor({ state: 'detached', timeout: 5_000 }).then(() => true, () => false));
      t.check('no page errors', errors.length === 0, { actual: errors.slice(0, 3) });
    },
  },
  {
    name: 'battles.waiting_to_fill',
    description: 'Challenges holds only what waits for my answer (no Joined or Mine); a request I joined waits in Battles → Scheduled under "Waiting to fill", named by who posted it, and opens its sheet. Fixture requests, intercepted in the browser — nothing is created.',
    async run(t) {
      const { page } = t;
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const at = new Date(Date.now() + 2 * 86400000).toISOString();
      const joined = { id: 'gatefake-joined', title: 'Gate team battle (joined)', battle_type: 'team', subject: 'Economics', max_players: 4, accepted_by: ['me'], scheduled_for: at, status: 'open',
        by: { userId: 'u9', name: 'Tola', username: '@tester09', agent: '🦉 Bolt', level: 3 } };
      const open = { id: 'gatefake-open', title: 'Gate open 1v1', kind: '1v1', subject: 'Physics', seats: '1/2', scheduledFor: at, by: { userId: 'u8', name: 'Ada', username: '@tester08', agent: '🐨 Nova', level: 2 } };
      await page.route(/\/api\/agent-network\/challenge-requests\?.*$/, (route) => {
        const q = new URL(route.request().url()).searchParams;
        const requests = q.get('joined') ? [joined] : q.get('mine') ? [] : [open];
        return route.fulfill({ json: { success: true, data: { requests, total: requests.length } } });
      });
      await page.goto(`${t.app}/app?tab=challenges`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: /^All\s*\d+/ }).first().waitFor({ timeout: 20_000 }).catch(() => {});
      await page.getByText('Gate open 1v1').first().waitFor({ timeout: 20_000 }).catch(() => {});
      t.check('an open request is in Challenges', await page.getByText('Gate open 1v1').first().isVisible().catch(() => false));
      t.check('a request I joined is NOT in Challenges', !(await page.getByText('Gate team battle (joined)').first().isVisible().catch(() => false)));
      const chips = (await page.locator('button').filter({ hasText: /^(All|Invites|Open|Joined|Reviews|Recurring|Mine)\s*\d+$/ }).allInnerTexts()).map((x) => x.replace(/\s*\d+$/, '').trim());
      t.check('no Joined or Mine chip in Challenges', !chips.includes('Joined') && !chips.includes('Mine'), { actual: chips });
      await t.shot('challenges');

      await page.goto(`${t.app}/app?tab=battles`, { waitUntil: 'domcontentloaded' });
      const sched = page.getByRole('button', { name: /Scheduled/ }).first();
      await sched.waitFor({ timeout: 20_000 }).catch(() => {});
      await sched.click().catch(() => {});
      const group = page.locator('[data-waiting-to-fill]');
      t.check('Battles → Scheduled has "Waiting to fill"', await group.first().waitFor({ timeout: 15_000 }).then(() => true, () => false));
      t.check('…with the joined request, named by who posted it (not "Someone")', await group.getByText('Gate team battle (joined)').first().isVisible().catch(() => false) && await group.getByText(/Tola/).first().isVisible().catch(() => false));
      await t.shot('battles-scheduled');
      await group.getByText('Gate team battle (joined)').first().click();
      t.check('tapping it opens its sheet ("You\'re in")', await page.getByText(/You're in/).first().waitFor({ timeout: 8_000 }).then(() => true, () => false));
      await t.shot('waiting-sheet');
      t.check('no page errors', errors.length === 0, { actual: errors.slice(0, 3) });
    },
  },
];
