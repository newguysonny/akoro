/**
 * syllabus-import/structure.js — a syllabus's layout text → the syllabus
 * format the app reads (exam, name, code, aims, paper_structure, topics →
 * subtopics with content, objectives and notes).
 *
 * The whole document is never sent at once (that cut long syllabi off): the
 * pages go in chunks of about CHUNK_CHARS, each structured on its own with the
 * end of the previous chunk as context, then merged in page order — a topic
 * that runs across chunks is joined back together. The front matter (aims,
 * scheme of examination) is read in its own pass.
 *
 * Everything that decides — chunking, merging, the checks — is pure; the model
 * call is injected (`ask`) so the tests run without one.
 */

export const CHUNK_CHARS = 10_000;
const CONTEXT_CHARS = 700;
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const key = (s) => String(s ?? "").toLowerCase().replace(/^\s*\d{1,2}(\.\d+)*\s+(?=[a-z])/, "").replace(/^[\s\d.()a-z]{0,6}\s*[.):]\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

/** PURE: pages → chunks of whole pages, each ≤ CHUNK_CHARS (a single long page is split at line breaks). */
export function chunkPages(pages = [], max = CHUNK_CHARS) {
  const chunks = [];
  let cur = null;
  const push = () => { if (cur?.text.trim()) chunks.push(cur); cur = null; };
  for (const p of pages) {
    const parts = [];
    if (p.text.length <= max) parts.push(p.text);
    else {
      let buf = "";
      for (const line of p.text.split("\n")) {
        if (buf.length + line.length + 1 > max && buf) { parts.push(buf); buf = ""; }
        buf += (buf ? "\n" : "") + line;
      }
      if (buf) parts.push(buf);
    }
    for (const part of parts) {
      if (cur && cur.text.length + part.length + 1 > max) push();
      if (!cur) cur = { from: p.page, to: p.page, text: "" };
      cur.text += (cur.text ? "\n" : "") + part;
      cur.to = p.page;
    }
  }
  push();
  return chunks;
}

/**
 * PURE: the syllabus's outline, read deterministically from the layout text:
 * SECTION headings ("SECTION A" alone on a line) and lettered themes at the
 * left margin ("A.      Concept of Living   …notes column…"). Front matter like
 * "Section A : Will consist of…" is not a heading. → [{ page, kind, label, section }]
 */
