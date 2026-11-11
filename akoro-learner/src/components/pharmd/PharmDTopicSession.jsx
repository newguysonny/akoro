/**
 * PharmDTopicSession.jsx — opening a PHARM.D topic starts a TEACHING
 * session over it, exactly like the course video (AgentSessionViewer)
 * and library records (RecordTeachSession) — with the one difference
 * the product asked for: the CONTENT READER is the main display, and
 * the teach session opens from the reader's chat icon.
 *
 * Both modals are reused as-is:
 *   · SessionReaderModal (via TeachAgentModal) — the content renderer:
 *     the topic's REAL PDF pages (pdf.js canvas + selectable text
 *     layer), the Generate tools (summary/quiz/flashcards derive from
 *     the page's real sentences), annotations and Q&A.
 *   · TeachAgentModal — the teach session modal: the WebSocket
 *     teach-back flow, confidence, continuation, revision history.
 *
 *   Desktop/tablet: the Fortizo split out of the box — reader left,
 *     live session chat right (TeachAgentModal already auto-opens it).
 *   Mobile: config.readerFirst makes the reader the default
 *     full-screen display; the chat icon in the reader's tab strip
 *     brings up the session chat (it runs underneath the whole time —
 *     nothing restarts when switching between them).
 *
 * GROUNDING: the PDF's extracted text (up to the server's 12,000-char
 * reference cap) becomes the session's reference, so the agent asks
 * about the topic's real sentences, not just its name.
 *
 * CONTINUATION: the teaching session's id is remembered per topic
 * (sessionStorage, 24h), so reopening a topic continues its thread.
 * Guests get the honest sign-in prompt (same as course videos).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import TeachAgentModal from '../teaching/TeachAgentModal.jsx';
import ExtractionCard from '../library/ExtractionCard.jsx';
import { Icon } from '../common/Icons.jsx';
import { BRAND } from '../../constants.js';
import { APP_HOME } from '../../config/target.js';
import { askPharmd } from '../../services/pharmdApi.js';
import { getSharedExtraction } from '../../services/recordsApi.js';

const MAX_REFERENCE_CHARS = 12_000;   // the server's reference cap

/* The Ask gateway tags a citation with its page; the extraction knows the exact
   block. Match the quoted passage to a block so the jump flashes that paragraph
   on the page instead of the whole sheet. */
