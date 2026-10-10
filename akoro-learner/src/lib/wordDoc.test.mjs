import assert from 'node:assert/strict';
import test from 'node:test';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { docxBuffer, pageBox, pageCount, textStats } from './wordDoc.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [t('Photosynthesis')] },
    { type: 'heading', attrs: { level: 2 }, content: [t('What plants need')] },
    { type: 'paragraph', attrs: { textAlign: 'justify', indent: 1, lineHeight: 1.5 }, content: [
      t('Plants take in '), t('carbon dioxide', [{ type: 'bold' }]), t(' and '), t('water', [{ type: 'italic' }, { type: 'textStyle', attrs: { color: '#C00000', fontFamily: "'Times New Roman', serif", fontSize: '14pt' } }]),
      t('. CO'), t('2', [{ type: 'subscript' }]), { type: 'hardBreak' }, t('Read more', [{ type: 'link', attrs: { href: 'https://example.com' } }]), t(' '), t('key', [{ type: 'highlight', attrs: { color: '#FFFF00' } }]),
    ] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [t('Light')] }, { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [t('Sunlight')] }] }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [t('Chlorophyll')] }] },
    ] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [t('First step')] }] }] },
    { type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [t('Input')] }] }, { type: 'tableHeader', content: [{ type: 'paragraph', content: [t('Output')] }] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: [{ type: 'paragraph', content: [t('Glucose')] }] }] },
    ] },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [t('Light is energy.')] }] },
    { type: 'image', attrs: { src: PNG, naturalWidth: 1, naturalHeight: 1, widthPct: 50 } },
    { type: 'horizontalRule' },
    { type: 'pageBreak' },
    { type: 'paragraph', content: [t('Page two')] },
  ],
};

test('the document becomes a real Word file that reads back', async () => {
  const buf = await docxBuffer(doc, { size: 'A4', orientation: 'landscape', margins: 'narrow' }, { title: 'Q3' });
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });
  assert.match(html, /<h1>Photosynthesis<\/h1>|Photosynthesis/);
  assert.match(html, /<strong>carbon dioxide<\/strong>/);
  assert.match(html, /<em>water<\/em>/);
  assert.match(html, /<ul><li>Light<ol><li>Sunlight<\/li><\/ol><\/li><li>Chlorophyll<\/li><\/ul>/);
  assert.match(html, /<ol><li>First step<\/li><\/ol>/);
  assert.match(html, /<table>.*Input.*Output.*Glucose.*<\/table>/s);
  assert.match(html, /<a href="https:\/\/example.com">Read more<\/a>/);
  assert.match(html, /<img src="data:image\/png;base64/);
  assert.match(html, /Page two/);

  const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string');
  assert.match(xml, /w:pStyle w:val="Title"/);
  assert.match(xml, /w:pStyle w:val="Heading1"/);
  assert.match(xml, /w:jc w:val="center"/);
  assert.match(xml, /w:jc w:val="both"/);
  assert.match(xml, /w:ind w:left="720"/);
  assert.match(xml, /w:spacing w:line="360"/);
  assert.match(xml, /w:color w:val="C00000"/);
  assert.match(xml, /w:ascii="Times New Roman"/);
  assert.match(xml, /w:sz w:val="28"/);
  assert.match(xml, /w:vertAlign w:val="subscript"/);
  assert.match(xml, /w:fill="FFFF00"/);
  assert.match(xml, /w:gridSpan w:val="2"/);
  assert.match(xml, /w:br w:type="page"/);
  assert.match(xml, /w:orient="landscape"/);
  assert.match(xml, /w:pgMar w:top="720"/);
  assert.match(xml, /w:pStyle w:val="Quote"/);
});

test('an empty document is still a valid file', async () => {
  const buf = await docxBuffer({ type: 'doc', content: [] });
  const { value } = await mammoth.convertToHtml({ buffer: buf });
  assert.equal(value.trim(), '');
});

test('page setup in px, page count, word count', () => {
  const a4 = pageBox();
  assert.equal(a4.width, 794);
  assert.equal(a4.contentWidth, 794 - 192);
  assert.equal(pageBox({ size: 'A4', orientation: 'landscape', margins: 'normal' }).width, 1122);
  assert.equal(pageCount(10), 1);
  assert.equal(pageCount(a4.contentHeight * 2 + 40), 3);
  assert.deepEqual(textStats('Plants  make food.\nIn light'), { words: 5, characters: 26 });
  assert.deepEqual(textStats('   '), { words: 0, characters: 3 });
});
