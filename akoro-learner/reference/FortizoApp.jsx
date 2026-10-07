import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import {
  Headphones, Video, AlignLeft, CircleCheck, Layers, PenLine, LayoutGrid,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Plus, Minus, Search, Upload, X,
  MessageSquare, Lightbulb, Play, Pause, ArrowUp, Check, Paperclip, FileText,
  Minimize2, Maximize2, HelpCircle, ListOrdered, CornerDownRight, Mic,
  EyeOff, Highlighter, Trash2, MessagesSquare, ThumbsUp,
} from "lucide-react";

/* ============================================================
   STATIC DATA (Fortizo — document viewer + study tools + chat)
   ============================================================ */

const TOOL_DEFS = [
  { id: "podcast", label: "Podcast", Icon: Headphones, bg: "bg-violet-50", fg: "text-violet-600" },
  { id: "video", label: "Video", Icon: Video, bg: "bg-indigo-50", fg: "text-indigo-600" },
  { id: "summary", label: "Summary", Icon: AlignLeft, bg: "bg-blue-50", fg: "text-blue-600" },
  { id: "quiz", label: "Quiz", Icon: CircleCheck, bg: "bg-red-50", fg: "text-red-600" },
  { id: "flashcards", label: "Flashcards", Icon: Layers, bg: "bg-orange-50", fg: "text-orange-600" },
  { id: "notes", label: "Notes", Icon: PenLine, bg: "bg-amber-50", fg: "text-amber-600" },
  { id: "qa", label: "Q&A", Icon: HelpCircle, bg: "bg-sky-50", fg: "text-sky-600", community: true },
  { id: "discussion", label: "Discussion", Icon: MessagesSquare, bg: "bg-fuchsia-50", fg: "text-fuchsia-600", community: true },
];
const toolById = (id) => TOOL_DEFS.find((t) => t.id === id);

const FORM_DEFS = {
  podcast: {
    title: "Podcast", sub: "Turn this page into a short audio episode",
    fields: [
      { id: "focus", label: "Focus (optional)", type: "text", placeholder: "e.g. Levels of organisation" },
      { id: "length", label: "Length", type: "select", options: ["Short · 3–5 min", "Medium · 8–10 min", "Long · 15+ min"] },
    ],
  },
  video: {
    title: "Video", sub: "Generate an illustrated walkthrough",
    fields: [
      { id: "focus", label: "Focus (optional)", type: "text", placeholder: "e.g. cell structure" },
      { id: "style", label: "Style", type: "select", options: ["Whiteboard", "Animated", "Narrated slides"] },
    ],
  },
  summary: {
    title: "Summary", sub: "A quick digest of this page",
    fields: [{ id: "depth", label: "Depth", type: "select", options: ["Brief", "Detailed"] }],
  },
  quiz: {
    title: "Quiz", sub: "Test yourself on this page",
    fields: [
      { id: "focus", label: "Focus (optional)", type: "text", placeholder: "e.g. levels of organisation" },
      { id: "count", label: "Questions", type: "select", options: ["3", "5", "10"] },
      { id: "difficulty", label: "Difficulty", type: "select", options: ["Easy", "Medium", "Hard"] },
    ],
  },
  flashcards: {
    title: "Flashcards", sub: "Key terms from this page",
    fields: [{ id: "count", label: "Number of cards", type: "select", options: ["3", "6", "10"] }],
  },
  notes: {
    title: "Notes", sub: "Start a note for this page",
    fields: [{ id: "focus", label: "Starting point (optional)", type: "text", placeholder: "What do you want to capture?" }],
  },
};

const SUBJECT = "Biology";
const TOPIC = "UTME Syllabus";
const DOC_TITLE = `${SUBJECT} — ${TOPIC}`;

const PAGES = [
  `<div class="text-center mt-24">
     <div class="font-mono text-xs tracking-wide text-emerald-700">STUDY GUIDE</div>
     <h1>Biology</h1>
     <div class="w-14 h-0.5 bg-emerald-600 mx-auto my-6"></div>
     <div class="text-stone-500 text-sm">Prepared for the Unified Tertiary Matriculation Examination<br>Candidate edition · 12 pages</div>
   </div>`,
  `<div class="font-mono text-xs text-stone-400 mb-1.5">SECTION 01</div>
   <h1>General objectives</h1>
   <p>This guide prepares candidates for the Board's examination by testing achievement of the following course objectives. By the end of this syllabus, a candidate should be able to:</p>
   <ol>
     <li>Demonstrate sufficient knowledge of the diversity, interdependence, and unity of life.</li>
     <li>Account for the continuity of life through reproduction, inheritance, and evolution.</li>
     <li>Apply biological principles and concepts to everyday matters affecting living things — individuals, society, the environment, community health, and the economy.</li>
   </ol>
   <h2>How to use this guide</h2>
   <p>Each topic is paired with a set of learning objectives on the facing column. Pick a shortcut from Tools to generate a summary, quiz, or flashcards for any page — or ask the chat on the side.</p>
   <div class="page-foot">2</div>`,
  `<div class="font-mono text-xs text-stone-400 mb-1.5">SECTION 02 · DETAILED SYLLABUS</div>
   <h1>A — Variety of organisms</h1>
   <table>
     <tr><th>Topic</th><th>Objective</th></tr>
     <tr data-cite="var-1"><td><span class="text-emerald-700 font-semibold">1.</span> Living organisms — characteristics; cell structure and the function of cell components.</td>
         <td>Differentiate between living and non-living things; identify the structures of plant and animal cells; analyse the function of each component.</td></tr>
     <tr data-cite="var-2"><td><span class="text-emerald-700 font-semibold">2.</span> Levels of organisation — cell, tissue, organ, and system, from euglena to a full organism.</td>
         <td>Trace the levels of organisation among organisms in logical sequence, from single cell to complete system.</td></tr>
     <tr data-cite="var-3"><td><span class="text-emerald-700 font-semibold">3.</span> Evolution among Monera, Protista, Fungi, and Plantae.</td>
         <td>Analyse the external features of each group; apply that knowledge to demonstrate increasing structural complexity across the lineage.</td></tr>
   </table>
   <div class="page-foot">3</div>`,
  `<div class="font-mono text-xs text-stone-400 mb-1.5">SECTION 02 · DETAILED SYLLABUS</div>
   <h1>B — Evolution &amp; adaptation</h1>
   <table>
     <tr><th>Topic</th><th>Objective</th></tr>
     <tr><td><span class="text-emerald-700 font-semibold">4.</span> Invertebrate and vertebrate animal groups, and their economic importance.</td>
         <td>Trace the advancement of multicellular animals; determine the economic importance of each group.</td></tr>
     <tr><td><span class="text-emerald-700 font-semibold">5.</span> Structural and behavioural adaptations of organisms to their environment.</td>
         <td>Describe how structures, functions, and behaviour adapt organisms to their environment and way of life.</td></tr>
     <tr><td><span class="text-emerald-700 font-semibold">6.</span> Social insect castes and their functions within the colony.</td>
         <td>Differentiate castes within social insect colonies and account for feeding, breeding, and defensive behaviour.</td></tr>
   </table>
   <div class="page-foot">4</div>`,
];

const CARD_SET = [
  { front: "Tissue", back: "A group of similar cells working together to perform a shared function, e.g. epithelial tissue." },
  { front: "Euglena", back: "A single-celled organism used as the classic example of the cell level of organisation." },
  { front: "Organ", back: "A structure made of several tissue types working together, e.g. the onion bulb." },
];

/* ---- community: Q&A and Discussion are NOT generated — they're
   persistent, shared threads (with seeded mock activity) that just
   open straight into a tab with a comment box, same as everyone else
   viewing this document would see. ---- */
const SEED_QA = [
  {
    id: "qa1", author: "Amaka O.", color: "#7c3aed",
    text: "Is the cell always the smallest level, even for viruses?", ts: "2h ago", likes: 3,
    replies: [
      { id: "qa1-r1", author: "AI Tutor", color: "#059669",
        text: "Great question — viruses are actually smaller than cells and sit outside this hierarchy, since most definitions don't classify them as fully living organisms.",
        ts: "2h ago", likes: 5, replies: [] },
    ],
  },
  { id: "qa2", author: "Tunde A.", color: "#2563eb",
    text: "Can someone explain the difference between a tissue and an organ with a simple example?", ts: "1d ago", likes: 1, replies: [] },
];
const SEED_DISCUSSION = [
  {
    id: "d1", author: "Chidinma K.", color: "#d97706",
    text: "Anyone else find the Monera / Protista / Fungi / Plantae sequence confusing? I keep mixing up the order.", ts: "3h ago", likes: 2,
    replies: [
      { id: "d1-r1", author: "Bayo I.", color: "#0891b2",
        text: "I made a quick mnemonic for it — happy to share if it helps!", ts: "2h ago", likes: 4, replies: [] },
    ],
  },
];

