import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  fetchMyActivities, completeActivity, uploadActivityFile, removeActivityFile, downloadActivityFile, downloadMySubmissionPdf, fetchMySubmissionPaper,
  saveActivityAnswer, saveActivityText, fetchActivityFileBlob, saveBlobAs,
} from '../../../services/activityApi.js';
import { onActivityGraded } from '../../../services/activitySocket.js';
import { hasAnswer, stepStatuses, openingAnswers, shownAnswer, lastCheck } from '../../../lib/questionSteps.js';
import { printPaperHtml } from '../../../components/activity/PaperFrame.jsx';
import {
  DRAWING_RE, DOC_RE, FILE_OK, PER_QUESTION_FILES, STATUS, fmtDue,
  loadDoc, loadWork, saveWork, storeDoc, storeKey, typeOf,
} from '../components/activityDetailModel.js';

/**
 * The data side of ActivityDetailPage: fetch, autosave, uploads, timers and
 * the submit hand-in. The page renders what this returns; nothing here draws.
 */
export default function useActivityDetail() {
  const { id } = useParams();
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState('');
  const [work, setWork] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [paperHtml, setPaperHtml] = useState(null);   // my handed-in work as the submission paper (server template)
  const [saved, setSaved] = useState({});   // answers the server holds per question (autosaved)
  const [files, setFiles] = useState([]);   // uploaded so far — each with its question
  const [uploadingQ, setUploadingQ] = useState(null);
  // Files on their way up (a tile with a spinner each) — cancelling one removes it again if it lands.
  const [pending, setPending] = useState([]);
  const cancelledUploads = useRef(new Set());
  const addPending = (question, name) => { const key = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; setPending((p) => [...p, { key, name, question }]); return key; };
  const dropPending = (key) => setPending((p) => p.filter((x) => x.key !== key));
  const cancelPending = (key) => { cancelledUploads.current.add(key); dropPending(key); };
  const [textSave, setTextSave] = useState('');   // the written answer's autosave: saving | saved | error
  const [removing, setRemoving] = useState(null);
  const [fileErr, setFileErr] = useState(null);   // { index, message }
  const [saveErrs, setSaveErrs] = useState({});
  const [board, setBoard] = useState(null);       // the question the whiteboard draws for
  const [doc, setDoc] = useState(null);           // the document being written: { index, initial, dirty } | { index, loading }
  const [checking, setChecking] = useState(false);
  const fileRef = useRef(null);
  // Autosave runs on timers, so it reads the latest row and answers here.
  const rowRef = useRef(null); rowRef.current = row;
  const stepperJump = useRef(null);
  const sheetRef = useRef(null);
  const workRef = useRef(null); workRef.current = work;
  const timers = useRef({});
  const chains = useRef({});
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  useEffect(() => {
    let dead = false;
    fetchMyActivities()
      .then((rows) => {
        if (dead) return;
        const found = rows.find((r) => r.id === id || r.assignmentId === id || `ss-${r.assignmentId}` === id);
        setRow(found || null);
        if (found) {
          // The server's submitted answers, plus this browser's unsent edits
          // unless the server copy is newer (another device moved on).
          const local = loadWork(found.assignmentId);
          const server = found.draft?.answers || {};
          const qs = found.briefDetails?.questions || [];
          const opened = openingAnswers({ saved: server, savedAt: found.draft?.savedAt, local: local.answers, editedAt: local.editedAt });
          // An older pick (option number) shows as its letter, as if typed.
          const answers = Object.fromEntries(Object.entries(opened).map(([k, v]) => [k, shownAnswer(qs[k], v)]));
          setSaved(server);
          setFiles(found.draftFiles || []);
          // The written answer (work without questions): this browser's, unless the server's is newer.
          const serverText = typeof found.draft?.text === 'string' ? found.draft.text : null;
          const localNewer = local.editedAt && (!found.draft?.savedAt || Date.parse(local.editedAt) > Date.parse(found.draft.savedAt));
          setWork({ ...local, answers, text: localNewer || serverText == null ? (local.text || '') : serverText });
          // Typing this browser never got to save — save it now.
          if (found.status !== 'complete' && Array.isArray(qs) && qs.length) {
            const pending = stepStatuses(qs, answers, server).map((st, i) => (st === 'edited' ? i : -1)).filter((i) => i > -1);
            if (pending.length) setTimeout(() => pending.forEach((i) => flushAnswer(i).catch(() => {})), 50);
          }
        }
      })
      .catch(() => { if (!dead) setRow(null); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [id]);

  // The AI is marking: look again every 3s until the score lands (the socket event usually beats this).
  useEffect(() => {
    if (!row?.aiMarking || row.graded) return undefined;
    const aid = row.assignmentId;
    const timer = setInterval(() => {
      fetchMyActivities().then((rows) => { const fresh = rows.find((r) => r.assignmentId === aid); if (fresh) setRow(fresh); }).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [row?.aiMarking, row?.graded, row?.assignmentId]);

  // A teacher (or the AI) publishes the grade while this page is open: show it.
  useEffect(() => onActivityGraded((evt) => {
    const mine = rowRef.current;
    if (!mine || String(evt?.assignmentId) !== String(mine.assignmentId)) return;
    fetchMyActivities()
      .then((rows) => { const fresh = rows.find((r) => r.assignmentId === mine.assignmentId); if (fresh) setRow(fresh); })
      .catch(() => {});
  }), []);

  const t = row ? typeOf(row.kind) : typeOf();
  const isDone = row?.status === 'complete';
  const questions = useMemo(() => {
    const q = row?.briefDetails?.questions;
    return Array.isArray(q) && q.length ? q : null;
  }, [row]);
  const useStepper = !!questions && !row?.graded;
  const fileCounts = useMemo(() => {
    const out = {};
    files.forEach((f) => { if (f.question != null) out[f.question] = (out[f.question] || 0) + 1; });
    return out;
  }, [files]);

  // Autosave only while there is outstanding work — once submitted, the
  // server copy owns the record and the local draft stays cleared.
  useEffect(() => {
    if (row && work && row.status !== 'complete') saveWork(row.assignmentId, work);
  }, [row, work]);

  const submit = async () => {
    setSubmitting(true);
    setSubmitErr('');
    try {
      const typed = Object.fromEntries(Object.entries(workRef.current?.answers ?? {}).filter(([i, v]) => hasAnswer(questions?.[i], v)));
      const payload = {
        text: questions ? '' : (workRef.current?.text ?? ''),
        answers: questions ? typed : {},
        // Every file uploaded for this work is handed in (each with its question).
        fileIds: [],
      };
      const target = await completeActivity(row.assignmentId, payload);
      const handed = target?.submission?.files
        ?? files;
      setRow((r) => ({ ...r, aiMarking: !!r.briefDetails?.ai_auto_grade && r.briefDetails?.ai_release !== 'review', status: 'complete', completedAt: r.completedAt || new Date().toISOString(), submission: { text: payload.text, answers: target?.submission?.answers ?? payload.answers, files: handed, submittedAt: target?.submission?.submittedAt || new Date().toISOString() } }));
      sheetRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' });
      // The server now owns the work — the local draft is spent.
      try { localStorage.removeItem(storeKey(row.assignmentId)); } catch { /* private mode */ }
    } catch (e) {
      setSubmitErr(e?.message || 'Could not submit. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  /* Save one question's answer on the server (null clears it). */
  const saveAnswer = async (index, value) => {
    const r = rowRef.current;
    const q = r?.briefDetails?.questions?.[index];
    const out = await saveActivityAnswer(r.assignmentId, index, hasAnswer(q, value) ? value : null);
    setSaved((s) => {
      const next = { ...s };
      if (out?.value === null || out?.value === undefined) delete next[index]; else next[index] = out.value;
      return next;
    });
  };

  /* Save what's typed for question i now — one save at a time per question,
     always the latest text. */
  function flushAnswer(i) {
    clearTimeout(timers.current[i]);
    delete timers.current[i];
    const run = () => saveAnswer(i, workRef.current?.answers?.[i]).then(
      () => setSaveErrs((e) => ({ ...e, [i]: '' })),
      (e) => { setSaveErrs((x) => ({ ...x, [i]: e?.message || 'Not saved' })); throw e; });
    const p = (chains.current[i] || Promise.resolve()).catch(() => {}).then(run);
    chains.current[i] = p;
    return p;
  }

  /* Typing autosaves after a short pause. */
  const typeAnswer = (i, v) => {
    setWork((w) => ({ ...w, answers: { ...w.answers, [i]: v }, editedAt: new Date().toISOString() }));
    clearTimeout(timers.current[i]);
    timers.current[i] = setTimeout(() => { flushAnswer(i).catch(() => {}); }, 900);
  };

  /* Files belong to a question — up to 3 each, 5MB, uploaded straight away. */
  // Files are validated at once, each gets its spinner tile straight away, and they upload one after another
  // (picking more while some are going up queues them instead of being ignored).
  const uploadChain = useRef(Promise.resolve());
  const inFlight = useRef(0);
  const pickFiles = (i, list) => {
    const picked = Array.from(list || []);
    if (!picked.length) return Promise.resolve();
    setFileErr(null);
    let count = files.filter((f) => f.question != null && Number(f.question) === i).length + pending.filter((x) => x.question === i).length;
    const queue = [];
    for (const file of picked) {
      if (count >= PER_QUESTION_FILES) { setFileErr({ index: i, message: `Up to ${PER_QUESTION_FILES} files per question.` }); break; }
      // What the assignment takes (details.answer_format): photos only, or everything (the API checks too).
      const photosOnly = ['images', 'images_text'].includes(row.briefDetails?.answer_format);
      if (photosOnly ? !/\.(jpe?g|png)$/i.test(file.name) : !FILE_OK.test(file.name)) { setFileErr({ index: i, message: photosOnly ? `${file.name}: this assignment takes photos (JPG or PNG) of your answers.` : `${file.name}: only PDF, JPG, PNG, Word (.docx) or text files.` }); continue; }
      if (file.size > 5 * 1024 * 1024) { setFileErr({ index: i, message: `${file.name} is larger than 5MB.` }); continue; }
      queue.push({ file, key: addPending(i, file.name) });
      count += 1;
    }
    if (!queue.length) return Promise.resolve();
    inFlight.current += queue.length; setUploadingQ(i);
    const run = async () => {
      for (const { file, key } of queue) {
        try {
          if (!cancelledUploads.current.has(key)) {
            const meta = await uploadActivityFile(row.assignmentId, file, i);
            if (!meta?.id) throw new Error('Upload failed.');
            if (cancelledUploads.current.has(key)) await removeActivityFile(meta.id).catch(() => {});
            else setFiles((fs) => [...fs, { ...meta, name: meta.name || file.name, size: meta.size || file.size, question: i }]);
          }
        } catch (e) {
          if (!cancelledUploads.current.has(key)) setFileErr({ index: i, message: e?.message || 'Could not upload that file. Try again.' });
        } finally {
          dropPending(key);
          inFlight.current -= 1;
          if (inFlight.current <= 0) setUploadingQ(null);
        }
      }
    };
    uploadChain.current = uploadChain.current.then(run, run);
    return uploadChain.current;
  };

  const removeFile = async (f) => {
    setRemoving(f.id); setFileErr(null);
    try {
      await removeActivityFile(f.id);
      setFiles((fs) => fs.filter((x) => x.id !== f.id));
      if (DRAWING_RE.test(f.name || '') && f.question != null) {
        setWork((w) => { const d = { ...(w.drawings || {}) }; delete d[f.question]; return { ...w, drawings: d }; });
      }
      if (DOC_RE.test(f.name || '') && f.question != null) storeDoc(row.assignmentId, Number(f.question), null);
    } catch (e) {
      setFileErr({ index: f.question, message: e?.message || 'Could not remove that file.' });
    } finally {
      setRemoving(null);
    }
  };

  /* A drawing reopens on the whiteboard while the work is open; anything else downloads. */
  // Handed in: my work as the submission paper (shown until it's marked, and downloaded).
  const submittedAt = row?.submission?.submittedAt || null;
  const hasPaper = Array.isArray(row?.briefDetails?.questions) && row.briefDetails.questions.length > 0;
  useEffect(() => {
    setPaperHtml(null);
    if (!submittedAt || !row?.targetId || !hasPaper) return undefined;
    let live = true;
    fetchMySubmissionPaper(row.targetId).then((t) => { if (live) setPaperHtml(t); }).catch(() => {});
    return () => { live = false; };
  }, [row?.targetId, submittedAt, hasPaper, row?.grade]);   // eslint-disable-line react-hooks/exhaustive-deps
  const downloadSubmission = () => {
    setPdfBusy(true); setSubmitErr('');
    const done = paperHtml
      ? printPaperHtml(paperHtml, `${row.title || 'Submission'} — my submission`)
      : downloadMySubmissionPdf(row.targetId, row.title);
    Promise.resolve(done).catch((e) => setSubmitErr(e?.message || 'Could not get the PDF.')).finally(() => setPdfBusy(false));
  };

  const openFile = (f) => {
    const editable = row?.status !== 'complete' && !row?.graded && f.question != null;
    if (editable && DRAWING_RE.test(f.name || '')) { setBoard(Number(f.question)); return; }
    if (editable && DOC_RE.test(f.name || '')) { openDoc(Number(f.question)); return; }
    downloadActivityFile(f.id, f.name).catch((e) => setSubmitErr(e?.message || 'Could not open that file.'));
  };

  /* A file this page made (a drawing, a document) becomes question i's file,
     replacing the one it made before — that one doesn't count toward the 3. */
  const replaceOwnFile = async (i, file) => {
    const old = files.find((f) => f.question != null && Number(f.question) === i && f.name === file.name);
    const others = files.filter((f) => f.question != null && Number(f.question) === i && f.id !== old?.id).length;
    if (others >= PER_QUESTION_FILES) throw new Error(`Up to ${PER_QUESTION_FILES} files per question — remove one first.`);
    if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} is larger than 5MB — use smaller pictures.`);
    // At the cap, the old copy goes first so the server has room for the new one.
    const atCap = old && others + 1 >= PER_QUESTION_FILES;
    if (atCap) {
      await removeActivityFile(old.id);
      setFiles((fs) => fs.filter((f) => f.id !== old.id));
    }
    const meta = await uploadActivityFile(row.assignmentId, file, i);
    if (!meta?.id) throw new Error('Upload failed.');
    if (old && !atCap) await removeActivityFile(old.id).catch(() => {});
    setFiles((fs) => [...fs.filter((f) => f.id !== old?.id), { ...meta, name: meta.name || file.name, size: meta.size || file.size, question: i }]);
  };

  /* "Attach to answer": the drawing becomes that question's file — re-attaching replaces it. */
  const attachDrawing = async (blob, strokes) => {
    const i = board;
    setFileErr(null); setUploadingQ(i);
    const pk = addPending(i, `drawing-q${i + 1}.png`);
    try {
      await replaceOwnFile(i, new File([blob], `drawing-q${i + 1}.png`, { type: 'image/png' }));
      setWork((w) => ({ ...w, drawings: { ...(w.drawings || {}), [i]: strokes } }));
    } catch (e) {
      setFileErr({ index: i, message: e?.message || 'Could not attach the drawing. Try again.' });
    } finally {
      dropPending(pk);
      setUploadingQ(null);
      setBoard(null);
    }
  };

  /* The document editor: this device's draft first, else the attached .docx read back, else a blank page. */
  const openDoc = async (i) => {
    setFileErr(null);
    const local = loadDoc(row.assignmentId, i);
    if (local?.json) { setDoc({ index: i, initial: { json: local.json, page: local.page }, dirty: !local.saved }); return; }
    const attached = files.find((f) => f.question != null && Number(f.question) === i && DOC_RE.test(f.name || ''));
    if (!attached) { setDoc({ index: i, initial: {}, dirty: false }); return; }
    setDoc({ index: i, loading: true });
    try {
      const [blob, mammoth] = await Promise.all([fetchActivityFileBlob(attached.id), import('mammoth')]);
      const { value } = await (mammoth.default || mammoth).convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
      setDoc({ index: i, initial: { html: value }, dirty: false });
    } catch (e) {
      setDoc(null);
      setFileErr({ index: i, message: e?.message || 'Could not open the document.' });
    }
  };
  const docFileName = (i) => `document-q${i + 1}.docx`;
  /* "Save to answer": a real Word file, attached to the question. */
  const saveDoc = async (json, page) => {
    const i = doc.index;
    const { docxBlob } = await import('../../../lib/wordDoc.js');
    const blob = await docxBlob(json, page, { title: `${row.title} — Question ${i + 1}` });
    setUploadingQ(i);
    const pk = addPending(i, docFileName(i));
    try {
      await replaceOwnFile(i, new File([blob], docFileName(i), { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      storeDoc(row.assignmentId, i, { json, page, saved: true });
    } finally {
      dropPending(pk);
      setUploadingQ(null);
    }
  };
  const downloadDoc = async (json, page) => {
    const { docxBlob } = await import('../../../lib/wordDoc.js');
    saveBlobAs(await docxBlob(json, page, { title: row.title }), docFileName(doc.index));
  };

  /* Hand in: answers still saving go first. */
  const handIn = async () => {
    setSubmitErr('');
    const pending = lastCheck(questions, workRef.current?.answers, saved, fileCounts).pending;
    if (pending.length) {
      setSubmitting(true);
      try { for (const i of pending) await flushAnswer(i); }
      catch { setSubmitErr('Some answers could not be saved — check your connection and try again.'); setSubmitting(false); return; }
    }
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
    await submit();
    setChecking(false);
  };

  /* Work without questions: the written answer autosaves to the server, and
     up to 5 files ride with it (uploaded straight away; removing deletes). */
  const LOOSE_MAX = 5;
  const looseFiles = files.filter((f) => f.question == null);
  const typeText = (text) => {
    setWork((w) => ({ ...w, text, editedAt: new Date().toISOString() }));
    setTextSave('saving');
    clearTimeout(timers.current.text);
    timers.current.text = setTimeout(() => {
      saveActivityText(rowRef.current.assignmentId, workRef.current?.text ?? '')
        .then(() => setTextSave('saved'), () => setTextSave('error'));
    }, 900);
  };

  const pickLoose = async (list) => {
    const picked = Array.from(list || []);
    if (!picked.length || uploading) return;
    setSubmitErr('');
    let count = looseFiles.length;
    setUploading(true);
    for (const file of picked) {
      if (count >= LOOSE_MAX) { setSubmitErr(`Up to ${LOOSE_MAX} files.`); break; }
      if (!FILE_OK.test(file.name)) { setSubmitErr(`${file.name}: only PDF, JPG, PNG, Word (.docx) or text files.`); continue; }
      if (file.size > 5 * 1024 * 1024) { setSubmitErr(`${file.name} is larger than 5MB.`); continue; }
      try {
        const meta = await uploadActivityFile(row.assignmentId, file);
        if (!meta?.id) throw new Error('Upload failed.');
        setFiles((fs) => [...fs, { ...meta, name: meta.name || file.name, size: meta.size || file.size }]);
        count += 1;
      } catch (e) {
        setSubmitErr(e?.message || 'Could not upload that file. Try again.');
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const st = row ? (STATUS[row.status] || STATUS.assigned) : STATUS.assigned;
  const due = row ? fmtDue(row.dueAt) : null;
  const stageList = row?.kind === 'multi_stage' ? (row.stages ?? []) : null;
  const doneCount = stageList?.filter((s) => s.status === 'complete').length ?? 0;
  const sub = row?.submission ?? {};
  const hasSubmittedContent = !!(sub.text || '').trim()
    || Object.keys(sub.answers ?? {}).length > 0
    || (sub.files ?? []).length > 0;

  return {
    row, loading, submitting, submitErr, work, dragOver, setDragOver, uploading, pdfBusy, paperHtml, saved, files,
    uploadingQ, pending, cancelPending, textSave, removing, fileErr, setFileErr, saveErrs, board, setBoard, doc, setDoc,
    checking, setChecking, setSubmitErr, setPdfBusy, fileRef, stepperJump, sheetRef,
    t, isDone, questions, useStepper, fileCounts, submittedAt, hasPaper, looseFiles, LOOSE_MAX,
    st, due, stageList, doneCount, sub, hasSubmittedContent,
    submit, flushAnswer, typeAnswer, pickFiles, removeFile, openFile, attachDrawing, openDoc, docFileName,
    saveDoc, downloadDoc, handIn, typeText, pickLoose, downloadSubmission,
  };
}
