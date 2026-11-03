/**
 * modules/self-study/answerFormat.js — how learners may answer an assignment.
 *
 *   images       photos (or a whiteboard drawing) of their answers — nothing typed
 *   text         typed answers — no attachments, drawings or documents
 *   images_text  both: typed answers and photos / drawings
 *   all          everything the app takes: typed, photos, drawings, PDFs, Word documents
 *
 * Stored on the assignment as details.answer_format. A missing value is `all`, which is what every
 * assignment made before this setting did, so existing work behaves exactly as it always has.
 * The learner app hides what a format doesn't allow; the API enforces it (the app is not the gate).
 */

export const ANSWER_FORMATS = Object.freeze(['all', 'images_text', 'images', 'text']);

export const ANSWER_FORMAT_INFO = Object.freeze({
  images:      { label: 'Images only',  hint: 'Up to three answer photos per question' },
  text:        { label: 'Text only',    hint: 'Typed answers without answer photos' },
  images_text: { label: 'Images + text', hint: 'Learners may submit both formats' },
  all:         { label: 'All types',    hint: 'Typed answers, photos, drawings, PDFs and Word documents' },
});

export const cleanAnswerFormat = (v) => (ANSWER_FORMATS.includes(v) ? v : 'all');
export const answerFormatOf = (details) => cleanAnswerFormat(details?.answer_format);

/** What a format lets a learner do. */
export const permits = (format) => {
  const f = cleanAnswerFormat(format);
  return { typed: f !== 'images', images: f !== 'text', documents: f === 'all' };
};

/** Why an upload of this kind (pdf | image | docx | text) isn't allowed, or null. */
export function fileRefusal(format, kind) {
  const p = permits(format);
  if (kind === 'image') return p.images ? null : 'This assignment takes typed answers only — no photos or files.';
  if (p.documents) return null;
  return p.images
    ? 'This assignment takes photos or drawings of your answers (JPG or PNG), not PDFs or documents.'
    : 'This assignment takes typed answers only — no photos or files.';
}

/** Why a typed answer isn't allowed, or null. */
export const typedRefusal = (format) => (permits(format).typed ? null
  : 'This assignment takes photo answers only — attach a photo (or draw it) instead of typing.');
