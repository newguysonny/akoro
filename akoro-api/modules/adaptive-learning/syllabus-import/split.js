/**
 * syllabus-import/split.js — one PDF that holds many subjects' syllabi (the
 * combined BECE syllabus: 17 subjects in 329 pages) → one part per subject.
 * PURE.
 *
 * Each subject in such a compilation opens with the same front page —
 * "Chapter One · Aims & Objectives" — and carries its book list ("Chapter
 * Three · Recommended Textbooks") and FAQ after the syllabus itself. A part
 * runs from its "Chapter One" page to the page before its "Chapter Three"
 * (book lists and FAQs are not syllabus). The table of contents (dot leaders)
 * is not a start. The subject's name is the first known subject named in its
 * introduction; unknown → null (the import's front pass names it).
 */
const flat = (t) => String(t || "").replace(/\s+/g, " ");
const isToc = (t) => /\.{8,}/.test(t);
const START = /Chapter\s+One\s+Aims?\s*&\s*Objectives/i;
const BOOKS = /Chapter\s+Three\s+Recommended\s+Text\s*books/i;

/** Subjects compilations name (longest first, so "Basic Science and Technology" beats "Basic Science"). */
export const KNOWN_SUBJECTS = Object.freeze([
  ["Basic Science and Technology", /basic\s+science\s+and\s+technology/i],
  ["Cultural and Creative Arts", /cultural\s+and\s+creative\s+arts?/i],
  ["National Values Education", /national\s+values?\s+education/i],
  ["Christian Religious Studies", /christian\s+religious\s+(studies|knowledge)|\bCRS\b/i],
  ["Islamic Religious Studies", /islamic\s+(religious\s+)?studies|\bIRS\b/i],
  ["Pre-vocational Studies", /pre-?\s?vocational\s+studies|\bPVS\b/i],
  ["Business Studies", /business\s+studies/i],
  ["Social Studies", /social\s+studies/i],
  ["Civic Education", /civic\s+education/i],
  ["Physical and Health Education", /physical\s+and\s+health\s+education/i],
  ["English Studies", /english\s+(studies|language)/i],
  ["Mathematics", /\bmathematics\b/i],
  ["Basic Science", /\bbasic\s+science\b/i],
  ["Basic Technology", /\bbasic\s+technology\b/i],
  ["Computer Studies", /computer\s+(studies|science)/i],
  ["Agricultural Science", /agricultural\s+science/i],
  ["Home Economics", /home\s+economics/i],
  ["History", /\bhistory\b/i],
  ["French", /\bfrench\b/i],
  ["Arabic", /\barabic\b/i],
  ["Hausa", /\bhausa\b/i],
  ["Igbo", /\bigbo\b/i],
  ["Yoruba", /\byoruba\b/i],
  ["Edo", /\bedo\b/i],
  ["Efik", /\befik\b/i],
  ["Ibibio", /\bibibio\b/i],
]);

/** PURE: the subject an introduction names first (ties → the longer name). */
export function subjectNamed(text) {
  const t = flat(text);
  let best = null;
  for (const [name, re] of KNOWN_SUBJECTS) {
    const m = t.match(re);
    if (m && (!best || m.index < best.at || (m.index === best.at && name.length > best.name.length))) best = { name, at: m.index };
  }
  return best?.name || null;
}

/**
 * PURE: pages ([{ page, text }]) → [{ from, to, name }] when the PDF holds two
 * or more subjects; [] when it is one syllabus (import it whole).
 */
export function splitCombined(pages = []) {
  const starts = pages.filter((p) => START.test(flat(p.text)) && !isToc(p.text)).map((p) => p.page);
  if (starts.length < 2) return [];
  const last = pages.length ? pages[pages.length - 1].page : 0;
  return starts.map((from, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] - 1 : last;
    const books = pages.find((p) => p.page > from && p.page <= end && BOOKS.test(flat(p.text)) && !isToc(p.text));
    const intro = flat(pages.find((p) => p.page === from)?.text || "").replace(START, "").slice(0, 600);
    return { from, to: books ? books.page - 1 : end, name: subjectNamed(intro) };
  });
}
