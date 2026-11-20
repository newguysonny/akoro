/**
 * RecordTeachSession.jsx — opening a library record starts a TEACHING
 * session over it, not a preview pane.
 *
 * The learner teaches their agent over the record's ACTUAL material, with
 * everything a teaching session has: the WebSocket teach-back flow,
 * confidence, turn budget, continuation and revision history. The record
 * is the content — the compact content box above the composer opens it in
 * the reader (mobile: full-screen over the chat; desktop/tablet: the
 * Fortizo split beside it):
 *
 *   PDF    → the real pages (pdf.js canvas + selectable text layer; the
 *            Generate tools derive from the page's real text)
 *   text   → the file's text, paginated like a session guide
 *   paste  → the pasted text, paginated the same way
 *   image  → the image on the page paper, zoomable
 *   audio  → the original recording — play/pause, ±10s, seek, 0.75×–2×
 *   video  → the original video, same transport in the shared toolbar
 *   other  → honest "download to view" card (Word docs in v1)
 *   missing→ a legacy device record — details were saved, bytes never were;
 *            the session says so instead of pretending
 *
 * GROUNDING: text-bearing records (paste, text files, PDFs — whose text the
 * loader already extracts) become the session's reference, so the agent
 * asks about the material's real sentences, not just its name. The server
 * caps references at 12,000 chars; we slice to fit.
 *
 * AI EXTRACTION (hanji-parse-4b on RunPod): SCANNED PDFs (no text layer)
 * and image records have nothing to ground — this reader offers to EXTRACT
 * the text: pages are rasterized here (pdf.js / the loaded image), parsed
 * by the worker through /api/records/extract, cached per page, and the
 * result replaces the blank page texts AND grounds the session — the
 * scanned doc behaves like a text PDF afterwards (selectable, Generate-
 * tools-capable). The canvases stay as the visual page; extraction only
 * fills the words.
 *
 * CONTINUATION: the teaching session's id is remembered (sessionStorage,
 * 24h) per record, so reopening a record continues yesterday's teaching
 * instead of always starting cold. Watched-through milestones keep the
 * shelf's progress bar honest via onProgress.
 */

import { useLang } from '../../../contexts/LanguageContext.jsx';
import { TeachAgentModal } from '../../teaching/index.js';
import { Icon } from '../../../components/common/Icons.jsx';
import { BRAND } from '../../../constants.js';
import ExtractionCard from '../../../components/library/ExtractionCard.jsx';
import ImagePage from '../../../components/library/ImagePage.jsx';
import { recordDownloadUrl } from '../../../services/recordsApi.js';
import { useRecordSession } from '../hooks/useRecordSession.js';

export { recordFileType } from './recordFileType.js';

