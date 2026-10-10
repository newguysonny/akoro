/**
 * officePages — a Word / PowerPoint record's saved extraction → reader pages.
 *
 * The server reads a .docx / .pptx into pages of markdown blocks (headings,
 * paragraphs, list items, tables, speaker notes). Each block becomes one
 * HTML element carrying data-block="i" — the same i the server put in the
 * block's anchor box ([0, i, 1000, i+1]) — so a citation's box resolves to
 * the paragraph it quotes and the reader flashes THAT paragraph.
 *
 * Page i of the reader is extraction page i + 1 (no cover page), so a
 * citation's pageNumber maps straight to the page it names.
 */

const escapeHtml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Escaped text with **bold** kept. */
const inline = (s) => escapeHtml(s).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

/** A markdown table row → its cells (an escaped "\|" stays in the cell). */
const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '')
  .split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

function tableHtml(md, attrs) {
  const lines = md.split('\n').filter((l) => l.trim().startsWith('|'));
  const rows = lines.filter((l) => !/^\|\s*-{3,}/.test(l.trim())).map(cellsOf);
  if (!rows.length) return '';
  const [head, ...body] = rows;
  return `<div class="doc-table-wrap"${attrs}><table class="doc-table"><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
    + `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/** One markdown block → HTML, tagged with its block index. */
export function officeBlockHtml(text, i, extra = '') {
  const md = String(text ?? '');
  const attrs = ` data-block="${i}"${extra}`;
  const h = /^(#{1,6})\s+(.*)$/s.exec(md.trim());
  if (h) {
    const tag = h[1].length === 1 ? 'h1' : h[1].length === 2 ? 'h2' : 'h3';
    return `<${tag}${attrs}>${inline(h[2])}</${tag}>`;
  }
  const li = /^( *)- (.*)$/s.exec(md);
  if (li) {
    const lvl = Math.min(6, Math.floor(li[1].length / 2));
    return `<ul class="doc-li"${attrs} style="padding-left:${(1.4 + lvl * 1.2).toFixed(1)}rem"><li>${inline(li[2]).replace(/\n/g, '<br>')}</li></ul>`;
  }
  if (md.trim().startsWith('|')) return tableHtml(md, attrs) || `<p${attrs}>${inline(md)}</p>`;
  const notes = /^>\s*\*\*Speaker notes:\*\*\s*(.*)$/s.exec(md.trim());
  if (notes) return `<p class="doc-notes"${attrs}><strong>Speaker notes</strong> ${inline(notes[1])}</p>`;
  const quote = /^>\s?(.*)$/s.exec(md.trim());
  if (quote) return `<blockquote${attrs}>${inline(quote[1]).replace(/\n/g, '<br>')}</blockquote>`;
  return `<p${attrs}>${inline(md.trim()).replace(/\n/g, '<br>')}</p>`;
}

/** The blocks of one saved page — the server's, else its markdown split. */
const blockTexts = (page) => {
  const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
  if (blocks.length) {
    return [...blocks]
      .sort((a, b) => (a?.bbox_2d?.[1] ?? 0) - (b?.bbox_2d?.[1] ?? 0))
      .map((b) => ({ i: Number(b?.bbox_2d?.[1]) || 0, text: String(b?.text_content ?? '') }));
  }
  return String(page?.markdown || '').split(/\n{2,}/).filter((t) => t.trim()).map((text, i) => ({ i, text }));
};

/**
 * Saved extraction pages → reader pages [{ html, text }].
 * kind: 'docx' | 'pptx' — slides get a "SLIDE 03" eyebrow, documents a
 * "PAGE 03" one; the first block carries the page's citation anchor.
 */
export function officeReaderPages(extractionPages, { kind = 'docx', name = '' } = {}) {
  const pages = [...(extractionPages || [])]
    .filter((p) => Number.isInteger(p?.pageNumber))
    .sort((a, b) => a.pageNumber - b.pageNumber);
  const label = kind === 'pptx' ? 'SLIDE' : 'PAGE';
  return pages.map((p, idx) => {
    const blocks = blockTexts(p);
    const eyebrow = `<div class="doc-eyebrow">${label} ${String(p.pageNumber).padStart(2, '0')}${idx === 0 && name ? ` · ${escapeHtml(name)}` : ''}</div>`;
    const body = blocks.length
      ? blocks.map((b, j) => officeBlockHtml(b.text, b.i, j === 0 ? ` data-cite="p-${idx}"` : '')).join('')
      : `<p data-cite="p-${idx}" class="doc-empty">${kind === 'pptx' ? 'This slide has no text.' : 'This page has no text.'}</p>`;
    return {
      html: `${eyebrow}${body}<div class="page-foot">${p.pageNumber}</div>`,
      text: String(p.markdown || blocks.map((b) => b.text).join('\n\n')),
    };
  });
}
