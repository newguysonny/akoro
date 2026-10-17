/**
 * Suite "chat" — the Agent Chat tab. History loads a page at a time: the
 * newest 10 messages on open, the page before them when the learner scrolls
 * to the top, with the reading position kept.
 *
 * Makes its own chat (named with a run marker) with 13 messages through the
 * API and deletes it at the end.
 */

const newMarker = () => `[ui-gate:${Math.random().toString(16).slice(2, 8)}]`;
const TOTAL = 13;

export const scenarios = [
  {
    name: 'chat.history_pages',
    description: 'Opening a chat shows only its newest 10 messages; scrolling to the top loads the earlier ones above, keeping the place.',
    async run(t) {
      const { page } = t;
      const marker = newMarker();
      const made = await t.api('POST', '/api/adaptive/chat/sessions', { title: `${marker} history pages` });
      const chatId = made.body?.session?.id;
      if (!chatId) t.block(`creating a chat answered ${made.status}: ${made.body?.error || ''}`);
      t.cleanup(async () => { await t.api('DELETE', `/api/adaptive/chat/sessions/${chatId}`); });
      for (let i = 1; i <= TOTAL; i++) {
        const sent = await t.api('POST', `/api/adaptive/chat/sessions/${chatId}/messages`, { role: i % 2 ? 'user' : 'agent', text: `${marker} history message ${i}` });
        if (sent.status >= 300) t.block(`adding message ${i} answered ${sent.status}`);
      }

      // The newest chat opens on its own when the chat tab loads.
      await page.goto(`${t.app}/app?tab=agent`, { waitUntil: 'domcontentloaded' });
      const newest = page.getByText(`${marker} history message ${TOTAL}`, { exact: true });
      await newest.waitFor({ timeout: 45_000 }).catch(() => {});
      t.check('the chat opens on its newest message', await newest.isVisible());
      // Rendered text may sit in nested markup: count distinct numbers instead.
      const numbers = async () => page.evaluate((m) => {
        const found = new Set();
        const re = new RegExp(`${m.replace(/[[\]]/g, '\\$&')} history message (\\d+)`, 'g');
        for (const match of document.body.innerText.matchAll(re)) found.add(Number(match[1]));
        return [...found].sort((a, b) => a - b);
      }, marker);
      const first = await numbers();
      t.check('only the newest 10 are loaded', first.length === 10 && first[0] === TOTAL - 9, { actual: first });

      // Scroll the feed to the top: the earlier messages load above.
      const anchor = page.getByText(`${marker} history message ${TOTAL - 9}`, { exact: true });
      const before = await anchor.boundingBox();
      await page.evaluate(({ m, n }) => {
        // The innermost element holding the newest message, then its scrolling feed.
        const el = [...document.querySelectorAll('body *')].reverse().find((d) => d.textContent.includes(`${m} history message ${n}`));
        let feed = el?.parentElement;
        while (feed && !(feed.scrollHeight > feed.clientHeight && /auto|scroll/.test(getComputedStyle(feed).overflowY))) feed = feed.parentElement;
        if (feed) feed.scrollTop = 0;
      }, { m: marker, n: TOTAL });
      const oldest = page.getByText(`${marker} history message 1`, { exact: true });
      await oldest.waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {});
      const all = await numbers();
      t.check('scrolling to the top loads the earlier messages', all.length === TOTAL && all[0] === 1, { actual: all });
      const after = await anchor.boundingBox();
      // The message that was at the top stays on screen (not pushed far below).
      t.check('the reading place is kept', !!before && !!after && after.y >= -5 && after.y < (page.viewportSize()?.height || 900), { actual: { before: before?.y, after: after?.y } });
    },
  },
];
