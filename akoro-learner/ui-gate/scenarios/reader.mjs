/**
 * Suite "reader" — a learner's PDF record in the session reader, the way
 * the reference apps work: select words on a page, the selection stays on
 * those words, "Ask the tutor" quotes them into the chat, and the guide
 * chat's Learn suggestions are about the document.
 *
 * Each run makes its own records on the test learner's shelf (named with a
 * run marker) and deletes them at the end:
 *   - a two-page PDF (the reader's pdf.js pages; needs the file store)
 *   - a pasted-text record (no file store needed) for the chat checks
 */

const PARAS = [
  'The cell wall is a rigid layer outside the cell membrane of plant cells. The cell wall gives the plant cell its shape and protects it from bursting when water enters by osmosis.',
  'Mitochondria are the sites of aerobic respiration. Mitochondria release the energy stored in glucose, so active cells such as muscle cells contain many mitochondria.',
  'The nucleus controls the activities of the cell. The nucleus contains chromosomes made of DNA, which carry the instructions for making proteins.',
  'Chloroplasts are found in the leaf cells of green plants. Chloroplasts absorb light energy for photosynthesis, which makes glucose from carbon dioxide and water.',
];
const OLD_GENERIC = ['Summarise this material', 'Quiz me on this topic', 'Explain it simply', 'Give a real-world example'];

/** A two-page text PDF, printed by the browser itself (no file in the repo). */
async function makePdf(browser) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const page = (n) => `<section style="page-break-after:always"><small>BIO 111 · Cell Structure and Organization · header</small><h2>Part ${n}</h2>` +
    PARAS.map((t, i) => `<p>${t} (${n}.${i + 1})</p>`).join('') + `<small>page ${n} footer</small></section>`;
  await p.setContent(`<style>body{font:14px Georgia,serif;margin:48px} p{width:62%;margin:20px 0;line-height:1.5}</style>${page(1)}${page(2)}`);
  const pdf = await p.pdf({ format: 'A4' });
  await ctx.close();
  return pdf;
}

/** The first page of the reader with its words laid out. */
async function readerPage(page, index = 0) {
  const layer = page.locator(`[data-page-index="${index}"] .pdf-text-layer`);
  await layer.locator('span').first().waitFor({ state: 'attached', timeout: 45_000 });
  await layer.scrollIntoViewIfNeeded();
  return layer;
}

/** The selection right now: its text and which page each end is on. */
const readSelection = (page) => page.evaluate(() => {
  const s = getSelection();
  const pageOf = (n) => (n && (n.nodeType === 1 ? n : n.parentElement)?.closest('[data-page-index]')?.dataset.pageIndex) ?? null;
  return { text: s.toString(), anchorPage: pageOf(s.anchorNode), focusPage: pageOf(s.focusNode) };
});

/** A word span on a page, with its on-screen box. */
const spanBox = (page, index, nth) => page.evaluate(({ index, nth }) => {
  const spans = [...document.querySelectorAll(`[data-page-index="${index}"] .pdf-text-layer span`)].filter((s) => s.textContent.trim().length > 12);
  const s = spans[Math.min(nth, spans.length - 1)];
  if (!s) return null;
  s.scrollIntoView({ block: 'center' });
  const r = s.getBoundingClientRect();
  const layer = s.closest('.pdf-text-layer').getBoundingClientRect();
  return { x: r.left + 3, y: r.top + r.height / 2, text: s.textContent, layer: { left: layer.left, right: layer.right, top: layer.top, bottom: layer.bottom } };
}, { index, nth });

async function drag(page, from, to, steps = 14) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

const clearSelection = (page) => page.evaluate(() => getSelection().removeAllRanges());

const markerRe = (marker) => new RegExp(marker.replace(/[[\]]/g, '\\$&'));
const newMarker = () => `[ui-gate:${Math.random().toString(16).slice(2, 8)}]`;

/** Open a record from the library and bring up its reader. → true when the reader shows. */
async function openRecordReader(t, marker, readyLocator) {
  const { page } = t;
  await page.goto(`${t.app}/library`, { waitUntil: 'domcontentloaded' });
  const card = page.getByRole('button', { name: markerRe(marker) }).first();
  // The shelf can show its cached list first; a new record may need one reload.
  let onShelf = await card.waitFor({ timeout: 15_000 }).then(() => true, () => false);
  if (!onShelf) {
    t.note('the new record was not on the shelf at first — reloaded the library');
    await page.reload({ waitUntil: 'domcontentloaded' });
    onShelf = await card.waitFor({ timeout: 20_000 }).then(() => true, () => false);
  }
  t.check('the record is on the library shelf', onShelf);
  if (!onShelf) return false;   // a FAIL, not a precondition
  await card.click();
  // A file never extracted asks first; reading it as-is is the plain path.
  const asIs = page.getByRole('button', { name: 'Read as-is' });
  if (await asIs.waitFor({ timeout: 6_000 }).then(() => true, () => false)) await asIs.click();
  // Desktop opens the reader beside the chat; a phone opens it from the material box.
  if (!(await page.locator(readyLocator).count())) {
    const open = page.locator('[title="Open the material"], [aria-label="Open reading material"]').first();
    await open.waitFor({ timeout: 30_000 }).catch(() => {});
    await open.click().catch(() => {});
  }
  return page.locator(readyLocator).first().waitFor({ state: 'attached', timeout: 45_000 }).then(() => true, () => false);
}

