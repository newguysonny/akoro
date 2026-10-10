/*
 * openSubmittedFile — a file a learner handed in: PDFs, photos and text open
 * in a tab; a Word document (or anything a browser can't show) downloads
 * with its own name, so the teacher opens it in Word.
 */
import { openActivityFile, downloadActivityFile } from '../../services/api.js';

export const canShowInTab = (f) => /\.(pdf|png|jpe?g|txt)$/i.test(f?.name || '') || ['pdf', 'image', 'text'].includes(f?.kind);

export const openSubmittedFile = (f) => (canShowInTab(f) ? openActivityFile(f.id) : downloadActivityFile(f.id, f.name)).catch(() => {});
