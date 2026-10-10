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
import { useEffect, useState } from 'react';
import TeachAgentModal from '../teaching/TeachAgentModal.jsx';
import { Icon } from '../common/Icons.jsx';
import { BRAND } from '../../constants.js';

const MAX_REFERENCE_CHARS = 12_000;   // the server's reference cap

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
      } catch (e) {
        if (!cancelled) { setErr(e?.message || 'Could not open this topic.'); setState('error'); }
      }
    })();
    return () => { cancelled = true; };
    // Keyed on the topic identity — reopening a different topic reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic?.id, topic?.file_url]);

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
          <a href="/signin?next=/app" style={{ textDecoration: 'none', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff', fontSize: 12.5, fontWeight: 800, padding: '11px 20px', borderRadius: 100, fontFamily: "'Nunito',sans-serif" }}>Sign in</a>
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
    sourceName: `PHARM.D · ${courseLabel}`,
    media: null,
    pages,
    renderPageContent,
    rawPages: true,            // pdf.js canvases carry their own margins
  };

  /* A remembered session id (24h) makes reopening a topic CONTINUE its
     teaching thread — same continuation the course video gives. */
  const priorSid = readStoredSid(topic?.id);

  return (
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
      onSessionStarted={(sid) => storeSid(topic?.id, sid)}
    />
  );
}
