// Session reader state, effects and handlers.
//
// Extracted verbatim from SessionReaderModal: the modal keeps the markup and
// calls this hook once. No behaviour lives here that did not live in the
// component before.
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { useIsMobileView } from "../../../hooks/useIsMobileView.js";
import { selectionRects } from "../../../lib/markRects.js";
import { hydrateReaderTabs, loadReaderTabs, saveReaderTabs, dropShadowTabs } from "../../../lib/readerTabCache.js";
import { TAB_KINDS, artifactToTab, marksFromArtifacts, tabContentPatch, tabToArtifact } from "../../../lib/readerArtifacts.js";
import { toReaderCite } from "../../../lib/askAnswer.js";
import {
  TOOL_DEFS, toolById, SERVER_TOOLS, isServerPodcast, FORM_DEFS, mediaTime,
  deriveToolContent, cleanFocusText,
} from "../components/sessionReaderModel.js";

export function useSessionReader({
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
  /* chatState — which chat sits beside the reader on desktop/tablet:
     "ask" (the default) puts the Ask panel there; "agent" puts the
     session chat (chatNode) there. Mobile ignores it — the reader keeps
     its tabs and the session stays underneath, as before. */
  chatState = "ask",
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
  /* sourceCitations — a gathered content's citation map: { list:
     [{ marker, name, ownerName }], onOpen(marker) }. The text's [n] markers
     become chips; a Sources list closes the document; both open the
     ORIGINAL source (the host swaps readers and returns on close). */
  sourceCitations = null,
  /* folderNav — this document was opened from a folder: { items:
     [{ id, name }], activeId, onSelect(id), onBack() }. A scrollable row of
     the folder's contents under the tab pills, led by a back arrow. */
  folderNav = null,
  /* folderHome — a React node rendered INSTEAD of the pages: a folder
     opened in the reader shows its contents here (Original Content). */
  folderHome = null,
  /* onForeignCite — a citation that points at ANOTHER document (a folder
     tool/Ask citation naming its source): the host opens that document
     instead of jumping inside this one. */
  onForeignCite = null,
}) {
  const isMobile = useIsMobileView();
  const sideAsk = !isMobile && chatState === "ask" && !!ask;
  const split = !isMobile && (!!chatNode || sideAsk);

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

  /* tools: Generate dropdown / forms / result tabs.
     Tabs (including the Ask tab) hydrate from the per-document cache, so a
     reopen paints the pill strip immediately; the artifacts list reconciles. */
  const initialTabsRef = useRef(null);
  if (initialTabsRef.current === null) initialTabsRef.current = hydrateReaderTabs(loadReaderTabs(readerPosKey));
  const initialTabs = initialTabsRef.current;
  const [formTool, setFormTool] = useState(null);
  const [prefillFocus, setPrefillFocus] = useState("");
  const [resultTabs, setResultTabs] = useState(() => initialTabs.resultTabs);
  const [activeTabId, setActiveTabId] = useState(() => initialTabs.activeTabId);
  const nextResultId = useRef(initialTabs.nextResultId);
  const [genMenuOpen, setGenMenuOpen] = useState(false);
  const genMenuRef = useRef(null);

  /* community: Q&A and Discussion — persistent boards, opened as tabs */
  const [qaThreads, setQaThreads] = useState([]);
  const [discussionThreads, setDiscussionThreads] = useState([]);
  const [communityTabsOpen, setCommunityTabsOpen] = useState(() => initialTabs.communityTabsOpen);
  const [askPin, setAskPin] = useState(null);   // { pageNumber, text } from "Ask about this"
  const [savedItems, setSavedItems] = useState(() => initialTabs.savedItems);   // saved tabs not open right now

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
    // A PDF page is often TALLER than the reader pane, so it can never be 50%
    // visible — the old 0.5 threshold left the pager stuck on an earlier page
    // after a citation jump. Track every page's ratio and take the most visible.
    const ratios = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = parseInt(entry.target.dataset.pageIndex, 10);
          if (Number.isFinite(idx)) ratios.set(idx, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        let best = -1, bestRatio = 0.12;
        for (const [idx, ratio] of ratios) if (ratio > bestRatio) { best = idx; bestRatio = ratio; }
        if (best >= 0) setCurrentPage((cur) => (cur !== best ? best : cur));
      },
      { root, threshold: [0, 0.15, 0.3, 0.5, 0.75, 1] }
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
    // A gathered content's [n] markers become citation chips (the marker
    // must be one of the record's saved sources — anything else stays text).
    if (sourceCitations?.list?.length) {
      const valid = new Set(sourceCitations.list.map((s) => Number(s.marker)));
      html = html.replace(/\[(\d{1,2})\]/g, (m, n) => (valid.has(Number(n))
        ? `<button type="button" class="ak-src-chip" data-src-marker="${n}" title="Open the source">${n}</button>` : m));
    }
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
    const chipEl = e.target.closest("[data-src-marker]");
    if (chipEl && sourceCitations?.onOpen) {
      sourceCitations.onOpen(Number(chipEl.dataset.srcMarker));
      return;
    }
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
    // In ask state on desktop/tablet the Ask panel is already beside the
    // reader — there is no tab to open (a selection pin still lands above).
    if (id === "ask" && sideAsk) { setSelection(null); setGenMenuOpen(false); return; }
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
    setPrefillFocus(cleanFocusText(focus));
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
      id, toolId, values, createdPage, createdAt: new Date().toISOString(),
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
    // "Selected pages" is a real scope for the server tools: page numbers ride
    // with their text so pages without an extraction still ground the request.
    const picked = Array.isArray(values.pages) ? [...values.pages].sort((a, b) => a - b) : [];
    const scopeArg = values.scope === "Whole document" ? "document"
      : values.scope === "Selected pages" ? "pages" : "page";
    const pageNumbers = scopeArg === "pages" ? picked : undefined;
    const pageTexts = scopeArg === "pages"
      ? picked.map((n) => ({ pageNumber: n, text: pages[n - 1]?.text || "" })).filter((t) => t.text)
      : undefined;
    const attached = Array.isArray(values.context) ? values.context : [];
    const contextRecordIds = attached.filter((c) => c.type === "record").map((c) => c.id);
    const contextFolderIds = attached.filter((c) => c.type === "folder").map((c) => c.id);
    // A real podcast episode: the server makes the saved item at once
    // ("making") and fills it in a minute or two — the tab opens now and
    // polls; the learner keeps reading meanwhile.
    if (isServerPodcast(tools, toolId)) {
      const createdPage = currentPage;
      const { scope, ...podcastValues } = values;
      tools.podcast.start({
        scope: scopeArg,
        pageNumber: createdPage + 1,
        ...(pageNumbers ? { pageNumbers } : {}),
        ...(pageTexts ? { pageTexts } : {}),
        ...(contextRecordIds.length ? { contextRecordIds } : {}),
        ...(contextFolderIds.length ? { contextFolderIds } : {}),
        pageText: pages[createdPage]?.text || "",
        values: { ...podcastValues, scope: values.scope, pages: pageNumbers || [] },
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
        scope: scopeArg,
        pageNumber: createdPage + 1,
        ...(pageNumbers ? { pageNumbers } : {}),
        ...(pageTexts ? { pageTexts } : {}),
        ...(contextRecordIds.length ? { contextRecordIds } : {}),
        ...(contextFolderIds.length ? { contextFolderIds } : {}),
        pageText: pages[createdPage]?.text || "",
        values: { ...toolValues, pages: pageNumbers || [] },
      }).then((r) => {
        // The server may have applied page/count/difficulty/exam intent from
        // the Prompt — reflect what it actually did in the tab subtitle.
        const applied = r?.appliedIntent;
        const tabValues = applied ? {
          ...values,
          ...(applied.scope === "document" ? { scope: "Whole document", pages: [] }
            : applied.scope === "pages" ? { scope: "Selected pages", pages: applied.pageNumbers || [] } : {}),
          ...(applied.count ? { count: String(applied.count) } : {}),
          ...(applied.difficulty ? { difficulty: applied.difficulty } : {}),
        } : values;
        openResultTab(toolId, tabValues, createdPage, toTabContent(toolId, r));
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
        id, toolId, values, createdPage: currentPage, createdAt: new Date().toISOString(),
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
    const loadSaved = (attempt) => artifacts.list().then((list) => {
      if (!alive) return;
      const open = [];
      const closed = [];
      for (const a of list || []) if (TAB_KINDS.has(a.kind)) (a.open ? open : closed).push(a);
      // A tab made in Agent Chat opens even if the learner closed it since.
      const wanted = initialArtifactId ? closed.find((a) => a.id === initialArtifactId) : null;
      if (wanted) { closed.splice(closed.indexOf(wanted), 1); open.push(wanted); }
      const tabs = open.map((a) => artifactToTab(a, "r" + nextResultId.current++));
      tabs.forEach((t) => lastSavedRef.current.set(t.artifactId, JSON.stringify(tabContentPatch(t))));
      // Reconcile the cached (instant) tabs with the authoritative list:
      // refreshed content keeps the cached id; closed/deleted artifacts leave;
      // server tabs not cached are added.
      const openById = new Map(open.map((a) => [a.id, a]));
      setResultTabs((rt) => {
        const kept = [];
        for (const t of dropShadowTabs(rt, open)) {
          if (!t.artifactId) { kept.push(t); continue; }
          const a = openById.get(t.artifactId);
          if (a) kept.push({ ...artifactToTab(a, t.id), loading: false });
        }
        const seen = new Set(kept.map((t) => t.artifactId).filter(Boolean));
        for (const t of tabs) if (!seen.has(t.artifactId)) kept.push(t);
        return kept;
      });
      const focus = initialArtifactId ? tabs.find((t) => t.artifactId === initialArtifactId) : null;
      if (focus) setActiveTabId(focus.id);
      setSavedItems(closed);
      const marks = marksFromArtifacts(list);
      setAnnotations((x) => [...marks.annotations, ...x]);
      setRedactions((x) => [...marks.redactions, ...x]);
    }).catch((err) => {
      // One retry: a reopen immediately after closing can race the session/API
      // and the first list came back empty or failed — the saved tabs then
      // looked lost until a tool was opened (which lists them again).
      if (alive && attempt < 1 && !/not found|unauthor/i.test(String(err?.message || ''))) {
        setTimeout(() => { if (alive) loadSaved(attempt + 1); }, 1200);
      }
    });
    loadSaved(0);
    return () => { alive = false; };
  }, [artifacts]);

  /* Cache the tab strip (pills + Ask) so the next open paints it at once. */
  useEffect(() => {
    saveReaderTabs(readerPosKey, { resultTabs, communityTabsOpen, activeTabId, savedItems });
  }, [readerPosKey, resultTabs, communityTabsOpen, activeTabId, savedItems]);

  /* A cached tab whose artifact was closed/deleted elsewhere must not leave
     the reader pointing at nothing. */
  useEffect(() => {
    if (activeTabId === "reader" || communityTabsOpen.includes(activeTabId)) return;
    if (activeTabId.startsWith("tool:")) return;
    if (!resultTabs.some((t) => t.id === activeTabId)) setActiveTabId("reader");
  }, [activeTabId, communityTabsOpen, resultTabs]);

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

  /* Deleting a creation from its tool's list: the tab goes and the saved
   * item is deleted for real (podcast audio goes with it, server-side). */
  function deleteResultTab(tab) {
    setResultTabs((rt) => rt.filter((t) => t.id !== tab.id));
    if (tab.artifactId) {
      lastSavedRef.current.delete(tab.artifactId);
      artifacts?.remove(tab.artifactId).catch(() => {});
    }
    if (activeTabId === tab.id) switchTabTo(`tool:${tab.toolId}`);
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
  const activeListKind = activeTabId.startsWith("tool:") ? activeTabId.slice(5) : null;

  /* Citations: jump the reader to the source page and flash the cited line. */
  function citeJump(cite) {
    if (!cite) return;
    // A folder citation names another document in the folder: the host
    // opens it (the jump stays inside THIS document otherwise).
    if (cite.sourceRecordId && onForeignCite) { setGenMenuOpen(false); onForeignCite(cite); return; }
    setGenMenuOpen(false);
    setActiveTabId("reader");
    // A recording citation: seek the player to the moment.
    if (Number.isFinite(cite.startMs) && !Number.isInteger(cite.page)) {
      playerApi?.seekTo?.(cite.startMs / 1000);
      return;
    }
    const targetPage = Math.min(cite.page, pages.length - 1);
    // Select the page in the pager/thumbnails immediately: the scroll alone
    // left it unselected when the cited page was taller than the pane.
    setCurrentPage(targetPage);
    // Pages the jump passes over never paint, and a page's selectable text
    // layer was only built when it painted — that is why the pages above a
    // citation target became unselectable. Ask those pages to build their
    // layers once the reader pane is actually mounted (the dispatch runs in
    // the frame below, not now: on mobile the reader may not be mounted yet).
    const buildSkippedLayers = () => {
      const from = Math.max(0, Math.min(currentPage, targetPage));
      const to = Math.min(pages.length - 1, targetPage + 1);
      for (let i = from; i <= to; i += 1) {
        window.dispatchEvent(new CustomEvent("akoro:reader-textlayer", { detail: { index: i } }));
      }
    };
    requestAnimationFrame(() => {
      goToPage(targetPage);
      buildSkippedLayers();
      setTimeout(buildSkippedLayers, 350);   // catches a pane that mounted late
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

  // A folder opened in the reader has only its Original Content (the
  // contents grid) until a document is picked — no tool tabs over a folder.
  /* One pill per tool kind (Matt, 2026-11-17): the strip holds the reader,
   * any community tabs, and one pill per tool that has creations — the
   * badge carries the count (open tabs + closed saved items of the kind). */
  const kindPills = ["summary", "quiz", "flashcards", "podcast", "video", "notes"]
    .map((k) => ({
      id: `tool:${k}`, toolId: k, noClose: true,
      count: resultTabs.filter((t) => t.toolId === k).length + savedItems.filter((a) => a.kind === k).length,
    }))
    .filter((pill) => pill.count > 0);
  const allTabs = [{ id: "reader" }, ...communityTabsOpen.map((id) => ({ id })), ...kindPills];

  return {
    docTitle, sourceName, docKey, pages, onClose, chatNode, onOpenChat, onExplainSelection,
    renderPageContent, media, rawPages, pageBlocks, transcript, onTranscribe, transcribeState,
    transcribeError, discussion, ask, chatState, tools, artifacts, jumpTo, sourceCitations,
    folderNav, folderHome, onForeignCite,
    isMobile, sideAsk, split, isMedia, activeTabId, allTabs, activeResultTab, activeListKind, kindPills,
    currentPage, zoom, pageNumDraft, setPageNumDraft, commitPageNumDraft, viewerRef, zoomTo, goToPage,
    formTool, setFormTool, prefillFocus, resultTabs, genMenuOpen, setGenMenuOpen, genMenuRef,
    handleToolPick, handleFormSubmit, openForm, switchTabTo, closeTab, openCommunityTab,
    retryPodcast, updateResultTab, openSavedItem, deleteSavedItem, deleteResultTab,
    savedItems, qaThreads, setQaThreads, discussionThreads, setDiscussionThreads,
    communityTabsOpen, askPin, setAskPin, playerApi, setPlayerApi, playerState, setPlayerState, isPlaying, setIsPlaying,
    selection, selPos, selMenuRef, handleSelectionAction, buildPageHtml, handleViewerClick,
    annotations, setAnnotations, redactions, revealedRedactions, openAnnotation, setOpenAnnotation,
    annotateDraft, annotateText, setAnnotateDraft, setAnnotateText, saveAnnotation, citeJump,
    TOOL_DEFS, SERVER_TOOLS, isServerPodcast, FORM_DEFS, toolById, mediaTime,
  };
}
