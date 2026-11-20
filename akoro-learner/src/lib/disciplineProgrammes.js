/**
 * disciplineProgrammes.js — the fixed programme cards for the Discover hub.
 *
 * Every higher-ed discipline gets one card, and every card is static: names,
 * subtitles and gradients are decided here, never fetched. The pharmacy
 * programme (PHARM.D) is the only one with a real catalogue today; the rest
 * open the same programme page and say "coming soon" until their materials
 * land. Adding a programme is a line in this file.
 */
const G = {
  blue:   'linear-gradient(140deg,#4C8DF0,#2E62D9)',
  violet: 'linear-gradient(140deg,#7C5CE6,#5B3FD1)',
  teal:   'linear-gradient(140deg,#14B8A6,#0C7E72)',
  orange: 'linear-gradient(140deg,#F28C52,#DE5F26)',
  rose:   'linear-gradient(140deg,#EF4E78,#C92A54)',
};

export const PHARMD_SLUG = 'pharmd';

export const DISCIPLINE_PROGRAMMES = {
  'Pharmacy and Pharmaceutical Sciences': {
    slug: PHARMD_SLUG, name: 'PHARM.D', icon: 'ti-pill', grad: G.teal,
    desc: 'Doctor of Pharmacy program materials', live: true,
  },
  'Medicine and Dentistry': {
    slug: 'medicine-dentistry', name: 'MEDICINE & DENTISTRY', icon: 'ti-first-aid-kit', grad: G.rose,
    desc: 'MBBS · BDS program materials',
  },
  'Allied Health Sciences': {
    slug: 'allied-health', name: 'ALLIED HEALTH', icon: 'ti-heartbeat', grad: G.blue,
    desc: 'Nursing, physiotherapy and lab science materials',
  },
  'Basic Medical Sciences': {
    slug: 'basic-medical', name: 'BASIC MEDICAL SCIENCES', icon: 'ti-vaccine', grad: G.violet,
    desc: 'Anatomy, physiology and biochemistry materials',
  },
  'Engineering and Technology': {
    slug: 'engineering', name: 'ENGINEERING STUDY', icon: 'ti-settings', grad: G.orange,
    desc: 'Bachelor of Engineering program materials',
  },
  Computing: {
    slug: 'computing', name: 'COMPUTING STUDY', icon: 'ti-cpu', grad: G.blue,
    desc: 'Computer science and IT program materials',
  },
  Sciences: {
    slug: 'sciences', name: 'SCIENCE STUDY', icon: 'ti-flask', grad: G.teal,
    desc: 'BSc physical and life science materials',
  },
  Law: {
    slug: 'law', name: 'LAW STUDY', icon: 'ti-gavel', grad: G.violet,
    desc: 'Bachelor of Laws program materials',
  },
  'Administration and Management': {
    slug: 'management', name: 'MANAGEMENT STUDY', icon: 'ti-briefcase', grad: G.orange,
    desc: 'Business and public administration materials',
  },
  Agriculture: {
    slug: 'agriculture', name: 'AGRICULTURE STUDY', icon: 'ti-plant', grad: G.teal,
    desc: 'Crop, animal and soil science materials',
  },
  Architecture: {
    slug: 'architecture', name: 'ARCHITECTURE STUDY', icon: 'ti-building', grad: G.blue,
    desc: 'Design, structures and studio materials',
  },
  Arts: {
    slug: 'arts', name: 'ARTS & HUMANITIES', icon: 'ti-book', grad: G.rose,
    desc: 'Languages, history and literature materials',
  },
  'Communication and Media Studies': {
    slug: 'media', name: 'MEDIA STUDY', icon: 'ti-camera', grad: G.orange,
    desc: 'Journalism, broadcasting and PR materials',
  },
  Education: {
    slug: 'education', name: 'EDUCATION STUDY', icon: 'ti-school', grad: G.violet,
    desc: 'Teaching, curriculum and policy materials',
  },
  'Environmental Sciences': {
    slug: 'environment', name: 'ENVIRONMENTAL STUDY', icon: 'ti-world', grad: G.teal,
    desc: 'Climate, ecology and conservation materials',
  },
  'Social Sciences': {
    slug: 'social-sciences', name: 'SOCIAL SCIENCES', icon: 'ti-users', grad: G.blue,
    desc: 'Economics, psychology and sociology materials',
  },
  'Veterinary Medicine': {
    slug: 'veterinary', name: 'VETERINARY STUDY', icon: 'ti-paw', grad: G.orange,
    desc: 'Animal health and clinical materials',
  },
};

/** The card for a learner's discipline, or null when none is set. */
export function programmeForDiscipline(discipline) {
  if (!discipline) return null;
  const hit = DISCIPLINE_PROGRAMMES[discipline];
  if (hit) return hit;
  // Tolerate hand-typed or legacy values ("pharmacy", "Computer Science").
  const key = Object.keys(DISCIPLINE_PROGRAMMES)
    .find((k) => k.toLowerCase().includes(String(discipline).toLowerCase()) || String(discipline).toLowerCase().includes(k.toLowerCase()));
  return key ? DISCIPLINE_PROGRAMMES[key] : null;
}

/** Every programme card, in the canonical discipline order. */
export const ALL_PROGRAMMES = Object.values(DISCIPLINE_PROGRAMMES);

export const programmeBySlug = (slug) =>
  ALL_PROGRAMMES.find((p) => p.slug === slug) || null;
