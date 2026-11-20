import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSessionReaderPages } from '../../teaching/index.js';
import { officeReaderPages } from '../../../lib/officePages.js';
import { recordFileSrc, extractStoredRecordText, getRecordExtraction, getSharedExtraction, getRecordTranscript, getSharedTranscript, startRecordTranscription, getRecordTranscriptionStatus, getAskHistory, askRecord, generateRecordTool, startRecordPodcast, getRecordPodcast, listRecordArtifacts, saveRecordArtifact, updateRecordArtifact, deleteRecordArtifact, discoverRecordOpen } from '../../../services/recordsApi.js';
import { rasterizePdfPages, rasterizeImageFile, runRecordExtraction } from '../../../components/library/extractPages.js';
import { fetchFileWithRetry } from '../../../lib/fetchFile.js';
import { fetchItemCommunities } from '../../../services/communityApi.js';
import { recordFileType } from '../components/recordFileType.js';

const MAX_TEXT_CHARS = 500_000;   // a 500k-char text file ≈ 190 reader pages — plenty
const MAX_REFERENCE_CHARS = 12_000;   // the server's reference cap

export function useRecordSession({ record, onOpened, onProgress }) {
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
  /* A gathered content's sources: tapping a citation (or a Sources row)
     opens the ORIGINAL record in its own reader on top of this one;
     closing it returns here. The source opens exactly like a Discover
     card — one /discover/:id/open call, then the same session. */
  const [sourceSession, setSourceSession] = useState(null);   // a record-shaped object
  const openSource = async (marker) => {
    const src = (record?.sources || []).find((s) => Number(s.marker) === Number(marker));
    if (!src?.recordId || sourceSession) return;
    try {
      const d = await discoverRecordOpen(src.recordId);
      if (src.kind === 'paste') {
        setSourceSession({ id: src.recordId, kind: 'paste', name: src.name, content: d?.content || '', fileUrl: null });
      } else {
        if (!d?.url) return;
        setSourceSession({ id: src.recordId, kind: 'upload', name: src.name, mime: '', fileUrl: d.url, contentKey: d.contentKey || src.contentKey || null });
      }
    } catch { /* the source is no longer shared — stay on the gathered content */ }
  };
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
      // Free pdf-text pages are not done: this run replaces them page by page.
      const have = new Set((savedBefore?.pages || [])
        .filter((p) => p.model !== 'pdf-text')
        .map((p) => p.pageNumber));
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
  // Uploads are read through the API proxy for the byte-reading paths (PDF /
  // text) — R2 presigned URLs send no CORS headers, so a direct browser fetch
  // is blocked. Media keeps the storage URL so the player can range-request.
  const proxiedBytes = record?.kind === 'upload' && !!record?.id && (type === 'pdf' || type === 'text');
  const fileSrc = proxiedBytes ? recordFileSrc(record.id) : fileUrl;

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
          const { loadPdfDocument, PdfPage } = await import('../../../components/library/PdfPages.jsx');
          const { pdf, texts } = await loadPdfDocument(fileSrc, { credentials: 'include' });
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

          // Every PDF extracts with the model now — text PDFs included — so a
          // library upload gets the same structured markdown (GFM tables,
          // figure sentinels, reading order) a scan would. The pdf.js text
          // still grounds the session until the markdown is ready, and the
          // server's stored-text copy is warmed quietly for Ask/tools citations.
          void extractStoredRecordText(record.contentKey ? { contentKey: record.contentKey } : { recordId: record.id }).catch(() => {});

          const cached = record.contentKey ? await getSharedExtraction(record.contentKey) : await getRecordExtraction(record.id);
          if (cancelled) return;
          const byPage = new Map((cached.pages || [])
            .filter((p) => (p.markdown || '').trim())
            .map((p) => [p.pageNumber, p.markdown]));
          const blocksByPage = new Map((cached.pages || [])
            .filter((p) => Array.isArray(p.blocks) && p.blocks.length)
            .map((p) => [p.pageNumber, p.blocks]));
          // Upload guarantees MODEL markdown. Free pdf-text pages ground the
          // session but do not count as finished: if the model run was
          // interrupted, the offer stays so it can be completed later.
          const modelPages = new Set((cached.pages || [])
            .filter((p) => p.model !== 'pdf-text' && (p.markdown || '').trim())
            .map((p) => p.pageNumber));
          const haveAll = texts.length > 0 && texts.every((_, i) => modelPages.has(i + 1));
          if (haveAll) {
            applyExtracted(byPage, blocksByPage);   // cached — straight into a grounded session
            return;
          }
          if (byPage.size) applyExtracted(byPage, blocksByPage);   // partial: ground on what exists
          applyRef.current = applyExtracted;
          setExtract({ status: 'offer', done: modelPages.size, total: texts.length });
          ready(texts.map((tx) => ({ html: '', text: tx })), { pdf, PdfPage },
            joined ? { name: record.name, text: joined.slice(0, MAX_REFERENCE_CHARS) } : null);
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
          const res = await fetchFileWithRetry(fileSrc, { credentials: 'include' });
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
            // The transcript becomes the session's grounding — and the reader
            // is ready (it stayed on "Preparing…" when this set the pages
            // without marking the load done).
            ready([{ html: '', text: '' }], null, { name: record.name, text: text.slice(0, MAX_REFERENCE_CHARS) });
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

  return {
    state, err, pages, pdfParts, reference, extract, setExtract, pdfBlocks, avTranscript, officeErr,
    discussionCommunities, sourceSession, setSourceSession, openSource,
    ask, tools, artifacts, askTarget,
    startExtraction, startTranscription,
    type, isMedia, fileUrl, handlePosition,
  };
}
