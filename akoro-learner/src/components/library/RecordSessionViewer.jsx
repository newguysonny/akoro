/**
 * RecordSessionViewer.jsx — opening a library record opens a SESSION,
 * not a preview pane.
 *
 * The same full-screen reader the teaching session uses (SessionReaderModal
 * — its tab strip, Generate tools, Q&A and Discussion boards), with the
 * record's ACTUAL file as the content:
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
 *            the viewer says so instead of pretending
 *
 * While a record plays, watched-through milestones (10%, 20%, …) update the
 * shelf's progress bar via onProgress.
 */

import { useEffect, useRef, useState } from 'react';
import SessionReaderModal, { buildSessionReaderPages } from '../teaching/SessionReaderModal.jsx';
import { recordDownloadUrl } from '../../services/recordsApi.js';
import { Icon } from '../common/Icons.jsx';
import { BRAND } from '../../constants.js';
import { useLang } from '../../contexts/LanguageContext.jsx';

const MAX_TEXT_CHARS = 500_000;   // a 500k-char text file ≈ 190 reader pages — plenty

const AUDIO_RE = /^audio\//, VIDEO_RE = /^video\//, IMAGE_RE = /^image\//;
const TEXT_MIME = new Set(['text/plain', 'text/markdown', 'text/csv']);
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|flac)$/i, VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)$/i;
const TEXT_EXT  = /\.(txt|md|csv)$/i;

export const recordFileType = (r) => {
  if (!r || r.kind !== 'upload') return null;
  const mime = r.mime || '', name = r.name || '';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (AUDIO_RE.test(mime) || AUDIO_EXT.test(name)) return 'audio';
  if (VIDEO_RE.test(mime) || VIDEO_EXT.test(name)) return 'video';
  if (IMAGE_RE.test(mime)) return 'image';
  if (TEXT_MIME.has(mime) || TEXT_EXT.test(name)) return 'text';
  return 'other';
};

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
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ak-text-muted)', margin: 0, lineHeight: 1.6, fontFamily: "'Nunito',sans-serif" }}>{body}</p>
        {action}
      </div>
    </div>
  );
}

