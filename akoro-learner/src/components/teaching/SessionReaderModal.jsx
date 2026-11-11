import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { escapeHtml, textToParagraphBlocks, paginateBlocks } from '../../lib/readerPages.js';
import { BRAND, GREEN, GOLD, RED } from "../../constants.js";
import { Icon } from "../common/Icons.jsx";
import MediaPlayer from "../library/MediaPlayer.jsx";
import ReaderDiscussion from "./ReaderDiscussion.jsx";
import ReaderAsk from "./ReaderAsk.jsx";
import ReaderPodcast from "./ReaderPodcast.jsx";
import { citeLabel, toReaderCite } from "../../lib/askAnswer.js";
import { selectionRects } from "../../lib/markRects.js";
import { TAB_KINDS, artifactToTab, marksFromArtifacts, tabContentPatch, tabToArtifact } from "../../lib/readerArtifacts.js";

/* ═══════════════════════════════════════════════════════════════════════════
   SessionReaderModal — the Fortizo reader, adopted into the higher-ed
   learning session (same architecture as reference/FortizoApp.jsx, rebranded
   to Akoro).

   What carried over from Fortizo, deliberately:
     • Document viewer: paper pages, page navigation, zoom, thumbnails,
       scroll-tracked current page.
     • Tools + tabs: a Generate grid (Podcast, Video, Summary, Quiz,
       Flashcards, Notes) whose results open as closable tab pills beside the
       document, plus community Q&A / Discussion boards.
     • In-document interactions: text-selection popover, annotations,
       redactions, and citations that jump the reader to the source page.

   What changed for Akoro:
     • Branding — the moss/paper chrome becomes the session's dark surface
       with Akoro purple accents; Nunito everywhere; tabler icons instead of
       lucide. Document pages stay paper-white: a reading surface should be.
     • The chat column is NOT re-implemented here. On desktop/tablet the
       caller passes the live learning session in as `chatNode` (reader left,
       session chat right — the Fortizo split). On mobile the reader opens as
       a full-screen modal over the session; the tab-strip chat button simply
       closes it, returning to the chat underneath.
     • Tool results are derived from the session's own material (the uploaded
       reference text) instead of Fortizo's static biology mock — same
       result views, real content. Podcast/Video remain honest previews:
       the player UI is real, playback is not wired to a generator yet.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Tool + form definitions (Fortizo's, icons swapped to tabler) ─────────── */

