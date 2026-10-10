import assert from 'node:assert/strict';
import test from 'node:test';
import { officeBlockHtml, officeReaderPages } from './officePages.js';

test('blocks render by kind and carry their block index', () => {
  assert.equal(officeBlockHtml('# Title', 0), '<h1 data-block="0">Title</h1>');
  assert.equal(officeBlockHtml('## Section', 1), '<h2 data-block="1">Section</h2>');
  assert.equal(officeBlockHtml('#### Deep', 2), '<h3 data-block="2">Deep</h3>');
  assert.equal(officeBlockHtml('  - Nested **key** <b>', 3),
    '<ul class="doc-li" data-block="3" style="padding-left:2.6rem"><li>Nested <strong>key</strong> &lt;b&gt;</li></ul>');
  assert.equal(officeBlockHtml('> **Speaker notes:** Say hi', 4), '<p class="doc-notes" data-block="4"><strong>Speaker notes</strong> Say hi</p>');
  assert.equal(officeBlockHtml('line one\nline two', 5, ' data-cite="p-0"'), '<p data-block="5" data-cite="p-0">line one<br>line two</p>');
});

test('tables keep their cells, an escaped pipe included', () => {
  const html = officeBlockHtml('| A | B |\n| --- | --- |\n| x \\| y | z |', 6);
  assert.match(html, /^<div class="doc-table-wrap" data-block="6"><table class="doc-table">/);
  assert.match(html, /<thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead>/);
  assert.match(html, /<td>x \| y<\/td><td>z<\/td>/);
});

test('extraction pages → reader pages, in page order, page i = extraction page i + 1', () => {
  const pages = officeReaderPages([
    { pageNumber: 2, markdown: '## Two\n\nBody', blocks: [{ bbox_2d: [0, 1, 1000, 2], text_content: 'Body' }, { bbox_2d: [0, 0, 1000, 1], text_content: '## Two' }] },
    { pageNumber: 1, markdown: '## One', blocks: [] },
    { pageNumber: 3, markdown: '', blocks: [] },
  ], { kind: 'pptx', name: 'Deck <1>' });
  assert.equal(pages.length, 3);
  assert.match(pages[0].html, /^<div class="doc-eyebrow">SLIDE 01 · Deck &lt;1&gt;<\/div><h2 data-block="0" data-cite="p-0">One<\/h2>/);
  assert.match(pages[1].html, /SLIDE 02<\/div><h2 data-block="0" data-cite="p-1">Two<\/h2><p data-block="1">Body<\/p>/);
  assert.match(pages[2].html, /This slide has no text/);
  assert.equal(pages[1].text, '## Two\n\nBody');
  assert.match(officeReaderPages([{ pageNumber: 1, markdown: 'x', blocks: [] }])[0].html, /PAGE 01/);
});
