import { Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/common/Icons.jsx';
import { BRAND, RED, GREEN, GOLD } from '../../constants.js';
import Spinner from '../../components/common/Spinner.jsx';
import { downloadMySubmissionPdf } from '../../services/activityApi.js';
import AnswerPaper, { FileCard } from '../../components/activity/AnswerPaper.jsx';
import PaperFrame from '../../components/activity/PaperFrame.jsx';
import { WhiteboardModal } from '../teaching/index.js';
// The document editor (TipTap + the .docx writer) loads only when opened.
const WordEditor = lazy(() => import('../../components/docs/WordEditor.jsx'));
import { lastCheck } from '../../lib/questionSteps.js';
import useActivityDetail from './hooks/useActivityDetail.js';
import { qText, storeDoc, typeOf } from './components/activityDetailModel.js';
import { ActivityHeader, ActivityFooter } from './components/ActivityDetailChrome.jsx';
import Stepper from './components/ActivityStepper.jsx';
import { ScoreCard, LastCheck, Receipt, SubmittedWork } from './components/ActivityResultViews.jsx';

/**
 * ActivityDetailPage — the full-screen detail view for one activity, ported
 * from the reference design (reference/activitiesdetails.md) onto the learner
 * app's tokens (--ak-* vars, Nunito, BRAND).
 *
 * Everything except typed answers and file attachments is REAL data from
 * /api/self-study/mine: the hero (type gradient, due/status chips), the
 * description, the stats, the multi-stage roadmap (server-derived per-stage
 * state), the graded banner (published grade + feedback), and the submit
 * action (POST /api/self-study/:id/complete — the same status flip the
 * teacher's class view reads).
 *
 * The question stepper runs whenever the brief actually carries questions
 * (details.questions): each question read-only on top, an answer box below
 * (type, attach up to 3 files, draw on the whiteboard), autosaved to the
 * server; then a review laid out like the paper with every answer under its
 * question, a last check, and the receipt. Briefs without questions keep the
 * free-text box and one attachment.
 */
export default function ActivityDetailPage() {
  const navigate = useNavigate();
  const {
    row, loading, submitting, submitErr, work, dragOver, setDragOver, uploading, pdfBusy, paperHtml, saved, files,
    uploadingQ, pending, cancelPending, textSave, removing, fileErr, setFileErr, saveErrs, board, setBoard, doc, setDoc,
    checking, setChecking, setSubmitErr, setPdfBusy, fileRef, stepperJump, sheetRef,
    t, isDone, questions, useStepper, fileCounts, looseFiles, LOOSE_MAX,
    st, due, stageList, doneCount, hasSubmittedContent,
    submit, flushAnswer, typeAnswer, pickFiles, removeFile, openFile, attachDrawing, openDoc, docFileName,
    saveDoc, downloadDoc, handIn, typeText, pickLoose, downloadSubmission,
  } = useActivityDetail();

  /* The attachment area for work without questions — the files, then a drop zone. */
  const attachArea = (
    <>
      {looseFiles.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {looseFiles.map((f) => <FileCard key={f.id} file={f} onOpen={openFile} onRemove={removeFile} busy={removing === f.id} sans="'Nunito',sans-serif"/>)}
        </div>
      )}
      {fileErr?.index == null && fileErr?.message && <div style={{ fontSize: 12, fontWeight: 700, color: RED, marginTop: 8 }}>{fileErr.message}</div>}
      {uploading ? (
        <div style={{ marginTop: 8, border: '1.5px dashed var(--ak-border)', borderRadius: 14, padding: '22px 14px', textAlign: 'center', background: 'var(--ak-surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
          <Spinner size={15} color={BRAND}/>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>Uploading…</div>
        </div>
      ) : looseFiles.length < LOOSE_MAX && (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); pickLoose(e.dataTransfer.files); }}
          style={{
            marginTop: 8, border: `1.5px dashed ${dragOver ? BRAND : 'var(--ak-border)'}`, borderRadius: 14,
            padding: '22px 14px', textAlign: 'center', cursor: 'pointer',
            background: dragOver ? `${BRAND}0A` : 'var(--ak-surface)',
          }}>
          <input ref={fileRef} type="file" multiple style={{ display: 'none' }}
            accept=".pdf,.jpg,.jpeg,.png,.docx,.txt"
            onChange={(e) => pickLoose(e.target.files)}/>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: `${BRAND}14`, color: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
            <Icon name="ti-cloud-upload" size={16}/>
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>Click to upload or drag and drop</div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ak-text-muted)', marginTop: 3 }}>PDF, JPG, PNG, DOCX or TXT up to 5MB · {looseFiles.length}/{LOOSE_MAX} files</div>
        </div>
      )}
    </>
  );

  /* ── loading / not found ── */
  if (loading) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--ak-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
        <Spinner size={26} color={BRAND}/>
      </div>
    );
  }
  if (!row) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--ak-bg)', zIndex: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20, fontFamily: "'Nunito',sans-serif" }}>
        <div style={{ width: 56, height: 56, borderRadius: 18, background: `${BRAND}14`, color: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="ti-inbox" size={28}/></div>
        <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--ak-text)', margin: 0 }}>Activity not found</p>
        <p style={{ fontSize: 12.5, color: 'var(--ak-text-muted)', margin: 0 }}>It may have been removed.</p>
        <button onClick={() => navigate('/activities')}
          style={{ marginTop: 10, padding: '9px 20px', borderRadius: 100, border: 'none', background: BRAND, color: '#fff', fontSize: 12.5, fontWeight: 900, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
          Back to activities
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'var(--ak-bg)', display: 'flex', flexDirection: 'column', fontFamily: "'Nunito',sans-serif" }}>
      {/* ── Header band — compact: back, type, title and the facts, in the type's colour ── */}
      <ActivityHeader navigate={navigate} t={t} row={row} due={due} st={st}/>

      {/* ── Sheet ── */}
      <div ref={sheetRef} style={{ flex: 1, overflowY: 'auto', background: 'var(--ak-bg)' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '22px 20px 24px' }}>
          {(row.instructions || row.details) && (
            <p style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ak-text-muted)', lineHeight: 1.6, margin: '0 0 20px' }}>
              {row.instructions || row.details}
            </p>
          )}

          {/* the AI is marking the hand-in right now */}
          {row.aiMarking && !row.graded && (
            <div data-testid="marking-card" style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--ak-surface)', borderRadius: 18, padding: '16px 16px', marginBottom: 20, boxShadow: '0 4px 18px rgba(17,24,39,.08)', fontFamily: "'Nunito',sans-serif" }}>
              <Spinner size={22} color={BRAND}/>
              <div>
                <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--ak-text)' }}>Marking your answers…</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 2 }}>Your score will appear here in a few seconds.</div>
              </div>
            </div>
          )}

          {/* the result: the score, big */}
          {row.graded && row.feedbackQuestions?.length > 0 && (
            <ScoreCard grade={row.grade} questions={row.feedbackQuestions} ai={row.feedbackAi} text={row.feedbackText}/>
          )}

          {/* graded banner — the published grade + feedback */}
          {row.graded && !(row.feedbackQuestions?.length > 0) && (
            <div style={{ background: 'rgba(16,185,129,.10)', border: '1px solid rgba(16,185,129,.25)', borderRadius: 14, padding: '12px 14px', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(16,185,129,.18)', color: '#047857', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name="ti-circle-check" size={16}/>
                </span>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 900, color: '#047857' }}>Graded · {row.grade}%</div>
                  {row.completedAt && (
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: '#047857', opacity: 0.75, marginTop: 1 }}>
                      Submitted {new Date(row.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </div>
                  )}
                </div>
              </div>
              {row.feedbackText && (
                <p style={{ fontSize: 12, fontWeight: 600, color: '#065F46', margin: '10px 0 0', lineHeight: 1.5 }}>{row.feedbackText}</p>
              )}
              {/* the rubric behind the score */}
              {row.feedbackRubric?.some((r) => r?.name) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
                  {row.feedbackRubric.filter((r) => r?.name).map((r) => (
                    <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, fontWeight: 700, color: '#065F46' }}>
                      <span style={{ flex: 1, minWidth: 0 }}>{r.name}</span>
                      <span style={{ width: 70, height: 5, borderRadius: 3, background: 'rgba(16,185,129,.18)', overflow: 'hidden', flexShrink: 0 }}>
                        <span style={{ display: 'block', height: '100%', width: `${r.max ? Math.min(100, ((r.level ?? 0) / r.max) * 100) : 0}%`, background: '#10B981' }}/>
                      </span>
                      <span style={{ width: 34, textAlign: 'right', flexShrink: 0 }}>{r.level ?? '–'}/{r.max}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* the marked copy — the work with the teacher's ticks, crosses and comments */}
              {row.markedPdf && row.targetId && (
                <button type="button" disabled={pdfBusy}
                  onClick={() => { setPdfBusy(true); setSubmitErr(''); downloadMySubmissionPdf(row.targetId, row.title, { marked: true }).catch((e) => setSubmitErr(e?.message || 'Could not get the marked copy.')).finally(() => setPdfBusy(false)); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 12, padding: '8px 14px', borderRadius: 20, border: 'none', background: '#047857', color: '#fff', fontSize: 12, fontWeight: 800, cursor: pdfBusy ? 'default' : 'pointer', fontFamily: "'Nunito',sans-serif" }}>
                  {pdfBusy ? <Spinner size={12}/> : <Icon name="ti-file-check" size={14}/>} Download marked copy (PDF)
                </button>
              )}
            </div>
          )}

          {/* multi-stage roadmap — server-derived per-stage state */}
          {stageList?.length > 0 && (
            <>
              <div style={{ background: 'var(--ak-surface)', borderRadius: 16, padding: '14px 15px', boxShadow: '0 2px 10px rgba(17,24,39,.06)', marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12, fontWeight: 800, color: 'var(--ak-text)', marginBottom: 8, fontFamily: "'Nunito',sans-serif" }}>
                  <span>Overall progress</span>
                  <span style={{ color: '#4338CA' }}>{doneCount} of {stageList.length} stages</span>
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  {stageList.map((s, i) => (
                    <i key={i} style={{ flex: 1, height: 8, borderRadius: 4, background: s.status === 'complete' ? 'linear-gradient(135deg, #4338CA, #6D5CE8)' : 'var(--ak-border)' }}/>
                  ))}
                </div>
              </div>
              <p style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', margin: '0 0 12px', fontFamily: "'Nunito',sans-serif" }}>Stages</p>
              <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 20 }}>
                {stageList.map((s, i) => {
                  const stageT = typeOf(s.kind === 'battle' ? 'battle' : s.kind);
                  const stMap = {
                    complete: { label: 'Done', color: GREEN },
                    active:   { label: 'In progress', color: BRAND },
                    locked:   { label: 'Locked', color: 'var(--ak-text-muted)' },
                    passed:   { label: 'Complete', color: GREEN },
                    open:     { label: 'Ready', color: GOLD },
                  };
                  const ss = stMap[s.status] || stMap.open;
                  return (
                    <div key={i}>
                      {i > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 20, color: 'var(--ak-text-muted)' }}>
                          <Icon name="ti-chevron-down" size={14}/>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 12, background: 'var(--ak-surface)', borderRadius: 18, padding: '14px 15px', boxShadow: '0 2px 10px rgba(17,24,39,.06)', opacity: s.status === 'locked' ? 0.55 : 1 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 11, background: `${stageT.mid}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Icon name={stageT.icon} size={15} color={stageT.mid}/>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', fontFamily: "'Nunito',sans-serif" }}>
                              Stage {i + 1} · {s.title || stageT.label}
                            </span>
                            <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3.5px 10px', borderRadius: 20, background: `${ss.color === 'var(--ak-text-muted)' ? '#9CA3AF' : ss.color}14`, color: ss.color === 'var(--ak-text-muted)' ? '#6B7280' : ss.color, fontFamily: "'Nunito',sans-serif" }}>
                              {ss.label}
                            </span>
                          </div>
                          <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ak-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', fontFamily: "'Nunito',sans-serif" }}>{stageT.label}</span>
                          {s.status === 'locked' && (
                            <p style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '6px 0 0', fontFamily: "'Nunito',sans-serif" }}>Unlocks after the stage before it</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* handed in, not marked yet: the receipt */}
          {isDone && !row.graded && !row.aiMarking && questions?.length > 0 && <Receipt questions={questions} submission={row.submission} completedAt={row.completedAt || row.submission?.submittedAt}/>}

          {/* a question paper once handed in: the paper with every answer under
              its question — marked (key, each mark and comment) once graded */}
          {(isDone || row.graded) && questions?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', margin: '0 0 12px', fontFamily: "'Nunito',sans-serif" }}>{row.graded ? 'Your marked paper' : 'Your submission'}</p>
              {paperHtml
                ? <PaperFrame html={paperHtml} title="My submission"/>
                : <AnswerPaper details={row.briefDetails} answers={row.submission?.answers || {}} files={row.submission?.files || []}
                    marks={row.graded ? row.feedbackQuestions || [] : []} showKey={!!row.graded} onOpenFile={openFile} sans="'Nunito',sans-serif"/>}
            </div>
          )}

          {/* the work the learner handed in — server copy (work without questions) */}
          {(isDone || row.graded) && !questions?.length && <div style={{ marginBottom: 20 }}><SubmittedWork submission={row.submission} questions={questions}/></div>}

          {/* submitted before capture, or with nothing written: say so
              instead of showing a silent page */}
          {(isDone || row.graded) && !hasSubmittedContent && !questions?.length
            && row.kind !== 'multi_stage' && row.kind !== 'live_course' && (
            <div style={{ background: 'var(--ak-surface)', borderRadius: 14, padding: '12px 14px', marginBottom: 20, border: '1px dashed var(--ak-border)' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', margin: 0, fontFamily: "'Nunito',sans-serif" }}>
                No written answer was captured for this submission — only the completion was recorded.
              </p>
            </div>
          )}

          {/* the whole submission as one PDF — the copy the teacher grades */}
          {row.submission?.submittedAt && row.targetId && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <button type="button" disabled={pdfBusy}
                onClick={downloadSubmission}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 20, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 12.5, fontWeight: 800, cursor: pdfBusy ? 'default' : 'pointer', fontFamily: "'Nunito',sans-serif" }}>
                {pdfBusy ? <Spinner size={12}/> : <Icon name="ti-file-type-pdf" size={14} color={RED}/>} Download my submission (PDF)
              </button>
            </div>
          )}
          {row.submission?.submittedAt && submitErr && isDone && (
            <div style={{ fontSize: 12, fontWeight: 700, color: RED, textAlign: 'center', marginBottom: 10 }}>{submitErr}</div>
          )}

          {/* submitted confirmation (work without questions — a paper gets the receipt above) */}
          {isDone && !row.graded && !questions?.length && (
            <div style={{ textAlign: 'center', padding: '10px 6px' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(16,185,129,.12)', color: '#047857', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <Icon name="ti-circle-check" size={24}/>
              </div>
              <h3 style={{ fontSize: 15.5, fontWeight: 900, margin: '0 0 4px', color: 'var(--ak-text)' }}>Work submitted</h3>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', margin: 0 }}>
                Your teacher will review it{row.submission?.files?.length ? ` and your attached file (${row.submission.files[0].name})` : ''}.
              </p>
            </div>
          )}

          {/* answer box + submission — open work only */}
          {!isDone && !row.graded && (
            <>
              <p style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', margin: '0 0 12px', fontFamily: "'Nunito',sans-serif" }}>
                {useStepper ? `Questions · ${questions.length}` : 'Your answer'}
              </p>
              {useStepper ? (
                <Stepper questions={questions} paper={row.briefDetails} work={work} saved={saved} files={files} fileCounts={fileCounts}
                  onType={typeAnswer} onFlush={flushAnswer} saveErrs={saveErrs}
                  onPick={pickFiles} onRemove={removeFile} onOpenFile={openFile} onDraw={(i) => { setFileErr(null); setBoard(i); }} onWrite={openDoc}
                  uploading={uploadingQ} removing={removing} fileErr={fileErr} pending={pending} onCancelPending={cancelPending}
                  mid={t.mid} dark={t.dark} onHandIn={() => { setSubmitErr(''); setChecking(true); }} submitting={submitting} jumpRef={stepperJump} targetId={row.targetId}/>
              ) : (
                <>
                  <textarea
                    value={work?.text || ''} onChange={(e) => typeText(e.target.value)}
                    placeholder="Type your answer or working…"
                    maxLength={8000}
                    style={{ width: '100%', minHeight: 110, borderRadius: 12, border: '1.5px solid var(--ak-border)', padding: '11px 13px', fontFamily: "'Nunito',sans-serif", fontSize: 12.5, fontWeight: 600, color: 'var(--ak-text)', resize: 'vertical', outline: 'none', boxSizing: 'border-box', background: 'var(--ak-surface)' }}/>
                  <div style={{ fontSize: 11, fontWeight: 800, textAlign: 'right', marginTop: 4, color: textSave === 'error' ? RED : textSave === 'saved' ? '#047857' : 'var(--ak-text-muted)' }}>
                    {textSave === 'saving' ? 'Saving…' : textSave === 'saved' ? 'Saved' : textSave === 'error' ? 'Not saved — check your connection' : ''}
                  </div>
                  {attachArea}
                </>
              )}
              {submitErr && <div style={{ fontSize: 12, fontWeight: 700, color: RED, marginTop: 10 }}>{submitErr}</div>}
            </>
          )}
        </div>
      </div>

      {/* the last check before handing in */}
      {checking && useStepper && !isDone && (
        <LastCheck check={lastCheck(questions, work.answers, saved, fileCounts)} total={questions.length} questions={questions}
          onAnswer={(i) => { setChecking(false); stepperJump.current?.(i); }}
          onSubmit={handIn} onClose={() => !submitting && setChecking(false)} submitting={submitting || uploadingQ !== null} err={submitErr} mid={t.mid} dark={t.dark}/>
      )}

      {/* the document editor, writing one question's answer */}
      {doc && (doc.loading ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3500, background: '#E6E6E6', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, fontFamily: "'Nunito',sans-serif" }}>
          <Spinner size={22} color="#2B579A"/><span style={{ fontSize: 13, fontWeight: 700, color: '#444' }}>Opening {docFileName(doc.index)}…</span>
        </div>
      ) : (
        <Suspense fallback={<div style={{ position: 'fixed', inset: 0, zIndex: 3500, background: '#E6E6E6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={22} color="#2B579A"/></div>}>
          <WordEditor key={doc.index} fileName={docFileName(doc.index)} subtitle={`Question ${doc.index + 1}`} initial={doc.initial} dirty={doc.dirty}
            onSave={saveDoc} onDownload={downloadDoc} onClose={() => setDoc(null)}
            onDraft={(json, page) => storeDoc(row.assignmentId, doc.index, { json, page, saved: false })}/>
        </Suspense>
      ))}

      {/* the whiteboard, drawing for one question's answer */}
      {board !== null && (
        <WhiteboardModal title={`Draw your answer · Question ${board + 1}`} topic={qText(questions?.[board]).slice(0, 90)} subject={row.subject || ''}
          initialStrokes={work?.drawings?.[board] || null} onAttach={attachDrawing} onClose={() => setBoard(null)}/>
      )}

      {/* ── Footer ── */}
      {(!useStepper || isDone) && (
        <ActivityFooter navigate={navigate} row={row} isDone={isDone} t={t} submitting={submitting} uploading={uploading} onSubmit={submit}/>
      )}
    </div>
  );
}
