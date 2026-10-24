/**
 * modules/self-study/paperTemplate.js — THE paper template, kept on the
 * server so every assignment and every submission comes out the same.
 *
 * The look is the reference templates' own CSS, verbatim
 * (templates/assignment.css, templates/submission.css — from
 * reference/question-layout-for-activity/submission-crop); this module
 * fills the same markup from the structured data and nothing else styles
 * it. The apps show and print what it renders.
 *
 *   layoutPaper(paper)              every AI-made paper is laid out by the
 *                                   template's rules: Parts by question kind
 *                                   (Part A – Multiple Choice, Part B – Short
 *                                   Answers, … Case Study, Essay), each with
 *                                   its note, questions numbered through.
 *   renderAssignmentHtml(...)       the assignment paper and/or teacher copy
 *   renderSubmissionHtml(...)       a learner's submission (submissionDocument)
 *   paperOrg(...)                   the header line: "School, Town, Nigeria"
 *
 * Sheets: the page is written as one flow; a small script in it splits the
 * flow into A4 sheets the way the templates are cut — a part heading
 * continues as "(continued)", a case study stays with its first question,
 * and each sheet gets the template's footer (the page number; on a
 * submission "Name Class · Title · page N of M").
 */
import { readFileSync } from "node:fs";
import { answerSpaceFor } from "./paperSchema.js";

const css = (name) => readFileSync(new URL(`./templates/${name}`, import.meta.url), "utf8");
const TEMPLATE = Object.freeze({ assignment: css("assignment.css"), submission: css("submission.css") });
export const TEMPLATE_VERSION = "2026-10-17";

/* What the reference templates don't draw but the platform needs — kept to
   the template's own tokens and look. */
const EXTRA = `
/* The question number from the data: the template's list-item counter
   doesn't count grid rows (its own PDF shows 0., 1., 1., 4.). */
.q::before{content:attr(data-n) "."}
.figure{margin:2mm 0;text-align:center}
.figure img{max-width:100%;max-height:60mm}
.figure figcaption{font-size:9pt;font-style:italic;color:var(--muted)}
.figure-note{margin:2mm 0;padding:2mm 3mm;border:1px dashed var(--muted);font-size:9pt;color:var(--muted)}
.labels{margin-top:2mm;display:grid;gap:1.5mm}
.labels div{display:flex;gap:3mm;align-items:flex-end}
.labels div::after{content:"";flex:1;border-bottom:1px solid var(--hair)}
.lines--md{height:35mm}
.lines--lg{height:70mm}
.ar{margin:0 0 1mm}
.typed{margin:2mm 0 0;padding:2mm;border:1px solid var(--hair);white-space:pre-wrap}
.typed::before{content:"Typed answer";display:block;margin-bottom:1mm;font:8pt system-ui,sans-serif;color:var(--muted)}
.files{margin:2mm 0 0;font:8.5pt system-ui,sans-serif;color:var(--muted)}
.mark b[data-got]::before{content:attr(data-got);text-align:center;font-weight:700}
.mark em{display:block;margin-top:1mm;text-align:left;font-size:8pt;color:var(--muted)}
.key-line{margin-top:1.5mm;padding:1mm 2mm;border-left:2px solid #047857;font-size:9.5pt;color:#047857;break-inside:avoid}
.options .is-key{font-weight:700;text-decoration:underline}
.chip{display:inline-block;margin-left:2mm;padding:0 1.5mm;border-radius:3px;font:800 8pt system-ui,sans-serif;letter-spacing:.04em;vertical-align:1px}
.chip--new{background:#FDECC8;color:#B45309}
.chip--changed{background:#EDE5FF;color:#6C3BFF}
.q--new{background:#FFF8E6;box-shadow:0 0 0 2mm #FFF8E6}
.q--changed{background:#F4F0FF;box-shadow:0 0 0 2mm #F4F0FF}
.feedback p{margin:2mm 0 0;white-space:pre-wrap}
body.embed .toolbar{display:none}
body.embed{padding:1px 0}
body.single .sheet{min-height:0}
body.embed{min-height:0}
`;