function bboxForQuote(blocks, pageNumber, quote) {
  const list = blocks?.get?.(pageNumber) || [];
  const norm = (x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const q = norm(quote);
  if (!q || !list.length) return null;
  for (const probe of [q.slice(0, 80), q.slice(0, 40)]) {
    const hit = list.find((b) => norm(b?.text_content).includes(probe));
    if (Array.isArray(hit?.bbox_2d) && hit.bbox_2d.length === 4) return hit.bbox_2d;
  }
  return null;
}

/* sessionStorage continuation — one teaching thread per topic, 24h. */
const sidKey = (tid) => `akoro_teach_sid_pharmd_${tid || 'x'}`;
const readStoredSid = (tid) => {
  try {
    const raw = JSON.parse(sessionStorage.getItem(sidKey(tid)) || 'null');
    return raw?.sid && Date.now() - (raw.at || 0) < 86_400_000 ? raw.sid : null;
  } catch { return null; }
};
const storeSid = (tid, sid) => {
  try { sid ? sessionStorage.setItem(sidKey(tid), JSON.stringify({ sid, at: Date.now() })) : sessionStorage.removeItem(sidKey(tid)); }
  catch { /* private mode */ }
};

export default function PharmDTopicSession({ topic, course, onClose }) {
  const [state, setState] = useState('loading');          // loading | ready | error
  const [err, setErr]     = useState('');
  const [pages, setPages] = useState([]);                 // [{ html:'', text }] — text drives the Generate tools
  const [pdfParts, setPdfParts] = useState(null);         // { pdf, PdfPage } — pdf.js loads only when a topic opens
  const [reference, setReference] = useState(null);       // text grounding for the agent
  const [pageBlocks, setPageBlocks] = useState(null);     // pageNumber → extraction blocks (citation flash)
  // { status:'offer'|'running'|'error'|'applied', done, total, error }
  const [extract, setExtract] = useState(null);
  const extRunRef = useRef(0);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  /* Guests can't run teaching sessions — say so instead of failing dark. */
  const uid = (() => { try { return (JSON.parse(localStorage.getItem('akoro_user')) || {}).id || null; } catch { return null; } })();

  /* Load the topic's PDF — the public bucket URL, same seam the library
     record loader uses (pdf.js draws, getTextContent feeds the tools). */
  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setErr('');
    setPages([]);
    setPdfParts(null);
    setReference(null);
    setPageBlocks(null);
    setExtract(null);
    extRunRef.current += 1;   // a run for the previous topic must not apply here

    (async () => {
      if (!topic?.id) return;
      if (!topic?.file_url) {
        if (!cancelled) { setErr('No PDF is attached to this topic yet.'); setState('error'); }
        return;
      }
      try {
        // pdf.js is a big dependency — it loads only when a PDF opens.
        const { loadPdfDocument, PdfPage } = await import('../library/PdfPages.jsx');
        const { pdf, texts } = await loadPdfDocument(topic.file_url);
        if (cancelled) return;
        // The pages ARE the PDF's pages — text kept beside each so the
        // Generate tools work on the document's real sentences. The same
        // text grounds the teaching session.
        const joined = texts.join('\n\n');
        setPages(texts.map((tx) => ({ html: '', text: tx })));
        setPdfParts({ pdf, PdfPage });
        setReference(joined ? { name: topic.title, text: joined.slice(0, MAX_REFERENCE_CHARS) } : null);
        setState('ready');

        // The catalogue file's extraction is SHARED: whoever opened this topic
        // first paid for the pages; everyone after reads the same markdown.
        const contentKey = topic.contentKey;
        if (contentKey) {
          const saved = await getSharedExtraction(contentKey).catch(() => ({ pages: [] }));
          if (cancelled) return;
          if ((saved.pages || []).length) {
            applyExtractedRef.current?.(saved, texts);
          } else {
            setExtract({ status: 'offer', done: 0, total: pdf.numPages });
          }
        }
      } catch (e) {
        if (!cancelled) { setErr(e?.message || 'Could not open this topic.'); setState('error'); }
      }
    })();
    return () => { cancelled = true; };
    // Keyed on the topic identity — reopening a different topic reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic?.id, topic?.file_url]);

  /* Markdown + blocks from the shared cache replace the pdf.js text as the
     grounding; the PDF stays the picture and the selectable layer. */
  const applyExtracted = useCallback((saved, fallbackTexts) => {
    const list = (saved?.pages || []).filter((p) => p && Number.isInteger(p.pageNumber));
    if (!list.length) return false;
    const byPage = new Map(list.map((p) => [p.pageNumber, p.markdown || '']));
    const blocksByPage = new Map(list.filter((p) => Array.isArray(p.blocks) && p.blocks.length).map((p) => [p.pageNumber, p.blocks]));
    setPages((prev) => {
      const base = prev.length ? prev : (fallbackTexts || []).map((tx) => ({ html: '', text: tx }));
      return base.map((p, i) => ({ html: '', text: byPage.get(i + 1) || p.text || '' }));
    });
    setPageBlocks(blocksByPage);
    const md = list.map((p) => p.markdown || '').filter(Boolean).join('\n\n').trim();
    if (md) setReference({ name: topic?.title || 'Topic', text: md.slice(0, MAX_REFERENCE_CHARS) });
    return true;
  }, [topic?.title]);
  const applyExtractedRef = useRef(applyExtracted);
  useEffect(() => { applyExtractedRef.current = applyExtracted; }, [applyExtracted]);

  /* Paid extraction — the SAME card and shared cache as the Library reader. */
  const startExtraction = async () => {
    const pdf = pdfParts?.pdf;
    const contentKey = topic?.contentKey;
    if (!pdf || !contentKey) return;
    const run = ++extRunRef.current;
    const mine = () => aliveRef.current && run === extRunRef.current;
    setExtract((s) => ({ ...s, status: 'running', done: 0, error: null }));
    try {
      // Loaded on demand: pdf.js stays out of the catalogue's initial bundle.
      const { rasterizePdfPages, runRecordExtraction } = await import('../library/extractPages.js');
      const rendered = await rasterizePdfPages(pdf);
      const savedBefore = await getSharedExtraction(contentKey).catch(() => ({ pages: [] }));
      const have = new Set((savedBefore.pages || []).map((p) => p.pageNumber));
      const toSend = rendered.filter((p) => !have.has(p.pageNumber));
      const res = toSend.length ? await runRecordExtraction({
        contentKey,
        pages: toSend,
        onProgress: (done, total) => { if (mine()) setExtract((s) => ({ ...s, done, total })); },
        isCancelled: () => !mine(),
        readSaved: () => getSharedExtraction(contentKey),
      }) : { pages: [], error: null };
      if (!mine()) return;
      const allPages = [
        ...(savedBefore.pages || []).filter((p) => !res.pages.some((r) => r.pageNumber === p.pageNumber)),
        ...res.pages,
      ];
      if (!allPages.length) throw new Error(res.error || 'Extraction returned no text — try again.');
      applyExtracted({ pages: allPages });
      setExtract({ status: 'applied', done: allPages.length, total: rendered.length, error: res.error || null });
      if (!res.error) setTimeout(() => { if (mine()) setExtract((s) => (s?.status === 'applied' ? null : s)); }, 6000);
    } catch (e) {
      if (!mine()) return;
      setExtract((s) => ({ ...s, status: 'error', error: e?.message || 'Extraction failed.' }));
    }
  };

  const topicTitle = topic?.title || 'Topic';
  const courseLabel = course?.title || course?.code || 'PHARM.D';

  /* ── Guests: honest sign-in prompt, no dark failure ── */
  if (!uid) {
    return (
      <div role="dialog" aria-label="Sign in to start an agent session"
        style={{ position: 'fixed', inset: 0, zIndex: 3100, background: 'var(--ak-bg)', display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: "'Nunito',sans-serif",
          animation: 'sheet-up .32s cubic-bezier(.32,1.1,.64,1)' }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, background: `${BRAND}18`, border: `1px solid ${BRAND}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
          <Icon name="ti-lock" size={22} color={BRAND}/>
        </div>
        <p style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 6px' }}>Agent sessions need an account</p>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sub)', margin: '0 0 18px', maxWidth: 300, textAlign: 'center', lineHeight: 1.55 }}>
          Sign in to teach your agent over “{topicTitle}” — your agent remembers every session.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <a href={`/signin?next=${APP_HOME}`} style={{ textDecoration: 'none', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff', fontSize: 12.5, fontWeight: 800, padding: '11px 20px', borderRadius: 100, fontFamily: "'Nunito',sans-serif" }}>Sign in</a>
          <button onClick={onClose} style={{ background: 'var(--ak-tag-bg)', border: 'none', borderRadius: 100,
            padding: '10px 22px', fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-sub)', cursor: 'pointer',
            fontFamily: "'Nunito',sans-serif" }}>Close</button>
        </div>
      </div>
    );
  }

  /* ── Loading / error — same family as the reader itself ── */
  if (state !== 'ready') {
    return (
      <div role="dialog" aria-label="Opening topic"
        style={{ position: 'fixed', inset: 0, zIndex: 3100, background: 'var(--ak-bg)', display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: "'Nunito',sans-serif",
          animation: 'sheet-up .32s cubic-bezier(.32,1.1,.64,1)' }}>
        {state === 'loading' ? (<>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: `${BRAND}18`, border: `1px solid ${BRAND}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <Icon name="ti-file-text" size={22} color={BRAND}/>
          </div>
          <p style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 6px' }}>{topicTitle}</p>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sub)', margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span className="ti ti-loader-2" style={{ fontSize: 14, color: BRAND, animation: 'rteach-spin 1s linear infinite' }}/>
            Preparing your teaching session…
          </p>
          <style>{'@keyframes rteach-spin{to{transform:rotate(360deg)}}'}</style>
        </>) : (<>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <Icon name="ti-cloud-off" size={22} color="#EF4444"/>
          </div>
          <p style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 6px' }}>{topicTitle}</p>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sub)', margin: '0 0 18px', maxWidth: 300, textAlign: 'center', lineHeight: 1.55 }}>{err}</p>
        </>)}
        <button onClick={onClose} style={{ marginTop: 6, background: 'var(--ak-tag-bg)', border: 'none', borderRadius: 100,
          padding: '10px 22px', fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-sub)', cursor: 'pointer',
          fontFamily: "'Nunito',sans-serif" }}>Close</button>
      </div>
    );
  }

  /* ── Ready — the reader as the main display, the session a tap away ── */
  const renderPageContent = (i) => {
    if (pdfParts?.pdf) {
      const PdfCanvas = pdfParts.PdfPage;
      return <PdfCanvas pdf={pdfParts.pdf} pageNumber={i + 1}/>;
    }
    return null;
  };

  const content = {
    state: 'ready',
    box: {
      icon: 'ti-file-text',
      title: topicTitle,
      sub: `${course?.code || 'PHARM.D'} · tap to open the material`,
    },
    pct: null,
    docTitle: topicTitle,
    docKey: `pharmd-topic:${topic?.id || topic?.title || topic?.file_url || 'x'}`,
    sourceName: `PHARM.D · ${courseLabel}`,
    media: null,
    pages,
    renderPageContent,
    rawPages: true,            // pdf.js canvases carry their own margins
    // The extraction's layout blocks ride along so a citation jump flashes the
    // exact paragraph; selection stays on the PDF's own text layer.
    // SessionReaderModal expects an ARRAY indexed by 0-based page.
    pageBlocks: pages.map((_, i) => pageBlocks?.get(i + 1) || null),
    // "Ask about this" + the Ask tool, exactly like the Library reader. The
    // topic PDFs aren't indexed, so the reader sends the text it already has.
    ask: {
      load: async () => [],
      send: async (opts) => {
        const res = await askPharmd({
          ...opts,
          pages: pages.map((p, i) => ({ pageNumber: i + 1, text: p.text || '' })).filter((p) => p.text.trim()),
          docName: topicTitle,
        });
        // Exact-paragraph citation jumps once the model extraction is applied.
        return {
          ...res,
          citations: (res?.citations || []).map((c) => {
            if (Array.isArray(c?.bbox) || !Number.isInteger(c?.pageNumber)) return c;
            const bbox = bboxForQuote(pageBlocks, c.pageNumber, c.quote);
            return bbox ? { ...c, bbox } : c;
          }),
        };
      },
    },
  };

  /* A remembered session id (24h) makes reopening a topic CONTINUE its
     teaching thread — same continuation the course video gives. */
  const priorSid = readStoredSid(topic?.id);

  return (
    <>
    <TeachAgentModal
      config={{
        topic: topicTitle,
        subject: courseLabel,
        reference,
        readerFirst: true,     // the reader is the main display; the chat opens from its icon
        ...(priorSid ? { sessionId: priorSid, mode: 'continuation' } : {}),
      }}
      content={content}
      onClose={onClose}
      onMinimize={onClose}
      onSessionSaved={(sid) => storeSid(topic?.id, sid)}
    />
      <ExtractionCard
        extract={extract}
        onExtract={startExtraction}
        onDismiss={() => setExtract(null)}
        type="pdf"
      />
    </>
  );
}
