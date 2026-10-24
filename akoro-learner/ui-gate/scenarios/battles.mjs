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
];
