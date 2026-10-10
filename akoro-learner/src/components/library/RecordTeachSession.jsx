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

import { useEffect, useMemo, useRef, useState } from 'react';
import TeachAgentModal from '../teaching/TeachAgentModal.jsx';
import { buildSessionReaderPages } from '../teaching/SessionReaderModal.jsx';
import { officeReaderPages } from '../../lib/officePages.js';
import { recordDownloadUrl, extractStoredRecordText, getRecordExtraction, getSharedExtraction, getRecordTranscript, getSharedTranscript, startRecordTranscription, getRecordTranscriptionStatus, getAskHistory, askRecord, generateRecordTool, startRecordPodcast, getRecordPodcast, listRecordArtifacts, saveRecordArtifact, updateRecordArtifact, deleteRecordArtifact } from '../../services/recordsApi.js';
import { Icon } from '../common/Icons.jsx';
import { BRAND } from '../../constants.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { rasterizePdfPages, rasterizeImageFile, runRecordExtraction } from './extractPages.js';
import ImagePage from './ImagePage.jsx';
import { fetchItemCommunities } from '../../services/communityApi.js';

const MAX_TEXT_CHARS = 500_000;   // a 500k-char text file ≈ 190 reader pages — plenty
const MAX_REFERENCE_CHARS = 12_000;   // the server's reference cap