const TOOL_DEFS = [
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
const toolById = (id) => TOOL_DEFS.find((t) => t.id === id);
/* Tools the opener can generate for real (the `tools` prop) — the rest stay
   derived in the browser. They gain a scope choice. */
const SERVER_TOOLS = new Set(["summary", "quiz", "flashcards"]);
/* Made by the server after the request (the reader polls the saved item). */
const isServerPodcast = (tools, id) => id === "podcast" && !!tools?.podcast;
const SCOPE_FIELD = { id: "scope", label: "From", type: "select", options: ["This page", "Whole document"] };

const FORM_DEFS = {
  podcast: {
    title: "Podcast", sub: "Turn this page into a short audio episode",
    fields: [
      { id: "focus", label: "Focus (optional)", type: "text", placeholder: "e.g. the key argument" },
      { id: "length", label: "Length", type: "select", options: ["Short · 2–3 min", "Medium · 5–6 min", "Long · 8–10 min"] },
    ],
  },
  video: {
    title: "Video", sub: "Generate an illustrated walkthrough",
    fields: [
      { id: "focus", label: "Focus (optional)", type: "text", placeholder: "e.g. the worked example" },
      { id: "style", label: "Style", type: "select", options: ["Whiteboard", "Animated", "Narrated slides"] },
    ],
  },
  summary: {
    title: "Summary", sub: "A quick digest of this page",
    fields: [
      { id: "focus", label: "Focus (optional)", type: "text", placeholder: "e.g. only the definitions" },
      { id: "depth", label: "Depth", type: "select", options: ["Brief", "Detailed"] },
    ],
  },
  quiz: {
    title: "Quiz", sub: "Test yourself on this page",
    fields: [
      { id: "focus", label: "Focus (optional)", type: "text", placeholder: "e.g. the definitions" },
      { id: "count", label: "Questions", type: "number", min: 1, max: 50, default: "5", placeholder: "e.g. 8" },
      { id: "difficulty", label: "Difficulty", type: "select", options: ["Easy", "Medium", "Hard"] },
    ],
  },
  flashcards: {
    title: "Flashcards", sub: "Key terms from this page",
    fields: [
      { id: "focus", label: "Focus (optional)", type: "text", placeholder: "e.g. the vocabulary" },
      { id: "count", label: "Number of cards", type: "select", options: ["3", "6", "10"] },
    ],
  },
  notes: {
    title: "Notes", sub: "Start a note for this page",
    fields: [{ id: "focus", label: "Starting point (optional)", type: "text", placeholder: "What do you want to capture?" }],
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
const sectionEyebrow = (n, label) =>  `<div class="doc-eyebrow">SECTION ${String(n).padStart(2, "0")}${label ? ` · ${escapeHtml(label)}` : ""}</div>`;

/* 42 → "0:42", 3675 → "1:01:15" — the media toolbar's clock. */
const mediaTime = (sec) => {
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

function sentenceCiteFor(pageIndex, bbox = null) {
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

const QUIZ_HINTS = {
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

const READER_CSS = `
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
`;

/* ── Hooks ─────────────────────────────────────────────────────────────────── */

export function useIsMobileView() {
  const [isMobile, setIsMobile] = useState(() => (typeof window !== "undefined" ? window.innerWidth < 768 : false));
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = () => setIsMobile(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

/* ── Tab pills (Fortizo) ───────────────────────────────────────────────────── */

function tabLabel(tab) {
  if (tab.id === "reader") return "Original Content";
  if (tab.id === "qa") return "Q&A";
  if (tab.id === "ask") return "Ask";
  if (tab.id === "discussion") return "Discussion";
  return tab.title;
}

function TabIcon({ tab }) {
  if (tab.id === "reader") return <Icon name="ti-book-2" size={14}/>;
  const def = toolById(tab.id) || toolById(tab.toolId);
  return <Icon name={def ? def.icon : "ti-circle-check"} size={14}/>;
}

function TabPill({ tab, active, onSelect, onClose }) {
  return (
    <div
      onClick={onSelect}
      className={`folio-tab-pill flex items-center gap-1.5 flex-shrink-0 max-w-36 pl-2.5 pr-1.5 py-1.5 rounded-full border cursor-pointer text-xs whitespace-nowrap transition-colors ${active ? "active" : ""}`}
    >
      <TabIcon tab={tab}/>
      <span className="truncate">{tabLabel(tab)}</span>
      {tab.id !== "reader" && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="w-4 h-4 rounded-full flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-black/10 flex-shrink-0"
        >
          <Icon name="ti-x" size={10}/>
        </button>
      )}
    </div>
  );
}

/* ── Generate grid + creation form (Fortizo) ───────────────────────────────── */

function SavedList({ items, onOpen, onDelete }) {
  if (!items?.length) return null;
  return (
    <>
      <div className="font-display text-base font-semibold mb-2 mt-1" style={{ color: "var(--ak-text)" }}>Saved</div>
      <div className="flex flex-col gap-1.5 mb-4">
        {items.map((a) => {
          const def = toolById(a.kind);
          const title = artifactToTab(a, a.id).title;
          return (
            <div key={a.id} className="folio-gen-card flex items-center gap-2 px-2.5 py-1.5 border rounded-lg min-w-0">
              <button type="button" onClick={() => onOpen(a)} className="flex-1 flex items-center gap-2 min-w-0 text-left" style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                <span className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: def?.bg }}>
                  <Icon name={def?.icon || "ti-file-text"} size={13} color={def?.fg}/>
                </span>
                <span className="truncate text-sm" style={{ color: "var(--ak-text)" }}>{title}</span>
              </button>
              <button type="button" onClick={() => onDelete(a)} aria-label={`Delete ${title}`} title="Delete"
                className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ak-text-sub)" }}>
                <Icon name="ti-trash" size={13}/>
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function GenerateGrid({ onPick, discussion, askEnabled = false, saved = null }) {
  const generated = TOOL_DEFS.filter((t) => !t.community && (!t.needsAsk || askEnabled));
  // The Discussion card only features when this content is CONNECTED to
  // one of the learner's communities — that's when the messaging exists.
  // Q&A stays a session-local board either way.
  const community = TOOL_DEFS.filter((t) => t.community
    && (t.id !== "discussion" || !!discussion?.communities?.length));
  const Card = (t) => (
    <button
      key={t.id}
      type="button"
      onClick={() => onPick(t)}
      className="folio-gen-card flex items-center gap-2 px-2.5 py-2 border rounded-lg text-left min-w-0"
    >
      <span className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: t.bg }}>
        <Icon name={t.icon} size={15} color={t.fg}/>
      </span>
      <span className="flex-1 flex items-center gap-1.5 min-w-0 text-sm" style={{ color: "var(--ak-text)" }}>
        <span className="truncate">{t.label}</span>
      </span>
      <Icon name="ti-chevron-right" size={13} color="var(--ak-text-sub)"/>
    </button>
  );
  return (
    <div className="px-4 pt-3.5 pb-2 flex-shrink-0">
      <div className="font-display text-base font-semibold mb-2" style={{ color: "var(--ak-text)" }}>Generate</div>
      <div className="grid grid-cols-2 gap-2 mb-4">{generated.map(Card)}</div>
      {saved && <SavedList items={saved.items} onOpen={saved.onOpen} onDelete={saved.onDelete}/>}
      {community.length > 0 && (
        <>
          <div className="font-display text-base font-semibold mb-2" style={{ color: "var(--ak-text)" }}>Community</div>
          <div className="grid grid-cols-2 gap-2">{community.map(Card)}</div>
        </>
      )}
    </div>
  );
}

function ToolHeader({ label, sub, onBack }) {
  return (
    <div className="flex items-center gap-2.5 mb-3.5">
      <button type="button" onClick={onBack} className="folio-btn-outline w-7 h-7 rounded-full border flex items-center justify-center flex-shrink-0">
        <Icon name="ti-chevron-left" size={15}/>
      </button>
      <div>
        <div className="font-display text-base font-semibold mb-0.5" style={{ color: "var(--ak-text)" }}>{label}</div>
        {sub && <div className="text-xs" style={{ color: "var(--ak-text-sub)" }}>{sub}</div>}
      </div>
    </div>
  );
}

function CreationForm({ toolId, initialFocus, onBack, onSubmit, withScope = false }) {
  const base = FORM_DEFS[toolId];
  const def = withScope ? { ...base, fields: [SCOPE_FIELD, ...base.fields] } : base;
  const [values, setValues] = useState(() => {
    const v = {};
    def.fields.forEach((f) => {
      v[f.id] = f.type === "select" ? f.options[0]
        : f.type === "number" ? (f.default ?? "")
        : (f.id === "focus" ? initialFocus || "" : "");
    });
    return v;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function handleSubmit() {
    setSubmitting(true);
    setError("");
    // done() on success; fail(msg) keeps the form open with the reason.
    onSubmit(values, () => setSubmitting(false), (msg) => { setSubmitting(false); setError(msg || "Couldn't build that — try again."); });
  }

  return (
    <div>
      <ToolHeader label={def.title} sub={withScope && values.scope === "Whole document" ? def.sub.replace("this page", "the whole document") : def.sub} onBack={onBack}/>
      <div className="flex flex-col gap-3.5">
        {def.fields.map((f) => (
          <label key={f.id} className="flex flex-col gap-1.5">
            <span className="text-xs font-medium" style={{ color: "var(--ak-text-sub)" }}>{f.label}</span>
            {f.type === "number" ? (
              <input
                type="number"
                inputMode="numeric"
                min={f.min ?? 1}
                max={f.max ?? 100}
                value={values[f.id]}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value.replace(/[^0-9]/g, "") }))}
                className="folio-form-field border rounded-lg px-2.5 py-2 text-sm focus:outline-none"
                style={{ color: "var(--ak-text)" }}
              />
            ) : f.type === "text" ? (
              <input
                type="text"
                value={values[f.id]}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                className="folio-form-field border rounded-lg px-2.5 py-2 text-sm focus:outline-none"
                style={{ color: "var(--ak-text)" }}
              />
            ) : (
              <select
                value={values[f.id]}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                className="folio-form-field border rounded-lg px-2.5 py-2 text-sm focus:outline-none"
                style={{ color: "var(--ak-text)" }}
              >
                {f.options.map((o) => <option key={o}>{o}</option>)}
              </select>
            )}
          </label>
        ))}
        {error && (
          <div role="alert" className="text-xs leading-relaxed rounded-lg p-2.5" style={{ color: "var(--ak-danger-text)", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)" }}>
            {error}
          </div>
        )}
        <button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className="folio-primary-btn mt-1 w-full py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-75"
        >
          {submitting ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin inline-block"/>
              Building…
            </>
          ) : (
            `Build ${def.title.toLowerCase()}`
          )}
        </button>
      </div>
    </div>
  );
}

const whereFrom = (tab) => (tab.values?.scope === "Whole document" ? "whole document" : `page ${tab.createdPage + 1}`);

function resultSub(tab) {
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

function Citation({ cite, onCite }) {
  if (!cite) return null;
  const isPage = Number.isInteger(cite.page);
  if (!isPage && !Number.isFinite(cite.startMs)) return null;
  return (
    <button type="button" onClick={() => onCite(cite)} className="folio-citation" title={cite.quote ? `“${cite.quote}”` : "Jump to source in the reader"}>
      <Icon name={isPage ? "ti-file-text" : "ti-player-play"} size={10}/>
      {isPage ? `Page ${cite.page + 1}` : citeLabel({ startMs: cite.startMs })}
    </button>
  );
}

/* ── Result views (Fortizo's structure, derived content) ───────────────────── */

function EmptyResult({ reason }) {
  return (
    <div className="rounded-lg border p-3.5 text-xs leading-relaxed" style={{ borderColor: "var(--ak-border2)", background: "var(--ak-tag-bg)", color: "var(--ak-text-sub)" }}>
      <Icon name="ti-info-circle" size={14} color={GOLD}/> {reason}
    </div>
  );
}

function ResultView({ tab, onUpdate, onCite, onRetryPodcast = null }) {
  const header = (
    <div className="mb-3.5">
      <div className="font-display text-base font-semibold mb-0.5" style={{ color: "var(--ak-text)" }}>{tab.title}</div>
      <div className="text-xs" style={{ color: "var(--ak-text-sub)" }}>{resultSub(tab)}</div>
    </div>
  );

  function renderBody() {
    if (tab.toolId === "summary") {
      if (!tab.summaryPoints?.length) return <>{header}<EmptyResult reason={tab.emptyReason || "Nothing to summarise yet."}/></>;
      return (
        <div>
          {header}
          {tab.summaryPoints.map((p, i) => (
            <div key={i} className="flex gap-2.5 mb-3.5">
              <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: BRAND }}/>
              <p className="text-sm leading-relaxed m-0" style={{ color: "var(--ak-text-sec)" }}>{p.text} <Citation cite={p.cite} onCite={onCite}/></p>
            </div>
          ))}
        </div>
      );
    }

    if (tab.toolId === "podcast" && tab.podcast) {
      return (
        <div>
          {header}
          <ReaderPodcast podcast={tab.podcast} onCite={onCite} onRetry={onRetryPodcast ? () => onRetryPodcast(tab) : null}/>
        </div>
      );
    }

    if (tab.toolId === "podcast") {
      return (
        <div>
          {header}
          <div className="rounded-lg p-4 mb-3.5" style={{ background: "var(--ak-surface)", border: "1px solid var(--ak-border2)" }}>
            <div className="font-display text-sm mb-0.5" style={{ color: "var(--ak-text)" }}>Episode — {tab.values.focus || tab.topic || "This page"}</div>
            <div className="text-xs mb-3.5" style={{ color: "var(--ak-text-sub)" }}>{tab.values.length || "Medium · 8–10 min"} · outline preview</div>
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: BRAND }} title="Playable episodes are coming soon">
                <Icon name="ti-player-play" size={15} color="#fff"/>
              </span>
              <div className="flex-1 h-1 rounded-full relative" style={{ background: "var(--ak-tag-bg)" }}>
                <div className="absolute left-0 top-0 bottom-0 rounded-full" style={{ width: "33%", background: BRAND }}/>
              </div>
              <span className="font-ui-mono text-xs" style={{ color: "var(--ak-text-sub)" }}>0:00</span>
            </div>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: "var(--ak-text-sec)" }}>{tab.podcastBlurb} <Citation cite={tab.cite} onCite={onCite}/></p>
        </div>
      );
    }

    if (tab.toolId === "video") {
      return (
        <div>
          {header}
          <div className="w-full rounded-lg flex items-center justify-center relative mb-3" style={{ aspectRatio: "16 / 9", background: "linear-gradient(135deg,var(--ak-surface),var(--ak-bg))", border: "1px solid var(--ak-border2)" }}>
            <span className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: BRAND }} title="Rendered episodes are coming soon">
              <Icon name="ti-player-play" size={17} color="#fff"/>
            </span>
            <span className="absolute bottom-2.5 right-2.5 font-ui-mono text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(0,0,0,.55)", color: "#fff" }}>preview</span>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: "var(--ak-text-sec)" }}>{tab.videoBlurb} <Citation cite={tab.cite} onCite={onCite}/></p>
        </div>
      );
    }

    if (tab.toolId === "quiz") {
      const questions = tab.quizQuestions || [];
      if (!questions.length) return <>{header}<EmptyResult reason={tab.emptyReason || "No quiz could be built from this page."}/></>;
      const total = questions.length;
      const idx = Math.min(tab.quizIndex ?? 0, total - 1);
      const q = questions[idx];
      const answers = tab.quizAnswers || questions.map(() => ({ selected: null, checked: false, dontKnow: false }));
      const ans = answers[idx] || { selected: null, checked: false, dontKnow: false };
      const revealed = ans.checked || ans.dontKnow;
      const selectedOpt = q.options.find((o) => o.key === ans.selected);
      const correctOpt = q.options.find((o) => o.correct);

      function patchAnswer(partial) {
        const next = answers.slice();
        next[idx] = { ...ans, ...partial };
        onUpdate({ quizAnswers: next });
      }

      return (
        <div>
          {header}
          <div className="flex items-center justify-between mb-3">
            <span className="font-ui-mono text-xs" style={{ color: "var(--ak-text-sub)" }}>Question {idx + 1} of {total}</span>
            <Citation cite={q.cite} onCite={onCite}/>
          </div>
          <div className="font-display text-sm font-medium mb-3.5" style={{ color: "var(--ak-text)" }}>{q.prompt}</div>
          <div className="mb-1.5">
            {q.options.map((opt) => {
              let cls = { border: "var(--ak-border2)", background: "transparent" };
              if (revealed && opt.correct) cls = { border: GREEN, background: "rgba(16,185,129,.12)" };
              else if (revealed && opt.key === ans.selected) cls = { border: "var(--ak-danger-text)", background: "rgba(239,68,68,.12)" };
              else if (!revealed && opt.key === ans.selected) cls = { border: BRAND, background: "rgba(108,59,255,.12)" };
              return (
                <div
                  key={opt.key}
                  onClick={() => !revealed && patchAnswer({ selected: opt.key })}
                  className="flex items-center gap-2.5 px-3 py-2.5 border rounded-lg mb-2 text-sm cursor-pointer"
                  style={{ borderColor: cls.border, background: cls.background, color: "var(--ak-text)" }}
                >
                  <span className="w-5 h-5 rounded-full border flex items-center justify-center font-ui-mono text-xs flex-shrink-0" style={{ borderColor: "var(--ak-border2)" }}>{opt.key}</span>
                  {opt.text}
                </div>
              );
            })}
          </div>

          {tab.quizHint && (
            <div className="text-xs leading-relaxed rounded-lg p-2.5 mb-3" style={{ color: "var(--ak-text-sub)", background: "var(--ak-tag-bg)", border: "1px solid var(--ak-border2)" }}>{tab.quizHint}</div>
          )}

          {!revealed && (
            <div className="flex items-center gap-2 mb-3">
              <button type="button" onClick={() => onUpdate({ quizHint: QUIZ_HINTS.simple })} className="folio-chip flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs whitespace-nowrap">
                <Icon name="ti-bulb" size={13}/> Make it simple
              </button>
              <button type="button" onClick={() => onUpdate({ quizHint: QUIZ_HINTS.walk })} className="folio-chip flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs whitespace-nowrap">
                <Icon name="ti-list-numbers" size={13}/> Walk me through it
              </button>
            </div>
          )}

          {!revealed ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => patchAnswer({ checked: true })} className="folio-primary-btn flex-1 py-2.5 rounded-lg text-sm font-bold">
                Check answer
              </button>
              <button type="button" onClick={() => patchAnswer({ dontKnow: true })} className="folio-btn-outline flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border text-sm font-bold flex-shrink-0">
                <Icon name="ti-help" size={14}/> Don't know
              </button>
            </div>
          ) : idx < total - 1 ? (
            <button type="button" onClick={() => onUpdate({ quizIndex: idx + 1, quizHint: null })} className="folio-primary-btn w-full py-2.5 rounded-lg text-sm font-bold">
              Next question
            </button>
          ) : (
            <div className="text-center text-sm font-bold py-2" style={{ color: GREEN }}>Quiz complete 🎉</div>
          )}

          {revealed && (
            <div className="mt-2.5 text-xs" style={{ color: "var(--ak-text-sub)" }}>
              {ans.dontKnow
                ? `No worries — the answer is: ${correctOpt?.text}`
                : selectedOpt?.correct
                ? "Correct!"
                : `Not quite — the correct answer is: ${correctOpt?.text}`}
              {q.explanation && <div className="mt-1.5 leading-relaxed" style={{ color: "var(--ak-text-sec)" }}>{q.explanation}</div>}
            </div>
          )}
        </div>
      );
    }

    if (tab.toolId === "flashcards") {
      const cards = tab.cardSet || [];
      if (!cards.length) return <>{header}<EmptyResult reason={tab.emptyReason || "No cards could be built from this page."}/></>;
      const cardIdx = Math.min(tab.cardIndex ?? 0, cards.length - 1);
      const card = cards[cardIdx];
      const cardCite = card.cite || sentenceCiteFor(tab.createdPage);
      return (
        <div>
          {header}
          <div className="flex items-center justify-center gap-2 text-center text-xs mb-3" style={{ color: "var(--ak-text-sub)" }}>
            <span>Tap the card to flip</span>
            <Citation cite={cardCite} onCite={onCite}/>
          </div>
          <div className="w-full mb-3.5" style={{ perspective: "1000px", aspectRatio: "4 / 3" }}>
            <div
              onClick={() => onUpdate({ flipped: !tab.flipped })}
              className="relative w-full h-full cursor-pointer transition-transform duration-500"
              style={{ transformStyle: "preserve-3d", transform: tab.flipped ? "rotateY(180deg)" : "none" }}
            >
              <div className="absolute inset-0 rounded-lg flex items-center justify-center text-center p-4 border" style={{ backfaceVisibility: "hidden", background: "rgba(108,59,255,.12)", borderColor: "rgba(108,59,255,.35)" }}>
                <span className="font-display text-lg font-semibold" style={{ color: "var(--ak-accent)" }}>{card.front}</span>
              </div>
              <div
                className="absolute inset-0 rounded-lg flex items-center justify-center text-center p-4 text-sm leading-relaxed"
                style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)", background: "var(--ak-surface)", border: "1px solid var(--ak-border2)", color: "var(--ak-text)" }}
              >
                {card.back}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => onUpdate({ cardIndex: (cardIdx - 1 + cards.length) % cards.length, flipped: false })}
              className="folio-btn-outline w-7 h-7 rounded-full border flex items-center justify-center"
            >
              <Icon name="ti-chevron-left" size={14}/>
            </button>
            <span className="font-ui-mono text-xs" style={{ color: "var(--ak-text-sub)" }}>{cardIdx + 1} / {cards.length}</span>
            <button
              type="button"
              onClick={() => onUpdate({ cardIndex: (cardIdx + 1) % cards.length, flipped: false })}
              className="folio-btn-outline w-7 h-7 rounded-full border flex items-center justify-center"
            >
              <Icon name="ti-chevron-right" size={14}/>
            </button>
          </div>
        </div>
      );
    }

    if (tab.toolId === "notes") {
      return (
        <div>
          {header}
          <textarea
            value={tab.notesValue ?? ""}
            onChange={(e) => onUpdate({ notesValue: e.target.value })}
            placeholder="Write a note about this page…"
            style={{ minHeight: "16rem" }}
            className="folio-form-field w-full border rounded-lg p-3 font-display text-sm leading-relaxed resize-y focus:outline-none"
          />
          <div className="flex justify-between font-ui-mono text-xs mt-2" style={{ color: "var(--ak-text-sub)" }}>
            <span>Page {tab.createdPage + 1}</span>
            <span>saved on this device</span>
          </div>
        </div>
      );
    }

    return null;
  }

  return renderBody();
}