const h = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/** Text the AI writes (Unicode maths, x^2, H_2O, line breaks) → safe HTML. */
const text = (v) => h(v)
  .replace(/\^(\d+|\([^)]{1,12}\))/g, (_, x) => `<sup>${x.replace(/^\(|\)$/g, "")}</sup>`)
  .replace(/([A-Za-z)])_(\d+)/g, "$1<sub>$2</sub>")
  .replace(/\n/g, "<br>");
const gap = (v) => text(v).replace(/_{3,}/g, '<span class="blank"></span>');
const LETTERS = "ABCDEFGHIJ";
const marksWord = (n) => `${n} mark${n === 1 ? "" : "s"}`;
const pointsOf = (q) => { const n = Number(q?.max_points ?? q?.points); return Number.isFinite(n) && n > 0 ? n : null; };
const range = (a, b) => (a === b ? `Question ${a}` : `Questions ${a}–${b}`);
const dayOf = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }) : "—"; };
const whenOf = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}`;
};

/* ── The layout rules every AI-made paper follows ──────────────────────── */

const FAMILY_ORDER = ["objective", "truefalse", "short", "label", "case", "essay"];
export function familyOf(q) {
  // A question the teacher put in a named part ("add a diagram question to Part A") goes with that part.
  if (q?._part && FAMILY_ORDER.includes(q._part)) return q._part;
  if (q?.format === "case_study") return "case";
  if (q?.format === "label") return "label";
  // True or false is a part of its own, as in the template (not with the MCQs).
  if (q?.format === "true_false") return "truefalse";
  if (Array.isArray(q?.options)) return "objective";
  if (/essay/i.test(q?.type || "")) return "essay";
  return "short";
}
function partTitle(fam, qs) {
  if (fam === "objective") return "Multiple Choice";
  if (fam === "truefalse") return "True or False";
  if (fam === "short") return qs.every((q) => answerSpaceFor(q) === "working") ? "Calculations" : "Short Answers";
  return { label: "Diagrams", case: "Case Study", essay: "Essay" }[fam];
}
function partNote(fam, qs, first) {
  const pts = qs.map(pointsOf);
  const same = pts.every((p) => p != null && p === pts[0]);
  const last = first + qs.length - 1;
  if (fam === "case") return `Read the case study, then answer ${range(first, last)}.`;
  if (fam === "label") return "Name each labelled part of the diagram. Marks are shown at the end of each question.";
  if (same && (fam === "objective" || fam === "truefalse")) return `Each question carries ${marksWord(pts[0])}.`;
  return "Marks are shown at the end of each question.";
}

/**
 * The template's Parts over a paper's questions: grouped by kind in the
 * template's order (questions keep their order within a part), numbered
 * through. A paper whose sections the teacher asked for keeps them.
 * → { paper, order } — order[newIndex] = the question's old index.
 */
export function layoutPaper(paper, { keepSections = false } = {}) {
  const qs = Array.isArray(paper?.questions) ? paper.questions : [];
  if (!qs.length || (keepSections && Array.isArray(paper.sections) && paper.sections.length)) {
    return { paper, order: qs.map((_, i) => i) };
  }
  const fams = FAMILY_ORDER.filter((f) => qs.some((q) => familyOf(q) === f));
  const order = [];
  const sections = [];
  const questions = [];
  fams.forEach((fam, s) => {
    const idx = qs.map((q, i) => [q, i]).filter(([q]) => familyOf(q) === fam);
    // A part's case studies in order of their questions, each question kept with its own.
    if (fam === "case") idx.sort((a, b) => (a[0].passage ?? 99) - (b[0].passage ?? 99) || a[1] - b[1]);
    const first = questions.length + 1;
    sections.push({ title: `Part ${LETTERS[s]} – ${partTitle(fam, idx.map(([q]) => q))}`, instructions: partNote(fam, idx.map(([q]) => q), first) });
    for (const [{ _part, ...q }, i] of idx) { order.push(i); questions.push({ ...q, section: s }); }
  });
  return { paper: { ...paper, questions, sections }, order };
}

/** The header line: "School Name, Town / City, Nigeria" (what's known of it). */
export function paperOrg(school, { fallback = null } = {}) {
  if (!school?.name) return fallback || null;
  const place = school.city || school.lga || school.state || null;
  return [school.name, place, "Nigeria"].filter(Boolean).join(", ");
}

/* ── The page script: one flow → A4 sheets, footers, height, live marks ── */

const PAGINATE = `
(function(){
  var MM = 96/25.4, PAGE = 297*MM, BOTTOM = 22*MM;
  function lim(s){ return s.getBoundingClientRect().top + window.scrollY + PAGE - BOTTOM; }
  function bottom(s){ var r = 0; Array.prototype.forEach.call(s.children, function(c){ if (c.classList.contains('sheet__footer')) return; var b = c.getBoundingClientRect(); r = Math.max(r, b.bottom + window.scrollY); }); return r; }
  function freshSheet(after){ var s = document.createElement('main'); s.className = after.className; s.setAttribute('data-sheet', after.getAttribute('data-sheet')||''); after.parentNode.insertBefore(s, after.nextSibling); return s; }
  function paginate(){
    if (document.body.classList.contains('single')) return;
    var sheets = Array.prototype.slice.call(document.querySelectorAll('main.sheet'));
    sheets.forEach(function(sheet){
      var cur = sheet, guard = 0;
      while (bottom(cur) > lim(cur) && guard++ < 60) {
        var next = freshSheet(cur);
        // Move items from the end of this sheet until it fits.
        var moved = false;
        while (bottom(cur) > lim(cur)) {
          var item = lastMovable(cur);
          if (!item) break;
          moveTo(item, next); moved = true;
        }
        if (!moved) { next.remove(); break; }
        cur = next;
      }
    });
  }
  // The last thing on a sheet that can go to the next one: a question (or
  // table row), or a whole block; a part heading or case study never ends a sheet.
  function lastMovable(sheet){
    var kids = Array.prototype.filter.call(sheet.children, function(c){ return !c.classList.contains('sheet__footer'); });
    if (kids.length <= 1 && !(kids[0] && (kids[0].matches('section.part') || kids[0].matches('table.key')))) return null;
    var last = kids[kids.length-1];
    if (!last) return null;
    if (last.matches('section.part')) {
      var lis = last.querySelectorAll('ol.questions > li');
      if (lis.length > 1) return { from: last, li: lis[lis.length-1] };
      return { block: last };
    }
    if (last.matches('table.key')) {
      var rows = last.querySelectorAll('tbody > tr');
      if (rows.length > 1) return { table: last, tr: rows[rows.length-1] };
      return kids.length > 1 ? { block: last } : null;
    }
    return { block: last };
  }
  function moveTo(item, next){
    var foot = next.querySelector('.sheet__footer');
    var first = next.firstChild;
    if (item.block) {
      // A whole part going onto a sheet that starts with its own continuation: one part again.
      var b = item.block;
      if (b.matches('section.part') && first && first.matches && first.matches('section.part') && first.getAttribute('data-part') === b.getAttribute('data-part')) {
        var ol0 = b.querySelector('ol.questions');
        Array.prototype.slice.call(first.querySelectorAll('aside.case')).forEach(function(c){ b.insertBefore(c, ol0); });
        Array.prototype.slice.call(first.querySelectorAll('ol.questions > li')).forEach(function(li){ ol0.appendChild(li); });
        first.remove(); first = next.firstChild;
      }
      next.insertBefore(b, first); return;
    }
    if (item.tr) {
      var t = first && first.matches && first.matches('table.key') ? first : null;
      if (!t) { t = item.table.cloneNode(false); t.appendChild(item.table.tHead.cloneNode(true)); t.appendChild(document.createElement('tbody')); if (item.table.tFoot) { t.appendChild(item.table.tFoot); } next.insertBefore(t, first); }
      t.tBodies[0].insertBefore(item.tr, t.tBodies[0].firstChild); return;
    }
    // A question: into this part's continuation on the next sheet.
    var part = item.from, cont = first && first.matches && first.matches('section.part') && first.getAttribute('data-part') === part.getAttribute('data-part') ? first : null;
    if (!cont) {
      cont = document.createElement('section'); cont.className = part.className; cont.setAttribute('data-part', part.getAttribute('data-part'));
      var head = part.querySelector('.part__head');
      if (head) { var hc = head.cloneNode(true); var note = hc.querySelector('.part__note'); if (note) note.remove(); var t2 = hc.querySelector('.part__title'); if (t2 && !/\\(continued\\)$/.test(t2.textContent)) t2.textContent += ' (continued)'; cont.appendChild(hc); }
      var ol = document.createElement('ol'); ol.className = 'questions'; ol.setAttribute('role', 'list'); cont.appendChild(ol);
      next.insertBefore(cont, first);
    }
    var olc = cont.querySelector('ol.questions');
    olc.insertBefore(item.li, olc.firstChild);
    olc.setAttribute('start', item.li.getAttribute('data-n'));
    // A case study whose questions all moved goes with them.
    var cases = part.querySelectorAll('aside.case');
    Array.prototype.forEach.call(cases, function(c){ var n = c.getAttribute('data-first'); if (n && Number(n) >= Number(item.li.getAttribute('data-n'))) cont.insertBefore(c, olc); });
  }
  // Every sheet ends with the template's footer: the page number (CSS
  // counter), after the submission's "Name Class · Title · page " label.
  function footers(){
    if (document.body.classList.contains('single')) return;
    var sheets = document.querySelectorAll('main.sheet'), label = document.body.getAttribute('data-footer');
    document.body.style.setProperty('--total', '"' + sheets.length + '"');
    Array.prototype.forEach.call(sheets, function(s){
      var f = s.querySelector(':scope > .sheet__footer');
      if (!f) { f = document.createElement('div'); f.className = 'sheet__footer'; }
      if (label != null) f.textContent = label;
      s.appendChild(f);
    });
  }
  // The content's own height (not the frame's), so the frame fits the sheets.
  function report(){ try { var r = document.body.getBoundingClientRect(); parent.postMessage({ type: 'akoro-paper-height', height: Math.ceil(r.bottom + window.scrollY + 12) }, '*'); } catch (e) {} }
  function run(){ paginate(); footers(); report(); }
  window.addEventListener('message', function(e){
    var d = e.data || {};
    if (d.type !== 'akoro-paper-marks') return;
    Object.keys(d.marks || {}).forEach(function(i){
      var m = d.marks[i] || {}, li = document.querySelector('li.q[data-index="' + i + '"]');
      if (!li) return;
      var b = li.querySelector('.mark b'); if (b) { if (m.awarded == null || m.awarded === '') b.removeAttribute('data-got'); else b.setAttribute('data-got', String(m.awarded)); }
      var em = li.querySelector('.mark em'); if (!em && m.comment) { em = document.createElement('em'); li.querySelector('.mark').appendChild(em); }
      if (em) em.textContent = m.comment || '';
    });
    report();
  });
  var imgs = Array.prototype.slice.call(document.images).filter(function(i){ return !i.complete; });
  if (!imgs.length) run(); else { var left = imgs.length; imgs.forEach(function(i){ i.addEventListener('load', done); i.addEventListener('error', done); }); function done(){ if (--left === 0) run(); } }
  window.addEventListener('resize', report);
})();`;

function page({ title, kind, body, embed, single = false, footer = null }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(title)}</title>
<style>
${TEMPLATE[kind]}
${EXTRA}
</style>
</head>
<body class="${[embed ? "embed" : "", single ? "single" : ""].join(" ").trim()}"${footer != null ? ` data-footer="${h(footer)}"` : ""}>
${embed ? "" : '<div class="toolbar"><button type="button" onclick="window.print()">Print / Save PDF</button></div>'}
${body}
<script>${PAGINATE}</script>
</body>
</html>`;
}

