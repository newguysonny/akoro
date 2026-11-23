/* Pure reader model: tool/form definitions, page building, derived tool
   content, reader CSS and the tab/result label helpers. No React. */
import { escapeHtml, textToParagraphBlocks, paginateBlocks } from '../../../lib/readerPages.js';

export const TOOL_DEFS = [
  // Ask is listed only when the opener passes `ask` (a library record):
  // answers from the whole document, with citations that jump.
  { id: "ask",        label: "Ask",        icon: "ti-message-question", bg: "rgba(14,165,233,.16)", fg: "var(--ak-accent)", needsAsk: true },
  { id: "podcast",    label: "Podcast",    icon: "ti-headphones",    bg: "rgba(139,92,246,.16)", fg: "var(--ak-accent)" },
  { id: "video",      label: "Video",      icon: "ti-video",         bg: "rgba(99,102,241,.16)", fg: "var(--ak-accent)" },
  { id: "summary",    label: "Summary",    icon: "ti-align-left",    bg: "rgba(108,59,255,.16)", fg: "var(--ak-accent)" },
  { id: "quiz",       label: "Quiz",       icon: "ti-circle-check",  bg: "rgba(239,68,68,.14)",  fg: "var(--ak-danger-text)" },
  { id: "flashcards", label: "Flashcards", icon: "ti-stack",         bg: "rgba(245,158,11,.14)", fg: "var(--ak-warn-text)" },
  { id: "notes",      label: "Notes",      icon: "ti-pencil",        bg: "rgba(16,185,129,.14)", fg: "var(--ak-success-text)" },
  { id: "qa",         label: "Q&A",        icon: "ti-help",          bg: "rgba(14,165,233,.14)", fg: "var(--ak-accent)", community: true },
  { id: "discussion", label: "Discussion", icon: "ti-messages",      bg: "rgba(217,70,239,.14)", fg: "var(--ak-accent)", community: true },
];
export const toolById = (id) => TOOL_DEFS.find((t) => t.id === id);
/* Tools the opener can generate for real (the `tools` prop) — the rest stay
   derived in the browser. They gain a scope choice. */
export const SERVER_TOOLS = new Set(["summary", "quiz", "flashcards"]);
/* Made by the server after the request (the reader polls the saved item). */
export const isServerPodcast = (tools, id) => id === "podcast" && !!tools?.podcast;
export const SCOPE_FIELD = { id: "scope", label: "From", type: "select", options: ["This page", "Whole document", "Selected pages"] };

/* Selected page text → a short, human focus line. A selection can come from
   the OCR/text layer, where it carries markdown headings ("# 5 The
   chloroplast## Part I …") or layout tokens (<|ref|>…); the quiz sheet should
   not show that markup as the learner's focus. */