const MODELS = [
  { name: "Sonnet 5 Thinking", desc: "Extended reasoning for complex questions" },
  { name: "Sonnet 5", desc: "Balanced for everyday use" },
  { name: "Haiku 4.5", desc: "Fastest responses" },
];



/* ---- simulated citations: which page + row each piece of generated
   content was "sourced" from. Real generation would attach these
   automatically; here they're hand-mapped to the mock content. ---- */
const CITATIONS = {
  cellStructure: { page: 2, dataCite: "var-1" },   // "cell structure and the function of cell components"
  levelsOfOrg: { page: 2, dataCite: "var-2" },      // "Levels of organisation — cell, tissue, organ..."
  evolutionGroups: { page: 2, dataCite: "var-3" },  // "Evolution among Monera, Protista, Fungi, Plantae"
};

const QUIZ_HINTS = {
  simple: "In plain terms: start with the smallest living unit, then see how those units team up into bigger and bigger structures.",
  walk: "Step 1 — start with a single cell. Step 2 — similar cells group into a tissue. Step 3 — tissues combine into an organ. Step 4 — organs work together as a system.",
};

const QUIZ_QUESTIONS = [
  {
    prompt: "Which sequence correctly traces the levels of biological organisation from smallest to largest?",
    cite: CITATIONS.levelsOfOrg,
    options: [
      { key: "A", text: "Organ → Tissue → Cell → System", correct: false },
      { key: "B", text: "Cell → Tissue → Organ → System", correct: true },
      { key: "C", text: "System → Organ → Cell → Tissue", correct: false },
      { key: "D", text: "Tissue → Cell → System → Organ", correct: false },
    ],
  },
  {
    prompt: "What does the study of cell structure mainly help you understand?",
    cite: CITATIONS.cellStructure,
    options: [
      { key: "A", text: "How each cell component supports the cell's function", correct: true },
      { key: "B", text: "How organisms are named scientifically", correct: false },
      { key: "C", text: "How ecosystems recycle nutrients", correct: false },
      { key: "D", text: "How fossils are dated", correct: false },
    ],
  },
  {
    prompt: "Which group of organisms is included when tracing evolution among Monera, Protista, Fungi, and Plantae?",
    cite: CITATIONS.evolutionGroups,
    options: [
      { key: "A", text: "Only single-celled bacteria", correct: false },
      { key: "B", text: "Fungi and Plantae, but not Monera or Protista", correct: false },
      { key: "C", text: "All four kingdoms, showing increasing structural complexity", correct: true },
      { key: "D", text: "Only animals with a backbone", correct: false },
    ],
  },
];

function generateReply(text, currentPage) {
  const t = text.toLowerCase();
  if (t.startsWith("explain:"))
    return `Here's the gist: ${text.slice(8).trim().replace(/^"|"$/g, "")} — this ties back to how organisms are classified by structural complexity on page ${currentPage + 1}. Want me to turn it into flashcards?`;
  if (t.includes("summar"))
    return `On page ${currentPage + 1}, the key idea is the sequence of biological organisation — cell, tissue, organ, system — illustrated with named examples. Try Summary in the Tools panel for the full breakdown.`;
  if (t.includes("quiz"))
    return `Good idea — try Quiz in the Tools panel and fill in a few details to generate one.`;
  if (t.includes("diagram") || t.includes("example"))
    return `Think of it like nested containers: a cell is the smallest working unit, several similar cells form a tissue, several tissues form an organ, and organs work together as a system — like your digestive system.`;
  return `Good question. Based on page ${currentPage + 1}, the main thing to hold onto is how each level of organisation builds on the one before it. Ask me to go deeper on any term, or try a shortcut from Tools.`;
}

