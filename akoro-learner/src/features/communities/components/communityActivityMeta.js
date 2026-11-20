/* Community activity vocabulary and helpers — shared by the community home
   page, its activity row and the New activity sheet (the Phase 19 step 6
   split of CommunityActivityPage). */

export function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}

export function timeAgo(iso) {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* Activity types — the SAME five the instructor workbench drafts
   (ActivitiesPage). Community activities carry their type and, for
   multi_stage journeys, their ordered stages. Icons, not emoji — the
   reference's rule ("replaces emoji throughout"). */
export const ACTIVITY_TYPES = [
  { key: 'assignment',  icon: 'ti-clipboard', name: 'Assignment' },
  { key: 'project',     icon: 'ti-folder',    name: 'Project' },
  { key: 'multi_stage', icon: 'ti-puzzle',    name: 'Multi stage' },
  { key: 'self_study',  icon: 'ti-book',      name: 'Self study' },
  { key: 'live_course', icon: 'ti-video',     name: 'Live course' },
];
export const typeMeta = (t) => ACTIVITY_TYPES.find((x) => x.key === t) || ACTIVITY_TYPES[0];
export const STAGE_KINDS = [
  { key: 'self_study',  icon: 'ti-book',      emoji: '📖', name: 'Self study' },
  { key: 'assignment',  icon: 'ti-clipboard', emoji: '📋', name: 'Assignment' },
  { key: 'project',     icon: 'ti-folder',    emoji: '🗂️', name: 'Project' },
];
export const stageKindName = (k) => (STAGE_KINDS.find((x) => x.key === k) || STAGE_KINDS[0]).name;

/* kind → line icon, for the shared-materials rail (the same vocabulary as
   the library's folder items). */
export const KIND_ICONS = {
  pdf: 'ti-file-text', audio: 'ti-headphones', video: 'ti-video', image: 'ti-photo',
  text: 'ti-file-text', link: 'ti-link', paste: 'ti-clipboard', blog: 'ti-news',
  course: 'ti-school', topic: 'ti-book',
};

/* The reference's tab rail: All + the five types, each with its per-tab
   empty-state copy. */
export const TABS = [
  { key: 'all',         icon: null,            name: 'All',         emptyTitle: 'No activities yet',          emptySub: 'Post the first one with "New activity".' },
  { key: 'assignment',  icon: 'ti-clipboard',  name: 'Assignment',  emptyTitle: 'No assignments yet' },
  { key: 'project',     icon: 'ti-folder',     name: 'Project',     emptyTitle: 'No projects yet' },
  { key: 'multi_stage', icon: 'ti-puzzle',     name: 'Multi stage', emptyTitle: 'No multi-step activities yet' },
  { key: 'self_study',  icon: 'ti-book',       name: 'Self study',  emptyTitle: 'No self-study activities yet' },
  { key: 'live_course', icon: 'ti-video',      name: 'Live course', emptyTitle: 'No live courses yet' },
];

export function dueInfo(dueAt) {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  const text = d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return { text, overdue: d.getTime() < Date.now() };
}

/* The reference's field style, shared by the sheet. */
export const FIELD = {
  width: '100%', boxSizing: 'border-box', borderRadius: 'var(--r-md)', padding: '12px 14px',
  border: '1.5px solid var(--ak-border2)', background: 'var(--ak-surface)', color: 'var(--ak-text)',
  fontFamily: "'Nunito',sans-serif", fontSize: 14, outline: 'none',
};

/* The error state tells the truth about WHY nothing arrived. "Your
   connection" is one cause of four — a learner on a perfectly good
   connection was told to blame their network while a server-side stall
   was the real culprit. Kinds:
     slow    the request was dropped after waiting too long (our client
             deadline, or the server's own 504 — which names the query
             step it gave up waiting on)
     setup   the server answered 503: communities are still being set up
     server  any other server-side answer — the API writes user-facing
             copy, so its message is shown
     network the request never arrived at all (offline / dropped) */
export const ERROR_STATES = {
  slow: {
    icon: 'ti-hourglass', title: 'This community is taking too long to load',
    body: "The request waited too long and was dropped - that's on our side, not your connection.",
  },
  setup: {
    icon: 'ti-settings', title: 'Communities are still being set up',
    body: 'The server is finishing a setup step. Please try again in a minute.',
  },
  server: {
    icon: 'ti-server', title: 'Something went wrong on our side',
    body: 'Please try again in a moment.',
  },
  network: {
    icon: 'ti-wifi-off', title: "Couldn't reach this community",
    body: 'Your connection seems slow or offline - the request never arrived.',
  },
};

export function classifyError(e) {
  if (e?.status === 404 || e?.status === 403) return { kind: 'missing' };
  if (e?.timedOut || e?.status === 504) return { kind: 'slow', step: e?.step, timeoutMs: e?.timeoutMs };
  if (e?.status === 503) return { kind: 'setup' };
  if (e?.status) return { kind: 'server', message: e?.message };
  return { kind: 'network' };
}