/* ── Honest cards for the modes the reader can't render ── */
function PlainCard({ icon, color, title, body, action }) {
  return (
    <div style={{ width: '100%', minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 4px' }}>
      <div style={{ textAlign: 'center', maxWidth: 340 }}>
        <div style={{ width: 64, height: 64, margin: '0 auto 12px', borderRadius: 18, background: `${color}18`,
          border: `1px solid ${color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={28} color={color}/>
        </div>
        <p style={{ fontSize: 14, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 6px', fontFamily: "'Nunito',sans-serif" }}>{title}</p>
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ak-text-sub)', margin: 0, lineHeight: 1.6, fontFamily: "'Nunito',sans-serif" }}>{body}</p>
        {action}
      </div>
    </div>
  );
}

const BOX_ICON = { pdf: 'ti-file-text', docx: 'ti-file-text', pptx: 'ti-presentation', text: 'ti-file-text', paste: 'ti-clipboard', image: 'ti-photo', audio: 'ti-headphones', video: 'ti-video', other: 'ti-file-download', missing: 'ti-cloud-off' };

/* sessionStorage continuation — one teaching thread per record, 24h. */
const sidKey = (rid) => `akoro_teach_sid_${rid || 'x'}`;
const readStoredSid = (rid) => {
  try {
    const raw = JSON.parse(sessionStorage.getItem(sidKey(rid)) || 'null');
    return raw?.sid && Date.now() - (raw.at || 0) < 86_400_000 ? raw.sid : null;
  } catch { return null; }
};
const storeSid = (rid, sid) => {
  try { sid ? sessionStorage.setItem(sidKey(rid), JSON.stringify({ sid, at: Date.now() })) : sessionStorage.removeItem(sidKey(rid)); }
  catch { /* private mode */ }
};

export default function RecordTeachSession({ record, onClose, onMinimize, onOpened, onProgress,
  chatState = 'ask',    // the reader's chat state: 'ask' (default) | 'agent' (opened via Agent session)
  openTool = null,      // a study tool to open the reader on (an Agent Chat link)
  openArtifact = null,  // a saved tab to open the reader on (made in Agent Chat)
  downloadUrl = null,   // records from the discovery feed ride a presigned
                        // URL — the shelf's /:id/file route is owner-scoped
  folderNav = null,     // opened from a folder: the reader shows the
                        // folder's contents row (host owns the selection)
}) {
  const { t } = useLang();
  const {
    state, err, pages, pdfParts, reference, extract, setExtract, pdfBlocks, avTranscript, officeErr,
    discussionCommunities, sourceSession, setSourceSession, openSource,
    ask, tools, artifacts, askTarget,
    startExtraction, startTranscription,
    type, isMedia, fileUrl, handlePosition,
  } = useRecordSession({ record, onOpened, onProgress });

  /* ── Loading / error overlays — same family as the reader itself ── */
  if (state !== 'ready') {
    return (
      <div role="dialog" aria-label="Opening record"
        style={{ position: 'fixed', inset: 0, zIndex: 3100, background: 'var(--ak-bg)', display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: "'Nunito',sans-serif",
          animation: 'sheet-up .32s cubic-bezier(.32,1.1,.64,1)' }}>
        {state === 'loading' ? (<>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: `${BRAND}18`, border: `1px solid ${BRAND}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <Icon name="ti-file-text" size={22} color={BRAND}/>
          </div>
          <p style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 6px' }}>{record?.name}</p>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sub)', margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span className="ti ti-loader-2" style={{ fontSize: 14, color: BRAND, animation: 'rteach-spin 1s linear infinite' }}/>
            Preparing your document…
          </p>
          <style>{'@keyframes rteach-spin{to{transform:rotate(360deg)}}'}</style>
        </>) : (<>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <Icon name="ti-cloud-off" size={22} color="#EF4444"/>
          </div>
          <p style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 6px' }}>{record?.name}</p>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sub)', margin: '0 0 18px', maxWidth: 300, textAlign: 'center', lineHeight: 1.55 }}>{err}</p>
        </>)}
        <button onClick={onClose} style={{ marginTop: 6, background: 'var(--ak-tag-bg)', border: 'none', borderRadius: 100,
          padding: '10px 22px', fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-sub)', cursor: 'pointer',
          fontFamily: "'Nunito',sans-serif" }}>{t('common.close')}</button>
      </div>
    );
  }

  /* ── Ready — the teaching session with the record as its material ── */
  const dlUrl = downloadUrl || recordDownloadUrl(record.id);
  const media = isMedia ? {
    kind: type,
    src: fileUrl,
    title: record.name,
    onPosition: handlePosition,
    downloadUrl: dlUrl,
    downloadName: record.name,
  } : null;

  const renderPageContent = (i) => {
    if (type === 'pdf' && pdfParts?.pdf) {
      const PdfCanvas = pdfParts.PdfPage;
      // Library content selects over the EXTRACTED markdown layer (not the
      // pdf.js layer). Before extraction finishes, PdfPage falls back to the
      // pdf.js layer for that page so selection is never dead.
      // pdf.js keeps the selectable layer (pixel-accurate); the extraction's
      // blocks ride along for the Layout overlay and citation flash. Selecting
      // with the extracted layer is opt-in only — it left text PDFs whose
      // block layer hadn't laid out yet with NO selectable words.
      return <PdfCanvas pdf={pdfParts.pdf} pageNumber={i + 1} blocks={pdfBlocks.get(i + 1)}/>;
    }
    if (type === 'image') {
      return <ImagePage src={fileUrl} alt={record.name} blocks={pdfBlocks.get(1)}/>;
    }
    if (record.kind === 'upload' && record.fileMissing) {
      return (
        <PlainCard icon="ti-cloud-off" color="#F59E0B"
          title={t('records.file_missing_title')}
          body={t('records.file_missing_body')}/>
      );
    }
    if ((type === 'docx' || type === 'pptx') && officeErr) {
      return (
        <PlainCard icon="ti-file-alert" color="#F59E0B"
          title={record.name}
          body={officeErr}
          action={(
            <a href={dlUrl} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14,
              background: `linear-gradient(135deg, ${BRAND}, #4C1DCC)`, color: '#fff', fontSize: 12.5, fontWeight: 800,
              padding: '11px 20px', borderRadius: 100, textDecoration: 'none', fontFamily: "'Nunito',sans-serif" }}>
              <Icon name="ti-download" size={14}/> {t('records.download')}
            </a>
          )}/>
      );
    }
    if (type === 'other') {
      return (
        <PlainCard icon="ti-file-download" color={BRAND}
          title={record.name}
          body={t('records.not_viewable')}
          action={(
            <a href={dlUrl} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14,
              background: `linear-gradient(135deg, ${BRAND}, #4C1DCC)`, color: '#fff', fontSize: 12.5, fontWeight: 800,
              padding: '11px 20px', borderRadius: 100, textDecoration: 'none', fontFamily: "'Nunito',sans-serif" }}>
              <Icon name="ti-download" size={14}/> {t('records.download')}
            </a>
          )}/>
      );
    }
    return null;
  };

  const content = {
    state: 'ready',
    box: {
      icon: BOX_ICON[type] || 'ti-file-text',
      title: record.name,
      sub: `${reference ? 'Text attached · ' : ''}tap to open the material`,
    },
    pct: record.progress || 0,
    docTitle: record.name,
    sourceName: `Library record · ${record.kind}`,
    media,
    pages,
    renderPageContent,
    rawPages: type === 'pdf',   // canvases carry their own margins; images/cards keep the padded card
    // Extraction blocks per page — generated summaries/quiz citations carry
    // the exact block bbox, and citeJump flashes that region on the scan.
    pageBlocks: pages.map((_, i) => pdfBlocks.get(i + 1) || null),
    // A/V transcript segments — the reader lists them under the player;
    // clicking a segment seeks the recording to that moment.
    transcript: avTranscript,
    // Community discussion — persistent group chat of every community
    // this record is connected to (the discussion is owned by the
    // community; the record merely hosts it while open).
    discussion: discussionCommunities ? { communities: discussionCommunities } : null,
    // Ask — the reader's whole-document Q&A with jump-to-source citations.
    ask,
    // Real Summary / Quiz / Flashcards over the document (cited).
    tools,
    // Generated tabs, notes and annotations — kept across visits.
    artifacts,
    // Gathered content: the citation map rides to the reader — [n] markers
    // become chips and a Sources list closes the document.
    sourceCitations: Array.isArray(record?.sources) && record.sources.length
      ? { list: record.sources, onOpen: openSource } : null,
    // Opened from a folder: the contents row under the tab pills.
    folderNav,
  };

  /* A remembered session id (24h) makes reopening a record CONTINUE its
     teaching thread instead of always starting cold — same continuation the
     Learn shelf gives teaching sessions. Closing keeps it: the shelf keeps
     the session too. */
  const priorSid = readStoredSid(record.id);

  /* ── AI extraction overlay — offer / progress / result ─────────────────── */
  const extractOverlay = (
    <ExtractionCard
      extract={extract}
      onExtract={startExtraction}
      onTranscribe={startTranscription}
      onDismiss={() => setExtract(null)}
      type={extract?.av ? 'av' : type === 'image' ? 'image' : 'pdf'}
    />
  );

  return (
    <>
      <TeachAgentModal
      config={{
        topic: record.name,
        subject: 'General',
        reference,
        // The CONTENT READER is the main display, exactly like the Pharm.D
        // topic flow — mobile included. Without this, mobile defaulted to the
        // teaching chat, so opening a library PDF showed "Preparing your
        // teaching session…" (and stalled if the teach socket struggled)
        // instead of the document. The chat opens from the reader's icon.
        // An Agent session opening starts on the teaching chat instead.
        readerFirst: chatState !== 'agent',
        chatState,
        ...(openTool ? { openTool } : {}),
        ...(openArtifact ? { openArtifact } : {}),
        // The whole document: the session searches it every turn and the
        // protégé cites the passages it used (chips jump the reader).
        ...(askTarget ? { document: askTarget } : {}),
        ...(priorSid ? { sessionId: priorSid, mode: 'continuation' } : {}),
      }}
      content={content}
      onClose={onClose}
      onMinimize={onMinimize}
      onSessionSaved={(sid) => storeSid(record.id, sid)}
    />
      {extractOverlay}
      {/* The original source, opened from a citation — its own reader,
          stacked over this one; closing it returns to the gathered content. */}
      {sourceSession && (
        <RecordTeachSession
          record={sourceSession}
          downloadUrl={sourceSession.kind === 'upload' ? sourceSession.fileUrl : null}
          onClose={() => setSourceSession(null)}
          onMinimize={() => setSourceSession(null)}
        />
      )}
    </>
  );
}