/* ============================================================
   GLOBAL CSS
   ============================================================ */

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
.font-display{font-family:'Newsreader',serif;}
.font-ui-mono{font-family:'IBM Plex Mono',monospace;}
.doc-page h1{font-family:'Newsreader',serif;font-size:1.9rem;font-weight:600;margin:0 0 0.4rem;letter-spacing:-0.01em;color:#1c1917;}
.doc-page h2{font-family:'Newsreader',serif;font-size:1.2rem;font-weight:600;margin:1.6rem 0 0.6rem;padding-bottom:0.5rem;border-bottom:1px solid #e7e5e4;color:#1c1917;}
.doc-page p{font-family:'Newsreader',serif;font-size:0.98rem;line-height:1.7;margin:0 0 0.9rem;color:#33403a;}
.doc-page ol,.doc-page ul{font-family:'Newsreader',serif;margin:0 0 0.9rem;padding-left:1.4rem;}
.doc-page li{font-size:0.96rem;line-height:1.65;margin-bottom:0.45rem;color:#33403a;}
.doc-page table{width:100%;border-collapse:collapse;margin-top:0.4rem;font-family:'IBM Plex Sans',sans-serif;}
.doc-page th{text-align:left;font-weight:600;font-size:0.72rem;color:#78716c;padding:0 0.6rem 0.5rem 0;border-bottom:1px solid #e7e5e4;}
.doc-page td{vertical-align:top;padding:0.75rem 0.75rem 0.75rem 0;border-bottom:1px solid #e7e5e4;font-size:0.9rem;line-height:1.55;color:#33403a;}
.doc-page td:first-child{width:42%;}
.doc-page .page-foot{position:absolute;bottom:24px;left:0;right:0;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:0.7rem;color:#a8a29e;}

:root{
  --paper:#FAF8F2;--paper-edge:#EFEBDD;--paper-line:#E1DCC9;
  --ink-text:#1C241E;--ink-950:#0F1E17;--muted:#6E7A70;--muted-light:#9AA69B;
  --moss:#5C8A5F;--moss-deep:#3E6B45;--moss-tint:#E4ECE1;
}
.folio-app{background:var(--paper);}
.folio-viewer-bg{background:var(--paper);}
.folio-tab-pill{background:var(--paper-edge);border-color:transparent;color:var(--muted);}
.folio-tab-pill:hover{color:var(--ink-text);}
.folio-tab-pill.active{background:var(--moss-tint);border-color:var(--moss);color:var(--moss-deep);font-weight:500;}
.folio-composer{background:var(--paper-edge);border-color:var(--paper-line);}
.folio-composer-input::placeholder{color:var(--muted-light);}
.folio-composer-btn{background:#fff;color:var(--ink-text);}
.folio-composer-btn:hover{background:var(--moss-tint);color:var(--moss-deep);}
.folio-composer-send{background:#fff;border-color:var(--ink-text);color:var(--ink-text);}
.folio-composer-send:hover{background:var(--ink-text);color:#fff;}
.folio-bubble-assistant{background:var(--paper-edge);color:var(--ink-text);}
.folio-bubble-user{background:var(--moss);color:#fff;}
.folio-chip{background:#fff;border-color:var(--paper-line);color:var(--moss-deep);}
.folio-chip:hover{background:var(--moss-tint);border-color:var(--moss-tint);}
.folio-gen-card{background:#fff;border-color:var(--paper-line);}
.folio-gen-card:hover{border-color:var(--moss);}
.folio-nav-btn{color:var(--muted);}
.folio-nav-btn.active{color:var(--moss-deep);}
.folio-citation{display:inline-flex;align-items:center;gap:3px;font-size:0.65rem;font-family:'IBM Plex Mono',monospace;color:var(--moss-deep);background:var(--moss-tint);border-radius:999px;padding:1px 7px;margin-left:6px;cursor:pointer;vertical-align:middle;border:none;white-space:nowrap;}
.folio-citation:hover{background:var(--moss);color:#fff;}
.cite-flash{animation:citeFlashAnim 2.2s ease-out;border-radius:4px;}
@keyframes citeFlashAnim{
  0%{background:var(--moss-tint);box-shadow:0 0 0 4px var(--moss-tint);}
  70%{background:var(--moss-tint);box-shadow:0 0 0 4px var(--moss-tint);}
  100%{background:transparent;box-shadow:0 0 0 0 rgba(0,0,0,0);}
}
.folio-btn-outline{background:#fff;border-color:var(--paper-line);color:var(--ink-text);}
.folio-btn-outline:hover{border-color:var(--moss);color:var(--moss-deep);}
.folio-primary-btn{background:var(--moss);color:#fff;}
.folio-primary-btn:hover{background:var(--moss-deep);}
.folio-thumb{background:#fff;border-color:var(--paper-line);color:var(--muted);}
.folio-thumb:hover{border-color:var(--moss-tint);}
.folio-thumb.active{border-color:var(--moss);color:var(--moss-deep);box-shadow:0 0 0 2px var(--moss-tint);}
.folio-form-field{background:var(--paper);border-color:var(--paper-line);}
.folio-form-field:focus{border-color:var(--moss);}
.folio-icon-btn{color:var(--muted);}
.folio-icon-btn:hover{background:var(--moss-tint);color:var(--moss-deep);}
.fortizo-overlay{background:rgba(28,25,23,0.45);}
.folio-redaction{background:#1c1917;color:transparent;border-radius:3px;cursor:pointer;padding:0 2px;-webkit-user-select:none;user-select:none;box-decoration-break:clone;-webkit-box-decoration-break:clone;}
.folio-redaction.revealed{background:transparent;color:inherit;outline:1.5px dashed #a8a29e;outline-offset:1px;-webkit-user-select:text;user-select:text;}
.folio-annotation{background:var(--moss-tint);border-bottom:2px solid var(--moss);cursor:pointer;border-radius:2px;padding:0 1px;box-decoration-break:clone;-webkit-box-decoration-break:clone;}
`;

/* ============================================================
   SMALL HOOKS
   ============================================================ */

function useIsMobile() {
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

/* ============================================================
   SMALL PRESENTATIONAL PIECES
   ============================================================ */

function tabLabel(tab) {
  if (tab.id === "reader") return "Original Content";
  if (tab.id === "qa") return "Q&A";
  if (tab.id === "discussion") return "Discussion";
  return tab.title;
}

function TabIcon({ tab, className = "w-3.5 h-3.5" }) {
  if (tab.id === "reader") return <FileText className={className} strokeWidth={1.8} />;
  const def = toolById(tab.id) || toolById(tab.toolId);
  const I = def ? def.Icon : CircleCheck;
  return <I className={className} strokeWidth={1.8} />;
}

function TabPill({ tab, active, onSelect, onClose }) {
  return (
    <div
      onClick={onSelect}
      className={`folio-tab-pill flex items-center gap-1.5 flex-shrink-0 max-w-36 pl-2.5 pr-1.5 py-1.5 rounded-full border cursor-pointer text-xs whitespace-nowrap transition-colors ${
        active ? "active" : ""
      }`}
    >
      <TabIcon tab={tab} />
      <span className="truncate">{tabLabel(tab)}</span>
      {tab.id !== "reader" && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="w-4 h-4 rounded-full flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-stone-900/10 flex-shrink-0"
        >
          <X className="w-2.5 h-2.5" strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}

function GenerateGrid({ onPick }) {
  const generated = TOOL_DEFS.filter((t) => !t.community);
  const community = TOOL_DEFS.filter((t) => t.community);
  const Card = (t) => (
    <button
      key={t.id}
      type="button"
      onClick={() => onPick(t)}
      className="folio-gen-card flex items-center gap-2 px-2.5 py-2 border rounded-lg text-left min-w-0"
    >
      <span className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${t.bg} ${t.fg}`}>
        <t.Icon className="w-4 h-4" strokeWidth={1.8} />
      </span>
      <span className="flex-1 flex items-center gap-1.5 min-w-0 text-sm text-stone-900">
        <span className="truncate">{t.label}</span>
      </span>
      <ChevronRight className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
    </button>
  );
  return (
    <div className="px-4 pt-3.5 pb-2 flex-shrink-0">
      <div className="font-display text-base font-semibold text-stone-900 mb-2">Generate</div>
      <div className="grid grid-cols-2 gap-2 mb-4">{generated.map(Card)}</div>
      <div className="font-display text-base font-semibold text-stone-900 mb-2">Community</div>
      <div className="grid grid-cols-2 gap-2">{community.map(Card)}</div>
    </div>
  );
}

function ToolHeader({ label, sub, onBack }) {
  return (
    <div className="flex items-center gap-2.5 mb-3.5">
      <button type="button" onClick={onBack} className="folio-btn-outline w-7 h-7 rounded-full border flex items-center justify-center flex-shrink-0">
        <ChevronLeft className="w-4 h-4" strokeWidth={1.8} />
      </button>
      <div>
        <div className="font-display text-base font-semibold text-stone-900 mb-0.5">{label}</div>
        {sub && <div className="text-xs text-stone-400">{sub}</div>}
      </div>
    </div>
  );
}

function CreationForm({ toolId, initialFocus, onBack, onSubmit }) {
  const def = FORM_DEFS[toolId];
  const [values, setValues] = useState(() => {
    const v = {};
    def.fields.forEach((f) => { v[f.id] = f.type === "select" ? f.options[0] : (f.id === "focus" ? initialFocus || "" : ""); });
    return v;
  });
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit() {
    setSubmitting(true);
    onSubmit(values, () => setSubmitting(false));
  }

  return (
    <div>
      <ToolHeader label={def.title} sub={def.sub} onBack={onBack} />
      <div className="flex flex-col gap-3.5">
        {def.fields.map((f) => (
          <label key={f.id} className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-stone-500">{f.label}</span>
            {f.type === "text" ? (
              <input
                type="text"
                value={values[f.id]}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                className="folio-form-field border rounded-lg px-2.5 py-2 text-sm text-stone-900 focus:outline-none"
              />
            ) : (
              <select
                value={values[f.id]}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                className="folio-form-field border rounded-lg px-2.5 py-2 text-sm text-stone-900 focus:outline-none"
              >
                {f.options.map((o) => <option key={o}>{o}</option>)}
              </select>
            )}
          </label>
        ))}
        <button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className="folio-primary-btn mt-1 w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-75"
        >
          {submitting ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin inline-block" />
              Generating…
            </>
          ) : (
            `Generate ${def.title.toLowerCase()}`
          )}
        </button>
      </div>
    </div>
  );
}

function resultSub(tab) {
  switch (tab.toolId) {
    case "podcast": return `${tab.values.length || "Medium · 8–10 min"} · generated from page ${tab.createdPage + 1}`;
    case "video": return `${tab.values.style || "Animated"} · generated from page ${tab.createdPage + 1}`;
    case "summary": return `${tab.values.depth || "Brief"} summary · page ${tab.createdPage + 1}`;
    case "quiz": return `${tab.values.count || "5"} questions · ${tab.values.difficulty || "Medium"} · page ${tab.createdPage + 1}`;
    case "flashcards": return `${tab.values.count || "6"} cards requested · page ${tab.createdPage + 1}`;
    case "notes": return `Page ${tab.createdPage + 1}`;
    default: return "";
  }
}

function Citation({ cite, onCite }) {
  if (!cite) return null;
  return (
    <button type="button" onClick={() => onCite(cite)} className="folio-citation" title="Jump to source in the reader">
      <FileText className="w-2.5 h-2.5" strokeWidth={2} />
      Page {cite.page + 1}
    </button>
  );
}

function ResultView({ tab, onUpdate, onCite }) {
  const header = (
    <div className="mb-3.5">
      <div className="font-display text-base font-semibold text-stone-900 mb-0.5">{tab.title}</div>
      <div className="text-xs text-stone-400">{resultSub(tab)}</div>
    </div>
  );

  function renderBody() {
  if (tab.toolId === "summary") {
    const points = [
      { text: "This page defines the levels of biological organisation, from a single cell through to a complete organism.", cite: CITATIONS.levelsOfOrg },
      { text: "Candidates should be able to trace that sequence — cell, tissue, organ, system — using named examples like euglena and hydra.", cite: CITATIONS.levelsOfOrg },
      { text: "Expect comparison questions between plant and animal cell structure, and how each component supports function.", cite: CITATIONS.cellStructure },
    ];
    return (
      <div>
        {header}
        {points.map((p, i) => (
          <div key={i} className="flex gap-2.5 mb-3.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-600 mt-1.5 flex-shrink-0" />
            <p className="text-sm leading-relaxed text-stone-700 m-0">{p.text} <Citation cite={p.cite} onCite={onCite} /></p>
          </div>
        ))}
      </div>
    );
  }

  if (tab.toolId === "podcast") {
    return (
      <div>
        {header}
        <div className="bg-stone-900 rounded-lg p-4 mb-3.5 text-stone-100">
          <div className="font-display text-sm mb-0.5">Episode — {tab.values.focus || "Variety of Organisms"}</div>
          <div className="text-xs text-stone-400 mb-3.5">{tab.values.length || "Medium · 8–10 min"} · generated from this page</div>
          <div className="flex items-center gap-2.5">
            <button className="w-9 h-9 rounded-full bg-emerald-600 flex items-center justify-center text-stone-900 flex-shrink-0">
              <Play className="w-3.5 h-3.5" fill="currentColor" strokeWidth={0} />
            </button>
            <div className="flex-1 h-1 bg-white/20 rounded-full relative">
              <div className="absolute left-0 top-0 bottom-0 w-1/3 bg-emerald-500 rounded-full" />
            </div>
            <span className="font-ui-mono text-xs text-stone-400">3:47</span>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-stone-700">A short, spoken walkthrough of this page — good for reviewing while commuting or resting your eyes. <Citation cite={CITATIONS.levelsOfOrg} onCite={onCite} /></p>
      </div>
    );
  }

  if (tab.toolId === "video") {
    return (
      <div>
        {header}
        <div className="w-full aspect-video rounded-lg bg-gradient-to-br from-stone-800 to-stone-900 flex items-center justify-center relative mb-3">
          <button className="w-11 h-11 rounded-full bg-emerald-600 flex items-center justify-center text-stone-900">
            <Play className="w-4 h-4" fill="currentColor" strokeWidth={0} />
          </button>
          <span className="absolute bottom-2.5 right-2.5 bg-black/55 text-white font-ui-mono text-xs px-1.5 py-0.5 rounded">6:12</span>
        </div>
        <p className="text-sm leading-relaxed text-stone-700">An illustrated walkthrough of {tab.values.focus || "the levels of organisation"}, built from the diagrams and terms on this page. <Citation cite={CITATIONS.levelsOfOrg} onCite={onCite} /></p>
      </div>
    );
  }

  if (tab.toolId === "quiz") {
    const total = QUIZ_QUESTIONS.length;
    const idx = tab.quizIndex ?? 0;
    const q = QUIZ_QUESTIONS[idx];
    const answers = tab.quizAnswers || QUIZ_QUESTIONS.map(() => ({ selected: null, checked: false, dontKnow: false }));
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
          <span className="font-ui-mono text-xs text-stone-400">Question {idx + 1} of {total}</span>
          <Citation cite={q.cite} onCite={onCite} />
        </div>
        <div className="font-display text-sm font-medium text-stone-900 mb-3.5">{q.prompt}</div>
        <div className="mb-1.5">
          {q.options.map((opt) => {
            let cls = "border-stone-200";
            if (revealed && opt.correct) cls = "border-emerald-600 bg-emerald-50";
            else if (revealed && opt.key === ans.selected) cls = "border-red-400 bg-red-50";
            else if (!revealed && opt.key === ans.selected) cls = "border-emerald-600 bg-emerald-50";
            return (
              <div
                key={opt.key}
                onClick={() => !revealed && patchAnswer({ selected: opt.key })}
                className={`flex items-center gap-2.5 px-3 py-2.5 border rounded-lg mb-2 text-sm cursor-pointer ${cls}`}
              >
                <span className="w-5 h-5 rounded-full border border-stone-200 flex items-center justify-center font-ui-mono text-xs flex-shrink-0">{opt.key}</span>
                {opt.text}
              </div>
            );
          })}
        </div>

        {tab.quizHint && (
          <div className="text-xs leading-relaxed text-stone-600 bg-stone-50 border border-stone-200 rounded-lg p-2.5 mb-3">{tab.quizHint}</div>
        )}

        {!revealed && (
          <div className="flex items-center gap-2 mb-3">
            <button type="button" onClick={() => onUpdate({ quizHint: QUIZ_HINTS.simple })} className="folio-chip flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs whitespace-nowrap">
              <Lightbulb className="w-3.5 h-3.5" strokeWidth={1.6} /> Make it simple
            </button>
            <button type="button" onClick={() => onUpdate({ quizHint: QUIZ_HINTS.walk })} className="folio-chip flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs whitespace-nowrap">
              <ListOrdered className="w-3.5 h-3.5" strokeWidth={1.6} /> Walk me through it
            </button>
          </div>
        )}

        {!revealed ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => patchAnswer({ checked: true })}
              className="folio-primary-btn flex-1 py-2.5 rounded-lg text-sm font-medium"
            >
              Check answer
            </button>
            <button
              type="button"
              onClick={() => patchAnswer({ dontKnow: true })}
              className="folio-btn-outline flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border text-sm font-medium flex-shrink-0"
            >
              <HelpCircle className="w-4 h-4" strokeWidth={1.8} /> Don't know
            </button>
          </div>
        ) : idx < total - 1 ? (
          <button
            type="button"
            onClick={() => onUpdate({ quizIndex: idx + 1, quizHint: null })}
            className="folio-primary-btn w-full py-2.5 rounded-lg text-sm font-medium"
          >
            Next question
          </button>
        ) : (
          <div className="text-center text-sm text-emerald-700 font-medium py-2">Quiz complete 🎉</div>
        )}

        {revealed && (
          <div className="mt-2.5 text-xs text-stone-600">
            {ans.dontKnow
              ? `No worries — the answer is: ${correctOpt?.text}`
              : selectedOpt?.correct
              ? "Correct!"
              : `Not quite — the correct answer is: ${correctOpt?.text}`}
          </div>
        )}
      </div>
    );
  }

  if (tab.toolId === "flashcards") {
    const card = CARD_SET[tab.cardIndex];
    const cardCite = tab.cardIndex === 0 ? CITATIONS.cellStructure : CITATIONS.levelsOfOrg;
    return (
      <div>
        {header}
        <div className="flex items-center justify-center gap-2 text-center text-xs text-stone-400 mb-3">
          <span>Tap the card to flip</span>
          <Citation cite={cardCite} onCite={onCite} />
        </div>
        <div className="w-full mb-3.5" style={{ perspective: "1000px", aspectRatio: "4 / 3" }}>
          <div
            onClick={() => onUpdate({ flipped: !tab.flipped })}
            className="relative w-full h-full cursor-pointer transition-transform duration-500"
            style={{ transformStyle: "preserve-3d", transform: tab.flipped ? "rotateY(180deg)" : "none" }}
          >
            <div className="absolute inset-0 rounded-lg bg-emerald-50 flex items-center justify-center text-center p-4 border border-stone-200" style={{ backfaceVisibility: "hidden" }}>
              <span className="font-display text-lg font-semibold text-emerald-700">{card.front}</span>
            </div>
            <div
              className="absolute inset-0 rounded-lg bg-stone-900 text-stone-100 flex items-center justify-center text-center p-4 text-sm leading-relaxed"
              style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            >
              {card.back}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => onUpdate({ cardIndex: (tab.cardIndex - 1 + CARD_SET.length) % CARD_SET.length, flipped: false })}
            className="folio-btn-outline w-7 h-7 rounded-full border flex items-center justify-center"
          >
            <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.8} />
          </button>
          <span className="font-ui-mono text-xs text-stone-500">{tab.cardIndex + 1} / {CARD_SET.length}</span>
          <button
            type="button"
            onClick={() => onUpdate({ cardIndex: (tab.cardIndex + 1) % CARD_SET.length, flipped: false })}
            className="folio-btn-outline w-7 h-7 rounded-full border flex items-center justify-center"
          >
            <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.8} />
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
          value={tab.notesValue}
          onChange={(e) => onUpdate({ notesValue: e.target.value })}
          placeholder="Write a note about this page…"
          style={{ minHeight: "16rem" }}
          className="folio-form-field w-full border rounded-lg p-3 font-display text-sm leading-relaxed text-stone-900 resize-y focus:outline-none"
        />
        <div className="flex justify-between font-ui-mono text-xs text-stone-400 mt-2">
          <span>Page {tab.createdPage + 1}</span>
          <span>saved</span>
        </div>
      </div>
    );
  }

  return null;
  }

  return renderBody();
}

/* ============================================================
   COMMUNITY — Q&A and Discussion are NOT generated tools. They open
   straight into a persistent, shared, threaded board with a comment
   box — same content every visitor to this document would see.
   ============================================================ */

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
    <div style={{ marginLeft: indent }} className={depth > 0 ? "mt-3 pl-3 border-l-2 border-stone-100" : "mb-5"}>
      <div className="flex items-start gap-2.5">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
          style={{ background: node.color || "#78716c" }}
        >
          {node.author[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-stone-900">{node.author}</span>
            <span className="text-xs text-stone-400">{node.ts}</span>
          </div>
          <p className="text-sm text-stone-700 mt-0.5 mb-1.5">{node.text}</p>
          <div className="flex items-center gap-3.5 text-xs">
            <button type="button" onClick={() => onLike(node.id)} className="flex items-center gap-1 text-stone-500 hover:text-emerald-700">
              <ThumbsUp className="w-3.5 h-3.5" strokeWidth={1.8} /> {node.likes || 0}
            </button>
            <button type="button" onClick={() => setReplying((r) => !r)} className="font-medium text-emerald-700 hover:text-emerald-800">
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
              <button type="button" onClick={submitReply} className="folio-primary-btn px-3 py-1.5 rounded-full text-xs font-medium flex-shrink-0">
                Send
              </button>
            </div>
          )}

          {(node.replies || []).map((child) => (
            <ThreadNode key={child.id} node={child} onReply={onReply} onLike={onLike} depth={depth + 1} />
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
    const node = { id: "t-" + Date.now(), author: "You", color: "#3E6B45", text: t, ts: "just now", likes: 0, replies: [] };
    setThreads((prev) => [node, ...prev]);
    setText("");
  }

  return (
    <div>
      <div className="mb-4">
        <div className="font-display text-base font-semibold text-stone-900 mb-0.5">{title}</div>
        <div className="text-xs text-stone-400">{subtitle}</div>
      </div>
      <div className="flex items-center gap-2 mb-5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && post()}
          placeholder={placeholder}
          className="folio-form-field flex-1 border rounded-full px-3.5 py-2 text-sm focus:outline-none"
        />
        <button type="button" onClick={post} className="folio-primary-btn px-4 py-2 rounded-full text-sm font-medium flex-shrink-0">
          {actionLabel}
        </button>
      </div>
      {threads.length === 0 ? (
        <p className="text-xs text-stone-400">{emptyText}</p>
      ) : (
        threads.map((t) => (
          <ThreadNode
            key={t.id}
            node={t}
            onLike={(id) => setThreads((prev) => likeInTree(prev, id))}
            onReply={(id, replyText) =>
              setThreads((prev) => addReplyToTree(prev, id, { id: id + "-" + Date.now(), author: "You", color: "#3E6B45", text: replyText, ts: "just now", likes: 0, replies: [] }))
            }
          />
        ))
      )}
    </div>
  );
}

/* ============================================================
   CHAT PANEL — standalone, always visible on its own (desktop:
   a permanent column; mobile: its own dedicated sheet). Doesn't
   know anything about the Tools/Generate side anymore.
   ============================================================ */

const CHAT_SUGGESTIONS = [
  { Icon: AlignLeft, text: "Summarize this page" },
  { Icon: HelpCircle, text: "Quiz me on this topic" },
  { Icon: Lightbulb, text: "Explain the diagram" },
  { Icon: FileText, text: "Give a real-world example" },
];

function ChatPanel({ messages, setMessages, attachedFile, setAttachedFile, currentPage, currentModel, setCurrentModel, context, setContext }) {
  const [input, setInput] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [searchOn, setSearchOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const fileInputRef = useRef(null);
  const messagesRef = useRef(null);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages, typing]);

  function sendMessage(text, file) {
    const withContext = context ? `Regarding "${context}": ${text}` : text;
    setMessages((m) => [...m, { role: "user", text: withContext, file: file || null }]);
    setTyping(true);
    setTimeout(() => {
      const reply = file ? `Got it — I've looked over "${file}". ${generateReply(text, currentPage)}` : generateReply(text, currentPage);
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
      setTyping(false);
    }, 700);
    if (context) setContext(null);
  }

  function trySend() {
    const text = input.trim();
    if (!text && !attachedFile && !context) return;
    sendMessage(text || (context ? "Explain this." : `Sent a file: ${attachedFile}`), attachedFile);
    setInput("");
    if (attachedFile) setAttachedFile(null);
  }

  useEffect(() => {
    function onKeyDown(e) {
      if (!e.altKey) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= CHAT_SUGGESTIONS.length) {
        e.preventDefault();
        sendMessage(CHAT_SUGGESTIONS[n - 1].text);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, currentPage]);

  const isEmpty = messages.length <= 1;

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      {isEmpty ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col">
          <div className="flex flex-col items-center text-center pt-6 pb-5">
            <div className="folio-bubble-assistant w-11 h-11 rounded-full flex items-center justify-center mb-3">
              <MessageSquare className="w-5 h-5" strokeWidth={1.8} />
            </div>
            <div className="font-display text-base font-semibold text-stone-900 mb-1">Chat with the AI Tutor</div>
            <div className="text-xs text-stone-400">Ask anything or use the suggestions below</div>
          </div>

          <button
            type="button"
            onClick={() => setSuggestionsOpen((o) => !o)}
            className="flex items-center gap-1.5 text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2"
          >
            Learn suggestions
            <ChevronUp className={`w-3.5 h-3.5 transition-transform ${suggestionsOpen ? "" : "rotate-180"}`} strokeWidth={2} />
          </button>
          {suggestionsOpen && (
            <div className="flex flex-col gap-2">
              {CHAT_SUGGESTIONS.map((s, i) => (
                <button
                  key={s.text}
                  type="button"
                  onClick={() => sendMessage(s.text)}
                  className="folio-gen-card flex items-center gap-2.5 px-3 py-2.5 border rounded-lg text-left"
                >
                  <s.Icon className="w-4 h-4 text-stone-400 flex-shrink-0" strokeWidth={1.8} />
                  <span className="flex-1 text-sm text-stone-800">{s.text}</span>
                  <span className="font-ui-mono text-xs text-stone-300 flex-shrink-0">⌥{i + 1}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div ref={messagesRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-2.5">
          {messages.map((m, i) => (
            <div
              key={i}
              style={{ maxWidth: "86%" }}
              className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                m.role === "assistant" ? "folio-bubble-assistant self-start rounded-bl-sm" : "folio-bubble-user self-end rounded-br-sm"
              }`}
            >
              {m.file && (
                <div className="flex items-center gap-1.5 mb-1.5 px-2 py-1.5 rounded-lg bg-white/20 text-xs">
                  <FileText className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.6} />
                  <span className="truncate">{m.file}</span>
                </div>
              )}
              {m.text}
            </div>
          ))}
          {typing && (
            <div className="folio-bubble-assistant self-start flex gap-1 px-3.5 py-2.5 rounded-2xl rounded-bl-sm">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          )}
        </div>
      )}

      {context && (
        <div className="flex items-center gap-2 mx-4 mb-2 px-3 py-2 rounded-lg border border-stone-200 bg-white text-xs text-stone-600 flex-shrink-0">
          <CornerDownRight className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" strokeWidth={1.8} />
          <span className="flex-1 truncate">{context}</span>
          <button type="button" onClick={() => setContext(null)} className="flex-shrink-0 text-stone-400 hover:text-stone-700">
            <X className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </div>
      )}

      <div className="folio-composer mx-4 mb-3.5 border rounded-3xl px-3.5 py-3 flex-shrink-0">
        {attachedFile && (
          <div className="flex items-center gap-1.5 mb-2 px-2.5 py-1.5 rounded-lg bg-white text-xs text-emerald-700">
            <FileText className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.6} />
            <span className="flex-1 truncate">{attachedFile}</span>
            <button type="button" onClick={() => setAttachedFile(null)}>
              <X className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          </div>
        )}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && trySend()}
          placeholder="Ask anything…"
          className="folio-composer-input w-full bg-transparent text-sm text-stone-900 outline-none pb-2.5"
        />
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setAttachedFile(f.name);
            }}
          />
          <button
            type="button"
            onClick={() => setSearchOn((s) => !s)}
            title="Search the web"
            className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${searchOn ? "bg-emerald-600 text-white" : "folio-composer-btn"}`}
          >
            <Search className="w-3.5 h-3.5" strokeWidth={1.8} />
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="folio-composer-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0">
            <Paperclip className="w-3.5 h-3.5" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => setMicOn((m) => !m)}
            title="Voice input"
            className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${micOn ? "bg-emerald-600 text-white" : "folio-composer-btn"}`}
          >
            <Mic className="w-3.5 h-3.5" strokeWidth={1.8} />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setModelMenuOpen((o) => !o)}
              className="folio-composer-btn flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap"
            >
              {currentModel}
              <ChevronDown className={`w-3 h-3 text-stone-400 transition-transform ${modelMenuOpen ? "rotate-180" : ""}`} strokeWidth={1.8} />
            </button>
            {modelMenuOpen && (
              <div style={{ minWidth: "12.5rem" }} className="folio-btn-outline absolute bottom-full mb-2 left-0 border rounded-lg shadow-lg p-1 z-50">
                {MODELS.map((m) => (
                  <button
                    key={m.name}
                    type="button"
                    onClick={() => { setCurrentModel(m.name); setModelMenuOpen(false); }}
                    className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-md text-left hover:bg-emerald-50 ${m.name === currentModel ? "text-emerald-700 font-semibold" : "text-stone-900"}`}
                  >
                    <span>
                      <span className="block text-sm">{m.name}</span>
                      <span className="block text-xs text-stone-400 font-normal">{m.desc}</span>
                    </span>
                    {m.name === currentModel && <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" strokeWidth={2} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1" />
          <button
            type="button"
            onClick={trySend}
            className="folio-composer-send w-8 h-8 rounded-lg border-2 flex items-center justify-center flex-shrink-0"
          >
            <ArrowUp className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   FORTIZO MAIN — reader + tools live together; chat is its own
   panel on the side (desktop: permanent column; mobile: its own
   sheet, reached via a dedicated button next to the tool tabs).
   ============================================================ */

function Fortizo({ docTitle }) {
  const isMobile = useIsMobile();

  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pageNumDraft, setPageNumDraft] = useState("1");
  const viewerRef = useRef(null);

  /* ---- tools (Generate dropdown / forms / result tabs) ---- */
  const [formTool, setFormTool] = useState(null);
  const [prefillFocus, setPrefillFocus] = useState("");
  const [resultTabs, setResultTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState("reader");
  const nextResultId = useRef(1);
  const [genMenuOpen, setGenMenuOpen] = useState(false);
  const genMenuRef = useRef(null);

  /* ---- community: Q&A and Discussion — not generated. Their content
     is shared/persistent; only which ones are pinned to the tab strip
     is per-session. ---- */
  const [qaThreads, setQaThreads] = useState(SEED_QA);
  const [discussionThreads, setDiscussionThreads] = useState(SEED_DISCUSSION);
  const [communityTabsOpen, setCommunityTabsOpen] = useState([]);

  /* ---- chat — fully separate state, its own panel ---- */
  const [chatMessages, setChatMessages] = useState([
    { role: "assistant", text: "Hi! Ask me anything about this document." },
  ]);
  const [chatAttachedFile, setChatAttachedFile] = useState(null);
  const [chatContext, setChatContext] = useState(null);
  const [currentModel, setCurrentModel] = useState(MODELS[0].name);
  const [chatSheetOpen, setChatSheetOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const [selection, setSelection] = useState(null);
  const [selPos, setSelPos] = useState(null);
  const selMenuRef = useRef(null);

  /* ---- redaction & annotation ---- */
  const [redactions, setRedactions] = useState([]); // { id, page, text }
  const [annotations, setAnnotations] = useState([]); // { id, page, text, note }
  const [revealedRedactions, setRevealedRedactions] = useState(() => new Set());
  const [openAnnotation, setOpenAnnotation] = useState(null); // { id, note, left, top }
  const [annotateDraft, setAnnotateDraft] = useState(null); // { text, rect } — composing a new note
  const [annotateText, setAnnotateText] = useState("");
  const annotateBoxRef = useRef(null);

  useEffect(() => {
    const root = viewerRef.current;
    if (!root) return;
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
  }, []);

  useEffect(() => { setPageNumDraft(String(currentPage + 1)); }, [currentPage]);

  useEffect(() => {
    if (!genMenuOpen) return;
    const onDocClick = (e) => { if (genMenuRef.current && !genMenuRef.current.contains(e.target)) setGenMenuOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [genMenuOpen]);

  const goToPage = useCallback((idx) => {
    const clamped = Math.max(0, Math.min(PAGES.length - 1, idx));
    const el = viewerRef.current?.querySelector(`[data-page-index="${clamped}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  /* ---- overlay redactions/annotations onto a page's HTML by wrapping the
     first occurrence of the marked text. Simple string matching — good
     enough for short, plain-text selections in this mock content. ---- */
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
    setAnnotations((a) => [...a, { id: "ann-" + Date.now(), page: currentPage, text: annotateDraft.text, note: annotateText.trim() }]);
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
    n = Math.max(1, Math.min(PAGES.length, n));
    goToPage(n - 1);
    setPageNumDraft(String(n));
  }

  /* ---- tools navigation ---- */
  function switchTabTo(id) {
    setActiveTabId(id);
    setSelection(null);
    if (isMobile) setChatSheetOpen(false);
  }

  function closeTab(id) {
    if (id === "qa" || id === "discussion") {
      setCommunityTabsOpen((c) => c.filter((x) => x !== id));
    } else {
      setResultTabs((rt) => rt.filter((t) => t.id !== id));
    }
    if (activeTabId === id) switchTabTo("reader");
  }

  function openCommunityTab(id) {
    setCommunityTabsOpen((c) => (c.includes(id) ? c : [...c, id]));
    setActiveTabId(id);
    setFormTool(null);
    setSelection(null);
    setChatSheetOpen(false);
    setGenMenuOpen(false);
  }

  function handleToolPick(t) {
    if (t.community) {
      openCommunityTab(t.id);
    } else {
      setFormTool(t.id);
      setPrefillFocus("");
    }
  }

  function openForm(toolId, focus = "") {
    setActiveTabId("reader");
    setFormTool(toolId);
    setPrefillFocus(focus);
    setSelection(null);
    setChatSheetOpen(false);
    setGenMenuOpen(true);
  }

  function handleFormSubmit(values, done) {
    const toolId = formTool;
    setTimeout(() => {
      const tdef = toolById(toolId);
      const focusLabel = (values.focus && values.focus.trim()) || `Page ${currentPage + 1}`;
      const id = "r" + nextResultId.current++;
      const tab = {
        id, toolId, values, createdPage: currentPage,
        title: `${tdef.label} · ${focusLabel.length > 22 ? focusLabel.slice(0, 22) + "…" : focusLabel}`,
        cardIndex: 0, flipped: false,
        quizIndex: 0, quizHint: null,
        quizAnswers: QUIZ_QUESTIONS.map(() => ({ selected: null, checked: false, dontKnow: false })),
        notesValue: values.focus ? `${values.focus}\n\n` : "",
      };
      setResultTabs((rt) => [...rt, tab]);
      setFormTool(null);
      setActiveTabId(id);
      setGenMenuOpen(false);
      done();
    }, 900);
  }

  function updateResultTab(id, patch) {
    setResultTabs((rt) => rt.map((t) => (t.id === id ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)));
  }

  const activeResultTab = resultTabs.find((t) => t.id === activeTabId);

  /* ---- citations: jump the reader to the source page and briefly
     flash-highlight the exact row/line the content was drawn from.
     A real pipeline would supply these page/element refs automatically
     (same idea as Hanji's bbox citations) — here they're simulated. ---- */
  function citeJump(cite) {
    if (!cite) return;
    setChatSheetOpen(false);
    setGenMenuOpen(false);
    setActiveTabId("reader");
    requestAnimationFrame(() => {
      goToPage(cite.page);
      setTimeout(() => {
        const target = viewerRef.current?.querySelector(`[data-page-index="${cite.page}"] [data-cite="${cite.dataCite}"]`);
        if (target) {
          target.classList.remove("cite-flash");
          void target.offsetWidth; // restart the animation if clicked again
          target.classList.add("cite-flash");
          setTimeout(() => target.classList.remove("cite-flash"), 2300);
        }
      }, 450);
    });
  }

  /* ---- chat navigation (mobile) ---- */
  function openChatSheet() {
    if (isMobile && chatSheetOpen) { setChatSheetOpen(false); return; }
    setChatSheetOpen(true);
  }

  /* ---- text selection popover ---- */
  const closestPage = (node) => {
    if (!node) return null;
    const el = node.nodeType === 1 ? node : node.parentElement;
    return el ? el.closest("[data-page-index]") : null;
  };

  const showSelectionMenu = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return setSelection(null);
    const text = sel.toString().trim();
    if (!text) return setSelection(null);
    if (!closestPage(sel.anchorNode) || !closestPage(sel.focusNode)) return setSelection(null);
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return setSelection(null);
    setSelection({ text, rect: { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width } });
  }, []);

  useLayoutEffect(() => {
    if (!selection || !selMenuRef.current) { setSelPos(null); return; }
    const menuRect = selMenuRef.current.getBoundingClientRect();
    const margin = 8;
    let left = selection.rect.left + selection.rect.width / 2 - menuRect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));
    let top = selection.rect.bottom + 10;
    if (top + menuRect.height > window.innerHeight - margin) top = selection.rect.top - menuRect.height - 10;
    if (top < margin) top = selection.rect.bottom + 10;
    setSelPos({ left, top });
  }, [selection]);

  useEffect(() => {
    let t;
    const onSelChange = () => { clearTimeout(t); t = setTimeout(showSelectionMenu, 80); };
    const onMouseDown = (e) => { if (!selMenuRef.current?.contains(e.target) && !closestPage(e.target)) setSelection(null); };
    document.addEventListener("selectionchange", onSelChange);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("touchstart", onMouseDown, { passive: true });
    return () => {
      clearTimeout(t);
      document.removeEventListener("selectionchange", onSelChange);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("touchstart", onMouseDown);
    };
  }, [showSelectionMenu]);

  function handleSelectionAction(action) {
    const text = selection?.text || "";
    const truncated = text.length > 100 ? text.slice(0, 100) + "…" : text;

    if (action === "redact") {
      setRedactions((r) => [...r, { id: "red-" + Date.now(), page: currentPage, text }]);
      setSelection(null);
      try { window.getSelection().removeAllRanges(); } catch {}
      return;
    }
    if (action === "annotate") {
      setAnnotateDraft({ text, rect: selection.rect });
      setAnnotateText("");
      setSelection(null);
      return;
    }

    setSelection(null);
    try { window.getSelection().removeAllRanges(); } catch {}
    if (action === "explain") {
      if (isMobile) setChatSheetOpen(true);
      setChatContext(truncated);
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
            <TabPill key={t.id} tab={t} active={t.id === activeTabId} onSelect={() => switchTabTo(t.id)} onClose={() => closeTab(t.id)} />
          ))}
        </div>
        {showChatButton && (
          <button
            type="button"
            onClick={openChatSheet}
            title="Open chat"
            className="folio-btn-outline flex-shrink-0 w-7 h-7 rounded-full border flex items-center justify-center"
          >
            <MessageSquare className="w-3.5 h-3.5" strokeWidth={1.8} />
          </button>
        )}
      </div>
    );
  }

  const chatPanelProps = {
    messages: chatMessages, setMessages: setChatMessages,
    attachedFile: chatAttachedFile, setAttachedFile: setChatAttachedFile,
    currentPage, currentModel, setCurrentModel,
    context: chatContext, setContext: setChatContext,
  };

  return (
    <div className="folio-app flex flex-1 min-h-0 w-full overflow-hidden text-stone-900" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <style>{GLOBAL_CSS}</style>

      {/* ============ READER + TOOLS — one merged column, same structure
           on mobile, tablet, and desktop. Chat is the only thing that
           still differs by breakpoint: a permanent column on desktop/
           tablet, a sheet reached via the chat icon here on mobile. ============ */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Tab strip. First tab is the document itself. */}
        <div className="bg-white border-b border-stone-200 flex-shrink-0">
          <PillsBar tabs={allTabs} showChatButton={isMobile} />
        </div>

        {/* Reader pane — shown when the "Original Content" tab is active.
            Kept mounted (just hidden) when it isn't, so scroll position
            and zoom survive switching to a result tab and back. */}
        <div className="flex-col min-h-0 flex-1" style={{ display: activeTabId === "reader" ? "flex" : "none" }}>
          <div className="folio-viewer-bg flex-shrink-0 flex items-center gap-2 md:gap-3.5 px-2.5 md:px-4 border-b border-stone-200" style={{ height: "3.25rem" }}>
            <div className="flex items-center gap-1.5 mr-auto">
              <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 0} className="folio-btn-outline w-7 h-7 rounded border flex items-center justify-center disabled:opacity-35">
                <ChevronUp className="w-4 h-4" strokeWidth={1.6} />
              </button>
              <span className="font-ui-mono text-xs md:text-sm text-stone-500 flex items-center gap-0.5 whitespace-nowrap">
                <input
                  type="text"
                  inputMode="numeric"
                  value={pageNumDraft}
                  onChange={(e) => setPageNumDraft(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => e.key === "Enter" && (commitPageNumDraft(), e.target.blur())}
                  onBlur={commitPageNumDraft}
                  className="w-6 bg-transparent text-right outline-none rounded focus:bg-emerald-50"
                />
                <span> / {PAGES.length}</span>
              </span>
              <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === PAGES.length - 1} className="folio-btn-outline w-7 h-7 rounded border flex items-center justify-center disabled:opacity-35">
                <ChevronDown className="w-4 h-4" strokeWidth={1.6} />
              </button>
            </div>

            <div className="hidden md:flex items-center gap-1">
              <button onClick={() => setZoom((z) => Math.max(0.7, +(z - 0.1).toFixed(2)))} className="folio-btn-outline w-6 h-6 rounded border flex items-center justify-center">
                <Minus className="w-3.5 h-3.5" strokeWidth={1.6} />
              </button>
              <span className="font-ui-mono text-xs text-stone-500 w-9 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(2)))} className="folio-btn-outline w-6 h-6 rounded border flex items-center justify-center">
                <Plus className="w-3.5 h-3.5" strokeWidth={1.6} />
              </button>
            </div>
            {isMobile && (
              <div className="flex items-center gap-0.5">
                <button onClick={() => setZoom((z) => Math.max(0.7, +(z - 0.1).toFixed(2)))} className="folio-btn-outline w-6 h-6 rounded border flex items-center justify-center">
                  <Minus className="w-3 h-3" strokeWidth={1.6} />
                </button>
                <span className="font-ui-mono text-xs text-stone-500 w-7 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(2)))} className="folio-btn-outline w-6 h-6 rounded border flex items-center justify-center">
                  <Plus className="w-3 h-3" strokeWidth={1.6} />
                </button>
              </div>
            )}

            <button
              onClick={() => setIsPlaying((p) => !p)}
              className="folio-icon-btn w-7 h-7 rounded flex items-center justify-center"
              title="Listen to this page (audio coming soon)"
            >
              {isPlaying ? <Pause className="w-4 h-4" strokeWidth={1.6} /> : <Play className="w-4 h-4" strokeWidth={1.6} />}
            </button>
            <button className="folio-icon-btn w-7 h-7 rounded flex items-center justify-center" title="Search in document">
              <Search className="w-4 h-4" strokeWidth={1.6} />
            </button>
            {!isMobile && (
              <button className="folio-icon-btn w-7 h-7 rounded flex items-center justify-center" title="Add document">
                <Upload className="w-4 h-4" strokeWidth={1.6} />
              </button>
            )}

            {/* Generate — the way to spawn a new tool tab, same on every breakpoint. */}
            <div className="relative" ref={genMenuRef}>
              <button
                onClick={() => setGenMenuOpen((o) => !o)}
                className="folio-icon-btn w-7 h-7 rounded flex items-center justify-center"
                title="Generate a study tool"
              >
                <LayoutGrid className="w-4 h-4" strokeWidth={1.6} />
              </button>
              {genMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-stone-200 rounded-lg shadow-xl z-50 overflow-hidden" style={{ maxHeight: "70vh", overflowY: "auto" }}>
                  {formTool ? (
                    <div className="p-3">
                      <CreationForm toolId={formTool} initialFocus={prefillFocus} onBack={() => setFormTool(null)} onSubmit={handleFormSubmit} />
                    </div>
                  ) : (
                    <GenerateGrid onPick={handleToolPick} />
                  )}
                </div>
              )}
            </div>
          </div>


          <div className="flex-1 min-h-0 relative overflow-hidden">
            <div ref={viewerRef} onClick={handleViewerClick} className="h-full overflow-auto flex flex-col items-center px-3 md:px-6 pt-9 pb-16">
              {PAGES.map((html, i) => (
                <div
                  key={i}
                  data-page-index={i}
                  style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
                  className="doc-page relative bg-white w-full md:max-w-2xl mb-5 shadow-lg px-5 py-9 md:px-13 md:py-14"
                  dangerouslySetInnerHTML={{ __html: buildPageHtml(html, i) }}
                />
              ))}
            </div>
          </div>

          <div className="folio-viewer-bg hidden md:flex flex-shrink-0 items-center gap-2.5 px-4 py-2.5 border-t border-stone-200 overflow-x-auto">
            {PAGES.map((_, i) => (
              <button
                key={i}
                onClick={() => goToPage(i)}
                className={`folio-thumb flex-shrink-0 w-11 h-14 rounded border flex items-center justify-center font-ui-mono text-xs ${
                  i === currentPage ? "active" : ""
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>

        {/* Community panes — persistent, not generated. */}
        {activeTabId === "qa" && (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 bg-white">
            <CommunityBoard
              title="Q&A"
              subtitle="Ask a question about this document — anyone studying it can answer."
              placeholder="Ask a question…"
              actionLabel="Ask"
              emptyText="No questions yet — be the first to ask."
              threads={qaThreads}
              setThreads={setQaThreads}
            />
          </div>
        )}
        {activeTabId === "discussion" && (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 bg-white">
            <CommunityBoard
              title="Discussion"
              subtitle="Talk through this document with other learners."
              placeholder="Start a discussion…"
              actionLabel="Post"
              emptyText="No discussion yet — start the conversation."
              threads={discussionThreads}
              setThreads={setDiscussionThreads}
            />
          </div>
        )}

        {/* Result pane — shown when a generated tab (not "Original Content") is active. */}
        {activeTabId !== "reader" && activeTabId !== "qa" && activeTabId !== "discussion" && activeResultTab && (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 bg-white">
            <ResultView tab={activeResultTab} onUpdate={(patch) => updateResultTab(activeResultTab.id, patch)} onCite={citeJump} />
          </div>
        )}
      </div>

      {/* ============ CHAT — its own panel, always visible on desktop/tablet ============ */}
      <section className="hidden md:flex md:flex-col md:w-80 lg:w-96 flex-shrink-0 bg-white border-l border-stone-200 min-h-0">
        <div className="flex items-center gap-2 px-4 py-3.5 border-b border-stone-200 flex-shrink-0">
          <MessageSquare className="w-4 h-4 text-stone-400" strokeWidth={1.8} />
          <div className="font-display text-base font-semibold text-stone-900">Chat</div>
        </div>
        <div className="flex-1 min-h-0">
          <ChatPanel {...chatPanelProps} />
        </div>
      </section>

      {/* ============ MOBILE: chat sheet only — no bottom nav anymore,
           tools live inline via the tab strip + Generate icon above. ============ */}
      {isMobile && (
        <>
          {chatSheetOpen && (
            <div onClick={() => setChatSheetOpen(false)} className="fortizo-overlay fixed inset-0 z-20" />
          )}

          {chatSheetOpen && (
            <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl flex flex-col" style={{ height: "70vh", maxHeight: "70vh" }}>
              <div className="relative flex justify-center items-center pt-2.5 pb-2 px-3 flex-shrink-0 border-b border-stone-200">
                <span className="absolute left-1/2 top-2.5 -translate-x-1/2 w-9 h-1 rounded-full bg-stone-200" />
                <div className="font-display text-sm font-semibold text-stone-900">Chat</div>
                <button onClick={() => setChatSheetOpen(false)} className="absolute right-3 top-2 w-7 h-7 rounded-full bg-stone-100 flex items-center justify-center text-stone-500">
                  <X className="w-3.5 h-3.5" strokeWidth={1.8} />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <ChatPanel {...chatPanelProps} />
              </div>
            </div>
          )}
        </>
      )}

      {/* ============ SELECTION POPOVER ============ */}
      {selection && (
        <div
          ref={selMenuRef}
          style={{ position: "fixed", left: selPos ? selPos.left : -9999, top: selPos ? selPos.top : -9999, maxWidth: "calc(100vw - 16px)" }}
          className="flex items-center gap-0.5 bg-stone-900 rounded-lg p-1 shadow-xl z-50 overflow-x-auto"
        >
          <button onClick={() => handleSelectionAction("explain")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-stone-200 text-xs hover:bg-white/10 whitespace-nowrap flex-shrink-0">
            <Lightbulb className="w-3.5 h-3.5 text-emerald-300" strokeWidth={1.6} /> Explain
          </button>
          <div className="w-px h-6 bg-white/15 mx-0.5 flex-shrink-0" />
          <button onClick={() => handleSelectionAction("quiz")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-stone-200 text-xs hover:bg-white/10 whitespace-nowrap flex-shrink-0">
            <CircleCheck className="w-3.5 h-3.5 text-emerald-300" strokeWidth={1.6} /> Quiz me
          </button>
          <button onClick={() => handleSelectionAction("flashcards")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-stone-200 text-xs hover:bg-white/10 whitespace-nowrap flex-shrink-0">
            <Layers className="w-3.5 h-3.5 text-emerald-300" strokeWidth={1.6} /> Cards
          </button>
          <button onClick={() => handleSelectionAction("notes")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-stone-200 text-xs hover:bg-white/10 whitespace-nowrap flex-shrink-0">
            <PenLine className="w-3.5 h-3.5 text-emerald-300" strokeWidth={1.6} /> Note
          </button>
          <div className="w-px h-6 bg-white/15 mx-0.5 flex-shrink-0" />
          <button onClick={() => handleSelectionAction("annotate")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-stone-200 text-xs hover:bg-white/10 whitespace-nowrap flex-shrink-0">
            <Highlighter className="w-3.5 h-3.5 text-amber-300" strokeWidth={1.6} /> Annotate
          </button>
          <button onClick={() => handleSelectionAction("redact")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-stone-200 text-xs hover:bg-white/10 whitespace-nowrap flex-shrink-0">
            <EyeOff className="w-3.5 h-3.5 text-red-300" strokeWidth={1.6} /> Redact
          </button>
        </div>
      )}

      {/* ============ ANNOTATION: compose a new note ============ */}
      {annotateDraft && (
        <div
          ref={annotateBoxRef}
          data-annotation-popover
          style={{
            position: "fixed",
            left: Math.max(8, Math.min(annotateDraft.rect.left, window.innerWidth - 296)),
            top: Math.min(annotateDraft.rect.bottom + 10, window.innerHeight - 180),
          }}
          className="w-72 bg-white border border-stone-200 rounded-lg shadow-xl p-3 z-50"
        >
          <div className="text-xs text-stone-400 mb-1.5 truncate">
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
            <button type="button" onClick={saveAnnotation} className="folio-primary-btn px-3 py-1.5 rounded-lg text-xs font-medium">
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
          }}
          className="w-60 bg-stone-900 text-stone-100 rounded-lg shadow-xl p-3 z-50"
        >
          <div className="text-xs leading-relaxed mb-2.5">{openAnnotation.note}</div>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => { setAnnotations((a) => a.filter((x) => x.id !== openAnnotation.id)); setOpenAnnotation(null); }}
              className="flex items-center gap-1 text-xs text-red-300 hover:text-red-200"
            >
              <Trash2 className="w-3 h-3" strokeWidth={1.8} /> Remove
            </button>
            <button type="button" onClick={() => setOpenAnnotation(null)} className="text-xs text-stone-400 hover:text-white">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   FORTIZO APP SHELL — no side navigation. Just a slim header:
   "Subject — Topic" on the left, minimize + close on the right.
   ============================================================ */

export default function FortizoApp() {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isClosed, setIsClosed] = useState(false);

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === "Escape") setIsClosed(true); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  if (isClosed) {
    return (
      <div className="font-sans h-screen w-screen flex items-center justify-center bg-gray-100">
        <button
          onClick={() => setIsClosed(false)}
          className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-sm text-gray-700 shadow hover:bg-gray-50 transition-colors duration-150"
        >
          Reopen {SUBJECT} · {TOPIC}
        </button>
      </div>
    );
  }

  return (
    <div className="font-sans bg-gray-100 text-gray-800 flex flex-col h-screen w-screen overflow-hidden">
      <style>{GLOBAL_CSS}</style>

      <header className="h-14 flex-shrink-0 bg-white border-b border-gray-200 flex items-center justify-between px-4 z-30">
        <div className="flex items-center gap-1.5 min-w-0 text-sm sm:text-base">
          <span className="font-semibold text-gray-800 truncate">{SUBJECT}</span>
          <span className="text-gray-300 flex-shrink-0">-</span>
          <span className="text-gray-500 truncate">{TOPIC}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setIsMinimized((m) => !m)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors duration-150"
            aria-label={isMinimized ? "Restore" : "Minimize"}
          >
            {isMinimized ? <Maximize2 className="w-4 h-4" strokeWidth={2} /> : <Minimize2 className="w-4 h-4" strokeWidth={2} />}
          </button>
          <button
            onClick={() => setIsClosed(true)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors duration-150"
            aria-label="Close"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
      </header>

      {!isMinimized && <Fortizo docTitle={DOC_TITLE} />}
    </div>
  );
}
