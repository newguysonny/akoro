import { FONTS, DEFAULT_FONT, DEFAULT_SIZE } from '../../../lib/wordDoc.js';

export const WORD_BLUE = '#2B579A';
export const RIBBON_BG = '#F3F3F3';
export const LINE = '#D6D6D6';
export const TXT = '#262626';
export const SUB = '#605E5C';
export const UI_FONT = "'Segoe UI', 'Nunito', system-ui, sans-serif";
export const COLORS = ['#000000', '#404040', '#7F7F7F', '#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0', '#FFFFFF'];
export const HIGHLIGHTS = ['#FFFF00', '#00FF00', '#00FFFF', '#FF00FF', '#0000FF', '#FF0000', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#C0C0C0'];
export const SYMBOLS = ['Ω', 'π', '√', '±', '×', '÷', '°', 'µ', '≤', '≥', '≠', '≈', '∞', 'α', 'β', 'γ', 'θ', 'λ', 'Σ', 'Δ', '→', '←', '↑', '↓', '½', '¼', '¾', '²', '³', '₦', '€', '£', '©', '•', '…', '§'];
export const ZOOMS = [50, 75, 90, 100, 125, 150, 200];
export const BLOCK_SIZE = { 1: 28, 2: 16, 3: 13, 4: 12 };   // Word's Title / Heading 1–3, pt

export const fontNameOf = (css) => (FONTS.find((f) => f.css === css || f.name === String(css || '').split(',')[0].replace(/['"]/g, '').trim())?.name) || DEFAULT_FONT;
export const fontCss = (name) => FONTS.find((f) => f.name === name)?.css || name;

export const EDITOR_CSS = `
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
