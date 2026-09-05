/**
 * dhubTypes.js
 * ─────────────────────────────────────────────────────────────
 * Shared definitions for the Discover hub (higher-ed): the five
 * discovery-type cards, their gradient/keyword metadata, the query
 * matcher, and the hub font. Extracted from DiscoverHub.jsx so the
 * hub grid AND the full-screen search page (DiscoverSearchPage.jsx)
 * read from one source without importing each other.
 */
import { BRAND, RED, GREEN, GOLD } from '../../constants.js';

export const FONT = "'Nunito', sans-serif";

/* Gradient + art per type card. Order matches the product spec:
   Notes/Materials, Courses, Pharm D, Teaching guide, Live classes. */
export const TYPES = (t) => ([
  {
    key: 'notes', icon: '📝', accent: GOLD, soon: true,
    grad: 'linear-gradient(140deg,#7C5CE6,#5B3FD1)',
    label: t('dhub.card_notes'), desc: t('dhub.card_notes_desc'),
    kw: 'notes materials library records pdf document upload link paste',
  },
  {
    key: 'courses', icon: '📚', accent: BRAND, soon: false, primary: true,
    grad: 'linear-gradient(140deg,#F28C52,#DE5F26)',
    label: t('dhub.card_courses'), desc: t('dhub.card_courses_desc'),
    kw: 'courses video lessons catalogue study curriculum marketplace',
  },
  {
    key: 'pharmd', icon: '💊', accent: GREEN, soon: true,
    grad: 'linear-gradient(140deg,#14B8A6,#0C7E72)',
    label: t('dhub.card_pharmd'), desc: t('dhub.card_pharmd_desc'),
    kw: 'pharm d pharmacy doctor program clinical pharmacology',
  },
  {
    key: 'guide', icon: '🧑🏽‍🏫', accent: '#8B5CF6', soon: true,
    grad: 'linear-gradient(140deg,#4C8DF0,#2E62D9)',
    label: t('dhub.card_guide'), desc: t('dhub.card_guide_desc'),
    kw: 'teaching guide teacher agents tutors trained',
  },
  {
    key: 'live', icon: '📡', accent: RED, soon: true,
    grad: 'linear-gradient(140deg,#EF4E78,#C92A54)',
    label: t('dhub.card_live'), desc: t('dhub.card_live_desc'),
    kw: 'live classes real time tutors stream broadcast',
  },
]);

/* Type cards matching a query (label + description + keywords).
   Blank query → all cards, in spec order. */
export const matchTypes = (t, query) => {
  const q = (query || '').trim().toLowerCase();
  return !q ? TYPES(t) : TYPES(t).filter((ty) =>
    `${ty.label} ${ty.desc} ${ty.kw}`.toLowerCase().includes(q));
};
