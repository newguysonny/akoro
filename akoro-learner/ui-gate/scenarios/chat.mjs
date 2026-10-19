/**
 * Suite "chat" — the Agent Chat tab. History loads a page at a time: the
 * newest 10 messages on open, the page before them when the learner scrolls
 * to the top, with the reading position kept.
 *
 * Makes its own chat (named with a run marker) with 13 messages through the
 * API and deletes it at the end.
 */

/** A two-page past paper (numbered questions, printed marks), printed by the browser itself. */
async function pastPaperPdf(browser) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const qs = [
    ['1', '(a) Define osmosis. (b) Describe an experiment using potato strips to show osmosis in plant tissue.', 12],
    ['2', 'Explain how the rate of diffusion is affected by temperature and concentration gradient.', 8],
    ['3', '(a) Construct a food web for a pond habitat with five organisms. (b) Explain the role of decomposers in an ecosystem.', 15],
    ['4', 'Using a genetic diagram, show the result of crossing a heterozygous tall pea plant with a dwarf pea plant.', 10],
    ['5', 'Describe the structure of the mammalian heart and explain how blood flows through it.', 15],
  ];
  const q = (x) => `<p><b>${x[0]}.</b> ${x[1]} <i>[${x[2]} marks]</i></p>`;
  await p.setContent(`<style>body{font:14px Georgia,serif;margin:48px} p{margin:26px 0;line-height:1.5}</style>
    <h3>WEST AFRICAN SENIOR SCHOOL CERTIFICATE EXAMINATION 2019 — BIOLOGY PAPER 2 (Essay)</h3><p>Answer all questions.</p>
    ${qs.slice(0, 3).map(q).join('')}<div style="page-break-after:always"></div>${qs.slice(3).map(q).join('')}`);
  const pdf = await p.pdf({ format: 'A4' });
  await ctx.close();
  return pdf;
}

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
    name: 'chat.materials_links',
    description: "Materials the agent finds show as links under its reply: a Library record opens in the Library; the record is deleted afterwards.",
    async run(t) {
      const { page } = t;
      const marker = newMarker();
      const made = await t.api('POST', '/api/records', { kind: 'paste', name: `${marker} Mitochondria notes`,
        content: 'Mitochondria are the sites of aerobic respiration. They release the energy stored in glucose.' });
      const record = made.body?.data?.record || made.body?.data;
      if (!record?.id) t.block(`saving the pasted record answered ${made.status}: ${made.body?.message || ''}`);
      t.cleanup(async () => { await t.api('DELETE', `/api/records/${record.id}`); });

      t.cleanup(async () => {
        const list = await t.api('GET', '/api/adaptive/chat/sessions');
        for (const c of (list.body?.sessions || list.body?.data || []).filter((x) => String(x.title || '').includes(marker))) await t.api('DELETE', `/api/adaptive/chat/sessions/${c.id}`);
      });

      // A fresh chat: an old answer in the history must not stand in for a search.
      await page.goto(`${t.app}/app?tab=agent`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Chats', exact: true }).first().click({ timeout: 30_000 });
      await page.getByRole('button', { name: /New chat/ }).first().click();
      const box = page.getByRole('textbox', { name: /^Ask / }).last();
      await box.waitFor({ timeout: 30_000 });
      await box.fill(`Search my library for "${marker} Mitochondria notes" — do I have it?`);
      await box.press('Enter');
      const link = page.locator(`button[data-material="record"]`, { hasText: marker }).first();
      const shown = await link.waitFor({ timeout: 90_000 }).then(() => true, () => false);
      const all = await page.locator('button[data-material]').allInnerTexts().catch(() => []);
      t.note(`material chips: ${all.join(' | ')}`);
      // The reply is saved with its links: a reopened chat shows them too.
      const chats = await t.api('GET', '/api/adaptive/chat/sessions');
      const rows = chats.body?.sessions || chats.body?.data || [];
      t.note(`chats: ${rows.slice(0, 3).map((c) => `${String(c.id).slice(0, 8)} "${String(c.title || '').slice(0, 50)}"`).join(' · ')}`);
      const mine = rows.find((c) => String(c.title || '').includes(marker));
      t.check('the turn is in a fresh chat of its own', !!mine);
      if (mine) {
        const saved = await t.api('GET', `/api/adaptive/chat/sessions/${mine.id}/messages?limit=10`);
        const reply = (saved.body?.messages || []).filter((m) => m.role !== 'user').pop();
        t.note(`saved reply meta: ${JSON.stringify(reply?.meta || null).slice(0, 300)}`);
        t.note(`saved reply: ${String(reply?.text || '').slice(0, 300)} · tools: ${JSON.stringify((reply?.trace || []).map((b) => b.tool || b.type)).slice(0, 300)}`);
        t.check('…and the saved reply keeps the link', (reply?.meta?.materials || []).some((m) => m.href === `/library?record=${record.id}`));
      }
      t.check('the record shows as a link under the reply', shown);
      if (!shown) return;
      await link.click();
      t.check('…which opens it in the Library', await page.waitForURL((u) => u.pathname === '/library' && u.searchParams.get('record') === record.id, { timeout: 15_000 }).then(() => true, () => false),
        { actual: page.url() });
    },
  },
  {
    name: 'chat.upload_saved',
    description: "A file dropped into Agent Chat is saved to a private Library folder for its subject, read, and the reply's card says so; the first chip is the study step; Undo moves it to Recently deleted and Restore brings it back.",
    async run(t) {
      const { page, context } = t;
      const marker = newMarker();
      const tag = marker.replace(/[^a-z0-9]/gi, '').slice(-6);
      const fileName = `WAEC Biology${tag} 2019 Paper 2.pdf`;
      const pdf = await pastPaperPdf(context.browser());
      t.cleanup(async () => {
        const chats = await t.api('GET', '/api/adaptive/chat/sessions');
        for (const c of (chats.body?.sessions || chats.body?.data || []).filter((x) => String(x.title || '').includes(tag))) await t.api('DELETE', `/api/adaptive/chat/sessions/${c.id}`);
        const recs = await t.api('GET', '/api/records');
        for (const r of (recs.body?.data || []).filter((x) => String(x.name || '').includes(tag))) await t.api('DELETE', `/api/records/${r.id}`);
      });

      const calls = [];
      page.on('response', (r) => { if (/\/api\/(adaptive\/chat\/agent|agent\/materials)/.test(r.url())) calls.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
      // The chat's first load must land before a new chat is opened, or it replaces it.
      const firstLoad = page.waitForResponse((r) => /\/api\/adaptive\/chat\/sessions(\?|$|\/[^/]+\/messages)/.test(r.url()), { timeout: 30_000 }).catch(() => null);
      await page.goto(`${t.app}/app?tab=agent`, { waitUntil: 'domcontentloaded' });
      await firstLoad;
      await page.waitForTimeout(2_000);
      await page.getByRole('button', { name: 'Chats', exact: true }).first().click({ timeout: 30_000 });
      await page.getByRole('button', { name: /New chat/ }).first().click();
      // A new chat is empty — a slower load of the last chat must not come back over it.
      await page.waitForTimeout(2_500);
      const stale = await page.getByText(/The paper tests \d+ topics?/).count();
      t.check('the new chat stays new (no earlier chat loads over it)', stale === 0, { actual: stale });
      await page.locator('input[type=file]').first().setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: pdf });
      const box = page.getByRole('textbox', { name: /^Ask / }).last();
      await box.fill(`Help me prepare for Biology${tag} with this`);
      await box.press('Enter');

      const card = page.locator('[data-ingest]').last();
      t.check('the reply shows the upload card', await card.waitFor({ timeout: 60_000 }).then(() => true, () => false));
      const ready = await page.locator('[data-ingest="ready"]').last().waitFor({ timeout: 120_000 }).then(() => true, () => false);
      const text = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ');
      t.note(`card: ${text}`);
      t.note(`calls: ${calls.join(' · ')}`);
      t.check('…saved to the Library in a Biology folder, private', /1 file › .*(Biology|Bio)/i.test(text) && /Only you/.test(text), { actual: text });
      t.check('…and read', ready && /Read/.test(text), { actual: text });
      // Read into its topics and questions, the protégé says what it found — the study step first.
      const said = page.getByText(/The paper tests \d+ topics?/).last();
      t.check('the protégé says what the paper tests', await said.waitFor({ timeout: 120_000 }).then(() => true, () => false));
      const textNow = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ');
      t.note(`card after reading: ${textNow}`);
      t.check('…the card counts its questions', /\d+ questions found/.test(textNow), { actual: textNow });
      t.check('…and the first chip is the study step', await page.getByRole('button', { name: 'Make a study plan from this paper' }).first().waitFor({ timeout: 10_000 }).then(() => true, () => false));
      t.check('…with a link to the folder', await page.locator('button[data-material="folder"]').last().isVisible().catch(() => false));

      // Saved with the reply: the record is in a private folder.
      const recs = (await t.api('GET', '/api/records')).body?.data || [];
      const rec = recs.find((r) => r.name === fileName);
      t.check('the file is a Library record', !!rec);
      // Deleted by id at the end: after Undo it is in Recently deleted, out of the records list.
      if (rec?.id) t.cleanup(() => t.api('DELETE', `/api/records/${rec.id}`));
      const folders = (await t.api('GET', '/api/records/folders')).body?.data || [];
      let folder = null;
      for (const f of folders) {
        const items = (await t.api('GET', `/api/records/folders/${f.id}/items`)).body?.data || [];
        if (items.some((it) => it.itemRef === rec?.id)) { folder = f; break; }
      }
      t.check('…in a private folder', folder?.visibility === 'private', { actual: folder });


      // Undo: Recently deleted — the card says so and offers Restore; the record is out of the Library.
      await card.getByRole('button', { name: 'Undo' }).click();
      const gone = page.locator('[data-ingest="undone"]').last();
      t.check('Undo moves it to Recently deleted', await gone.waitFor({ timeout: 20_000 }).then(() => true, () => false)
        && /Recently deleted.*30 days/.test((await gone.innerText().catch(() => '')).replace(/\s+/g, ' ')));
      const after = (await t.api('GET', '/api/records')).body?.data || [];
      t.check('…the record is out of the Library', !after.some((r) => r.name === fileName));
      if (folder) {
        const items = (await t.api('GET', `/api/records/folders/${folder.id}/items`)).body;
        t.check('…and out of its folder', !(items?.data || []).some((it) => it.itemRef === rec?.id));
      }
      // Restore: back in the Library and its folder.
      await gone.getByRole('button', { name: 'Restore' }).click();
      t.check('Restore brings the card back', await page.locator('[data-ingest="ready"]').last().waitFor({ timeout: 20_000 }).then(() => true, () => false));
      const again = (await t.api('GET', '/api/records')).body?.data || [];
      t.check('…and the record', again.some((r) => r.id === rec?.id));
    },
  },
  {
    name: 'agent.ideas_and_suggestions',
    description: "Ideas sit beside To do · Done · Suggestions: a card with where it came from, Do it sends its brief as the learner's message; a ready suggestion shows its preview and its own Yes, and Yes shows the report. (The ideas and the suggestion are served by the test so the screens can be checked; the server side is the backend gate's agent.ideas / agent.ready_proposal.)",
    async run(t) {
      const { page } = t;
      const tag = newMarker().replace(/[^a-z0-9]/gi, '').slice(-6);
      const idea = { id: '00000000-0000-4000-8000-0000000000a1', title: `Turn your Biology notes into a quiz ${tag}`, why: 'You added them on Monday and have not tested yourself yet.', brief: `Make me a 10-question quiz from my Biology notes ${tag}`, icon: 'quiz', context: { kind: 'record', label: 'Cell transport notes' } };
      const sugg = { ref: 'p:00000000-0000-4000-8000-0000000000b2', id: '00000000-0000-4000-8000-0000000000b2', source: 'planner', kind: 'quiz_from_records', title: `A quiz from your Cell transport notes ${tag}`, why: "You're at 30% on osmosis.", createdAt: new Date().toISOString(),
        preview: { kind: 'quiz', record: 'Cell transport notes', pages: 14, topics: ['Osmosis', 'Diffusion'], focus: 'Osmosis' }, yes: 'Yes, open the quiz', cost: 'free' };
      let used = false;
      await page.route('**/api/agent/ideas', (r) => r.fulfill({ json: { success: true, data: used ? [] : [idea] } }));
      await page.route(`**/api/agent/ideas/${idea.id}/use`, (r) => { used = true; return r.fulfill({ json: { success: true, data: { ...idea, status: 'used' } } }); });
      await page.route('**/api/agent/proposals/inbox', (r) => r.fulfill({ json: { success: true, data: [sugg], reasons: ['not_useful', 'wrong_time'] } }));
      await page.route(`**/api/agent/proposals/inbox/${encodeURIComponent(sugg.ref)}/accept`, (r) => r.fulfill({ json: { success: true, data: { executed: true, kind: sugg.kind,
        reportView: { text: `Here's your quiz ${tag} — it opens on your **Cell transport notes**.`, meta: { materials: [{ kind: 'study_tool', title: 'Quiz · Cell transport notes', href: '/library?record=00000000-0000-4000-8000-0000000000c3&tool=quiz' }] } } } } }));
      // The brief goes out as a real chat turn: answered quickly here, so nothing is spent.
      await page.route('**/api/adaptive/chat/agent**', (r) => r.fulfill({ json: { success: true, reply: 'On it.', response: 'On it.' } }));

      await page.goto(`${t.app}/app?tab=agent`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: /^Tasks/ }).first().click({ timeout: 30_000 });
      await page.getByRole('button', { name: /Ideas/ }).first().click();
      const card = page.locator(`[data-idea="${idea.id}"]`);
      t.check('an Ideas section beside To do · Done · Suggestions, with the idea', await card.waitFor({ timeout: 20_000 }).then(() => true, () => false));
      t.check('…saying where it came from', await card.getByText('Cell transport notes').isVisible().catch(() => false));
      await card.getByRole('button', { name: 'Do it' }).click();
      t.check('Do it sends its brief as your message', await page.getByText(idea.brief).first().waitFor({ timeout: 20_000 }).then(() => true, () => false));

      await page.getByRole('button', { name: /^Tasks/ }).first().click();
      await page.getByRole('button', { name: /Suggestions/ }).first().click();
      const pv = page.locator('[data-proposal-preview="quiz"]').first();
      t.check('a ready suggestion shows what it prepared', await pv.waitFor({ timeout: 20_000 }).then(() => true, () => false)
        && /Cell transport notes/.test(await pv.innerText().catch(() => '')) && /reader writes the questions/.test(await pv.innerText().catch(() => '')));
      const yes = page.getByRole('button', { name: 'Yes, open the quiz' }).first();
      t.check('…with its own Yes', await yes.isVisible().catch(() => false));
      await yes.click();
      t.check('Yes shows the report in the chat', await page.getByText(new RegExp(`Here's your quiz ${tag}`)).first().waitFor({ timeout: 20_000 }).then(() => true, () => false));
      t.check('…with the quiz to open', await page.locator('button[data-material="study_tool"]').last().isVisible().catch(() => false));
    },
  },
  {
    name: 'settings.agent_controls',
    description: 'Settings → Agent: one switch per part (Suggestions and ideas, Learn from my conversations, Task check-ins), quiet hours and time zone — each saves and survives a reload — and this week\'s background budget.',
    async run(t) {
      const { page } = t;
      const was = (await t.api('GET', '/api/agent/settings')).body?.data;
      if (!was) t.block('agent settings did not load');
      t.cleanup(() => t.api('PATCH', '/api/agent/settings', { proactive: was.proactive, checkins: was.checkins, quietStart: was.quietStart, quietEnd: was.quietEnd, timeZone: was.timeZone }));
      const open = async () => {
        await page.goto(`${t.app}/settings`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: /Account/ }).first().locator('xpath=following-sibling::button[1]').click({ timeout: 30_000 });
        await page.getByText('Suggestions and ideas', { exact: true }).waitFor({ timeout: 20_000 });
      };
      const knobOf = (label) => page.getByText(label, { exact: true }).locator('xpath=ancestor::*[.//div[contains(@style,"width: 42px")]][1]').locator('div[style*="width: 42px"]').first();
      await open();
      for (const l of ['Agent Online', 'Learn from my conversations', 'Task check-ins']) t.check(`"${l}" is there`, await page.getByText(l, { exact: true }).first().isVisible());
      await knobOf('Suggestions and ideas').click();
      await page.getByLabel('Quiet hours start').selectOption('21:00');
      await page.getByLabel('Time zone').selectOption('Africa/Nairobi');
      let saved = null;
      for (let i = 0; i < 6; i++) { await page.waitForTimeout(800); saved = (await t.api('GET', '/api/agent/settings')).body?.data; if (saved?.timeZone === 'Africa/Nairobi') break; }
      t.check('the switch, quiet hours and time zone save', saved?.proactive === !was.proactive && saved?.quietStart === '21:00' && saved?.timeZone === 'Africa/Nairobi', { actual: saved });
      await open();
      t.check('…and a reload shows them', await page.getByLabel('Quiet hours start').inputValue() === '21:00' && await page.getByLabel('Time zone').inputValue() === 'Africa/Nairobi');
      t.check("this week's background budget is shown", await page.locator('[data-agent-budget]').isVisible().catch(() => false));
    },
  },
  {
    name: 'settings.memory_controls',
    description: 'Settings → Agent shows what the agent remembers (Memory) and the "Learn from my conversations" switch, which saves and survives a reload.',
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
        // The switch now sits with the other agent switches; Memory (the notes) loads on its own.
        await page.getByText('Memory', { exact: true }).first().waitFor({ timeout: 20_000 });
        await (notes ? page.getByRole('button', { name: /^Forget: / }).first() : page.getByText(/Nothing remembered yet/)).waitFor({ timeout: 20_000 }).catch(() => {});
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