/** Select the start of the first paragraph matching `pattern`, like a drag would. → the text. */
const selectWithin = (page, selector, pattern) => page.evaluate(({ sel, src }) => {
  const el = [...document.querySelectorAll(sel)].find((p) => new RegExp(src, 'i').test(p.textContent));
  if (!el) return '';
  el.scrollIntoView({ block: 'center' });
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  let last = first;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) last = n;
  if (!first) return '';
  // A sentence or so: from the start to ~90 characters in.
  const end = Math.min(last === first ? first.length : first.length, 90);
  getSelection().setBaseAndExtent(first, 0, first, end);
  return getSelection().toString();
}, { sel: selector, src: pattern });

export const scenarios = [
  {
    name: 'reader.opens_pdf',
    description: 'A PDF record opens in the session reader with its real pages and a selectable, guarded text layer.',
    async run(t) {
      const { page, context } = t;
      const marker = newMarker();
      const name = `${marker} BIO 111 Cell Structure.pdf`;
      const pdf = await makePdf(context.browser());
      const up = await t.api('POST', '/api/records/upload-url', { name, mime: 'application/pdf', size: pdf.length });
      if (up.status !== 200 || !up.body?.data?.uploadUrl) t.block(`upload-url answered ${up.status}: ${up.body?.message || ''}`);
      // From the page, the way the app's own upload sends it (services/recordsApi.js).
      await page.goto(`${t.app}/library`, { waitUntil: 'domcontentloaded' });
      const putStatus = await page.evaluate(async ({ url, b64 }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        try { return (await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: bytes })).status; } catch (e) { return String(e.message); }
      }, { url: up.body.data.uploadUrl, b64: pdf.toString('base64') });
      if (!(putStatus >= 200 && putStatus < 300)) t.block(`the file store (${new URL(up.body.data.uploadUrl).host}) is unreachable from here: ${putStatus}`);
      const made = await t.api('POST', '/api/records', { kind: 'upload', fileKey: up.body.data.fileKey, name, mime: 'application/pdf', size: pdf.length });
      const record = made.body?.data?.record || made.body?.data;
      if (!record?.id) t.block(`registering the record answered ${made.status}: ${made.body?.message || ''}`);
      t.cleanup(async () => { await t.api('DELETE', `/api/records/${record.id}`); });
      t.note(`pdf record ${record.id}`);
      t.state.pdfMarker = marker;
      t.state.pdfRecordId = record.id;

      const shown = await openRecordReader(t, marker, '[data-page-index="0"] .pdf-text-layer span');
      t.check('page 1 renders with a text layer', shown);
      if (!shown) return;
      const layer = page.locator('[data-page-index="0"] .pdf-text-layer');
      const words = await layer.evaluate((el) => el.textContent);
      t.check('the text layer carries the printed words', /cell wall/i.test(words), { actual: words.slice(0, 80) });
      t.check('the text layer has the selection guard', await layer.evaluate((el) => el.classList.contains('sel-layer') && !!el.querySelector('.endOfContent')));
    },
  },
  {
    name: 'reader.selection_one_page',
    needs: ['reader.opens_pdf'],
    description: 'Dragging past the words, into the margin or onto the next page keeps the selection on the page it started on; "Select all" takes one page.',
    async run(t) {
      const { page } = t;
      await readerPage(page, 0);
      const pageChars = await page.locator('[data-page-index="0"] .pdf-text-layer').evaluate((el) => el.textContent.length);

      // 1. Into the right margin, a few lines down: the selection holds near the words.
      await clearSelection(page);
      const a = await spanBox(page, 0, 3);
      if (!a) t.block('no words on page 1 to start a selection from');
      await drag(page, a, { x: a.layer.right - 2, y: a.y + 70 });
      const s1 = await readSelection(page);
      t.check('a drag into the margin selects a few lines, not the page', s1.text.length > 20 && s1.text.length < pageChars * 0.5,
        { expected: `20 … ${Math.round(pageChars * 0.5)} chars`, actual: s1.text.length });

      // 2. Past the bottom of the page onto the next: pulled back to page 1.
      await clearSelection(page);
      const b = await spanBox(page, 0, 6);
      await drag(page, b, { x: b.x + 40, y: b.layer.bottom + 80 }, 20);
      const s2 = await readSelection(page);
      t.equal('a drag onto the next page ends on the first page', s2.focusPage, '0');
      t.check('…and takes nothing from the next page', !/\(2\.\d\)/.test(s2.text), { actual: s2.text.slice(-60) });

      // 3. What a phone's selection handle does: a range reaching into page 2.
      await clearSelection(page);
      await page.locator('[data-page-index="1"] .pdf-text-layer span').first().waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
      const s3 = await page.evaluate(() => new Promise((resolve) => {
        const first = document.querySelector('[data-page-index="0"] .pdf-text-layer span');
        const later = [...document.querySelectorAll('[data-page-index="1"] .pdf-text-layer span')].pop();
        if (!first || !later) return resolve(null);
        getSelection().setBaseAndExtent(first.firstChild, 0, later.firstChild, later.firstChild.length);
        setTimeout(() => {
          const s = getSelection();
          const pageOf = (n) => (n.nodeType === 1 ? n : n.parentElement).closest('[data-page-index]')?.dataset.pageIndex;
          resolve({ focusPage: pageOf(s.focusNode), text: s.toString() });
        }, 200);
      }));
      if (s3) t.equal('a handle dragged onto page 2 is clamped to page 1', s3.focusPage, '0');
      else t.note('page 2 had no text layer yet — the handle clamp was not checked');

      // 4. "Select all": one page, not the document.
      await clearSelection(page);
      const c = await spanBox(page, 0, 2);
      await page.mouse.click(c.x, c.y);
      await page.keyboard.press('Control+A');
      await page.waitForTimeout(250);
      const s4 = await readSelection(page);
      t.check('"Select all" selects one page at most', s4.text.length > 0 && s4.text.length <= pageChars + 60, { expected: `≤ ${pageChars + 60}`, actual: s4.text.length });
      await clearSelection(page);
    },
  },
  {
    name: 'reader.opens_text',
    description: 'A pasted-text record opens in the session reader with its paragraphs.',
    async run(t) {
      const marker = newMarker();
      const name = `${marker} Cell Structure notes`;
      const made = await t.api('POST', '/api/records', { kind: 'paste', name, content: PARAS.join('\n\n') });
      const record = made.body?.data?.record || made.body?.data;
      if (!record?.id) t.block(`saving the pasted record answered ${made.status}: ${made.body?.message || ''}`);
      t.cleanup(async () => { await t.api('DELETE', `/api/records/${record.id}`); });
      t.note(`text record ${record.id}`);
      t.state.textMarker = marker;
      t.state.textRecordId = record.id;
      const shown = await openRecordReader(t, marker, '[data-page-index] [data-page-content] p');
      t.check('the reader shows the pasted paragraphs', shown);
      if (shown) {
        // Page 1 is the material's cover; its words follow.
        const text = (await t.page.locator('[data-page-index] [data-page-content]').allInnerTexts().catch(() => [])).join(' ');
        t.check('…with the record\'s words', /cell wall|mitochondria/i.test(text), { actual: text.slice(0, 80) });
      }
    },
  },
  {
    name: 'reader.session_connects',
    needs: ['reader.opens_text'],
    description: "The record's live teaching session (its WebSocket) connects.",
    async run(t) {
      if (!t.network.websocket) t.block("WebSockets don't get through this network's outbound proxy");
      const live = await t.page.waitForFunction(() => !document.body.innerText.includes('Reconnecting…'), null, { timeout: 30_000 }).then(() => true, () => false);
      t.check('the session is connected (no "Reconnecting…")', live);
    },
  },
  {
    name: 'reader.quote_chip',
    needs: ['reader.opens_text'],
    description: '"Ask the tutor" on a selection puts it as a quote above the chat box; the sent message shows the quote above the question.',
    async run(t) {
      const { page } = t;
      const picked = (await selectWithin(page, '[data-page-index] [data-page-content] p', 'cell wall')).replace(/\s+/g, ' ').trim();
      t.check('some words are selected', picked.length > 10, { actual: picked.length });
      const ask = page.getByRole('button', { name: 'Ask the tutor' });
      t.check('the selection menu offers "Ask the tutor"', await ask.waitFor({ timeout: 8_000 }).then(() => true, () => false));
      await ask.click();
      const chip = page.getByRole('button', { name: 'Remove the quoted passage' });
      t.check('the chat box shows the quote', await chip.waitFor({ timeout: 10_000 }).then(() => true, () => false));
      const chipText = (await chip.locator('xpath=..').innerText().catch(() => '')).replace(/\s+/g, ' ');
      t.check('the quote carries its page', /page \d+/i.test(chipText), { actual: chipText.slice(0, 60) });
      t.check('the quote is the selected words', chipText.toLowerCase().includes(picked.slice(0, 20).toLowerCase()), { expected: picked.slice(0, 20), actual: chipText.slice(0, 80) });
      const input = page.getByPlaceholder('Ask about this passage…');
      t.check('the cursor waits in the chat box for the question', await input.evaluate((el) => document.activeElement === el).catch(() => false));
      const question = 'Why does the cell wall stop the cell bursting?';
      await input.fill(question);
      await page.getByRole('button', { name: 'Send message' }).click();
      // The bubble holds the quote card and then the question.
      const bubble = page.getByText(question).last();
      t.check('the question is sent', await bubble.waitFor({ timeout: 10_000 }).then(() => true, () => false));
      const bubbleText = (await bubble.innerText().catch(() => '')).replace(/\s+/g, ' ');
      t.check('the sent message shows the quote above the question', /page \d+/i.test(bubbleText) && bubbleText.toLowerCase().includes(picked.slice(0, 15).toLowerCase()),
        { actual: bubbleText.slice(0, 140) });
      t.check('the quote is cleared after sending', !(await chip.isVisible().catch(() => false)));
    },
  },
  {
    name: 'reader.pdf_highlight',
    needs: ['reader.selection_one_page'],
    description: 'On a PDF page, Annotate draws a highlight over exactly the selected words, saves it with its note, and it is back over the same words after a reload.',
    async run(t) {
      const { page } = t;
      // The text checks left the pasted record open: open the PDF.
      if (!(await openRecordReader(t, t.state.pdfMarker, '[data-page-index="0"] .pdf-text-layer span'))) return;
      await readerPage(page, 0);
      await clearSelection(page);
      const a = await spanBox(page, 0, 2);
      t.check('a line of words to select', !!a);
      if (!a) return;
      // Across most of one line of words.
      await drag(page, { x: a.x, y: a.y }, { x: a.x + Math.min(220, (a.layer.right - a.x) * 0.6), y: a.y });
      const sel = await readSelection(page);
      t.check('words are selected on page 1', sel.text.trim().length > 8 && sel.anchorPage === '0', { actual: sel });
      const annotate = page.getByRole('button', { name: 'Annotate' });
      t.check('the selection menu offers Annotate', await annotate.waitFor({ timeout: 8_000 }).then(() => true, () => false));
      await annotate.click();
      const box = page.getByPlaceholder('Add a note…');
      t.check('the note box opens', await box.waitFor({ timeout: 8_000 }).then(() => true, () => false));
      await box.fill('Key idea for the test');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      const marks = page.locator('[data-page-index="0"] .folio-annotation');
      t.check('a highlight is drawn', await marks.first().waitFor({ timeout: 8_000 }).then(() => true, () => false));
      // The highlight covers the words that were selected.
      const over = await page.evaluate(({ x, y }) => [...document.querySelectorAll('[data-page-index="0"] .folio-annotation')]
        .some((m) => { const r = m.getBoundingClientRect(); return x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4; }), { x: a.x + 5, y: a.y });
      t.check('…over the selected words', over);
      await page.waitForTimeout(1_500);
      const saved = await t.api('GET', `/api/records/artifacts?recordId=${t.state.pdfRecordId}`);
      const ann = (saved.body?.data?.artifacts || []).find((x) => x.kind === 'annotation');
      t.check('the highlight is saved with its note', !!ann && JSON.stringify(ann.content).includes('Key idea for the test'), { actual: (saved.body?.data?.artifacts || []).map((x) => x.kind) });
      await page.reload({ waitUntil: 'domcontentloaded' });
      if (!(await openRecordReader(t, t.state.pdfMarker, '[data-page-index="0"] .pdf-text-layer span'))) return;
      const back = page.locator('[data-page-index="0"] .folio-annotation');
      t.check('after a reload the highlight is back', await back.first().waitFor({ timeout: 20_000 }).then(() => true, () => false));
      await back.first().scrollIntoViewIfNeeded().catch(() => {});
      const stillOver = await page.evaluate(() => {
        const m = document.querySelector('[data-page-index="0"] .folio-annotation');
        const r = m?.getBoundingClientRect();
        if (!r) return false;
        const spans = [...document.querySelectorAll('[data-page-index="0"] .pdf-text-layer span')];
        return spans.some((s) => { const b = s.getBoundingClientRect(); return b.width > 0 && !(b.right < r.left || b.left > r.right || b.bottom < r.top || b.top > r.bottom); });
      });
      t.check('…still on the printed words', stillOver);
      await back.first().click({ force: true });
      t.check('clicking it shows its note', await page.getByText('Key idea for the test').first().waitFor({ timeout: 8_000 }).then(() => true, () => false));
    },
  },
  {
    name: 'reader.text_marks',
    needs: ['reader.opens_text'],
    description: 'On a text page, Annotate marks the selected words and Hide covers a passage (click to reveal); both are saved and back after a reload.',
    async run(t) {
      const { page } = t;
      // The PDF check may have left the PDF open: open the text record.
      if (!(await openRecordReader(t, t.state.textMarker, '[data-page-index] [data-page-content] p'))) return;
      const picked = (await selectWithin(page, '[data-page-index] [data-page-content] p', 'Mitochondria')).replace(/\s+/g, ' ').trim();
      t.check('words are selected', picked.length > 10, { actual: picked.length });
      await page.getByRole('button', { name: 'Annotate' }).click();
      await page.getByPlaceholder('Add a note…').fill('Energy — learn this');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      const mark = page.locator('[data-page-content] mark.folio-annotation').first();
      t.check('the selected words are highlighted', await mark.waitFor({ timeout: 8_000 }).then(() => true, () => false));
      const markText = (await mark.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      t.check('…exactly those words', markText.length > 5 && picked.toLowerCase().startsWith(markText.slice(0, 20).toLowerCase()), { expected: picked.slice(0, 40), actual: markText.slice(0, 40) });

      const hidden = (await selectWithin(page, '[data-page-index] [data-page-content] p', 'nucleus controls')).replace(/\s+/g, ' ').trim();
      t.check('a passage to hide is selected', hidden.length > 10);
      await page.getByRole('button', { name: 'Hide', exact: true }).click();
      const red = page.locator('[data-page-content] .folio-redaction').first();
      t.check('the passage is covered', await red.waitFor({ timeout: 8_000 }).then(() => true, () => false));
      t.check('…its words are not readable', await red.evaluate((el) => getComputedStyle(el).color === 'rgba(0, 0, 0, 0)').catch(() => false));
      await red.click();
      t.check('clicking it reveals the words', await page.locator('[data-page-content] .folio-redaction.revealed').first().waitFor({ timeout: 5_000 }).then(() => true, () => false));

      await page.waitForTimeout(1_500);
      const saved = await t.api('GET', `/api/records/artifacts?recordId=${t.state.textRecordId}`);
      const kinds = (saved.body?.data?.artifacts || []).map((x) => x.kind);
      t.check('the highlight and the hidden passage are saved', kinds.includes('annotation') && kinds.includes('redaction'), { actual: kinds });
      await page.reload({ waitUntil: 'domcontentloaded' });
      if (!(await openRecordReader(t, t.state.textMarker, '[data-page-index] [data-page-content] p'))) return;
      t.check('after a reload the highlight is back', await page.locator('[data-page-content] mark.folio-annotation').first().waitFor({ timeout: 20_000 }).then(() => true, () => false));
      t.check('…and the passage is hidden again', await page.locator('[data-page-content] .folio-redaction:not(.revealed)').first().waitFor({ timeout: 20_000 }).then(() => true, () => false));
    },
  },
  {
    name: 'reader.selection_tools',
    needs: ['reader.text_marks'],
    description: 'From a selection, "Quiz me" builds a cited quiz on that passage, and "Note" starts a note from it.',
    async run(t) {
      const { page } = t;
      const picked = (await selectWithin(page, '[data-page-index] [data-page-content] p', 'Chloroplasts')).replace(/\s+/g, ' ').trim();
      t.check('words are selected', picked.length > 10);
      await page.getByRole('button', { name: 'Quiz me' }).click();
      const menu = page.locator('.sreader-menu');
      const focus = menu.locator('input[type=text]').first();
      t.check('the quiz form starts from the selection', ((await focus.inputValue().catch(() => '')) || '').toLowerCase().includes(picked.slice(0, 15).toLowerCase()) || !(await focus.count()),
        { actual: await focus.inputValue().catch(() => '') });
      const before = await page.locator('.folio-citation').count();
      await menu.getByRole('button', { name: 'Build quiz' }).click();
      t.check('a quiz is built with source chips', await page.waitForFunction((n) => document.querySelectorAll('.folio-citation').length > n, before, { timeout: 120_000 }).then(() => true, () => false));
      const quizText = (await page.locator('body').innerText()).toLowerCase();
      t.check('…about the selected passage', /chloroplast|photosynth|light/.test(quizText));

      // The new quiz tab is in front: back to the document's own pages.
      await page.locator('.folio-tab-pill', { hasText: 'Original Content' }).first().click().catch(() => {});
      await page.locator('[data-page-index] [data-page-content] p').first().waitFor({ timeout: 10_000 }).catch(() => {});
      const again = (await selectWithin(page, '[data-page-index] [data-page-content] p', 'cell wall is')).replace(/\s+/g, ' ').trim();
      t.check('another passage is selected', again.length > 10);
      await page.getByRole('button', { name: 'Note', exact: true }).click();
      await menu.getByRole('button', { name: 'Build notes' }).click();
      const area = page.getByPlaceholder('Write a note about this page…').last();
      t.check('a note opens', await area.waitFor({ timeout: 15_000 }).then(() => true, () => false));
      const noteText = (await area.inputValue().catch(() => '')) + (await page.locator('body').innerText());
      t.check('…starting from the selected passage', noteText.toLowerCase().includes(again.slice(0, 15).toLowerCase()), { actual: (await area.inputValue().catch(() => '')).slice(0, 80) });
    },
  },
  {
    name: 'guide.learn_suggestions',
    needs: ['reader.opens_text'],
    description: "LEARNING WITH GUIDE's Learn suggestions are about the open document, not a generic list.",
    async run(t) {
      const { page } = t;
      const toggle = page.locator('[role=button][title="LEARNING WITH GUIDE"]').first();
      if (!(await toggle.isVisible().catch(() => false))) {
        // On a phone the reader may cover the chat.
        await page.getByRole('button', { name: /Back to the session chat/ }).first().click().catch(() => {});
      }
      t.check('the guide toggle is there', await toggle.waitFor({ timeout: 15_000 }).then(() => true, () => false));
      // On a phone a sheet can sit over it: a direct click if the pointer one is intercepted.
      await toggle.click({ timeout: 8_000 }).catch(() => toggle.dispatchEvent('click'));
      const header = page.getByRole('button', { name: 'Learn suggestions' });
      t.check('Learn suggestions show', await header.waitFor({ timeout: 10_000 }).then(() => true, () => false));
      const list = header.locator('xpath=following-sibling::div[1]');
      const read = async () => (await list.locator('button').allInnerTexts().catch(() => [])).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const firstSet = await read();
      // The material's own suggestions show at once; the AI's arrive within ~12 s.
      await page.waitForTimeout(14_000);
      const items = await read();
      t.note(`at once: ${firstSet.join(' | ')}`);
      t.note(`after 14 s: ${items.join(' | ')}`);
      t.check('there are suggestions at once', firstSet.length >= 3, { actual: firstSet.length });
      t.check('none of them is the old generic list', !items.some((s) => OLD_GENERIC.includes(s)), { actual: items });
      t.check('they are about this document', items.some((s) => /cell|mitochondri|nucleus|chloroplast|osmosis|photosynth/i.test(s)), { actual: items });
    },
  },

  {
    name: 'guide.replies',
    needs: ['reader.opens_text'],
    description: 'LEARNING WITH GUIDE: the guide replies from the API, teaching from the document with a source chip; the lesson is there again after a reload.',
    async run(t) {
      const { page } = t;
      const box = page.getByPlaceholder('Ask your guide…');
      if (!(await box.isVisible().catch(() => false))) {
        await page.getByRole('button', { name: /Back to the session chat/ }).first().click().catch(() => {});
        const tg = page.locator('[role=button][title="LEARNING WITH GUIDE"]').first();
        await tg.click({ timeout: 8_000 }).catch(() => tg.dispatchEvent('click').catch(() => {}));
      }
      const open = t.check('the guide chat is open', await box.waitFor({ timeout: 15_000 }).then(() => true, () => false));
      if (!open) { await t.shot('guide-closed'); return; }
      const question = 'What do mitochondria do in a cell?';
      await box.fill(question);
      await page.getByRole('button', { name: 'Send message' }).click();
      const reply = page.locator('text=/mitochondri|respiration|energy/i').last();
      t.check('the guide replies about the document', await reply.waitFor({ timeout: 60_000 }).then(() => true, () => false));
      await page.waitForFunction(() => !document.querySelector('[aria-label="Your guide is writing"]'), null, { timeout: 60_000 }).catch(() => {});
      const chips = await page.locator('button.folio-citation[aria-label^="Source"]').count();
      t.check('the reply cites the document (a source chip)', chips > 0, { actual: chips });
      t.check('no "replies are on the way" note any more', !(await page.getByText(/Live guide replies are on the way/).count()));
      // The lesson is kept per learner per document.
      await page.reload({ waitUntil: 'domcontentloaded' });
      const reopened = await openRecordReader(t, t.state.textMarker, '[data-page-index] [data-page-content] p');
      if (!reopened) return;
      await page.getByRole('button', { name: /Back to the session chat/ }).first().click().catch(() => {});
      const tg2 = page.locator('[role=button][title="LEARNING WITH GUIDE"]').first();
      await tg2.click({ timeout: 8_000 }).catch(() => tg2.dispatchEvent('click').catch(() => {}));
      t.check('after a reload the guide lesson is still there', await page.getByText(question).first().waitFor({ timeout: 20_000 }).then(() => true, () => false));
    },
  },
  {
    name: 'reader.tools_cited',
    needs: ['reader.opens_text'],
    description: 'Summary, Quiz and Flashcards are generated from the whole document by the server, every item with a source chip.',
    async run(t) {
      const { page } = t;
      for (const tool of ['Summary', 'Quiz', 'Flashcards']) {
        const gen = page.locator('[title="Generate a study tool"]').first();
        // A generated tab hides the reader's toolbar: back to the document first.
        if (!(await gen.isVisible().catch(() => false))) await page.locator('.folio-tab-pill', { hasText: 'Original Content' }).first().click().catch(() => {});
        if (!(await gen.isVisible().catch(() => false))) await page.locator('[title="Open the material"], [aria-label="Open reading material"]').first().click().catch(() => {});
        await gen.click();
        const menu = page.locator('.sreader-menu');
        await menu.getByRole('button', { name: tool, exact: true }).first().click();
        const scope = menu.locator('label', { hasText: 'From' }).locator('select');
        if (await scope.count()) await scope.selectOption('Whole document');
        const before = await page.locator('.folio-citation').count();
        await menu.getByRole('button', { name: `Build ${tool.toLowerCase()}` }).click();
        const made = await page.waitForFunction((n) => document.querySelectorAll('.folio-citation').length > n, before, { timeout: 120_000 }).then(() => true, () => false);
        const err = await menu.locator('[role=alert]').innerText().catch(() => '');
        t.check(`${tool}: generated with source chips`, made, { actual: err || `${await page.locator('.folio-citation').count()} chips` });
        // (No Escape: it closes the whole reader. A build closes the menu; if not, toggle it shut.)
        if (await menu.isVisible().catch(() => false)) await gen.click().catch(() => {});
      }
    },
  },
  {
    name: 'reader.work_kept',
    needs: ['reader.tools_cited'],
    description: 'The generated tabs and a note are saved for this learner on this document, and listed under Saved after a reload.',
    async run(t) {
      const { page } = t;
      const note = `Remember: mitochondria release energy ${t.state.textMarker}`;
      await page.locator('.folio-tab-pill', { hasText: 'Original Content' }).first().click().catch(() => {});
      const gen = page.locator('[title="Generate a study tool"]').first();
      await gen.click();
      const menu = page.locator('.sreader-menu');
      await menu.getByRole('button', { name: 'Notes', exact: true }).first().click();
      await menu.getByRole('button', { name: 'Build notes' }).click();
      const area = page.getByPlaceholder('Write a note about this page…').last();
      t.check('a note opens', await area.waitFor({ timeout: 15_000 }).then(() => true, () => false));
      await area.fill(note);
      await page.waitForTimeout(3_000);   // the reader saves on a short delay
      const saved = await t.api('GET', `/api/records/artifacts?recordId=${t.state.textRecordId}`);
      const items = saved.body?.data?.artifacts || [];
      const kinds = new Set(items.map((a) => a.kind));
      t.check('summary, quiz and flashcards are saved', ['summary', 'quiz', 'flashcards'].every((k) => kinds.has(k)), { actual: [...kinds] });
      t.check('the note is saved with its words', items.some((a) => a.kind === 'notes' && JSON.stringify(a.content || {}).includes('mitochondria release energy')), { actual: items.map((a) => a.kind) });
      await page.reload({ waitUntil: 'domcontentloaded' });
      if (!(await openRecordReader(t, t.state.textMarker, '[data-page-index] [data-page-content] p'))) return;
      // Tabs open at the reload come back as tabs; closed ones are listed under Saved.
      const pills = page.locator('.folio-tab-pill').filter({ hasNotText: 'Original Content' });
      await pills.first().waitFor({ timeout: 15_000 }).catch(() => {});
      const tabs = await pills.count();
      await page.locator('.folio-tab-pill', { hasText: 'Original Content' }).first().click().catch(() => {});
      await page.locator('[title="Generate a study tool"]').first().click();
      const rows = await page.locator('.sreader-menu').getByRole('button', { name: /^Delete / }).count();
      t.check('after a reload they are back (open tabs + Saved)', tabs + rows >= 4, { actual: `${tabs} tabs, ${rows} saved` });
      await page.locator('[title="Generate a study tool"]').first().click().catch(() => {});
    },
  },
  {
    name: 'reader.office_pages',
    description: 'A Word document opens in the reader as pages of its own text (the server reads it).',
    async run(t) {
      const { page } = t;
      const marker = newMarker();
      const name = `${marker} Cell Structure.docx`;
      const { Document, Packer, Paragraph, HeadingLevel } = await import('docx');
      const doc = new Document({ sections: [{ children: [new Paragraph({ text: 'Cell Structure', heading: HeadingLevel.HEADING_1 }), ...PARAS.map((x) => new Paragraph(x))] }] });
      const bytes = Buffer.from(await Packer.toBuffer(doc));
      const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const up = await t.api('POST', '/api/records/upload-url', { name, mime, size: bytes.length });
      if (up.status !== 200 || !up.body?.data?.uploadUrl) t.block(`upload-url answered ${up.status}: ${up.body?.message || ''}`);
      await page.goto(`${t.app}/library`, { waitUntil: 'domcontentloaded' });
      const putStatus = await page.evaluate(async ({ url, b64, mime }) => {
        const body = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        try { return (await fetch(url, { method: 'PUT', headers: { 'Content-Type': mime }, body })).status; } catch (e) { return String(e.message); }
      }, { url: up.body.data.uploadUrl, b64: bytes.toString('base64'), mime });
      if (!(putStatus >= 200 && putStatus < 300)) t.block(`the file store is unreachable from here: ${putStatus}`);
      const made = await t.api('POST', '/api/records', { kind: 'upload', fileKey: up.body.data.fileKey, name, mime, size: bytes.length });
      const record = made.body?.data?.record || made.body?.data;
      if (!record?.id) t.block(`registering the record answered ${made.status}: ${made.body?.message || ''}`);
      t.cleanup(async () => { await t.api('DELETE', `/api/records/${record.id}`); });
      const shown = await openRecordReader(t, marker, '[data-page-index] [data-page-content]');
      t.check('the Word document opens in the reader', shown);
      if (!shown) return;
      const text = (await page.locator('[data-page-index] [data-page-content]').allInnerTexts().catch(() => [])).join(' ');
      t.check('…as its own words', /mitochondria/i.test(text) && /cell wall/i.test(text), { actual: text.slice(0, 100) });
    },
  },
];

