import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '@tiptap/react';
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
import { FontSize, ParagraphFormat, PageBreak, WordImage } from '../wordExtensions.js';
import { FONT_SIZES, STYLES, DEFAULT_PAGE, DEFAULT_SIZE, pageBox, pageCount } from '../../../lib/wordDoc.js';
import { imageFileToDataUrl } from '../../../lib/paper.js';
import { BLOCK_SIZE, fontNameOf } from '../components/wordEditorTokens.js';

/**
 * initial   { json?, html?, page? } — what to open (a saved draft, or a .docx read back)
 * onSave    async (json, page) → throws on failure; the page attaches the .docx
 * onDraft   (json, page) — every change, for this device's copy
 * dirty     the draft has changes that aren't in the attached file yet
 */
export default function useWordEditor({ fileName = 'document.docx', subtitle = '', initial = {}, dirty: startDirty = false, onSave, onDraft, onClose, onDownload }) {
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

  const words = editor ? editor.storage.characterCount.words() : 0;
  const chars = editor ? editor.storage.characterCount.characters() : 0;
  const tabs = [['file', 'File'], ['home', 'Home'], ['insert', 'Insert'], ['layout', 'Layout'], ['view', 'View'],
    ...(inTable ? [['table', 'Table']] : []), ...(onImage ? [['picture', 'Picture']] : [])];

  return {
    editor, page, view, setView, zoom, setZoom, ruler, setRuler, tab, setTab,
    collapsed, setCollapsed, open, setOpen, dirty, saving, err, setErr,
    asking, setAsking, menu, setMenu, find, setFind, linkUrl, setLinkUrl,
    lastColor, setLastColor, lastMark, setLastMark, canvasRef, picRef,
    box, pages, at, inTable, onImage, curFont, curSize, curStyle, curLine,
    matches, words, chars, tabs, changePage, save, close, c, setStyle,
    stepSize, insertPicture, findNext, replaceAll, clip, fileName, subtitle,
    onClose, onDownload,
  };
}
