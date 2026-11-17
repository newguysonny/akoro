/**
 * readerArtifacts.js — reader tabs ⇄ saved items (pure, tested).
 *
 * A generated tab (summary / quiz / flashcards / podcast) or a notes tab is
 * saved as one artifact: its form values become `params`, what it shows
 * becomes `content`, and the learner's progress (quiz answers, card index)
 * rides `content.ui`. Annotations and hidden passages are artifacts too.
 */
import { cleanRects } from './markRects.js';

export const TAB_KINDS = new Set(['summary', 'quiz', 'flashcards', 'notes', 'podcast']);
const CONTENT_KEYS = ['summaryPoints', 'quizQuestions', 'cardSet', 'notesValue', 'emptyReason', 'podcast', 'podcastBlurb'];
const UI_KEYS = ['quizAnswers', 'quizIndex', 'cardIndex'];
const TOOL_LABELS = { summary: 'Summary', quiz: 'Quiz', flashcards: 'Flashcards', notes: 'Notes', podcast: 'Podcast' };

/** A tab → the artifact body the API stores. */
export function tabToArtifact(tab, { open = true } = {}) {
  const content = {};
  for (const k of CONTENT_KEYS) if (tab[k] !== undefined) content[k] = tab[k];
  const ui = {};
  for (const k of UI_KEYS) if (tab[k] !== undefined) ui[k] = tab[k];
  if (Object.keys(ui).length) content.ui = ui;
  return {
    kind: tab.toolId,
    pageNumber: Number.isInteger(tab.createdPage) ? tab.createdPage + 1 : null,
    params: tab.values || {},
    content,
    open,
  };
}

/** Only what changes as the learner works: the content to PATCH. */
export function tabContentPatch(tab) {
  return { content: tabToArtifact(tab).content };
}

/** A saved artifact → a tab the reader can show (id is the reader's tab id). */
export function artifactToTab(a, id) {
  const { ui = {}, ...content } = a.content || {};
  const values = a.params || {};
  const createdPage = Number.isInteger(a.pageNumber) ? a.pageNumber - 1 : 0;
  const focus = (values.focus && String(values.focus).trim())
    || (values.scope === 'Whole document' ? 'Whole document' : `Page ${createdPage + 1}`);
  return {
    id, artifactId: a.id, toolId: a.kind, values, createdPage, createdAt: a.createdAt || null,
    title: `${TOOL_LABELS[a.kind] || a.kind} · ${focus.length > 22 ? `${focus.slice(0, 22)}…` : focus}`,
    cardIndex: 0, flipped: false, quizIndex: 0, quizHint: null,
    ...content,
    ...ui,
  };
}

/** Saved annotations / hidden passages → the reader's in-page marks. */
export function marksFromArtifacts(artifacts) {
  const annotations = [];
  const redactions = [];
  for (const a of artifacts || []) {
    const page = Number.isInteger(a.pageNumber) ? a.pageNumber - 1 : 0;
    const text = String(a.content?.text || '');
    if (!text) continue;
    // rects: where the mark sits on a drawn page (PDF canvas / image), in percent.
    const rects = cleanRects(a.content?.rects);
    if (a.kind === 'annotation') annotations.push({ id: `ann-${a.id}`, artifactId: a.id, page, text, note: String(a.content?.note || ''), rects });
    if (a.kind === 'redaction') redactions.push({ id: `red-${a.id}`, artifactId: a.id, page, text, rects });
  }
  return { annotations, redactions };
}
