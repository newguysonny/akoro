/**
 * MarkdownEditor — a lightweight rich-content editor for blog posts.
 * Toolbar (Bold / Italic / Heading / List / Quote / Link / Code) inserts
 * Markdown; a Preview tab renders it. The blog body is stored as the existing
 * typed-block array, so this converts markdown ⇄ blocks.
 */
import { useState, useRef } from 'react';
import { Bold, Italic, Heading, List, Quote, Link2, Code, Eye, Pencil } from 'lucide-react';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, FONT } from '../constants.js';

/* ── Inline markdown → HTML (shared shape with the reader) ─────────────────── */
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function mdInline(text) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

/* ── blocks ⇄ markdown ─────────────────────────────────────────────────────── */
export function blocksToMarkdown(blocks = []) {
  return (blocks || []).map((b) => {
    if (b.type === 'h') return `## ${b.text || ''}`;
    if (b.type === 'quote') return `> ${b.text || ''}`;
    if (b.type === 'list') return (b.items || []).map((it) => `- ${it}`).join('\n');
    return b.text || '';
  }).join('\n\n');
}

export function markdownToBlocks(md = '') {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let list = [];
  const flushPara = () => { if (para.length) { blocks.push({ type: 'p', text: para.join(' ').trim() }); para = []; } };
  const flushList = () => { if (list.length) { blocks.push({ type: 'list', items: list.slice() }); list = []; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,6}\s+/.test(line)) { flushPara(); flushList(); blocks.push({ type: 'h', text: line.replace(/^#{1,6}\s+/, '').trim() }); continue; }
    if (/^>\s?/.test(line)) { flushPara(); flushList(); blocks.push({ type: 'quote', text: line.replace(/^>\s?/, '').trim() }); continue; }
    if (/^[-*]\s+/.test(line)) { flushPara(); list.push(line.replace(/^[-*]\s+/, '').trim()); continue; }
    if (line.trim() === '') { flushPara(); flushList(); continue; }
    flushList(); para.push(line.trim());
  }
  flushPara(); flushList();
  return blocks.length ? blocks : [{ type: 'p', text: '' }];
}

/* ── Preview renderer ──────────────────────────────────────────────────────── */
function Preview({ md }) {
  const blocks = markdownToBlocks(md);
  return (
    <div style={{ fontFamily: FONT, color: INK, lineHeight: 1.7 }}>
      {blocks.map((b, i) => {
        if (b.type === 'h') return <h2 key={i} style={{ fontSize: 22, fontWeight: 800, margin: '20px 0 10px' }} dangerouslySetInnerHTML={{ __html: mdInline(b.text) }} />;
        if (b.type === 'quote') return <blockquote key={i} style={{ margin: '16px 0', padding: '12px 18px', background: LIGHT, borderLeft: `4px solid ${AMBER}`, borderRadius: '0 10px 10px 0', fontStyle: 'italic', fontWeight: 600 }} dangerouslySetInnerHTML={{ __html: mdInline(b.text) }} />;
        if (b.type === 'list') return <ul key={i} style={{ margin: '10px 0', paddingLeft: 22 }}>{b.items.map((it, j) => <li key={j} style={{ margin: '4px 0' }} dangerouslySetInnerHTML={{ __html: mdInline(it) }} />)}</ul>;
        return <p key={i} style={{ margin: '0 0 14px', fontSize: 15 }} dangerouslySetInnerHTML={{ __html: mdInline(b.text) }} />;
      })}
      {(!md || !md.trim()) && <p style={{ color: MUTED2, fontStyle: 'italic' }}>Nothing to preview yet.</p>}
    </div>
  );
}

/* ── Editor ────────────────────────────────────────────────────────────────── */
export default function MarkdownEditor({ value, onChange, minHeight = 320 }) {
  const [tab, setTab] = useState('write');   // write | preview
  const ref = useRef(null);

  // Wrap the current selection with before/after (e.g. ** ** for bold).
  const wrap = (before, after = before, placeholder = '') => {
    const el = ref.current; if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = value.slice(a, b) || placeholder;
    const next = value.slice(0, a) + before + sel + after + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => { el.focus(); const pos = a + before.length; el.setSelectionRange(pos, pos + sel.length); });
  };
  // Prefix each selected line (e.g. "## ", "- ", "> ").
  const prefixLines = (prefix) => {
    const el = ref.current; if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const start = value.lastIndexOf('\n', a - 1) + 1;
    const block = value.slice(start, b);
    const replaced = block.split('\n').map((l) => (l.startsWith(prefix) ? l : prefix + l)).join('\n');
    const next = value.slice(0, start) + replaced + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start, start + replaced.length); });
  };
  const insertLink = () => {
    const el = ref.current; if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = value.slice(a, b) || 'link text';
    const url = window.prompt('Link URL', 'https://') || 'https://';
    const md = `[${sel}](${url})`;
    onChange(value.slice(0, a) + md + value.slice(b));
    requestAnimationFrame(() => { el.focus(); const p = a + md.length; el.setSelectionRange(p, p); });
  };

  const tbtn = (onClick, Icon, title) => (
    <button type="button" onClick={onClick} title={title} style={{ width: 32, height: 30, borderRadius: 7, border: `1px solid ${BORDER}`, background: WHITE, color: INK, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={15} /></button>
  );

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', fontFamily: FONT }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '8px 10px', borderBottom: `1px solid ${BORDER}`, background: LIGHT }}>
        {tbtn(() => wrap('**', '**', 'bold text'), Bold, 'Bold')}
        {tbtn(() => wrap('*', '*', 'italic text'), Italic, 'Italic')}
        {tbtn(() => prefixLines('## '), Heading, 'Heading')}
        {tbtn(() => prefixLines('- '), List, 'List')}
        {tbtn(() => prefixLines('> '), Quote, 'Quote')}
        {tbtn(() => wrap('`', '`', 'code'), Code, 'Inline code')}
        {tbtn(insertLink, Link2, 'Link')}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 2 }}>
          <button type="button" onClick={() => setTab('write')} style={segStyle(tab === 'write')}><Pencil size={13} /> Write</button>
          <button type="button" onClick={() => setTab('preview')} style={segStyle(tab === 'preview')}><Eye size={13} /> Preview</button>
        </div>
      </div>

      {tab === 'write' ? (
        <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)}
          placeholder="Write your article. Use the toolbar or Markdown: **bold**, *italic*, ## Heading, - list, > quote, [link](https://…)."
          style={{ width: '100%', minHeight, border: 'none', outline: 'none', resize: 'vertical', padding: '16px 18px', fontSize: 15, lineHeight: 1.7, color: INK, fontFamily: FONT, boxSizing: 'border-box', background: WHITE }} />
      ) : (
        <div style={{ minHeight, padding: '16px 18px', background: WHITE, overflowY: 'auto' }}><Preview md={value} /></div>
      )}
    </div>
  );
}

const segStyle = (active) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, fontFamily: FONT, background: active ? AMBER : 'transparent', color: active ? WHITE : MUTED });
