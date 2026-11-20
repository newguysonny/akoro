/*
 * wordExtensions — what the document editor adds to TipTap so it can do what
 * Word's Home / Insert ribbons do (lib/wordDoc.js writes each one to .docx):
 *
 *   FontSize         textStyle.fontSize ("12pt")       setFontSize / unsetFontSize
 *   ParagraphFormat  lineHeight, indent (0.5" steps)   setLineHeight / indent / outdent
 *                    on paragraphs and headings
 *   PageBreak        a hard page break (Ctrl+Enter)    setPageBreak
 *   WordImage        a picture with its natural size and a width in % of the line
 */
import { Extension, Node, mergeAttributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';

export const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() { return { types: ['textStyle'] }; },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el) => el.style.fontSize || null,
          renderHTML: (attrs) => (attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {}),
        },
      },
    }];
  },
  addCommands() {
    return {
      setFontSize: (size) => ({ chain }) => chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

const BLOCKS = ['paragraph', 'heading'];
const MAX_INDENT = 8;

export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() {
    return [{
      types: BLOCKS,
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: (el) => (el.style.lineHeight ? Number(el.style.lineHeight) || null : null),
          renderHTML: (a) => (a.lineHeight ? { style: `line-height: ${a.lineHeight}` } : {}),
        },
        indent: {
          default: 0,
          parseHTML: (el) => Math.min(MAX_INDENT, Math.round((parseFloat(el.style.marginLeft) || 0) / 48)),
          renderHTML: (a) => (a.indent ? { style: `margin-left: ${a.indent * 0.5}in` } : {}),
        },
      },
    }];
  },
  addCommands() {
    const each = (fn) => ({ tr, state, dispatch }) => {
      const { from, to } = state.selection;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (BLOCKS.includes(node.type.name)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...fn(node.attrs) });
      });
      if (dispatch) dispatch(tr);
      return true;
    };
    return {
      setLineHeight: (lh) => each(() => ({ lineHeight: lh })),
      // In a list, Tab / Increase indent nests the item; elsewhere the paragraph moves in 0.5".
      indent: () => (props) => (props.editor.isActive('listItem') ? props.commands.sinkListItem('listItem') : each((a) => ({ indent: Math.min(MAX_INDENT, (a.indent || 0) + 1) }))(props)),
      outdent: () => (props) => (props.editor.isActive('listItem') ? props.commands.liftListItem('listItem') : each((a) => ({ indent: Math.max(0, (a.indent || 0) - 1) }))(props)),
    };
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => (this.editor.isActive('table') ? false : this.editor.commands.indent()),
      'Shift-Tab': () => (this.editor.isActive('table') ? false : this.editor.commands.outdent()),
    };
  },
});

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() { return [{ tag: 'div[data-page-break]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'wd-page-break', contenteditable: 'false' }), ['span', {}, 'Page break']];
  },
  addCommands() {
    return { setPageBreak: () => ({ chain }) => chain().insertContent({ type: this.name }).createParagraphNear().run() };
  },
  addKeyboardShortcuts() { return { 'Mod-Enter': () => this.editor.commands.setPageBreak() }; },
});

export const WordImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      naturalWidth: { default: null },
      naturalHeight: { default: null },
      widthPct: {
        default: 100,
        parseHTML: (el) => parseFloat(el.style.width) || 100,
        renderHTML: (a) => ({ style: `width: ${a.widthPct || 100}%; height: auto` }),
      },
    };
  },
}).configure({ inline: false, allowBase64: true });