const AUDIO_RE = /^audio\//, VIDEO_RE = /^video\//, IMAGE_RE = /^image\//;
const TEXT_MIME = new Set(['text/plain', 'text/markdown', 'text/csv']);
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|flac)$/i, VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)$/i;
const TEXT_EXT  = /\.(txt|md|csv)$/i;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export const recordFileType = (r) => {
  if (!r || r.kind !== 'upload') return null;
  const mime = r.mime || '', name = r.name || '';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (AUDIO_RE.test(mime) || AUDIO_EXT.test(name)) return 'audio';
  if (VIDEO_RE.test(mime) || VIDEO_EXT.test(name)) return 'video';
  if (IMAGE_RE.test(mime)) return 'image';
  if (TEXT_MIME.has(mime) || TEXT_EXT.test(name)) return 'text';
  if (mime === DOCX_MIME || /\.docx$/i.test(name)) return 'docx';
  if (mime === PPTX_MIME || /\.pptx$/i.test(name)) return 'pptx';
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
  downloadUrl = null,   // records from the discovery feed ride a presigned
                        // URL — the shelf's /:id/file route is owner-scoped
}) {
  const { t } = useLang();
  const [state, setState] = useState('loading');          // loading | ready | error
  const [err, setErr]     = useState('');
  const [pages, setPages] = useState([]);
  const [pdfParts, setPdfParts] = useState(null);         // { pdf, texts, PdfPage } — pdf.js loads only when a PDF opens
  const [reference, setReference] = useState(null);       // text grounding for the agent
  const openedRef = useRef(false);
  const progressRef = useRef(record?.progress || 0);

  /* ── AI extraction (scanned PDFs & images) ──────────────────────────────
     offer    → the record has no text layer; ask before spending GPU time
     running  → rasterizing/parsing, progress done/total
     applied  → text replaced the blanks (transient confirmation)
     error    → show why, offer retry / read-as-is */
  const [extract, setExtract] = useState(null);
  const [pdfBlocks, setPdfBlocks] = useState(() => new Map());  // page → layout blocks (extraction overlay)
  const [avTranscript, setAvTranscript] = useState(null);       // { segments } — audio/video transcript
  const [officeErr, setOfficeErr] = useState('');               // a Word / PowerPoint file the server couldn't read
  // The communities (of mine) this record is connected to — the reader's
  // gate for its community discussion. null = lookup not resolved yet
  // (reader keeps the previous behavior); [] = connected to none: the
  // discussion feature doesn't exist on this content; [..] = the chat
  // rides the reader.
  const [discussionCommunities, setDiscussionCommunities] = useState(null);
  const textsRef  = useRef([]);      // the load flow's per-page text layer (≈'' for scans)
  const applyRef  = useRef(null);    // set by the load flow; applies parsed pages to the session
  // False once the reader closes: extraction polling stops instead of
  // running on (and setting state) after unmount.
  const aliveRef  = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  // Ask — questions about this whole document, answered with citations.
  // Uploads with a file (shared ones by their content key) and pastes;
  // links and detail-only records have nothing to search. Memoized: the
  // reader's Ask tab reloads its thread when this object changes.
  const askTarget = record?.contentKey
    ? { contentKey: record.contentKey }
    : (record?.id && (record.kind === 'paste' || (record.kind === 'upload' && !record.fileMissing)) ? { recordId: record.id } : null);
  const askKey = askTarget ? (askTarget.contentKey || askTarget.recordId) : null;
  const ask = useMemo(() => (askKey ? {
    load: () => getAskHistory(askTarget),
    send: (opts) => askRecord({ ...askTarget, ...opts }),
  } : null), [askKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Study tools (summary / quiz / flashcards) generated from the document,
  // every item citing where it came from.
  const tools = useMemo(() => (askKey ? {
    generate: (tool, args) => generateRecordTool({ ...askTarget, tool, ...args }),
    // Podcast episodes are made by the server after the request — start, then poll.
    podcast: {
      start: (args) => startRecordPodcast({ ...askTarget, ...args }),
      get: (id) => getRecordPodcast(id),
    },
  } : null), [askKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Saved reader items: generated tabs, notes, annotations — restored on reopen.
  const artifacts = useMemo(() => (askKey ? {
    list: () => listRecordArtifacts(askTarget),
    save: (body) => saveRecordArtifact(askTarget, body),
    update: (id, patch) => updateRecordArtifact(id, patch),
    remove: (id) => deleteRecordArtifact(id),
  } : null), [askKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  const startExtraction = async () => {
    const apply = applyRef.current;
    if (!apply || !record?.id) return;
    setExtract((s) => ({ ...s, status: 'running', done: 0, error: null }));
    try {
      let rendered;
      if (type === 'pdf' && pdfParts?.pdf) {
        rendered = await rasterizePdfPages(pdfParts.pdf);
      } else if (type === 'image' && fileUrl) {
        rendered = await rasterizeImageFile(fileUrl);
      } else {
        throw new Error('Nothing extractable in this record.');
      }
      // Only send pages the file doesn't have yet — a retry (or a partly
      // extracted file) must not pay to re-parse pages already saved.
      const readSaved = () => (record.contentKey ? getSharedExtraction(record.contentKey) : getRecordExtraction(record.id));
      const savedBefore = await readSaved();
      const have = new Set((savedBefore?.pages || []).map((p) => p.pageNumber));
      const toSend = rendered.filter((p) => !have.has(p.pageNumber));
      const res = toSend.length ? await runRecordExtraction({
        recordId: record.id,
        contentKey: record.contentKey || null,   // shared file → parsed once for everyone
        pages: toSend,
        onProgress: (done, total) => { if (aliveRef.current) setExtract((s) => ({ ...s, done, total })); },
        isCancelled: () => !aliveRef.current,
        readSaved,
      }) : { pages: [], failed: [], error: null };
      if (!aliveRef.current) return;
      // Apply everything the file now has: earlier saved pages + this run.
      const allPages = [
        ...(savedBefore?.pages || []).filter((p) => !res.pages.some((r) => r.pageNumber === p.pageNumber)),
        ...res.pages,
      ];
      if (!allPages.length) throw new Error(res.error || 'Extraction returned no text — try again.');
      const byPage = new Map(allPages.map((p) => [p.pageNumber, p.markdown]));
      const blocksByPage = new Map(allPages.filter((p) => Array.isArray(p.blocks) && p.blocks.length).map((p) => [p.pageNumber, p.blocks]));
      apply(byPage, blocksByPage);
      setExtract({ status: 'applied', done: allPages.length, total: rendered.length, error: res.error || null });
      // A partial run keeps its notice up: the failed pages must be seen.
      if (!res.error) setTimeout(() => setExtract((s) => (s?.status === 'applied' ? null : s)), 6000);
    } catch (e) {
      if (!aliveRef.current) return;
      setExtract((s) => ({ ...s, status: 'error', error: e?.message || 'Extraction failed.' }));
    }
  };

  /* ── A/V transcription — ffmpeg 16k-mono → Deepgram on the server.
     offer → running (poll the job) → applied: the transcript grounds the
     session and lists under the player with click-to-seek. */
  const startTranscription = async () => {
    if (!record?.id) return;
    setExtract((s) => ({ ...s, status: 'running', done: 0, error: null, elapsed: 0 }));
    const t0 = Date.now();
    const tick = setInterval(() => setExtract((s) => (s?.status === 'running'
      ? { ...s, elapsed: Math.round((Date.now() - t0) / 1000) } : s)), 1000);
    try {
      await startRecordTranscription({ recordId: record.id, contentKey: record.contentKey || null });
      // Poll the job — a long lecture takes Deepgram ~20s/100min + captions.
      for (;;) {
        await new Promise((r) => setTimeout(r, 5000));
        const d = await getRecordTranscriptionStatus({ recordId: record.id, contentKey: record.contentKey || null });
        if (!d?.job?.running) {
          if (d?.job?.result?.ok === false) throw new Error(d.job.result.error || 'Transcription failed.');
          break;
        }
      }
      const { segments } = await getRecordTranscript(record.id);
      if (!segments?.length) throw new Error('No speech came out of this recording.');
      setAvTranscript({ segments });
      const text = segments.map((s) => (s.speaker ? `[${s.speaker}] ${s.text}` : s.text)).join('\n\n');
      // The transcript becomes the session's grounding. (This called the
      // load effect's `ready` helper, which is not in scope here — every
      // finished transcription threw "ready is not defined".)
      setPages([{ html: '', text: '' }]);
      setPdfParts(null);
      setReference({ name: record.name, text: text.slice(0, MAX_REFERENCE_CHARS) });
      setExtract({ status: 'applied', done: segments.length, total: segments.length, error: null });
      setTimeout(() => setExtract((s) => (s?.status === 'applied' ? null : s)), 6000);
    } catch (e) {
      setExtract((s) => ({ ...s, status: 'error', error: e?.message || 'Transcription failed.' }));
    } finally {
      clearInterval(tick);
    }
  };

  const type   = record?.kind === 'upload' && record.fileMissing ? 'missing' : recordFileType(record);
  const isMedia = type === 'audio' || type === 'video';
  const fileUrl = record?.fileUrl || null;

  /* Load what the mode needs — pages, pdf parts and the reference — then
     hand the teaching session its material. */
  useEffect(() => {
    let cancelled = false;
    openedRef.current = false;
    setState('loading');
    setErr('');
    setPages([]);
    setPdfParts(null);
    setReference(null);
    setExtract(null);
    setPdfBlocks(new Map());
    setAvTranscript(null);
    setOfficeErr('');
    textsRef.current = [];
    applyRef.current = null;

    const fail = (msg) => { if (!cancelled) { setErr(msg); setState('error'); } };
    const ready = (pgs, parts = null, ref = null) => {
      if (cancelled) return;
      setPages(pgs);
      setPdfParts(parts);
      setReference(ref);
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
        const text = String(record.content || '');
        ready(buildSessionReaderPages({
          topic: record.name,
          subject: 'Library record',
          reference: { name: 'Pasted text', text },
        }), null, text ? { name: record.name, text: text.slice(0, MAX_REFERENCE_CHARS) } : null);
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
          // Generate tools work on the document's real sentences. The same
          // text grounds the teaching session.
          const joined = texts.join('\n\n');
          textsRef.current = texts;

          // applyExtracted — swap the page texts (and the grounding) for the
          // parsed markdown; the canvases stay as the visual page. Blocks
          // ride along for the per-page Layout overlay.
          const applyExtracted = (byPage, blocksByPage) => {
            const perPage = texts.map((tx, i) => ({ html: '', text: byPage.get(i + 1) || tx || '' }));
            const md = perPage.map((p) => p.text).filter(Boolean).join('\n\n').trim();
            setPdfBlocks(blocksByPage instanceof Map ? blocksByPage : new Map());
            ready(perPage, { pdf, PdfPage },
              md ? { name: record.name, text: md.slice(0, MAX_REFERENCE_CHARS) } : null);
          };

          // A text layer thinner than ~20 chars/page is a scan — extraction
          // is the only way this record grounds the session.
          const scanned = joined.replace(/\s+/g, '').length < 20 * Math.max(1, texts.length);
          if (!scanned) {
            // Ask, the tools and the tutor's document search read the
            // server's copy of this text: an older upload may not have one
            // yet — ask for it quietly (a no-op once it exists).
            void extractStoredRecordText(record.contentKey ? { contentKey: record.contentKey } : { recordId: record.id }).catch(() => {});
            ready(texts.map((tx) => ({ html: '', text: tx })), { pdf, PdfPage },
              joined ? { name: record.name, text: joined.slice(0, MAX_REFERENCE_CHARS) } : null);
            return;
          }

          const cached = record.contentKey ? await getSharedExtraction(record.contentKey) : await getRecordExtraction(record.id);
          if (cancelled) return;
          const byPage = new Map((cached.pages || [])
            .filter((p) => (p.markdown || '').trim())
            .map((p) => [p.pageNumber, p.markdown]));
          const blocksByPage = new Map((cached.pages || [])
            .filter((p) => Array.isArray(p.blocks) && p.blocks.length)
            .map((p) => [p.pageNumber, p.blocks]));
          const haveAll = texts.length > 0 && texts.every((_, i) => byPage.has(i + 1));
          if (haveAll) {
            applyExtracted(byPage, blocksByPage);   // cached — straight into a grounded session
            return;
          }
          applyRef.current = applyExtracted;
          setExtract({ status: 'offer', done: 0, total: texts.length });
          ready(texts.map((tx) => ({ html: '', text: tx })), { pdf, PdfPage }, null);
        } else if (type === 'text') {
          // The server's pages when it has them (or can make them now): the
          // reader's pages then match the citations Ask and the tools give.
          const target = record.contentKey ? { contentKey: record.contentKey } : { recordId: record.id };
          let saved = await (record.contentKey ? getSharedExtraction(record.contentKey) : getRecordExtraction(record.id));
          if (!(saved.pages || []).length) saved = await extractStoredRecordText(target).catch(() => ({ pages: [] }));
          if (cancelled) return;
          const docPages = officeReaderPages(saved.pages || [], { kind: 'text', name: record.name });
          if (docPages.length) {
            const md = docPages.map((p) => p.text).filter(Boolean).join('\n\n').trim();
            ready(docPages, null, md ? { name: record.name, text: md.slice(0, MAX_REFERENCE_CHARS) } : null);
            return;
          }
          const res = await fetch(fileUrl);
          if (!res.ok) throw new Error(`Could not load the file (${res.status}).`);
          const raw = await res.text();
          const text = raw.length > MAX_TEXT_CHARS ? raw.slice(0, MAX_TEXT_CHARS) : raw;
          ready(buildSessionReaderPages({
            topic: record.name,
            subject: 'Library record',
            reference: { name: record.name, text },
          }), null, text ? { name: record.name, text: text.slice(0, MAX_REFERENCE_CHARS) } : null);
        } else if (type === 'docx' || type === 'pptx') {
          // Word / PowerPoint: the server read the file's text into pages at
          // upload. Older uploads (or a failed first read) are read now;
          // while another open holds the job, wait for it briefly.
          const read = () => (record.contentKey ? getSharedExtraction(record.contentKey) : getRecordExtraction(record.id));
          const target = record.contentKey ? { contentKey: record.contentKey } : { recordId: record.id };
          let saved = await read();
          for (let attempt = 0; !cancelled && !(saved.pages || []).length && attempt < 30; attempt += 1) {
            let out;
            try { out = await extractStoredRecordText(target); }
            catch (e) {
              if (cancelled) return;
              setOfficeErr(e?.message || 'This file could not be read.');
              ready([{ html: '', text: '' }]);
              return;
            }
            if ((out.pages || []).length) { saved = out; break; }
            await new Promise((r) => setTimeout(r, 2000));   // another open is reading it
            if (cancelled) return;
            saved = await read();
          }
          if (cancelled) return;
          const docPages = officeReaderPages(saved.pages || [], { kind: type, name: record.name });
          if (!docPages.length) {
            setOfficeErr('This file is still being read — reopen it in a moment.');
            ready([{ html: '', text: '' }]);
            return;
          }
          const md = docPages.map((p) => p.text).filter(Boolean).join('\n\n').trim();
          ready(docPages, null, md ? { name: record.name, text: md.slice(0, MAX_REFERENCE_CHARS) } : null);
        } else if (type === 'image') {
          // An image never carries a text layer — the cache is checked and
          // otherwise the offer overlay goes up over the plain image page.
          // Its blocks become a selectable text layer over the picture.
          const applyImage = (byPage, blocksByPage) => {
            const md = (byPage.get(1) || '').trim();
            if (blocksByPage instanceof Map) setPdfBlocks(blocksByPage);
            ready([{ html: '', text: md }], null,
              md ? { name: record.name, text: md.slice(0, MAX_REFERENCE_CHARS) } : null);
          };
          const cached = record.contentKey ? await getSharedExtraction(record.contentKey) : await getRecordExtraction(record.id);
          if (cancelled) return;
          const first = (cached.pages || []).find((p) => p.pageNumber === 1 && (p.markdown || '').trim());
          const md = first?.markdown;
          if (md) {
            if (Array.isArray(first.blocks) && first.blocks.length) setPdfBlocks(new Map([[1, first.blocks]]));
            ready([{ html: '', text: md }], null, { name: record.name, text: md.slice(0, MAX_REFERENCE_CHARS) });
            return;
          }
          applyRef.current = applyImage;
          setExtract({ status: 'offer', done: 0, total: 1 });
          ready([{ html: '', text: '' }]);
        } else if (type === 'audio' || type === 'video') {
          // The recording plays as-is; a transcript (cached or offered)
          // grounds the session in the real words.
          const { segments } = record.contentKey ? await getSharedTranscript(record.contentKey) : await getRecordTranscript(record.id);
          if (cancelled) return;
          if (segments?.length) {
            const text = segments.map((s) => (s.speaker ? `[${s.speaker}] ${s.text}` : s.text)).join('\n\n');
            setAvTranscript({ segments });
            // The transcript becomes the session's grounding. (This called the
      // load effect's `ready` helper, which is not in scope here — every
      // finished transcription threw "ready is not defined".)
      setPages([{ html: '', text: '' }]);
      setPdfParts(null);
      setReference({ name: record.name, text: text.slice(0, MAX_REFERENCE_CHARS) });
            return;
          }
          setExtract({ status: 'offer', av: true, done: 0, total: 1 });
          ready([{ html: '', text: '' }]);
        } else {
          // other — nothing to preload
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

  /* Which of my communities hold this record → the reader's discussion.
     Best-effort and never blocking: a slow lookup must not delay the
     material, and a failed one simply keeps the reader as it was. */
  useEffect(() => {
    let cancelled = false;
    setDiscussionCommunities(null);
    if (!record?.id) return undefined;
    fetchItemCommunities({ itemType: 'record', itemRef: String(record.id) })
      .then((list) => { if (!cancelled) setDiscussionCommunities(Array.isArray(list) ? list : []); })
      .catch(() => { if (!cancelled) setDiscussionCommunities([]); });
    return () => { cancelled = true; };
  }, [record?.id]);

  /* First open → 10% progress + last-opened stamp (caller's job). */
  useEffect(() => {
    if (state === 'ready' && !openedRef.current) {
      openedRef.current = true;
      onOpened?.(record);
    }
  }, [state, record, onOpened]);

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
  };

  /* A remembered session id (24h) makes reopening a record CONTINUE its
     teaching thread instead of always starting cold — same continuation the
     Learn shelf gives teaching sessions. Closing keeps it: the shelf keeps
     the session too. */
  const priorSid = readStoredSid(record.id);

  /* ── AI extraction overlay — offer / progress / result ─────────────────── */
  const extractPct = extract?.total ? Math.round(((extract.done || 0) / extract.total) * 100) : 0;
  const btnPrimary = { flex: 1, border: 'none', borderRadius: 100, padding: '11px 0', fontSize: 12.5,
    fontWeight: 800, color: '#fff', background: `linear-gradient(135deg, ${BRAND}, #4C1DCC)`,
    cursor: 'pointer', fontFamily: "'Nunito',sans-serif" };
  const btnGhost = { border: '1px solid var(--ak-border2, #E5E7EB)', borderRadius: 100, padding: '11px 16px',
    fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-sub)', background: 'transparent',
    cursor: 'pointer', fontFamily: "'Nunito',sans-serif" };
  const extractOverlay = extract ? (
    <div role="dialog" aria-label="AI text extraction" style={{ position: 'fixed', inset: 0, zIndex: 3400,
      background: 'rgba(10,12,24,.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: 20, fontFamily: "'Nunito',sans-serif" }}>
      <div style={{ width: 'min(400px, 100%)', background: 'var(--ak-surface)', borderRadius: 22,
        padding: '22px 20px 18px', border: '1px solid var(--ak-border2, #E5E7EB)',
        boxShadow: '0 18px 48px rgba(15,23,42,.28)' }}>
        {extract.status === 'running' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span className="ti ti-loader-2" style={{ fontSize: 18, color: BRAND, animation: 'rteach-spin 1s linear infinite' }}/>
              <strong style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)' }}>Extracting the text…</strong>
            </div>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ak-text-sub)', margin: '0 0 12px' }}>
              {extract.av
                ? `Transcribing${extract.elapsed ? ` — ${extract.elapsed}s` : ''}. Long recordings take a minute or two; this stays open until it's done.`
                : extract.total > 1 ? `Page ${Math.min(extract.done + 1, extract.total)} of ${extract.total}` : 'Reading the page'}
            </p>
            <div style={{ height: 8, borderRadius: 5, background: 'var(--ak-tag-bg, #EEF0F5)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(6, extractPct)}%`, height: '100%', borderRadius: 5,
                background: `linear-gradient(90deg, ${BRAND}, #4C1DCC)`, transition: 'width .4s ease' }}/>
            </div>
          </>
        ) : extract.status === 'error' ? (
          <>
            <strong style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)' }}>Extraction didn't finish</strong>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ak-text-sub)', margin: '8px 0 14px', lineHeight: 1.5 }}>
              {extract.error}{extract.done ? ` ${extract.done} page${extract.done === 1 ? '' : 's'} were saved — a retry only parses the rest.` : ''}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={startExtraction} style={btnPrimary}>Try again</button>
              <button onClick={() => setExtract(null)} style={btnGhost}>Read as-is</button>
            </div>
          </>
        ) : extract.status === 'applied' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 34, height: 34, borderRadius: 12, background: 'rgba(16,185,129,.12)',
                border: '1px solid rgba(16,185,129,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="ti-check" size={18} color="#10B981"/>
              </span>
              <strong style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)' }}>Text extracted</strong>
            </div>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ak-text-sub)', margin: '8px 0 0', lineHeight: 1.5 }}>
              {extract.done} page{extract.done === 1 ? '' : 's'} now read like a text document — the agent teaches from the real words.
              {extract.error ? ` (${extract.error})` : ''}
            </p>
            {extract.error && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={startExtraction} style={btnPrimary}>Retry the missing pages</button>
                <button onClick={() => setExtract(null)} style={btnGhost}>Dismiss</button>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ width: 34, height: 34, borderRadius: 12, background: `${BRAND}15`,
                border: `1px solid ${BRAND}38`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="ti-sparkles" size={17} color={BRAND}/>
              </span>
              <strong style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)' }}>
                {extract.av ? 'Transcribe this recording?' : type === 'image' ? 'Extract the text from this image?' : 'Scanned document detected'}
              </strong>
            </div>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ak-text-sub)', margin: '6px 0 14px', lineHeight: 1.55 }}>
              {extract.av
                ? 'Turn the speech into a timestamped transcript (with speakers). The agent teaches from the real words, and every line jumps the player to that moment.'
                : `This ${type === 'image' ? 'image has no readable text layer' : "PDF has no readable text layer — it's a scan"}. Extract the text with AI and it reads like a normal document: the agent can teach from it, quote it and quiz you on it.`}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={extract.av ? startTranscription : startExtraction} style={btnPrimary}>{extract.av ? 'Transcribe' : 'Extract text'}</button>
              <button onClick={() => setExtract(null)} style={btnGhost}>Read as-is</button>
            </div>
          </>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      <TeachAgentModal
      config={{
        topic: record.name,
        subject: 'General',
        reference,
        // The whole document: the session searches it every turn and the
        // protégé cites the passages it used (chips jump the reader).
        ...(askTarget ? { document: askTarget } : {}),
        ...(priorSid ? { sessionId: priorSid, mode: 'continuation' } : {}),
      }}
      content={content}
      onClose={onClose}
      onMinimize={onMinimize}
      onSessionStarted={(sid) => storeSid(record.id, sid)}
    />
      {extractOverlay}
    </>
  );
}
