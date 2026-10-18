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
    run: (t) => historyPagesCheck(t, { path: '/app?tab=agent' }),
  },
  {
    name: 'chat.suggestions_inbox',
    description: "The agent's ideas show in one Suggestions list; accepting a task idea adds the task; dismissing asks why and keeps the reason.",
    async run(t) {
      const { page } = t;
      const marker = newMarker();
      const ideas = { task: `${marker} Revise titration`, later: `${marker} Make flashcards on bonding` };
      // The agent files them in a chat turn (its suggest_help tool), as it would on its own.
      const turn = await t.api('POST', '/api/adaptive/chat/agent', { history: [],
        message: `Please save two task ideas in my Suggestions list, exactly titled "${ideas.task}" and "${ideas.later}". Use your suggestion tool — don't create tasks.` });
      t.cleanup(async () => {
        const left = await t.api('GET', '/api/agent/proposals/inbox');
        for (const it of (left.body?.data || []).filter((x) => String(x.title).includes(marker))) await t.api('POST', `/api/agent/proposals/inbox/${it.ref}/dismiss`, { reason: 'other' });
        const tasks = await t.api('GET', '/api/tasks');
        for (const tk of (tasks.body?.tasks || tasks.body?.data || []).filter((x) => String(x.title).includes(marker))) await t.api('DELETE', `/api/tasks/${tk.id}`);
      });
      const inbox = await t.api('GET', '/api/agent/proposals/inbox');
      const mine = (inbox.body?.data || []).filter((x) => String(x.title).includes(marker));
      if (mine.length < 2) t.block(`the agent filed ${mine.length} of the 2 ideas (turn ${turn.status}) — nothing to show`);

      await page.goto(`${t.app}/app?tab=agent`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: /^Tasks/ }).first().click({ timeout: 30_000 });
      await page.getByRole('button', { name: /^Suggestions/ }).first().click();
      const card = (title) => page.locator('div', { hasText: title }).filter({ has: page.getByRole('button', { name: 'Dismiss' }) }).last();
      t.check('both ideas show in the one list', await page.getByText(ideas.task, { exact: true }).waitFor({ timeout: 20_000 }).then(() => true, () => false)
        && await page.getByText(ideas.later, { exact: true }).isVisible());

      // Dismiss: asks why, then the idea is gone with its reason kept.
      await card(ideas.later).getByRole('button', { name: 'Dismiss' }).click();
      t.check('dismissing asks why', await page.getByText(/Why not\?/).first().waitFor({ timeout: 8_000 }).then(() => true, () => false));
      await page.getByRole('button', { name: 'Not now', exact: true }).first().click();
      t.check('…and the idea leaves the list', await page.getByText(ideas.later, { exact: true }).waitFor({ state: 'detached', timeout: 10_000 }).then(() => true, () => false));

      // Accept the task idea: the task exists.
      await card(ideas.task).getByRole('button', { name: /Add as task/ }).click();
      t.check('accepting leaves the list', await page.getByText(ideas.task, { exact: true }).waitFor({ state: 'detached', timeout: 15_000 }).then(() => true, () => false));
      // Read back (a short retry: a burst of calls can meet the API's rate limit).
      let found = false, last = null;
      for (let i = 0; i < 5 && !found; i++) {
        last = await t.api('GET', '/api/tasks?status=pending');
        found = (last.body?.tasks || []).some((x) => x.title === ideas.task);
        if (!found) await page.waitForTimeout(3_000);
      }
      t.check('…as a real task', found, { actual: `${last?.status} · ${(last?.body?.tasks || []).length} tasks` });
      const after = await t.api('GET', '/api/agent/proposals/inbox');
      t.check('neither is in the inbox any more', !(after.body?.data || []).some((x) => String(x.title).includes(marker)));
    },
  },
  {
    name: 'settings.memory_controls',
    description: 'Settings → Agent → Memory shows what the agent remembers and the "Learn from my conversations" switch, which saves and survives a reload.',
    async run(t) {
      const { page } = t;
      const was = await t.api('GET', '/api/agent-memory/v1/settings');
      if (was.status !== 200) t.block(`memory settings answered ${was.status}`);
      const learning = was.body?.learnFromChats !== false;
      t.cleanup(async () => { await t.api('PATCH', '/api/agent-memory/v1/settings', { learnFromChats: learning }); });
      const notes = ((await t.api('GET', '/api/agent-memory/v1/memories')).body?.memories || []).length;

      const open = async () => {
        await page.goto(`${t.app}/settings`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: /Account/ }).first().locator('xpath=following-sibling::button[1]').click({ timeout: 30_000 });
        await page.getByText('Learn from my conversations', { exact: true }).waitFor({ timeout: 20_000 });
      };
      await open();
      t.check('the Memory section is there', await page.getByText('Memory', { exact: true }).first().isVisible());
      t.check(notes ? 'its notes are listed' : 'it says nothing is remembered yet',
        notes ? await page.getByRole('button', { name: /^Forget: / }).first().isVisible() : await page.getByText(/Nothing remembered yet/).isVisible(), { actual: notes });
      // The switch: flip it, the server has it, a reload shows it.
      const row = page.getByText('Learn from my conversations', { exact: true }).locator('xpath=ancestor::*[.//div[contains(@style,"width: 42px")]][1]');
      await row.locator('div[style*="width: 42px"]').first().click();
      let saved = null;
      for (let i = 0; i < 5 && saved !== !learning; i++) { await page.waitForTimeout(800); saved = (await t.api('GET', '/api/agent-memory/v1/settings')).body?.learnFromChats; }
      t.check('flipping the switch saves it', saved === !learning, { actual: saved });
      await open();
      const knob = page.getByText('Learn from my conversations', { exact: true }).locator('xpath=ancestor::*[.//div[contains(@style,"width: 42px")]][1]').locator('div[style*="width: 42px"] > div').first();
      const left = await knob.evaluate((el) => el.style.left);
      t.check('…and a reload shows it', (left === '21px') === !learning, { actual: left });
    },
  },
];

/**
 * The paging check, for any app's chat page: makes a 13-message chat, opens
 * the page, checks only the newest 10 are shown, scrolls to the top and checks
 * the rest load above with the place kept. Shared with the instructor suite.
 */
export async function historyPagesCheck(t, { path }) {
  const { page } = t;
  const marker = newMarker();
  const made = await t.api('POST', '/api/adaptive/chat/sessions', { title: `${marker} history pages` });
  const chatId = made.body?.session?.id;
  if (!chatId) t.block(`creating a chat answered ${made.status}: ${made.body?.error || ''}`);
  t.cleanup(async () => { await t.api('DELETE', `/api/adaptive/chat/sessions/${chatId}`); });
  for (let i = 1; i <= TOTAL; i++) {
    const sent = await t.api('POST', `/api/adaptive/chat/sessions/${chatId}/messages`, { role: i % 2 ? 'user' : 'agent', text: `${marker} history message ${i}` });
    if (sent.status >= 300) t.block(`adding message ${i} answered ${sent.status}`);
    // Paced: back-to-back runs (phone, then desktop) otherwise meet the API's rate limit.
    await new Promise((r) => setTimeout(r, 300));
  }

  // The newest chat opens on its own when the chat page loads.
  await page.goto(`${t.app}${path}`, { waitUntil: 'domcontentloaded' });
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
}