export function outlineFromPages(pages = []) {
  const out = [];
  let section = null;
  for (const p of pages) {
    for (const line of p.text.split("\n")) {
      const sec = line.match(/^\s*SECTION\s+([A-Z]|[IVX]+)\b(?!\s*:)(.*)$/);
      if (sec && !/[a-z]{3,}\s*:/.test(line)) { section = `Section ${sec[1]}`; out.push({ page: p.page, kind: "section", label: section, section }); continue; }
      // "A.  Concept of Living" at the margin (WAEC), or "A: VARIETY OF ORGANISMS" / "C : ECOLOGY" — JAMB centres
      // its all-caps theme headings, so a heading alone on its line may sit anywhere.
      const th = line.match(/^(\s*)([A-Z])\s*[.:]\s+([A-Z][^\n]*?)(?:\s{3,}(.*))?$/);
      if (th) {
        const title = th[3].replace(/[:.]\s*$/, "").trim();
        const caps = title.replace(/[^A-Za-z]/g, "");
        const ok = caps.length >= 4 && (th[1].length <= 30 || (!th[4] && caps === caps.toUpperCase()));
        if (ok) out.push({ page: p.page, kind: "theme", label: `${th[2]}. ${title}`, section });
      }
    }
  }
  // No lettered themes (Cambridge IGCSE): the topics are the one consecutive "1 … N" list of numbered
  // headings on a single page (the syllabus overview — "1   Characteristics and classification…");
  // numbered objectives inside a topic don't form such a run. Each topic's place is where its title
  // reappears after that page (the subject content).
  if (out.filter((e) => e.kind === "theme").length < 2) {
    const numbered = (line) => { const m = line.match(/^\s{0,16}(\d{1,2})\s{2,}([A-Z][A-Za-z ,()'&/-]{3,90})$/); return m && !/\.{4,}/.test(line) ? { n: Number(m[1]), title: m[2].trim() } : null; };
    let best = { page: null, list: [] };
    for (const p of pages) {
      const run = [];
      for (const line of p.text.split("\n")) { const h = numbered(line); if (h && h.n === run.length + 1) run.push(h); }
      if (run.length > best.list.length) best = { page: p.page, list: run };
    }
    if (best.list.length >= 5) {
      const wanted = new Map(best.list.map((h) => [key(h.title), h]));
      const placed = new Set();
      for (const p of pages.filter((x) => x.page > best.page)) {
        for (const line of p.text.split("\n")) {
          const h = numbered(line);
          const k = h && key(h.title);
          if (h && wanted.has(k) && !placed.has(k) && wanted.get(k).n === h.n) { placed.add(k); out.push({ page: p.page, kind: "theme", label: `${h.n}. ${h.title}`, section: null }); }
        }
      }
    }
  }
  return out;
}

/** PURE: where the outline stands when a chunk starts (the last section/theme on earlier pages), and the themes inside it. */
export function outlineAt(outline, chunk) {
  const before = outline.filter((e) => e.page < chunk.from);
  const lastTheme = [...before].reverse().find((e) => e.kind === "theme") || null;
  const lastSection = [...before].reverse().find((e) => e.kind === "section") || null;
  return {
    section: lastSection?.label || lastTheme?.section || null,
    theme: lastTheme && (!lastSection || outline.indexOf(lastTheme) > outline.indexOf(lastSection)) ? lastTheme.label : null,
    inside: outline.filter((e) => e.page >= chunk.from && e.page <= chunk.to).map((e) => (e.kind === "section" ? `[${e.label}]` : e.label)),
  };
}

export const FRONT_SYSTEM = `You read the opening pages of an exam syllabus and return ONLY JSON:
{ "name": the subject, e.g. "Biology", "code": the subject code if printed or null,
  "aims": the aims/objectives of the syllabus as one paragraph (keep the numbered points, joined with "; "),
  "paper_structure": { "papers": [ { "name": "Paper 1", "type": "Objective" | "Essay / Theory" | "Practical" | short label, "questions": number or null, "marks": number or null, "duration_min": number or null, "notes": short text or null } ] },
  "sections": [ { "name": "Section A", "for": who it is for, e.g. "all candidates", "candidates in Nigeria" } ] }
Copy what the document says; do not invent. Unknown → null.`;

export const CHUNK_SYSTEM = `You convert part of an exam syllabus into JSON. The text keeps the page layout: a table row reads across, so the left column (CONTENTS / TOPICS) and the right column (NOTES / OBJECTIVES / "Candidates should be able to") of the same row are on the same lines.
Return ONLY JSON:
{ "topics": [ { "title": string, "section": section label if one applies (e.g. "Section A") or null, "continues": true when this topic started before this part,
    "subtopics": [ { "title": string, "content": the (a),(b),(i)… points, faithfully, as one text with "; " between points,
                     "objectives": [ short strings, only if the syllabus lists objectives ],
                     "notes": the NOTES column for this row, faithfully, or null } ] } ] }
Rules:
- A main heading (e.g. "A. BASIC CONCEPTS", "SECTION I: …", "THEME 1 …") is a topic; each numbered item under it (1., 2., …) is a subtopic; its lettered/roman points are its content.
- When the outline is given, its headings (lettered like "A." or numbered like "3   Movement into and out of cells") are the ONLY topics in this part: a numbered item (e.g. "8. Transport System") is always a subtopic of the heading above it, never a topic. A "SECTION A/B/C" line is not a topic — put it in "section" of the topics under it.
- If the part begins in the middle of a topic, start with that topic's title (given as context) and "continues": true.
- Keep every item and every note. Do not summarise, merge different items, or invent. Fix only broken spacing.
- Front matter (preamble, aims, scheme of examination), lists of recommended books, assessment details, practical-skills/assessment-objective tables, grade descriptions, glossaries of command words and administrative notes are NOT topics — skip them (return {"topics": []} for a part that has none).`;

function parseJson(text) {
  let s = String(text || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) s = fence[1].trim();
  return JSON.parse(s);
}

/** PURE: one chunk's answer → clean topics. */
export function cleanTopics(out) {
  return (Array.isArray(out?.topics) ? out.topics : []).map((t) => ({
    title: clip(t?.title, 200), section: clip(t?.section, 80) || null, continues: t?.continues === true,
    subtopics: (Array.isArray(t?.subtopics) ? t.subtopics : []).map((s) => ({
      title: clip(s?.title, 300),
      content: clip(s?.content, 4000) || null,
      objectives: (Array.isArray(s?.objectives) ? s.objectives : []).map((o) => clip(o, 400)).filter(Boolean),
      notes: clip(s?.notes, 2000) || null,
    })).filter((s) => s.title),
  })).filter((t) => t.title || t.subtopics.length);
}

/** PURE: merge the chunks' topics in page order; a continued (or same-titled) topic joins the one before it. */
export function mergeTopics(perChunk = []) {
  const topics = [];
  for (const list of perChunk) {
    for (const t of list) {
      const last = topics[topics.length - 1];
      if (last && (t.continues || (t.title && key(t.title) === key(last.title)) || !t.title)) {
        for (const s of t.subtopics) {
          const prev = last.subtopics[last.subtopics.length - 1];
          // A subtopic cut in half by the chunk border comes back under the same title.
          if (prev && key(prev.title) === key(s.title)) {
            prev.content = [prev.content, s.content].filter(Boolean).join("; ") || null;
            prev.objectives = [...prev.objectives, ...s.objectives];
            prev.notes = [prev.notes, s.notes].filter(Boolean).join(" ") || null;
          } else last.subtopics.push(s);
        }
        continue;
      }
      topics.push({ title: t.title, section: t.section, subtopics: [...t.subtopics] });
    }
  }
  return topics;
}

const lettered = (title) => /^\s*[A-Z]\s*[.:]\s+\S/.test(String(title || ""));

/**
 * PURE: hold the merged topics to the outline. A topic that is really a
 * numbered item ("8. Transport System"), or an unlettered heading the outline
 * doesn't know, folds into the topic before it as a subtopic; a "SECTION …"
 * pseudo-topic is dropped (its lettered entries become topics). Each topic gets
 * the section its heading sits in, in order (Section C repeats Section A's
 * themes, so matching walks forward through the outline).
 */
export function fitOutline(topics = [], outline = []) {
  const themes = outline.filter((e) => e.kind === "theme");
  if (themes.length < 2) return topics;
  const known = new Set(themes.map((t) => key(t.label)));
  const out = [];
  const asSubtopic = (t) => ({ title: t.title, content: t.subtopics.map((s) => [s.title, s.content].filter(Boolean).join(": ")).join("; ") || null, objectives: t.subtopics.flatMap((s) => s.objectives), notes: t.subtopics.map((s) => s.notes).filter(Boolean).join(" ") || null });
  const queue = [...topics];
  while (queue.length) {
    const t = queue.shift();
    if (/^\s*section\b/i.test(t.title)) {
      // Its lettered subtopics are the section's first topics; the rest belong under the last one.
      const fresh = [];
      for (const s of t.subtopics) {
        if (lettered(s.title)) fresh.push({ title: s.title, section: t.section, continues: false, subtopics: [] });
        else if (fresh.length) fresh[fresh.length - 1].subtopics.push(s);
        else if (out.length) out[out.length - 1].subtopics.push(s);
      }
      queue.unshift(...fresh);
      continue;
    }
    const isTheme = lettered(t.title) || known.has(key(t.title));
    if (!isTheme && out.length) { out[out.length - 1].subtopics.push(asSubtopic(t)); continue; }
    out.push({ ...t });
  }
  // Sections in order: walk forward through the outline's themes.
  let cursor = 0;
  let section = out[0]?.section || null;
  for (const t of out) {
    const k = key(t.title);
    const at = themes.findIndex((e, i) => i >= cursor && key(e.label) === k);
    if (at >= 0) { cursor = at + 1; section = themes[at].section || section; }
    t.section = section || t.section || null;
  }
  return out;
}

/** PURE: what a reviewer should look at. */
export function checkImport({ topics = [], pages = [], failed = [] }) {
  const subtopics = topics.flatMap((t) => t.subtopics);
  const warnings = [];
  for (const c of failed) warnings.push({ kind: "chunk_failed", text: `Pages ${c.from}–${c.to} could not be read — check them by hand.` });
  for (const t of topics) if (!t.subtopics.length) warnings.push({ kind: "empty_topic", text: `“${t.title}” has no subtopics.` });
  const seen = new Map();
  const tk = (t) => `${t.section || ""}|${key(t.title)}`;
  for (const t of topics) seen.set(tk(t), (seen.get(tk(t)) || 0) + 1);
  for (const [k, n] of seen) if (n > 1 && k.split("|")[1]) warnings.push({ kind: "duplicate_topic", text: `A topic appears ${n} times in the same section: “${topics.find((t) => tk(t) === k).title}”.` });
  const bare = subtopics.filter((s) => !s.content && !s.objectives.length && !s.notes).length;
  if (bare) warnings.push({ kind: "bare_subtopics", text: `${bare} subtopic(s) have a title only.` });
  // Numbered items in the source vs subtopics found: a rough coverage signal.
  const numbered = pages.reduce((n, p) => n + (p.text.match(/^\s{0,40}\d{1,2}\s?\.\s+[A-Z(]/gm) || []).length, 0);
  return {
    stats: {
      pages: pages.length, chars: pages.reduce((n, p) => n + p.text.length, 0),
      topics: topics.length, subtopics: subtopics.length,
      objectives: subtopics.reduce((n, s) => n + s.objectives.length, 0),
      withNotes: subtopics.filter((s) => s.notes).length,
      numberedInSource: numbered,
    },
    warnings,
  };
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/**
 * Structure a syllabus. ask({ system, user, maxTokens }) → model text.
 * hint: { exam, name, code } from the uploader. → { doc, stats, warnings }
 */
export async function structureSyllabus({ pages, hint = {}, ask, concurrency = 3, onProgress = () => {} }) {
  const front = pages.slice(0, 4).map((p) => p.text).join("\n").slice(0, 12_000);
  const outline = outlineFromPages(pages);
  // Parts that end before the first heading are front matter (the front pass reads it): not structured.
  const firstTheme = outline.find((e) => e.kind === "theme")?.page;
  const chunks = chunkPages(pages).filter((c) => !(outline.length >= 2 && firstTheme && c.to < firstTheme));
  let meta = {};
  try { meta = parseJson(await ask({ system: FRONT_SYSTEM, user: `${hint.exam ? `Exam: ${hint.exam}. ` : ""}${hint.name ? `Subject: ${hint.name}. ` : ""}\n\n${front}`, maxTokens: 1500 })); }
  catch { meta = {}; }
  let done = 0;
  const failed = [];
  const perChunk = await pool(chunks, concurrency, async (c, i) => {
    const before = i ? chunks[i - 1].text.slice(-CONTEXT_CHARS) : "";
    const at = outline.length >= 2 ? outlineAt(outline, c) : null;
    const user = `${hint.exam ? `Exam: ${hint.exam}. ` : ""}Subject: ${hint.name || meta.name || "unknown"}. Pages ${c.from}–${c.to}.`
      + (at ? `\nOutline — this part starts in ${at.section || "the syllabus"}${at.theme ? `, inside the heading "${at.theme}" (if the part begins mid-heading, output it first with "continues": true)` : ""}.`
        + (at.inside.length ? ` Headings that begin in this part, in order: ${at.inside.join(" · ")}.` : " No new heading begins in this part.") : "")
      + (before ? `\n\nThe previous part ended with (context only, do not output it):\n"""${before}"""` : "")
      + `\n\nConvert this part:\n"""${c.text}"""`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const topics = cleanTopics(parseJson(await ask({ system: CHUNK_SYSTEM, user, maxTokens: 8000 })));
        onProgress({ done: ++done, of: chunks.length });
        return topics;
      } catch { /* one retry */ }
    }
    failed.push(c);
    onProgress({ done: ++done, of: chunks.length });
    return [];
  });
  const topics = fitOutline(mergeTopics(perChunk), outline);
  const doc = {
    exam: hint.exam || "WASSCE",
    name: hint.name || clip(meta.name, 120) || "Untitled",
    code: hint.code || clip(meta.code, 40) || null,
    aims: clip(meta.aims, 4000) || null,
    paper_structure: meta.paper_structure && typeof meta.paper_structure === "object" ? meta.paper_structure : null,
    sections: Array.isArray(meta.sections) ? meta.sections.slice(0, 10) : [],
    topics,
  };
  return { doc, ...checkImport({ topics, pages, failed }) };
}

/** PURE: the reviewed draft → what ingestSubject takes (notes ride in the content; section in the topic title when there are several). */
export function toIngestDoc(doc, source) {
  const sections = new Set(doc.topics.map((t) => t.section).filter(Boolean));
  return {
    exam: doc.exam, name: doc.name, code: doc.code, aims: doc.aims, paper_structure: doc.paper_structure, source,
    topics: doc.topics.map((t) => ({
      title: sections.size > 1 && t.section ? `${t.title} (${t.section})` : t.title,
      subtopics: t.subtopics.map((s) => ({
        title: s.title,
        content: [s.content, s.notes ? `Notes: ${s.notes}` : null].filter(Boolean).join("\n") || null,
        objectives: s.objectives.length ? s.objectives : null,
      })),
    })),
  };
}