/* ── The assignment paper ──────────────────────────────────────────────── */

function figureHtml(q) {
  const f = q.figure;
  const src = f?.src || (f?.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.svg)}` : null);
  if (src) return `<figure class="figure"><img src="${h(src)}" alt="${h(f.alt || f.caption || "Figure")}">${f.caption ? `<figcaption>${h(f.caption)}</figcaption>` : ""}</figure>`;
  return q.figure_note ? `<div class="figure-note">Figure: ${h(q.figure_note)}</div>` : "";
}
function stemHtml(q, space) {
  if (q.format === "assertion_reason" && q.assertion) {
    return `<p class="q__stem"><span class="ar">Assertion: ${text(q.assertion)}</span><br>Reason: ${text(q.reason || "")}</p>`;
  }
  return `<p class="q__stem">${space === "blank" ? gap(q.q) : text(q.q)}</p>`;
}
function spaceHtml(q, space, showKey) {
  if (space === "options" || (space === "true_false" && showKey)) {
    return `<ol class="options" role="list">${q.options.map((o, i) => `<li${showKey && Number(q.correct) === i ? ' class="is-key"' : ""}>${text(o)}</li>`).join("")}</ol>`;
  }
  if (space === "true_false") return '<div class="tf"><span>True</span><span>False</span></div>';
  if (space === "labels") return `<div class="labels">${(q.labels || []).map((l) => `<div><b>${h(l)}</b></div>`).join("")}</div>`;
  if (space === "blank") return "";
  if (space === "working") {
    const size = (pointsOf(q) || 0) >= 3 ? " workspace--lg" : (pointsOf(q) || 0) <= 1 ? " workspace--sm" : "";
    return `<div class="workspace${size}">Working</div><p class="ans">Answer: <span class="blank"></span></p>`;
  }
  const size = /essay/i.test(q.type || "") ? " lines--lg" : /^(theory|structured)$/i.test(q.type || "") ? " lines--md" : "";
  return `<div class="lines${size}" aria-label="Answer lines"></div>`;
}
function keyLine(q) {
  if (q.marking) return q.marking;
  if (Array.isArray(q.options) && q.correct != null) return `${LETTERS[q.correct]} – ${q.options[q.correct] ?? ""}`;
  if (q.answer && typeof q.answer === "object") return Object.entries(q.answer).map(([k, v]) => `${k}: ${v}`).join("; ");
  return q.answer || "—";
}

/** The paper's parts, from its sections (or one part when it has none). */
function partsOf(details) {
  const qs = Array.isArray(details?.questions) ? details.questions : [];
  const sections = Array.isArray(details?.sections) ? details.sections : [];
  const parts = [];
  qs.forEach((q, i) => {
    const s = Number.isInteger(q?.section) && sections[q.section] ? q.section : null;
    const last = parts[parts.length - 1];
    if (last && last.s === s) last.items.push({ q, i }); else parts.push({ s, section: s != null ? sections[s] : null, items: [{ q, i }] });
  });
  return parts;
}

/**
 * The assignment as the template. `copy`: "student" (the paper), "teacher"
 * (the marking scheme) or "both". `showKey` marks answers on the paper
 * (the draft preview); `changes` marks a version's new / changed questions.
 */
export function renderAssignmentHtml({ assignment = {}, org = null, copy = "student", showKey = false, changes = null, versionLabel = "", embed = false }) {
  const details = assignment.details || {};
  const qs = Array.isArray(details.questions) ? details.questions : [];
  const passages = Array.isArray(details.passages) ? details.passages : [];
  const total = qs.reduce((s, q) => s + (pointsOf(q) || 0), 0);
  const parts = partsOf(details);
  const title = assignment.title || "Assignment";
  const sheets = [];
  if (copy !== "teacher") {
    const instr = [details.instructions || assignment.instructions || "Answer all questions."];
    if (qs.some((q) => answerSpaceFor(q) === "options")) instr.push("For multiple-choice questions, circle the letter of the correct option.");
    if (qs.some((q) => answerSpaceFor(q) === "true_false")) instr.push("For true or false questions, tick one box.");
    if (qs.some((q) => answerSpaceFor(q) === "working")) instr.push("Show your working in the space provided.");
    const named = parts.filter((p) => p.section);
    const head = `
  <header class="doc-head">
    ${org ? `<p class="doc-head__org">${h(org)}</p>` : ""}
    <h1 class="doc-head__title">${h(title)}</h1>
    ${named.length ? `<dl class="doc-head__parts">${named.map((p) => {
      const [label, ...rest] = String(p.section.title || "").split(/\s[–-]\s/);
      const a = p.items[0].i + 1, b = p.items[p.items.length - 1].i + 1;
      return `<dt>${h(label)}:</dt><dd>${h((rest.join(" – ") || label).toUpperCase())} (${h(range(a, b).toUpperCase())})</dd>`;
    }).join("")}</dl>` : ""}
  </header>
  <dl class="details">
    <div><dt>Subject</dt><dd>${h(assignment.subject || "—")}</dd></div>
    <div><dt>Topic</dt><dd>${h(assignment.topic || "—")}</dd></div>
    <div><dt>Date</dt><dd>${h(dayOf(assignment.created_at || assignment.date))}</dd></div>
    <div><dt>Due date</dt><dd>${h(dayOf(assignment.due_at))}</dd></div>
  </dl>
  <div class="student">
    <span class="field">Name:</span>
    <span class="field">Class:</span>
    <span class="field">Score${total ? ` (/${total})` : ""}:</span>
  </div>
  <aside class="instructions">
    <h2>Instructions</h2>
    <ul>${instr.map((l) => `<li>${h(l)}</li>`).join("")}</ul>
  </aside>`;
    const body = parts.map((p, pi) => {
      const objective = p.items.every(({ q }) => Array.isArray(q?.options));
      const sameMarks = objective && /^Each question carries/.test(p.section?.instructions || "");
      const seen = new Set();
      const items = p.items.map(({ q, i }) => {
        const obj = q && typeof q === "object" ? q : { q: String(q ?? "") };
        const space = answerSpaceFor(obj);
        const pts = pointsOf(obj);
        const change = changes?.[i];
        let caseHtml = "";
        if (Number.isInteger(obj.passage) && passages[obj.passage] && !seen.has(obj.passage)) {
          seen.add(obj.passage);
          const about = p.items.filter(({ q: x }) => x?.passage === obj.passage).map(({ i: k }) => k + 1);
          caseHtml = `<aside class="case" data-first="${i + 1}"><h3>${h(passages[obj.passage].title || "Read the passage")}</h3><p>${text(passages[obj.passage].text)}</p></aside>`;
          void about;
        }
        const li = `<li class="q${change ? ` q--${change}` : ""}" data-n="${i + 1}" data-index="${i}" data-type="${h(space)}" data-marks="${pts ?? ""}">
        ${stemHtml(obj, space).replace("</p>", `${change ? `<span class="chip chip--${change}">${change === "new" ? "NEW" : "CHANGED"}${versionLabel ? ` IN ${h(versionLabel)}` : ""}</span>` : ""}</p>`)}
        ${figureHtml(obj)}
        ${spaceHtml(obj, space, showKey)}
        ${showKey ? `<div class="key-line">Key: ${text(keyLine(obj))}</div>` : ""}
        ${pts && !sameMarks ? `<span class="q__marks">[${marksWord(pts)}]</span>` : ""}
      </li>`;
        return { caseHtml, li };
      });
      // Case studies print once, above the questions about them.
      const cases = items.map((x) => x.caseHtml).join("");
      return `
  <section class="part" data-part="${LETTERS[pi]}">
    ${p.section ? `<header class="part__head"><h2 class="part__title">${h(p.section.title)}</h2>${p.section.instructions ? `<p class="part__note">${h(p.section.instructions)}</p>` : ""}</header>` : ""}
    ${cases}
    <ol class="questions" role="list" start="${p.items[0].i + 1}">
      ${items.map((x) => x.li).join("\n")}
    </ol>
  </section>`;
    }).join("\n");
    sheets.push(`<main class="sheet" data-sheet="student">${head}${body}\n  <div class="sheet__footer"></div>\n</main>`);
  }
  if (copy !== "student") {
    sheets.push(`<main class="sheet" data-sheet="teacher">
  <header class="doc-head">
    <p class="doc-head__org">${h(org ? `${org} – Marking Scheme` : "Marking Scheme")}</p>
    <h1 class="doc-head__title">${h(title)}</h1>
    <p><span class="badge">TEACHER COPY</span></p>
  </header>
  <table class="key">
    <thead><tr><th>No.</th><th>Answer / working</th><th>Marks</th></tr></thead>
    <tbody>${qs.map((q, i) => `<tr><td>${i + 1}</td><td>${text(keyLine(q))}</td><td>${pointsOf(q) ?? "—"}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="2">Total</td><td>${total || "—"}</td></tr></tfoot>
  </table>
  <div class="sheet__footer"></div>
</main>`);
  }
  return page({ title: copy === "teacher" ? `${title} — marking scheme` : title, kind: "assignment", body: sheets.join("\n"), embed });
}