/* ── Community boards (Fortizo) — persistent per document, seeded empty.
   There is no shared backend behind a session's reference material, so the
   boards start honestly empty rather than pretending classmates have posted. ── */

function ThreadNode({ node, onReply, onLike, depth = 0 }) {
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");

  function submitReply() {
    const t = replyText.trim();
    if (!t) return;
    onReply(node.id, t);
    setReplyText("");
    setReplying(false);
  }

  const indent = Math.min(depth, 4) * 20;

  return (
    <div style={{ marginLeft: indent }} className={depth > 0 ? "mt-3 pl-3 border-l-2" : "mb-5"}>
      <div className="flex items-start gap-2.5">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
          style={{ background: node.color || "var(--ak-text-sub)" }}
        >
          {node.author[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold" style={{ color: "var(--ak-text)" }}>{node.author}</span>
            <span className="text-xs" style={{ color: "var(--ak-text-sub)" }}>{node.ts}</span>
          </div>
          <p className="text-sm mt-0.5 mb-1.5" style={{ color: "var(--ak-text-sec)" }}>{node.text}</p>
          <div className="flex items-center gap-3.5 text-xs">
            <button type="button" onClick={() => onLike(node.id)} className="flex items-center gap-1 hover:opacity-80" style={{ color: "var(--ak-text-sub)" }}>
              <Icon name="ti-thumb-up" size={13}/> {node.likes || 0}
            </button>
            <button type="button" onClick={() => setReplying((r) => !r)} className="font-bold hover:opacity-80" style={{ color: "var(--ak-accent)" }}>
              Reply
            </button>
          </div>

          {replying && (
            <div className="flex items-center gap-2 mt-2.5">
              <input
                autoFocus
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitReply()}
                placeholder="Write a reply…"
                className="folio-form-field flex-1 border rounded-full px-3 py-1.5 text-sm focus:outline-none"
              />
              <button type="button" onClick={submitReply} className="folio-primary-btn px-3 py-1.5 rounded-full text-xs font-bold flex-shrink-0">
                Send
              </button>
            </div>
          )}

          {(node.replies || []).map((child) => (
            <ThreadNode key={child.id} node={child} onReply={onReply} onLike={onLike} depth={depth + 1}/>
          ))}
        </div>
      </div>
    </div>
  );
}

function addReplyToTree(nodes, parentId, reply) {
  return nodes.map((n) => {
    if (n.id === parentId) return { ...n, replies: [...(n.replies || []), reply] };
    if (n.replies?.length) return { ...n, replies: addReplyToTree(n.replies, parentId, reply) };
    return n;
  });
}
function likeInTree(nodes, id) {
  return nodes.map((n) => {
    if (n.id === id) return { ...n, likes: (n.likes || 0) + 1 };
    if (n.replies?.length) return { ...n, replies: likeInTree(n.replies, id) };
    return n;
  });
}

function CommunityBoard({ title, subtitle, placeholder, actionLabel, emptyText, threads, setThreads }) {
  const [text, setText] = useState("");

  function post() {
    const t = text.trim();
    if (!t) return;
    const node = { id: "t-" + Date.now(), author: "You", color: BRAND, text: t, ts: "just now", likes: 0, replies: [] };
    setThreads((prev) => [node, ...prev]);
    setText("");
  }

  return (
    <div>
      <div className="mb-4">
        <div className="font-display text-base font-semibold mb-0.5" style={{ color: "var(--ak-text)" }}>{title}</div>
        <div className="text-xs" style={{ color: "var(--ak-text-sub)" }}>{subtitle}</div>
      </div>
      <div className="flex items-center gap-2 mb-5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && post()}
          placeholder={placeholder}
          className="folio-form-field flex-1 border rounded-full px-3.5 py-2 text-sm focus:outline-none"
        />
        <button type="button" onClick={post} className="folio-primary-btn px-4 py-2 rounded-full text-sm font-bold flex-shrink-0">
          {actionLabel}
        </button>
      </div>
      {threads.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--ak-text-sub)" }}>{emptyText}</p>
      ) : (
        threads.map((t) => (
          <ThreadNode
            key={t.id}
            node={t}
            onLike={(id) => setThreads((prev) => likeInTree(prev, id))}
            onReply={(id, replyText) =>
              setThreads((prev) => addReplyToTree(prev, id, { id: id + "-" + Date.now(), author: "You", color: BRAND, text: replyText, ts: "just now", likes: 0, replies: [] }))
            }
          />
        ))
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SESSION READER MODAL — the Fortizo reader pane. Mobile: full-screen modal
   over the session. Desktop/tablet: the Fortizo split — reader left, the
   live learning session (`chatNode`) right.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function SessionReaderModal({
  docTitle,
  sourceName = "Session guide",
  docKey = null,   // stable identity for remembering the reader's place (page + zoom)
  pages = [],
  onClose,
  initialTool = null,   // open on this study tool's form (an Agent Chat link)
  initialArtifactId = null,   // open on this saved tab (made in Agent Chat)
  chatNode = null,
  onOpenChat,
  onExplainSelection,
  /* ── Library record seams (all optional — the teaching session passes
     none of them and gets exactly the old behavior) ──
     renderPageContent: (pageIndex) => ReactNode — when set, each page div
       renders this instead of the page's HTML (pdf.js canvases, images,
       honest download cards); a null return keeps the page's HTML (text,
       Word and PowerPoint pages). Zoom, page nav, thumbnails and the
       IntersectionObserver page tracking all keep working.
     media: { kind:'audio'|'video', src, title, onPosition } — when set, the
       reader pane becomes a media player: the ORIGINAL file plays, and the
       toolbar swaps page nav/zoom for transport (±10s, play/pause, speed).
     Annotate / Hide work on every page: text pages mark the words, drawn
       pages (canvases, images) draw the mark over the selection's boxes.
     rawPages: true — the pages are finished documents (pdf.js canvases):
       they carry their own margins, so the reader drops the inner page
       padding and the width cap, keeps ONE small margin around the page
       stack and a tight gap between pages — the document fills the pane. */
  renderPageContent = null,
  media = null,
  rawPages = false,
  /* pageBlocks[i] — the AI extraction's layout blocks for PDF page i
     (bbox_2d normalized 0-1000). When present, generated summaries/quiz
     citations carry the exact block's bbox, and citeJump flashes THAT
     region on the scanned page — Fortizo's jump-and-flash, grounded. */
  pageBlocks = null,
  /* transcript — { segments:[{kind, startMs, endMs, speaker, text}] } for
     audio/video materials: listed under the player; a click seeks the
     recording to that moment. */
  transcript = null,
  /* Course-video transcription offer — the reader renders the row, the
     session owns the job (start, poll, ground). Records drive their own
     offer from RecordTeachSession and pass no onTranscribe. */
  onTranscribe = null,
  transcribeState = null,   // 'idle' | 'running' | 'failed'
  transcribeError = null,
  /* discussion — the community discussion attached to this content:
     { communities:[{id, name, emoji, memberCount}] }. Null = the caller
     didn't look the content up (plain sessions, other surfaces — the
     local mock board keeps today's behavior). Empty list = looked up,
     nothing connected: the messaging only exists where a community
     connection does, so the Discussion card hides. With communities,
     the Discussion tab is the community's REAL persistent group chat
     (owned by the community, live over socket.io). */
  discussion = null,
  /* ask — { load(), send({question, selection, onDelta, onStatus, signal}) }
     from the opener (library records). Adds the Ask tool: questions about
     the WHOLE document, answered with citations that jump here. Must be a
     stable object (memoized) — the tab loads its thread when it changes. */
  ask = null,
  /* tools — { generate(toolId, { scope, pageNumber, pageText, values }) } from
     the opener (library records): Summary / Quiz / Flashcards generated from
     the document with citations, instead of derived in the browser. */
  tools = null,
  /* artifacts — { list(), save(body), update(id, patch), remove(id) } from
     the opener (library records): generated tabs, notes, annotations and
     hidden passages are kept per learner per document and restored here. */
  artifacts = null,
  /* jumpTo — { cite, key } from the session chat's citation chips: when it
     changes, the reader jumps there (page + box flash, or a seek). */
  jumpTo = null,
}) {
  const isMobile = useIsMobileView();
  const split = !isMobile && !!chatNode;

  /* Remember the reader's place (page + zoom) per document, so closing a
     topic — or a full refresh that sends the learner back to the course —
     then re-opening the PDF resumes where they left off instead of page 1.
     sessionStorage: survives the refresh but is per-tab, never shared. */
  const readerPosKey = docKey || (docTitle ? `${sourceName}:${docTitle}` : null);
  const restoredPos = useRef(null);
  if (restoredPos.current === null) {
    let page = 0, zoom = 1;
    if (readerPosKey && typeof window !== "undefined") {
      try {
        const raw = JSON.parse(sessionStorage.getItem(`akoro_reader_pos:${readerPosKey}`) || "null");
        if (raw) {
          page = Number.isInteger(raw.page) ? Math.max(0, Math.min(pages.length - 1, raw.page)) : 0;
          zoom = Number.isFinite(raw.zoom) ? Math.max(0.7, Math.min(1.5, raw.zoom)) : 1;
        }
      } catch { /* private mode / corrupt entry — start fresh */ }
    }
    restoredPos.current = { page, zoom };
  }
  const [currentPage, setCurrentPage] = useState(restoredPos.current.page);
  const [zoom, setZoom] = useState(restoredPos.current.zoom);
  const [pageNumDraft, setPageNumDraft] = useState(String(restoredPos.current.page + 1));
  const viewerRef = useRef(null);

  /* Zoom keeps your place. A width change re-lays every page, grows the
     scroll content and leaves scrollTop where it was — so zooming in threw
     the line you were reading hundreds of px below the fold, which reads as
     "the page jumped". Remember which page sits under the middle of the
     viewport and where on it, then put that same point back after layout. */
  const zoomAnchor = useRef(null);
  const zoomTo = useCallback((updater) => {
    const el = viewerRef.current;
    if (el) {
      const c = el.getBoundingClientRect();
      const cy = c.top + c.height / 2, cx = c.left + c.width / 2;
      let best = null;
      el.querySelectorAll("[data-page-index]").forEach((p) => {
        const r = p.getBoundingClientRect();
        if (r.bottom < c.top || r.top > c.bottom) return;
        const dist = Math.abs(r.top + r.height / 2 - cy);
        if (best && dist >= best.dist) return;
        best = {
          dist,
          index: Number(p.dataset.pageIndex),
          f: Math.min(1, Math.max(0, (cy - r.top) / Math.max(1, r.height))),
          hf: Math.min(1, Math.max(0, (cx - r.left) / Math.max(1, r.width))),
        };
      });
      zoomAnchor.current = best;
    }
    setZoom((z) => {
      const next = typeof updater === "function" ? updater(z) : updater;
      return Math.max(0.7, Math.min(1.5, +Number(next).toFixed(2)));
    });
  }, []);
  useLayoutEffect(() => {
    const a = zoomAnchor.current, el = viewerRef.current;
    zoomAnchor.current = null;
    if (!a || !el) return;
    const target = el.querySelector(`[data-page-index="${a.index}"]`);
    if (!target) return;
    const c = el.getBoundingClientRect(), r = target.getBoundingClientRect();
    el.scrollTop += (r.top + a.f * r.height) - (c.top + c.height / 2);
    el.scrollLeft += (r.left + a.hf * r.width) - (c.left + c.width / 2);
  }, [zoom]);

  /* tools: Generate dropdown / forms / result tabs */
  const [formTool, setFormTool] = useState(null);
  const [prefillFocus, setPrefillFocus] = useState("");
  const [resultTabs, setResultTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState("reader");
  const nextResultId = useRef(1);
  const [genMenuOpen, setGenMenuOpen] = useState(false);
  const genMenuRef = useRef(null);

  /* community: Q&A and Discussion — persistent boards, opened as tabs */
  const [qaThreads, setQaThreads] = useState([]);
  const [discussionThreads, setDiscussionThreads] = useState([]);
  const [communityTabsOpen, setCommunityTabsOpen] = useState([]);
  const [askPin, setAskPin] = useState(null);   // { pageNumber, text } from "Ask about this"
  const [savedItems, setSavedItems] = useState([]);   // saved tabs not open right now

  const [isPlaying, setIsPlaying] = useState(false);

  /* media mode — the record player's handle + live state, so the shared
     toolbar drives the same <audio>/<video> the pane shows. */
  const [playerApi, setPlayerApi]     = useState(null);
  const [playerState, setPlayerState] = useState({ playing: false, rate: 1, time: 0, duration: 0 });
  const isMedia = !!media;

  /* selection popover, annotations, redactions */
  const [selection, setSelection] = useState(null);
  const [selPos, setSelPos] = useState(null);
  const selMenuRef = useRef(null);
  const selectingRef = useRef(false);   // true while a finger/mouse is down, so the popover never pops up mid-drag
  const [redactions, setRedactions] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [revealedRedactions, setRevealedRedactions] = useState(() => new Set());
  const [openAnnotation, setOpenAnnotation] = useState(null);
  const [annotateDraft, setAnnotateDraft] = useState(null);
  const [annotateText, setAnnotateText] = useState("");

  /* Escape closes the reader — the modal sits over the live session. */
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  useEffect(() => {
    const root = viewerRef.current;
    if (!root || activeTabId !== "reader") return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            const idx = parseInt(entry.target.dataset.pageIndex, 10);
            setCurrentPage((cur) => (cur !== idx ? idx : cur));
          }
        });
      },
      { root, threshold: [0.5] }
    );
    root.querySelectorAll("[data-page-index]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [activeTabId, pages.length]);

  useEffect(() => { setPageNumDraft(String(currentPage + 1)); }, [currentPage]);

  /* Persist the place as the learner reads — cheap, so it follows every
     page turn and zoom tick without a debounce. */
  useEffect(() => {
    if (!readerPosKey) return;
    try { sessionStorage.setItem(`akoro_reader_pos:${readerPosKey}`, JSON.stringify({ page: currentPage, zoom, at: Date.now() })); }
    catch { /* private mode — remember nothing */ }
  }, [readerPosKey, currentPage, zoom]);

  /* On a reopen, jump straight back to the remembered page (no smooth
     scroll — a fresh open should land there, not animate past it). */
  useEffect(() => {
    const page = restoredPos.current?.page;
    if (!page) return;
    const raf = requestAnimationFrame(() => {
      viewerRef.current?.querySelector(`[data-page-index="${page}"]`)?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!genMenuOpen) return;
    const onDocClick = (e) => { if (genMenuRef.current && !genMenuRef.current.contains(e.target)) setGenMenuOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [genMenuOpen]);

  const goToPage = useCallback((idx) => {
    const clamped = Math.max(0, Math.min(pages.length - 1, idx));
    const el = viewerRef.current?.querySelector(`[data-page-index="${clamped}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pages.length]);

  /* Overlay redactions/annotations onto a page's HTML by wrapping the first
     occurrence of the marked text (Fortizo's approach). */
  function buildPageHtml(rawHtml, pageIndex) {
    let html = rawHtml;
    annotations.filter((a) => a.page === pageIndex).forEach((a) => {
      if (!a.text || !html.includes(a.text)) return;
      html = html.replace(a.text, `<mark class="folio-annotation" data-ann-id="${a.id}">${a.text}</mark>`);
    });
    redactions.filter((r) => r.page === pageIndex).forEach((r) => {
      if (!r.text || !html.includes(r.text)) return;
      const cls = revealedRedactions.has(r.id) ? "folio-redaction revealed" : "folio-redaction";
      html = html.replace(r.text, `<span class="${cls}" data-red-id="${r.id}">${r.text}</span>`);
    });
    return html;
  }

  function handleViewerClick(e) {
    const redEl = e.target.closest(".folio-redaction");
    if (redEl) {
      const id = redEl.dataset.redId;
      setRevealedRedactions((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
      return;
    }
    const annEl = e.target.closest(".folio-annotation");
    if (annEl) {
      const id = annEl.dataset.annId;
      const ann = annotations.find((a) => a.id === id);
      if (ann) {
        const rect = annEl.getBoundingClientRect();
        setOpenAnnotation({ id, note: ann.note, left: rect.left, top: rect.bottom + 8 });
      }
    }
  }

  function saveAnnotation() {
    if (!annotateDraft || !annotateText.trim()) return;
    const ann = {
      id: "ann-" + Date.now(), page: Number.isInteger(annotateDraft.page) ? annotateDraft.page : currentPage,
      text: annotateDraft.text, note: annotateText.trim(), rects: annotateDraft.rects || [],
    };
    setAnnotations((a) => [...a, ann]);
    artifacts?.save({ kind: "annotation", pageNumber: ann.page + 1, content: { text: ann.text.slice(0, 2000), note: ann.note.slice(0, 4000), rects: ann.rects } })
      .then((a) => a?.id && setAnnotations((list) => list.map((x) => (x.id === ann.id ? { ...x, artifactId: a.id } : x))))
      .catch(() => {});
    setAnnotateDraft(null);
    setAnnotateText("");
    try { window.getSelection().removeAllRanges(); } catch {}
  }

  useEffect(() => {
    if (!openAnnotation) return;
    const onDocClick = (e) => {
      if (!e.target.closest(".folio-annotation") && !e.target.closest("[data-annotation-popover]")) setOpenAnnotation(null);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [openAnnotation]);

  function commitPageNumDraft() {
    let n = parseInt(pageNumDraft, 10);
    if (isNaN(n)) { setPageNumDraft(String(currentPage + 1)); return; }
    n = Math.max(1, Math.min(pages.length, n));
    goToPage(n - 1);
    setPageNumDraft(String(n));
  }

  /* tabs navigation */
  function switchTabTo(id) {
    setActiveTabId(id);
    setSelection(null);
  }

  function closeTab(id) {
    if (id === "qa" || id === "discussion" || id === "ask") {
      setCommunityTabsOpen((c) => c.filter((x) => x !== id));
    } else {
      // A saved tab closes into the Saved list (reopen or delete it there).
      const tab = resultTabs.find((t) => t.id === id);
      if (tab?.artifactId && artifacts) {
        setSavedItems((s) => [...s, { id: tab.artifactId, ...tabToArtifact(tab, { open: false }) }]);
        artifacts.update(tab.artifactId, { open: false }).catch(() => {});
      }
      setResultTabs((rt) => rt.filter((t) => t.id !== id));
    }
    if (activeTabId === id) switchTabTo("reader");
  }

  function openCommunityTab(id) {
    setCommunityTabsOpen((c) => (c.includes(id) ? c : [...c, id]));
    setActiveTabId(id);
    setFormTool(null);
    setSelection(null);
    setGenMenuOpen(false);
  }

  function handleToolPick(t) {
    if (t.community || t.id === "ask") {
      openCommunityTab(t.id);
    } else {
      setFormTool(t.id);
      setPrefillFocus("");
    }
  }

  // Opened from a link naming a study tool: its form shows, once.
  const initialToolDone = useRef(false);
  useEffect(() => {
    if (!initialTool || initialToolDone.current) return;
    if (!TOOL_DEFS.some((t) => t.id === initialTool && !t.community && !t.needsAsk)) return;
    initialToolDone.current = true;
    openForm(initialTool);
  }, [initialTool]);   // eslint-disable-line react-hooks/exhaustive-deps

  function openForm(toolId, focus = "") {
    setActiveTabId("reader");
    setFormTool(toolId);
    setPrefillFocus(focus);
    setSelection(null);
    setGenMenuOpen(true);
  }

  /* Server result → the tab's content, with citations in the reader's jump
     shape (0-based page + box, or a moment). */
  function toTabContent(toolId, r) {
    const cite = (c) => (c ? { ...toReaderCite(c), quote: c.quote } : null);
    if (toolId === "summary") return { summaryPoints: (r.summaryPoints || []).map((p) => ({ text: p.text, cite: cite(p.cite) })) };
    if (toolId === "quiz") {
      const quizQuestions = (r.quizQuestions || []).map((q) => ({ ...q, cite: cite(q.cite) }));
      return { quizQuestions, quizAnswers: quizQuestions.map(() => ({ selected: null, checked: false, dontKnow: false })) };
    }
    return { cardSet: (r.cardSet || []).map((c) => ({ ...c, cite: cite(c.cite) })) };
  }

  function openResultTab(toolId, values, createdPage, content) {
    const tdef = toolById(toolId);
    const focusLabel = (values.focus && values.focus.trim())
      || (values.scope === "Whole document" ? "Whole document" : `Page ${createdPage + 1}`);
    const id = "r" + nextResultId.current++;
    const tab = {
      id, toolId, values, createdPage,
      title: `${tdef.label} · ${focusLabel.length > 22 ? focusLabel.slice(0, 22) + "…" : focusLabel}`,
      cardIndex: 0, flipped: false, quizIndex: 0, quizHint: null, topic: docTitle,
      ...content,
    };
    setResultTabs((rt) => [...rt, tab]);
    persistNewTab(tab);
    setFormTool(null);
    setActiveTabId(id);
    setGenMenuOpen(false);
  }

  function handleFormSubmit(values, done, fail) {
    const toolId = formTool;
    // A real podcast episode: the server makes the saved item at once
    // ("making") and fills it in a minute or two — the tab opens now and
    // polls; the learner keeps reading meanwhile.
    if (isServerPodcast(tools, toolId)) {
      const createdPage = currentPage;
      const { scope, ...podcastValues } = values;
      tools.podcast.start({
        scope: scope === "Whole document" ? "document" : "page",
        pageNumber: createdPage + 1,
        pageText: pages[createdPage]?.text || "",
        values: podcastValues,
      }).then((a) => {
        if (!a?.id) throw new Error("Couldn't start the episode — try again.");
        const tab = artifactToTab(a, "r" + nextResultId.current++);
        setResultTabs((rt) => [...rt, tab]);
        setFormTool(null);
        setActiveTabId(tab.id);
        setGenMenuOpen(false);
        done();
      }).catch((e) => fail?.(e?.message || "Couldn't start the episode — try again."));
      return;
    }
    // Real generation (library records): grounded in the document, every
    // item cited. The form shows "Building…" until it lands.
    if (tools && SERVER_TOOLS.has(toolId)) {
      const createdPage = currentPage;
      const { scope, ...toolValues } = values;
      tools.generate(toolId, {
        scope: scope === "Whole document" ? "document" : "page",
        pageNumber: createdPage + 1,
        pageText: pages[createdPage]?.text || "",
        values: toolValues,
      }).then((r) => {
        openResultTab(toolId, values, createdPage, toTabContent(toolId, r));
        done();
      }).catch((e) => fail?.(e?.message || "Couldn't build that — try again."));
      return;
    }
    // Derive the result from the page's real text up front, so the content
    // is stable for the life of the tab (Fortizo stored its mock the same way).
    const derived = deriveToolContent(toolId, { pages, createdPage: currentPage, values, topic: docTitle, subject: sourceName, pageBlocks });
    setTimeout(() => {
      const tdef = toolById(toolId);
      const focusLabel = (values.focus && values.focus.trim()) || `Page ${currentPage + 1}`;
      const id = "r" + nextResultId.current++;
      const tab = {
        id, toolId, values, createdPage: currentPage,
        title: `${tdef.label} · ${focusLabel.length > 22 ? focusLabel.slice(0, 22) + "…" : focusLabel}`,
        cardIndex: 0, flipped: false,
        quizIndex: 0, quizHint: null,
        topic: docTitle,
        ...derived,
      };
      setResultTabs((rt) => [...rt, tab]);
      persistNewTab(tab);
      setFormTool(null);
      setActiveTabId(id);
      setGenMenuOpen(false);
      done();
    }, 600);
  }

  /* ── Saved items (artifacts): load, save new, autosave edits ─────────── */
  const lastSavedRef = useRef(new Map());   // artifactId → JSON of what the server has
  const pendingRef = useRef(new Map());     // artifactId → { timer, body }

  useEffect(() => {
    if (!artifacts) return undefined;
    let alive = true;
    artifacts.list().then((list) => {
      if (!alive) return;
      const open = [];
      const closed = [];
      for (const a of list || []) if (TAB_KINDS.has(a.kind)) (a.open ? open : closed).push(a);
      // A tab made in Agent Chat opens even if the learner closed it since.
      const wanted = initialArtifactId ? closed.find((a) => a.id === initialArtifactId) : null;
      if (wanted) { closed.splice(closed.indexOf(wanted), 1); open.push(wanted); }
      const tabs = open.map((a) => artifactToTab(a, "r" + nextResultId.current++));
      tabs.forEach((t) => lastSavedRef.current.set(t.artifactId, JSON.stringify(tabContentPatch(t))));
      setResultTabs((rt) => [...tabs, ...rt]);
      const focus = initialArtifactId ? tabs.find((t) => t.artifactId === initialArtifactId) : null;
      if (focus) setActiveTabId(focus.id);
      setSavedItems(closed);
      const marks = marksFromArtifacts(list);
      setAnnotations((x) => [...marks.annotations, ...x]);
      setRedactions((x) => [...marks.redactions, ...x]);
    }).catch(() => { /* saved items are a convenience — the reader still works */ });
    return () => { alive = false; };
  }, [artifacts]);

  // Edits (notes typing, quiz answers, card position) save ~0.8 s after the
  // learner pauses; whatever is pending is flushed when the reader closes.
  useEffect(() => {
    if (!artifacts) return;
    for (const tab of resultTabs) {
      if (!tab.artifactId || tab.podcast) continue;   // a server-made podcast: the server owns its content
      const body = JSON.stringify(tabContentPatch(tab));
      if (!lastSavedRef.current.has(tab.artifactId)) { lastSavedRef.current.set(tab.artifactId, body); continue; }
      if (lastSavedRef.current.get(tab.artifactId) === body) continue;
      const prev = pendingRef.current.get(tab.artifactId);
      if (prev) clearTimeout(prev.timer);
      const timer = setTimeout(() => {
        pendingRef.current.delete(tab.artifactId);
        lastSavedRef.current.set(tab.artifactId, body);
        artifacts.update(tab.artifactId, JSON.parse(body)).catch(() => {});
      }, 800);
      pendingRef.current.set(tab.artifactId, { timer, body });
    }
  }, [resultTabs, artifacts]);

  useEffect(() => () => {
    for (const [artifactId, { timer, body }] of pendingRef.current) {
      clearTimeout(timer);
      artifacts?.update(artifactId, JSON.parse(body)).catch(() => {});
    }
    pendingRef.current.clear();
  }, [artifacts]);

  /** A new tab is saved as it opens; its artifact id lands on the tab. */
  function persistNewTab(tab) {
    // Podcasts are saved by the server (a preview outline isn't kept).
    if (!artifacts || !TAB_KINDS.has(tab.toolId) || tab.toolId === "podcast") return;
    artifacts.save(tabToArtifact(tab)).then((a) => {
      if (!a?.id) return;
      lastSavedRef.current.set(a.id, JSON.stringify(tabContentPatch(tab)));
      setResultTabs((rt) => rt.map((t) => (t.id === tab.id ? { ...t, artifactId: a.id } : t)));
    }).catch(() => { /* unsaved: the tab still works for this visit */ });
  }

  /* Episodes being made: poll each until it's ready or failed. */
  const makingIds = resultTabs
    .filter((t) => t.toolId === "podcast" && t.podcast?.status === "making" && t.artifactId)
    .map((t) => t.artifactId).join(",");
  useEffect(() => {
    if (!makingIds || !tools?.podcast) return undefined;
    let alive = true;
    const poll = () => makingIds.split(",").forEach((id) => {
      tools.podcast.get(id).then((a) => {
        const podcast = a?.content?.podcast;
        if (!alive || !podcast || podcast.status === "making") return;
        setResultTabs((rt) => rt.map((t) => (t.artifactId === id ? { ...t, podcast } : t)));
      }).catch(() => { /* a hiccup — the next poll tries again */ });
    });
    const timer = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [makingIds, tools]);

  /* A failed episode: drop it and reopen the form with the same focus. */
  function retryPodcast(tab) {
    setResultTabs((rt) => rt.filter((t) => t.id !== tab.id));
    if (tab.artifactId) {
      lastSavedRef.current.delete(tab.artifactId);
      artifacts?.remove(tab.artifactId).catch(() => {});
    }
    openForm("podcast", tab.values?.focus || "");
  }

  function openSavedItem(a) {
    const tab = artifactToTab(a, "r" + nextResultId.current++);
    lastSavedRef.current.set(a.id, JSON.stringify(tabContentPatch(tab)));
    setResultTabs((rt) => [...rt, tab]);
    setSavedItems((s) => s.filter((x) => x.id !== a.id));
    setFormTool(null);
    setActiveTabId(tab.id);
    setGenMenuOpen(false);
    artifacts?.update(a.id, { open: true }).catch(() => {});
  }

  function deleteSavedItem(a) {
    setSavedItems((s) => s.filter((x) => x.id !== a.id));
    lastSavedRef.current.delete(a.id);
    artifacts?.remove(a.id).catch(() => {});
  }

  function updateResultTab(id, patch) {
    setResultTabs((rt) => rt.map((t) => (t.id === id ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)));
  }

  const activeResultTab = resultTabs.find((t) => t.id === activeTabId);

  /* Citations: jump the reader to the source page and flash the cited line. */
  function citeJump(cite) {
    if (!cite) return;
    setGenMenuOpen(false);
    setActiveTabId("reader");
    // A recording citation: seek the player to the moment.
    if (Number.isFinite(cite.startMs) && !Number.isInteger(cite.page)) {
      playerApi?.seekTo?.(cite.startMs / 1000);
      return;
    }
    requestAnimationFrame(() => {
      goToPage(Math.min(cite.page, pages.length - 1));
      setTimeout(() => {
        // Word / PowerPoint pages: the citation's box is [0, i, 1000, i+1] —
        // i names the paragraph the page rendered with data-block="i".
        const hasBox = Array.isArray(cite.bbox) && cite.bbox.length === 4;
        const block = hasBox
          ? viewerRef.current?.querySelector(`[data-page-index="${cite.page}"] [data-block="${Number(cite.bbox[1])}"]`)
          : null;
        if (block) block.scrollIntoView?.({ block: "center", behavior: "smooth" });
        const target = block
          || viewerRef.current?.querySelector(`[data-page-index="${cite.page}"] [data-cite="${cite.dataCite}"]`)
          || viewerRef.current?.querySelector(`[data-page-index="${cite.page}"]`);
        if (target) {
          target.classList.remove("cite-flash");
          void target.offsetWidth; // restart the animation if clicked again
          target.classList.add("cite-flash");
          setTimeout(() => target.classList.remove("cite-flash"), 2300);
        }
        // PDF pages: the citation carries the extraction block's bbox —
        // flash THAT region on the page, not the whole sheet.
        if (hasBox && !block) {
          // Over the page's content (not its padded frame), so the box lands on the words.
          const pageDiv = viewerRef.current?.querySelector(`[data-page-index="${cite.page}"] [data-page-content]`)
            || viewerRef.current?.querySelector(`[data-page-index="${cite.page}"]`);
          if (pageDiv) {
            const [x1, y1, x2, y2] = cite.bbox;
            const box = document.createElement("div");
            box.className = "cite-bbox-flash";
            box.style.left = `${Math.max(0, x1) / 10}%`;
            box.style.top = `${Math.max(0, y1) / 10}%`;
            box.style.width = `${Math.max(0.5, (x2 - x1) / 10)}%`;
            box.style.height = `${Math.max(0.5, (y2 - y1) / 10)}%`;
            pageDiv.appendChild(box);
            setTimeout(() => box.remove(), 2400);
          }
        }
      }, 450);
    });
  }

  // A citation chip in the session chat asked for a jump (the reader may
  // have just opened for it — citeJump waits for the page to lay out).
  useEffect(() => {
    if (jumpTo?.cite) citeJump(jumpTo.cite);
  }, [jumpTo?.key]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* text selection popover */
  const closestPage = (node) => {
    if (!node) return null;
    const el = node.nodeType === 1 ? node : node.parentElement;
    return el ? el.closest("[data-page-index]") : null;
  };

  const showSelectionMenu = useCallback(() => {
    if (activeTabId !== "reader") return setSelection(null);
    if (selectingRef.current) return;   // mid-drag — wait for pointerup so the menu never covers the drag
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return setSelection(null);
    const text = sel.toString().trim();
    if (!text) return setSelection(null);
    if (!closestPage(sel.anchorNode) || !closestPage(sel.focusNode)) return setSelection(null);
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return setSelection(null);
    const pageEl = closestPage(sel.anchorNode);
    const pageIndex = Number(pageEl?.dataset?.pageIndex);
    // Where the selection sits on the page content (percent boxes) — how a
    // mark is drawn back over a PDF canvas or an image.
    const contentEl = pageEl?.querySelector("[data-page-content]");
    const rects = contentEl && closestPage(sel.focusNode) === pageEl
      ? selectionRects(sel.getRangeAt(0).getClientRects(), contentEl.getBoundingClientRect())
      : [];
    setSelection({ text, pageIndex: Number.isInteger(pageIndex) ? pageIndex : null, rects, rect: { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width } });
  }, [activeTabId]);

  useLayoutEffect(() => {
    if (!selection || !selMenuRef.current) { setSelPos(null); return; }
    const menuRect = selMenuRef.current.getBoundingClientRect();
    const margin = 8;
    // Keep the menu clear of the finger: a real gap on touch (the selection
    // handles and the thumb sit right at the selection's edge), tight on
    // desktop. It follows the selection as it changes, and flips above the
    // text when it would run off the bottom of the screen.
    const gap = isMobile ? 40 : 12;
    let left = selection.rect.left + selection.rect.width / 2 - menuRect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));
    let top = selection.rect.bottom + gap;
    if (top + menuRect.height > window.innerHeight - margin) top = selection.rect.top - menuRect.height - gap;
    if (top < margin) top = selection.rect.bottom + gap;
    setSelPos({ left, top });
  }, [selection, isMobile]);

  useEffect(() => {
    let t;
    const onSelChange = () => { clearTimeout(t); t = setTimeout(showSelectionMenu, 80); };
    const onMouseDown = (e) => { if (!selMenuRef.current?.contains(e.target) && !closestPage(e.target)) setSelection(null); };
    const onPointerDown = () => { selectingRef.current = true; };
    const onPointerUp = () => { selectingRef.current = false; showSelectionMenu(); };
    document.addEventListener("selectionchange", onSelChange);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("touchstart", onMouseDown, { passive: true });
    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("pointerup", onPointerUp, { passive: true });
    document.addEventListener("pointercancel", onPointerUp, { passive: true });
    return () => {
      clearTimeout(t);
      document.removeEventListener("selectionchange", onSelChange);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("touchstart", onMouseDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
    };
  }, [showSelectionMenu]);

  function handleSelectionAction(action) {
    const text = selection?.text || "";
    const truncated = text.length > 100 ? text.slice(0, 100) + "…" : text;

    if (action === "ask") {
      // The whole selection (not the 100-char preview) rides the question,
      // with its page, so the answer is grounded in THAT passage.
      setAskPin({ ...(Number.isInteger(selection?.pageIndex) ? { pageNumber: selection.pageIndex + 1 } : {}), text: text.slice(0, 1500) });
      setSelection(null);
      try { window.getSelection().removeAllRanges(); } catch {}
      openCommunityTab("ask");
      return;
    }
    const page = Number.isInteger(selection?.pageIndex) ? selection.pageIndex : currentPage;
    const rects = selection?.rects || [];
    if (action === "redact") {
      const red = { id: "red-" + Date.now(), page, text, rects };
      setRedactions((r) => [...r, red]);
      artifacts?.save({ kind: "redaction", pageNumber: page + 1, content: { text: text.slice(0, 2000), rects } })
        .then((a) => a?.id && setRedactions((list) => list.map((x) => (x.id === red.id ? { ...x, artifactId: a.id } : x))))
        .catch(() => {});
      setSelection(null);
      try { window.getSelection().removeAllRanges(); } catch {}
      return;
    }
    if (action === "annotate") {
      setAnnotateDraft({ text, rect: selection.rect, page, rects });
      setAnnotateText("");
      setSelection(null);
      return;
    }

    setSelection(null);
    try { window.getSelection().removeAllRanges(); } catch {}
    if (action === "explain") {
      // "Explain" hands the selection to the live session's tutor — on mobile
      // the reader steps aside so the chat (and the prefilled input) is visible.
      // The whole passage (capped in lib/quotedMessage.js) and its page.
      onExplainSelection?.(text, { pageNumber: Number.isInteger(selection?.pageIndex) ? selection.pageIndex + 1 : null });
    } else {
      openForm(action, truncated);
    }
  }

  const allTabs = [{ id: "reader" }, ...communityTabsOpen.map((id) => ({ id })), ...resultTabs];

  function PillsBar({ tabs, showChatButton }) {
    return (
      <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-3 flex-shrink-0">
        <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {tabs.map((t) => (
            <TabPill key={t.id} tab={t} active={t.id === activeTabId} onSelect={() => switchTabTo(t.id)} onClose={() => closeTab(t.id)}/>
          ))}
        </div>
        {showChatButton && (
          <button
            type="button"
            onClick={onOpenChat}
            title="Back to the session chat"
            aria-label="Back to the session chat"
            className="folio-btn-outline flex-shrink-0 w-7 h-7 rounded-full border flex items-center justify-center"
          >
            <Icon name="ti-message-circle" size={14}/>
          </button>
        )}
      </div>
    );
  }

  const safeTop = "env(safe-area-inset-top, 0px)";

  return (
    <div
      className="sreader fixed inset-0 flex overflow-hidden"
      style={{ zIndex: 3100, background: "var(--ak-bg)", animation: "sheet-up .32s cubic-bezier(.32,1.1,.64,1)" }}
    >
      <style>{READER_CSS}</style>

      {/* ============ READER + TOOLS column — one merged column on every
           breakpoint, exactly Fortizo's structure. ============ */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">

        {/* Slim reader header — the modal's counterpart of Fortizo's app shell. */}
        <div className="flex items-center justify-between gap-3 flex-shrink-0 border-b"
          style={{ borderColor: "var(--ak-border)", padding: `calc(${safeTop} + 10px) 14px 10px` }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(108,59,255,.18)", border: "1px solid rgba(108,59,255,.35)" }}>
              <Icon name="ti-book-2" size={16} color="var(--ak-accent)"/>
            </span>
            <div className="min-w-0">
              <div className="text-sm font-extrabold truncate" style={{ color: "var(--ak-text)" }}>{docTitle}</div>
              <div className="flex items-center gap-1.5 min-w-0">
                <Icon name="ti-file-text" size={10} color="var(--ak-text-sub)"/>
                <span className="text-[10.5px] font-semibold truncate" style={{ color: "var(--ak-text-sub)" }}>{sourceName}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title={split ? "Close the reader" : "Back to the session chat"}
            aria-label={split ? "Close the reader" : "Back to the session chat"}
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "var(--ak-tag-bg)" }}
          >
            <Icon name="ti-x" size={15} color="var(--ak-text-sub)"/>
          </button>
        </div>

        {/* Tab strip. First tab is the document itself. */}
        <div className="flex-shrink-0 border-b" style={{ borderColor: "var(--ak-border)", background: "var(--ak-tag-bg)" }}>
          <PillsBar tabs={allTabs} showChatButton={isMobile}/>
        </div>

        {/* Reader pane — kept mounted (just hidden) when a tool tab is active,
            so scroll position and zoom survive switching back. Media records
            swap the pages for the player (audio keeps playing while a tool
            tab is open — notes over a recorded lesson). */}
        <div className="flex-col min-h-0 flex-1" style={{ display: activeTabId === "reader" ? "flex" : "none" }}>
          <div className="sreader-bg flex-shrink-0 flex items-center gap-2 md:gap-3.5 px-2.5 md:px-4 border-b" style={{ height: "3.25rem", borderColor: "var(--ak-border)" }}>
            {isMedia ? (
              /* ── Record transport — same toolbar, playback controls ── */
              <div className="flex items-center gap-1.5 mr-auto min-w-0">
                <button onClick={() => playerApi?.skip(-10)} title="Back 10 seconds" aria-label="Back 10 seconds"
                  className="folio-btn-outline w-7 h-7 rounded border flex items-center justify-center">
                  <Icon name="ti-player-track-prev" size={14}/>
                </button>
                <button onClick={() => playerApi?.toggle()} title={playerState.playing ? "Pause" : "Play"} aria-label={playerState.playing ? "Pause" : "Play"}
                  className="folio-icon-btn w-8 h-8 rounded flex items-center justify-center"
                  style={{ background: BRAND, color: "#fff" }}>
                  <Icon name={playerState.playing ? "ti-player-pause" : "ti-player-play"} size={16}/>
                </button>
                <button onClick={() => playerApi?.skip(10)} title="Forward 10 seconds" aria-label="Forward 10 seconds"
                  className="folio-btn-outline w-7 h-7 rounded border flex items-center justify-center">
                  <Icon name="ti-player-track-next" size={14}/>
                </button>
                <span className="font-ui-mono text-xs whitespace-nowrap" style={{ color: "var(--ak-text-sub)" }}>
                  {mediaTime(playerState.time)} / {mediaTime(playerState.duration)}
                </span>
              </div>
            ) : (
            <div className="flex items-center gap-1.5 mr-auto">
              <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 0} className="folio-btn-outline w-7 h-7 rounded border flex items-center justify-center disabled:opacity-35">
                <Icon name="ti-chevron-up" size={15}/>
              </button>
              <span className="font-ui-mono text-xs md:text-sm flex items-center gap-0.5 whitespace-nowrap" style={{ color: "var(--ak-text-sub)" }}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={pageNumDraft}
                  onChange={(e) => setPageNumDraft(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => e.key === "Enter" && (commitPageNumDraft(), e.target.blur())}
                  onBlur={commitPageNumDraft}
                  className="w-6 bg-transparent text-right outline-none rounded"
                  style={{ color: "var(--ak-text)" }}
                />
                <span> / {pages.length}</span>
              </span>
              <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === pages.length - 1} className="folio-btn-outline w-7 h-7 rounded border flex items-center justify-center disabled:opacity-35">
                <Icon name="ti-chevron-down" size={15}/>
              </button>
            </div>
            )}

            {/* Speed — the record viewer's reason for a shared toolbar:
                slow a lesson down to take notes, speed it up to revise. */}
            {isMedia && (
              <button onClick={() => playerApi?.cycleRate(1)}
                title="Playback speed" aria-label={`Playback speed ${playerState.rate} times`}
                className="folio-btn-outline h-7 rounded border flex items-center justify-center px-2.5 gap-1 whitespace-nowrap">
                <Icon name="ti-clock-bolt" size={13}/>
                <span className="font-ui-mono text-xs font-bold" style={{ color: "var(--ak-text)" }}>
                  {playerState.rate}×
                </span>
              </button>
            )}

            {!isMedia && (
            <div className="hidden md:flex items-center gap-1">
              <button onClick={() => zoomTo((z) => z - 0.1)} className="folio-btn-outline w-6 h-6 rounded border flex items-center justify-center">
                <Icon name="ti-minus" size={13}/>
              </button>
              <span className="font-ui-mono text-xs w-9 text-center" style={{ color: "var(--ak-text-sub)" }}>{Math.round(zoom * 100)}%</span>
              <button onClick={() => zoomTo((z) => z + 0.1)} className="folio-btn-outline w-6 h-6 rounded border flex items-center justify-center">
                <Icon name="ti-plus" size={13}/>
              </button>
            </div>
            )}
            {!isMedia && isMobile && (
              <div className="flex items-center gap-0.5">
                <button onClick={() => zoomTo((z) => z - 0.1)} className="folio-btn-outline w-6 h-6 rounded border flex items-center justify-center">
                  <Icon name="ti-minus" size={12}/>
                </button>
                <span className="font-ui-mono text-xs w-7 text-center" style={{ color: "var(--ak-text-sub)" }}>{Math.round(zoom * 100)}%</span>
                <button onClick={() => zoomTo((z) => z + 0.1)} className="folio-btn-outline w-6 h-6 rounded border flex items-center justify-center">
                  <Icon name="ti-plus" size={12}/>
                </button>
              </div>
            )}

            <button
              onClick={() => (isMedia ? playerApi?.toggle() : setIsPlaying((p) => !p))}
              className="folio-icon-btn w-7 h-7 rounded flex items-center justify-center"
              title={isMedia ? (playerState.playing ? "Pause" : "Play") : "Listen to this page (audio coming soon)"}
            >
              <Icon name={(isMedia ? playerState.playing : isPlaying) ? "ti-player-pause" : "ti-player-play"} size={15}/>
            </button>

            {/* Generate — the way to spawn a new tool tab, same on every breakpoint. */}
            <div className="relative" ref={genMenuRef}>
              <button
                onClick={() => setGenMenuOpen((o) => !o)}
                className={`folio-icon-btn w-7 h-7 rounded flex items-center justify-center ${genMenuOpen ? "bg-black/10" : ""}`}
                title="Generate a study tool"
              >
                <Icon name="ti-layout-grid" size={15}/>
              </button>
              {genMenuOpen && (
                <div className="sreader-menu absolute right-0 top-full mt-2 w-72 rounded-lg z-50 overflow-hidden" style={{ maxHeight: "70vh", overflowY: "auto" }}>
                  {formTool ? (
                    <div className="p-3">
                      <CreationForm key={formTool} toolId={formTool} initialFocus={prefillFocus} onBack={() => setFormTool(null)} onSubmit={handleFormSubmit} withScope={!!tools && (SERVER_TOOLS.has(formTool) || isServerPodcast(tools, formTool))}/>
                    </div>
                  ) : (
                    <GenerateGrid onPick={handleToolPick} discussion={discussion} askEnabled={!!ask}
                      saved={artifacts ? { items: savedItems, onOpen: openSavedItem, onDelete: deleteSavedItem } : null}/>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 relative overflow-hidden">
            {isMedia ? (
              /* The record itself — original bytes, presigned URL, range seeks —
                 with its transcript underneath (click a line, land on the moment). */
              <div className="h-full flex flex-col">
                <div className="flex-shrink-0">
                  <MediaPlayer
                    kind={media.kind}
                    src={media.src}
                    title={media.title || docTitle}
                    startAt={media.startAt}
                    onReady={setPlayerApi}
                    onState={setPlayerState}
                    onPosition={media.onPosition}
                    onTimeUpdate={media.onTimeUpdate}
                    downloadUrl={media.downloadUrl}
                    downloadName={media.downloadName}
                  />
                </div>
                {onTranscribe && !transcript?.segments?.length && (
                  /* No transcript yet — one honest row: what it does, what
                     it costs (a shared job, so at most once per video). */
                  <div className="flex-shrink-0 px-3 md:px-5 py-2.5 border-t" style={{ borderColor: "var(--ak-border)", background: "var(--ak-surface)" }}>
                    <button type="button" onClick={onTranscribe} disabled={transcribeState === "running"}
                      className="w-full text-left rounded-xl px-3.5 py-2.5 border transition-opacity"
                      style={{ borderColor: transcribeState === "failed" ? "#FCA5A5" : "var(--ak-border2)",
                               background: "var(--ak-surface)", opacity: transcribeState === "running" ? 0.7 : 1 }}>
                      <span className="text-xs font-bold" style={{ color: transcribeState === "failed" ? "#DC2626" : "var(--ak-text)" }}>
                        {transcribeState === "running"
                          ? "Transcribing the audio — this runs once for everyone, you can keep watching…"
                          : transcribeState === "failed"
                            ? "Transcription didn't finish — tap to try again"
                            : "Transcribe this video — let your agent hear it too"}
                      </span>
                      {transcribeState !== "running" && (
                        <span className="block text-[11px] font-semibold mt-0.5" style={{ color: "var(--ak-text-sub)" }}>
                          {transcribeState === "failed" ? (transcribeError || "Something interrupted the job.")
                            : "Speech becomes a clickable, searchable, groundable transcript."}
                        </span>
                      )}
                    </button>
                  </div>
                )}
                {transcript?.segments?.length > 0 && (
                  <div className="flex-1 min-h-0 overflow-y-auto px-3 md:px-5 py-3" style={{ background: "var(--ak-bg)" }}>
                    <div className="text-xs font-semibold mb-2" style={{ color: "var(--ak-text-sub)" }}>
                      Transcript · {transcript.segments.length} segment{transcript.segments.length === 1 ? "" : "s"} — tap a line to jump there
                    </div>
                    {transcript.segments.map((s, i) => {
                      const mmss = (ms) => {
                        const t = Math.floor((ms || 0) / 1000);
                        return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
                      };
                      return (
                        <button key={i} type="button"
                          onClick={() => playerApi?.seekTo?.((s.startMs || 0) / 1000)}
                          className="w-full text-left rounded-lg px-3 py-2 mb-1.5 border transition-colors"
                          style={{ borderColor: "var(--ak-border2)", background: "var(--ak-surface)" }}>
                          <span className="font-ui-mono text-[10px] font-bold mr-2" style={{ color: "var(--ak-accent)" }}>{mmss(s.startMs)}</span>
                          {s.speaker && <span className="text-[10px] font-black mr-2" style={{ color: "var(--ak-text-sub)" }}>{s.speaker}</span>}
                          {s.kind === "visual" && <span className="text-[10px] font-black mr-2" style={{ color: "#D97706" }}>SLIDE</span>}
                          <span className="text-xs leading-relaxed" style={{ color: "var(--ak-text)" }}>{s.text}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
            <div ref={viewerRef} onClick={handleViewerClick}
              className={`pdf-scroll h-full overflow-auto flex flex-col items-center ${rawPages ? "px-1.5 md:px-3 pt-2 md:pt-3 pb-8" : "px-3 md:px-6 pt-9 pb-16"}`}
              style={{ background: "var(--ak-bg)", alignItems: zoom > 1 ? "flex-start" : "center" }}>
              {pages.map((p, i) => (
                <div
                  key={i}
                  data-page-index={i}
                  style={{ width: `${Math.round(zoom * 100)}%` }}
                  className={`doc-page relative w-full shadow-lg ${rawPages
                    // A finished PDF page brings its own margins — render it
                    // flush: no inner padding, no width cap, a tight gap so
                    // the stack reads as one continuous document.
                    ? "mb-1.5"
                    : "md:max-w-2xl mb-5 px-5 py-9 md:px-14 md:py-14"}`}
                >
                  {/* The opener's renderer wins; a page it doesn't draw
                      (returns null) falls back to the page's own HTML.
                      Drawn pages (canvases, images) get their annotations
                      and hidden passages as boxes over the selection. */}
                  {(() => {
                    const drawn = renderPageContent && renderPageContent(i);
                    if (!drawn) return <div data-page-content="" dangerouslySetInnerHTML={{ __html: buildPageHtml(p.html, i) }}/>;
                    return (
                      <div data-page-content="" style={{ position: "relative" }}>
                        {drawn}
                        {annotations.filter((a) => a.page === i && a.rects?.length).flatMap((a) => a.rects.map((r, k) => (
                          <div key={`${a.id}-${k}`} className="folio-annotation folio-mark-box" data-ann-id={a.id} title={a.note}
                            style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}/>
                        )))}
                        {redactions.filter((r) => r.page === i && r.rects?.length).flatMap((r) => r.rects.map((b, k) => (
                          <div key={`${r.id}-${k}`} className={`folio-redaction folio-mark-box${revealedRedactions.has(r.id) ? " revealed" : ""}`} data-red-id={r.id}
                            title={revealedRedactions.has(r.id) ? "Tap to hide again" : "Hidden — tap to reveal"}
                            style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}/>
                        )))}
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
            )}
          </div>

          <div className="sreader-bg hidden md:flex flex-shrink-0 items-center gap-2.5 px-4 py-2.5 border-t overflow-x-auto" style={{ borderColor: "var(--ak-border)", display: isMedia ? "none" : undefined }}>
            {pages.map((_, i) => (
              <button
                key={i}
                onClick={() => goToPage(i)}
                className={`folio-thumb flex-shrink-0 w-11 h-14 rounded border flex items-center justify-center font-ui-mono text-xs ${i === currentPage ? "active" : ""}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>

        {/* Community panes — persistent boards, not generated. */}
        {activeTabId === "qa" && (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4" style={{ background: "var(--ak-bg)" }}>
            <CommunityBoard
              title="Q&A"
              subtitle="Ask a question about this material — it stays with this session."
              placeholder="Ask a question…"
              actionLabel="Ask"
              emptyText="No questions yet — be the first to ask."
              threads={qaThreads}
              setThreads={setQaThreads}
            />
          </div>
        )}
        {activeTabId === "discussion" && (
          <div className={discussion?.communities?.length ? "flex-1 min-h-0 px-4 py-4" : "flex-1 min-h-0 overflow-y-auto px-4 py-4"} style={{ background: "var(--ak-bg)" }}>
            {discussion?.communities?.length ? (
              /* Connected: the community's persistent, real-time group
                 chat — owned by the community, open on every content
                 it's connected to. */
              <ReaderDiscussion communities={discussion.communities}/>
            ) : (
              <CommunityBoard
                title="Discussion"
                subtitle="Talk through this material — points, questions, connections."
                placeholder="Start a discussion…"
                actionLabel="Post"
                emptyText="No discussion yet — start the conversation."
                threads={discussionThreads}
                setThreads={setDiscussionThreads}
              />
            )}
          </div>
        )}

        {/* Ask — stays mounted while open, so an answer still streaming
            survives a look at the page it cites. */}
        {ask && communityTabsOpen.includes("ask") && (
          <div className="flex-1 min-h-0 px-4 py-4" style={{ background: "var(--ak-bg)", display: activeTabId === "ask" ? "flex" : "none", flexDirection: "column" }}>
            <ReaderAsk ask={ask} onCite={citeJump} pin={askPin} onPinClear={() => setAskPin(null)}/>
          </div>
        )}

        {/* Result pane — shown when a generated tab (not "Original Content") is active. */}
        {activeTabId !== "reader" && activeTabId !== "qa" && activeTabId !== "discussion" && activeTabId !== "ask" && activeResultTab && (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4" style={{ background: "var(--ak-bg)" }}>
            <ResultView tab={activeResultTab} onUpdate={(patch) => updateResultTab(activeResultTab.id, patch)} onCite={citeJump}
              onRetryPodcast={tools?.podcast ? retryPodcast : null}/>
          </div>
        )}
      </div>

      {/* ============ CHAT — on desktop/tablet the Fortizo split: the live
           learning session is the right column. On mobile the reader is a
           full-screen modal and the session keeps running underneath. ============ */}
      {split && (
        <section className="flex flex-col flex-shrink-0 min-h-0 border-l" style={{ width: 400, maxWidth: "44vw", borderColor: "var(--ak-border)" }}>
          {chatNode}
        </section>
      )}

      {/* ============ SELECTION POPOVER ============ */}
      {selection && (
        <div
          ref={selMenuRef}
          className="flex items-center gap-0.5 rounded-lg p-1 shadow-xl z-50 overflow-x-auto"
          style={{
            position: "fixed",
            left: selPos ? selPos.left : -9999,
            top: selPos ? selPos.top : -9999,
            maxWidth: "calc(100vw - 16px)",
            background: "var(--ak-surface)",
            border: "1px solid var(--ak-border2)",
          }}
        >
          {ask && (
            <button onClick={() => handleSelectionAction("ask")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs hover:bg-black/10 whitespace-nowrap flex-shrink-0" style={{ color: "var(--ak-text)" }}>
              <Icon name="ti-message-question" size={13} color="var(--ak-accent)"/> Ask about this
            </button>
          )}
          <button onClick={() => handleSelectionAction("explain")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs hover:bg-black/10 whitespace-nowrap flex-shrink-0" style={{ color: "var(--ak-text)" }}>
            <Icon name="ti-bulb" size={13} color="var(--ak-accent)"/> Ask the tutor
          </button>
          <div className="w-px h-6 mx-0.5 flex-shrink-0" style={{ background: "var(--ak-tag-bg)" }}/>
          <button onClick={() => handleSelectionAction("quiz")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs hover:bg-black/10 whitespace-nowrap flex-shrink-0" style={{ color: "var(--ak-text)" }}>
            <Icon name="ti-circle-check" size={13} color="var(--ak-accent)"/> Quiz me
          </button>
          <button onClick={() => handleSelectionAction("flashcards")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs hover:bg-black/10 whitespace-nowrap flex-shrink-0" style={{ color: "var(--ak-text)" }}>
            <Icon name="ti-stack" size={13} color="var(--ak-accent)"/> Flashcards
          </button>
          <button onClick={() => handleSelectionAction("notes")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs hover:bg-black/10 whitespace-nowrap flex-shrink-0" style={{ color: "var(--ak-text)" }}>
            <Icon name="ti-pencil" size={13} color="var(--ak-accent)"/> Note
          </button>
          <div className="w-px h-6 mx-0.5 flex-shrink-0" style={{ background: "var(--ak-tag-bg)" }}/>
          <button onClick={() => handleSelectionAction("annotate")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs hover:bg-black/10 whitespace-nowrap flex-shrink-0" style={{ color: "var(--ak-text)" }}>
            <Icon name="ti-highlight" size={13} color={GOLD}/> Annotate
          </button>
          <button onClick={() => handleSelectionAction("redact")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs hover:bg-black/10 whitespace-nowrap flex-shrink-0" style={{ color: "var(--ak-text)" }}>
            <Icon name="ti-eye-off" size={13} color="var(--ak-danger-text)"/> Hide
          </button>
        </div>
      )}

      {/* ============ ANNOTATION: compose a new note ============ */}
      {annotateDraft && (
        <div
          data-annotation-popover
          className="rounded-lg shadow-xl p-3 z-50"
          style={{
            position: "fixed",
            left: Math.max(8, Math.min(annotateDraft.rect.left, window.innerWidth - 296)),
            top: Math.min(annotateDraft.rect.bottom + 10, window.innerHeight - 180),
            width: 288,
            background: "var(--ak-surface)",
            border: "1px solid var(--ak-border2)",
          }}
        >
          <div className="text-xs mb-1.5 truncate" style={{ color: "var(--ak-text-sub)" }}>
            Annotate: "{annotateDraft.text.length > 40 ? annotateDraft.text.slice(0, 40) + "…" : annotateDraft.text}"
          </div>
          <textarea
            autoFocus
            rows={2}
            value={annotateText}
            onChange={(e) => setAnnotateText(e.target.value)}
            placeholder="Add a note…"
            className="folio-form-field w-full border rounded-lg p-2 text-sm resize-none focus:outline-none mb-2"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setAnnotateDraft(null); setAnnotateText(""); }}
              className="folio-btn-outline px-3 py-1.5 rounded-lg border text-xs"
            >
              Cancel
            </button>
            <button type="button" onClick={saveAnnotation} className="folio-primary-btn px-3 py-1.5 rounded-lg text-xs font-bold">
              Save
            </button>
          </div>
        </div>
      )}

      {/* ============ ANNOTATION: view an existing note ============ */}
      {openAnnotation && (
        <div
          data-annotation-popover
          style={{
            position: "fixed",
            left: Math.max(8, Math.min(openAnnotation.left, window.innerWidth - 248)),
            top: Math.min(openAnnotation.top, window.innerHeight - 120),
            width: 240,
            background: "var(--ak-surface)",
            border: "1px solid var(--ak-border2)",
          }}
          className="rounded-lg shadow-xl p-3 z-50"
        >
          <div className="text-xs leading-relaxed mb-2.5" style={{ color: "var(--ak-text)" }}>{openAnnotation.note}</div>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                const gone = annotations.find((x) => x.id === openAnnotation.id);
                if (gone?.artifactId) artifacts?.remove(gone.artifactId).catch(() => {});
                setAnnotations((a) => a.filter((x) => x.id !== openAnnotation.id));
                setOpenAnnotation(null);
              }}
              className="flex items-center gap-1 text-xs hover:opacity-80"
              style={{ color: RED }}
            >
              <Icon name="ti-trash" size={12}/> Remove
            </button>
            <button type="button" onClick={() => setOpenAnnotation(null)} className="text-xs hover:opacity-80" style={{ color: "var(--ak-text-sub)" }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
