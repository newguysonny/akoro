/*
 * WordEditor — a document editor laid out like Microsoft Word, opened from an
 * assignment's answer box. The point is familiarity: many learners have no
 * laptop at home, so this is where they meet the ribbon, the page, the ruler
 * and the status bar they'll use at school and at work.
 *
 *   ┌ [doc] document-q3.docx · Saved to your answer          [Save to answer] [x] ┐
 *   │ File  Home  Insert  Layout  View  (Table) (Picture)                          │
 *   │ [Undo|Clipboard|Font|Paragraph|Styles|Editing]   ← the ribbon, by tab       │
 *   │ ruler                                                                        │
 *   │            ┌──── white page (A4 / Letter, margins) ────┐                    │
 *   │            │                                            │                    │
 *   │ Page 1 of 2 · 312 words · 1,804 characters     [print][mobile]  − 100% +     │
 *
 * "Save to answer" writes a real Word file (lib/wordDoc.js) and hands it to
 * the page, which attaches it to the question. Phones start in Mobile view
 * (the text reflows to the screen, as in Word's phone app); Print layout
 * shows the real page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import FontFamily from '@tiptap/extension-font-family';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { Icon } from '../common/Icons.jsx';
import Spinner from '../common/Spinner.jsx';
import { FontSize, ParagraphFormat, PageBreak, WordImage } from './wordExtensions.js';
import { FONTS, FONT_SIZES, LINE_SPACINGS, STYLES, PAGE_SIZES, MARGINS, DEFAULT_PAGE, DEFAULT_FONT, DEFAULT_SIZE, pageBox, pageCount } from '../../lib/wordDoc.js';
import { imageFileToDataUrl } from '../../lib/paper.js';

const WORD_BLUE = '#2B579A';
const RIBBON_BG = '#F3F3F3';
const LINE = '#D6D6D6';
const TXT = '#262626';
const SUB = '#605E5C';
const UI_FONT = "'Segoe UI', 'Nunito', system-ui, sans-serif";
const COLORS = ['#000000', '#404040', '#7F7F7F', '#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0', '#FFFFFF'];
const HIGHLIGHTS = ['#FFFF00', '#00FF00', '#00FFFF', '#FF00FF', '#0000FF', '#FF0000', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#C0C0C0'];
const SYMBOLS = ['Ω', 'π', '√', '±', '×', '÷', '°', 'µ', '≤', '≥', '≠', '≈', '∞', 'α', 'β', 'γ', 'θ', 'λ', 'Σ', 'Δ', '→', '←', '↑', '↓', '½', '¼', '¾', '²', '³', '₦', '€', '£', '©', '•', '…', '§'];
const ZOOMS = [50, 75, 90, 100, 125, 150, 200];
const BLOCK_SIZE = { 1: 28, 2: 16, 3: 13, 4: 12 };   // Word's Title / Heading 1–3, pt

const fontNameOf = (css) => (FONTS.find((f) => f.css === css || f.name === String(css || '').split(',')[0].replace(/['"]/g, '').trim())?.name) || DEFAULT_FONT;
const fontCss = (name) => FONTS.find((f) => f.name === name)?.css || name;

/* ── Ribbon pieces ──────────────────────────────────────────────────────── */

function Btn({ icon, label, onClick, active = false, disabled = false, big = false, text = null, wide = false, caret = false, title, bar = null }) {
  return (
    <button type="button" title={title || label} aria-label={label} aria-pressed={active || undefined} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      style={{
        display: 'inline-flex', flexDirection: big ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: big ? 3 : 4,
        minWidth: big ? 52 : 28, height: big ? 62 : 28, padding: big ? '4px 6px' : wide ? '0 8px' : '0 5px', borderRadius: 4, flexShrink: 0,
        border: `1px solid ${active ? '#C5C5C5' : 'transparent'}`, background: active ? '#DADADA' : 'transparent',
        color: disabled ? '#B5B5B5' : TXT, cursor: disabled ? 'default' : 'pointer', fontFamily: UI_FONT, fontSize: big ? 11.5 : 12, whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => { if (!disabled && !active) e.currentTarget.style.background = '#E5E5E5'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      {icon && !bar && <Icon name={icon} size={big ? 24 : 16} color={disabled ? '#B5B5B5' : big ? WORD_BLUE : TXT}/>}
      {icon && bar && (
        <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
          <Icon name={icon} size={15} color={TXT}/>
          <span style={{ width: 16, height: 3, background: bar, border: '0.5px solid rgba(0,0,0,.15)' }}/>
        </span>
      )}
      {text != null && <span style={{ lineHeight: 1.15 }}>{text}</span>}
      {caret && <Icon name="ti-chevron-down" size={10}/>}
    </button>
  );
}

function Group({ label, children, last = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', padding: '0 8px', borderRight: last ? 'none' : `1px solid ${LINE}`, flexShrink: 0 }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2 }}>{children}</div>
      <div style={{ fontSize: 10.5, color: SUB, textAlign: 'center', marginTop: 2, fontFamily: UI_FONT }}>{label}</div>
    </div>
  );
}

const CARET_BTN = { width: 14, height: 28, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', color: TXT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3 };
const Col = ({ children }) => <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>;
const Row = ({ children }) => <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>{children}</div>;

/** A ribbon button that opens a panel under it. */
function Drop({ open, setOpen, id, button, children, width = 'auto', align = 'left' }) {
  const on = open === id;
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {button(() => setOpen(on ? null : id), on)}
      {on && (
        <div onMouseDown={(e) => e.preventDefault()}
          style={{ position: 'fixed', zIndex: 3700, marginTop: 2, minWidth: 140, width, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 4, boxShadow: '0 6px 18px rgba(0,0,0,.16)', padding: 6, fontFamily: UI_FONT, ...(align === 'right' ? { transform: 'translateX(-60%)' } : {}) }}>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, note, onClick, checked = false, disabled = false }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '6px 9px', border: 'none', background: 'transparent', borderRadius: 3, cursor: disabled ? 'default' : 'pointer', color: disabled ? '#B5B5B5' : TXT, fontFamily: UI_FONT, fontSize: 12.5, textAlign: 'left' }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = '#EFEFEF'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
      <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}>{checked ? <Icon name="ti-check" size={14}/> : icon ? <Icon name={icon} size={15}/> : null}</span>
      <span style={{ flex: 1 }}>{label}{note && <span style={{ display: 'block', fontSize: 11, color: SUB }}>{note}</span>}</span>
    </button>
  );
}

function Swatches({ colors, onPick, onClear, clearLabel }) {
  return (
    <div style={{ width: 196 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 22px)', gap: 5, padding: 4 }}>
        {colors.map((c) => (
          <button key={c} type="button" title={c} aria-label={`Colour ${c}`} onClick={() => onPick(c)}
            style={{ width: 22, height: 22, borderRadius: 3, border: '1px solid #C8C8C8', background: c, cursor: 'pointer', padding: 0 }}/>
        ))}
      </div>
      <MenuItem icon="ti-x" label={clearLabel} onClick={onClear}/>
    </div>
  );
}

/* The ruler across the top of the page — centimetres from the left margin. */
function Ruler({ box, zoom }) {
  const cm = 96 / 2.54;
  const ticks = [];
  for (let x = -Math.floor(box.left / cm * 4) / 4; x * cm <= box.width - box.left + 0.1; x += 0.25) ticks.push(Math.round(x * 4) / 4);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', background: '#F7F7F7', borderBottom: `1px solid ${LINE}`, padding: '3px 0', overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ zoom: zoom / 100, position: 'relative', width: box.width, height: 18, background: '#fff', border: '1px solid #CFCFCF' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: box.left, background: '#DCDCDC' }}/>
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: box.right, background: '#DCDCDC' }}/>
        {ticks.map((t) => {
          const left = box.left + t * cm;
          const whole = Number.isInteger(t);
          return whole && t !== 0
            ? <span key={t} style={{ position: 'absolute', left, top: 2, transform: 'translateX(-50%)', fontSize: 9, color: '#555', fontFamily: UI_FONT }}>{Math.abs(t)}</span>
            : <span key={t} style={{ position: 'absolute', left, top: t % 0.5 === 0 ? 6 : 8, width: 1, height: t % 0.5 === 0 ? 6 : 3, background: '#888' }}/>;
        })}
        <span style={{ position: 'absolute', left: box.left - 5, top: -1, width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '6px solid #7A7A7A' }}/>
        <span style={{ position: 'absolute', left: box.width - box.right - 5, bottom: -1, width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: '6px solid #7A7A7A' }}/>
      </div>
    </div>
  );
}