/* ── The submission ────────────────────────────────────────────────────── */

function submittedHtml(item, images) {
  const a = item.answer || {};
  const out = [];
  if (item.options) {
    out.push(`<ol class="options" role="list">${item.options.map((o) => `<li${o.selected ? ' class="is-selected"' : ""}>${text(o.text)}</li>`).join("")}</ol>`);
  }
  if (a.text) out.push(`<div class="typed">${text(a.text)}</div>`);
  for (const f of a.drawings || []) {
    const src = images?.get(f.id);
    out.push(`<figure class="drawing" data-file="${h(f.name)}">${src ? `<img src="${h(src)}" alt="Handwritten working for question ${item.number}">` : ""}</figure>`);
  }
  // Photos sit in the page like drawings; other files are named.
  const photos = (a.files || []).filter((f) => images?.get(f.id));
  for (const f of photos) out.push(`<figure class="drawing" data-file="${h(f.name)}"><img src="${h(images.get(f.id))}" alt="Photo for question ${item.number}"></figure>`);
  const others = (a.files || []).filter((f) => !images?.get(f.id));
  if (others.length) out.push(`<p class="files">Attached: ${others.map((f) => h(f.name)).join(", ")}</p>`);
  if (!a.text && !a.selected && !(a.drawings || []).length && !(a.files || []).length) out.push('<div class="noanswer">No answer submitted</div>');
  return out.join("\n");
}
function questionLi(item, images, marks) {
  const m = marks || item.marks || {};
  const got = m.awarded != null && m.awarded !== "" ? ` data-got="${h(m.awarded)}"` : "";
  return `<li class="q" data-n="${item.number}" data-index="${item.index}" data-type="${h(item.answerSpace)}" data-points="${item.points ?? ""}" data-status="${h(item.status)}"${item.answer?.selected ? ` data-selected="${h(item.answer.selected)}"` : ""}>
        <div class="q__body">
          <p class="q__stem">${item.format === "assertion_reason" && item.assertion ? `Assertion: ${text(item.assertion)}<br>Reason: ${text(item.reason || "")}` : item.answerSpace === "blank" ? gap(item.text) : text(item.text)}</p>
          ${submittedHtml(item, images)}
        </div>
        <div class="mark"><span>Marks</span><b${got}>/ ${item.points ?? "—"}</b>${m.comment ? `<em>${h(m.comment)}</em>` : ""}</div>
      </li>`;
}

