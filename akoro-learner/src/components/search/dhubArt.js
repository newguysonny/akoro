export const DHUB_ART = {
  notes:   { grad: 'linear-gradient(140deg,#7C5CE6,#5B3FD1)', icon: '📝' },
  courses: { grad: 'linear-gradient(140deg,#F28C52,#DE5F26)', icon: '📚' },
  pharmd:  { grad: 'linear-gradient(140deg,#14B8A6,#0C7E72)', icon: '💊' },
  guide:   { grad: 'linear-gradient(140deg,#4C8DF0,#2E62D9)', icon: '🧑🏽‍🏫' },
  live:    { grad: 'linear-gradient(140deg,#EF4E78,#C92A54)', icon: '📡' },
};

export const dhubTypes = (t) => ([
  {
    key: 'notes', soon: true, art: DHUB_ART.notes,
    label: t('dhub.card_notes'), desc: t('dhub.card_notes_desc'),
    kw: 'notes materials library records pdf document upload link paste content folder',
  },
  {
    key: 'courses', soon: false, primary: true, art: DHUB_ART.courses,
    label: t('dhub.card_courses'), desc: t('dhub.card_courses_desc'),
    kw: 'courses video lessons catalogue study curriculum marketplace',
  },
  {
    key: 'pharmd', soon: true, art: DHUB_ART.pharmd,
    label: t('dhub.card_pharmd'), desc: t('dhub.card_pharmd_desc'),
    kw: 'pharm d pharmacy doctor program clinical pharmacology',
  },
  {
    key: 'guide', soon: true, art: DHUB_ART.guide,
    label: t('dhub.card_guide'), desc: t('dhub.card_guide_desc'),
    kw: 'teaching guide teacher agents tutors trained',
  },
  {
    key: 'live', soon: true, art: DHUB_ART.live,
    label: t('dhub.card_live'), desc: t('dhub.card_live_desc'),
    kw: 'live classes real time tutors stream broadcast',
  },
]);