const EDITOR_CSS = `
.wd-doc { outline: none; font-family: ${fontCss(DEFAULT_FONT)}; font-size: ${DEFAULT_SIZE}pt; line-height: 1.08; color: #000; caret-color: #000; word-wrap: break-word; }
.wd-doc p { margin: 0 0 8pt; }
.wd-doc h1 { font-family: 'Calibri Light', Calibri, Carlito, sans-serif; font-size: 28pt; font-weight: 400; letter-spacing: -0.5px; margin: 0 0 8pt; }
.wd-doc h2 { font-size: 16pt; font-weight: 400; color: #2F5496; margin: 12pt 0 4pt; }
.wd-doc h3 { font-size: 13pt; font-weight: 400; color: #1F3763; margin: 10pt 0 4pt; }
.wd-doc h4 { font-size: 12pt; font-weight: 400; font-style: italic; color: #2F5496; margin: 10pt 0 4pt; }
.wd-doc blockquote { margin: 10pt 0.5in; font-style: italic; color: #404040; }
.wd-doc, .wd-doc:focus, .wd-doc:focus-visible { outline: none !important; box-shadow: none !important; border: none !important; }
.wd-doc ul, .wd-doc ol { margin: 0 0 8pt; padding-left: 0.5in; }
.wd-doc ul { list-style: disc; } .wd-doc ul ul { list-style: circle; } .wd-doc ul ul ul { list-style: square; }
.wd-doc ol { list-style: decimal; } .wd-doc ol ol { list-style: lower-alpha; } .wd-doc ol ol ol { list-style: lower-roman; }
.wd-doc li { display: list-item; }
.wd-doc li p { margin: 0; }
.wd-doc a { color: #0563C1; text-decoration: underline; }
.wd-doc table { border-collapse: collapse; width: 100%; margin: 0 0 8pt; table-layout: fixed; }
.wd-doc td, .wd-doc th { border: 1px solid #000; padding: 2pt 5.4pt; vertical-align: top; min-width: 30px; position: relative; }
.wd-doc th { background: #F2F2F2; font-weight: 700; text-align: left; }
.wd-doc td p, .wd-doc th p { margin: 0; }
.wd-doc .selectedCell::after { content: ''; position: absolute; inset: 0; background: rgba(43,87,154,.18); pointer-events: none; }
.wd-doc img { display: block; max-width: 100%; margin: 4pt auto 8pt; }
.wd-doc img.ProseMirror-selectednode { outline: 2px solid ${WORD_BLUE}; }
.wd-doc hr { border: none; border-top: 1px solid #999; margin: 8pt 0; }
.wd-doc .wd-page-break { margin: 10pt 0; border-top: 1px dashed #A6A6A6; text-align: center; line-height: 0; user-select: none; }
.wd-doc .wd-page-break span { background: #fff; padding: 0 6px; font: 9pt ${UI_FONT}; color: #8A8A8A; }
.wd-doc .wd-page-break.ProseMirror-selectednode { border-top-color: ${WORD_BLUE}; }
.wd-doc p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: #A6A6A6; float: left; height: 0; pointer-events: none; }
.wd-doc ::selection { background: #C5DAF5; }
`;

/* ── The editor ─────────────────────────────────────────────────────────── */

/**
 * initial   { json?, html?, page? } — what to open (a saved draft, or a .docx read back)
 * onSave    async (json, page) → throws on failure; the page attaches the .docx
 * onDraft   (json, page) — every change, for this device's copy
 * dirty     the draft has changes that aren't in the attached file yet
 */