export default function RecordSessionViewer({ record, onClose, onOpened, onProgress }) {
  const { t } = useLang();
  const [state, setState] = useState('loading');          // loading | ready | error
  const [err, setErr]     = useState('');
  const [pages, setPages] = useState([]);
  const [pdfParts, setPdfParts] = useState(null);         // { pdf, texts, PdfPage } — pdf.js loads only when a PDF opens
  const openedRef = useRef(false);
  const progressRef = useRef(record?.progress || 0);

  const type   = record?.kind === 'upload' && record.fileMissing ? 'missing' : recordFileType(record);
  const isMedia = type === 'audio' || type === 'video';
  const fileUrl = record?.fileUrl || null;

  /* Load what the mode needs, then hand the reader its pages. */
  useEffect(() => {
    let cancelled = false;
    openedRef.current = false;
    setState('loading');
    setErr('');
    setPages([]);
    setPdfParts(null);

    const fail = (msg) => { if (!cancelled) { setErr(msg); setState('error'); } };
    const ready = (pgs, parts = null) => {
      if (cancelled) return;
      setPages(pgs);
      setPdfParts(parts);
      setState('ready');
    };

    (async () => {
      if (!record) return fail('This record is empty.');
      if (record.kind === 'upload' && record.fileMissing) {
        // Legacy device record — details only, the bytes were never captured.
        ready([{ html: '', text: '' }]);
        return;
      }
      if (record.kind === 'paste') {
        ready(buildSessionReaderPages({
          topic: record.name,
          subject: 'Library record',
          reference: { name: 'Pasted text', text: String(record.content || '') },
        }));
        return;
      }
      if (record.kind === 'link') { return fail('Links open in a new tab.'); }
      if (record.kind !== 'upload' || !fileUrl) return fail('This record has no saved file.');

      try {
        if (type === 'pdf') {
          // pdf.js is a big dependency — it loads only when a PDF opens.
          const { loadPdfDocument, PdfPage } = await import('./PdfPages.jsx');
          const { pdf, texts } = await loadPdfDocument(fileUrl);
          // The pages ARE the PDF's pages — text kept beside each so the
          // Generate tools work on the document's real sentences.
          ready(texts.map((tx) => ({ html: '', text: tx })), { pdf, PdfPage });
        } else if (type === 'text') {
          const res = await fetch(fileUrl);
          if (!res.ok) throw new Error(`Could not load the file (${res.status}).`);
          const raw = await res.text();
          const text = raw.length > MAX_TEXT_CHARS ? raw.slice(0, MAX_TEXT_CHARS) : raw;
          ready(buildSessionReaderPages({
            topic: record.name,
            subject: 'Library record',
            reference: { name: record.name, text },
          }));
        } else {
          // image / audio / video / other — nothing to preload
          ready([{ html: '', text: '' }]);
        }
      } catch (e) {
        fail(e?.message || 'Could not open this record.');
      }
    })();

    return () => { cancelled = true; };
    // Deliberately keyed on identity-relevant fields — the parent's list
    // refreshes give a new object for the same record and must not re-load
    // (that would drop scroll position and restart playback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id, type, fileUrl]);

  /* First open → 10% progress + last-opened stamp (caller's job). */
  useEffect(() => {
    if (state === 'ready' && !openedRef.current) {
      openedRef.current = true;
      onOpened?.(record);
    }
  }, [state, record, onOpened]);

  /* Escape closes the loading/error overlays too (the reader handles its own). */
  useEffect(() => {
    if (state === 'ready') return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, onClose]);

  const handlePosition = (pct) => {
    if (pct > progressRef.current) {
      progressRef.current = pct;
      onProgress?.(record, pct);
    }
  };

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
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span className="ti ti-loader-2" style={{ fontSize: 14, color: BRAND, animation: 'spin 1s linear infinite' }}/>
            Opening your record…
          </p>
        </>) : (<>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <Icon name="ti-cloud-off" size={22} color="#EF4444"/>
          </div>
          <p style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 6px' }}>{record?.name}</p>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '0 0 18px', maxWidth: 300, textAlign: 'center', lineHeight: 1.55 }}>{err}</p>
        </>)}
        <button onClick={onClose} style={{ marginTop: 6, background: 'var(--ak-tag-bg)', border: 'none', borderRadius: 100,
          padding: '10px 22px', fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-sub)', cursor: 'pointer',
          fontFamily: "'Nunito',sans-serif" }}>{t('common.close')}</button>
      </div>
    );
  }

  /* ── Ready — the session reader with the record as its content ── */
  const downloadUrl = recordDownloadUrl(record.id);
  const media = isMedia ? {
    kind: type,
    src: fileUrl,
    title: record.name,
    onPosition: handlePosition,
    downloadUrl,
    downloadName: record.name,
  } : null;

  const renderPageContent = (i) => {
    if (type === 'pdf' && pdfParts?.pdf) {
      const PdfCanvas = pdfParts.PdfPage;
      return <PdfCanvas pdf={pdfParts.pdf} pageNumber={i + 1}/>;
    }
    if (type === 'image') {
      return <img src={fileUrl} alt={record.name} style={{ width: '100%', height: 'auto', borderRadius: 8, display: 'block' }}/>;
    }
    if (record.kind === 'upload' && record.fileMissing) {
      return (
        <PlainCard icon="ti-cloud-off" color="#F59E0B"
          title={t('records.file_missing_title')}
          body={t('records.file_missing_body')}/>
      );
    }
    if (type === 'other') {
      return (
        <PlainCard icon="ti-file-download" color={BRAND}
          title={record.name}
          body={t('records.not_viewable')}
          action={(
            <a href={downloadUrl} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14,
              background: `linear-gradient(135deg, ${BRAND}, #4C1DCC)`, color: '#fff', fontSize: 12.5, fontWeight: 800,
              padding: '11px 20px', borderRadius: 100, textDecoration: 'none', fontFamily: "'Nunito',sans-serif" }}>
              <Icon name="ti-download" size={14}/> {t('records.download')}
            </a>
          )}/>
      );
    }
    return null;
  };

  const hasCustomPages = type === 'pdf' || type === 'image' || type === 'other' || (record.kind === 'upload' && record.fileMissing);

  return (
    <SessionReaderModal
      docTitle={record.name}
      sourceName={isMedia
        ? (type === 'audio' ? 'Library record · audio' : 'Library record · video')
        : 'Library record'}
      pages={pages}
      onClose={onClose}
      renderPageContent={hasCustomPages ? renderPageContent : null}
      media={media}
      allowTextMarking={type !== 'pdf' && type !== 'image'}
    />
  );
}