export function cleanFocusText(value) {
  return String(value || "")
    .replace(/<\|[^>]*\|>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_`>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export const FORM_DEFS = {
  podcast: {
    title: "Podcast", sub: "Turn this page into a short audio episode",
    fields: [
      { id: "focus", label: "Prompt (optional)", type: "text", placeholder: "e.g. the key argument" },
      { id: "length", label: "Length", type: "select", options: ["Short · 2–3 min", "Medium · 5–6 min", "Long · 8–10 min"] },
    ],
  },
  video: {
    title: "Video", sub: "Generate an illustrated walkthrough",
    fields: [
      { id: "focus", label: "Prompt (optional)", type: "text", placeholder: "e.g. the worked example" },
      { id: "style", label: "Style", type: "select", options: ["Whiteboard", "Animated", "Narrated slides"] },
    ],
  },
  summary: {
    title: "Summary", sub: "A quick digest of this page",
    fields: [
      { id: "focus", label: "Prompt (optional)", type: "text", placeholder: "e.g. only the definitions" },
      { id: "depth", label: "Depth", type: "select", options: ["Brief", "Detailed"] },
    ],
  },
  quiz: {
    title: "Quiz", sub: "Test yourself on this page",
    fields: [
      { id: "focus", label: "Prompt (optional)", type: "text", placeholder: "e.g. the definitions" },
      { id: "count", label: "Questions", type: "number", min: 1, max: 50, default: "5", placeholder: "e.g. 8" },
      { id: "difficulty", label: "Difficulty", type: "select", options: ["Easy", "Medium", "Hard"] },
    ],
  },
  flashcards: {
    title: "Flashcards", sub: "Key terms from this page",
    fields: [
      { id: "focus", label: "Prompt (optional)", type: "text", placeholder: "e.g. the vocabulary" },
      { id: "count", label: "Number of cards", type: "number", min: 1, max: 50, default: "6", placeholder: "e.g. 10" },
    ],
  },
  notes: {
    title: "Notes", sub: "Start a note for this page",
    fields: [{ id: "focus", label: "Prompt (optional)", type: "text", placeholder: "What do you want to capture?" }],
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
   PAGE BUILDING — turn the session's material into reader pages.

   The reference arrives as extracted plain text (already capped by the
   upload endpoint). It is paginated locally: blank-line-separated blocks
   become paragraphs, and enough paragraphs fill a page to read comfortably
   at the Fortizo page width. When a session has no reference, the reader
   falls back to the session's own plan (subtopics + objectives) so the book
   icon always has something honest to open.
   ═══════════════════════════════════════════════════════════════════════════ */

// The page cut is shared with the server (lib/readerPages.js), so a
// citation's page is the page shown here.
export const sectionEyebrow = (n, label) =>  `<div class="doc-eyebrow">SECTION ${String(n).padStart(2, "0")}${label ? ` · ${escapeHtml(label)}` : ""}</div>`;

/* 42 → "0:42", 3675 → "1:01:15" — the media toolbar's clock. */
export const mediaTime = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

/**
 * Build the reader's pages for a learning session.
 * Returns [{ html, text }] — html for the paper page, text kept so tool
 * results can be derived from the actual material.
 */
export function buildSessionReaderPages({ topic, subject, reference, subtopics = [], objectives = {} } = {}) {
  const pages = [];
  const sourceName = reference?.name || "Session guide";

  // Cover — the Fortizo title page, carrying the session identity.
  pages.push({
    html: `<div class="reader-cover text-center">
      <div class="cover-eyebrow">SESSION MATERIAL</div>
      <h1>${escapeHtml(topic || "Learning session")}</h1>
      <div class="cover-rule"></div>
      <div class="cover-sub">${escapeHtml(subject || "")}${subject ? " · " : ""}${escapeHtml(sourceName)}<br>Prepared for this Akoro learning session</div>
    </div>`,
    text: "",
  });

  if (reference?.text) {
    const content = paginateBlocks(textToParagraphBlocks(reference.text));
    content.forEach((blocks, i) => {
      const withHead = [sectionEyebrow(i + 1, i === 0 ? sourceName : ""), ...blocks];
      // First block carries the citation anchor for jump-and-flash.
      withHead[1] = withHead[1].replace(/^<p/, `<p data-cite="p-${i + 1}"`);
      pages.push({
        html: withHead.join("") + `<div class="page-foot">${i + 2}</div>`,
        text: blocks.map((b) => b.replace(/<[^>]+>/g, "")).join(" "),
      });
    });
    return pages;
  }

  // No reference text — the session plan is the material.
  const items = (subtopics || []).map((st) => ({ st, objs: objectives?.[st] || [] }));
  if (items.length === 0) {
    pages[0].html = pages[0].html.replace(
      "Prepared for this Akoro learning session",
      "No reference file is attached to this session yet",
    );
    return pages;
  }
  for (let i = 0; i < items.length; i += 3) {
    const chunk = items.slice(i, i + 3);
    const blocks = [
      sectionEyebrow(i / 3 + 1, "SESSION PLAN"),
      `<h2>What this session covers</h2>`,
      ...chunk.map(({ st, objs }) =>
        `<p><span class="plan-topic">${escapeHtml(st)}</span></p><ul>${
          objs.map((o) => `<li>${escapeHtml(o)}</li>`).join("")
        }</ul>`,
      ),
    ];
    blocks[2] = blocks[2].replace(/^<p/, `<p data-cite="p-${i / 3 + 1}"`);
    pages.push({
      html: blocks.join("") + `<div class="page-foot">${i / 3 + 2}</div>`,
      text: chunk.map(({ st, objs }) => `${st}. ${objs.join(" ")}`).join(" "),
    });
  }
  return pages;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONTENT DERIVATION — tool results built from the session's own material.

   Fortizo shipped static sample content; shipping someone's biology quiz
   inside a history session would be visibly broken, so the same result views
   are fed by deterministic derivation from the page's actual text: summaries
   quote its sentences, cloze quizzes blank a real term, flashcards pair a
   term with the sentence that carries it. Podcast/Video keep the Fortizo
   player UI as an honest preview until a generator is wired.
   ═══════════════════════════════════════════════════════════════════════════ */

const STOP_WORDS = new Set(("because through between would there their about which these those other could should being been have more most such where after under over while during before itself himself themselves this that with from into onto upon within without among across toward against during each every some many much very often always sometimes usually however therefore thus also only just even still rather quite really almost enough less least own same another other others anything everything nothing something someone everyone anyone no-one it's don't doesn didn't can't won't isn't aren't they're we're you're i'm").split(" "));

function splitSentences(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  const matches = clean.match(/[^.!?]+[.!?]+/g) || [];
  return matches.map((s) => s.trim()).filter((s) => s.length > 24);
}

function extractTerms(sentences) {
  const counts = new Map();
  for (const s of sentences) {
    for (const w of s.match(/[A-Za-z][A-Za-z'-]{5,}/g) || []) {
      const lw = w.toLowerCase();
      if (!STOP_WORDS.has(lw)) counts.set(lw, (counts.get(lw) || 0) + 1);
    }
  }
  // Longer, repeated terms carry the page's meaning — rank by length × frequency.
  return [...counts.keys()]
    .sort((a, b) => (b.length + counts.get(b) * 2) - (a.length + counts.get(a) * 2));
}

const titleCase = (w) => w.charAt(0).toUpperCase() + w.slice(1);

/* The extraction block covering a sentence offset — a citation's precise
   flash target on a scanned page (bbox_2d, normalized 0-1000). Blocks are
   the page's markdown in order, so walking their text lengths maps any
   offset in the joined page text back to the box it came from. */
function blockBboxForOffset(pageText, blocks, sentence) {
  if (!Array.isArray(blocks) || !blocks.length) return null;
  const at = pageText.indexOf(sentence);
  if (at < 0) return null;
  let acc = 0;
  for (const b of blocks) {
    const len = String(b?.text_content || "").length + 2;   // the "\n\n" join
    if (at < acc + len) {
      return Array.isArray(b?.bbox_2d) && b.bbox_2d.length === 4 ? b.bbox_2d : null;
    }
    acc += len;
  }
  return null;
}

export function sentenceCiteFor(pageIndex, bbox = null) {
  return bbox
    ? { page: pageIndex, dataCite: `p-${pageIndex}`, bbox }
    : { page: pageIndex, dataCite: `p-${pageIndex}` };
}

function deriveSummary(pageText, pageIndex, blocks = null) {
  const sentences = splitSentences(pageText).sort((a, b) => b.length - a.length).slice(0, 3);
  return sentences
    .sort((a, b) => pageText.indexOf(a) - pageText.indexOf(b)) // restore reading order
    .map((s) => ({ text: s.length > 240 ? s.slice(0, 240).trim() + "…" : s, cite: sentenceCiteFor(pageIndex, blockBboxForOffset(pageText, blocks, s)) }));
}

function deriveQuiz(pageText, pageIndex, wanted, blocks = null) {
  const sentences = splitSentences(pageText);
  const terms = extractTerms(sentences);
  if (terms.length < 4) return [];

  const questions = [];
  const usedSentences = new Set();
  for (const term of terms) {
    if (questions.length >= wanted) break;
    const re = new RegExp(`\\b${term}s?\\b`, "i");
    const host = sentences.find((s) => re.test(s) && !usedSentences.has(s) && (s.match(/\b\w+\b/g) || []).length >= 8 && (s.match(/\b\w+\b/g) || []).length <= 34);
    if (!host) continue;
    usedSentences.add(host);

    const blanked = host.replace(re, "________");
    if (blanked === host) continue;

    // Distractors: the next distinct terms after this one — deterministic, no random.
    const distractors = terms.filter((t) => t !== term.replace(/s$/, "") && !re.test(t)).slice(questions.length + 1, questions.length + 4);
    if (distractors.length < 3) continue;

    const options = [
      { key: "A", text: titleCase(distractors[0]), correct: false },
      { key: "B", text: titleCase(term), correct: true },
      { key: "C", text: titleCase(distractors[1]), correct: false },
      { key: "D", text: titleCase(distractors[2]), correct: false },
    ];
    questions.push({ prompt: `Complete this line from the material: “${blanked.trim()}”`, cite: sentenceCiteFor(pageIndex, blockBboxForOffset(pageText, blocks, host)), options });
  }
  return questions;
}

function deriveCards(pageText, wanted) {
  const sentences = splitSentences(pageText);
  const terms = extractTerms(sentences);
  const cards = [];
  const used = new Set();
  for (const term of terms) {
    if (cards.length >= wanted) break;
    const re = new RegExp(`\\b${term}s?\\b`, "i");
    const host = sentences.find((s) => re.test(s) && !used.has(s));
    if (!host) continue;
    used.add(host);
    cards.push({ front: titleCase(term), back: host.trim() });
  }
  return cards;
}

export const QUIZ_HINTS = {
  simple: "Read the sentence in your head and try each option in the gap — keep the one that matches what the material actually says.",
  walk: "Go back to the page this came from and find the line. The missing term is one of the words the material repeats most — that repetition is the clue.",
};

/** Build everything a generated result tab needs, from the page it was made on. */
export function deriveToolContent(toolId, { pages, createdPage, values = {}, topic = "", subject = "", pageBlocks = null }) {
  // The cover carries no text — fall forward to the first content page.
  let pageIdx = pages[createdPage]?.text ? createdPage : pages.findIndex((p) => p.text);
  if (pageIdx < 0) pageIdx = 0;
  const pageText = pages[pageIdx]?.text || "";
  const cite = sentenceCiteFor(pageIdx);

  switch (toolId) {
    case "summary": {
      const points = deriveSummary(pageText, pageIdx, pageBlocks?.[pageIdx] || null);
      return {
        summaryPoints: points,
        emptyReason: points.length ? null : "This page doesn't have enough running text to digest yet.",
      };
    }
    case "quiz": {
      const wanted = parseInt(values.count, 10) || 5;
      const questions = deriveQuiz(pageText, pageIdx, Math.min(wanted, 50), pageBlocks?.[pageIdx] || null);
      return {
        quizQuestions: questions,
        quizAnswers: questions.map(() => ({ selected: null, checked: false, dontKnow: false })),
        emptyReason: questions.length ? null : "This page doesn't have enough repeated key terms to build a quiz from. Try a denser page.",
      };
    }
    case "flashcards": {
      const wanted = parseInt(values.count, 10) || 6;
      const cards = deriveCards(pageText, Math.min(wanted, 10));
      return {
        cardSet: cards,
        emptyReason: cards.length ? null : "No key terms stood out on this page. Try a page with more definitions.",
      };
    }
    case "podcast":
      return {
        podcastBlurb: `A short, spoken walkthrough of ${values.focus || topic || "this page"} — good for reviewing while commuting or resting your eyes. Playable episodes are on the way; the outline is ready today.`,
        cite,
      };
    case "video":
      return {
        videoBlurb: `An illustrated walkthrough of ${values.focus || topic || "this page"}, built from the terms and examples on the page. Rendered episodes are on the way.`,
        cite,
      };
    case "notes":
      return { notesValue: values.focus ? `${values.focus}\n\n` : "" };
    default:
      return {};
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   READER CSS — Fortizo's folio classes with Akoro's palette. Chrome is the
   session's dark surface with purple accents; document pages stay paper.
   ═══════════════════════════════════════════════════════════════════════════ */

export const READER_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&display=swap');
.sreader{font-family:'Nunito',sans-serif;}
.font-ui-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}
.font-display{font-family:'Newsreader',serif;}

/* Document pages — paper, exactly the Fortizo reading surface. */
.doc-page h1{font-family:'Newsreader',serif;font-size:1.9rem;font-weight:600;margin:0 0 0.4rem;letter-spacing:-0.01em;color:#1c1917;}
.doc-page h2{font-family:'Newsreader',serif;font-size:1.2rem;font-weight:600;margin:1.6rem 0 0.6rem;padding-bottom:0.5rem;border-bottom:1px solid #e7e5e4;color:#1c1917;}
.doc-page p{font-family:'Newsreader',serif;font-size:0.98rem;line-height:1.7;margin:0 0 0.9rem;color:#33403a;}
.doc-page ol,.doc-page ul{font-family:'Newsreader',serif;margin:0 0 0.9rem;padding-left:1.4rem;}
.doc-page li{font-size:0.96rem;line-height:1.65;margin-bottom:0.45rem;color:#33403a;}
.doc-page .page-foot{position:absolute;bottom:24px;left:0;right:0;text-align:center;font-family:ui-monospace,Menlo,monospace;font-size:0.7rem;color:#a8a29e;}
.doc-page .cover-eyebrow{font-family:ui-monospace,Menlo,monospace;font-size:.72rem;letter-spacing:.16em;color:#6C3BFF;}
.doc-page .cover-rule{width:56px;height:2px;background:#6C3BFF;margin:22px auto;}
.doc-page .cover-sub{color:#78716c;font-size:.85rem;line-height:1.75;font-family:'Newsreader',serif;}
.doc-page .doc-eyebrow{font-family:ui-monospace,Menlo,monospace;font-size:.68rem;letter-spacing:.1em;color:#a8a29e;margin-bottom:8px;}
.doc-page .plan-topic{font-weight:600;color:#1c1917;}
.doc-page h3{font-family:'Newsreader',serif;font-size:1.05rem;font-weight:600;margin:1.2rem 0 0.5rem;color:#1c1917;}
.doc-page ul.doc-li{margin:0 0 0.35rem;list-style:disc;}
.doc-page ul.doc-li li{margin-bottom:0;}
.doc-page .doc-table-wrap{overflow-x:auto;margin:0 0 1rem;}
.doc-page table.doc-table{border-collapse:collapse;width:100%;font-family:'Newsreader',serif;font-size:.9rem;color:#33403a;}
.doc-page table.doc-table th,.doc-page table.doc-table td{border:1px solid #e7e5e4;padding:6px 9px;text-align:left;vertical-align:top;}
.doc-page table.doc-table th{background:#f5f5f4;font-weight:600;color:#1c1917;}
.doc-page blockquote{border-left:3px solid #e7e5e4;margin:0 0 0.9rem;padding:2px 0 2px 12px;font-family:'Newsreader',serif;color:#57534e;}
.doc-page .doc-notes{background:#faf7ff;border-left:3px solid #6C3BFF;padding:8px 12px;border-radius:4px;font-size:.9rem;}
.doc-page .doc-empty{color:#a8a29e;font-style:italic;}

/* Chrome — dark session surface, Akoro purple accents. */
.sreader-bg{background:var(--ak-bg);}
.folio-tab-pill{background:var(--ak-tag-bg);border-color:var(--ak-border2);color:var(--ak-text-sub);}
.folio-tab-pill:hover{color:var(--ak-text);}
.folio-tab-pill.active{background:rgba(108,59,255,.18);border-color:var(--ak-accent);color:var(--ak-accent);font-weight:700;}
.folio-chip{background:var(--ak-tag-bg);border-color:var(--ak-border2);color:var(--ak-accent);}
.folio-chip:hover{background:rgba(108,59,255,.18);border-color:rgba(108,59,255,.4);}
.folio-gen-card{background:var(--ak-tag-bg);border-color:var(--ak-border2);}
.folio-gen-card:hover{border-color:var(--ak-accent);background:rgba(108,59,255,.08);}
.folio-btn-outline{background:var(--ak-tag-bg);border-color:var(--ak-border2);color:var(--ak-text-sec);}
.folio-btn-outline:hover{border-color:var(--ak-accent);color:var(--ak-accent);}
.folio-primary-btn{background:var(--ak-accent);color:#fff;}
.folio-primary-btn:hover{background:#5A2BEB;}
.folio-thumb{background:var(--ak-tag-bg);border-color:var(--ak-border2);color:var(--ak-text-sub);}
.folio-thumb:hover{border-color:rgba(108,59,255,.5);}
.folio-thumb.active{border-color:var(--ak-accent);color:var(--ak-accent);box-shadow:0 0 0 2px rgba(108,59,255,.22);}
.folio-form-field{background:var(--ak-tag-bg);border-color:var(--ak-border2);color:var(--ak-text);}
.folio-form-field::placeholder{color:var(--ak-text-sub);}
.folio-form-field:focus{border-color:var(--ak-accent);}
.folio-icon-btn{color:var(--ak-text-sub);}
.folio-icon-btn:hover{background:rgba(108,59,255,.16);color:var(--ak-accent);}
.sreader-menu{background:var(--ak-surface);border:1px solid var(--ak-border2);box-shadow:0 18px 44px rgba(0,0,0,.5);}
.folio-citation{display:inline-flex;align-items:center;gap:3px;font-size:0.65rem;font-family:ui-monospace,Menlo,monospace;color:var(--ak-accent);background:rgba(108,59,255,.16);border-radius:999px;padding:1px 7px;margin-left:6px;cursor:pointer;vertical-align:middle;border:none;white-space:nowrap;}
.folio-citation:hover{background:var(--ak-accent);color:#fff;}
.cite-bbox-flash{position:absolute;z-index:4;border:2.5px solid #7C3AED;background:rgba(124,58,237,.16);border-radius:4px;pointer-events:none;box-shadow:0 0 0 4px rgba(124,58,237,.10);animation:citeBoxFlash 2.3s ease-out forwards;}
@keyframes citeBoxFlash{0%{opacity:0;transform:scale(1.05)}12%{opacity:1;transform:scale(1)}70%{opacity:.85}100%{opacity:0}}
.cite-flash{animation:sreaderCiteFlash 2.2s ease-out;border-radius:4px;}
@keyframes sreaderCiteFlash{
  0%{background:rgba(108,59,255,.22);box-shadow:0 0 0 4px rgba(108,59,255,.22);}
  70%{background:rgba(108,59,255,.22);box-shadow:0 0 0 4px rgba(108,59,255,.22);}
  100%{background:transparent;box-shadow:0 0 0 0 rgba(0,0,0,0);}
}
.folio-redaction{background:#1c1917;color:transparent;border-radius:3px;cursor:pointer;padding:0 2px;-webkit-user-select:none;user-select:none;box-decoration-break:clone;-webkit-box-decoration-break:clone;}
.folio-mark-box{position:absolute;z-index:4;padding:0;border-radius:2px;pointer-events:auto;}
.folio-annotation.folio-mark-box{background:rgba(108,59,255,.24);border-bottom:2px solid var(--ak-accent);}
.folio-redaction.folio-mark-box{background:#1c1917;}
.folio-redaction.folio-mark-box.revealed{background:transparent;outline:1.5px dashed #a8a29e;}
.folio-redaction.revealed{background:transparent;color:inherit;outline:1.5px dashed #a8a29e;outline-offset:1px;-webkit-user-select:text;user-select:text;}
.folio-annotation{background:rgba(108,59,255,.22);border-bottom:2px solid var(--ak-accent);cursor:pointer;border-radius:2px;padding:0 1px;box-decoration-break:clone;-webkit-box-decoration-break:clone;}
.ak-src-chip{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 5px;margin:0 1px;border:none;border-radius:999px;background:var(--ak-tag-bg);color:var(--ak-accent);font:900 11px 'Nunito',sans-serif;cursor:pointer;vertical-align:2px;}
.ak-src-chip:hover{background:var(--ak-accent);color:#fff;}
.ak-folder-chip{display:inline-flex;align-items:center;gap:7px;border:1.5px solid var(--ak-border);background:var(--ak-surface);border-radius:12px;padding:7px 12px 7px 9px;font:800 12px 'Nunito',sans-serif;color:var(--ak-text-sub);cursor:pointer;white-space:nowrap;flex-shrink:0;}
.ak-folder-chip.on{border-color:var(--ak-accent);color:var(--ak-text);box-shadow:inset 0 0 0 1px var(--ak-accent);}
.ak-folder-back{width:32px;height:32px;border-radius:50%;border:1.5px solid var(--ak-border);background:var(--ak-surface);color:var(--ak-text-sub);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.ak-folder-back:hover{border-color:var(--ak-accent);color:var(--ak-accent);}
`;


/* ── Tab pills (Fortizo) ───────────────────────────────────────────────────── */

export function tabLabel(tab) {
  if (tab.id === "reader") return "Original Content";
  if (tab.id === "qa") return "Q&A";
  if (tab.id === "ask") return "Ask";
  if (tab.id === "discussion") return "Discussion";
  if (tab.toolId && String(tab.id).startsWith("tool:")) return toolById(tab.toolId)?.label || tab.toolId;
  return tab.title;
}

/* One tab per tool (Matt, 2026-11-17): creations group under their tool's
 * pill, the badge carries the count, and the tool's tab is the list of its
 * creations. Plural names head the list and the back row inside a creation. */
export const KIND_PLURALS = Object.freeze({ summary: "Summaries", quiz: "Quizzes", flashcards: "Flashcards", podcast: "Podcasts", notes: "Notes", video: "Videos" });
export const kindPlural = (kind) => KIND_PLURALS[kind] || `${toolById(kind)?.label || kind}s`;
export const focusLabelOf = (tab) => (tab.values?.focus && String(tab.values.focus).trim())
  || (tab.values?.scope === "Whole document" ? "Whole document" : `Page ${(tab.createdPage ?? 0) + 1}`);
export const rowTitleOf = (tab) => (tab.toolId === "podcast" && tab.podcast?.title) || focusLabelOf(tab);


export const pagesLabel = (pages = []) => {
  const list = [...new Set(pages.map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  if (!list.length) return "selected pages";
  const head = list.slice(0, 4).join(", ");
  return list.length > 4 ? `pages ${head} +${list.length - 4}` : `pages ${head}`;
};
export const whereFrom = (tab) => tab.values?.scope === "Whole document"
  ? "whole document"
  : tab.values?.scope === "Selected pages"
    ? pagesLabel(tab.values.pages)
    : `page ${tab.createdPage + 1}`;

export function resultSub(tab) {
  switch (tab.toolId) {
    case "podcast": return tab.podcast
      ? `${tab.values.length || "Medium · 5–6 min"} · ${whereFrom(tab)}`
      : `${tab.values.length || "Medium · 5–6 min"} · from page ${tab.createdPage + 1} · preview`;
    case "video": return `${tab.values.style || "Animated"} · from page ${tab.createdPage + 1} · preview`;
    case "summary": return `${tab.values.depth || "Brief"} summary · ${whereFrom(tab)}`;
    case "quiz": return `${tab.values.count || "5"} questions · ${tab.values.difficulty || "Medium"} · ${whereFrom(tab)}`;
    case "flashcards": return `${tab.values.count || "6"} cards · ${whereFrom(tab)}`;
    case "notes": return `Page ${tab.createdPage + 1}`;
    default: return "";
  }
}

