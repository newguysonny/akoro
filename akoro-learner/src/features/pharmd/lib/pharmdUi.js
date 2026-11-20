/**
 * pharmdUi.js — presentation constants and helpers shared by the
 * PHARM.D programme screen and its views.
 */

/* The reference's done-green — a content colour, theme-independent. */
export const GREEN = '#2BB673';

/* Sheet menus (reference sheetActionsFor). */
export const SHEET_ACTIONS = {
  topic: [
    ['ti-robot', 'Agent session'], ['ti-share', 'Share'], ['ti-folder-plus', 'Add to folder'], ['ti-users', 'Add to community'], ['ti-download', 'Download'],
    ['ti-check', 'Mark as complete'], ['ti-book-2', 'Go to course'],
  ],
  course: [
    ['ti-share', 'Share'], ['ti-bookmark-plus', 'Add to Library'], ['ti-download', 'Download all topics'],
    ['ti-user', 'Go to creator'], ['ti-school', 'Go to program'],
  ],
};

/* One line under a topic: honest about what the data has. */
export const topicMeta = (t) => [
  t.read_minutes ? `${t.read_minutes} min read` : 'PDF',
  t.size ? `${(t.size / 1024 / 1024).toFixed(1)} MB` : null,
].filter(Boolean).join(' · ');
