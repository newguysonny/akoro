/**
 * modules/materials/folderMatch.js — which of the learner's folders an upload
 * goes into (Grand Plan §7.17, D51). Pure: no db.
 *
 *   canonicalSubject("SS2 Bio notes")  → "Biology"   (aliases, class labels ignored)
 *   subjectKey(subject)                 → the key subjects are compared by
 *   nameKind("Biology — Past papers")   → "past_paper" | … | null (a general folder)
 *   pickFolder({ subject, kind, folders, stats, defaults, atCap })
 *     → { folder } | { create } | { choices } | { none }
 *
 * The order (what the learner already has wins over a new folder):
 *   1. the folder they chose for this subject before (their default);
 *   2. their folders for the subject — by what's in them (uploads of that
 *      subject, whatever the folder is called) or by name ("Bio", "SS2
 *      Biology") — one kept for this kind of file first ("Biology past
 *      questions"), else a general one ("Bio"); two that fit equally → ask;
 *   3. a "Subject — Kind" folder made for it, only when nothing fits.
 * Past papers and notes go to separate folders only when the learner already
 * keeps them apart (or has no folder for the subject yet).
 */
import { folderNameFor } from "./ingestCore.js";

export const UNSORTED_FOLDER = "From chat — Unsorted";

/** Each subject and the short forms learners name folders with (longest match wins). */
export const SUBJECT_ALIASES = Object.freeze({
  "Biology": ["biology", "bio"],
  "Mathematics": ["mathematics", "maths", "math", "general mathematics", "gen maths"],
  "Further Mathematics": ["further mathematics", "further maths", "further math", "f maths", "fmaths"],
  "Chemistry": ["chemistry", "chem"],
  "Physics": ["physics", "phy", "phys"],
  "English": ["english", "english language", "eng", "use of english"],
  "Literature": ["literature", "literature in english", "lit"],
  "Economics": ["economics", "econs", "econ"],
  "Government": ["government", "govt", "gov"],
  "Geography": ["geography", "geog", "geo"],
  "Agricultural Science": ["agricultural science", "agric", "agriculture", "agric science", "agric sci"],
  "Civic Education": ["civic education", "civic", "civics"],
  "Commerce": ["commerce"],
  "Accounting": ["accounting", "accounts", "financial accounting"],
  "Basic Science": ["basic science", "basic sci"],
  "Basic Technology": ["basic technology", "basic tech"],
  "Computer Studies": ["computer studies", "computer science", "computer", "ict", "data processing"],
  "History": ["history"],
  "Social Studies": ["social studies"],
  "Christian Religious Studies": ["christian religious studies", "christian religious knowledge", "crs", "crk"],
  "Islamic Studies": ["islamic studies", "islamic religious studies", "irs", "irk"],
  "Home Economics": ["home economics", "home econs"],
  "Business Studies": ["business studies"],
  "Physical and Health Education": ["physical and health education", "physical education", "phe"],
  "Technical Drawing": ["technical drawing"],
  "Fine Art": ["fine art", "fine arts"],
  "French": ["french"],
  "Yoruba": ["yoruba"],
  "Igbo": ["igbo"],
  "Hausa": ["hausa"],
});

const norm = (s) => ` ${String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
const ALIASES = Object.entries(SUBJECT_ALIASES)
  .flatMap(([subject, names]) => names.map((a) => ({ subject, alias: ` ${a} ` })))
  .sort((a, b) => b.alias.length - a.alias.length);

/** The school subject a text names (a model's answer, a folder name), or null. */
export function canonicalSubject(text) {
  const t = norm(text);
  if (!t.trim()) return null;
  return ALIASES.find((a) => t.includes(a.alias))?.subject || null;
}

/** What subjects are compared by: the canonical name, else the text itself. */
export const subjectKey = (subject) => {
  const c = canonicalSubject(subject);
  return (c || String(subject || "").replace(/\s+/g, " ").trim()).toLowerCase() || null;
};

/** How a subject is shown and named: canonical where known ("bio" → "Biology"). */
export const subjectLabel = (subject) => canonicalSubject(subject) || String(subject || "").replace(/\s+/g, " ").trim().slice(0, 50) || null;

const KIND_WORDS = [
  ["past_paper", /\b(past\s*(papers?|questions?)|pq|exam\s*papers?|waec|neco|jamb|utme|bece|gce|wassce)\b/],
  ["notes", /\bnotes?\b/],
  ["textbook", /\b(text\s*books?)\b/],
  ["slides", /\bslides?\b/],
  ["syllabus", /\b(syllabus|scheme of work)\b/],
];
/** The kind of file a folder is kept for, by its name; null for a general folder ("Bio"). */
export function nameKind(name) {
  const t = norm(name);
  return KIND_WORDS.find(([, re]) => re.test(t))?.[0] || null;
}

/**
 * folders  [{ id, name }]                         the learner's folders
 * stats    [{ folder_id, subject, kind, count }]  their earlier uploads, per folder
 * defaults [{ subject_key, kind, folder_id }]     folders they picked before ("" kind = any)
 */
export function pickFolder({ subject, kind = "other", folders = [], stats = [], defaults = [], atCap = false }) {
  const byName = (name) => folders.find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (!subjectKey(subject)) {
    const u = byName(UNSORTED_FOLDER);
    return u ? { folder: u } : atCap ? { none: true } : { create: UNSORTED_FOLDER };
  }
  const key = subjectKey(subject);
  const ids = new Set(folders.map((f) => f.id));
  const d = defaults.find((x) => x.subject_key === key && x.kind === kind) || defaults.find((x) => x.subject_key === key && !x.kind);
  if (d && ids.has(d.folder_id)) return { folder: folders.find((f) => f.id === d.folder_id) };

  const count = (f) => stats.filter((s) => s.folder_id === f.id && subjectKey(s.subject) === key).reduce((n, s) => n + (Number(s.count) || 0), 0);
  const fits = folders
    .filter((f) => f.name !== UNSORTED_FOLDER)
    .map((f) => ({ ...f, count: count(f), kindOf: nameKind(f.name) }))
    .filter((f) => f.count > 0 || subjectKey(canonicalSubject(f.name)) === key);
  const exact = fits.filter((f) => f.kindOf === kind);
  const general = fits.filter((f) => !f.kindOf);
  const tier = (exact.length ? exact : general).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  if (tier.length === 1) return { folder: strip(tier[0]) };
  if (tier.length > 1) return { choices: tier.slice(0, 3).map((f) => ({ id: f.id, name: f.name, count: f.count })) };

  // Only folders kept for other kinds of file ("Biology — Notes" for a past paper): its own folder.
  const name = folderNameFor({ subject: subjectLabel(subject), kind });
  const same = byName(name);
  if (same) return { folder: same };
  if (atCap) {
    const closest = [...fits].sort((a, b) => b.count - a.count)[0];
    return closest ? { folder: strip(closest) } : { none: true };
  }
  return { create: name };
}
const strip = ({ id, name }) => ({ id, name });
