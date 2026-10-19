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
    name: 'chat.live_steps',
    description: 'A real Agent Chat turn: the steps show live (a thinking row, then tool rows in the learner\'s words), Stop is there while it runs, the reply arrives, and reopening the chat after a reload shows the same steps.',
    async run(t) {
      const { page } = t;
      const marker = newMarker();
      t.cleanup(async () => {
        const list = await t.api('GET', '/api/adaptive/chat/sessions');
        for (const c of (list.body?.sessions || []).filter((x) => String(x.title || '').includes(marker) || String(x.preview || '').includes(marker))) await t.api('DELETE', `/api/adaptive/chat/sessions/${c.id}`);
      });
      await page.goto(`${t.app}/app?tab=agent`, { waitUntil: 'domcontentloaded' });
      const box = page.getByRole('textbox').last();
      await box.waitFor({ timeout: 30_000 });
      await page.getByRole('button', { name: /New chat/i }).first().click({ timeout: 5_000 }).catch(() => {});
      await box.fill(`${marker} What are my weak topics, and what's on my to-do list?`);
      await page.getByRole('button', { name: 'Send message' }).click();
      t.check('Stop shows while the turn runs', await page.getByRole('button', { name: 'Stop' }).first().waitFor({ timeout: 15_000 }).then(() => true, () => false));
      t.check('a thinking row appears', await page.getByText(/Thinking|Thought for/).first().waitFor({ timeout: 60_000 }).then(() => true, () => false));
      // One tool row, or several grouped under "Checked N things" (collapsed once the next step starts).
      t.check('tool rows in the learner\'s words (no tool names)', await page.getByText(/^(Checking|Reviewing|Looking|Reading|Checked \d+ things|Ran \d+ steps|Did \d+ things)/).first().waitFor({ state: 'attached', timeout: 90_000 }).then(() => true, () => false)
        && !(await page.getByText(/get_weak_topics|list_tasks/).first().isVisible().catch(() => false)));
      const done = await page.getByRole('button', { name: 'Stop' }).first().waitFor({ state: 'detached', timeout: 120_000 }).then(() => true, () => false);
      t.check('the turn finishes (Stop goes away)', done);
      await t.shot('live-steps');
      const rowsBefore = await page.getByText(/Thought for|Checked \d+ things|Checking|Reviewing/).count();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText(marker).first().waitFor({ timeout: 30_000 }).catch(() => {});
      const rowsAfter = await page.getByText(/Thought for|Checked \d+ things|Checking|Reviewing/).count();
      t.check(`after a reload the chat shows its steps again (${rowsBefore} → ${rowsAfter})`, rowsAfter > 0);
    },
  },
  {
    name: 'chat.envelope_stream',
    description: 'The chat reads the live stream in the shared event format (Grand Plan §7.9.7): every event carries its envelope, and an event the app has no name for is read by its envelope type. Thinking streams its text, tool rows fill in, text and reply appear, Think\'s reasoning shows. (The stream is served by the test — no model call.)',
    async run(t) {
      const { page } = t;
      const env = (type, sequence) => ({ envelope: { v: 3, type, sequence, turnId: 'turn_ui', workflowType: 'agent_chat', actor: 'agent', visibility: 'learner' } });
      const ev = (name, data, type, n) => `event: ${name}\ndata: ${JSON.stringify({ ...data, ...env(type, n) })}\n\n`;
      const body = [
        ev('think_start', { id: 'think_1' }, 'agent.narration.start', 0),
        ev('think_delta', { id: 'think_1', text: 'They asked about weak topics — check those first.' }, 'agent.narration.delta', 1),
        ev('think_end', { id: 'think_1', type: 'thinking', ms: 1800, text: 'They asked about weak topics — check those first.', source: 'reasoning' }, 'agent.narration', 2),
        ev('tool_start', { id: 'tool_1', category: 'research', headline: 'Checking your weak topics', description: 'Topics where your confidence is low' }, 'tool.started', 3),
        // A name this app version has no case for: read by its envelope type.
        ev('tool.completed', { id: 'tool_1', ok: true, result: '2 weak topics found', ms: 140 }, 'tool.completed', 4),
        ev('activity', { id: 'act_1', text: 'Your weakest topic is Osmosis.' }, 'activity', 5),
        ev('delta', { text: 'Start with **Osmosis** today.' }, 'reply.delta', 6),
        ev('done', { reply: 'Start with **Osmosis** today.', thinking: '', mode: 'think', metadata: {}, toolExecutions: [] }, 'reply', 7),
      ].join('');
      await page.route('**/api/adaptive/chat/agent**', (r) => r.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body }));
      await page.goto(`${t.app}/app?tab=agent`, { waitUntil: 'domcontentloaded' });
      const box = page.getByRole('textbox').last();
      await box.waitFor({ timeout: 30_000 });
      await page.getByRole('button', { name: /New chat/i }).first().click({ timeout: 5_000 }).catch(() => {});
      await box.fill('What should I revise today?');
      await page.getByRole('button', { name: 'Send message' }).click();
      t.check('the reply arrives', await page.getByText('Osmosis', { exact: false }).last().waitFor({ timeout: 20_000 }).then(() => true, () => false));
      t.check('the thinking row says how long it thought', await page.getByText(/Thought for 2 seconds/).first().isVisible().catch(() => false));
      const toolRow = page.getByText('Checking your weak topics').first();
      t.check('the tool row is there in the learner\'s words', await toolRow.isVisible().catch(() => false));
      await toolRow.click().catch(() => {});
      t.check('…and it filled in from the envelope-typed event (result + time)', await page.getByText(/2 weak topics found/).first().isVisible().catch(() => false) && await page.getByText('140ms').first().isVisible().catch(() => false));
      t.check('the agent\'s text between steps shows', await page.getByText('Your weakest topic is Osmosis.').first().isVisible().catch(() => false));
      // The row collapses when done; open it (if it isn't already) to read the reasoning.
      const reasoning = page.getByText(/check those first/).first();
      if (!(await reasoning.isVisible().catch(() => false))) await page.getByText(/Thought for 2 seconds/).first().click().catch(() => {});
      await t.shot('envelope-stream');
      t.check('Think\'s reasoning summary is in the thinking row', await reasoning.waitFor({ timeout: 5_000 }).then(() => true, () => false));
    },
  },
  {
    name: 'chat.study_prep_live',
    description: 'The Study Prep card streams its workflow: while it runs it is pinned above the message box (a spinner on the step in progress, a note at its message); when the plan is ready it goes back to its message saying "Waiting for you", every step ticked, with Approve & Start. The steps are in the card, not in the chat\'s own step rows; a dropped stream reconnects from the last step without repeats; steps from while the learner was away are announced. (Chat, session and stream are served by the test; the server side is the backend gate\'s workflow.event_stream.)',
    async run(t) {
      const { page } = t;
      const chatId = '00000000-0000-4000-8000-0000000000d1', spId = '00000000-0000-4000-8000-0000000000d2', wfId = '00000000-0000-4000-8000-0000000000d3';
      const at = (s) => new Date(Date.now() - s * 1000).toISOString();
      const nar = (headline, description = '', result = '') => ({ headline, description, result, narration: headline });
      const all = [
        { sequence: 0, type: 'workflow.created', narration: nar('Started Study Prep'), payload: {} },
        { sequence: 1, type: 'tool.completed', narration: nar('Checking your class syllabus', 'No Basic Science syllabus for JSS1 at your school', 'Done'), payload: { tool: 'syllabus.resolve_class', durationMs: 400 } },
        { sequence: 2, type: 'activity', narration: nar('Outline drafted', 'I drafted an outline from the national curriculum.'), payload: { decisionNode: 'syllabus_generated', narrative: 'x' } },
        { sequence: 3, type: 'tool.started', narration: nar('Ordering the topics', 'What has to come before what'), payload: { tool: 'concept.get_prerequisites' } },
        { sequence: 4, type: 'tool.completed', narration: nar('Ordering the topics', 'What has to come before what', 'Done'), payload: { tool: 'concept.get_prerequisites', durationMs: 900 } },
        { sequence: 5, type: 'decision.accepted', narration: nar('Plan checked', 'Everything lines up.'), payload: { decisionNode: 'plan_validated', narrative: 'x' } },
      ].map((e) => ({ v: 3, workflowId: wfId, workflowType: 'study_prep', timestamp: at(5 - e.sequence * 0.5), visibility: 'learner', actor: 'system', ...e }));
      const asked = [];
      let planned = false;
      await page.route('**/api/adaptive/chat/sessions', (r) => r.fulfill({ json: { success: true, sessions: [{ id: chatId, title: 'Basic Science prep', updated_at: at(60), created_at: at(60) }] } }));
      await page.route(`**/api/adaptive/chat/sessions/${chatId}/messages**`, (r) => r.fulfill({ json: { success: true, messages: [
        { id: 'm1', role: 'user', text: 'Prepare me for my JSS1 Basic Science exam in 5 weeks', created_at: at(30) },
        { id: 'm2', role: 'agent', text: 'Building your plan now.', created_at: at(29), meta: { studyPrepSessionId: spId } },
      ], hasMore: false } }));
      await page.route(`**/api/adaptive/study-prep/sessions/${spId}`, (r) => r.fulfill({ json: { success: true, session: {
        id: spId, goal: 'JSS1 Basic Science exam', subject: 'Basic Science', status: planned ? 'awaiting_confirmation' : 'planning', workflowId: wfId,
        plan: planned ? [{ syllabusTopicId: 't1', label: 'Living and non-living things', position: 1 }, { syllabusTopicId: 't2', label: 'Cells', position: 2 }] : null,
        estimate: planned ? { totalCoins: 12 } : null, syllabusSource: 'generated' }, topics: [], events: [] } }));
      // First connection: steps 0–3 (3 still running), then it drops. The reconnect (after 3) brings the rest — the plan is ready.
      await page.route(`**/api/workflows/${wfId}/stream**`, async (r) => {
        const after = Number(new URL(r.request().url()).searchParams.get('after'));
        asked.push(after);
        if (asked.length === 2) await new Promise((res) => setTimeout(res, 2500));   // long enough to see it pinned
        if (asked.length >= 2) planned = true;
        const out = all.filter((e) => e.sequence > after && (asked.length === 1 ? e.sequence <= 3 : true));
        const body = out.map((e) => `event: workflow_event\ndata: ${JSON.stringify(e)}\n\n`).join('') + `event: caught_up\ndata: ${JSON.stringify({ last: out.length ? out[out.length - 1].sequence : after })}\n\n`;
        return r.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body });
      });
      // This device last showed step 1: steps 2–3 happened while the learner was away.
      await page.addInitScript((id) => { try { localStorage.setItem(`ak.wf.seen.${id}`, '1'); } catch { /* */ } }, wfId);

      await page.goto(`${t.app}/app?tab=agent`, { waitUntil: 'domcontentloaded' });
      const dock = page.locator('[data-workflow-pinned]');
      t.check('while it runs, the card is pinned above the message box', await dock.waitFor({ timeout: 30_000 }).then(() => true, () => false));
      t.check('…with a spinner on the step in progress', await dock.locator('[data-workflow-step="running"]').first().isVisible().catch(() => false));
      t.check('…saying it is planning', await dock.locator('[data-workflow-badge="Planning"]').isVisible().catch(() => false));
      t.check('…and a note where it sits in the chat', await page.locator('[data-workflow-pinned-note]').isVisible().catch(() => false));
      t.check('steps from while you were away are announced', await page.locator('[data-workflow-away]').first().isVisible().catch(() => false));
      await t.shot('pinned-running');

      t.check('when the plan is ready it goes back to its message', await dock.waitFor({ state: 'detached', timeout: 20_000 }).then(() => true, () => false));
      const card = page.locator('[data-workflow-badge="Waiting for you"]');
      t.check('…saying Waiting for you', await card.waitFor({ timeout: 15_000 }).then(() => true, () => false));
      t.check('…every step ticked, none spinning', await page.locator('[data-workflow-step="running"]').count() === 0 && await page.locator('[data-workflow-step="done"]').count() === 4);
      t.check('…the AI-drafted outline is labelled', await page.getByText("AI-drafted — not your school's official syllabus").first().isVisible().catch(() => false));
      t.check('…with the plan and Approve & Start', await page.getByRole('button', { name: 'Approve & Start' }).first().isVisible().catch(() => false));
      t.check('the steps are in the card, not the chat\'s own step rows', !(await page.getByText(/Study Prep · \d+ steps?/).first().isVisible().catch(() => false)) && await page.getByText('Plan checked').count() === 1);
      t.check('a dropped stream reconnected from the last step it had', asked[0] === -1 && asked[1] === 3, JSON.stringify(asked));
      await t.shot('settled');
    },
  },
  {
    name: 'chat.study_prep_dev_notes',
    description: 'Developer view: the Study Prep planner\'s notes arrive live and show in the chat as "Thought for N seconds" rows under the card\'s message — outside the card, which stays the workflow\'s state. Without developer view they are not asked for. (Served by the test.)',
    async run(t) {
      const { page } = t;
      const chatId = '00000000-0000-4000-8000-0000000000f1', spId = '00000000-0000-4000-8000-0000000000f2', wfId = '00000000-0000-4000-8000-0000000000f3';
      const at = new Date(Date.now() - 5000).toISOString();
      const urls = [];
      await page.route('**/api/adaptive/chat/sessions', (r) => r.fulfill({ json: { success: true, sessions: [{ id: chatId, title: 'Basic Science prep', updated_at: at, created_at: at }] } }));
      await page.route(`**/api/adaptive/chat/sessions/${chatId}/messages**`, (r) => r.fulfill({ json: { success: true, messages: [
        { id: 'n1', role: 'user', text: 'Prepare me for my JSS1 Basic Science exam', created_at: at },
        { id: 'n2', role: 'agent', text: 'Planning now.', created_at: at, meta: { studyPrepSessionId: spId } },
      ], hasMore: false } }));
      await page.route(`**/api/adaptive/study-prep/sessions/${spId}`, (r) => r.fulfill({ json: { success: true, session: { id: spId, goal: 'JSS1 Basic Science', subject: 'Basic Science', status: 'awaiting_confirmation', workflowId: wfId, plan: [{ syllabusTopicId: 't1', label: 'Cells', position: 1 }], estimate: { totalCoins: 5 } }, topics: [], events: [] } }));
      await page.route(`**/api/workflows/${wfId}/stream**`, (r) => {
        urls.push(r.request().url());
        const step = { v: 3, workflowId: wfId, sequence: 1, type: 'tool.completed', timestamp: at, visibility: 'learner', narration: { headline: 'Reviewing what you know', description: 'Your strong and weak topics', result: 'No recorded evidence on this subject yet', narration: 'x' }, payload: { tool: 'learner.get_state' } };
        const note = { v: 3, live: true, workflowId: wfId, type: 'agent.narration', visibility: 'developer', timestamp: at, payload: { iteration: 3, ms: 4200, thinking: 'No recorded evidence in Basic Science, so I cannot rank by weakness. Use the school syllabus order and check prerequisites next.', intent: 'Read the prerequisite links so the order respects them.', tool: 'concept.get_prerequisites' } };
        const body = `event: workflow_event\ndata: ${JSON.stringify(step)}\n\nevent: caught_up\ndata: {"last":1}\n\nevent: workflow_live\ndata: ${JSON.stringify(note)}\n\n`;
        return r.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body });
      });
      await page.addInitScript(() => { try { localStorage.setItem('ak.agentChat.devView', '1'); } catch { /* */ } });
      await page.goto(`${t.app}/app?tab=agent`, { waitUntil: 'domcontentloaded' });
      const notes = page.locator('[data-workflow-notes]');
      t.check('developer view asks the stream for the notes', await notes.waitFor({ timeout: 30_000 }).then(() => true, () => false) && urls.some((u) => u.includes('developer=1')), JSON.stringify(urls.slice(0, 2)));
      t.check('…a "Thought for N seconds" row, outside the card', await notes.getByText(/Thought for 4 seconds/).isVisible().catch(() => false)
        && await page.locator('[data-workflow-steps] [data-workflow-notes]').count() === 0);
      await notes.getByText(/Thought for 4 seconds/).click().catch(() => {});
      t.check('…opening to the planner\'s notes and its next step', await notes.getByText(/cannot rank by weakness/).isVisible().catch(() => false) && await notes.getByText(/Next: Read the prerequisite links/).isVisible().catch(() => false));
      t.check('the card still shows only the workflow\'s state', await page.locator('[data-workflow-steps]').getByText('Reviewing what you know').isVisible().catch(() => false)
        && !(await page.locator('[data-workflow-steps]').getByText(/cannot rank by weakness/).isVisible().catch(() => false)));
      await t.shot('dev-notes');
    },
  },
  {
    name: 'chat.study_prep_film',
    description: 'A real Study Prep turn on the sandbox, filmed: a screenshot every 2 seconds from sending the message until the plan-ready message arrives (real model, real planning — about 2–4 minutes). For a person to look at; its checks only say whether each stage was seen.',
    async run(t) {
      const { page } = t;
      const marker = newMarker();
      // One Study Prep at a time: clear any this tester already has.
      const clear = async () => {
        for (let i = 0; i < 4; i += 1) {
          const a = await t.api('GET', '/api/adaptive/study-prep/sessions');
          const id = a.body?.session?.id;
          if (!id) break;
          await t.api('POST', `/api/adaptive/study-prep/sessions/${id}/cancel`, {});
        }
      };
      await clear();
      t.cleanup(async () => {
        await clear();
        const list = await t.api('GET', '/api/adaptive/chat/sessions');
        for (const c of (list.body?.sessions || []).filter((x) => String(x.title || '').includes(marker) || String(x.preview || '').includes(marker))) await t.api('DELETE', `/api/adaptive/chat/sessions/${c.id}`);
      });
      // UI_GATE_DEV_VIEW=1 films it with the developer view on (the planner's notes show).
      if (process.env.UI_GATE_DEV_VIEW === '1') await page.addInitScript(() => { try { localStorage.setItem('ak.agentChat.devView', '1'); } catch { /* */ } });
      await page.goto(`${t.app}/app?tab=agent`, { waitUntil: 'domcontentloaded' });
      const box = page.getByRole('textbox').last();
      await box.waitFor({ timeout: 30_000 });
      // A fresh chat: open the chats drawer, then New chat.
      await page.getByRole('button', { name: 'Chats' }).first().click({ timeout: 10_000 }).catch(() => {});
      await page.getByRole('button', { name: /New chat/i }).first().click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(800);
      const readyBefore = await page.getByText(/plan is ready/).count();
      await box.fill(`Prepare me for my JSS1 Basic Science exam in 5 weeks ${marker}`);
      await t.shot('00-typed');
      await page.getByRole('button', { name: 'Send message' }).click();
      const scroll = () => page.evaluate(() => { for (const e of document.querySelectorAll('*')) if (e.scrollHeight > e.clientHeight + 40 && getComputedStyle(e).overflowY !== 'visible' && !e.closest('[data-workflow-pinned]')) e.scrollTop = e.scrollHeight; }).catch(() => {});
      const seen = { thinking: false, pinned: false, ready: false };
      let after = 0;
      for (let i = 1; i <= 110 && after < 3; i += 1) {
        await page.waitForTimeout(2000);
        await scroll();
        seen.thinking ||= await page.getByText(/Thinking|Thought for/).first().isVisible().catch(() => false);
        seen.pinned ||= await page.locator('[data-workflow-pinned]').isVisible().catch(() => false);
        seen.ready ||= (await page.getByText(/plan is ready/).count()) > readyBefore;
        if (seen.ready) after += 1;
        await t.shot(String(i).padStart(2, '0'));
      }
      t.check('the agent thought and worked in the chat', seen.thinking);
      t.check('the Study Prep card was pinned while it planned', seen.pinned);
      t.check('the plan-ready message arrived in the chat', seen.ready);
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