export default function WordEditor({ fileName = 'document.docx', subtitle = '', initial = {}, dirty: startDirty = false, onSave, onDraft, onClose, onDownload }) {
  const narrow = typeof window !== 'undefined' && window.innerWidth < 820;
  const [page, setPage] = useState(() => ({ ...DEFAULT_PAGE, ...(initial.page || {}) }));
  const [view, setView] = useState(narrow ? 'mobile' : 'print');
  const [zoom, setZoom] = useState(100);
  const [ruler, setRuler] = useState(true);
  const [tab, setTab] = useState('home');
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(null);           // which ribbon dropdown is open
  const [dirty, setDirty] = useState(startDirty);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [asking, setAsking] = useState(false);      // "save before closing?"
  const [menu, setMenu] = useState(null);           // right-click menu {x, y}
  const [find, setFind] = useState(null);           // { q, r, n, at }
  const [linkUrl, setLinkUrl] = useState('');
  const [lastColor, setLastColor] = useState('#C00000');
  const [lastMark, setLastMark] = useState('#FFFF00');
  const [height, setHeight] = useState(0);
  const [, setTick] = useState(0);
  const pageRef = useRef(null);
  const canvasRef = useRef(null);
  const picRef = useRef(null);
  const draftTimer = useRef(null);
  const box = pageBox(page);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Underline, TextStyle, Color, FontFamily, FontSize, Subscript, Superscript,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      ParagraphFormat, PageBreak, WordImage,
      Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: 'Start typing your answer…' }),
      CharacterCount,
    ],
    content: initial.json || initial.html || '',
    editorProps: { attributes: { class: 'wd-doc', spellcheck: 'true', 'aria-label': 'Document' } },
    onUpdate: ({ editor: ed }) => {
      setDirty(true);
      clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => onDraft?.(ed.getJSON(), pageRef.current), 600);
    },
    onSelectionUpdate: () => setTick((n) => n + 1),
  });
  pageRef.current = page;
  useEffect(() => () => clearTimeout(draftTimer.current), []);

  // A page setup change is a change too.
  const changePage = (patch) => { const next = { ...page, ...patch }; setPage(next); setDirty(true); onDraft?.(editor?.getJSON(), next); setOpen(null); };

  // Pictures read back from a .docx don't know their size yet — measure them once.
  useEffect(() => {
    if (!editor) return;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'image' || node.attrs.naturalWidth) return;
      const img = new window.Image();
      img.onload = () => {
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
        editor.view.dispatch(tr.setMeta('addToHistory', false));
      };
      img.src = node.attrs.src;
    });
  }, [editor]);

  // How tall the text is → how many pages, and which one the cursor is on.
  useEffect(() => {
    const el = editor?.view?.dom;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setHeight(el.scrollHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [editor]);
  const pages = view === 'print' ? pageCount(height, page) : Math.max(1, Math.ceil(height / 1000));
  let at = 1;
  try {
    if (editor && view === 'print') {
      const top = editor.view.coordsAtPos(editor.state.selection.from).top - editor.view.dom.getBoundingClientRect().top;
      at = Math.min(pages, Math.max(1, Math.floor(top / (zoom / 100) / box.contentHeight) + 1));
    }
  } catch { /* not laid out yet */ }

  // Desktop: fit the page if the window is narrower than it.
  useEffect(() => {
    if (view !== 'print' || !canvasRef.current) return;
    const w = canvasRef.current.clientWidth - 40;
    if (w > 0 && box.width > w) setZoom(Math.max(50, Math.floor((w / box.width) * 100)));
  }, [view, box.width]);   // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!editor || saving) return false;
    setSaving(true); setErr('');
    try {
      await onSave(editor.getJSON(), page);
      setDirty(false);
      return true;
    } catch (e) {
      setErr(e?.message || 'Could not save the document — try again.');
      return false;
    } finally {
      setSaving(false);
    }
  };
  const close = () => { if (dirty) setAsking(true); else onClose(); };

  // Ctrl+S saves, Esc closes menus — like Word.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setFind((f) => f || { q: '', r: '', n: 0 }); }
      if (e.key === 'Escape') { setOpen(null); setMenu(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    if (!open && !menu) return undefined;
    const shut = () => { setOpen(null); setMenu(null); };
    const t = setTimeout(() => window.addEventListener('click', shut), 0);
    return () => { clearTimeout(t); window.removeEventListener('click', shut); };
  }, [open, menu]);

  const inTable = !!editor?.isActive('table');
  const onImage = !!editor?.isActive('image');
  useEffect(() => { if ((tab === 'table' && !inTable) || (tab === 'picture' && !onImage)) setTab('home'); }, [tab, inTable, onImage]);

  const ts = editor?.getAttributes('textStyle') || {};
  const blockLevel = editor?.isActive('heading') ? editor.getAttributes('heading').level : null;
  const curFont = fontNameOf(ts.fontFamily);
  const curSize = ts.fontSize ? parseFloat(ts.fontSize) : BLOCK_SIZE[blockLevel] || DEFAULT_SIZE;
  const curStyle = editor?.isActive('blockquote') ? 'quote' : STYLES.find((s) => s.level && s.level === blockLevel)?.key || 'normal';
  const curLine = editor?.getAttributes(blockLevel ? 'heading' : 'paragraph')?.lineHeight || null;
  const c = () => editor.chain().focus();

  const setStyle = (key) => {
    const s = STYLES.find((x) => x.key === key);
    let ch = c();
    if (editor.isActive('blockquote') && key !== 'quote') ch = ch.lift('blockquote');
    if (key === 'normal') ch.setParagraph().run();
    else if (key === 'quote') ch.setParagraph().setBlockquote().run();
    else ch.setHeading({ level: s.level }).run();
  };
  const stepSize = (dir) => {
    const i = FONT_SIZES.findIndex((n) => n >= curSize);
    const next = dir > 0 ? FONT_SIZES[Math.min(FONT_SIZES.length - 1, (FONT_SIZES[i] === curSize ? i : i - 1) + 1)] : FONT_SIZES[Math.max(0, (i < 0 ? FONT_SIZES.length : i) - 1)];
    c().setFontSize(`${next}pt`).run();
  };

  const insertPicture = async (file) => {
    if (!file) return;
    setErr('');
    try {
      const src = await imageFileToDataUrl(file, { max: 1200, maxChars: 900_000 });
      const dims = await new Promise((res) => { const im = new window.Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.onerror = () => res([800, 600]); im.src = src; });
      c().insertContent({ type: 'image', attrs: { src, alt: file.name, naturalWidth: dims[0], naturalHeight: dims[1], widthPct: dims[0] < box.contentWidth ? Math.round((dims[0] / box.contentWidth) * 100) : 100 } }).run();
    } catch (e) {
      setErr(e?.message || 'Could not add that picture.');
    }
  };

  /* Find & replace over the document's text. */
  const matches = useMemo(() => {
    const q = find?.q?.trim();
    if (!editor || !q) return [];
    const out = [];
    const needle = q.toLowerCase();
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      const hay = node.text.toLowerCase();
      for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) out.push({ from: pos + i, to: pos + i + q.length });
    });
    return out;
  }, [editor, find?.q, editor?.state.doc]);   // eslint-disable-line react-hooks/exhaustive-deps
  const findNext = () => {
    if (!matches.length) return;
    const from = editor.state.selection.to;
    const m = matches.find((x) => x.from >= from) || matches[0];
    editor.chain().focus().setTextSelection(m).scrollIntoView().run();
  };
  const replaceAll = () => {
    if (!matches.length) return;
    const tr = editor.state.tr;
    [...matches].reverse().forEach((m) => tr.insertText(find.r || '', m.from, m.to));
    editor.view.dispatch(tr);
    setFind((f) => ({ ...f, done: matches.length }));
  };

  const clip = async (what) => {
    setMenu(null);
    editor.commands.focus();
    if (what === 'paste') {
      try { const t = await navigator.clipboard.readText(); if (t) editor.commands.insertContent(t.replace(/\n/g, '<br>')); }
      catch { setErr('To paste, press Ctrl+V (or long-press and Paste on a phone).'); }
      return;
    }
    try { document.execCommand(what); } catch { /* the browser said no */ }
  };

  if (!editor) return null;

  const words = editor.storage.characterCount.words();
  const chars = editor.storage.characterCount.characters();
  const tabs = [['file', 'File'], ['home', 'Home'], ['insert', 'Insert'], ['layout', 'Layout'], ['view', 'View'],
    ...(inTable ? [['table', 'Table']] : []), ...(onImage ? [['picture', 'Picture']] : [])];

  /* ── Ribbons ── */
  const home = (
    <>
      <Group label="Undo">
        <Col>
          <Btn icon="ti-arrow-back-up" label="Undo (Ctrl+Z)" onClick={() => c().undo().run()} disabled={!editor.can().undo()}/>
          <Btn icon="ti-arrow-forward-up" label="Redo (Ctrl+Y)" onClick={() => c().redo().run()} disabled={!editor.can().redo()}/>
        </Col>
      </Group>
      <Group label="Clipboard">
        <Btn big icon="ti-clipboard" text="Paste" label="Paste (Ctrl+V)" onClick={() => clip('paste')}/>
        <Col>
          <Btn icon="ti-scissors" label="Cut (Ctrl+X)" onClick={() => clip('cut')}/>
          <Btn icon="ti-copy" label="Copy (Ctrl+C)" onClick={() => clip('copy')}/>
        </Col>
      </Group>
      <Group label="Font">
        <Col>
          <Row>
            <select aria-label="Font" value={curFont} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => c().setFontFamily(fontCss(e.target.value)).run()}
              style={{ width: 128, height: 24, border: `1px solid #C8C8C8`, borderRadius: 2, fontSize: 12, fontFamily: UI_FONT, background: '#fff', color: TXT }}>
              {FONTS.map((f) => <option key={f.name} value={f.name} style={{ fontFamily: f.css }}>{f.name}</option>)}
            </select>
            <select aria-label="Font size" value={String(curSize)} onChange={(e) => c().setFontSize(`${e.target.value}pt`).run()}
              style={{ width: 52, height: 24, marginLeft: 3, border: `1px solid #C8C8C8`, borderRadius: 2, fontSize: 12, fontFamily: UI_FONT, background: '#fff', color: TXT }}>
              {[...new Set([...FONT_SIZES, curSize])].sort((a, b) => a - b).map((n) => <option key={n} value={String(n)}>{n}</option>)}
            </select>
            <Btn icon="ti-text-increase" label="Grow font" onClick={() => stepSize(1)}/>
            <Btn icon="ti-text-decrease" label="Shrink font" onClick={() => stepSize(-1)}/>
            <Btn icon="ti-clear-formatting" label="Clear all formatting" onClick={() => c().unsetAllMarks().setParagraph().run()}/>
          </Row>
          <Row>
            <Btn icon="ti-bold" label="Bold (Ctrl+B)" active={editor.isActive('bold')} onClick={() => c().toggleBold().run()}/>
            <Btn icon="ti-italic" label="Italic (Ctrl+I)" active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}/>
            <Btn icon="ti-underline" label="Underline (Ctrl+U)" active={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()}/>
            <Btn icon="ti-strikethrough" label="Strikethrough" active={editor.isActive('strike')} onClick={() => c().toggleStrike().run()}/>
            <Btn icon="ti-subscript" label="Subscript" active={editor.isActive('subscript')} onClick={() => c().toggleSubscript().run()}/>
            <Btn icon="ti-superscript" label="Superscript" active={editor.isActive('superscript')} onClick={() => c().toggleSuperscript().run()}/>
            <Drop open={open} setOpen={setOpen} id="mark" button={(toggle) => (
              <span style={{ display: 'inline-flex' }}>
                <Btn icon="ti-highlight" bar={lastMark} label="Text highlight colour" onClick={() => c().toggleHighlight({ color: lastMark }).run()}/>
                <button type="button" aria-label="Highlight colours" onMouseDown={(e) => e.preventDefault()} onClick={toggle} style={CARET_BTN}><Icon name="ti-chevron-down" size={10}/></button>
              </span>
            )}>
              <Swatches colors={HIGHLIGHTS} clearLabel="No colour" onPick={(col) => { setLastMark(col); c().setHighlight({ color: col }).run(); setOpen(null); }} onClear={() => { c().unsetHighlight().run(); setOpen(null); }}/>
            </Drop>
            <Drop open={open} setOpen={setOpen} id="color" button={(toggle) => (
              <span style={{ display: 'inline-flex' }}>
                <Btn icon="ti-text-color" bar={lastColor} label="Font colour" onClick={() => c().setColor(lastColor).run()}/>
                <button type="button" aria-label="Font colours" onMouseDown={(e) => e.preventDefault()} onClick={toggle} style={CARET_BTN}><Icon name="ti-chevron-down" size={10}/></button>
              </span>
            )}>
              <Swatches colors={COLORS} clearLabel="Automatic" onPick={(col) => { setLastColor(col); c().setColor(col).run(); setOpen(null); }} onClear={() => { c().unsetColor().run(); setOpen(null); }}/>
            </Drop>
          </Row>
        </Col>
      </Group>
      <Group label="Paragraph">
        <Col>
          <Row>
            <Btn icon="ti-list" label="Bullets" active={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()}/>
            <Btn icon="ti-list-numbers" label="Numbering" active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()}/>
            <Btn icon="ti-indent-decrease" label="Decrease indent (Shift+Tab)" onClick={() => c().outdent().run()}/>
            <Btn icon="ti-indent-increase" label="Increase indent (Tab)" onClick={() => c().indent().run()}/>
          </Row>
          <Row>
            {[['left', 'ti-align-left', 'Align left (Ctrl+L)'], ['center', 'ti-align-center', 'Centre (Ctrl+E)'], ['right', 'ti-align-right', 'Align right (Ctrl+R)'], ['justify', 'ti-align-justified', 'Justify (Ctrl+J)']].map(([a, ic, l]) => (
              <Btn key={a} icon={ic} label={l} active={editor.isActive({ textAlign: a }) || (a === 'left' && !['center', 'right', 'justify'].some((x) => editor.isActive({ textAlign: x })))} onClick={() => c().setTextAlign(a).run()}/>
            ))}
            <Drop open={open} setOpen={setOpen} id="spacing" button={(toggle, on) => <Btn icon="ti-line-height" label="Line and paragraph spacing" caret active={on} onClick={toggle}/>}>
              {LINE_SPACINGS.map((n) => <MenuItem key={n} label={n.toFixed(n % 1 ? 2 : 1).replace(/0$/, '')} checked={(curLine || 1.08) === n} onClick={() => { c().setLineHeight(n).run(); setOpen(null); }}/>)}
            </Drop>
          </Row>
        </Col>
      </Group>
      <Group label="Styles">
        <div style={{ display: 'flex', gap: 3 }}>
          {STYLES.map((s) => (
            <button key={s.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setStyle(s.key)} aria-pressed={curStyle === s.key}
              style={{ width: 66, height: 54, border: `1px solid ${curStyle === s.key ? WORD_BLUE : '#E1E1E1'}`, background: '#fff', borderRadius: 2, cursor: 'pointer', padding: '4px 3px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-start', overflow: 'hidden', flexShrink: 0 }}>
              <span style={{ fontFamily: s.key === 'title' ? "'Calibri Light', Calibri, sans-serif" : fontCss(DEFAULT_FONT), fontSize: s.key === 'title' ? 18 : s.key === 'h1' ? 14 : 12, color: s.key === 'h1' || s.key === 'h3' ? '#2F5496' : s.key === 'h2' ? '#1F3763' : '#000', fontStyle: s.key === 'quote' || s.key === 'h3' ? 'italic' : 'normal', whiteSpace: 'nowrap', lineHeight: 1.1 }}>AaBbCc</span>
              <span style={{ fontSize: 10, color: SUB, fontFamily: UI_FONT }}>{s.label}</span>
            </button>
          ))}
        </div>
      </Group>
      <Group label="Editing" last>
        <Col>
          <Btn icon="ti-search" text="Find" wide label="Find (Ctrl+F)" onClick={() => setFind((f) => f || { q: '', r: '', n: 0 })}/>
          <Btn icon="ti-replace" text="Replace" wide label="Replace" onClick={() => setFind((f) => ({ q: f?.q || '', r: f?.r || '', replace: true }))}/>
        </Col>
        <Btn icon="ti-select-all" text="Select" big label="Select all (Ctrl+A)" onClick={() => c().selectAll().run()}/>
      </Group>
    </>
  );

  const tableGrid = (
    <div>
      <div style={{ fontSize: 12, color: SUB, padding: '2px 4px 6px' }}>{open?.startsWith?.('grid:') ? `${open.split(':')[1]} × ${open.split(':')[2]} table` : 'Insert table'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 18px)', gap: 3, padding: 4 }}>
        {Array.from({ length: 48 }, (_, k) => {
          const r = Math.floor(k / 8) + 1, col = (k % 8) + 1;
          const [, hr, hc] = String(open).split(':');
          const lit = open?.startsWith?.('grid:') && r <= Number(hr) && col <= Number(hc);
          return (
            <button key={k} type="button" aria-label={`${r} by ${col} table`}
              onMouseEnter={() => setOpen(`grid:${r}:${col}`)}
              onClick={() => { c().insertTable({ rows: r, cols: col, withHeaderRow: false }).run(); setOpen(null); }}
              style={{ width: 18, height: 18, padding: 0, border: `1px solid ${lit ? '#E8A33D' : '#BEBEBE'}`, background: lit ? '#FCE4B6' : '#fff', cursor: 'pointer' }}/>
          );
        })}
      </div>
    </div>
  );

  const insert = (
    <>
      <Group label="Tables">
        <Drop open={open?.startsWith?.('grid') ? 'grid' : open} setOpen={(v) => setOpen(v === 'grid' ? 'grid:0:0' : v)} id="grid" button={(toggle, on) => <Btn big icon="ti-table" text="Table" caret active={on} label="Insert a table" onClick={toggle}/>}>
          {tableGrid}
        </Drop>
      </Group>
      <Group label="Illustrations">
        <Btn big icon="ti-photo" text="Pictures" label="Insert a picture from your device" onClick={() => picRef.current?.click()}/>
        <input ref={picRef} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} onChange={(e) => { insertPicture(e.target.files?.[0]); e.target.value = ''; }}/>
      </Group>
      <Group label="Pages">
        <Btn big icon="ti-page-break" text="Page Break" label="Page break (Ctrl+Enter)" onClick={() => c().setPageBreak().run()}/>
        <Btn big icon="ti-separator-horizontal" text="Line" label="Horizontal line" onClick={() => c().setHorizontalRule().run()}/>
      </Group>
      <Group label="Links">
        <Drop open={open} setOpen={(v) => { setOpen(v); setLinkUrl(editor.getAttributes('link').href || ''); }} id="link" button={(toggle, on) => <Btn big icon="ti-link" text="Link" active={on || editor.isActive('link')} label="Insert a link" onClick={toggle}/>} width={260}>
          <div style={{ padding: 4 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 12, color: SUB, marginBottom: 5 }}>Address</div>
            <input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.nextSibling?.firstChild?.click(); } }}
              style={{ width: '100%', boxSizing: 'border-box', height: 28, border: '1px solid #C8C8C8', borderRadius: 2, padding: '0 7px', fontSize: 12.5 }}/>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button type="button" onClick={() => { const u = linkUrl.trim(); if (u) c().extendMarkRange('link').setLink({ href: /^[a-z]+:/i.test(u) ? u : `https://${u}` }).run(); setOpen(null); }}
                style={{ flex: 1, height: 28, border: 'none', borderRadius: 2, background: WORD_BLUE, color: '#fff', fontSize: 12, cursor: 'pointer' }}>OK</button>
              <button type="button" onClick={() => { c().extendMarkRange('link').unsetLink().run(); setOpen(null); }}
                style={{ height: 28, padding: '0 10px', border: '1px solid #C8C8C8', borderRadius: 2, background: '#fff', fontSize: 12, cursor: 'pointer' }}>Remove link</button>
            </div>
          </div>
        </Drop>
      </Group>
      <Group label="Text">
        <Btn big icon="ti-calendar" text="Date" label="Insert today's date" onClick={() => c().insertContent(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })).run()}/>
      </Group>
      <Group label="Symbols" last>
        <Drop open={open} setOpen={setOpen} id="symbol" button={(toggle, on) => <Btn big icon="ti-omega" text="Symbol" caret active={on} label="Insert a symbol" onClick={toggle}/>} align="right">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 30px)', gap: 3 }}>
            {SYMBOLS.map((s) => (
              <button key={s} type="button" onClick={() => { c().insertContent(s).run(); setOpen(null); }}
                style={{ width: 30, height: 30, border: '1px solid #E1E1E1', background: '#fff', fontSize: 16, cursor: 'pointer', borderRadius: 2 }}>{s}</button>
            ))}
          </div>
        </Drop>
      </Group>
    </>
  );

  const layout = (
    <>
      <Group label="Page Setup">
        <Drop open={open} setOpen={setOpen} id="margins" button={(toggle, on) => <Btn big icon="ti-box-margin" text="Margins" caret active={on} label="Margins" onClick={toggle}/>} width={230}>
          {Object.entries(MARGINS).map(([k, m]) => <MenuItem key={k} label={m.label} note={m.note} checked={page.margins === k} onClick={() => changePage({ margins: k })}/>)}
        </Drop>
        <Drop open={open} setOpen={setOpen} id="orient" button={(toggle, on) => <Btn big icon="ti-file-orientation" text="Orientation" caret active={on} label="Orientation" onClick={toggle}/>}>
          <MenuItem label="Portrait" checked={page.orientation !== 'landscape'} onClick={() => changePage({ orientation: 'portrait' })}/>
          <MenuItem label="Landscape" checked={page.orientation === 'landscape'} onClick={() => changePage({ orientation: 'landscape' })}/>
        </Drop>
        <Drop open={open} setOpen={setOpen} id="size" button={(toggle, on) => <Btn big icon="ti-file" text="Size" caret active={on} label="Paper size" onClick={toggle}/>} width={200}>
          {Object.entries(PAGE_SIZES).map(([k, s]) => <MenuItem key={k} label={s.label} note={`${(s.w * 2.54).toFixed(1)} cm × ${(s.h * 2.54).toFixed(1)} cm`} checked={page.size === k} onClick={() => changePage({ size: k })}/>)}
        </Drop>
        <Btn big icon="ti-page-break" text="Breaks" label="Page break (Ctrl+Enter)" onClick={() => c().setPageBreak().run()}/>
      </Group>
      <Group label="Paragraph" last>
        <Col>
          <Btn icon="ti-indent-increase" text="Indent" wide label="Increase indent" onClick={() => c().indent().run()}/>
          <Btn icon="ti-indent-decrease" text="Outdent" wide label="Decrease indent" onClick={() => c().outdent().run()}/>
        </Col>
        <Drop open={open} setOpen={setOpen} id="spacing2" button={(toggle, on) => <Btn big icon="ti-line-height" text="Spacing" caret active={on} label="Line spacing" onClick={toggle}/>}>
          {LINE_SPACINGS.map((n) => <MenuItem key={n} label={String(n)} checked={(curLine || 1.08) === n} onClick={() => { c().setLineHeight(n).run(); setOpen(null); }}/>)}
        </Drop>
      </Group>
    </>
  );

  const viewTab = (
    <>
      <Group label="Views">
        <Btn big icon="ti-file-description" text="Print Layout" active={view === 'print'} label="Print layout — the real page" onClick={() => setView('print')}/>
        <Btn big icon="ti-device-mobile" text="Mobile View" active={view === 'mobile'} label="Mobile view — text fits the screen" onClick={() => setView('mobile')}/>
      </Group>
      <Group label="Show">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: TXT, fontFamily: UI_FONT, padding: '0 6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={ruler} onChange={(e) => setRuler(e.target.checked)}/> Ruler
        </label>
      </Group>
      <Group label="Zoom" last>
        <Btn big icon="ti-zoom-in" text="Zoom In" label="Zoom in" disabled={view !== 'print'} onClick={() => setZoom((z) => Math.min(200, z + 10))}/>
        <Btn big icon="ti-zoom-out" text="Zoom Out" label="Zoom out" disabled={view !== 'print'} onClick={() => setZoom((z) => Math.max(50, z - 10))}/>
        <Btn big icon="ti-file" text="100%" label="Zoom to 100%" disabled={view !== 'print'} onClick={() => setZoom(100)}/>
        <Btn big icon="ti-arrows-horizontal" text="Page Width" label="Fit the page to the window" disabled={view !== 'print'}
          onClick={() => { const w = (canvasRef.current?.clientWidth || box.width) - 40; setZoom(Math.max(50, Math.min(200, Math.floor((w / box.width) * 100)))); }}/>
      </Group>
    </>
  );

  const tableTab = (
    <>
      <Group label="Rows & Columns">
        <Col>
          <Btn icon="ti-row-insert-top" text="Insert Above" wide label="Insert a row above" onClick={() => c().addRowBefore().run()}/>
          <Btn icon="ti-row-insert-bottom" text="Insert Below" wide label="Insert a row below" onClick={() => c().addRowAfter().run()}/>
        </Col>
        <Col>
          <Btn icon="ti-column-insert-left" text="Insert Left" wide label="Insert a column to the left" onClick={() => c().addColumnBefore().run()}/>
          <Btn icon="ti-column-insert-right" text="Insert Right" wide label="Insert a column to the right" onClick={() => c().addColumnAfter().run()}/>
        </Col>
      </Group>
      <Group label="Delete">
        <Col>
          <Btn icon="ti-row-remove" text="Delete Row" wide label="Delete row" onClick={() => c().deleteRow().run()}/>
          <Btn icon="ti-column-remove" text="Delete Column" wide label="Delete column" onClick={() => c().deleteColumn().run()}/>
        </Col>
        <Btn big icon="ti-table-off" text="Delete Table" label="Delete table" onClick={() => c().deleteTable().run()}/>
      </Group>
      <Group label="Merge">
        <Btn big icon="ti-arrows-join" text="Merge Cells" label="Merge the selected cells" disabled={!editor.can().mergeCells()} onClick={() => c().mergeCells().run()}/>
        <Btn big icon="ti-arrows-split" text="Split Cell" label="Split the cell" disabled={!editor.can().splitCell()} onClick={() => c().splitCell().run()}/>
      </Group>
      <Group label="Style" last>
        <Btn big icon="ti-table-row" text="Header Row" label="Header row" onClick={() => c().toggleHeaderRow().run()}/>
      </Group>
    </>
  );

  const pictureTab = (
    <>
      <Group label="Size">
        {[25, 50, 75, 100].map((p) => (
          <Btn key={p} big icon="ti-dimensions" text={`${p}%`} label={`Picture width ${p}% of the line`} active={Number(editor.getAttributes('image').widthPct) === p}
            onClick={() => c().updateAttributes('image', { widthPct: p }).run()}/>
        ))}
      </Group>
      <Group label="Arrange" last>
        <Btn big icon="ti-trash" text="Delete" label="Delete the picture" onClick={() => c().deleteSelection().run()}/>
      </Group>
    </>
  );

  const fileTab = (
    <>
      <Group label="Save">
        <Btn big icon="ti-device-floppy" text="Save to answer" label="Save to your answer (Ctrl+S)" onClick={save} disabled={saving}/>
        {onDownload && <Btn big icon="ti-download" text="Download" label="Download a copy (.docx)" onClick={() => onDownload(editor.getJSON(), page)}/>}
      </Group>
      <Group label="Info" last>
        <div style={{ fontSize: 12, color: TXT, fontFamily: UI_FONT, lineHeight: 1.6, padding: '0 6px' }}>
          <b>{fileName}</b><br/>
          <span style={{ color: SUB }}>{words} words · {pages} page{pages === 1 ? '' : 's'} · {PAGE_SIZES[page.size]?.label} {page.orientation}</span>
        </div>
      </Group>
    </>
  );

  const ribbon = { file: fileTab, home, insert, layout, view: viewTab, table: tableTab, picture: pictureTab }[tab] || home;

  return (
    <div role="dialog" aria-label={`Document editor — ${fileName}`}
      style={{ position: 'fixed', inset: 0, zIndex: 3500, display: 'flex', flexDirection: 'column', background: '#E6E6E6', fontFamily: UI_FONT }}>
      <style>{EDITOR_CSS}</style>

      {/* Title bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(env(safe-area-inset-top, 0px) + 6px) 10px 6px', background: WORD_BLUE, color: '#fff', flexShrink: 0 }}>
        <Icon name="ti-file-type-docx" size={20} color="#fff"/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</div>
          <div style={{ fontSize: 10.5, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {saving ? 'Saving…' : dirty ? 'Not saved to your answer yet' : 'Saved to your answer'}{subtitle ? ` · ${subtitle}` : ''}
          </div>
        </div>
        <button type="button" onClick={save} disabled={saving || !dirty}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 3, border: '1px solid rgba(255,255,255,.55)', background: dirty ? '#fff' : 'transparent', color: dirty ? WORD_BLUE : '#fff', fontSize: 12.5, fontWeight: 600, cursor: saving || !dirty ? 'default' : 'pointer', fontFamily: UI_FONT, flexShrink: 0 }}>
          {saving ? <Spinner size={12}/> : <Icon name="ti-device-floppy" size={15}/>} <span>{dirty ? 'Save to answer' : 'Saved'}</span>
        </button>
        <button type="button" onClick={close} aria-label="Close the document"
          style={{ width: 32, height: 30, border: 'none', background: 'transparent', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3, flexShrink: 0 }}>
          <Icon name="ti-x" size={18}/>
        </button>
      </div>

      {/* Tabs */}
      <div role="tablist" style={{ display: 'flex', alignItems: 'flex-end', gap: 2, background: RIBBON_BG, padding: '4px 8px 0', overflowX: 'auto', flexShrink: 0, scrollbarWidth: 'none' }}>
        {tabs.map(([k, l]) => {
          const ctxTab = k === 'table' || k === 'picture';
          return (
            <button key={k} role="tab" aria-selected={tab === k} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setTab(k); setCollapsed(false); }}
              style={{ padding: '6px 12px 7px', border: 'none', borderBottom: `3px solid ${tab === k ? WORD_BLUE : 'transparent'}`, background: 'transparent', color: k === 'file' ? WORD_BLUE : ctxTab ? '#B45309' : tab === k ? WORD_BLUE : TXT, fontWeight: tab === k || k === 'file' ? 600 : 400, fontSize: 13, cursor: 'pointer', fontFamily: UI_FONT, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {l}
            </button>
          );
        })}
        <button type="button" aria-label={collapsed ? 'Show the ribbon' : 'Hide the ribbon'} onClick={() => setCollapsed((x) => !x)}
          style={{ marginLeft: 'auto', alignSelf: 'center', border: 'none', background: 'transparent', cursor: 'pointer', color: SUB, padding: '4px 6px', flexShrink: 0 }}>
          <Icon name={collapsed ? 'ti-chevron-down' : 'ti-chevron-up'} size={15}/>
        </button>
      </div>

      {/* Ribbon */}
      {!collapsed && (
        <div style={{ display: 'flex', alignItems: 'stretch', background: RIBBON_BG, borderBottom: `1px solid ${LINE}`, padding: '6px 4px 4px', overflowX: 'auto', overflowY: 'hidden', flexShrink: 0, minHeight: 86, boxSizing: 'border-box' }}>
          {ribbon}
        </div>
      )}

      {/* Find & replace */}
      {find && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '6px 10px', background: '#fff', borderBottom: `1px solid ${LINE}`, fontSize: 12, flexShrink: 0 }}>
          <Icon name="ti-search" size={14} color={SUB}/>
          <input autoFocus value={find.q} placeholder="Find in document" onChange={(e) => setFind((f) => ({ ...f, q: e.target.value, done: null }))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); findNext(); } }}
            style={{ width: 170, height: 26, border: '1px solid #C8C8C8', borderRadius: 2, padding: '0 7px', fontSize: 12.5 }}/>
          <span style={{ color: SUB, minWidth: 64 }}>{find.q ? `${matches.length} result${matches.length === 1 ? '' : 's'}` : ''}</span>
          <button type="button" onClick={findNext} disabled={!matches.length} style={{ height: 26, padding: '0 10px', border: '1px solid #C8C8C8', background: '#fff', borderRadius: 2, cursor: 'pointer', fontSize: 12 }}>Next</button>
          {find.replace && (
            <>
              <input value={find.r} placeholder="Replace with" onChange={(e) => setFind((f) => ({ ...f, r: e.target.value }))}
                style={{ width: 150, height: 26, border: '1px solid #C8C8C8', borderRadius: 2, padding: '0 7px', fontSize: 12.5 }}/>
              <button type="button" onClick={replaceAll} disabled={!matches.length} style={{ height: 26, padding: '0 10px', border: 'none', background: WORD_BLUE, color: '#fff', borderRadius: 2, cursor: 'pointer', fontSize: 12 }}>Replace All</button>
              {find.done != null && <span style={{ color: '#047857' }}>{find.done} replaced</span>}
            </>
          )}
          {!find.replace && <button type="button" onClick={() => setFind((f) => ({ ...f, replace: true }))} style={{ border: 'none', background: 'none', color: WORD_BLUE, cursor: 'pointer', fontSize: 12 }}>Replace…</button>}
          <button type="button" aria-label="Close find" onClick={() => setFind(null)} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: SUB }}><Icon name="ti-x" size={14}/></button>
        </div>
      )}

      {err && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: '#FDE7E9', color: '#A4262C', fontSize: 12, borderBottom: '1px solid #F1BBBC', flexShrink: 0 }}>
          <Icon name="ti-alert-circle" size={14}/> <span style={{ flex: 1 }}>{err}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setErr('')} style={{ border: 'none', background: 'none', color: '#A4262C', cursor: 'pointer' }}><Icon name="ti-x" size={13}/></button>
        </div>
      )}

      {view === 'print' && ruler && <Ruler box={box} zoom={zoom}/>}

      {/* The page */}
      <div ref={canvasRef} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 300) }); }}
        onMouseDown={(e) => { if (e.target === e.currentTarget) editor.commands.focus('end'); }}
        style={{ flex: 1, overflow: 'auto', padding: view === 'print' ? '20px 20px 40px' : 0, background: view === 'print' ? '#E6E6E6' : '#fff' }}>
        {view === 'print' ? (
          <div style={{ zoom: zoom / 100, width: box.width, margin: '0 auto' }}>
            <div onMouseDown={(e) => { if (e.target === e.currentTarget) editor.commands.focus('end'); }}
              style={{ position: 'relative', background: '#fff', boxShadow: '0 0 0 1px #D0D0D0, 0 2px 8px rgba(0,0,0,.12)', boxSizing: 'border-box', width: box.width,
                minHeight: box.height * pages - (pages > 1 ? 0 : 0), padding: `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px` }}>
              {/* where each page ends — the text keeps flowing, the line shows the break */}
              {Array.from({ length: pages - 1 }, (_, k) => (
                <div key={k} aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: box.top + (k + 1) * box.contentHeight, borderTop: '1px dashed #C8C8C8', pointerEvents: 'none' }}>
                  <span style={{ position: 'absolute', right: 8, top: 2, fontSize: 10, color: '#A0A0A0', fontFamily: UI_FONT }}>Page {k + 2}</span>
                </div>
              ))}
              <EditorContent editor={editor}/>
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: 760, margin: '0 auto', padding: '18px 16px 60px', boxSizing: 'border-box' }}>
            <EditorContent editor={editor}/>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 12px calc(env(safe-area-inset-bottom, 0px) + 4px)', background: RIBBON_BG, borderTop: `1px solid ${LINE}`, fontSize: 11.5, color: SUB, flexShrink: 0, whiteSpace: 'nowrap', overflowX: 'auto' }}>
        <span>Page {at} of {pages}</span>
        <span>{words.toLocaleString()} word{words === 1 ? '' : 's'}</span>
        <span>{chars.toLocaleString()} characters</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 2 }}>
          <button type="button" title="Print layout" aria-label="Print layout" aria-pressed={view === 'print'} onClick={() => setView('print')}
            style={{ border: 'none', background: view === 'print' ? '#DADADA' : 'transparent', borderRadius: 2, padding: '2px 5px', cursor: 'pointer', color: TXT }}><Icon name="ti-file-description" size={14}/></button>
          <button type="button" title="Mobile view" aria-label="Mobile view" aria-pressed={view === 'mobile'} onClick={() => setView('mobile')}
            style={{ border: 'none', background: view === 'mobile' ? '#DADADA' : 'transparent', borderRadius: 2, padding: '2px 5px', cursor: 'pointer', color: TXT }}><Icon name="ti-device-mobile" size={14}/></button>
        </span>
        {view === 'print' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(50, z - 10))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: TXT, fontSize: 14, padding: 0 }}>−</button>
            <input type="range" min={50} max={200} step={5} value={zoom} aria-label="Zoom" onChange={(e) => setZoom(Number(e.target.value))} style={{ width: 90, accentColor: WORD_BLUE }}/>
            <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(200, z + 10))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: TXT, fontSize: 14, padding: 0 }}>+</button>
            <select aria-label="Zoom level" value={ZOOMS.includes(zoom) ? zoom : ''} onChange={(e) => setZoom(Number(e.target.value))} style={{ border: 'none', background: 'transparent', fontSize: 11.5, color: SUB }}>
              {!ZOOMS.includes(zoom) && <option value="">{zoom}%</option>}
              {ZOOMS.map((z) => <option key={z} value={z}>{z}%</option>)}
            </select>
          </span>
        )}
      </div>

      {/* Right-click menu */}
      {menu && (
        <div onMouseDown={(e) => e.preventDefault()} style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 3800, width: 210, background: '#fff', border: `1px solid ${LINE}`, boxShadow: '0 6px 18px rgba(0,0,0,.18)', borderRadius: 4, padding: 4 }}>
          <MenuItem icon="ti-scissors" label="Cut" onClick={() => clip('cut')}/>
          <MenuItem icon="ti-copy" label="Copy" onClick={() => clip('copy')}/>
          <MenuItem icon="ti-clipboard" label="Paste" onClick={() => clip('paste')}/>
          <div style={{ height: 1, background: LINE, margin: '4px 0' }}/>
          {inTable ? (
            <>
              <MenuItem icon="ti-row-insert-bottom" label="Insert row below" onClick={() => { c().addRowAfter().run(); setMenu(null); }}/>
              <MenuItem icon="ti-column-insert-right" label="Insert column right" onClick={() => { c().addColumnAfter().run(); setMenu(null); }}/>
              <MenuItem icon="ti-row-remove" label="Delete row" onClick={() => { c().deleteRow().run(); setMenu(null); }}/>
              <MenuItem icon="ti-column-remove" label="Delete column" onClick={() => { c().deleteColumn().run(); setMenu(null); }}/>
              <MenuItem icon="ti-table-off" label="Delete table" onClick={() => { c().deleteTable().run(); setMenu(null); }}/>
            </>
          ) : (
            <>
              <MenuItem icon="ti-link" label="Link…" onClick={() => { setMenu(null); setTab('insert'); setLinkUrl(editor.getAttributes('link').href || ''); setTimeout(() => setOpen('link'), 0); }}/>
              <MenuItem icon="ti-clear-formatting" label="Clear formatting" onClick={() => { c().unsetAllMarks().run(); setMenu(null); }}/>
            </>
          )}
          <div style={{ height: 1, background: LINE, margin: '4px 0' }}/>
          <MenuItem icon="ti-select-all" label="Select all" onClick={() => { c().selectAll().run(); setMenu(null); }}/>
        </div>
      )}

      {/* Save before closing? */}
      {asking && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3900, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div role="alertdialog" aria-label="Save changes" style={{ width: '100%', maxWidth: 380, background: '#fff', borderRadius: 4, boxShadow: '0 12px 32px rgba(0,0,0,.3)', padding: '18px 20px', fontFamily: UI_FONT }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: TXT, marginBottom: 6 }}>Save changes to {fileName}?</div>
            <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginBottom: 16 }}>If you don't save, your answer keeps the last saved copy. Your changes stay on this device.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" disabled={saving} onClick={async () => { if (await save()) { setAsking(false); onClose(); } else setAsking(false); }}
                style={{ height: 32, padding: '0 16px', border: 'none', borderRadius: 2, background: WORD_BLUE, color: '#fff', fontSize: 12.5, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => { setAsking(false); onClose(); }} style={{ height: 32, padding: '0 16px', border: '1px solid #C8C8C8', borderRadius: 2, background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Don't Save</button>
              <button type="button" onClick={() => setAsking(false)} style={{ height: 32, padding: '0 16px', border: '1px solid #C8C8C8', borderRadius: 2, background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