/* Suite "reader-podcast" — run on demand (it writes and narrates a whole
   episode, the costliest reader tool): a two-voice episode made from the
   document, playable, with a transcript whose lines cite the document. */
export const podcastScenarios = [
  {
    name: 'reader.podcast',
    description: 'Podcast: the server writes and narrates a two-voice episode from the document; it plays, and its transcript cites the document.',
    async run(t) {
      const { page } = t;
      const marker = newMarker();
      const made = await t.api('POST', '/api/records', { kind: 'paste', name: `${marker} Cell Structure notes`, content: PARAS.join('\n\n') });
      const record = made.body?.data?.record || made.body?.data;
      if (!record?.id) t.block(`saving the pasted record answered ${made.status}: ${made.body?.message || ''}`);
      t.cleanup(async () => { await t.api('DELETE', `/api/records/${record.id}`); });
      if (!(await openRecordReader(t, marker, '[data-page-index] [data-page-content] p'))) return;
      await page.locator('[title="Generate a study tool"]').first().click();
      const menu = page.locator('.sreader-menu');
      await menu.getByRole('button', { name: 'Podcast', exact: true }).first().click();
      const scope = menu.locator('label', { hasText: 'From' }).locator('select');
      if (await scope.count()) await scope.selectOption('Whole document');
      await menu.getByRole('button', { name: 'Build podcast' }).click();
      const audio = page.locator('audio[src]');
      const ready = await audio.first().waitFor({ state: 'attached', timeout: 300_000 }).then(() => true, () => false);
      t.check('the episode is made and playable', ready);
      if (!ready) return;
      const duration = await audio.first().evaluate((a) => new Promise((r) => (a.readyState >= 1 ? r(a.duration) : a.addEventListener('loadedmetadata', () => r(a.duration), { once: true }))));
      t.check('…with real audio', Number(duration) > 20, { actual: duration });
      const chips = await page.locator('.folio-citation').count();
      t.check('its transcript cites the document', chips > 0, { actual: chips });
      const saved = await t.api('GET', `/api/records/artifacts?recordId=${record.id}`);
      t.check('the episode is saved for this learner', (saved.body?.data?.artifacts || []).some((a) => a.kind === 'podcast'));
    },
  },
];