/**
 * A learner's submission as the template. `doc` is submissionDocument();
 * `images` maps a drawing's file id → its data URL; `only` renders one
 * question (grading, one at a time); `marks` overrides the marks shown.
 */
export function renderSubmissionHtml({ doc, images = new Map(), only = null, marks = null, embed = false }) {
  const d = doc.details || {};
  const s = doc.summary || {};
  const total = doc.totalPoints;
  const who = [doc.learner?.name, doc.learner?.className].filter(Boolean).join(" ");
  const footer = `${[who, `${doc.header?.title || "Assignment"}`].filter(Boolean).join(" · ")} · page `;
  const markOf = (item) => (marks && marks[item.index] ? { awarded: marks[item.index].awarded, comment: marks[item.index].comment } : item.marks);
  const partHtml = (part, pi, items) => `
  <section class="part" data-part="${LETTERS[pi]}">
    ${part.title ? `<header class="part__head"><h2 class="part__title">${h(part.title)}</h2>${part.note ? `<p class="part__note">${h(part.note)}</p>` : ""}</header>` : ""}
    ${(part.passages || []).filter((p) => items.some((it) => it.passage === p.index)).map((p) => {
      const firstN = items.find((it) => it.passage === p.index)?.number;
      return `<aside class="case" data-first="${firstN}"><h3>${h(p.title || "Case study")} <small>${h(p.questions)}</small></h3><p>${text(p.text)}</p></aside>`;
    }).join("")}
    <ol class="questions" role="list" start="${items[0]?.number ?? 1}">
      ${items.map((it) => questionLi(it, images, markOf(it))).join("\n")}
    </ol>
  </section>`;

  if (only != null) {
    const pi = (doc.parts || []).findIndex((p) => (p.questions || []).some((q) => q.index === only));
    const part = doc.parts?.[pi];
    const item = part?.questions.find((q) => q.index === only);
    const body = item ? `<main class="sheet">${partHtml(part, pi, [item])}</main>` : "<main class=\"sheet\"></main>";
    return page({ title: doc.header?.title || "Submission", kind: "submission", body, embed: true, single: true });
  }

  const scoreTxt = doc.feedback?.score != null ? ` <b>${h(doc.feedback.score)}</b>` : "";
  const att = [s.attachments?.drawings ? `${s.attachments.drawings} drawing${s.attachments.drawings === 1 ? "" : "s"}` : "", s.attachments?.files ? `${s.attachments.files} file${s.attachments.files === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ") || "None";
  const body = `<main class="sheet">
  <header class="doc-head">
    ${doc.header?.org ? `<p class="doc-head__org">${h(doc.header.org)}</p>` : ""}
    <h1 class="doc-head__title">${h(doc.header?.title || "Assignment")}</h1>
    <p><span class="badge">${h(doc.header?.badge || "LEARNER SUBMISSION")}</span></p>
  </header>
  <dl class="details">
    <div><dt>Subject</dt><dd>${h(d.subject || "—")}</dd></div>
    <div><dt>Topic</dt><dd>${h(d.topic || "—")}</dd></div>
    <div><dt>Submitted</dt><dd>${h(whenOf(d.submittedAt))}${d.late ? " (late)" : ""}</dd></div>
    <div><dt>Due date</dt><dd>${h(d.dueAt ? whenOf(d.dueAt) : "—")}</dd></div>
  </dl>
  <div class="student">
    <span class="field">Name: <b>${h(doc.learner?.name || "")}</b></span>
    <span class="field">Class: <b>${h(doc.learner?.className || "")}</b></span>
    <span class="field">Username: <b>${h(doc.learner?.username ? `@${doc.learner.username}` : "")}</b></span>
    <span class="field">Score${total ? ` (/${total})` : ""}:${scoreTxt}</span>
  </div>
  <dl class="details details--3">
    <div><dt>Answered</dt><dd>${s.answered ?? 0} of ${s.total ?? 0} questions</dd></div>
    <div><dt>Unanswered</dt><dd>${(s.unanswered || []).length ? s.unanswered.map((n) => `Q${n}`).join(", ") : "None"}</dd></div>
    <div><dt>Attachments</dt><dd>${h(att)}</dd></div>
  </dl>
  <aside class="instructions">
    <h2>About this submission</h2>
    <ul>
      <li>The learner's answer and working appear directly under each question.</li>
      <li>Teachers record marks in the box beside each question.</li>
    </ul>
  </aside>
  ${doc.text ? `<div class="typed">${text(doc.text)}</div>` : ""}
  ${(doc.parts || []).map((part, pi) => partHtml(part, pi, part.questions || [])).join("\n")}
  ${(doc.files || []).length ? `<aside class="instructions"><h2>Other attachments</h2><ul>${doc.files.map((f) => `<li>${h(f.name)}</li>`).join("")}</ul></aside>` : ""}
  <section class="feedback">
    <h2>Teacher's feedback</h2>
    ${doc.feedback?.text ? `<p>${text(doc.feedback.text)}</p>` : '<div class="lines"></div>'}
    <div class="student">
      <span class="field">Total score${total ? ` (/${total})` : ""}:${scoreTxt}</span>
      <span class="field">Marked by:</span>
      <span class="field">Date:${doc.feedback?.gradedAt ? ` <b>${h(dayOf(doc.feedback.gradedAt))}</b>` : ""}</span>
    </div>
  </section>
  <div class="sheet__footer"></div>
</main>`;
  return page({ title: `${doc.header?.title || "Assignment"} — submission`, kind: "submission", body, embed, footer });
}
